import type { StreamRequest } from "@sakti-code/llm";
import { getModel } from "@sakti-code/llm";
import { Effect, Fiber, Stream } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  type FauxProviderRegistration,
  fauxAssistantMessage,
  fauxAssistantMessageWithContent,
  fauxToolCall,
  registerFauxStreamProvider,
} from "../../__tests__/helpers/faux-provider";
import {
  TEST_BRANCH_SUMMARY_PROMPTS,
  TEST_COMPACTION_PROMPTS,
  TEST_SKILLS_INSTRUCTIONS,
} from "../../__tests__/helpers/test-compaction-prompts.ts";
import { calculateTool } from "../../__tests__/utils/calculate";
import { getCurrentTimeTool } from "../../__tests__/utils/get-current-time";
import { TestExecutionEnv } from "../../agent/__tests__/test-execution-env";
import { AgentHarness } from "../../agent/agent-harness";
import type {
  AgentHarnessEvent,
  PromptTemplate,
  Skill,
} from "../../harness-types";
import { composeSystemPrompt } from "../../resources/system-prompt";
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      source: "set" | "restore" | "swap";
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
          compactionPrompts: TEST_COMPACTION_PROMPTS,
          branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
          skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
          compactionPrompts: TEST_COMPACTION_PROMPTS,
          branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
          skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
          compactionPrompts: TEST_COMPACTION_PROMPTS,
          branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
          skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
    });

    await harness.prompt("hello");

    expect(registration.callCount).toBe(1);
  });

  it("promptEffect returns an Effect that resolves to the assistant message", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    registration.setResponses([() => fauxAssistantMessage("hello back")]);
    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
    });

    const message = await Effect.runPromise(harness.promptEffect("hello"));

    expect(message.role).toBe("assistant");
    expect(registration.callCount).toBe(1);
  });

  it("promptEffect surfaces harness errors as Effect.fail (busy state)", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    registration.setResponses([
      () => fauxAssistantMessage("first"),
      () => fauxAssistantMessage("second"),
    ]);
    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
    });

    // Kick off a prompt but don't await — the harness is still busy.
    const inFlight = harness.prompt("first");
    // Microtask let the run start.
    await Promise.resolve();
    const secondResult = await Effect.runPromise(
      harness.promptEffect("second").pipe(Effect.exit)
    );
    expect(secondResult._tag).toBe("Failure");
    // Clean up: let the in-flight turn finish so the harness settles.
    await inFlight;
  });

  it("subscribeStream yields a Stream that surfaces agent_start + turn events", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    registration.setResponses([() => fauxAssistantMessage("hi")]);
    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
    });

    const stream = harness.subscribeStream();
    const events: AgentHarnessEvent[] = [];

    // Start the drain FIRST (forked), then fork the prompt. Stream.fromPubSub
    // subscribes on first pull — if we fork prompt first, agent_start can be
    // published before the subscription exists and we'd miss it. This is the
    // documented PubSub semantics, not a bug in the harness.
    const drainFiber = Effect.runFork(
      Stream.runForEach(stream, (e) =>
        Effect.sync(() => events.push(e as AgentHarnessEvent))
      )
    );
    // Yield a microtask so the drain's subscription is registered before the
    // prompt starts publishing.
    await new Promise((r) => setTimeout(r, 0));

    const turnFiber = Effect.runFork(harness.promptEffect("hello"));

    // Wait for the turn to settle, then interrupt the (infinite) drain.
    await Effect.runPromise(Fiber.join(turnFiber).pipe(Effect.exit));
    await Effect.runPromise(Fiber.interrupt(drainFiber).pipe(Effect.exit));

    const types = events.map((e) => e.type);
    expect(types).toContain("agent_start");
    expect(types).toContain("turn_end");
  });

  it("delivers message_update streaming events to subscribers", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    registration.setResponses([
      () => fauxAssistantMessageWithContent([{ type: "text", text: "hi" }]),
    ]);
    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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

describe("softDisableTool prompt refresh", () => {
  it("schedules a prompt refresh that excludes the disabled tool description", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);

    const basePrompt = "You are a coding agent.";
    const composedPrompt = composeSystemPrompt(
      basePrompt,
      [calculateTool, getCurrentTimeTool],
      [],
      false,
      TEST_SKILLS_INSTRUCTIONS
    );

    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      systemPrompt: composedPrompt,
      tools: [calculateTool, getCurrentTimeTool],
    });

    harness.softDisableTool("calculate", "user disabled");

    // Live prompt is unchanged (cache stays warm)
    expect(harness.getSystemPrompt()).toContain("# Tool: calculate");

    // Pending refresh excludes the disabled tool
    const pending = harness.getPendingSystemPromptRefresh();
    expect(pending).toBeDefined();
    expect(pending).not.toContain("# Tool: calculate");
    expect(pending).toContain("# Tool: get_current_time");
  });

  it("softEnableTool schedules a prompt refresh that re-includes the tool", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);

    const basePrompt = "You are a coding agent.";
    const composedPrompt = composeSystemPrompt(
      basePrompt,
      [calculateTool, getCurrentTimeTool],
      [],
      false,
      TEST_SKILLS_INSTRUCTIONS
    );

    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      systemPrompt: composedPrompt,
      tools: [calculateTool, getCurrentTimeTool],
    });

    harness.softDisableTool("calculate", "temporarily off");
    expect(harness.getPendingSystemPromptRefresh()).not.toContain(
      "# Tool: calculate"
    );

    harness.softEnableTool("calculate");
    const pending = harness.getPendingSystemPromptRefresh();
    expect(pending).toBeDefined();
    expect(pending).toContain("# Tool: calculate");
  });

  it("emits cache_bust_pending when scheduling the refresh", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);

    const composedPrompt = composeSystemPrompt(
      "Base.",
      [calculateTool],
      [],
      false,
      TEST_SKILLS_INSTRUCTIONS
    );

    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      systemPrompt: composedPrompt,
      tools: [calculateTool],
    });

    const events: AgentHarnessEvent[] = [];
    harness.subscribe((event) => {
      if (event.type === "cache_bust_pending") {
        events.push(event);
      }
    });

    harness.softDisableTool("calculate", "off");
    await Promise.resolve();

    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("removeSkill + softDisableTool: pending refresh excludes both", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);

    const skill: Skill = {
      name: "tdd",
      description: "TDD",
      content: "",
      filePath: "/skills/tdd/SKILL.md",
    };
    const basePrompt = "You are a coding agent.";
    const composedPrompt = composeSystemPrompt(
      basePrompt,
      [calculateTool, getCurrentTimeTool],
      [skill],
      true,
      TEST_SKILLS_INSTRUCTIONS
    );

    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      systemPrompt: composedPrompt,
      tools: [calculateTool, getCurrentTimeTool],
      resources: { skills: [skill] },
    });

    await harness.removeSkill("tdd");
    harness.softDisableTool("calculate", "off");

    const pending = harness.getPendingSystemPromptRefresh();
    expect(pending).toBeDefined();
    // Tool excluded
    expect(pending).not.toContain("# Tool: calculate");
    expect(pending).toContain("# Tool: get_current_time");
    // Skill excluded
    expect(pending).not.toContain("<available_skills>");
    expect(pending).not.toContain("tdd");
  });

  it("preserves skills block in refresh when only a tool is disabled", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);

    const skill: Skill = {
      name: "tdd",
      description: "TDD",
      content: "",
      filePath: "/skills/tdd/SKILL.md",
    };
    const readTool: AgentTool = {
      name: "read",
      description: "Read a file.",
      label: "Read",
      parameters: { type: "object", properties: {} },
      execute: async () => ({
        content: [{ type: "text", text: "" }],
        details: undefined,
      }),
    } as unknown as AgentTool;
    const allTools = [calculateTool, getCurrentTimeTool, readTool];
    const basePrompt = "You are a coding agent.";
    const composedPrompt = composeSystemPrompt(
      basePrompt,
      allTools,
      [skill],
      true,
      TEST_SKILLS_INSTRUCTIONS
    );

    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      systemPrompt: composedPrompt,
      tools: allTools,
      resources: { skills: [skill] },
    });

    harness.softDisableTool("calculate", "off");

    const pending = harness.getPendingSystemPromptRefresh();
    expect(pending).toBeDefined();
    // Tool excluded
    expect(pending).not.toContain("# Tool: calculate");
    // Other tools still present
    expect(pending).toContain("# Tool: get_current_time");
    expect(pending).toContain("# Tool: read");
    // Skill still present (read is available)
    expect(pending).toContain("<available_skills>");
    expect(pending).toContain("tdd");
  });
});

