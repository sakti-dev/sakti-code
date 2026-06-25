import { describe, expect, it } from "vitest";
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
    const [obj, msg] = toPinoCall(
      "boom",
      { domain: "LLM" },
      new Error("x"),
      "llm"
    );
    expect((obj as { error: string }).error).toBe("x");
    expect((obj as { layer: string }).layer).toBe("llm");
    expect(msg).toBe("boom");
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
