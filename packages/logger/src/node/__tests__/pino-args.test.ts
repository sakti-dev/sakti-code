import { describe, expect, it } from "vite-plus/test";
import { toPinoCall } from "../../node/pino-args.ts";
import type { LogContext } from "../../types.ts";

describe("toPinoCall", () => {
  it("maps to pino (obj, msg) with layer + context merged", () => {
    expect(toPinoCall("hi", { domain: "LLM" }, undefined, "llm")).toEqual([
      { domain: "LLM", layer: "llm" },
      "hi",
    ]);
  });

  it("maps error by folding describeError into obj.error", () => {
    const [obj, msg] = toPinoCall("boom", { domain: "LLM" }, new Error("x"), "llm");
    expect((obj as { error: string }).error).toBe("x");
    expect((obj as { layer: string }).layer).toBe("llm");
    expect(msg).toBe("boom");
  });

  it("nests AI SDK error fields under obj.err (statusCode/responseBody/url/...)", () => {
    const apiErr = Object.assign(new Error("Upstream request failed"), {
      name: "AI_APICallError",
      url: "https://opencode.ai/zen/v1/chat/completions",
      statusCode: 502,
      responseBody: '{"error":"upstream down"}',
      isRetryable: true,
      requestBodyValues: { messages: [] },
    });
    const [obj] = toPinoCall("stream error", {}, apiErr, "llm");
    const err = (obj as { err?: Record<string, unknown> }).err;
    expect(err?.name).toBe("AI_APICallError");
    expect(err?.statusCode).toBe(502);
    expect(err?.responseBody).toBe('{"error":"upstream down"}');
    expect(err?.url).toBe("https://opencode.ai/zen/v1/chat/completions");
    expect(err?.isRetryable).toBe(true);
    // requestBodyValues stays out of the structured fields.
    expect(err?.requestBodyValues).toBeUndefined();
  });

  it("omits error key when no error is passed", () => {
    const [obj] = toPinoCall("w", { attempt: 1 }, undefined, "agent");
    expect((obj as Record<string, unknown>).error).toBeUndefined();
    expect((obj as Record<string, unknown>).layer).toBe("agent");
  });

  it("works with no context", () => {
    const [obj, msg] = toPinoCall("bare", undefined, undefined, "tools");
    expect(obj).toEqual({ layer: "tools" });
    expect(msg).toBe("bare");
  });

  it("does not mutate the caller's context object", () => {
    const ctx: LogContext = { domain: "LLM", n: 1 };
    toPinoCall("hi", ctx, undefined, "llm");
    expect(ctx).toEqual({ domain: "LLM", n: 1 });
    expect("layer" in ctx).toBe(false);
  });
});
