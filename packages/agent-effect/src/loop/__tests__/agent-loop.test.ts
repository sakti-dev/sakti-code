import type {
  AssistantMessage,
  FinishResult,
  Model,
  StreamRequest,
  StreamResult,
  Usage,
} from "@sakti-code/llm";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  StreamFn,
} from "../../types.ts";
import { agentLoop, agentLoopContinue } from "../agent-loop.ts";

// ─── test helpers ────────────────────────────────────────────────────────────

function createUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function createModel(): Model {
  return {
    id: "mock",
    name: "mock",
    api: "ai-sdk",
    provider: "openai",
    baseUrl: "",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 2048,
  };
}

function createAssistantMessage(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop"
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "ai-sdk",
    provider: "openai",
    model: "mock",
    usage: createUsage(),
    stopReason,
    timestamp: Date.now(),
  };
}

function createUserMessage(text: string): AgentMessage {
  return {
    role: "user",
    content: text,
    timestamp: Date.now(),
  };
}

/**
 * Build a fake StreamResult from content blocks + finish metadata.
 * Converts content to @ai-sdk fullStream parts (text-delta, reasoning-delta, tool-call).
 */
function fakeStreamResult(opts: {
  content?: AssistantMessage["content"];
  error?: Error;
  finishReason?: AssistantMessage["stopReason"];
}): StreamResult {
  const content = opts.content ?? [];
  const parts: Record<string, unknown>[] = [];

  for (const block of content) {
    switch (block.type) {
      case "text":
        parts.push({ type: "text-delta", id: "t1", text: block.text });
        break;
      case "thinking":
        parts.push({ type: "reasoning-delta", id: "r1", text: block.thinking });
        break;
      case "toolCall":
        parts.push({
          type: "tool-call",
          toolCallId: block.id,
          toolName: block.name,
          input: block.arguments,
        });
        break;
    }
  }
  if (opts.error) {
    parts.push({ type: "error", error: opts.error });
  }

  const finish: FinishResult = {
    finishReason: opts.error ? "error" : (opts.finishReason ?? "stop"),
    usage: createUsage(),
  };

  return {
    fullStream: (async function* () {
      for (const p of parts) {
        yield p;
      }
    })(),
    result: Promise.resolve(finish),
  };
}

/** Build a StreamFn that returns successive fake results per call. */
function makeStreamFn(
  ...results: Array<{
    content?: AssistantMessage["content"];
    error?: Error;
    finishReason?: AssistantMessage["stopReason"];
  }>
): { fn: StreamFn; callCount: () => number } {
  let i = 0;
  return {
    fn: () => {
      const result = results[i] ?? results[results.length - 1]!;
      i++;
      return Promise.resolve(fakeStreamResult(result));
    },
    callCount: () => i,
  };
}

/** Build a StreamFn that can also inspect the request. */
function makeStreamFnWithReq(
  handler: (
    req: StreamRequest,
    callIndex: number
  ) => {
    content?: AssistantMessage["content"];
    error?: Error;
    finishReason?: AssistantMessage["stopReason"];
  }
): { fn: StreamFn; callCount: () => number } {
  let i = 0;
  return {
    fn: (req: StreamRequest) => {
      const spec = handler(req, i);
      i++;
      return Promise.resolve(fakeStreamResult(spec));
    },
    callCount: () => i,
  };
}

