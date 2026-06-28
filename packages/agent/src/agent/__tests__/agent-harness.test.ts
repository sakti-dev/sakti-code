import type { StreamRequest } from "@sakti-code/llm";
import { getModel } from "@sakti-code/llm";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  type FauxProviderRegistration,
  fauxAssistantMessage,
  fauxAssistantMessageWithContent,
  fauxToolCall,
  registerFauxStreamProvider,
} from "../../__tests__/helpers/faux-provider";
import { calculateTool } from "../../__tests__/utils/calculate";
import { getCurrentTimeTool } from "../../__tests__/utils/get-current-time";
import { TestExecutionEnv } from "../../agent/__tests__/test-execution-env";
import { AgentHarness } from "../../agent/agent-harness";
import type {
  AgentHarnessEvent,
  PromptTemplate,
  Skill,
} from "../../harness-types";
import { createTestSession } from "../../session/__tests__/session-test-utils";
import type { AgentMessage, AgentTool } from "../../types";

interface AppSkill extends Skill {
  source: "project" | "user";
}

interface AppPromptTemplate extends PromptTemplate {
  source: "project" | "user";
}

const registrations: FauxProviderRegistration[] = [];

function textFromUserMessages(
  messages: Array<{ role: string; content: unknown }>
): string[] {
  return messages.flatMap((message) => {
    if (message.role !== "user") return [];
    if (typeof message.content === "string") return [message.content];
    if (!Array.isArray(message.content)) return [];
    return message.content.flatMap((part) => {
      if (
        !part ||
        typeof part !== "object" ||
        !("type" in part) ||
        part.type !== "text"
      )
        return [];
      return "text" in part && typeof part.text === "string" ? [part.text] : [];
    });
  });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(() => {
  for (const registration of registrations.splice(0)) {
    registration.setResponses([]);
  }
});

describe("AgentHarness", () => {
  it("constructs directly and exposes queue modes", async () => {
    const session = await createTestSession();
    const env = new TestExecutionEnv(process.cwd());
    const initialModel = getModel("anthropic", "claude-sonnet-4-5");
    const harness = new AgentHarness({
      env,
      session,
      model: initialModel,
      thinkingLevel: "high",
      systemPrompt: "You are helpful.",
      steeringMode: "all",
      followUpMode: "all",
    });
    expect(harness.env).toBe(env);
    expect(harness.getModel()).toBe(initialModel);
    expect(harness.getThinkingLevel()).toBe("high");
    expect(harness.getSteeringMode()).toBe("all");
    expect(harness.getFollowUpMode()).toBe("all");
    harness.setSteeringMode("one-at-a-time");
    harness.setFollowUpMode("one-at-a-time");
    expect(harness.getSteeringMode()).toBe("one-at-a-time");
    expect(harness.getFollowUpMode()).toBe("one-at-a-time");
  });

  it("drains one queued steering message at a time and emits queue updates", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    const userCounts: number[] = [];
    registration.setResponses([
      (req: StreamRequest) => {
        userCounts.push(
          req.messages.filter((message) => message.role === "user").length
        );
        return fauxAssistantMessage("first");
      },
      (req: StreamRequest) => {
        userCounts.push(
          req.messages.filter((message) => message.role === "user").length
        );
        return fauxAssistantMessage("second");
      },
      (req: StreamRequest) => {
        userCounts.push(
          req.messages.filter((message) => message.role === "user").length
        );
        return fauxAssistantMessage("third");
      },
    ]);
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      steeringMode: "one-at-a-time",
    });
    const steerQueueLengths: number[] = [];
    let queued = false;
    harness.subscribe((event) => {
      if (event.type === "queue_update") {
        steerQueueLengths.push(event.steer.length);
      }
      if (
        event.type === "message_start" &&
        event.message.role === "assistant" &&
        !queued
      ) {
        queued = true;
        harness.steer("one");
        harness.steer("two");
      }
    });

    await harness.prompt("hello");

    expect(userCounts).toEqual([1, 2, 3]);
    expect(steerQueueLengths).toEqual([1, 2, 1, 0]);
  });

  it("appends before_agent_start messages and persists them", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    let requestText: string[] = [];
    registration.setResponses([
      (req: StreamRequest) => {
        requestText = textFromUserMessages(req.messages);
        return fauxAssistantMessage("ok");
      },
    ]);
    const session = await createTestSession();
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session,
      model: registration.getModel(),
      streamFn: registration.streamFn,
    });
    harness.on("before_agent_start", () => ({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "hook" }],
          timestamp: Date.now(),
        },
      ],
    }));

    await harness.prompt("hello");

    const persistedText = (
      await Effect.runPromise(session.getEntries())
    ).flatMap((entry) => {
      if (entry.type !== "message" || entry.message.role !== "user") return [];
      const content = entry.message.content;
      if (typeof content === "string") return [content];
      return content.flatMap((part) =>
        part.type === "text" ? [part.text] : []
      );
    });
    expect(requestText).toEqual(["hello", "hook"]);
    expect(persistedText).toEqual(["hello", "hook"]);
  });

  it("abort clears steer and follow-up queues but preserves next-turn messages", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    let releaseFirstResponse: (() => void) | undefined;
    let abortedSignal: AbortSignal | undefined;
    const firstResponseReleased = new Promise<void>((resolve) => {
      releaseFirstResponse = resolve;
    });
    const secondRequestText: string[] = [];
    registration.setResponses([
      async (req: StreamRequest) => {
        abortedSignal = req.abortSignal;
        await firstResponseReleased;
        return fauxAssistantMessage("aborted-ish");
      },
      (req: StreamRequest) => {
        secondRequestText.push(...textFromUserMessages(req.messages));
        return fauxAssistantMessage("second");
      },
    ]);
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
    });
    const queueUpdates: Array<{
      steer: number;
      followUp: number;
      nextTurn: number;
    }> = [];
    harness.subscribe((event) => {
      if (event.type === "queue_update") {
        queueUpdates.push({
          steer: event.steer.length,
          followUp: event.followUp.length,
          nextTurn: event.nextTurn.length,
        });
      }
    });

    const firstPrompt = harness.prompt("first");
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.steer("steer");
    harness.followUp("follow");
    harness.nextTurn("next");
    const abortResultPromise = harness.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(abortedSignal?.aborted).toBe(true);
    releaseFirstResponse?.();
    const abortResult = await abortResultPromise;
    await firstPrompt;
    await harness.prompt("second");

    expect(abortResult.clearedSteer).toHaveLength(1);
    expect(abortResult.clearedFollowUp).toHaveLength(1);
    expect(queueUpdates).toContainEqual({ steer: 0, followUp: 0, nextTurn: 1 });
    expect(secondRequestText).toEqual(["first", "next", "second"]);
  });

  it("drains follow-up messages one at a time after the agent would otherwise stop", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    const userCounts: number[] = [];
    registration.setResponses([
      (req: StreamRequest) => {
        userCounts.push(
          req.messages.filter((message) => message.role === "user").length
        );
        return fauxAssistantMessage("first");
      },
      (req: StreamRequest) => {
        userCounts.push(
          req.messages.filter((message) => message.role === "user").length
        );
        return fauxAssistantMessage("second");
      },
      (req: StreamRequest) => {
        userCounts.push(
          req.messages.filter((message) => message.role === "user").length
        );
        return fauxAssistantMessage("third");
      },
    ]);
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      followUpMode: "one-at-a-time",
    });
    const followUpQueueLengths: number[] = [];
    let queued = false;
    harness.subscribe((event) => {
      if (event.type === "queue_update") {
        followUpQueueLengths.push(event.followUp.length);
      }
      if (
        event.type === "message_start" &&
        event.message.role === "assistant" &&
        !queued
      ) {
        queued = true;
        harness.followUp("one");
        harness.followUp("two");
      }
    });

    await harness.prompt("hello");

    expect(userCounts).toEqual([1, 2, 3]);
    expect(followUpQueueLengths).toEqual([1, 2, 1, 0]);
  });

  it("settles thrown hook failures with persisted assistant error messages", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    registration.setResponses([
      () => fauxAssistantMessage("should not be used"),
    ]);
    const session = await createTestSession();
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session,
      model: registration.getModel(),
      streamFn: registration.streamFn,
    });
    const events: string[] = [];
    harness.subscribe((event) => {
      events.push(event.type);
    });
    harness.on("context", () => {
      throw new Error("context exploded");
    });

    const response = await harness.prompt("hello");
    await expect(harness.prompt("after failure")).resolves.toMatchObject({
      role: "assistant",
    });

    const entries = await Effect.runPromise(session.getEntries());
    const messages = entries.flatMap((entry) =>
      entry.type === "message" ? [entry.message] : []
    );
    expect(response.stopReason).toBe("error");
    expect(response.errorMessage).toBe("context exploded");
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]).toMatchObject({
      role: "assistant",
      stopReason: "error",
      errorMessage: "context exploded",
    });
    expect(events).toContain("agent_end");
    expect(events).toContain("settled");
  });

  it("refreshes model, thinking level, resources, system prompt, and active tools at save points", async () => {
    const registration = registerFauxStreamProvider("first");
    registrations.push(registration);
    const secondModel = registration.getModel("second");
    const captured: Array<{
      modelId: string;
      reasoning: unknown;
      systemPrompt: string;
      tools: string[];
    }> = [];
    registration.setResponses([
      (req: StreamRequest) => {
        captured.push({
          modelId: req.model.id,
          reasoning: req.thinkingLevel,
          systemPrompt: req.system ?? "",
          tools: Object.keys(req.tools ?? {}),
        });
        return fauxAssistantMessageWithContent(
          [
            fauxToolCall(
              "calculate",
              { expression: "1 + 1" },
              { id: "call-1" }
            ),
          ],
          "toolUse"
        );
      },
      (req: StreamRequest) => {
        captured.push({
          modelId: req.model.id,
          reasoning: req.thinkingLevel,
          systemPrompt: req.system ?? "",
          tools: Object.keys(req.tools ?? {}),
        });
        return fauxAssistantMessage("done");
      },
    ]);
    const harness = new AgentHarness<Skill, PromptTemplate, AgentTool>({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      thinkingLevel: "off",
      resources: {
        skills: [
          {
            name: "prompt",
            description: "prompt",
            content: "first prompt",
            filePath: "/skills/prompt",
          },
        ],
      },
      systemPrompt: ({ resources }) =>
        resources.skills?.[0]?.content ?? "missing prompt",
      tools: [calculateTool],
    });
    harness.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        void harness.setModel(secondModel);
        void harness.setThinkingLevel("high");
        void harness.setResources({
          skills: [
            {
              name: "prompt",
              description: "prompt",
              content: "second prompt",
              filePath: "/skills/prompt",
            },
          ],
        });
        void harness.setTools(
          [calculateTool, getCurrentTimeTool],
          [getCurrentTimeTool.name]
        );
      }
    });

    await harness.prompt("hello");

    expect(captured).toEqual([
      {
        modelId: "first",
        reasoning: undefined,
        systemPrompt: "first prompt",
        tools: ["calculate"],
      },
      {
        modelId: "second",
        reasoning: "high",
        systemPrompt: "second prompt",
        tools: ["get_current_time"],
      },
    ]);
  });

  it("orders pending listener session writes after agent-emitted messages", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    registration.setResponses([() => fauxAssistantMessage("ok")]);
    const session = await createTestSession();
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session,
      model: registration.getModel(),
      streamFn: registration.streamFn,
    });
    let wrotePendingMessage = false;
    harness.subscribe(async (event) => {
      if (
        event.type === "message_end" &&
        event.message.role === "assistant" &&
        !wrotePendingMessage
      ) {
        wrotePendingMessage = true;
        await harness.appendMessage({
          role: "custom",
          customType: "listener",
          content: "listener write",
          display: true,
          timestamp: Date.now(),
        } as AgentMessage);
      }
    });

    await harness.prompt("hello");

    const entries = await Effect.runPromise(session.getEntries());
    const roles = entries.flatMap((entry) =>
      entry.type === "message" ? [entry.message.role] : []
    );
    expect(roles).toEqual(["user", "assistant", "custom"]);
  });

  it("waitForIdle waits for external run settlement and awaited listeners", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    registration.setResponses([() => fauxAssistantMessage("ok")]);
    const barrier = deferred();
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
    });
    let listenerFinished = false;
    harness.subscribe(async (event) => {
      if (event.type === "agent_end") {
        await barrier.promise;
        listenerFinished = true;
      }
    });

    const promptPromise = harness.prompt("hello");
    let idleResolved = false;
    const idlePromise = harness.waitForIdle().then(() => {
      idleResolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(idleResolved).toBe(false);
    expect(listenerFinished).toBe(false);
    barrier.resolve();
    await Promise.all([promptPromise, idlePromise]);
    expect(idleResolved).toBe(true);
    expect(listenerFinished).toBe(true);
  });

  it("runs tool_call and tool_result hooks through the direct loop", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    registration.setResponses([
      () =>
        fauxAssistantMessageWithContent(
          [
            fauxToolCall(
              "calculate",
              { expression: "2 + 2" },
              { id: "call-1" }
            ),
          ],
          "toolUse"
        ),
    ]);
    const session = await createTestSession();
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session,
      model: registration.getModel(),
      streamFn: registration.streamFn,
      tools: [calculateTool],
    });
    const seenToolCalls: Array<{
      id: string;
      name: string;
      expression: unknown;
    }> = [];
    harness.on("tool_call", (event) => {
      seenToolCalls.push({
        id: event.toolCallId,
        name: event.toolName,
        expression: event.input.expression,
      });
      return undefined;
    });
    harness.on("tool_result", (event) => {
      expect(event.toolCallId).toBe("call-1");
      expect(event.toolName).toBe("calculate");
      return {
        content: [{ type: "text", text: "patched result" }],
        details: { patched: true },
        terminate: true,
      };
    });

    await harness.prompt("hello");

    const toolResult = (await Effect.runPromise(session.getEntries())).find(
      (entry) => entry.type === "message" && entry.message.role === "toolResult"
    );
    expect(seenToolCalls).toEqual([
      { id: "call-1", name: "calculate", expression: "2 + 2" },
    ]);
    expect(toolResult).toMatchObject({
      type: "message",
      message: {
        role: "toolResult",
        content: [{ type: "text", text: "patched result" }],
        details: { patched: true },
      },
    });
  });

  it("preserves app tool types for getters and update events", async () => {
    const session = await createTestSession();
    const env = new TestExecutionEnv(process.cwd());
    const model = getModel("anthropic", "claude-sonnet-4-5");
    type AppTool = AgentTool<typeof calculateTool.parameters, undefined> & {
      source: "builtin" | "extension";
    };
    const inspectTool: AppTool = {
      ...calculateTool,
      name: "inspect",
      source: "builtin",
    };
    const searchTool: AppTool = {
      ...calculateTool,
      name: "search",
      source: "extension",
    };
    const harness = new AgentHarness<AppSkill, AppPromptTemplate, AppTool>({
      env,
      session,
      model,
      tools: [inspectTool, searchTool],
      activeToolNames: ["inspect"],
    });
    const updates: Array<{
      toolNames: string[];
      previousToolNames: string[];
      activeToolNames: string[];
      previousActiveToolNames: string[];
      source: "set" | "restore";
    }> = [];
    harness.subscribe((event) => {
      if (event.type === "tools_update") {
        updates.push({
          toolNames: event.toolNames,
          previousToolNames: event.previousToolNames,
          activeToolNames: event.activeToolNames,
          previousActiveToolNames: event.previousActiveToolNames,
          source: event.source,
        });
        expect(harness.getActiveTools().map((tool) => tool.name)).toEqual(
          event.activeToolNames
        );
      }
    });

    const tools = harness.getTools();
    const activeTools = harness.getActiveTools();
    tools.pop();
    activeTools.pop();
    expect(harness.getTools().map((tool) => tool.name)).toEqual([
      "inspect",
      "search",
    ]);
    expect(harness.getActiveTools().map((tool) => tool.source)).toEqual([
      "builtin",
    ]);

    await harness.setActiveTools(["search"]);
    await harness.setTools([searchTool], ["search"]);
    await expect(harness.setActiveTools(["missing"])).rejects.toMatchObject({
      code: "invalid_argument",
    });
    await expect(
      harness.setActiveTools(["search", "search"])
    ).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(harness.setTools([inspectTool])).rejects.toMatchObject({
      code: "invalid_argument",
    });
    await expect(
      harness.setTools([inspectTool, inspectTool], ["inspect"])
    ).rejects.toMatchObject({
      code: "invalid_argument",
    });

    expect(updates).toEqual([
      {
        toolNames: ["inspect", "search"],
        previousToolNames: ["inspect", "search"],
        activeToolNames: ["search"],
        previousActiveToolNames: ["inspect"],
        source: "set",
      },
      {
        toolNames: ["search"],
        previousToolNames: ["inspect", "search"],
        activeToolNames: ["search"],
        previousActiveToolNames: ["search"],
        source: "set",
      },
    ]);
    expect(harness.getTools().map((tool) => tool.source)).toEqual([
      "extension",
    ]);
    expect(harness.getActiveTools().map((tool) => tool.name)).toEqual([
      "search",
    ]);
    expect(
      (await Effect.runPromise(session.buildContext())).activeToolNames
    ).toEqual(["search"]);
  });

  it("validates constructor tool names", async () => {
    const session = await createTestSession();
    const env = new TestExecutionEnv(process.cwd());
    const model = getModel("anthropic", "claude-sonnet-4-5");
    expect(
      () =>
        new AgentHarness({
          env,
          session,
          model,
          tools: [calculateTool],
          activeToolNames: ["missing"],
        })
    ).toThrow(/Unknown tool/);
    expect(
      () =>
        new AgentHarness({
          env,
          session,
          model,
          tools: [calculateTool, calculateTool],
          activeToolNames: [calculateTool.name],
        })
    ).toThrow(/Duplicate tool/);
    expect(
      () =>
        new AgentHarness({
          env,
          session,
          model,
          tools: [calculateTool],
          activeToolNames: [calculateTool.name, calculateTool.name],
        })
    ).toThrow(/Duplicate active tool/);
  });

  it("preserves app resource types for getters and update events", async () => {
    const session = await createTestSession();
    const env = new TestExecutionEnv(process.cwd());
    const model = getModel("anthropic", "claude-sonnet-4-5");
    const harness = new AgentHarness<AppSkill, AppPromptTemplate, AgentTool>({
      env,
      session,
      model,
    });
    const skill: AppSkill = {
      name: "inspect",
      description: "Inspect things",
      content: "Use inspection tools.",
      filePath: "/skills/inspect/SKILL.md",
      source: "project",
    };
    const promptTemplate: AppPromptTemplate = {
      name: "review",
      content: "Review $1",
      source: "user",
    };
    const resources = { skills: [skill], promptTemplates: [promptTemplate] };
    const updates: Array<{
      resourcesSource: string | undefined;
      previousSource: string | undefined;
    }> = [];
    harness.subscribe((event) => {
      if (event.type === "resources_update") {
        updates.push({
          resourcesSource: event.resources.skills?.[0]?.source,
          previousSource: event.previousResources.skills?.[0]?.source,
        });
      }
    });

    await harness.setResources(resources);
    await harness.setResources(resources);
    const resolved = harness.getResources();

    expect(updates).toEqual([
      { resourcesSource: "project", previousSource: undefined },
      { resourcesSource: "project", previousSource: "project" },
    ]);
    expect(resolved.skills?.[0]?.source).toBe("project");
    expect(resolved.promptTemplates?.[0]?.source).toBe("user");
    expect(resolved.skills).not.toBe(resources.skills);
    expect(resolved.promptTemplates).not.toBe(resources.promptTemplates);
  });

  it("completes a turn without error when no subscribers are registered", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    registration.setResponses([() => fauxAssistantMessage("done")]);
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
    });

    await harness.prompt("hello");

    expect(registration.callCount).toBe(1);
  });

  it("delivers message_update streaming events to subscribers", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    registration.setResponses([
      () => fauxAssistantMessageWithContent([{ type: "text", text: "hi" }]),
    ]);
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
    });
    const eventTypes: string[] = [];
    harness.subscribe((event) => {
      eventTypes.push(event.type);
    });

    await harness.prompt("hello");

    expect(eventTypes).toContain("message_start");
    expect(eventTypes).toContain("message_update");
    expect(eventTypes).toContain("message_end");
  });
});