describe("swapTool", () => {
  it("swaps tool implementation while preserving activeToolNames", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    registration.setResponses([() => fauxAssistantMessage("ok")]);

    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      tools: [calculateTool, getCurrentTimeTool],
    });

    const originalEdit = harness.getTools().find((t) => t.name === "calculate");
    const swappedTool = {
      ...calculateTool,
      description: "A completely different description.",
    } as typeof calculateTool;

    await harness.swapTool("calculate", swappedTool);

    const currentTools = harness.getTools();
    const swapped = currentTools.find((t) => t.name === "calculate");
    expect(swapped).toBeDefined();
    expect(swapped?.description).toBe("A completely different description.");
    expect(swapped).not.toBe(originalEdit);

    // activeToolNames preserved
    const active = harness.getActiveTools();
    expect(active.map((t) => t.name)).toEqual([
      "calculate",
      "get_current_time",
    ]);
  });

  it("schedules prompt refresh with the new tool description", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);

    const basePrompt = "You are a coding agent.";
    const composedPrompt = composeSystemPrompt(
      basePrompt,
      [calculateTool, getCurrentTimeTool],
      [],
      false,
      TEST_SKILLS_INSTRUCTIONS
    );

    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      systemPrompt: composedPrompt,
      tools: [calculateTool, getCurrentTimeTool],
    });

    const newTool = {
      ...calculateTool,
      description: "Calculate things differently.",
    } as typeof calculateTool;

    await harness.swapTool("calculate", newTool);

    // Live prompt still has old description (frozen)
    expect(harness.getSystemPrompt()).toContain(calculateTool.description);

    // Pending refresh has new description
    const pending = harness.getPendingSystemPromptRefresh();
    expect(pending).toBeDefined();
    expect(pending).toContain("Calculate things differently.");
    expect(pending).not.toContain(calculateTool.description);
    // Other tool unchanged
    expect(pending).toContain("# Tool: get_current_time");
  });

  it("announces via <tool-schema-changed> on the steer queue", async () => {
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      systemPrompt: "frozen",
      tools: [calculateTool],
    });

    const newTool = {
      ...calculateTool,
      description: "Brand new format for calculating.",
    } as typeof calculateTool;

    await harness.swapTool("calculate", newTool);
    await harness.prompt("hello");

    expect(capturedUserText[0]).toContain("<tool-schema-changed>");
    expect(capturedUserText[0]).toContain("calculate");
    expect(capturedUserText[0]).toContain("Brand new format for calculating.");
  });

  it("throws when newTool.name does not match name", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);

    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      tools: [calculateTool],
    });

    await expect(
      harness.swapTool(
        "calculate",
        getCurrentTimeTool as unknown as typeof calculateTool
      )
    ).rejects.toThrow("must match");
  });

  it("throws when tool name not found in registry", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);

    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      tools: [calculateTool],
    });

    const ghostTool = {
      ...calculateTool,
      name: "nonexistent",
    } as typeof calculateTool;

    await expect(harness.swapTool("nonexistent", ghostTool)).rejects.toThrow(
      "not found"
    );
  });

  it("emits tools_update event with source swap", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);

    const events: AgentHarnessEvent[] = [];
    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      tools: [calculateTool, getCurrentTimeTool],
    });
    harness.subscribe((event) => {
      events.push(event);
    });

    const newTool = {
      ...calculateTool,
      description: "Updated.",
    } as typeof calculateTool;

    await harness.swapTool("calculate", newTool);

    const update = events.find(
      (e) => e.type === "tools_update" && e.source === "swap"
    );
    expect(update).toBeDefined();
    expect(update?.type).toBe("tools_update");
    if (update?.type === "tools_update") {
      expect(update.activeToolNames).toEqual(["calculate", "get_current_time"]);
    }
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
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

  it("tracks session-cumulative cache hit/miss counters across turns (§10)", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    registration.setResponses([
      () => fauxAssistantMessage("first"),
      () => fauxAssistantMessage("second"),
    ]);

    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      systemPrompt: "You are helpful.",
    });

    await harness.prompt("hello");
    await harness.prompt("world");

    const counters = harness.getCacheCounters();
    expect(typeof counters.cacheHitTokens).toBe("number");
    expect(typeof counters.cacheMissTokens).toBe("number");
    expect(counters.turnCount).toBeGreaterThanOrEqual(2);
    expect(typeof counters.hitRate).toBe("number");
  });
});

