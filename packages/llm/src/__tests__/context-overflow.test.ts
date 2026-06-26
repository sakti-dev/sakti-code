import { describe, expect, it } from "vitest";
import { isContextOverflow } from "../context-overflow.ts";
import type { AssistantMessage } from "../types.ts";

const usage = (input: number, output = 1) => ({
  input,
  output,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: input + output,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

function asst(
  stopReason: AssistantMessage["stopReason"],
  overrides: Partial<AssistantMessage> = {}
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai",
    provider: "p",
    model: "m",
    usage: usage(10),
    stopReason,
    timestamp: 0,
    ...overrides,
  } as AssistantMessage;
}

describe("isContextOverflow", () => {
  it("Case 1: error whose message matches an overflow pattern", () => {
    expect(
      isContextOverflow(asst("error", { errorMessage: "prompt is too long" }))
    ).toBe(true);
    expect(
      isContextOverflow(
        asst("error", { errorMessage: "context_length_exceeded" })
      )
    ).toBe(true);
    expect(
      isContextOverflow(
        asst("error", { errorMessage: "maximum context length is 8192 tokens" })
      )
    ).toBe(true);
  });

  it("Case 1: rate-limit / throttling errors are NOT overflow", () => {
    expect(
      isContextOverflow(asst("error", { errorMessage: "rate limit exceeded" }))
    ).toBe(false);
    expect(
      isContextOverflow(asst("error", { errorMessage: "too many requests" }))
    ).toBe(false);
    // Bedrock throttling prefix is explicitly excluded even though the body
    // would match the generic /too many tokens/i overflow pattern.
    expect(
      isContextOverflow(
        asst("error", { errorMessage: "Throttling error: Too many tokens" })
      )
    ).toBe(false);
  });

  it("Case 1: generic 'too many tokens' (no throttling prefix) IS overflow", () => {
    expect(
      isContextOverflow(
        asst("error", { errorMessage: "Too many tokens, please wait" })
      )
    ).toBe(true);
  });

  it("Case 1: an error with an unrelated message is not overflow", () => {
    expect(
      isContextOverflow(
        asst("error", { errorMessage: "internal server error" })
      )
    ).toBe(false);
  });

  it("Case 2: silent z.ai overflow — stop + input > contextWindow", () => {
    expect(isContextOverflow(asst("stop", { usage: usage(2000) }), 1000)).toBe(
      true
    );
    expect(isContextOverflow(asst("stop", { usage: usage(500) }), 1000)).toBe(
      false
    );
  });

  it("Case 2: cacheRead counts toward the input total", () => {
    expect(
      isContextOverflow(
        asst("stop", { usage: { ...usage(500), cacheRead: 600 } }),
        1000
      )
    ).toBe(true);
  });

  it("Case 3: MiMo length-stop — length + output 0 + input fills window", () => {
    expect(
      isContextOverflow(asst("length", { usage: usage(990, 0) }), 1000)
    ).toBe(true);
    expect(
      isContextOverflow(asst("length", { usage: usage(500, 0) }), 1000)
    ).toBe(false);
    // length with non-zero output is not overflow
    expect(
      isContextOverflow(asst("length", { usage: usage(990, 50) }), 1000)
    ).toBe(false);
  });

  it("returns false for a normal stop within window", () => {
    expect(isContextOverflow(asst("stop", { usage: usage(100) }), 1000)).toBe(
      false
    );
  });

  it("returns false when contextWindow is not provided (silent cases skipped)", () => {
    expect(isContextOverflow(asst("stop", { usage: usage(2000) }))).toBe(false);
  });
});