/** Simple identity converter for tests — passes through standard messages. */
function identityConverter(messages: AgentMessage[]) {
  return messages.filter(
    (m) =>
      m.role === "user" || m.role === "assistant" || m.role === "toolResult"
  );
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("agentLoop with AgentMessage", () => {
  it("should emit events with AgentMessage types", async () => {
    const context: AgentContext = {
      systemPrompt: "You are helpful.",
      messages: [],
      tools: [],
    };

    const userPrompt: AgentMessage = createUserMessage("Hello");

    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
    };

    const { fn: streamFn } = makeStreamFn({
      content: [{ type: "text", text: "Hi there!" }],
    });

    const events: AgentEvent[] = [];
    const stream = agentLoop(
      [userPrompt],
      context,
      config,
      undefined,
      streamFn
    );

    for await (const event of stream) {
      events.push(event);
    }

    const messages = await stream.result();

    expect(messages.length).toBe(2);
    expect(messages[0]!.role).toBe("user");
    expect(messages[1]!.role).toBe("assistant");

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("agent_start");
    expect(eventTypes).toContain("turn_start");
    expect(eventTypes).toContain("message_start");
    expect(eventTypes).toContain("message_end");
    expect(eventTypes).toContain("turn_end");
    expect(eventTypes).toContain("agent_end");
  });

  it("captures thinkingSignature from reasoning-end providerMetadata (B4)", async () => {
    // @ai-sdk emits the Anthropic encrypted thinking signature on the
    // reasoning-end part's providerMetadata.anthropic.signature. The loop must
    // capture it so multi-turn extended-thinking continuity works (and so the
    // messages-layer sameModel guard has something to gate).
    const streamFn: StreamFn = () =>
      Promise.resolve({
        fullStream: (async function* () {
          yield { type: "reasoning-delta", id: "r1", text: "thinking…" };
          yield {
            type: "reasoning-end",
            id: "r1",
            providerMetadata: { anthropic: { signature: "sig-abc-123" } },
          };
          yield { type: "text-delta", id: "t1", text: "answer" };
        })(),
        result: Promise.resolve({
          finishReason: "stop" as const,
          usage: createUsage(),
        }),
      });

    const context: AgentContext = {
      systemPrompt: "x",
      messages: [],
      tools: [],
    };
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
    };

    const stream = agentLoop(
      [createUserMessage("Hi")],
      context,
      config,
      undefined,
      streamFn
    );
    for await (const _event of stream) {
      void _event;
    }
    const messages = await stream.result();
    const assistant = messages[1] as AssistantMessage;
    const thinking = assistant.content.find(
      (c: AssistantMessage["content"][number]) => c.type === "thinking"
    );
    expect(thinking).toBeDefined();
    expect((thinking as { thinkingSignature?: string }).thinkingSignature).toBe(
      "sig-abc-123"
    );
  });

  it("forces toolChoice='none' on the last step when maxSteps is set (M1)", async () => {
    const captured: (string | undefined)[] = [];
    const streamFn = makeStreamFnWithReq((req, callIndex) => {
      captured.push(
        "toolChoice" in req ? (req.toolChoice as string | undefined) : undefined
      );
      // First call emits a tool call (so a step 2 would normally follow);
      // later calls emit text so the loop terminates even in the RED state.
      // With maxSteps=1 the first call is the last and must forbid tools.
      return callIndex === 0
        ? {
            content: [
              { type: "toolCall", id: "tc1", name: "noop", arguments: {} },
            ],
            finishReason: "toolUse",
          }
        : { content: [{ type: "text", text: "done" }] };
    });

    const context: AgentContext = {
      systemPrompt: "x",
      messages: [],
      tools: [],
    };
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      maxSteps: 1,
    };

    const stream = agentLoop(
      [createUserMessage("Hi")],
      context,
      config,
      undefined,
      streamFn.fn
    );
    for await (const _event of stream) {
      void _event;
    }
    await stream.result();

    // The single allowed step must forbid tool calls.
    expect(captured[0]).toBe("none");
  });

  it("does not set toolChoice when maxSteps is unset", async () => {
    const captured: (string | undefined)[] = [];
    const streamFn = makeStreamFnWithReq((req) => {
      captured.push(
        "toolChoice" in req ? (req.toolChoice as string | undefined) : undefined
      );
      return { content: [{ type: "text", text: "hi" }] };
    });

    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
    };
    const stream = agentLoop(
      [createUserMessage("Hi")],
      { systemPrompt: "x", messages: [], tools: [] },
      config,
      undefined,
      streamFn.fn
    );
    for await (const _event of stream) {
      void _event;
    }
    await stream.result();
    expect(captured[0]).toBeUndefined();
  });

  it("should handle custom message types via convertToLlm", async () => {
    interface CustomNotification {
      role: "notification";
      text: string;
      timestamp: number;
    }

    const notification: CustomNotification = {
      role: "notification",
      text: "This is a notification",
      timestamp: Date.now(),
    };

    const context: AgentContext = {
      systemPrompt: "You are helpful.",
      messages: [notification as unknown as AgentMessage],
      tools: [],
    };

    const userPrompt: AgentMessage = createUserMessage("Hello");

    let convertedMessages: unknown[] = [];
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: (messages) => {
        convertedMessages = messages.filter(
          (m) => (m as { role: string }).role !== "notification"
        );
        return convertedMessages.filter(
          (m) =>
            (m as { role: string }).role === "user" ||
            (m as { role: string }).role === "assistant" ||
            (m as { role: string }).role === "toolResult"
        ) as unknown as ReturnType<typeof identityConverter>;
      },
    };

    const { fn: streamFn } = makeStreamFn({
      content: [{ type: "text", text: "Response" }],
    });

    const stream = agentLoop(
      [userPrompt],
      context,
      config,
      undefined,
      streamFn
    );

    for await (const _ of stream) {
      // consume
    }

    expect(convertedMessages.length).toBe(1);
    expect((convertedMessages[0] as { role: string }).role).toBe("user");
  });

  it("should apply transformContext before convertToLlm", async () => {
    const context: AgentContext = {
      systemPrompt: "You are helpful.",
      messages: [
        createUserMessage("old message 1"),
        createAssistantMessage([{ type: "text", text: "old response 1" }]),
        createUserMessage("old message 2"),
        createAssistantMessage([{ type: "text", text: "old response 2" }]),
      ],
      tools: [],
    };

    const userPrompt: AgentMessage = createUserMessage("new message");

    let transformedMessages: AgentMessage[] = [];

    const config: AgentLoopConfig = {
      model: createModel(),
      transformContext: async (messages) => {
        transformedMessages = messages.slice(-2);
        return transformedMessages;
      },
      convertToLlm: identityConverter,
    };

    const { fn: streamFn } = makeStreamFn({
      content: [{ type: "text", text: "Response" }],
    });

    const stream = agentLoop(
      [userPrompt],
      context,
      config,
      undefined,
      streamFn
    );

    for await (const _ of stream) {
      // consume
    }

    expect(transformedMessages.length).toBe(2);
  });

  it("should handle tool calls and results", async () => {
    const toolSchema = Type.Object({ value: Type.String() });
    const executed: string[] = [];
    const tool: AgentTool<typeof toolSchema, { value: string }> = {
      name: "echo",
      label: "Echo",
      description: "Echo tool",
      parameters: toolSchema,
      async execute(_toolCallId, params) {
        executed.push(params.value);
        return {
          content: [{ type: "text", text: `echoed: ${params.value}` }],
          details: { value: params.value },
        };
      },
    };

    const context: AgentContext = {
      systemPrompt: "",
      messages: [],
      tools: [tool],
    };

    const userPrompt: AgentMessage = createUserMessage("echo something");

    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
    };

    const { fn: streamFn } = makeStreamFn(
      {
        content: [
          {
            type: "toolCall",
            id: "tool-1",
            name: "echo",
            arguments: { value: "hello" },
          },
        ],
        finishReason: "toolUse",
      },
      { content: [{ type: "text", text: "done" }] }
    );

    const events: AgentEvent[] = [];
    const stream = agentLoop(
      [userPrompt],
      context,
      config,
      undefined,
      streamFn
    );

    for await (const event of stream) {
      events.push(event);
    }

    expect(executed).toEqual(["hello"]);

    const toolStart = events.find((e) => e.type === "tool_execution_start");
    const toolEnd = events.find((e) => e.type === "tool_execution_end");
    expect(toolStart).toBeDefined();
    expect(toolEnd).toBeDefined();
    if (toolEnd?.type === "tool_execution_end") {
      expect(toolEnd.isError).toBe(false);
    }
  });

  it("should execute mutated beforeToolCall args without revalidation", async () => {
    const toolSchema = Type.Object({ value: Type.String() });
    const executed: Array<string | number> = [];
    const tool: AgentTool<typeof toolSchema, { value: string | number }> = {
      name: "echo",
      label: "Echo",
      description: "Echo tool",
      parameters: toolSchema,
      async execute(_toolCallId, params) {
        executed.push(params.value as string | number);
        return {
          content: [{ type: "text", text: `echoed: ${String(params.value)}` }],
          details: { value: params.value as string | number },
        };
      },
    };

    const context: AgentContext = {
      systemPrompt: "",
      messages: [],
      tools: [tool],
    };

    const userPrompt: AgentMessage = createUserMessage("echo something");

    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      beforeToolCall: async ({ args }) => {
        const mutableArgs = args as { value: string | number };
        mutableArgs.value = 123;
        return;
      },
    };

    const { fn: streamFn } = makeStreamFn(
      {
        content: [
          {
            type: "toolCall",
            id: "tool-1",
            name: "echo",
            arguments: { value: "hello" },
          },
        ],
        finishReason: "toolUse",
      },
      { content: [{ type: "text", text: "done" }] }
    );

    const stream = agentLoop(
      [userPrompt],
      context,
      config,
      undefined,
      streamFn
    );
    for await (const _event of stream) {
      // consume
    }

    expect(executed).toEqual([123]);
  });

  it("blocks a tool call when evaluatePermission denies it", async () => {
    const toolSchema = Type.Object({ path: Type.String() });
    const executed: string[] = [];
    const tool: AgentTool<typeof toolSchema, undefined> = {
      name: "read",
      label: "Read",
      description: "Read",
      parameters: toolSchema,
      async execute(_toolCallId, params) {
        executed.push(params.path);
        return {
          content: [{ type: "text", text: "ok" }],
          details: undefined,
        };
      },
      permissions: (params) => [
        { permission: "read", patterns: [(params as { path: string }).path] },
      ],
    };

    const context: AgentContext = {
      systemPrompt: "",
      messages: [],
      tools: [tool],
    };
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      evaluatePermission: (permission, pattern) =>
        permission === "read" && pattern.endsWith(".env") ? "deny" : "allow",
    };

    const { fn: streamFn } = makeStreamFn(
      {
        content: [
          {
            type: "toolCall",
            id: "tool-1",
            name: "read",
            arguments: { path: "secret.env" },
          },
        ],
        finishReason: "toolUse",
      },
      { content: [{ type: "text", text: "done" }] }
    );

    const events: AgentEvent[] = [];
    for await (const event of agentLoop(
      [createUserMessage("read it")],
      context,
      config,
      undefined,
      streamFn
    )) {
      events.push(event);
    }

    expect(executed).toEqual([]);
    const toolEnd = events.find((e) => e.type === "tool_execution_end");
    expect(toolEnd?.type === "tool_execution_end" && toolEnd.isError).toBe(
      true
    );
  });

  it("calls resolvePermissionAsk and proceeds when the ask is allowed", async () => {
    const toolSchema = Type.Object({ path: Type.String() });
    const asked: string[] = [];
    const executed: string[] = [];
    const tool: AgentTool<typeof toolSchema, undefined> = {
      name: "read",
      label: "Read",
      description: "Read",
      parameters: toolSchema,
      async execute(_toolCallId, params) {
        executed.push(params.path);
        return {
          content: [{ type: "text", text: "ok" }],
          details: undefined,
        };
      },
      permissions: (params) => [
        { permission: "read", patterns: [(params as { path: string }).path] },
      ],
    };

    const context: AgentContext = {
      systemPrompt: "",
      messages: [],
      tools: [tool],
    };
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      sessionId: "sess-1",
      evaluatePermission: () => "ask",
      resolvePermissionAsk: async (req) => {
        asked.push(
          `${req.sessionId}:${req.permission}:${req.patterns.join(",")}`
        );
        return "allow";
      },
    };

    const { fn: streamFn } = makeStreamFn(
      {
        content: [
          {
            type: "toolCall",
            id: "tool-1",
            name: "read",
            arguments: { path: "secret.env" },
          },
        ],
        finishReason: "toolUse",
      },
      { content: [{ type: "text", text: "done" }] }
    );

    const events: AgentEvent[] = [];
    for await (const event of agentLoop(
      [createUserMessage("read it")],
      context,
      config,
      undefined,
      streamFn
    )) {
      events.push(event);
    }

    expect(asked).toEqual(["sess-1:read:secret.env"]);
    expect(executed).toEqual(["secret.env"]);
  });

  it("calls resolvePermissionAsk and blocks when the ask is denied", async () => {
    const toolSchema = Type.Object({ path: Type.String() });
    const executed: string[] = [];
    const tool: AgentTool<typeof toolSchema, undefined> = {
      name: "read",
      label: "Read",
      description: "Read",
      parameters: toolSchema,
      async execute(_toolCallId, params) {
        executed.push(params.path);
        return {
          content: [{ type: "text", text: "ok" }],
          details: undefined,
        };
      },
      permissions: (params) => [
        { permission: "read", patterns: [(params as { path: string }).path] },
      ],
    };

    const context: AgentContext = {
      systemPrompt: "",
      messages: [],
      tools: [tool],
    };
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      evaluatePermission: () => "ask",
      resolvePermissionAsk: async () => "deny",
    };

    const { fn: streamFn } = makeStreamFn(
      {
        content: [
          {
            type: "toolCall",
            id: "tool-1",
            name: "read",
            arguments: { path: "secret.env" },
          },
        ],
        finishReason: "toolUse",
      },
      { content: [{ type: "text", text: "done" }] }
    );

    const events: AgentEvent[] = [];
    for await (const event of agentLoop(
      [createUserMessage("read it")],
      context,
      config,
      undefined,
      streamFn
    )) {
      events.push(event);
    }

    expect(executed).toEqual([]);
    const toolEnd = events.find((e) => e.type === "tool_execution_end");
    expect(toolEnd?.type === "tool_execution_end" && toolEnd.isError).toBe(
      true
    );
  });

  it("treats ask as deny when no resolvePermissionAsk is configured", async () => {
    const toolSchema = Type.Object({ path: Type.String() });
    const executed: string[] = [];
    const tool: AgentTool<typeof toolSchema, undefined> = {
      name: "read",
      label: "Read",
      description: "Read",
      parameters: toolSchema,
      async execute(_toolCallId, params) {
        executed.push(params.path);
        return {
          content: [{ type: "text", text: "ok" }],
          details: undefined,
        };
      },
      permissions: (params) => [
        { permission: "read", patterns: [(params as { path: string }).path] },
      ],
    };

    const context: AgentContext = {
      systemPrompt: "",
      messages: [],
      tools: [tool],
    };
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      evaluatePermission: () => "ask",
    };

    const { fn: streamFn } = makeStreamFn(
      {
        content: [
          {
            type: "toolCall",
            id: "tool-1",
            name: "read",
            arguments: { path: "secret.env" },
          },
        ],
        finishReason: "toolUse",
      },
      { content: [{ type: "text", text: "done" }] }
    );

    const events: AgentEvent[] = [];
    for await (const event of agentLoop(
      [createUserMessage("read it")],
      context,
      config,
      undefined,
      streamFn
    )) {
      events.push(event);
    }

    expect(executed).toEqual([]);
    const toolEnd = events.find((e) => e.type === "tool_execution_end");
    expect(toolEnd?.type === "tool_execution_end" && toolEnd.isError).toBe(
      true
    );
  });

  it("should prepare tool arguments for validation", async () => {
    const replaceSchema = Type.Object({
      oldText: Type.String(),
      newText: Type.String(),
    });
    const toolSchema = Type.Object({ edits: Type.Array(replaceSchema) });
    const executed: Array<Array<{ oldText: string; newText: string }>> = [];
    const tool: AgentTool<typeof toolSchema, { count: number }> = {
      name: "edit",
      label: "Edit",
      description: "Edit tool",
      parameters: toolSchema,
      prepareArguments(args) {
        if (!args || typeof args !== "object") {
          return args as { edits: { oldText: string; newText: string }[] };
        }
        const input = args as {
          edits?: Array<{ oldText: string; newText: string }>;
          oldText?: string;
          newText?: string;
        };
        if (
          typeof input.oldText !== "string" ||
          typeof input.newText !== "string"
        ) {
          return args as { edits: { oldText: string; newText: string }[] };
        }
        return {
          edits: [
            ...(input.edits ?? []),
            { oldText: input.oldText, newText: input.newText },
          ],
        };
      },
      async execute(_toolCallId, params) {
        executed.push(params.edits);
        return {
          content: [{ type: "text", text: `edited ${params.edits.length}` }],
          details: { count: params.edits.length },
        };
      },
    };

    const context: AgentContext = {
      systemPrompt: "",
      messages: [],
      tools: [tool],
    };

    const userPrompt: AgentMessage = createUserMessage("edit something");
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
    };

    const { fn: streamFn } = makeStreamFn(
      {
        content: [
          {
            type: "toolCall",
            id: "tool-1",
            name: "edit",
            arguments: { oldText: "before", newText: "after" },
          },
        ],
        finishReason: "toolUse",
      },
      { content: [{ type: "text", text: "done" }] }
    );

    const stream = agentLoop(
      [userPrompt],
      context,
      config,
      undefined,
      streamFn
    );
    for await (const _event of stream) {
      // consume
    }

    expect(executed).toEqual([[{ oldText: "before", newText: "after" }]]);
  });

  it("should emit tool_execution_end in completion order but persist tool results in source order", async () => {
    const toolSchema = Type.Object({ value: Type.String() });
    let firstResolved = false;
    let parallelObserved = false;
    let releaseFirst: (() => void) | undefined;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const tool: AgentTool<typeof toolSchema, { value: string }> = {
      name: "echo",
      label: "Echo",
      description: "Echo tool",
      parameters: toolSchema,
      async execute(_toolCallId, params) {
        if (params.value === "first") {
          await firstDone;
          firstResolved = true;
        }
        if (params.value === "second" && !firstResolved) {
          parallelObserved = true;
        }
        return {
          content: [{ type: "text", text: `echoed: ${params.value}` }],
          details: { value: params.value },
        };
      },
    };

    const context: AgentContext = {
      systemPrompt: "",
      messages: [],
      tools: [tool],
    };

    const userPrompt: AgentMessage = createUserMessage("echo both");
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      toolExecution: "parallel",
    };

    const { fn: streamFn, callCount } = makeStreamFn(
      {
        content: [
          {
            type: "toolCall",
            id: "tool-1",
            name: "echo",
            arguments: { value: "first" },
          },
          {
            type: "toolCall",
            id: "tool-2",
            name: "echo",
            arguments: { value: "second" },
          },
        ],
        finishReason: "toolUse",
      },
      { content: [{ type: "text", text: "done" }] }
    );

    // Release first tool after stream starts
    setTimeout(() => releaseFirst?.(), 20);

    const stream = agentLoop(
      [userPrompt],
      context,
      config,
      undefined,
      streamFn
    );

    const events: AgentEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    const toolExecutionEndIds = events.flatMap((event) => {
      if (event.type !== "tool_execution_end") return [];
      return [event.toolCallId];
    });
    const toolResultIds = events.flatMap((event) => {
      if (event.type !== "message_end" || event.message.role !== "toolResult")
        return [];
      return [event.message.toolCallId];
    });
    const turnToolResultIds = events.flatMap((event) => {
      if (event.type !== "turn_end") return [];
      return event.toolResults.map((toolResult) => toolResult.toolCallId);
    });

    expect(parallelObserved).toBe(true);
    expect(toolExecutionEndIds).toEqual(["tool-2", "tool-1"]);
    expect(toolResultIds).toEqual(["tool-1", "tool-2"]);
    expect(turnToolResultIds).toEqual(["tool-1", "tool-2"]);
    expect(callCount()).toBe(2);
  });

  it("should inject queued messages after all tool calls complete", async () => {
    const toolSchema = Type.Object({ value: Type.String() });
    const executed: string[] = [];
    const tool: AgentTool<typeof toolSchema, { value: string }> = {
      name: "echo",
      label: "Echo",
      description: "Echo tool",
      parameters: toolSchema,
      async execute(_toolCallId, params) {
        executed.push(params.value);
        return {
          content: [{ type: "text", text: `ok:${params.value}` }],
          details: { value: params.value },
        };
      },
    };

    const context: AgentContext = {
      systemPrompt: "",
      messages: [],
      tools: [tool],
    };

    const userPrompt: AgentMessage = createUserMessage("start");
    const queuedUserMessage: AgentMessage = createUserMessage("interrupt");

    let queuedDelivered = false;
    let sawInterruptInContext = false;

    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      toolExecution: "sequential",
      getSteeringMessages: async () => {
        if (executed.length >= 1 && !queuedDelivered) {
          queuedDelivered = true;
          return [queuedUserMessage];
        }
        return [];
      },
    };

    const { fn: streamFn } = makeStreamFnWithReq((req, callIndex) => {
      if (callIndex === 1) {
        sawInterruptInContext = req.messages.some(
          (m) =>
            m.role === "user" &&
            typeof m.content === "string" &&
            m.content === "interrupt"
        );
      }
      if (callIndex === 0) {
        return {
          content: [
            {
              type: "toolCall",
              id: "tool-1",
              name: "echo",
              arguments: { value: "first" },
            },
            {
              type: "toolCall",
              id: "tool-2",
              name: "echo",
              arguments: { value: "second" },
            },
          ],
          finishReason: "toolUse",
        };
      }
      return { content: [{ type: "text", text: "done" }] };
    });

    const events: AgentEvent[] = [];
    const stream = agentLoop(
      [userPrompt],
      context,
      config,
      undefined,
      streamFn
    );

    for await (const event of stream) {
      events.push(event);
    }

    expect(executed).toEqual(["first", "second"]);

    const toolEnds = events.filter(
      (e): e is Extract<AgentEvent, { type: "tool_execution_end" }> =>
        e.type === "tool_execution_end"
    );
    expect(toolEnds.length).toBe(2);
    expect(toolEnds[0]!.isError).toBe(false);
    expect(toolEnds[1]!.isError).toBe(false);

    const eventSequence = events.flatMap((event) => {
      if (event.type !== "message_start") return [];
      if (event.message.role === "toolResult") {
        return [`tool:${event.message.toolCallId}`];
      }
      if (
        event.message.role === "user" &&
        typeof event.message.content === "string"
      ) {
        return [event.message.content];
      }
      return [];
    });
    expect(eventSequence).toContain("interrupt");
    expect(eventSequence.indexOf("tool:tool-1")).toBeLessThan(
      eventSequence.indexOf("interrupt")
    );
    expect(eventSequence.indexOf("tool:tool-2")).toBeLessThan(
      eventSequence.indexOf("interrupt")
    );

    expect(sawInterruptInContext).toBe(true);
  });

  it("should force sequential execution when a tool has executionMode=sequential even with default parallel config", async () => {
    const toolSchema = Type.Object({ value: Type.String() });
    let firstResolved = false;
    let parallelObserved = false;
    let releaseFirst: (() => void) | undefined;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const slowTool: AgentTool<typeof toolSchema, { value: string }> = {
      name: "slow",
      label: "Slow",
      description: "Slow tool",
      parameters: toolSchema,
      executionMode: "sequential",
      async execute(_toolCallId, params) {
        if (params.value === "first") {
          await firstDone;
          firstResolved = true;
        }
        if (params.value === "second" && !firstResolved) {
          parallelObserved = true;
        }
        return {
          content: [{ type: "text", text: `slow: ${params.value}` }],
          details: { value: params.value },
        };
      },
    };

    const context: AgentContext = {
      systemPrompt: "",
      messages: [],
      tools: [slowTool],
    };

    const userPrompt: AgentMessage = createUserMessage("run both");
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
    };

    const { fn: streamFn } = makeStreamFn(
      {
        content: [
          {
            type: "toolCall",
            id: "tool-1",
            name: "slow",
            arguments: { value: "first" },
          },
          {
            type: "toolCall",
            id: "tool-2",
            name: "slow",
            arguments: { value: "second" },
          },
        ],
        finishReason: "toolUse",
      },
      { content: [{ type: "text", text: "done" }] }
    );

    setTimeout(() => releaseFirst?.(), 20);

    const stream = agentLoop(
      [userPrompt],
      context,
      config,
      undefined,
      streamFn
    );

    const events: AgentEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(parallelObserved).toBe(false);

    const toolResultIds = events.flatMap((event) => {
      if (event.type !== "message_end" || event.message.role !== "toolResult")
        return [];
      return [event.message.toolCallId];
    });
    expect(toolResultIds).toEqual(["tool-1", "tool-2"]);
  });

  it("should force sequential execution when one of multiple tools has executionMode=sequential", async () => {
    const toolSchema = Type.Object({ value: Type.String() });
    const executionOrder: string[] = [];
    let releaseSlow: (() => void) | undefined;
    const slowDone = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    const slowTool: AgentTool<typeof toolSchema, { value: string }> = {
      name: "slow",
      label: "Slow",
      description: "Slow tool",
      parameters: toolSchema,
      executionMode: "sequential",
      async execute(_toolCallId, params) {
        executionOrder.push(`slow:${params.value}`);
        if (params.value === "a") {
          await slowDone;
        }
        return {
          content: [{ type: "text", text: `slow: ${params.value}` }],
          details: { value: params.value },
        };
      },
    };

    const fastTool: AgentTool<typeof toolSchema, { value: string }> = {
      name: "fast",
      label: "Fast",
      description: "Fast tool",
      parameters: toolSchema,
      async execute(_toolCallId, params) {
        executionOrder.push(`fast:${params.value}`);
        return {
          content: [{ type: "text", text: `fast: ${params.value}` }],
          details: { value: params.value },
        };
      },
    };

    const context: AgentContext = {
      systemPrompt: "",
      messages: [],
      tools: [slowTool, fastTool],
    };

    const userPrompt: AgentMessage = createUserMessage("run both");
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
    };

    const { fn: streamFn } = makeStreamFn(
      {
        content: [
          {
            type: "toolCall",
            id: "tool-1",
            name: "slow",
            arguments: { value: "a" },
          },
          {
            type: "toolCall",
            id: "tool-2",
            name: "fast",
            arguments: { value: "b" },
          },
        ],
        finishReason: "toolUse",
      },
      { content: [{ type: "text", text: "done" }] }
    );

    setTimeout(() => releaseSlow?.(), 20);

    const stream = agentLoop(
      [userPrompt],
      context,
      config,
      undefined,
      streamFn
    );

    const events: AgentEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(executionOrder[0]).toBe("slow:a");
    expect(executionOrder).toContain("fast:b");
  });

  it("should allow parallel execution when all tools have executionMode=parallel", async () => {
    const toolSchema = Type.Object({ value: Type.String() });
    let firstResolved = false;
    let parallelObserved = false;
    let releaseFirst: (() => void) | undefined;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const tool: AgentTool<typeof toolSchema, { value: string }> = {
      name: "echo",
      label: "Echo",
      description: "Echo tool",
      parameters: toolSchema,
      executionMode: "parallel",
      async execute(_toolCallId, params) {
        if (params.value === "first") {
          await firstDone;
          firstResolved = true;
        }
        if (params.value === "second" && !firstResolved) {
          parallelObserved = true;
        }
        return {
          content: [{ type: "text", text: `echoed: ${params.value}` }],
          details: { value: params.value },
        };
      },
    };

    const context: AgentContext = {
      systemPrompt: "",
      messages: [],
      tools: [tool],
    };

    const userPrompt: AgentMessage = createUserMessage("echo both");
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
    };

    const { fn: streamFn } = makeStreamFn(
      {
        content: [
          {
            type: "toolCall",
            id: "tool-1",
            name: "echo",
            arguments: { value: "first" },
          },
          {
            type: "toolCall",
            id: "tool-2",
            name: "echo",
            arguments: { value: "second" },
          },
        ],
        finishReason: "toolUse",
      },
      { content: [{ type: "text", text: "done" }] }
    );

    setTimeout(() => releaseFirst?.(), 20);

    const stream = agentLoop(
      [userPrompt],
      context,
      config,
      undefined,
      streamFn
    );

    const events: AgentEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(parallelObserved).toBe(true);
  });

  it("should use prepareNextTurn snapshot before continuing", async () => {
    const toolSchema = Type.Object({ value: Type.String() });
    const tool: AgentTool<typeof toolSchema, { value: string }> = {
      name: "echo",
      label: "Echo",
      description: "Echo tool",
      parameters: toolSchema,
      async execute(_toolCallId, params) {
        return {
          content: [{ type: "text", text: `echoed: ${params.value}` }],
          details: { value: params.value },
        };
      },
    };
    const context: AgentContext = {
      systemPrompt: "first prompt",
      messages: [],
      tools: [tool],
    };
    let convertedSecondTurnSystemPrompt = "";
    let prepared = false;
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      prepareNextTurn: async ({ context: currentContext }) => {
        if (prepared) {
          return;
        }
        prepared = true;
        return {
          context: {
            systemPrompt: "second prompt",
            messages: currentContext.messages.slice(),
            ...(currentContext.tools === undefined
              ? {}
              : { tools: currentContext.tools }),
          },
        };
      },
    };

    const { fn: streamFn } = makeStreamFnWithReq((req, callIndex) => {
      if (callIndex === 1) {
        convertedSecondTurnSystemPrompt = req.system ?? "";
      }
      if (callIndex === 0) {
        return {
          content: [
            {
              type: "toolCall",
              id: "tool-1",
              name: "echo",
              arguments: { value: "hello" },
            },
          ],
          finishReason: "toolUse",
        };
      }
      return { content: [{ type: "text", text: "done" }] };
    });

    const stream = agentLoop(
      [createUserMessage("echo something")],
      context,
      config,
      undefined,
      streamFn
    );

    for await (const _event of stream) {
      // consume
    }

    expect(convertedSecondTurnSystemPrompt).toBe("second prompt");
  });

  it("should stop after the current turn when shouldStopAfterTurn returns true", async () => {
    const toolSchema = Type.Object({ value: Type.String() });
    const executed: string[] = [];
    const tool: AgentTool<typeof toolSchema, { value: string }> = {
      name: "echo",
      label: "Echo",
      description: "Echo tool",
      parameters: toolSchema,
      async execute(_toolCallId, params) {
        executed.push(params.value);
        return {
          content: [{ type: "text", text: `echoed: ${params.value}` }],
          details: { value: params.value },
        };
      },
    };

    const context: AgentContext = {
      systemPrompt: "",
      messages: [],
      tools: [tool],
    };

    let steeringPolls = 0;
    let followUpPolls = 0;
    let callbackToolResultIds: string[] = [];
    let callbackContextRoles: string[] = [];
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      getSteeringMessages: async () => {
        steeringPolls++;
        return [];
      },
      getFollowUpMessages: async () => {
        followUpPolls++;
        return [createUserMessage("follow up should stay queued")];
      },
      shouldStopAfterTurn: async ({ message, toolResults, context }) => {
        expect(message.role).toBe("assistant");
        callbackToolResultIds = toolResults.map(
          (toolResult) => toolResult.toolCallId
        );
        callbackContextRoles = context.messages.map(
          (contextMessage) => contextMessage.role
        );
        return true;
      },
    };

    const { fn: streamFn, callCount } = makeStreamFn({
      content: [
        {
          type: "toolCall",
          id: "tool-1",
          name: "echo",
          arguments: { value: "hello" },
        },
      ],
      finishReason: "toolUse",
    });

    const stream = agentLoop(
      [createUserMessage("echo something")],
      context,
      config,
      undefined,
      streamFn
    );

    const events: AgentEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    const messages = await stream.result();
    expect(callCount()).toBe(1);
    expect(executed).toEqual(["hello"]);
    expect(steeringPolls).toBe(1);
    expect(followUpPolls).toBe(0);
    expect(callbackToolResultIds).toEqual(["tool-1"]);
    expect(callbackContextRoles).toEqual(["user", "assistant", "toolResult"]);
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "agent_start",
      "turn_start",
      "message_start",
      "message_end",
      "message_start",
      "message_end",
      "tool_execution_start",
      "tool_execution_end",
      "message_start",
      "message_end",
      "turn_end",
      "agent_end",
    ]);
  });

  it("should stop after a tool batch when every tool result sets terminate=true", async () => {
    const toolSchema = Type.Object({ value: Type.String() });
    const tool: AgentTool<typeof toolSchema, { value: string }> = {
      name: "echo",
      label: "Echo",
      description: "Echo tool",
      parameters: toolSchema,
      async execute(_toolCallId, params) {
        return {
          content: [{ type: "text", text: `echoed: ${params.value}` }],
          details: { value: params.value },
          terminate: true,
        };
      },
    };

    const context: AgentContext = {
      systemPrompt: "",
      messages: [],
      tools: [tool],
    };

    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
    };

    const { fn: streamFn, callCount } = makeStreamFn({
      content: [
        {
          type: "toolCall",
          id: "tool-1",
          name: "echo",
          arguments: { value: "hello" },
        },
      ],
      finishReason: "toolUse",
    });

    const stream = agentLoop(
      [createUserMessage("echo something")],
      context,
      config,
      undefined,
      streamFn
    );

    const events: AgentEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    const messages = await stream.result();
    expect(callCount()).toBe(1);
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
    ]);
    expect(events.filter((event) => event.type === "turn_end")).toHaveLength(1);
  });

  it("should continue after parallel tool calls when not all tool results terminate", async () => {
    const toolSchema = Type.Object({ value: Type.String() });
    const tool: AgentTool<typeof toolSchema, { value: string }> = {
      name: "echo",
      label: "Echo",
      description: "Echo tool",
      parameters: toolSchema,
      async execute(_toolCallId, params) {
        return {
          content: [{ type: "text", text: `echoed: ${params.value}` }],
          details: { value: params.value },
          terminate: params.value === "first",
        };
      },
    };

    const context: AgentContext = {
      systemPrompt: "",
      messages: [],
      tools: [tool],
    };

    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      toolExecution: "parallel",
    };

    const { fn: streamFn } = makeStreamFn(
      {
        content: [
          {
            type: "toolCall",
            id: "tool-1",
            name: "echo",
            arguments: { value: "first" },
          },
          {
            type: "toolCall",
            id: "tool-2",
            name: "echo",
            arguments: { value: "second" },
          },
        ],
        finishReason: "toolUse",
      },
      { content: [{ type: "text", text: "done" }] }
    );

    const stream = agentLoop(
      [createUserMessage("echo both")],
      context,
      config,
      undefined,
      streamFn
    );

    for await (const _event of stream) {
      // consume
    }

    const messages = await stream.result();
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "toolResult",
      "assistant",
    ]);
  });

  it("should allow afterToolCall to mark a tool batch as terminating", async () => {
    const toolSchema = Type.Object({ value: Type.String() });
    const tool: AgentTool<typeof toolSchema, { value: string }> = {
      name: "echo",
      label: "Echo",
      description: "Echo tool",
      parameters: toolSchema,
      async execute(_toolCallId, params) {
        return {
          content: [{ type: "text", text: `echoed: ${params.value}` }],
          details: { value: params.value },
        };
      },
    };

    const context: AgentContext = {
      systemPrompt: "",
      messages: [],
      tools: [tool],
    };

    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      afterToolCall: async () => ({ terminate: true }),
    };

    const { fn: streamFn, callCount } = makeStreamFn({
      content: [
        {
          type: "toolCall",
          id: "tool-1",
          name: "echo",
          arguments: { value: "hello" },
        },
      ],
      finishReason: "toolUse",
    });

    const stream = agentLoop(
      [createUserMessage("echo something")],
      context,
      config,
      undefined,
      streamFn
    );

    for await (const _event of stream) {
      // consume
    }

    expect(callCount()).toBe(1);
  });
});

