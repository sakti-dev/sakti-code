import { describe, expect, it } from "vite-plus/test";
import type { MessagePart } from "~/stores/types.ts";
import { resolvePartStreaming } from "../message-part.tsx";

function textPart(text: string, isStreaming?: boolean): MessagePart {
  return { type: "text", text, ...(isStreaming === undefined ? {} : { isStreaming }) };
}

function thinkingPart(text: string, isStreaming?: boolean): MessagePart {
  return { type: "thinking", text, ...(isStreaming === undefined ? {} : { isStreaming }) };
}

function toolPart(isStreaming?: boolean): MessagePart {
  return {
    type: "tool_call",
    toolCallId: "tc1",
    toolName: "read",
    input: {},
    status: "done",
    ...(isStreaming === undefined ? {} : { isStreaming }),
  };
}

describe("resolvePartStreaming", () => {
  it("returns true when part explicitly has isStreaming: true", () => {
    expect(resolvePartStreaming(textPart("hello", true), false)).toBe(true);
  });

  it("returns true when part explicitly has isStreaming: true even if message is not streaming", () => {
    expect(resolvePartStreaming(textPart("hello", true), false)).toBe(true);
  });

  it("returns false when part explicitly has isStreaming: false", () => {
    expect(resolvePartStreaming(thinkingPart("thought", false), true)).toBe(false);
  });

  it("returns false when part explicitly has isStreaming: false even if message is streaming", () => {
    expect(resolvePartStreaming(toolPart(false), true)).toBe(false);
  });

  it("falls back to message streaming when part.isStreaming is undefined", () => {
    expect(resolvePartStreaming(textPart("hello"), true)).toBe(true);
  });

  it("returns false when part.isStreaming is undefined and message is not streaming", () => {
    expect(resolvePartStreaming(textPart("hello"), false)).toBe(false);
  });

  it("completed message's part during active session stream returns false", () => {
    // Simulates: session is streaming turn N, but turn N-1's completed message
    // has msg.isStreaming = false. Even though the session is active, this
    // part should NOT show the caret.
    const completedMsgPart = textPart("old answer"); // isStreaming: undefined
    expect(resolvePartStreaming(completedMsgPart, false)).toBe(false);
  });

  it("previous part in streaming message returns false (explicitly set)", () => {
    // When a new text part starts streaming, the store sets the previous
    // part's isStreaming to false explicitly.
    const previousPart = thinkingPart("thought", false);
    expect(resolvePartStreaming(previousPart, true)).toBe(false);
  });

  it("active streaming part in streaming message returns true", () => {
    const activePart = textPart("partial answ", true);
    expect(resolvePartStreaming(activePart, true)).toBe(true);
  });

  it("hydrated part (never streamed) in completed message returns false", () => {
    const hydratedPart = textPart("loaded from server");
    expect(resolvePartStreaming(hydratedPart, false)).toBe(false);
  });
});
