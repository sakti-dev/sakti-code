import { describe, expect, it } from "vitest";
import { toModelMessages } from "../messages.ts";
import type {
  AssistantMessage,
  ImageContent,
  Message,
  TextContent,
  ToolResultMessage,
  UserMessage,
} from "../types.ts";

// ─── helpers ─────────────────────────────────────────────────────────────────

function userText(text: string, timestamp = 0): UserMessage {
  return { content: text, role: "user", timestamp };
}

function userMulti(
  parts: (TextContent | ImageContent)[],
  timestamp = 0
): UserMessage {
  return { content: parts, role: "user", timestamp };
}

function assistant(
  content: AssistantMessage["content"],
  timestamp = 0
): AssistantMessage {
  return {
    api: "ai-sdk",
    content,
    model: "test-model",
    provider: "test",
    role: "assistant",
    stopReason: "stop",
    timestamp,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}

function toolResult(
  content: (TextContent | ImageContent)[],
  toolCallId: string,
  toolName: string
): ToolResultMessage {
  return {
    content,
    isError: false,
    role: "toolResult",
    timestamp: 0,
    toolCallId,
    toolName,
  };
}

// ─── UserMessage ────────────────────────────────────────────────────────────

describe("toModelMessages — UserMessage", () => {
  it("passes string content through as UserModelMessage", () => {
    const messages = toModelMessages([userText("hello")]);
    expect(messages).toEqual([{ content: "hello", role: "user" }]);
  });

  it("converts text + image array content to UserContent parts", () => {
    const messages = toModelMessages([
      userMulti([
        { text: "what is this?", type: "text" },
        { data: "base64data", mimeType: "image/png", type: "image" },
      ]),
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      content: [
        { text: "what is this?", type: "text" },
        { image: "base64data", mediaType: "image/png", type: "image" },
      ],
      role: "user",
    });
  });
});

// ─── AssistantMessage ─────────────────────────────────────────────────────────

describe("toModelMessages — AssistantMessage", () => {
  it("converts text content to TextPart", () => {
    const messages = toModelMessages([
      assistant([{ text: "response", type: "text" }]),
    ]);
    expect(messages[0]).toEqual({
      content: [{ text: "response", type: "text" }],
      role: "assistant",
    });
  });

  it("converts thinking content to ReasoningPart", () => {
    const messages = toModelMessages([
      assistant([{ thinking: "let me think", type: "thinking" }]),
    ]);
    expect(messages[0]).toEqual({
      content: [{ text: "let me think", type: "reasoning" }],
      role: "assistant",
    });
  });

  it("converts toolCall to ToolCallPart", () => {
    const messages = toModelMessages([
      assistant([
        { arguments: { x: 1 }, id: "tc1", name: "doThing", type: "toolCall" },
      ]),
    ]);
    expect(messages[0]).toEqual({
      content: [
        {
          input: { x: 1 },
          toolCallId: "tc1",
          toolName: "doThing",
          type: "tool-call",
        },
      ],
      role: "assistant",
    });
  });

  it("preserves interleaved text + thinking + toolCall order", () => {
    const messages = toModelMessages([
      assistant([
        { text: "I'll use a tool", type: "text" },
        { thinking: "analyzing", type: "thinking" },
        { arguments: {}, id: "tc1", name: "search", type: "toolCall" },
        { text: "done", type: "text" },
      ]),
    ]);
    const content = (messages[0] as { content: { type: string }[] }).content;
    expect(content.map((p) => p.type)).toEqual([
      "text",
      "reasoning",
      "tool-call",
      "text",
    ]);
  });
});

// ─── ToolResultMessage ─────────────────────────────────────────────────────────

describe("toModelMessages — ToolResultMessage", () => {
  it("converts to ToolModelMessage with a ToolResultPart", () => {
    const messages = toModelMessages([
      toolResult([{ text: "result text", type: "text" }], "tc1", "search"),
    ]);
    expect(messages[0]).toEqual({
      content: [
        {
          output: { type: "text", value: "result text" },
          toolCallId: "tc1",
          toolName: "search",
          type: "tool-result",
        },
      ],
      role: "tool",
    });
  });

  it("marks isError tool results", () => {
    const msg: ToolResultMessage = {
      content: [{ text: "tool failed", type: "text" }],
      isError: true,
      role: "toolResult",
      timestamp: 0,
      toolCallId: "tc1",
      toolName: "search",
    };
    const messages = toModelMessages([msg]);
    const content = (messages[0] as { content: Record<string, unknown>[] })
      .content;
    const part = content[0]!;
    expect(part.isError).toBe(true);
  });
});

// ─── reasoning signature cross-model guard (B4) ──────────────────────────────

describe("toModelMessages — reasoning signature guard", () => {
  function assistantWithSignature(
    model: string,
    thinking: string,
    signature: string
  ): AssistantMessage {
    return {
      ...assistant([
        { thinking, thinkingSignature: signature, type: "thinking" },
      ]),
      model,
    };
  }

  it("forwards thinkingSignature when targetModel matches the producing model", () => {
    const messages = toModelMessages(
      [assistantWithSignature("claude-sonnet-4.5", "hmm", "sig-123")],
      { targetModel: "claude-sonnet-4.5" }
    );
    const part = (
      messages[0] as {
        content: { providerMetadata?: Record<string, unknown> }[];
      }
    ).content[0]!;
    expect(part.providerMetadata?.anthropic).toEqual({ signature: "sig-123" });
  });

  it("drops thinkingSignature when targetModel differs (cross-model)", () => {
    // Anthropic encrypted thinking signatures are model-specific. Sending a
    // stale signature to a different model causes provider rejections. Matches
    // opencode's `sameModel` guard (session/runner/to-llm-message.ts:71-87).
    const messages = toModelMessages(
      [assistantWithSignature("claude-sonnet-4.5", "hmm", "sig-123")],
      { targetModel: "gpt-4o" }
    );
    const part = (
      messages[0] as {
        content: { providerMetadata?: Record<string, unknown> }[];
      }
    ).content[0]!;
    expect(part.providerMetadata?.anthropic).toBeUndefined();
  });

  it("forwards signature when no targetModel option is given (back-compat)", () => {
    const messages = toModelMessages([
      assistantWithSignature("claude-sonnet-4.5", "hmm", "sig-123"),
    ]);
    const part = (
      messages[0] as {
        content: { providerMetadata?: Record<string, unknown> }[];
      }
    ).content[0]!;
    expect(part.providerMetadata?.anthropic).toEqual({ signature: "sig-123" });
  });
});

// ─── mixed arrays + types ──────────────────────────────────────────────────────

describe("toModelMessages — mixed arrays", () => {
  it("converts a full conversation (user → assistant → toolResult → user)", () => {
    const messages: Message[] = [
      userText("search for X"),
      assistant([
        { arguments: { q: "X" }, id: "tc1", name: "search", type: "toolCall" },
      ]),
      toolResult([{ text: "found X", type: "text" }], "tc1", "search"),
      userText("thanks"),
    ];
    const result = toModelMessages(messages);
    expect(result).toHaveLength(4);
    expect(result.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "user",
    ]);
  });

  it("returns ModelMessage[] type", () => {
    const result = toModelMessages([userText("x")]);
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });
});