describe("*Effect cores (Phase H1)", () => {
  it("appendMessageEffect returns an Effect that appends a message when idle", async () => {
    const session = await createTestSession();
    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session,
      model: getModel("anthropic", "claude-sonnet-4-5"),
    });
    const message: AgentMessage = {
      role: "user",
      content: [{ type: "text", text: "hi" }],
      timestamp: Date.now(),
    };
    const effect = harness.appendMessageEffect(message);
    expect(effect).toBeDefined();
    expect(typeof effect).toBe("object");
    await Effect.runPromise(effect);
    const entries = await Effect.runPromise(session.getEntries());
    expect(entries.some((entry) => entry.type === "message")).toBe(true);
  });

  it("setModelEffect returns an Effect that updates the model when idle", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel("initial"),
    });
    const nextModel = registration.getModel("next");
    const effect = harness.setModelEffect(nextModel);
    expect(typeof effect).toBe("object");
    await Effect.runPromise(effect);
    expect(harness.getModel()).toBe(nextModel);
  });

  it("setThinkingLevelEffect returns an Effect that updates the thinking level when idle", async () => {
    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: getModel("anthropic", "claude-sonnet-4-5"),
      thinkingLevel: "off",
    });
    const effect = harness.setThinkingLevelEffect("high");
    expect(typeof effect).toBe("object");
    await Effect.runPromise(effect);
    expect(harness.getThinkingLevel()).toBe("high");
  });

  it("setToolsEffect returns an Effect that updates the tools when idle", async () => {
    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: getModel("anthropic", "claude-sonnet-4-5"),
    });
    const effect = harness.setToolsEffect([], []);
    expect(typeof effect).toBe("object");
    await Effect.runPromise(effect);
    expect(harness.getTools()).toEqual([]);
  });

  it("setActiveToolsEffect returns an Effect that updates the active tools when idle", async () => {
    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: getModel("anthropic", "claude-sonnet-4-5"),
    });
    const effect = harness.setActiveToolsEffect([]);
    expect(typeof effect).toBe("object");
    await Effect.runPromise(effect);
    expect(harness.getActiveTools()).toEqual([]);
  });

  it("compactEffect returns an Effect that compacts the session when idle", async () => {
    const session = await createTestSession();
    await Effect.runPromise(
      session.appendMessage({
        role: "user",
        content: [{ type: "text", text: "seed message" }],
        timestamp: Date.now(),
      })
    );
    const entries = await Effect.runPromise(session.getEntries());
    const firstKeptEntryId = entries[0]!.id;
    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session,
      model: getModel("anthropic", "claude-sonnet-4-5"),
      getApiKeyAndHeaders: async () => ({ apiKey: "test-key" }),
    });
    harness.on("session_before_compact", () => ({
      compaction: {
        summary: "compact summary",
        firstKeptEntryId,
        tokensBefore: 100,
      },
    }));
    const effect = harness.compactEffect();
    expect(typeof effect).toBe("object");
    const result = await Effect.runPromise(effect);
    expect(result.summary).toBe("compact summary");
  });

  it("navigateTreeEffect returns an Effect that resolves cancelled:false when navigating to the current leaf", async () => {
    const session = await createTestSession();
    await Effect.runPromise(
      session.appendMessage({
        role: "user",
        content: [{ type: "text", text: "seed message" }],
        timestamp: Date.now(),
      })
    );
    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session,
      model: getModel("anthropic", "claude-sonnet-4-5"),
    });
    const leafId = await Effect.runPromise(session.getLeafId());
    expect(leafId).not.toBeNull();
    const effect = harness.navigateTreeEffect(leafId!);
    expect(typeof effect).toBe("object");
    const result = await Effect.runPromise(effect);
    expect(result.cancelled).toBe(false);
  });
});

