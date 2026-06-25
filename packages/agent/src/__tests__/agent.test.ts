import { getModel } from "@sakti-code/llm";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { Agent } from "../agent.ts";
import type {
  AgentEvent,
  AgentTool,
  AgentToolUpdateCallback,
  StreamFn,
} from "../types.ts";
import {
  createAssistantMessage,
  createUsage,
  fakeStreamResult,
} from "./helpers/stream-mock.ts";

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("Agent", () => {
  it("should create an agent instance with default state", () => {
    const agent = new Agent();

    expect(agent.state).toBeDefined();
    expect(agent.state.systemPrompt).toBe("");
    expect(agent.state.model).toBeDefined();
    expect(agent.state.thinkingLevel).toBe("off");
    expect(agent.state.tools).toEqual([]);
    expect(agent.state.messages).toEqual([]);
    expect(agent.state.isStreaming).toBe(false);
    expect(agent.state.streamingMessage).toBe(undefined);
    expect(agent.state.pendingToolCalls).toEqual(new Set());
    expect(agent.state.errorMessage).toBeUndefined();
  });

  it("should create an agent instance with custom initial state", () => {
    const customModel = getModel("openai", "gpt-4o-mini");
    const agent = new Agent({
      initialState: {
        systemPrompt: "You are a helpful assistant.",
        model: customModel,
        thinkingLevel: "low",
      },
    });

    expect(agent.state.systemPrompt).toBe("You are a helpful assistant.");
    expect(agent.state.model).toBe(customModel);
    expect(agent.state.thinkingLevel).toBe("low");
  });

  it("should subscribe to events", () => {
    const agent = new Agent();

    let eventCount = 0;
    const unsubscribe = agent.subscribe((_event) => {
      eventCount++;
    });

    expect(eventCount).toBe(0);
    agent.state.systemPrompt = "Test prompt";
    expect(eventCount).toBe(0);
    expect(agent.state.systemPrompt).toBe("Test prompt");
    unsubscribe();
    agent.state.systemPrompt = "Another prompt";
    expect(eventCount).toBe(0);
  });

  it("emits full lifecycle events for thrown run failures", async () => {
    const agent = new Agent({
      streamFn: () => {
        throw new Error("provider exploded");
      },
    });
    const events: string[] = [];
    agent.subscribe((event) => {
      events.push(event.type);
    });

    await agent.prompt("hello");

    expect(events).toEqual([
      "agent_start",
      "turn_start",
      "message_start",
      "message_end",
      "message_start",
      "message_end",
      "turn_end",
      "agent_end",
    ]);
    const lastMessage = agent.state.messages[agent.state.messages.length - 1];
    expect(lastMessage?.role).toBe("assistant");
    if (lastMessage?.role !== "assistant") {
      throw new Error("Expected assistant message");
    }
    expect(lastMessage.stopReason).toBe("error");
    expect(lastMessage.errorMessage).toBe("provider exploded");
    expect(agent.state.errorMessage).toBe("provider exploded");
  });

  it("should await async subscribers before prompt resolves", async () => {
    const barrier = createDeferred();
    const streamFn: StreamFn = () =>
      Promise.resolve(
        fakeStreamResult({ content: [{ type: "text", text: "ok" }] })
      );
    const agent = new Agent({ streamFn });

    let listenerFinished = false;
    agent.subscribe(async (event) => {
      if (event.type === "agent_end") {
        await barrier.promise;
        listenerFinished = true;
      }
    });

    let promptResolved = false;
    const promptPromise = agent.prompt("hello").then(() => {
      promptResolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(promptResolved).toBe(false);
    expect(listenerFinished).toBe(false);
    expect(agent.state.isStreaming).toBe(true);

    barrier.resolve();
    await promptPromise;

    expect(listenerFinished).toBe(true);
    expect(promptResolved).toBe(true);
    expect(agent.state.isStreaming).toBe(false);
  });

  it("waitForIdle should wait for async subscribers", async () => {
    const barrier = createDeferred();
    const streamFn: StreamFn = () =>
      Promise.resolve(
        fakeStreamResult({ content: [{ type: "text", text: "ok" }] })
      );
    const agent = new Agent({ streamFn });

    agent.subscribe(async (event) => {
      if (event.type === "message_end" && event.message.role === "assistant") {
        await barrier.promise;
      }
    });

    const promptPromise = agent.prompt("hello");
    let idleResolved = false;
    const idlePromise = agent.waitForIdle().then(() => {
      idleResolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(idleResolved).toBe(false);
    expect(agent.state.isStreaming).toBe(true);

    barrier.resolve();
    await Promise.all([promptPromise, idlePromise]);

    expect(idleResolved).toBe(true);
    expect(agent.state.isStreaming).toBe(false);
  });

  it("should pass the active abort signal to subscribers", async () => {
    let receivedSignal: AbortSignal | undefined;
    const streamFn: StreamFn = (req) =>
      Promise.resolve({
        fullStream: (async function* () {
          while (!req.abortSignal?.aborted) {
            await new Promise((r) => setTimeout(r, 5));
          }
          yield { type: "error", error: new Error("Aborted") };
        })(),
        result: Promise.resolve({
          finishReason: "error" as const,
          usage: createUsage(),
        }),
      });
    const agent = new Agent({ streamFn });

    agent.subscribe((event, signal) => {
      if (event.type === "agent_start") {
        receivedSignal = signal;
      }
    });

    const promptPromise = agent.prompt("hello");
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(receivedSignal).toBeDefined();
    expect(receivedSignal?.aborted).toBe(false);

    agent.abort();
    await promptPromise;

    expect(receivedSignal?.aborted).toBe(true);
  });

  it("should ignore tool updates after the tool execution settles", async () => {
    const toolSchema = Type.Object({});
    let delayedUpdate: AgentToolUpdateCallback<{ status: string }> | undefined;
    const events: AgentEvent[] = [];
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (error: unknown) => {
      unhandledRejections.push(error);
    };
    const tool: AgentTool<typeof toolSchema, { status: string }> = {
      name: "delayed_tool",
      label: "Delayed Tool",
      description: "Captures progress callbacks",
      parameters: toolSchema,
      async execute(_toolCallId, _params, _signal, onUpdate) {
        delayedUpdate = onUpdate;
        onUpdate?.({
          content: [{ type: "text", text: "running" }],
          details: { status: "running" },
        });
        return {
          content: [{ type: "text", text: "ok" }],
          details: { status: "done" },
          terminate: true,
        };
      },
    };
    const streamFn: StreamFn = () =>
      Promise.resolve(
        fakeStreamResult({
          content: [
            {
              type: "toolCall",
              id: "call-1",
              name: "delayed_tool",
              arguments: {},
            },
          ],
          finishReason: "toolUse",
        })
      );
    const agent = new Agent({
      initialState: { tools: [tool] },
      streamFn,
    });
    agent.subscribe((event) => {
      events.push(event);
    });

    process.on("unhandledRejection", onUnhandledRejection);
    try {
      await agent.prompt("run tool");
      const eventCountAfterPrompt = events.length;

      delayedUpdate?.({
        content: [{ type: "text", text: "late" }],
        details: { status: "late" },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(
        events.filter((event) => event.type === "tool_execution_update")
      ).toHaveLength(1);
      expect(events).toHaveLength(eventCountAfterPrompt);
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });

  it("should ignore a settled parallel tool update while another tool is still running", async () => {
    const toolSchema = Type.Object({});
    const slowStarted = createDeferred();
    const settledToolEnded = createDeferred();
    const releaseSlow = createDeferred();
    let settledToolUpdate:
      | AgentToolUpdateCallback<{ status: string }>
      | undefined;
    const events: AgentEvent[] = [];
    const settledTool: AgentTool<typeof toolSchema, { status: string }> = {
      name: "settled_tool",
      label: "Settled Tool",
      description: "Captures progress callbacks",
      parameters: toolSchema,
      async execute(_toolCallId, _params, _signal, onUpdate) {
        settledToolUpdate = onUpdate;
        return {
          content: [{ type: "text", text: "done" }],
          details: { status: "done" },
          terminate: true,
        };
      },
    };
    const slowTool: AgentTool<typeof toolSchema, { status: string }> = {
      name: "slow_tool",
      label: "Slow Tool",
      description: "Keeps the agent run active",
      parameters: toolSchema,
      async execute() {
        slowStarted.resolve();
        await releaseSlow.promise;
        return {
          content: [{ type: "text", text: "done" }],
          details: { status: "done" },
          terminate: true,
        };
      },
    };
    const streamFn: StreamFn = () =>
      Promise.resolve(
        fakeStreamResult({
          content: [
            {
              type: "toolCall",
              id: "call-1",
              name: "settled_tool",
              arguments: {},
            },
            {
              type: "toolCall",
              id: "call-2",
              name: "slow_tool",
              arguments: {},
            },
          ],
          finishReason: "toolUse",
        })
      );
    const agent = new Agent({
      initialState: { tools: [settledTool, slowTool] },
      streamFn,
    });
    agent.subscribe((event) => {
      events.push(event);
      if (
        event.type === "tool_execution_end" &&
        event.toolCallId === "call-1"
      ) {
        settledToolEnded.resolve();
      }
    });

    const promptPromise = agent.prompt("run tools");
    await Promise.all([slowStarted.promise, settledToolEnded.promise]);
    const eventCountBeforeLateUpdate = events.length;

    settledToolUpdate?.({
      content: [{ type: "text", text: "late" }],
      details: { status: "late" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toHaveLength(eventCountBeforeLateUpdate);

    releaseSlow.resolve();
    await promptPromise;
    expect(
      events.filter((event) => event.type === "tool_execution_update")
    ).toHaveLength(0);
  });

  it("should update state with mutators", () => {
    const agent = new Agent();

    agent.state.systemPrompt = "Custom prompt";
    expect(agent.state.systemPrompt).toBe("Custom prompt");

    const newModel = getModel("google", "gemini-2.5-flash");
    agent.state.model = newModel;
    expect(agent.state.model).toBe(newModel);

    agent.state.thinkingLevel = "high";
    expect(agent.state.thinkingLevel).toBe("high");

    const tools = [
      { name: "test", description: "test tool" } as unknown as AgentTool,
    ];
    agent.state.tools = tools;
    expect(agent.state.tools).toEqual(tools);
    expect(agent.state.tools).not.toBe(tools);

    const messages = [
      { role: "user" as const, content: "Hello", timestamp: Date.now() },
    ];
    agent.state.messages = messages;
    expect(agent.state.messages).toEqual(messages);
    expect(agent.state.messages).not.toBe(messages);

    const newMessage = {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "Hi" }],
    };
    agent.state.messages.push(newMessage as unknown as never);
    expect(agent.state.messages).toHaveLength(2);
    expect(agent.state.messages[1]).toBe(newMessage);

    agent.state.messages = [];
    expect(agent.state.messages).toEqual([]);
  });

  it("should support steering message queue", async () => {
    const agent = new Agent();

    const message = {
      role: "user" as const,
      content: "Steering message",
      timestamp: Date.now(),
    };
    agent.steer(message);

    expect(agent.state.messages).not.toContainEqual(message);
  });

  it("should support follow-up message queue", async () => {
    const agent = new Agent();

    const message = {
      role: "user" as const,
      content: "Follow-up message",
      timestamp: Date.now(),
    };
    agent.followUp(message);

    expect(agent.state.messages).not.toContainEqual(message);
  });

  it("should handle abort controller", () => {
    const agent = new Agent();
    expect(() => agent.abort()).not.toThrow();
  });

  it("should throw when prompt() called while streaming", async () => {
    const streamFn: StreamFn = (req) =>
      Promise.resolve({
        fullStream: (async function* () {
          while (!req.abortSignal?.aborted) {
            await new Promise((r) => setTimeout(r, 5));
          }
          yield { type: "error", error: new Error("Aborted") };
        })(),
        result: Promise.resolve({
          finishReason: "error" as const,
          usage: createUsage(),
        }),
      });
    const agent = new Agent({ streamFn });

    const firstPrompt = agent.prompt("First message");

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(agent.state.isStreaming).toBe(true);

    await expect(agent.prompt("Second message")).rejects.toThrow(
      "Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion."
    );

    agent.abort();
    await firstPrompt.catch(() => {});
  });

  it("should throw when continue() called while streaming", async () => {
    const streamFn: StreamFn = (req) =>
      Promise.resolve({
        fullStream: (async function* () {
          while (!req.abortSignal?.aborted) {
            await new Promise((r) => setTimeout(r, 5));
          }
          yield { type: "error", error: new Error("Aborted") };
        })(),
        result: Promise.resolve({
          finishReason: "error" as const,
          usage: createUsage(),
        }),
      });
    const agent = new Agent({ streamFn });

    const firstPrompt = agent.prompt("First message");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(agent.state.isStreaming).toBe(true);

    await expect(agent.continue()).rejects.toThrow(
      "Agent is already processing. Wait for completion before continuing."
    );

    agent.abort();
    await firstPrompt.catch(() => {});
  });

  it("continue() should process queued follow-up messages after an assistant turn", async () => {
    const streamFn: StreamFn = () =>
      Promise.resolve(
        fakeStreamResult({ content: [{ type: "text", text: "Processed" }] })
      );
    const agent = new Agent({ streamFn });

    agent.state.messages = [
      {
        role: "user",
        content: [{ type: "text", text: "Initial" }],
        timestamp: Date.now() - 10,
      } as never,
      createAssistantMessage("Initial response"),
    ];

    agent.followUp({
      role: "user",
      content: [{ type: "text", text: "Queued follow-up" }],
      timestamp: Date.now(),
    });

    await expect(agent.continue()).resolves.toBeUndefined();

    const hasQueuedFollowUp = agent.state.messages.some((message) => {
      if (message.role !== "user") {
        return false;
      }
      if (typeof message.content === "string") {
        return message.content === "Queued follow-up";
      }
      return message.content.some(
        (part) => part.type === "text" && part.text === "Queued follow-up"
      );
    });

    expect(hasQueuedFollowUp).toBe(true);
    expect(agent.state.messages[agent.state.messages.length - 1]!.role).toBe(
      "assistant"
    );
  });

  it("continue() should keep one-at-a-time steering semantics from assistant tail", async () => {
    let responseCount = 0;
    const streamFn: StreamFn = () => {
      responseCount++;
      return Promise.resolve(
        fakeStreamResult({
          content: [{ type: "text", text: `Processed ${responseCount}` }],
        })
      );
    };
    const agent = new Agent({ streamFn });

    agent.state.messages = [
      {
        role: "user",
        content: [{ type: "text", text: "Initial" }],
        timestamp: Date.now() - 10,
      } as never,
      createAssistantMessage("Initial response"),
    ];

    agent.steer({
      role: "user",
      content: [{ type: "text", text: "Steering 1" }],
      timestamp: Date.now(),
    });
    agent.steer({
      role: "user",
      content: [{ type: "text", text: "Steering 2" }],
      timestamp: Date.now() + 1,
    });

    await expect(agent.continue()).resolves.toBeUndefined();

    const recentMessages = agent.state.messages.slice(-4);
    expect(recentMessages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(responseCount).toBe(2);
  });

  it("forwards sessionId to streamFn request", async () => {
    let receivedSessionId: string | undefined;
    const streamFn: StreamFn = (req) => {
      receivedSessionId = req.sessionId;
      return Promise.resolve(
        fakeStreamResult({ content: [{ type: "text", text: "ok" }] })
      );
    };
    const agent = new Agent({ sessionId: "session-abc", streamFn });

    await agent.prompt("hello");
    expect(receivedSessionId).toBe("session-abc");

    agent.sessionId = "session-def";
    expect(agent.sessionId).toBe("session-def");

    await agent.prompt("hello again");
    expect(receivedSessionId).toBe("session-def");
  });
});
