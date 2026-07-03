import { describe, expect, it } from "vite-plus/test";
import type { UIMessage } from "~/stores/types.ts";
import { getNonThinkingParts, getThinkingParts } from "../thinking-helpers.ts";

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

describe("getThinkingParts", () => {
  it("extracts thinking parts with text", () => {
    const messages = [
      msg([thinking("Hmm"), text("hello")]),
      msg([thinking("Let me think"), toolCall()]),
    ];
    const result = getThinkingParts(messages);
    expect(result).toHaveLength(2);
    expect(result[0]?.text).toBe("Hmm");
    expect(result[1]?.text).toBe("Let me think");
  });

  it("skips empty thinking parts", () => {
    const messages = [msg([thinking("   "), text("hello")])];
    expect(getThinkingParts(messages)).toHaveLength(0);
  });

  it("skips messages with no thinking", () => {
    const messages = [msg([text("hello"), toolCall()])];
    expect(getThinkingParts(messages)).toHaveLength(0);
  });

  it("preserves order across messages", () => {
    const messages = [
      msg([thinking("first")]),
      msg([text("intermediate")]),
      msg([thinking("second")]),
    ];
    const result = getThinkingParts(messages);
    expect(result).toHaveLength(2);
    expect(result[0]?.text).toBe("first");
    expect(result[1]?.text).toBe("second");
  });
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