describe("scheduleSystemPromptRefresh", () => {
  it("stores a pending prompt swap without affecting the current turn", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    const captured: string[] = [];
    registration.setResponses([
      (req: StreamRequest) => {
        captured.push(req.system ?? "");
        return fauxAssistantMessage("ok");
      },
    ]);
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      systemPrompt: "original prompt",
    });

    harness.scheduleSystemPromptRefresh("new prompt");
    expect(harness.getPendingSystemPromptRefresh()).toBe("new prompt");

    await harness.prompt("hello");

    // Current turn still uses the original prompt — refresh is deferred.
    expect(captured).toEqual(["original prompt"]);
  });

  it("clears pending refresh when switchAgent applies a new prompt immediately", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      systemPrompt: "original",
    });

    harness.scheduleSystemPromptRefresh("pending");
    expect(harness.getPendingSystemPromptRefresh()).toBe("pending");

    await harness.switchAgent({
      name: "x",
      mode: "primary",
      systemPrompt: "applied now",
    });

    expect(harness.getPendingSystemPromptRefresh()).toBeUndefined();
  });

  it("drains pending refresh during compaction (next turn uses new prompt)", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    const session = await createTestSession();
    const capturedSystems: string[] = [];

    // Seed one user message so prepareCompaction has entries to work with.
    await Effect.runPromise(
      session.appendMessage({
        role: "user",
        content: [{ type: "text", text: "seed message" }],
        timestamp: Date.now(),
      })
    );
    const entries = await Effect.runPromise(session.getEntries());
    const firstKeptEntryId = entries[0]!.id;

    // Post-compaction turn — should see the refreshed prompt.
    registration.setResponses([
      (req: StreamRequest) => {
        capturedSystems.push(req.system ?? "");
        return fauxAssistantMessage("ok");
      },
    ]);

    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session,
      model: registration.getModel(),
      streamFn: registration.streamFn,
      systemPrompt: "original",
      getApiKeyAndHeaders: async () => ({ apiKey: "test-key" }),
    });

    // Inject the compaction result via the hook so we don't need an LLM
    // summarizer call — we're testing the drain, not the summarizer.
    harness.on("session_before_compact", () => ({
      compaction: {
        summary: "compact summary",
        firstKeptEntryId,
        tokensBefore: 100,
      },
    }));

    harness.scheduleSystemPromptRefresh("refreshed");
    expect(harness.getPendingSystemPromptRefresh()).toBe("refreshed");

    await harness.compact();

    expect(harness.getPendingSystemPromptRefresh()).toBeUndefined();
    expect(harness.getSystemPrompt()).toBe("refreshed");

    await harness.prompt("next turn after compact");
    expect(capturedSystems).toEqual(["refreshed"]);
  });

  it("emits cache_bust_pending when a refresh is scheduled", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      systemPrompt: "original",
    });

    const events: AgentHarnessEvent[] = [];
    harness.subscribe((event) => {
      if (event.type === "cache_bust_pending") {
        events.push(event);
      }
    });

    harness.scheduleSystemPromptRefresh("new");
    // emitOwn is async; flush the microtask before asserting.
    await Promise.resolve();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "cache_bust_pending",
      reason: "system_prompt_refresh",
    });
  });
});

