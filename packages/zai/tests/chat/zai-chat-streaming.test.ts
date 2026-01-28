import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import type { ZaiChatChunk } from "../../src/chat/zai-chat-api";

/**
 * Helper to simulate streaming behavior from Z.ai chunks
 * This tests the TransformStream logic in doStream without needing
 * to mock the full HTTP streaming response
 */
function simulateToolCallStream(chunks: ZaiChatChunk[]): LanguageModelV3StreamPart[] {
  const parts: LanguageModelV3StreamPart[] = [];

  // Simulate the TransformStream logic from zai-chat-language-model.ts
  const toolCalls = new Map<
    number,
    { id: string; name: string; arguments: string; hasFinished: boolean }
  >();
  let chunkId = 0;

  const generateId = () => `call_${chunkId++}`;

  // Transform phase (process each chunk)
  for (const chunk of chunks) {
    const choice = chunk.choices?.[0];
    if (!choice?.delta) continue;

    const delta = choice.delta;

    if (delta.tool_calls) {
      for (const toolCallDelta of delta.tool_calls) {
        const index = toolCallDelta.index ?? toolCalls.size;

        if (toolCalls.get(index) == null) {
          // New tool call
          const id = toolCallDelta.id ?? generateId();
          const name = toolCallDelta.function?.name ?? "";
          const args = toolCallDelta.function?.arguments ?? "";

          parts.push({
            type: "tool-input-start",
            id,
            toolName: name,
          });

          toolCalls.set(index, {
            id,
            name,
            arguments: args,
            hasFinished: false,
          });

          if (args) {
            parts.push({
              type: "tool-input-delta",
              id,
              delta: args,
            });
          }

          // Check if complete (parsable JSON)
          if (isParsableJson(args)) {
            parts.push({
              type: "tool-input-end",
              id,
            });

            parts.push({
              type: "tool-call",
              toolCallId: id,
              toolName: name,
              input: args,
            });

            const toolCall = toolCalls.get(index);
            if (toolCall) {
              toolCall.hasFinished = true;
            }
          }
        } else {
          // Existing tool call - append arguments
          const existingCall = toolCalls.get(index)!;
          if (existingCall.hasFinished) {
            continue;
          }
          if (toolCallDelta.function?.arguments != null) {
            existingCall.arguments += toolCallDelta.function.arguments;

            parts.push({
              type: "tool-input-delta",
              id: existingCall.id,
              delta: toolCallDelta.function.arguments,
            });

            // Check if complete
            if (isParsableJson(existingCall.arguments)) {
              parts.push({
                type: "tool-input-end",
                id: existingCall.id,
              });

              parts.push({
                type: "tool-call",
                toolCallId: existingCall.id,
                toolName: existingCall.name,
                input: existingCall.arguments,
              });
              existingCall.hasFinished = true;
            }
          }
        }
      }
    }
  }

  // Flush phase (emit remaining tool calls even if not finished)
  for (const toolCall of toolCalls.values()) {
    if (toolCall.hasFinished) {
      continue;
    }

    parts.push({
      type: "tool-input-end",
      id: toolCall.id,
    });

    parts.push({
      type: "tool-call",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input: toolCall.arguments,
    });
  }

  return parts;
}

function isParsableJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