describe("agentLoopContinue with AgentMessage", () => {
  it("should throw when context has no messages", () => {
    const context: AgentContext = {
      systemPrompt: "You are helpful.",
      messages: [],
      tools: [],
    };

    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
    };

    expect(() => agentLoopContinue(context, config)).toThrow(
      "Cannot continue: no messages in context"
    );
  });

  it("should continue from existing context without emitting user message events", async () => {
    const userMessage: AgentMessage = createUserMessage("Hello");

    const context: AgentContext = {
      systemPrompt: "You are helpful.",
      messages: [userMessage],
      tools: [],
    };

    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
    };

    const { fn: streamFn } = makeStreamFn({
      content: [{ type: "text", text: "Response" }],
    });

    const events: AgentEvent[] = [];
    const stream = agentLoopContinue(context, config, undefined, streamFn);

    for await (const event of stream) {
      events.push(event);
    }

    const messages = await stream.result();

    expect(messages.length).toBe(1);
    expect(messages[0]!.role).toBe("assistant");

    const messageEndEvents = events.filter((e) => e.type === "message_end");
    expect(messageEndEvents.length).toBe(1);
    expect(
      (messageEndEvents[0] as { message: { role: string } }).message.role
    ).toBe("assistant");
  });

  it("should allow custom message types as last message (caller responsibility)", async () => {
    interface CustomMessage {
      role: "custom";
      text: string;
      timestamp: number;
    }

    const customMessage: CustomMessage = {
      role: "custom",
      text: "Hook content",
      timestamp: Date.now(),
    };

    const context: AgentContext = {
      systemPrompt: "You are helpful.",
      messages: [customMessage as unknown as AgentMessage],
      tools: [],
    };

    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: (messages) =>
        messages
          .map((m) => {
            if ((m as { role: string }).role === "custom") {
              return {
                role: "user" as const,
                content: (m as unknown as { text: string }).text,
                timestamp: m.timestamp,
              };
            }
            return m;
          })
          .filter(
            (m) =>
              m.role === "user" ||
              m.role === "assistant" ||
              m.role === "toolResult"
          ) as unknown as ReturnType<typeof identityConverter>,
    };

    const { fn: streamFn } = makeStreamFn({
      content: [{ type: "text", text: "Response to custom message" }],
    });

    const stream = agentLoopContinue(context, config, undefined, streamFn);

    const events: AgentEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    const messages = await stream.result();
    expect(messages.length).toBe(1);
    expect(messages[0]!.role).toBe("assistant");
  });
});