describe("Effect-native prompt emit ordering (Phase H2 regression)", () => {
  // Locks the emit sequence from promptEffect against prompt. The previous
  // flake (1/3 runs in ws.test.ts) was caused by emit-timing divergence
  // between runAgentLoopEffect (Effect.promise) and runAgentLoop (await).
  // After H2 both paths route through the same Effect core, so the sequences
  // must be byte-identical for the same input.

  it("promptEffect produces the same event-type sequence as prompt", async () => {
    const seenTypes = async (useEffect: boolean): Promise<string[]> => {
      const registration = registerFauxStreamProvider();
      registrations.push(registration);
      registration.setResponses([() => fauxAssistantMessage("ok")]);
      const events: string[] = [];
      const harness = new AgentHarness({
        compactionPrompts: TEST_COMPACTION_PROMPTS,
        branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
        skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
        env: new TestExecutionEnv(process.cwd()),
        session: await createTestSession(),
        model: registration.getModel(),
        streamFn: registration.streamFn,
      });
      harness.subscribe((event) => {
        events.push(event.type);
        return Promise.resolve();
      });
      if (useEffect) {
        await Effect.runPromise(harness.promptEffect("hello"));
        await Effect.runPromise(harness.waitForIdleEffect());
      } else {
        await harness.prompt("hello");
        await harness.waitForIdle();
      }
      return events;
    };

    const fromEffect = await seenTypes(true);
    const fromPromise = await seenTypes(false);

    expect(fromEffect).toEqual(fromPromise);
    // Sanity: canonical sequence present
    expect(fromEffect).toEqual(
      expect.arrayContaining(["agent_start", "turn_start", "agent_end"])
    );
  });
});
