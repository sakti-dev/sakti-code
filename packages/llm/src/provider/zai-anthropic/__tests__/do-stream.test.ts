import { describe, expect, it } from "vitest";
import { ZaiLanguageModel } from "../zai-language-model.ts";
import { sseResponse } from "./__fixtures__/sse-helper.ts";

const make = (events: unknown[]) =>
  new ZaiLanguageModel("glm-5.2", {
    baseURL: "https://api.z.ai/api/anthropic",
    provider: "zai.messages",
    headers: async () => ({}),
    fetch: (async () => sseResponse(events)) as unknown as typeof fetch,
  });

const collect = async (stream: ReadableStream<unknown>) => {
  const parts: unknown[] = [];
  for await (const p of stream) {
    parts.push(p);
  }
  return parts;
};

describe("ZaiLanguageModel.doStream — text + reasoning", () => {
  it("emits reasoning-start/delta/end then text-start/delta/end then finish", async () => {
    const model = make([
      {
        type: "message_start",
        message: { id: "m", model: "glm-5.2", usage: { input_tokens: 5 } },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "hmm" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "sig" },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "he" },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "llo" },
      },
      { type: "content_block_stop", index: 1 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 3 },
      },
      { type: "message_stop" },
    ]);

    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    const parts = await collect(stream);
    const types = (parts as { type: string }[]).map((p) => p.type);
    expect(types).toEqual([
      "stream-start",
      "response-metadata",
      "reasoning-start",
      "reasoning-delta",
      "reasoning-delta",
      "reasoning-end",
      "text-start",
      "text-delta",
      "text-delta",
      "text-end",
      "finish",
    ]);
  });
});

describe("ZaiLanguageModel.doStream — tool_use", () => {
  it("assembles tool_use input from input_json_delta and emits tool-call", async () => {
    const model = make([
      {
        type: "message_start",
        message: { id: "m", model: "glm-5.2", usage: { input_tokens: 5 } },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tu_1", name: "Read" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"path":"a' },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '.ts"}' },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 6 },
      },
      { type: "message_stop" },
    ]);

    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    const parts = await collect(stream);
    const toolCall = (parts as { type: string }[]).find(
      (p) => p.type === "tool-call"
    );
    expect(toolCall).toMatchObject({
      toolCallId: "tu_1",
      toolName: "Read",
      input: '{"path":"a.ts"}',
    });
    const types = (parts as { type: string }[]).map((p) => p.type);
    expect(types).toContain("tool-input-start");
    expect(types).toContain("tool-input-delta");
    expect(types).toContain("tool-input-end");
    expect(types).toContain("tool-call");
  });
});

describe("ZaiLanguageModel.doStream — error/finish/usage/redacted_thinking", () => {
  it("emits error part + finishReason=error on mid-stream error event", async () => {
    const model = make([
      {
        type: "message_start",
        message: { id: "m", model: "glm-5.2", usage: { input_tokens: 5 } },
      },
      { type: "error", error: { type: "overloaded_error", message: "busy" } },
      { type: "message_stop" },
    ]);

    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    const parts = await collect(stream);
    const errorPart = (parts as { type: string }[]).find(
      (p) => p.type === "error"
    );
    expect(errorPart).toBeDefined();
    const finish = (
      parts as { type: string; finishReason: { unified: string } }[]
    ).find((p) => p.type === "finish");
    expect(finish?.finishReason.unified).toBe("error");
  });

  it("accumulates cacheRead/cacheWrite from message_start + message_delta", async () => {
    const model = make([
      {
        type: "message_start",
        message: {
          id: "m",
          model: "glm-5.2",
          usage: {
            input_tokens: 10,
            cache_creation_input_tokens: 20,
            cache_read_input_tokens: 5,
          },
        },
      },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 3 },
      },
      { type: "message_stop" },
    ]);

    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    const parts = await collect(stream);
    const finish = (
      parts as {
        type: string;
        usage: {
          inputTokens: {
            noCache: number;
            cacheRead: number;
            cacheWrite: number;
          };
        };
      }[]
    ).find((p) => p.type === "finish");
    expect(finish?.usage.inputTokens.noCache).toBe(10);
    expect(finish?.usage.inputTokens.cacheRead).toBe(5);
    expect(finish?.usage.inputTokens.cacheWrite).toBe(20);
  });

  it("treats redacted_thinking block as reasoning with redactedData metadata", async () => {
    const model = make([
      {
        type: "message_start",
        message: { id: "m", model: "glm-5.2", usage: { input_tokens: 5 } },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "redacted_thinking", data: "blob" },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 0 },
      },
      { type: "message_stop" },
    ]);

    const { stream } = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    const parts = await collect(stream);
    const start = (
      parts as {
        type: string;
        providerMetadata?: { zai?: { redactedData?: string } };
      }[]
    ).find((p) => p.type === "reasoning-start");
    expect(start?.providerMetadata?.zai?.redactedData).toBe("blob");
  });
});
