import type { LanguageModelV3Prompt } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { convertToZaiChatMessages } from "../../src/chat/convert-to-zai-chat-messages";

describe("convert-to-zai-chat-messages", () => {
  describe("system messages", () => {
    it("should convert system message", () => {
      const prompt: LanguageModelV3Prompt = [
        { role: "system", content: "You are a helpful assistant." },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({
        role: "system",
        content: "You are a helpful assistant.",
      });
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("user messages", () => {
    it("should convert user message with single text", () => {
      const prompt: LanguageModelV3Prompt = [
        { role: "user", content: [{ type: "text", text: "Hello!" }] },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({
        role: "user",
        content: "Hello!",
      });
    });

    it("should convert user message with multimodal content", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "user",
          content: [
            { type: "text", text: "What do you see?" },
            {
              type: "file",
              mediaType: "image/png",
              data: new URL("https://example.com/image.png"),
            },
          ],
        },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
      expect(Array.isArray(result.messages[0].content)).toBe(true);
      expect(result.messages[0].content).toHaveLength(2);
    });

    it("should convert image URL to image_url part", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "user",
          content: [
            {
              type: "file",
              mediaType: "image/png",
              data: new URL("https://example.com/image.png"),
            },
          ],
        },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.messages).toHaveLength(1);
      const content = result.messages[0].content as Array<{
        type: string;
        image_url?: { url: string };
      }>;
      expect(content[0].type).toBe("image_url");
      expect(content[0].image_url?.url).toBe("https://example.com/image.png");
    });

    it("should convert base64 image data to data URL", () => {
      const base64Data = Buffer.from("fake-image-data").toString("base64");
      const prompt: LanguageModelV3Prompt = [
        {
          role: "user",
          content: [
            {
              type: "file",
              mediaType: "image/jpeg",
              data: new Uint8Array(Buffer.from(base64Data, "base64")),
            },
          ],
        },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.messages).toHaveLength(1);
      const content = result.messages[0].content as Array<{
        type: string;
        image_url?: { url: string };
      }>;
      expect(content[0].type).toBe("image_url");
      expect(content[0].image_url?.url).toMatch(/^data:image\/jpeg;base64,/);
    });

    it("should normalize image/* mediaType to image/jpeg for data URLs", () => {
      const base64Data = Buffer.from("fake-image-data").toString("base64");
      const prompt: LanguageModelV3Prompt = [
        {
          role: "user",
          content: [
            {
              type: "file",
              mediaType: "image/*",
              data: new Uint8Array(Buffer.from(base64Data, "base64")),
            },
          ],
        },
      ];

      const result = convertToZaiChatMessages({ prompt });

      const content = result.messages[0].content as Array<{
        type: string;
        image_url?: { url: string };
      }>;
      expect(content[0].image_url?.url).toMatch(/^data:image\/jpeg;base64,/);
    });

    it("should warn for unsupported file types", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "user",
          content: [
            {
              type: "file",
              mediaType: "application/pdf",
              data: new URL("https://example.com/doc.pdf"),
            },
          ],
        },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toEqual({
        type: "unsupported",
        feature: "file mediaType: application/pdf",
      });
    });
  });

  describe("assistant messages", () => {
    it("should convert assistant message with text", () => {
      const prompt: LanguageModelV3Prompt = [
        { role: "assistant", content: [{ type: "text", text: "Hello!" }] },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({
        role: "assistant",
        content: "Hello!",
      });
    });

    it("should convert assistant message with reasoning", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "Let me think..." },
            { type: "text", text: "The answer is 42." },
          ],
        },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({
        role: "assistant",
        content: "The answer is 42.",
        reasoning_content: "Let me think...",
      });
    });

    it("should convert assistant message with tool call", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call_123",
              toolName: "get_weather",
              input: { city: "Beijing" },
            },
          ],
        },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({
        role: "assistant",
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: {
              name: "get_weather",
              arguments: '{"city":"Beijing"}',
            },
          },
        ],
      });
    });

    it("should convert assistant message with text and tool calls", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "assistant",
          content: [
            { type: "text", text: "I will check the weather." },
            {
              type: "tool-call",
              toolCallId: "call_123",
              toolName: "get_weather",
              input: { city: "Beijing" },
            },
          ],
        },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe("I will check the weather.");
      expect(result.messages[0].tool_calls).toHaveLength(1);
    });

    it("should convert assistant message with all content types", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "First, I need to call the tool." },
            { type: "text", text: "Checking weather now." },
            {
              type: "tool-call",
              toolCallId: "call_123",
              toolName: "get_weather",
              input: { city: "Beijing" },
            },
          ],
        },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({
        role: "assistant",
        content: "Checking weather now.",
        reasoning_content: "First, I need to call the tool.",
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: {
              name: "get_weather",
              arguments: '{"city":"Beijing"}',
            },
          },
        ],
      });
    });
  });

  describe("tool messages", () => {
    it("should convert tool result with text output", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_123",
              output: { type: "text", value: "Temperature: 25°C" },
            },
          ],
        },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({
        role: "tool",
        tool_call_id: "call_123",
        content: "Temperature: 25°C",
      });
    });

    it("should convert tool result with json output", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_123",
              output: { type: "json", value: { temp: 25, city: "Beijing" } },
            },
          ],
        },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('{"temp":25,"city":"Beijing"}');
    });

    it("should convert tool result with error-text output", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_123",
              output: { type: "error-text", value: "API error occurred" },
            },
          ],
        },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe("API error occurred");
    });

    it("should convert tool result with error-json output", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_123",
              output: { type: "error-json", value: { error: "Not found" } },
            },
          ],
        },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('{"error":"Not found"}');
    });

    it("should convert tool result with execution-denied output", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_123",
              output: {
                type: "execution-denied",
                reason: "User denied tool execution",
              },
            },
          ],
        },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe("User denied tool execution");
    });

    it("should convert tool result with content output", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_123",
              output: {
                type: "content",
                value: [{ type: "text", text: "Mixed content" }],
              },
            },
          ],
        },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('[{"type":"text","text":"Mixed content"}]');
    });

    it("should skip tool-approval-response", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "tool",
          content: [
            { type: "tool-approval-response", toolCallId: "call_123", result: "yes" },
            {
              type: "tool-result",
              toolCallId: "call_123",
              output: { type: "text", value: "Success" },
            },
          ],
        },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("tool");
      expect(result.messages[0].content).toBe("Success");
    });

    it("should convert multiple tool results", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_123",
              output: { type: "text", value: "Result 1" },
            },
            {
              type: "tool-result",
              toolCallId: "call_456",
              output: { type: "json", value: { data: "Result 2" } },
            },
          ],
        },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].tool_call_id).toBe("call_123");
      expect(result.messages[0].content).toBe("Result 1");
      expect(result.messages[1].tool_call_id).toBe("call_456");
      expect(result.messages[1].content).toBe('{"data":"Result 2"}');
    });
  });

  describe("complex conversations", () => {
    it("should convert multi-turn conversation", () => {
      const prompt: LanguageModelV3Prompt = [
        { role: "system", content: "You are helpful." },
        { role: "user", content: [{ type: "text", text: "Hello!" }] },
        { role: "assistant", content: [{ type: "text", text: "Hi there!" }] },
        { role: "user", content: [{ type: "text", text: "How are you?" }] },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.messages).toHaveLength(4);
      expect(result.messages[0].role).toBe("system");
      expect(result.messages[1].role).toBe("user");
      expect(result.messages[2].role).toBe("assistant");
      expect(result.messages[3].role).toBe("user");
    });

    it("should convert conversation with tools", () => {
      const prompt: LanguageModelV3Prompt = [
        { role: "user", content: [{ type: "text", text: "What is the weather?" }] },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call_123",
              toolName: "get_weather",
              input: { city: "Beijing" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_123",
              output: { type: "text", value: "25°C, sunny" },
            },
          ],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "It is 25°C and sunny in Beijing." }],
        },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.messages).toHaveLength(4);
      expect(result.messages[1].tool_calls).toHaveLength(1);
      expect(result.messages[2].role).toBe("tool");
      expect(result.messages[3].content).toBe("It is 25°C and sunny in Beijing.");
    });

    it("should handle preserved thinking (reasoning in assistant message)", () => {
      const prompt: LanguageModelV3Prompt = [
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "Previous reasoning..." },
            { type: "text", text: "Previous response." },
          ],
        },
        { role: "user", content: [{ type: "text", text: "Continue" }] },
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "More thinking..." },
            { type: "text", text: "More response." },
          ],
        },
      ];

      const result = convertToZaiChatMessages({ prompt });

      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].reasoning_content).toBe("Previous reasoning...");
      expect(result.messages[2].reasoning_content).toBe("More thinking...");
    });
  });
});
