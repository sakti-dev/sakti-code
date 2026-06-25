import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { FinishReason, LanguageModelUsage } from "ai";
import { describe, expect, it } from "vitest";
import { mapFinishReason, mapUsage, streamWithModel } from "../stream.ts";
import type { Model, StopReason } from "../types.ts";

const model: Model = {
  api: "ai-sdk",
  baseUrl: "https://example.com",
  contextWindow: 200_000,
  cost: { cacheRead: 0.3, cacheWrite: 3.75, input: 3, output: 15 },
  id: "test-model",
  input: ["text"],
  maxTokens: 8192,
  name: "Test",
  provider: "testprov",
  reasoning: true,
};

function sampleUsage(
  over: Partial<LanguageModelUsage> = {}
): LanguageModelUsage {
  return {
    inputTokenDetails: {
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      noCacheTokens: 85,
    },
    inputTokens: 100,
    outputTokenDetails: { reasoningTokens: 0, textTokens: 50 },
    outputTokens: 50,
    totalTokens: 150,
    ...over,
  };
}

// ─── mapUsage (pure) ─────────────────────────────────────────────────────────

describe("mapUsage", () => {
  // sampleUsage() models a cached turn: inputTokens=100 is the INCLUSIVE
  // total; noCacheTokens=85 is the non-cached subset (100 = 85 + 10 read + 5
  // write). mapUsage must use noCacheTokens for usage.input so cost does not
  // double-charge cached tokens (they're priced separately via cacheRead/cacheWrite).
  it("maps noCacheTokens→input, outputTokens→output, totalTokens through", () => {
    const usage = mapUsage(sampleUsage(), model);
    expect(usage.input).toBe(85);
    expect(usage.output).toBe(50);
    expect(usage.totalTokens).toBe(150);
  });

  it("maps cacheReadTokens/cacheWriteTokens from inputTokenDetails", () => {
    const usage = mapUsage(sampleUsage(), model);
    expect(usage.cacheRead).toBe(10);
    expect(usage.cacheWrite).toBe(5);
  });

  it("populates cost via calculateCost (non-cached input, no double-count)", () => {
    const usage = mapUsage(sampleUsage(), model);
    // input cost uses the NON-cached subset (85), not the inclusive 100
    // input: (3/1e6) * 85 = 0.000255
    expect(usage.cost.input).toBeCloseTo(0.000_255, 10);
    // output: (15/1e6) * 50 = 0.00075
    expect(usage.cost.output).toBeCloseTo(0.000_75, 10);
    expect(usage.cost.total).toBeCloseTo(
      0.000_255 + 0.000_75 + usage.cost.cacheRead + usage.cost.cacheWrite,
      10
    );
  });

  it("uses noCacheTokens (not inclusive inputTokens) to avoid double-counting cache in cost", () => {
    const modelNoOp: Model = {
      api: "ai-sdk",
      baseUrl: "",
      contextWindow: 200_000,
      cost: { cacheRead: 0.3, cacheWrite: 3.75, input: 3, output: 15 },
      id: "test",
      input: ["text"],
      maxTokens: 8192,
      name: "test",
      provider: "anthropic",
      reasoning: false,
    };
    // @ai-sdk's LanguageModelUsage: inputTokens is the inclusive total
    // (800 fresh + 150 cache-read + 50 cache-write = 1000); noCacheTokens is
    // the non-cached subset (800). Cost must price the 800 once and the cache
    // subsets separately, not 1000 once (which double-charges cache).
    const raw = {
      inputTokenDetails: {
        cacheReadTokens: 150,
        cacheWriteTokens: 50,
        noCacheTokens: 800,
      },
      inputTokens: 1000,
      outputTokenDetails: {},
      outputTokens: 500,
      totalTokens: 1500,
    } as LanguageModelUsage;

    const usage = mapUsage(raw, modelNoOp);
    expect(usage.input).toBe(800);
    expect(usage.cacheRead).toBe(150);
    expect(usage.cacheWrite).toBe(50);
    expect(usage.cost.input).toBeCloseTo((3 / 1_000_000) * 800, 10);
    expect(usage.cost.total).toBeCloseTo(
      (3 / 1_000_000) * 800 +
        (15 / 1_000_000) * 500 +
        (0.3 / 1_000_000) * 150 +
        (3.75 / 1_000_000) * 50,
      8
    );
  });

  it("falls back to inputTokens when noCacheTokens is undefined", () => {
    const modelSimple: Model = {
      api: "ai-sdk",
      baseUrl: "",
      contextWindow: 1,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "m",
      input: ["text"],
      maxTokens: 1,
      name: "m",
      provider: "p",
      reasoning: false,
    };
    const raw = {
      inputTokenDetails: {},
      inputTokens: 500,
      outputTokenDetails: {},
      outputTokens: 100,
      totalTokens: 600,
    } as LanguageModelUsage;
    const usage = mapUsage(raw, modelSimple);
    expect(usage.input).toBe(500);
  });

  it("handles undefined fields gracefully (defaults to 0)", () => {
    const sparse: LanguageModelUsage = {
      inputTokenDetails: {
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
        noCacheTokens: undefined,
      },
      inputTokens: undefined,
      outputTokenDetails: { reasoningTokens: undefined, textTokens: undefined },
      outputTokens: undefined,
      totalTokens: undefined,
    };
    const usage = mapUsage(sparse, model);
    expect(usage.input).toBe(0);
    expect(usage.output).toBe(0);
    expect(usage.cacheRead).toBe(0);
    expect(usage.cacheWrite).toBe(0);
  });
});

