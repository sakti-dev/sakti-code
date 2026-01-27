import { describe, expect, it } from "vitest";
import {
  zaiChatChunkSchema,
  zaiChatMessageSchema,
  zaiChatRequestSchema,
  zaiChatResponseSchema,
  zaiToolSchema,
  type ZaiChatMessage,
  type ZaiChatRequest,
  type ZaiContentPart,
  type ZaiTool,
  type ZaiToolCall,
} from "../../src/chat/zai-chat-api";

describe("zai-chat-api", () => {
  describe("ZaiContentPart", () => {
    it("should accept text content part", () => {
      const part: ZaiContentPart = {
        type: "text",
        text: "Hello world",
      };
      expect(part.type).toBe("text");
      expect(part.text).toBe("Hello world");
    });

    it("should accept image_url content part", () => {
      const part: ZaiContentPart = {
        type: "image_url",
        image_url: { url: "https://example.com/image.png" },
      };
      expect(part.type).toBe("image_url");
      expect(part.image_url.url).toBe("https://example.com/image.png");
    });

    it("should accept video_url content part", () => {
      const part: ZaiContentPart = {
        type: "video_url",
        video_url: { url: "https://example.com/video.mp4" },
      };
      expect(part.type).toBe("video_url");
    });

    it("should accept file_url content part", () => {
      const part: ZaiContentPart = {
        type: "file_url",
        file_url: { url: "https://example.com/document.pdf" },
      };
      expect(part.type).toBe("file_url");
    });
  });

  describe("ZaiChatMessage", () => {
    it("should accept system message with string content", () => {
      const message: ZaiChatMessage = {
        role: "system",
        content: "You are a helpful assistant.",
      };
      expect(message.role).toBe("system");
      expect(message.content).toBe("You are a helpful assistant.");
    });

    it("should accept user message with string content", () => {
      const message: ZaiChatMessage = {
        role: "user",
        content: "Hello!",
      };
      expect(message.role).toBe("user");
    });

    it("should accept user message with array content", () => {
      const content: ZaiContentPart[] = [
        { type: "text", text: "What do you see?" },
        { type: "image_url", image_url: { url: "https://example.com/image.png" } },
      ];
      const message: ZaiChatMessage = {
        role: "user",
        content,
      };
      expect(message.role).toBe("user");
      expect(Array.isArray(message.content)).toBe(true);
      expect(message.content).toHaveLength(2);
    });

    it("should accept assistant message with reasoning_content", () => {
      const message: ZaiChatMessage = {
        role: "assistant",
        content: "The answer is 42.",
        reasoning_content: "Let me think about this step by step...",
      };
      expect(message.role).toBe("assistant");
      expect(message.content).toBe("The answer is 42.");
      expect(message.reasoning_content).toBe("Let me think about this step by step...");
    });

    it("should accept assistant message with tool_calls", () => {
      const message: ZaiChatMessage = {
        role: "assistant",
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: {
              name: "get_weather",
              arguments: '{"city": "Beijing"}',
            },
          },
        ],
      };
      expect(message.role).toBe("assistant");
      expect(message.tool_calls).toHaveLength(1);
      expect(message.tool_calls?.[0].function.name).toBe("get_weather");
    });

    it("should accept tool message", () => {
      const message: ZaiChatMessage = {
        role: "tool",
        tool_call_id: "call_123",
        content: '{"temperature": 25, "condition": "sunny"}',
      };
      expect(message.role).toBe("tool");
      expect(message.tool_call_id).toBe("call_123");
    });
  });

  describe("ZaiTool", () => {
    it("should accept function tool", () => {
      const tool: ZaiTool = {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather for a city",
          parameters: {
            type: "object",
            properties: {
              city: { type: "string" },
            },
            required: ["city"],
          },
        },
      };
      expect(tool.type).toBe("function");
      expect(tool.function?.name).toBe("get_weather");
    });

    it("should accept web_search tool", () => {
      const tool: ZaiTool = {
        type: "web_search",
        web_search: {
          enable: true,
          search_result: true,
          search_recency_filter: "oneWeek",
        },
      };
      expect(tool.type).toBe("web_search");
      expect(tool.web_search?.enable).toBe(true);
    });

    it("should accept retrieval tool", () => {
      const tool: ZaiTool = {
        type: "retrieval",
        retrieval: {
          knowledge_id: "kb_123",
          prompt_template: "Context: {context}\nQuestion: {question}",
        },
      };
      expect(tool.type).toBe("retrieval");
      expect(tool.retrieval?.knowledge_id).toBe("kb_123");
    });
  });

  describe("ZaiToolCall", () => {
    it("should have required fields", () => {
      const toolCall: ZaiToolCall = {
        id: "call_abc",
        type: "function",
        function: {
          name: "calculate",
          arguments: '{"x": 1, "y": 2}',
        },
      };
      expect(toolCall.id).toBe("call_abc");
      expect(toolCall.type).toBe("function");
      expect(toolCall.function.name).toBe("calculate");
      expect(toolCall.function.arguments).toBe('{"x": 1, "y": 2}');
    });
  });

  describe("ZaiChatRequest", () => {
    it("should accept minimal request", () => {
      const request: ZaiChatRequest = {
        model: "glm-4.7",
        messages: [{ role: "user", content: "Hello" }],
      };
      expect(request.model).toBe("glm-4.7");
      expect(request.messages).toHaveLength(1);
    });

    it("should accept request with parameters", () => {
      const request: ZaiChatRequest = {
        model: "glm-4.7",
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "Hello" },
        ],
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 1000,
        stream: false,
      };
      expect(request.temperature).toBe(0.7);
      expect(request.top_p).toBe(0.9);
      expect(request.max_tokens).toBe(1000);
    });

    it("should accept request with thinking config", () => {
      const request: ZaiChatRequest = {
        model: "glm-4.7",
        messages: [{ role: "user", content: "Solve this problem" }],
        thinking: {
          type: "enabled",
          clear_thinking: false,
        },
      };
      expect(request.thinking?.type).toBe("enabled");
      expect(request.thinking?.clear_thinking).toBe(false);
    });

    it("should accept request with tools", () => {
      const request: ZaiChatRequest = {
        model: "glm-4.7",
        messages: [{ role: "user", content: "What is the weather?" }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get weather",
              parameters: {
                type: "object",
                properties: { city: { type: "string" } },
              },
            },
          },
        ],
        tool_choice: "auto",
      };
      expect(request.tools).toHaveLength(1);
      expect(request.tool_choice).toBe("auto");
    });

    it("should accept request with tool_stream", () => {
      const request: ZaiChatRequest = {
        model: "glm-4.7",
        messages: [{ role: "user", content: "Use tools" }],
        tool_stream: true,
      };
      expect(request.tool_stream).toBe(true);
    });

    it("should accept request with response_format", () => {
      const request: ZaiChatRequest = {
        model: "glm-4.7",
        messages: [{ role: "user", content: "Return JSON" }],
        response_format: { type: "json_object" },
      };
      expect(request.response_format?.type).toBe("json_object");
    });
  });

  describe("Schema Validation", () => {
    it("should validate ZaiChatRequest schema", () => {
      const request = {
        model: "glm-4.7",
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.7,
      };

      const result = zaiChatRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
    });

    it("should validate ZaiChatMessage schema", () => {
      const message = {
        role: "user",
        content: "Hello",
      };

      const result = zaiChatMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it("should validate ZaiTool schema", () => {
      const tool = {
        type: "function",
        function: {
          name: "test",
          description: "Test function",
          parameters: { type: "object" },
        },
      };

      const result = zaiToolSchema.safeParse(tool);
      expect(result.success).toBe(true);
    });
  });

  describe("ZaiChatResponse", () => {
    it("should validate response structure", () => {
      const response = {
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

      const result = zaiChatResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it("should validate response with reasoning_content", () => {
      const response = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "The answer is 42.",
              reasoning_content: "Let me calculate...",
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

      const result = zaiChatResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it("should validate response with tool_calls", () => {
      const response = {
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

      const result = zaiChatResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it("should validate response with web_search", () => {
      const response = {
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
        ],
      };

      const result = zaiChatResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });
  });

  describe("ZaiChatChunk", () => {
    it("should validate chunk structure", () => {
      const chunk = {
        id: "chatcmpl-123",
        created: 1234567890,
        model: "glm-4.7",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content: "Hello",
            },
          },
        ],
      };

      const result = zaiChatChunkSchema.safeParse(chunk);
      expect(result.success).toBe(true);
    });

    it("should validate chunk with reasoning delta", () => {
      const chunk = {
        id: "chatcmpl-123",
        choices: [
          {
            index: 0,
            delta: {
              reasoning_content: "Let me think",
            },
          },
        ],
      };

      const result = zaiChatChunkSchema.safeParse(chunk);
      expect(result.success).toBe(true);
    });

    it("should validate chunk with tool_call delta", () => {
      const chunk = {
        id: "chatcmpl-123",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_123",
                  type: "function",
                  function: {
                    name: "get_weather",
                    arguments: '{"city"',
                  },
                },
              ],
            },
          },
        ],
      };

      const result = zaiChatChunkSchema.safeParse(chunk);
      expect(result.success).toBe(true);
    });
  });
});