describe("agentLoop maxOutputTokens", () => {
  it("passes model.maxTokens as maxOutputTokens to the stream function", async () => {
    const context: AgentContext = {
      systemPrompt: "You are helpful.",
      messages: [],
      tools: [],
    };

    const model = createModel();
    model.maxTokens = 8192;

    const config: AgentLoopConfig = {
      model,
      convertToLlm: identityConverter,
    };

    let capturedReq: StreamRequest | undefined;
    const { fn: streamFn } = makeStreamFnWithReq((req) => {
      capturedReq = req;
      return { content: [{ type: "text", text: "ok" }] };
    });

    const stream = agentLoop(
      [createUserMessage("Hello")],
      context,
      config,
      undefined,
      streamFn
    );
    for await (const _ of stream) {
      // drain
    }

    expect(capturedReq?.maxOutputTokens).toBe(8192);
  });

  it("terminates the stream with an error when the loop rejects (C1+C2)", async () => {
    // A streamFn that rejects simulates a catastrophic loop failure.
    // Previously, the consumer would hang forever because the fire-and-forget
    // .then() had no rejection handler and EventStream had no error() method.
    const boom = new Error("streamFn blew up");
    const streamFn: StreamFn = () => Promise.reject(boom);

    const context: AgentContext = {
      systemPrompt: "You are helpful.",
      messages: [],
      tools: [],
    };
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
    };

    const stream = agentLoop(
      [createUserMessage("Hello")],
      context,
      config,
      undefined,
      streamFn
    );

    // The consumer must see the error thrown, not hang.
    let thrown: unknown;
    try {
      for await (const _ of stream) {
        // drain
      }
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(boom);

    // result() must also reject with the same error.
    await expect(stream.result()).rejects.toBe(boom);
  });
});
