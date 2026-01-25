/**
 * Tests for adapters/text.ts - Main MastraTextAdapter implementation
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test files use any for simplicity */

import type { LanguageModelV1StreamPart } from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import type { MastraLanguageModel } from "./text";
import { MastraTextAdapter } from "./text";

// Mock Mastra language model
const createMockMastraModel = (
  streamParts: LanguageModelV1StreamPart[] = []
): MastraLanguageModel => ({
  specificationVersion: "v1",
  modelId: "test-model",
  doStream: vi.fn().mockResolvedValue({
    stream: new ReadableStream({
      async start(controller) {
        for (const part of streamParts) {
          controller.enqueue(part);
        }
        controller.close();
      },
    }),
  }),
  doGenerate: vi.fn().mockResolvedValue({
    stream: new ReadableStream({
      async start(controller) {
        for (const part of streamParts) {
          controller.enqueue(part);
        }
        controller.close();
      },
    }),
  }),
});

describe("MastraTextAdapter", () => {
  describe("constructor", () => {
    it("should create adapter with model ID", () => {
      const adapter = new MastraTextAdapter("openai/gpt-4o", {});

      expect(adapter.model).toBe("openai/gpt-4o");
      expect(adapter.name).toBe("mastra");
    });

    it("should accept optional mastraModel parameter", () => {
      const mockModel = createMockMastraModel();
      const adapter = new MastraTextAdapter("openai/gpt-4o", {}, mockModel);

      expect(adapter.model).toBe("openai/gpt-4o");
    });
  });

  describe("setModel", () => {
    it("should set the Mastra language model", () => {
      const adapter = new MastraTextAdapter("openai/gpt-4o", {});
      const mockModel = createMockMastraModel();

      adapter.setModel(mockModel);

      // Model is now set, should not throw in chatStream
      expect(() => adapter.setModel(mockModel)).not.toThrow();
    });
  });

  describe("chatStream", () => {
    it("should return error chunk when model is not set", async () => {
      const adapter = new MastraTextAdapter("openai/gpt-4o", {});

      const chunks: any[] = [];
      for await (const chunk of adapter.chatStream({
        model: adapter.model,
        messages: [{ role: "user", content: "Hello" }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        type: "error",
        error: {
          code: "MODEL_NOT_SET",
        },
      });
    });

    it("should stream text deltas", async () => {
      const mockModel = createMockMastraModel([
        { type: "text-delta", textDelta: "Hello" },
        { type: "text-delta", textDelta: " world" },
        { type: "finish", finishReason: "stop", usage: { promptTokens: 10, completionTokens: 5 } },
      ]);

      const adapter = new MastraTextAdapter("openai/gpt-4o", {}, mockModel);

      const chunks: any[] = [];
      for await (const chunk of adapter.chatStream({
        model: adapter.model,
        messages: [{ role: "user", content: "Hello" }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);

      expect(chunks[0].type).toBe("content");
      expect(chunks[0].delta).toBe("Hello");
      expect(chunks[0].content).toBe("Hello");

      expect(chunks[1].type).toBe("content");
      expect(chunks[1].delta).toBe(" world");
      expect(chunks[1].content).toBe("Hello world");

      expect(chunks[2].type).toBe("done");
      expect(chunks[2].finishReason).toBe("stop");
    });

    it("should handle tool calls", async () => {
      const mockModel = createMockMastraModel([
        {
          type: "tool-call-delta",
          toolCallType: "function",
          toolCallId: "call_123",
          toolName: "getWeather",
          argsTextDelta: '{"loc',
        },
        {
          type: "tool-call-delta",
          toolCallType: "function",
          toolCallId: "call_123",
          toolName: "getWeather",
          argsTextDelta: 'ation":"Tokyo"}',
        },
        {
          type: "finish",
          finishReason: "tool-calls",
          usage: { promptTokens: 10, completionTokens: 20 },
        },
      ]);

      const adapter = new MastraTextAdapter("openai/gpt-4o", {}, mockModel);

      const chunks: any[] = [];
      for await (const chunk of adapter.chatStream({
        model: adapter.model,
        messages: [{ role: "user", content: "What is the weather?" }],
        tools: [
          {
            name: "getWeather",
            description: "Get weather",
            inputSchema: {
              type: "object",
              properties: { location: { type: "string" } },
              required: ["location"],
            },
          },
        ],
      })) {
        chunks.push(chunk);
      }

      // Should have finish chunk
      const doneChunk = chunks.find((c: any) => c.type === "done");
      expect(doneChunk).toBeDefined();
      expect(doneChunk.finishReason).toBe("tool_calls");
    });

    it("should map usage correctly", async () => {
      const mockModel = createMockMastraModel([
        { type: "text-delta", textDelta: "Hello" },
        {
          type: "finish",
          finishReason: "stop",
          usage: { promptTokens: 15, completionTokens: 8 },
        },
      ]);

      const adapter = new MastraTextAdapter("openai/gpt-4o", {}, mockModel);

      const chunks: any[] = [];
      for await (const chunk of adapter.chatStream({
        model: adapter.model,
        messages: [{ role: "user", content: "Hello" }],
      })) {
        chunks.push(chunk);
      }

      const doneChunk = chunks.find((c: any) => c.type === "done");
      expect(doneChunk.usage).toEqual({
        promptTokens: 15,
        completionTokens: 8,
        totalTokens: 23,
      });
    });

    it("should handle errors from the model", async () => {
      const mockModel = createMockMastraModel([{ type: "error", error: "API error occurred" }]);

      const adapter = new MastraTextAdapter("openai/gpt-4o", {}, mockModel);

      const chunks: any[] = [];
      for await (const chunk of adapter.chatStream({
        model: adapter.model,
        messages: [{ role: "user", content: "Hello" }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("error");
      expect(chunks[0].error.message).toContain("API error");
    });
  });

  describe("generateId", () => {
    it("should generate unique IDs", () => {
      const adapter = new MastraTextAdapter("openai/gpt-4o", {}, createMockMastraModel());

      const id1 = (adapter as any).generateId();
      const id2 = (adapter as any).generateId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^mastra-\d+-[a-z0-9]+$/);
    });
  });

  describe("mapFinishReason", () => {
    it("should map standard finish reasons", () => {
      const adapter = new MastraTextAdapter("openai/gpt-4o", {}, createMockMastraModel());

      expect((adapter as any).mapFinishReason("stop")).toBe("stop");
      expect((adapter as any).mapFinishReason("length")).toBe("length");
      expect((adapter as any).mapFinishReason("content-filter")).toBe("content_filter");
      expect((adapter as any).mapFinishReason("tool-calls")).toBe("tool_calls");
    });

    it("should default to stop for unknown reasons", () => {
      const adapter = new MastraTextAdapter("openai/gpt-4o", {}, createMockMastraModel());

      expect((adapter as any).mapFinishReason("unknown")).toBe("stop");
      expect((adapter as any).mapFinishReason(undefined)).toBe("stop");
      expect((adapter as any).mapFinishReason(null)).toBe("stop");
    });
  });
});