// ─── mapFinishReason (pure) ──────────────────────────────────────────────────

describe("mapFinishReason", () => {
  it("maps stop → stop", () => {
    expect(mapFinishReason("stop")).toBe("stop");
  });

  it("maps length → length", () => {
    expect(mapFinishReason("length")).toBe("length");
  });

  it("maps tool-calls → toolUse", () => {
    expect(mapFinishReason("tool-calls")).toBe("toolUse" as StopReason);
  });

  it("maps error → error", () => {
    expect(mapFinishReason("error")).toBe("error");
  });

  it("maps content-filter → stop (treated as natural stop)", () => {
    expect(mapFinishReason("content-filter")).toBe("stop");
  });

  it("maps other → stop (default)", () => {
    expect(mapFinishReason("other")).toBe("stop");
  });
});

// ─── stream() integration ────────────────────────────────────────────────────

/** A minimal fake streamText result matching what stream() consumes. */
function fakeStreamResult(
  over: {
    usage?: LanguageModelUsage;
    finishReason?: FinishReason;
    response?: { id?: string; modelId?: string };
  } = {}
) {
  const chunks = [{ id: "t1", text: "hello", type: "text-delta" as const }];
  return {
    fullStream: (async function* () {
      for (const chunk of chunks) yield chunk;
    })(),
    finishReason: Promise.resolve(
      over.finishReason ?? ("stop" as FinishReason)
    ),
    response: Promise.resolve(
      over.response ?? { id: "resp-1", modelId: "test-model" }
    ),
    usage: Promise.resolve(over.usage ?? sampleUsage()),
  };
}

/** A fake LanguageModelV3 so streamWithModel can run without resolveLanguageModel. */
const fakeLanguage: LanguageModelV3 = {
  modelId: "test-model",
  provider: "testprov",
  specificationVersion: "v3",
} as LanguageModelV3;

describe("streamWithModel()", () => {
  it("returns { fullStream, result } where result resolves to mapped FinishResult", () => {
    const fake = () => fakeStreamResult();
    const { fullStream, result } = streamWithModel(
      { messages: [], model },
      fakeLanguage,
      fake as never
    );
    expect(fullStream).toBeDefined();
    return expect(result).resolves.toMatchObject({
      finishReason: "stop",
      responseId: "resp-1",
      responseModel: "test-model",
    });
  });

  it("result maps usage with cost", async () => {
    const fake = () => fakeStreamResult();
    const { result } = streamWithModel(
      { messages: [], model },
      fakeLanguage,
      fake as never
    );
    const finish = await result;
    expect(finish.usage.input).toBe(85);
    expect(finish.usage.output).toBe(50);
    expect(finish.usage.cost.total).toBeGreaterThan(0);
  });

  it("fullStream is the same iterable returned by runStreamText", () => {
    const fakeResult = fakeStreamResult();
    const fake = () => fakeResult;
    const { fullStream } = streamWithModel(
      { messages: [], model },
      fakeLanguage,
      fake as never
    );
    expect(fullStream).toBe(fakeResult.fullStream);
  });

  it("maps error finishReason through", async () => {
    const fake = () => fakeStreamResult({ finishReason: "error" });
    const { result } = streamWithModel(
      { messages: [], model },
      fakeLanguage,
      fake as never
    );
    const finish = await result;
    expect(finish.finishReason).toBe("error");
  });
});