describe("announceSkillAdded", () => {
  it("pushes a <skills-added> steering message on the next turn", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    const captured: string[] = [];
    registration.setResponses([
      (req: StreamRequest) => {
        const userText = textFromUserMessages(
          req.messages as Array<{ role: string; content: unknown }>
        ).join("\n");
        captured.push(userText);
        return fauxAssistantMessage("ok");
      },
    ]);

    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      systemPrompt: "frozen prompt",
    });

    harness.announceSkillAdded({
      name: "graphify",
      description: "any input to knowledge graph",
      content: "",
      filePath: "/home/user/skills/graphify/SKILL.md",
    });

    await harness.prompt("hello");

    expect(captured[0]).toContain("<skills-added>");
    expect(captured[0]).toContain("graphify");
    expect(captured[0]).toContain("/home/user/skills/graphify/SKILL.md");
    expect(captured[0]).toContain("hello");
  });
});

describe("softDisableTool", () => {
  it("blocks execution of the named tool while keeping its schema in the request", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);

    const capturedRequests: StreamRequest[] = [];
    const blockedResults: string[] = [];
    registration.setResponses([
      (req: StreamRequest) => {
        capturedRequests.push(req);
        return fauxAssistantMessageWithContent(
          [fauxToolCall("calculate", { expression: "1+1" }, { id: "c1" })],
          "toolUse"
        );
      },
      () => fauxAssistantMessage("done"),
    ]);

    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      tools: [calculateTool],
    });

    harness.subscribe((event) => {
      if (event.type === "tool_execution_end" && event.isError) {
        const text = (
          event.result.content as Array<{ type: string; text?: string }>
        )
          .map((c) => (c.type === "text" ? (c.text ?? "") : ""))
          .join("");
        blockedResults.push(text);
      }
    });

    harness.softDisableTool("calculate", "tool disabled for testing");

    await harness.prompt("compute 1+1");

    // Schema is still in the request (cache stays warm)
    expect(capturedRequests[0]?.tools).toBeDefined();
    expect(Object.keys(capturedRequests[0]!.tools!).includes("calculate")).toBe(
      true
    );

    // Execution was blocked with a clear reason
    expect(blockedResults.length).toBeGreaterThanOrEqual(1);
    expect(blockedResults[0]).toContain("tool disabled for testing");
  });

  it("softEnableTool removes the gate and allows execution", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);

    const toolResults: string[] = [];
    registration.setResponses([() => fauxAssistantMessage("no tool call")]);

    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      tools: [calculateTool],
    });

    harness.subscribe((event) => {
      if (event.type === "tool_result") {
        const text = event.content
          .map((c) => (c.type === "text" ? c.text : ""))
          .join("");
        toolResults.push(text);
      }
    });

    harness.softDisableTool("calculate", "temporarily off");
    expect(harness.isToolSoftDisabled("calculate")).toBe(true);

    harness.softEnableTool("calculate");
    expect(harness.isToolSoftDisabled("calculate")).toBe(false);
  });
});

