import { describe, expect, it } from "vite-plus/test";
import { calculateCost } from "../cost.ts";
import type { Model, Usage } from "../types.ts";

const freeModel: Model = {
  api: "ai-sdk",
  baseUrl: "https://example.com",
  contextWindow: 200_000,
  cost: { cacheRead: 0.3, cacheWrite: 3.75, input: 3, output: 15 },
  id: "test-model",
  input: ["text"],
  maxTokens: 8192,
  name: "Test",
  provider: "test",
  reasoning: true,
};

function zeroCostUsage(over: Partial<Usage> = {}): Usage {
  return {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: 0,
    output: 0,
    totalTokens: 0,
    ...over,
  };
}

describe("calculateCost", () => {
  it("computes per-field cost from model rates × token counts / 1M", () => {
    const usage = zeroCostUsage({
      cacheRead: 200,
      cacheWrite: 100,
      input: 1000,
      output: 500,
      totalTokens: 1800,
    });
    calculateCost(freeModel, usage);
    // input: (3/1e6) * 1000
    expect(usage.cost.input).toBeCloseTo(0.003, 10);
    // output: (15/1e6) * 500
    expect(usage.cost.output).toBeCloseTo(0.0075, 10);
    // cacheRead: (0.3/1e6) * 200
    expect(usage.cost.cacheRead).toBeCloseTo(0.000_06, 10);
    // cacheWrite (no 1h split): (3.75/1e6) * 100
    expect(usage.cost.cacheWrite).toBeCloseTo(0.000_375, 10);
  });

  it("total is the sum of input + output + cacheRead + cacheWrite", () => {
    const usage = zeroCostUsage({
      cacheRead: 200,
      cacheWrite: 100,
      input: 1000,
      output: 500,
      totalTokens: 1800,
    });
    calculateCost(freeModel, usage);
    const sum = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
    expect(usage.cost.total).toBeCloseTo(sum, 10);
  });

  it("mutates usage.cost in place", () => {
    const usage = zeroCostUsage({
      input: 1000,
      output: 500,
      totalTokens: 1500,
    });
    const returned = calculateCost(freeModel, usage);
    expect(returned).toBe(usage.cost);
    expect(usage.cost.input).toBeCloseTo(0.003, 10);
  });

  it("charges Anthropic 1h cache writes at 2x the base input rate", () => {
    // cacheWrite1h = 50 of the 100 cacheWrite tokens are 1h-retention writes.
    // Anthropic prices those at 2x input rate, not the cacheWrite rate.
    const usage = zeroCostUsage({
      cacheRead: 0,
      cacheWrite: 100,
      cacheWrite1h: 50,
      input: 1000,
      output: 0,
      totalTokens: 1100,
    });
    calculateCost(freeModel, usage);
    // shortWrite = 100 - 50 = 50 at cacheWrite rate (3.75/1e6)
    // longWrite  = 50 at 2x input rate (3 * 2 / 1e6)
    // cacheWrite cost = (3.75 * 50 + 3 * 2 * 50) / 1e6 = (187.5 + 300) / 1e6
    expect(usage.cost.cacheWrite).toBeCloseTo((187.5 + 300) / 1_000_000, 10);
  });

  it("treats missing cacheWrite1h as zero (all writes short-retention)", () => {
    const usage = zeroCostUsage({
      cacheWrite: 100,
      input: 1000,
      output: 0,
      totalTokens: 1100,
    });
    calculateCost(freeModel, usage);
    // no 1h split: (3.75 * 100 + input * 2 * 0) / 1e6
    expect(usage.cost.cacheWrite).toBeCloseTo(0.000_375, 10);
  });

  it("returns zero cost when no tokens used", () => {
    const usage = zeroCostUsage();
    calculateCost(freeModel, usage);
    expect(usage.cost.total).toBe(0);
  });
});
