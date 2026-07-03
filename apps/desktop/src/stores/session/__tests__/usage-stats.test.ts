import { describe, expect, it } from "vite-plus/test";
import type { Turn, UIMessage } from "../../types.ts";
import { aggregateUsage, formatCost, formatTokens } from "../usage-stats.ts";

function assistant(over: Partial<NonNullable<UIMessage["usage"]>>): UIMessage {
  return {
    content: "x",
    id: "m",
    isStreaming: false,
    parts: [{ text: "x", type: "text" }],
    role: "assistant",
    timestamp: 0,
    usage: {
      cost: 0,
      input: 0,
      output: 0,
      ...over,
    },
  };
}

function makeTurn(msgs: UIMessage[]): Turn {
  return {
    endedAt: null,
    error: null,
    id: crypto.randomUUID(),
    intermediateCount: 0,
    intermediates: msgs.slice(0, -1),
    intermediatesLoaded: false,
    loadedMessageIds: [],
    summary: msgs.at(-1) ?? null,
    startedAt: null,
    turnId: null,
    userMessage: null,
    working: false,
  };
}

describe("aggregateUsage", () => {
  it("sums cost/input/output across assistant messages", () => {
    const turns: Turn[] = [
      makeTurn([
        assistant({ cost: 0.001, input: 100, output: 50 }),
        assistant({ cost: 0.002, input: 200, output: 80 }),
      ]),
    ];
    const totals = aggregateUsage(turns);
    expect(totals.cost).toBeCloseTo(0.003, 10);
    expect(totals.input).toBe(300);
    expect(totals.output).toBe(130);
  });

  it("sums reasoningTokens (defaults to 0 when absent)", () => {
    const turns: Turn[] = [makeTurn([assistant({ reasoningTokens: 300 }), assistant({})])];
    const totals = aggregateUsage(turns);
    expect(totals.reasoningTokens).toBe(300);
  });

  it("ignores non-assistant messages and messages without usage", () => {
    const turns: Turn[] = [
      makeTurn([
        {
          content: "hi",
          id: "u",
          isStreaming: false,
          parts: [{ text: "hi", type: "text" }],
          role: "user",
          timestamp: 0,
        },
        assistant({ cost: 0.01, input: 5, output: 5 }),
      ]),
    ];
    const totals = aggregateUsage(turns);
    expect(totals.cost).toBeCloseTo(0.01, 10);
    expect(totals.input).toBe(5);
  });

  it("returns zeros for empty turns", () => {
    const totals = aggregateUsage([]);
    expect(totals).toEqual({
      cost: 0,
      input: 0,
      output: 0,
      reasoningTokens: 0,
    });
  });
});

describe("formatTokens", () => {
  it("renders small counts verbatim", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });
  it("renders thousands with a k suffix", () => {
    expect(formatTokens(1234)).toBe("1.2k");
    expect(formatTokens(12_345)).toBe("12k");
  });
});

describe("formatCost", () => {
  it("renders zero and small fractional costs", () => {
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(0.001_23)).toBe("$0.0012");
    expect(formatCost(1.234)).toBe("$1.23");
  });
});
