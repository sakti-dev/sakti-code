import { describe, expect, it } from "vite-plus/test";
import { mapZaiResponse } from "../map-zai-response.ts";

describe("mapZaiResponse", () => {
  it("maps text + thinking + tool_use content + usage", () => {
    const result = mapZaiResponse({
      response: {
        id: "msg_1",
        model: "glm-5.2",
        stop_reason: "tool_use",
        content: [
          { type: "thinking", thinking: "hmm", signature: "sig" },
          { type: "text", text: "ans" },
          { type: "tool_use", id: "tu_1", name: "Read", input: { path: "a" } },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 5,
        },
      },
    });
    expect(result.content.map((c) => c.type)).toEqual(["reasoning", "text", "tool-call"]);
    expect(result.finishReason.unified).toBe("tool-calls");
    expect(result.finishReason.raw).toBe("tool_use");
    expect(result.usage.inputTokens.noCache).toBe(100);
    expect(result.usage.inputTokens.cacheRead).toBe(5);
    expect(result.usage.inputTokens.cacheWrite).toBe(20);
    expect(result.warnings).toEqual([]);
  });

  it("stashes signature on providerMetadata.zai", () => {
    const result = mapZaiResponse({
      response: {
        id: "m",
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "thinking", thinking: "t", signature: "s" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    expect(result.content[0]!).toMatchObject({ type: "reasoning", text: "t" });
    if (result.content[0]!.type !== "reasoning") {
      throw new Error("expected reasoning");
    }
    expect(result.content[0]!.providerMetadata?.zai).toEqual({
      signature: "s",
    });
  });

  it("emits redacted thinking as empty reasoning with redactedData metadata", () => {
    const result = mapZaiResponse({
      response: {
        id: "m",
        model: "glm-5.2",
        stop_reason: "end_turn",
        content: [{ type: "redacted_thinking", data: "opaque-blob" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    expect(result.content[0]!).toMatchObject({
      type: "reasoning",
      text: "",
    });
    if (result.content[0]!.type !== "reasoning") {
      throw new Error("expected reasoning");
    }
    expect(result.content[0]!.providerMetadata?.zai).toEqual({
      redactedData: "opaque-blob",
    });
  });

  it("stringifies tool_use input", () => {
    const result = mapZaiResponse({
      response: {
        id: "m",
        model: "glm-5.2",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu", name: "Read", input: { path: "x" } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    expect(result.content[0]!).toMatchObject({
      type: "tool-call",
      toolCallId: "tu",
      toolName: "Read",
      input: '{"path":"x"}',
    });
  });
});
