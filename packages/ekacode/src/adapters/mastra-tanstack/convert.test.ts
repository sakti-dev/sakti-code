/**
 * Tests for convert.ts - Message and tool conversion utilities
 */

import type { ModelMessage, Tool } from "@tanstack/ai";
import { describe, expect, it } from "vitest";
import { convertToAISDKMessages, convertToolsToAISDK } from "./convert";

describe("convertToAISDKMessages", () => {
  it("should convert user message with text content", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "Hello, world!" }];

    const result = convertToAISDKMessages(messages);

    expect(result).toEqual([{ role: "user", content: [{ type: "text", text: "Hello, world!" }] }]);
  });

  it("should convert user message with multimodal content", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", content: "What do you see?" },
          {
            type: "image",
            source: { type: "url", value: "https://example.com/image.png" },
          },
        ],
      },
    ];

    const result = convertToAISDKMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    // Image conversion from URL to Uint8Array happens in implementation
    expect(result[0].content).toHaveLength(2);
    expect(result[0].content[0]).toEqual({ type: "text", text: "What do you see?" });
    // Check the second content part has type 'image' (may be URL or Uint8Array)
    const secondPart = result[0].content[1];
    if (typeof secondPart !== "string" && "type" in secondPart) {
      expect(secondPart.type).toBe("image");
    }
  });

  it("should convert assistant message with text and tool calls", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: "I will check the weather.",
        toolCalls: [
          {
            id: "call_123",
            type: "function",
            function: {
              name: "getWeather",
              arguments: '{"location":"Tokyo"}',
            },
          },
        ],
      },
    ];

    const result = convertToAISDKMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
    expect(Array.isArray(result[0].content)).toBe(true);
    expect(result[0].content).toHaveLength(2);
  });

  it("should convert tool result message", () => {
    const messages: ModelMessage[] = [
      {
        role: "tool",
        toolCallId: "call_123",
        content: "The weather is sunny.",
      },
    ];

    const result = convertToAISDKMessages(messages);

    expect(result).toEqual([
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_123",
            toolName: "tool",
            result: "The weather is sunny.",
          },
        ],
      },
    ]);
  });

  it("should handle null content gracefully", () => {
    const messages: ModelMessage[] = [{ role: "user", content: null }];

    const result = convertToAISDKMessages(messages);

    expect(result).toEqual([{ role: "user", content: [{ type: "text", text: "" }] }]);
  });

  it("should convert multiple messages in sequence", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: "Hi there!",
        toolCalls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "test", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "call_1",
        content: "Success",
      },
    ];

    const result = convertToAISDKMessages(messages);

    expect(result).toHaveLength(3);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
    expect(result[2].role).toBe("tool");
  });
});

describe("convertToolsToAISDK", () => {
  it("should convert a single tool definition", () => {
    const tools: Tool[] = [
      {
        name: "getWeather",
        description: "Get the current weather",
        inputSchema: {
          type: "object",
          properties: {
            location: { type: "string" },
          },
          required: ["location"],
        },
      },
    ];

    const result = convertToolsToAISDK(tools);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "function",
      name: "getWeather",
      description: "Get the current weather",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string" },
        },
        required: ["location"],
      },
    });
  });

  it("should convert multiple tools", () => {
    const tools: Tool[] = [
      {
        name: "getWeather",
        description: "Get weather",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
      {
        name: "getTime",
        description: "Get time",
        inputSchema: {
          type: "object",
          properties: { timezone: { type: "string" } },
          required: ["timezone"],
        },
      },
    ];

    const result = convertToolsToAISDK(tools);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("getWeather");
    expect(result[1].name).toBe("getTime");
  });

  it("should handle tools with no input schema", () => {
    const tools: Tool[] = [
      {
        name: "simpleTool",
        description: "A simple tool",
        inputSchema: {} as Record<string, unknown>,
      },
    ];

    const result = convertToolsToAISDK(tools);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "function",
      name: "simpleTool",
      description: "A simple tool",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    });
  });
});
