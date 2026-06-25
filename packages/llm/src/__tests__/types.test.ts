import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AssistantMessage,
  ImageContent,
  Message,
  Model,
  ModelThinkingLevel,
  OpenAICompletionsCompat,
  ProviderId,
  StopReason,
  TextContent,
  ThinkingContent,
  ThinkingLevelMap,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "../types.ts";

describe("message contract types", () => {
  it("UserMessage accepts string or content-array content", () => {
    const stringMessage: UserMessage = {
      role: "user",
      content: "hello",
      timestamp: Date.now(),
    };
    const arrayMessage: UserMessage = {
      role: "user",
      content: [{ type: "text", text: "hi" }],
      timestamp: Date.now(),
    };
    expect(stringMessage.content).toBe("hello");
    expect(Array.isArray(arrayMessage.content)).toBe(true);
  });

  it("AssistantMessage keeps the pi-ai shape with api/content/usage/stopReason", () => {
    const message: AssistantMessage = {
      api: "ai-sdk",
      content: [{ type: "text", text: "ok" }],
      model: "claude-sonnet-4.5",
      provider: "anthropic",
      role: "assistant",
      stopReason: "stop",
      timestamp: Date.now(),
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        input: 10,
        output: 5,
        totalTokens: 15,
      },
    };
    expect(message.stopReason).toBe("stop");
    expect(message.usage.cost.total).toBe(0);
  });

  it("Usage.cost block has all five cost fields", () => {
    const usage: Usage = {
      cacheRead: 1,
      cacheWrite: 2,
      cacheWrite1h: 1,
      cost: {
        input: 0.1,
        output: 0.2,
        cacheRead: 0.01,
        cacheWrite: 0.02,
        total: 0.33,
      },
      input: 100,
      output: 50,
      totalTokens: 150,
    };
    expectTypeOf(usage.cost).toEqualTypeOf<{
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    }>();
  });

  it("StopReason union is exactly stop/length/toolUse/error/aborted", () => {
    expectTypeOf<StopReason>().toEqualTypeOf<
      "stop" | "length" | "toolUse" | "error" | "aborted"
    >();
  });

  it("Message discriminates by role", () => {
    const messages: Message[] = [
      { role: "user", content: "x", timestamp: 0 },
      {
        role: "assistant",
        api: "ai-sdk",
        content: [],
        model: "m",
        provider: "p",
        stopReason: "stop",
        timestamp: 0,
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          input: 0,
          output: 0,
          totalTokens: 0,
        },
      },
      {
        role: "toolResult",
        content: [{ type: "text", text: "r" }],
        isError: false,
        timestamp: 0,
        toolCallId: "tc",
        toolName: "t",
      },
    ];
    for (const message of messages) {
      if (message.role === "assistant") {
        expectTypeOf(message).toEqualTypeOf<AssistantMessage>();
      } else if (message.role === "toolResult") {
        expectTypeOf(message).toEqualTypeOf<ToolResultMessage>();
      }
    }
    expect(messages).toHaveLength(3);
  });

  it("content block types discriminate by type", () => {
    const text: TextContent = { type: "text", text: "x" };
    const thinking: ThinkingContent = { type: "thinking", thinking: "h" };
    const image: ImageContent = {
      type: "image",
      data: "base64",
      mimeType: "image/png",
    };
    const toolCall: ToolCall = {
      type: "toolCall",
      id: "tc1",
      name: "doThing",
      arguments: { foo: "bar", count: 3 },
    };
    expect(text.type).toBe("text");
    expect(thinking.type).toBe("thinking");
    expect(image.type).toBe("image");
    expect(toolCall.type).toBe("toolCall");
  });

  it("ToolCall.arguments is Record<string, unknown> not any", () => {
    expectTypeOf<ToolCall["arguments"]>().toEqualTypeOf<
      Record<string, unknown>
    >();
  });
});

describe("Model type (ai-sdk-only)", () => {
  it("Model is non-generic with api literal 'ai-sdk'", () => {
    const model = {} as Model;
    expectTypeOf(model).toEqualTypeOf<{
      api: "ai-sdk";
      baseUrl: string;
      compat?: OpenAICompletionsCompat;
      contextWindow: number;
      cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
      };
      headers?: Record<string, string>;
      id: string;
      input: ("text" | "image")[];
      maxTokens: number;
      name: string;
      npm?: string;
      provider: ProviderId;
      reasoning: boolean;
      status?: "active" | "alpha" | "beta" | "deprecated";
      thinkingLevelMap?: ThinkingLevelMap;
    }>();
  });

  it("Model accepts npm + compat + thinkingLevelMap", () => {
    const model: Model = {
      api: "ai-sdk",
      baseUrl: "https://api.anthropic.com",
      compat: { thinkingFormat: "openai" },
      contextWindow: 200_000,
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      id: "claude-sonnet-4.5",
      input: ["text", "image"],
      maxTokens: 8192,
      name: "Claude Sonnet 4.5",
      npm: "@ai-sdk/anthropic",
      provider: "anthropic",
      reasoning: true,
      thinkingLevelMap: { off: null, minimal: null },
    };
    expect(model.api).toBe("ai-sdk");
    expect(model.npm).toBe("@ai-sdk/anthropic");
  });

  it("Model.api literal is assignable to AssistantMessage.api string", () => {
    const model: Model = {
      api: "ai-sdk",
      baseUrl: "x",
      contextWindow: 1,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      id: "m",
      input: ["text"],
      maxTokens: 1,
      name: "m",
      provider: "p",
      reasoning: false,
    };
    const message: AssistantMessage = {
      api: model.api,
      content: [],
      model: model.id,
      provider: model.provider,
      role: "assistant",
      stopReason: "stop",
      timestamp: 0,
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        input: 0,
        output: 0,
        totalTokens: 0,
      },
    };
    expect(message.api).toBe("ai-sdk");
  });
});

describe("OpenAICompletionsCompat", () => {
  it("thinkingFormat accepts all 10 known values", () => {
    const formats: OpenAICompletionsCompat["thinkingFormat"][] = [
      "openai",
      "openrouter",
      "deepseek",
      "together",
      "zai",
      "qwen",
      "chat-template",
      "qwen-chat-template",
      "string-thinking",
      "ant-ling",
    ];
    expect(formats).toHaveLength(10);
  });

  it("ModelThinkingLevel includes off + minimal/low/medium/high/xhigh", () => {
    const levels: ModelThinkingLevel[] = [
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ];
    expect(levels).toHaveLength(6);
  });
});
