import type { SharedV3Warning } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { mapZaiChatResponse } from "../../src/chat/map-zai-chat-response";
import type { ZaiChatResponse } from "../../src/chat/zai-chat-api";

describe("map-zai-chat-response", () => {
  describe("text responses", () => {
    it("should map simple text response", () => {
      const response: ZaiChatResponse = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Hello! How can I help you?",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };

      const result = mapZaiChatResponse({ response, warnings: [] });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: "text",
        text: "Hello! How can I help you?",
      });
      expect(result.finishReason).toEqual({
        unified: "stop",
        raw: "stop",
      });
    });

    it("should map empty content response", () => {
      const response: ZaiChatResponse = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 0,
          total_tokens: 10,
        },
      };

      const result = mapZaiChatResponse({ response, warnings: [] });

      expect(result.content).toHaveLength(0);
    });
  });

  describe("reasoning content", () => {
    it("should map response with reasoning_content", () => {
      const response: ZaiChatResponse = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "The answer is 42.",
              reasoning_content: "Let me calculate step by step...",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 25,
          total_tokens: 35,
          completion_tokens_details: {
            reasoning_tokens: 5,
          },
        },
      };

      const result = mapZaiChatResponse({ response, warnings: [] });

      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toEqual({
        type: "reasoning",
        text: "Let me calculate step by step...",
      });
      expect(result.content[1]).toEqual({
        type: "text",
        text: "The answer is 42.",
      });
    });

    it("should map response with only reasoning_content", () => {
      const response: ZaiChatResponse = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              reasoning_content: "Thinking...",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 10,
          total_tokens: 20,
        },
      };

      const result = mapZaiChatResponse({ response, warnings: [] });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: "reasoning",
        text: "Thinking...",
      });
    });
  });

  describe("tool calls", () => {
    it("should map response with single tool call", () => {
      const response: ZaiChatResponse = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "I will check the weather for you.",
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
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 30,
          total_tokens: 80,
        },
      };

      const result = mapZaiChatResponse({ response, warnings: [] });

      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toEqual({
        type: "text",
        text: "I will check the weather for you.",
      });
      expect(result.content[1]).toEqual({
        type: "tool-call",
        toolCallId: "call_123",
        toolName: "get_weather",
        input: '{"city":"Beijing"}',
      });
      expect(result.finishReason).toEqual({
        unified: "tool-calls",
        raw: "tool_calls",
      });
    });

    it("should map response with multiple tool calls", () => {
      const response: ZaiChatResponse = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            message: {
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
                {
                  id: "call_456",
                  type: "function",
                  function: {
                    name: "get_time",
                    arguments: '{"timezone":"UTC"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 40,
          total_tokens: 90,
        },
      };

      const result = mapZaiChatResponse({ response, warnings: [] });

      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toEqual({
        type: "tool-call",
        toolCallId: "call_123",
        toolName: "get_weather",
        input: '{"city":"Beijing"}',
      });
      expect(result.content[1]).toEqual({
        type: "tool-call",
        toolCallId: "call_456",
        toolName: "get_time",
        input: '{"timezone":"UTC"}',
      });
    });

    it("should map response with reasoning and tool calls", () => {
      const response: ZaiChatResponse = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              reasoning_content: "I need to use the weather tool.",
              content: "Checking weather now.",
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
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 35,
          total_tokens: 85,
        },
      };

      const result = mapZaiChatResponse({ response, warnings: [] });

      expect(result.content).toHaveLength(3);
      expect(result.content[0]).toEqual({
        type: "reasoning",
        text: "I need to use the weather tool.",
      });
      expect(result.content[1]).toEqual({
        type: "text",
        text: "Checking weather now.",
      });
      expect(result.content[2]).toEqual({
        type: "tool-call",
        toolCallId: "call_123",
        toolName: "get_weather",
        input: '{"city":"Beijing"}',
      });
    });
  });

  describe("web search results", () => {
    it("should map response with web_search results", () => {
      const response: ZaiChatResponse = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Based on search results...",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
        web_search: [
          {
            title: "AI News",
            content: "Latest AI developments...",
            link: "https://example.com/article",
            media: "example.com",
            icon: "https://example.com/icon.png",
            refer: "google",
            publish_date: "2024-01-01",
          },
          {
            title: "Tech Update",
            content: "Technology updates...",
            link: "https://example.com/tech",
            media: "example.com",
            icon: "https://example.com/icon2.png",
            refer: "google",
            publish_date: "2024-01-02",
          },
        ],
      };

      const result = mapZaiChatResponse({ response, warnings: [] });

      expect(result.content).toHaveLength(3);
      expect(result.content[0]).toEqual({
        type: "text",
        text: "Based on search results...",
      });
      expect(result.content[1]).toMatchObject({
        type: "source",
        sourceType: "url",
        url: "https://example.com/article",
        title: "AI News",
      });
      expect(result.content[2]).toMatchObject({
        type: "source",
        sourceType: "url",
        url: "https://example.com/tech",
        title: "Tech Update",
      });
    });

    it("should skip web_search entries without link", () => {
      const response: ZaiChatResponse = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Based on search results...",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
        web_search: [
          {
            title: "Missing link",
          },
        ],
      };

      const result = mapZaiChatResponse({ response, warnings: [] });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: "text",
        text: "Based on search results...",
      });
    });

    it("should map response with web_search and tool calls", () => {
      const response: ZaiChatResponse = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "I found some information.",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 30,
          total_tokens: 130,
        },
        web_search: [
          {
            title: "Search Result",
            content: "Content...",
            link: "https://example.com",
            media: "example.com",
            icon: "https://example.com/icon.png",
            refer: "google",
            publish_date: "2024-01-01",
          },
        ],
      };

      const result = mapZaiChatResponse({ response, warnings: [] });

      expect(result.content).toHaveLength(2);
      expect(result.content[0].type).toBe("text");
      expect(result.content[1].type).toBe("source");
    });
  });

  describe("usage mapping", () => {
    it("should map basic usage", () => {
      const response: ZaiChatResponse = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello" },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };

      const result = mapZaiChatResponse({ response, warnings: [] });

      expect(result.usage.inputTokens.total).toBe(10);
      expect(result.usage.inputTokens.noCache).toBe(10);
      expect(result.usage.inputTokens.cacheRead).toBeUndefined();
      expect(result.usage.outputTokens.total).toBe(20);
      expect(result.usage.outputTokens.text).toBe(20);
      expect(result.usage.outputTokens.reasoning).toBeUndefined();
    });

    it("should map usage with cached tokens", () => {
      const response: ZaiChatResponse = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello" },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
          prompt_tokens_details: {
            cached_tokens: 50,
          },
        },
      };

      const result = mapZaiChatResponse({ response, warnings: [] });

      expect(result.usage.inputTokens.total).toBe(100);
      expect(result.usage.inputTokens.noCache).toBe(50);
      expect(result.usage.inputTokens.cacheRead).toBe(50);
    });

    it("should map usage with reasoning tokens", () => {
      const response: ZaiChatResponse = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Answer",
              reasoning_content: "Thinking...",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 30,
          total_tokens: 40,
          completion_tokens_details: {
            reasoning_tokens: 10,
          },
        },
      };

      const result = mapZaiChatResponse({ response, warnings: [] });

      expect(result.usage.outputTokens.total).toBe(30);
      expect(result.usage.outputTokens.text).toBe(20);
      expect(result.usage.outputTokens.reasoning).toBe(10);
    });

    it("should map usage with both cached and reasoning tokens", () => {
      const response: ZaiChatResponse = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Answer",
              reasoning_content: "Thinking...",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 40,
          total_tokens: 140,
          prompt_tokens_details: {
            cached_tokens: 60,
          },
          completion_tokens_details: {
            reasoning_tokens: 15,
          },
        },
      };

      const result = mapZaiChatResponse({ response, warnings: [] });

      expect(result.usage.inputTokens.total).toBe(100);
      expect(result.usage.inputTokens.noCache).toBe(40);
      expect(result.usage.inputTokens.cacheRead).toBe(60);
      expect(result.usage.outputTokens.total).toBe(40);
      expect(result.usage.outputTokens.text).toBe(25);
      expect(result.usage.outputTokens.reasoning).toBe(15);
    });
  });

  describe("finish reasons", () => {
    it("should map stop finish reason", () => {
      const response: ZaiChatResponse = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Done" },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 10,
          total_tokens: 20,
        },
      };

      const result = mapZaiChatResponse({ response, warnings: [] });

      expect(result.finishReason.unified).toBe("stop");
      expect(result.finishReason.raw).toBe("stop");
    });

    it("should map length finish reason", () => {
      const response: ZaiChatResponse = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Truncated..." },
            finish_reason: "length",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 10,
          total_tokens: 20,
        },
      };

      const result = mapZaiChatResponse({ response, warnings: [] });

      expect(result.finishReason.unified).toBe("length");
      expect(result.finishReason.raw).toBe("length");
    });

    it("should map tool_calls finish reason", () => {
      const response: ZaiChatResponse = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "call_123",
                  type: "function",
                  function: { name: "test", arguments: "{}" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 10,
          total_tokens: 20,
        },
      };

      const result = mapZaiChatResponse({ response, warnings: [] });

      expect(result.finishReason.unified).toBe("tool-calls");
      expect(result.finishReason.raw).toBe("tool_calls");
    });

    it("should map sensitive finish reason to content-filter", () => {
      const response: ZaiChatResponse = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "" },
            finish_reason: "sensitive",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 0,
          total_tokens: 10,
        },
      };

      const result = mapZaiChatResponse({ response, warnings: [] });

      expect(result.finishReason.unified).toBe("content-filter");
      expect(result.finishReason.raw).toBe("sensitive");
    });

    it("should map network_error finish reason to error", () => {
      const response: ZaiChatResponse = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "" },
            finish_reason: "network_error",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 0,
          total_tokens: 10,
        },
      };

      const result = mapZaiChatResponse({ response, warnings: [] });

      expect(result.finishReason.unified).toBe("error");
      expect(result.finishReason.raw).toBe("network_error");
    });
  });

  describe("warnings", () => {
    it("should preserve existing warnings", () => {
      const response: ZaiChatResponse = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello" },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 10,
          total_tokens: 20,
        },
      };

      const warnings: SharedV3Warning[] = [{ type: "unsupported", feature: "test" }];

      const result = mapZaiChatResponse({ response, warnings });

      expect(result.warnings).toEqual(warnings);
    });
  });
});