describe("addSkill / removeSkill", () => {
  it("addSkill: updates resources and announces via <skills-added>", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    const capturedUserText: string[] = [];
    registration.setResponses([
      (req: StreamRequest) => {
        capturedUserText.push(
          textFromUserMessages(
            req.messages as Array<{ role: string; content: unknown }>
          ).join("\n")
        );
        return fauxAssistantMessage("ok");
      },
    ]);

    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      systemPrompt: "frozen",
      resources: { skills: [] as Skill[] },
    });

    await harness.addSkill({
      name: "new-skill",
      description: "newly installed",
      content: "",
      filePath: "/skills/new/SKILL.md",
    });

    expect(harness.getResources().skills?.map((s) => s.name)).toEqual([
      "new-skill",
    ]);

    await harness.prompt("hello");

    expect(capturedUserText[0]).toContain("<skills-added>");
    expect(capturedUserText[0]).toContain("new-skill");
  });

  it("removeSkill: schedules prompt refresh + soft-disables read on the skill path", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      systemPrompt: "frozen",
      resources: {
        skills: [
          {
            name: "old-skill",
            description: "to be removed",
            content: "",
            filePath: "/skills/old/SKILL.md",
          },
        ],
      },
    });

    const events: AgentHarnessEvent[] = [];
    harness.subscribe((event) => {
      if (event.type === "cache_bust_pending") {
        events.push(event);
      }
    });

    await harness.removeSkill("old-skill");

    // Skill is gone from resources
    expect(harness.getResources().skills?.map((s) => s.name)).toEqual([]);

    // Prompt refresh is pending (deferred to compaction)
    expect(harness.getPendingSystemPromptRefresh()).toBeDefined();

    // Cache-bust alert fired
    await Promise.resolve();
    expect(events.length).toBeGreaterThanOrEqual(1);

    // read on the skill's path is gated (the model shouldn't reload a
    // disabled skill's body)
    expect(harness.isToolPathSoftDisabled("/skills/old/SKILL.md")).toBe(true);
  });

  it("removeSkill is idempotent for unknown skills", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      systemPrompt: "frozen",
      resources: { skills: [] as Skill[] },
    });

    await harness.removeSkill("nonexistent");

    expect(harness.getPendingSystemPromptRefresh()).toBeUndefined();
    expect(harness.getResources().skills?.length).toBe(0);
  });
});
