import { describe, expect, it } from "vite-plus/test";
import type { UIMessage } from "~/stores/types.ts";
import { flattenParts, getNonThinkingParts } from "../thinking-helpers.ts";

function msg(parts: UIMessage["parts"]): UIMessage {
  return {
    content: "",
    id: "m1",
    isStreaming: false,
    parts,
    role: "assistant",
    timestamp: 0,
  };
}

const thinking = (text: string, extra?: Record<string, unknown>) => ({
  type: "thinking" as const,
  text,
  ...extra,
});

const text = (t: string) => ({ type: "text" as const, text: t });

const toolCall = () => ({
  type: "tool_call" as const,
  toolCallId: "tc1",
  toolName: "bash",
  input: {},
  status: "done" as const,
});

describe("getNonThinkingParts", () => {
  it("filters out thinking parts", () => {
    const parts = [thinking("Hmm"), text("hello"), toolCall()];
    const result = getNonThinkingParts(parts);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.type)).toEqual(["text", "tool_call"]);
  });

  it("keeps all parts when no thinking", () => {
    const parts = [text("hello"), toolCall()];
    expect(getNonThinkingParts(parts)).toHaveLength(2);
  });

  it("returns empty when all thinking", () => {
    const parts = [thinking("a"), thinking("b")];
    expect(getNonThinkingParts(parts)).toHaveLength(0);
  });
});

describe("flattenParts", () => {
  it("flattens all parts from multiple messages in order", () => {
    const messages = [msg([thinking("a"), text("b")]), msg([toolCall()])];
    const result = flattenParts(messages);
    expect(result).toHaveLength(3);
    expect(result.map((p) => p.type)).toEqual(["thinking", "text", "tool_call"]);
  });

  it("returns empty for empty input", () => {
    expect(flattenParts([])).toEqual([]);
  });

  it("preserves the exact part object references (no cloning)", () => {
    const t = text("b");
    const tc = toolCall();
    const messages = [msg([thinking("a"), t]), msg([tc])];
    const result = flattenParts(messages);
    // Referential identity must hold — the timeline groups these parts and the
    // view must not remount when the same part object is reused.
    expect(result[1]).toBe(t);
    expect(result[2]).toBe(tc);
  });
});
