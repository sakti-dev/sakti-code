/**
 * Tests for stream.ts - Stream transformation utilities
 */

import type { LanguageModelV1StreamPart } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { ToolCallAccumulator, mapFinishReason, mapUsage } from "./stream";

describe("ToolCallAccumulator", () => {
  it("should accumulate tool call deltas", () => {
    const accumulator = new ToolCallAccumulator();

    // First chunk with tool call start
    const startChunk: LanguageModelV1StreamPart = {
      type: "tool-call-delta",
      toolCallType: "function",
      toolCallId: "call_123",
      toolName: "getWeather",
      argsTextDelta: "",
    };

    const result1 = accumulator.accumulate(
      startChunk as LanguageModelV1StreamPart & { type: "tool-call-delta" }
    );
    expect(result1).toBeNull(); // Not complete yet

    // Second chunk with partial arguments
    const deltaChunk: LanguageModelV1StreamPart = {
      type: "tool-call-delta",
      toolCallType: "function",
      toolCallId: "call_123",
      toolName: "getWeather",
      argsTextDelta: '{"loc',
    };

    const result2 = accumulator.accumulate(
      deltaChunk as LanguageModelV1StreamPart & { type: "tool-call-delta" }
    );
    expect(result2).toBeNull();

    // Final chunk with complete arguments
    const finalChunk: LanguageModelV1StreamPart = {
      type: "tool-call-delta",
      toolCallType: "function",
      toolCallId: "call_123",
      toolName: "getWeather",
      argsTextDelta: 'ation":"Tokyo"}',
    };

    const result3 = accumulator.accumulate(
      finalChunk as LanguageModelV1StreamPart & { type: "tool-call-delta" }
    );
    expect(result3).not.toBeNull();
    expect(result3?.toolCallId).toBe("call_123");
    expect(result3?.toolName).toBe("getWeather");
    expect(result3?.args).toBe('{"location":"Tokyo"}');
  });

  it("should handle multiple concurrent tool calls", () => {
    const accumulator = new ToolCallAccumulator();

    // First tool call
    accumulator.accumulate({
      type: "tool-call-delta",
      toolCallType: "function",
      toolCallId: "call_1",
      toolName: "getWeather",
      argsTextDelta: '{"city"',
    } as LanguageModelV1StreamPart & { type: "tool-call-delta" });

    // Second tool call
    accumulator.accumulate({
      type: "tool-call-delta",
      toolCallType: "function",
      toolCallId: "call_2",
      toolName: "getTime",
      argsTextDelta: '{"tz"',
    } as LanguageModelV1StreamPart & { type: "tool-call-delta" });

    // Complete first tool call
    const result1 = accumulator.accumulate({
      type: "tool-call-delta",
      toolCallType: "function",
      toolCallId: "call_1",
      argsTextDelta: ': "Tokyo"}',
    } as LanguageModelV1StreamPart & { type: "tool-call-delta" });

    expect(result1).not.toBeNull();
    expect(result1?.toolCallId).toBe("call_1");

    // Complete second tool call
    const result2 = accumulator.accumulate({
      type: "tool-call-delta",
      toolCallType: "function",
      toolCallId: "call_2",
      argsTextDelta: ': "UTC"}',
    } as LanguageModelV1StreamPart & { type: "tool-call-delta" });

    expect(result2).not.toBeNull();
    expect(result2?.toolCallId).toBe("call_2");
  });

  it("should reset accumulator state", () => {
    const accumulator = new ToolCallAccumulator();

    accumulator.accumulate({
      type: "tool-call-delta",
      toolCallType: "function",
      toolCallId: "call_1",
      toolName: "test",
      argsTextDelta: '{"partial"',
    } as LanguageModelV1StreamPart & { type: "tool-call-delta" });

    accumulator.reset();

    // Start fresh after reset
    const result = accumulator.accumulate({
      type: "tool-call-delta",
      toolCallType: "function",
      toolCallId: "call_2",
      toolName: "another",
      argsTextDelta: "{}",
    } as LanguageModelV1StreamPart & { type: "tool-call-delta" });

    expect(result).not.toBeNull();
    expect(result?.toolCallId).toBe("call_2");
  });
});

describe("mapUsage", () => {
  it("should map AI SDK usage to TanStack format", () => {
    const usage = {
      promptTokens: 10,
      completionTokens: 20,
    };

    const result = mapUsage(usage);

    expect(result.promptTokens).toBe(10);
    expect(result.completionTokens).toBe(20);
    expect(result.totalTokens).toBe(30);
  });

  it("should handle zero usage", () => {
    const result = mapUsage({
      promptTokens: 0,
      completionTokens: 0,
    });

    expect(result.promptTokens).toBe(0);
    expect(result.completionTokens).toBe(0);
    expect(result.totalTokens).toBe(0);
  });

  it("should handle missing values", () => {
    const result = mapUsage({
      promptTokens: undefined,
      completionTokens: undefined,
    });

    expect(result.promptTokens).toBe(0);
    expect(result.completionTokens).toBe(0);
    expect(result.totalTokens).toBe(0);
  });
});

describe("mapFinishReason", () => {
  it("should map standard finish reasons", () => {
    expect(mapFinishReason("stop")).toBe("stop");
    expect(mapFinishReason("length")).toBe("length");
    expect(mapFinishReason("content-filter")).toBe("content_filter");
    expect(mapFinishReason("tool-calls")).toBe("tool_calls");
  });

  it("should handle unknown finish reasons", () => {
    expect(mapFinishReason("unknown")).toBe("stop");
    expect(mapFinishReason(undefined)).toBe("stop");
    expect(mapFinishReason("")).toBe("stop");
  });
});
