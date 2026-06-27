import { describe, expect, it } from "vitest";
import { convertZaiUsage } from "../convert-zai-usage.ts";

describe("convertZaiUsage", () => {
  it("maps input/output/cache tokens to the V4 nested shape", () => {
    const usage = convertZaiUsage({
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 5,
      },
    });
    expect(usage.inputTokens).toEqual({
      total: 100 + 20 + 5,
      noCache: 100,
      cacheRead: 5,
      cacheWrite: 20,
    });
    expect(usage.outputTokens).toEqual({
      total: 50,
      text: undefined,
      reasoning: undefined,
    });
  });

  it("noCache = input_tokens (B1 invariant for cost calculation)", () => {
    const usage = convertZaiUsage({
      usage: { input_tokens: 42, output_tokens: 0 },
    });
    expect(usage.inputTokens.noCache).toBe(42);
    expect(usage.inputTokens.total).toBe(42);
  });

  it("treats nullish cache fields as 0", () => {
    const usage = convertZaiUsage({
      usage: {
        input_tokens: 10,
        output_tokens: 3,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
    });
    expect(usage.inputTokens.cacheRead).toBe(0);
    expect(usage.inputTokens.cacheWrite).toBe(0);
  });
});