describe("zai-chat-streaming - Phase 2 Edge Cases", () => {
  describe("full tool JSON in one chunk", () => {
    it("should emit complete tool-call when JSON arrives in one chunk", () => {
      const chunks: ZaiChatChunk[] = [
        {
          id: "chunk1",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "call_123",
                    function: {
                      name: "get_weather",
                      arguments: '{"city":"Beijing"}',
                    },
                  },
                ],
              },
            },
          ],
        },
      ];

      const parts = simulateToolCallStream(chunks);

      // Should have tool-input-start, tool-input-delta, tool-input-end, tool-call
      expect(parts).toHaveLength(4);

      expect(parts[0]).toEqual({
        type: "tool-input-start",
        id: "call_123",
        toolName: "get_weather",
      });

      expect(parts[1]).toEqual({
        type: "tool-input-delta",
        id: "call_123",
        delta: '{"city":"Beijing"}',
      });

      expect(parts[2]).toEqual({
        type: "tool-input-end",
        id: "call_123",
      });

      expect(parts[3]).toEqual({
        type: "tool-call",
        toolCallId: "call_123",
        toolName: "get_weather",
        input: '{"city":"Beijing"}',
      });
    });

    it("should handle multiple tools with complete JSON in one chunk", () => {
      const chunks: ZaiChatChunk[] = [
        {
          id: "chunk1",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_123",
                    function: {
                      name: "get_weather",
                      arguments: '{"city":"Beijing"}',
                    },
                  },
                  {
                    index: 1,
                    id: "call_456",
                    function: {
                      name: "get_time",
                      arguments: '{"timezone":"UTC"}',
                    },
                  },
                ],
              },
            },
          ],
        },
      ];

      const parts = simulateToolCallStream(chunks);

      // Should have 4 parts per tool (start, delta, end, call) = 8 total
      expect(parts).toHaveLength(8);

      // First tool
      expect(parts[0].type).toBe("tool-input-start");
      expect(parts[0].toolName).toBe("get_weather");

      // Second tool
      expect(parts[4].type).toBe("tool-input-start");
      expect(parts[4].toolName).toBe("get_time");
    });
  });

  describe("chunked tool JSON", () => {
    it("should accumulate chunked JSON and emit tool-call when complete", () => {
      const chunks: ZaiChatChunk[] = [
        {
          id: "chunk1",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_123",
                    function: {
                      name: "get_weather",
                      arguments: '{"city"',
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          id: "chunk2",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: ':"Beijing"}',
                    },
                  },
                ],
              },
            },
          ],
        },
      ];

      const parts = simulateToolCallStream(chunks);

      // Should have: start, delta1, delta2, end, call
      expect(parts).toHaveLength(5);

      // First chunk - not valid JSON yet
      expect(parts[0]).toEqual({
        type: "tool-input-start",
        id: "call_123",
        toolName: "get_weather",
      });

      expect(parts[1]).toEqual({
        type: "tool-input-delta",
        id: "call_123",
        delta: '{"city"',
      });

      // Second chunk - now valid JSON
      expect(parts[2]).toEqual({
        type: "tool-input-delta",
        id: "call_123",
        delta: ':"Beijing"}',
      });

      expect(parts[3]).toEqual({
        type: "tool-input-end",
        id: "call_123",
      });

      expect(parts[4]).toEqual({
        type: "tool-call",
        toolCallId: "call_123",
        toolName: "get_weather",
        input: '{"city":"Beijing"}',
      });
    });

    it("should handle tool name and arguments arriving in separate chunks", () => {
      const chunks: ZaiChatChunk[] = [
        {
          id: "chunk1",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_123",
                    function: {
                      name: "get_weather",
                      arguments: "",
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          id: "chunk2",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: '{"city":"Tokyo"}',
                    },
                  },
                ],
              },
            },
          ],
        },
      ];

      const parts = simulateToolCallStream(chunks);

      // First chunk: start only (no arguments yet)
      expect(parts[0]).toEqual({
        type: "tool-input-start",
        id: "call_123",
        toolName: "get_weather",
      });

      // Second chunk: delta, end, call (now valid JSON)
      expect(parts[1]).toEqual({
        type: "tool-input-delta",
        id: "call_123",
        delta: '{"city":"Tokyo"}',
      });

      expect(parts[2]).toEqual({
        type: "tool-input-end",
        id: "call_123",
      });

      expect(parts[3]).toEqual({
        type: "tool-call",
        toolCallId: "call_123",
        toolName: "get_weather",
        input: '{"city":"Tokyo"}',
      });
    });

    it("should handle multiple chunks before JSON becomes valid", () => {
      const chunks: ZaiChatChunk[] = [
        {
          id: "chunk1",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_123",
                    function: {
                      name: "complex_tool",
                      arguments: '{"data"',
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          id: "chunk2",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: ":{",
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          id: "chunk3",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: '"nested":"value"}}',
                    },
                  },
                ],
              },
            },
          ],
        },
      ];

      const parts = simulateToolCallStream(chunks);

      // Should accumulate all chunks before emitting tool-call
      expect(parts).toHaveLength(6); // start + 3 deltas + end + call

      const deltas = parts.filter(p => p.type === "tool-input-delta");
      expect(deltas).toHaveLength(3);

      const finalCall = parts.filter(p => p.type === "tool-call")[0];
      expect(finalCall.input).toBe('{"data":{"nested":"value"}}');
    });
  });

  describe("never-valid JSON (flush behavior)", () => {
    it("should emit tool-call on flush even when JSON never becomes valid", () => {
      const chunks: ZaiChatChunk[] = [
        {
          id: "chunk1",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_123",
                    function: {
                      name: "get_weather",
                      arguments: "invalid json data",
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          id: "chunk2",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: " more invalid",
                    },
                  },
                ],
              },
            },
          ],
        },
      ];

      const parts = simulateToolCallStream(chunks);

      // Should have: start, delta1, delta2
      // Then flush emits: end, call with invalid JSON
      expect(parts).toHaveLength(5);

      expect(parts[0].type).toBe("tool-input-start");
      expect(parts[1].type).toBe("tool-input-delta");
      expect(parts[2].type).toBe("tool-input-delta");

      // Flush phase - emit even though not valid JSON
      expect(parts[3]).toEqual({
        type: "tool-input-end",
        id: "call_123",
      });

      expect(parts[4]).toEqual({
        type: "tool-call",
        toolCallId: "call_123",
        toolName: "get_weather",
        input: "invalid json data more invalid",
      });
    });

    it("should handle empty arguments and still emit tool-call on flush", () => {
      const chunks: ZaiChatChunk[] = [
        {
          id: "chunk1",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_123",
                    function: {
                      name: "get_weather",
                      // arguments undefined/empty
                    },
                  },
                ],
              },
            },
          ],
        },
      ];

      const parts = simulateToolCallStream(chunks);

      // Should have: start (no delta since no args)
      // Flush emits: end, call with empty args
      expect(parts).toHaveLength(3);

      expect(parts[0]).toEqual({
        type: "tool-input-start",
        id: "call_123",
        toolName: "get_weather",
      });

      expect(parts[1]).toEqual({
        type: "tool-input-end",
        id: "call_123",
      });

      expect(parts[2]).toEqual({
        type: "tool-call",
        toolCallId: "call_123",
        toolName: "get_weather",
        input: "",
      });
    });

    it("should handle mix of valid and invalid tools in flush", () => {
      const chunks: ZaiChatChunk[] = [
        {
          id: "chunk1",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_valid",
                    function: {
                      name: "valid_tool",
                      arguments: '{"status":"ok"}',
                    },
                  },
                  {
                    index: 1,
                    id: "call_invalid",
                    function: {
                      name: "invalid_tool",
                      arguments: "not json",
                    },
                  },
                ],
              },
            },
          ],
        },
      ];

      const parts = simulateToolCallStream(chunks);

      // Valid tool: start, delta, end, call (4 parts)
      // Invalid tool: start (no delta yet), then flush emits end, call
      const toolCalls = parts.filter(p => p.type === "tool-call");
      expect(toolCalls).toHaveLength(2);

      const validCall = toolCalls.find(tc => tc.toolName === "valid_tool");
      expect(validCall?.input).toBe('{"status":"ok"}');

      const invalidCall = toolCalls.find(tc => tc.toolName === "invalid_tool");
      expect(invalidCall?.input).toBe("not json");
    });
  });

  describe("mixed content scenarios", () => {
    it("should handle text followed by tool call", () => {
      const chunks: ZaiChatChunk[] = [
        {
          id: "chunk1",
          choices: [
            {
              index: 0,
              delta: {
                content: "I'll check the weather",
              },
            },
          ],
        },
        {
          id: "chunk2",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_123",
                    function: {
                      name: "get_weather",
                      arguments: '{"city":"Paris"}',
                    },
                  },
                ],
              },
            },
          ],
        },
      ];

      const parts = simulateToolCallStream(chunks);

      // Note: This simulation only tests tool call logic
      // In real implementation, text would also be processed
      const toolParts = parts.filter(p => p.type === "tool-input-start" || p.type === "tool-call");

      expect(toolParts).toHaveLength(2); // start + call
    });

    it("should handle multiple tools with interleaved deltas", () => {
      const chunks: ZaiChatChunk[] = [
        {
          id: "chunk1",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    function: {
                      name: "tool_a",
                      arguments: '{"x"',
                    },
                  },
                  {
                    index: 1,
                    id: "call_2",
                    function: {
                      name: "tool_b",
                      arguments: '{"y"',
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          id: "chunk2",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: ":1}",
                    },
                  },
                  {
                    index: 1,
                    function: {
                      arguments: ":2}",
                    },
                  },
                ],
              },
            },
          ],
        },
      ];

      const parts = simulateToolCallStream(chunks);

      const toolCalls = parts.filter(p => p.type === "tool-call");
      expect(toolCalls).toHaveLength(2);

      expect(toolCalls[0].toolName).toBe("tool_a");
      expect(toolCalls[0].input).toBe('{"x":1}');

      expect(toolCalls[1].toolName).toBe("tool_b");
      expect(toolCalls[1].input).toBe('{"y":2}');
    });
  });
});
