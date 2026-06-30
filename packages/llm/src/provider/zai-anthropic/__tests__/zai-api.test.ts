import { describe, expect, it } from "vite-plus/test";
import { zaiChunkZod, zaiResponseZod } from "../zai-api.ts";

describe("zai-anthropic wire schemas (minimal subset)", () => {
  it("parses a non-stream response with text + thinking + tool_use", () => {
    const parsed = zaiResponseZod.parse({
      id: "msg_1",
      model: "glm-5.2",
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "hello" },
        { type: "thinking", thinking: "hmm", signature: "sig" },
        { type: "tool_use", id: "tu_1", name: "Read", input: { path: "a" } },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    expect(parsed.content[1]).toMatchObject({ type: "thinking" });
  });

  it("parses a content_block_delta input_json_delta chunk", () => {
    const parsed = zaiChunkZod.parse({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"path":"a' },
    });
    if (parsed.type !== "content_block_delta") {
      throw new Error(`expected content_block_delta, got ${parsed.type}`);
    }
    expect(parsed.delta.type).toBe("input_json_delta");
  });

  it("rejects an unsupported block type (mcp_tool_use)", () => {
    expect(() =>
      zaiResponseZod.parse({
        id: "x",
        model: "x",
        stop_reason: "end_turn",
        content: [
          {
            type: "mcp_tool_use",
            id: "x",
            name: "x",
            server_name: "s",
            input: {},
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    ).toThrow();
  });
});
