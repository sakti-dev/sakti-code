import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { FinishReason, LanguageModelUsage } from "ai";
import { describe, expect, it } from "vite-plus/test";
import type { CompleteResult } from "../complete.ts";
import { completeWithModel } from "../complete.ts";
import type { Model } from "../types.ts";

const model: Model = {
  id: "test-model",
  name: "Test Model",
  api: "ai-sdk",
  provider: "testprov",
  baseUrl: "",
  reasoning: false,
  input: ["text"],
  cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1 },
  contextWindow: 4096,
  maxTokens: 2048,
};

function fakeUsage(): LanguageModelUsage {
  return {
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    inputTokenDetails: {
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
      noCacheTokens: undefined,
    },
    outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
  };
}

/** Minimal fake generateText return shape. */
function fakeGenerateResult(opts?: {
  text?: string;
  finishReason?: FinishReason;
  usage?: LanguageModelUsage;
}) {
  return {
    text: opts?.text ?? "Hello!",
    reasoning: [],
    reasoningText: undefined,
    files: [],
    sources: [],
    toolCalls: [],
    staticToolCalls: [],
    dynamicToolCalls: [],
    toolResults: [],
    staticToolResults: [],
    dynamicToolResults: [],
    finishReason: opts?.finishReason ?? "stop",
    rawFinishReason: undefined,
    usage: opts?.usage ?? fakeUsage(),
    totalUsage: opts?.usage ?? fakeUsage(),
    warnings: undefined,
    request: {},
    response: {
      id: "resp-1",
      modelId: "test-model",
      timestamp: new Date(),
      headers: {},
      messages: [],
    },
    content: [{ type: "text", text: opts?.text ?? "Hello!" }],
    providerMetadata: undefined,
    steps: [],
  };
}

/** A fake LanguageModelV4 so completeWithModel can run without resolveLanguageModel. */
const fakeLanguage: LanguageModelV4 = {
  modelId: "test-model",
  provider: "testprov",
  specificationVersion: "v4",
} as LanguageModelV4;

describe("completeWithModel()", () => {
  it("returns content text + mapped finishReason + usage with cost", async () => {
    const fake = () =>
      Promise.resolve(fakeGenerateResult({ text: "Summary!" }));
    const result = await completeWithModel(
      { messages: [], model },
      fakeLanguage,
      fake as never
    );
    expect(result.content).toEqual([{ type: "text", text: "Summary!" }]);
    expect(result.finishReason).toBe("stop");
    expect(result.usage.input).toBe(100);
    expect(result.usage.output).toBe(50);
    expect(result.usage.cost.total).toBeGreaterThan(0);
  });

  it("maps tool-calls finishReason to toolUse", async () => {
    const fake = () =>
      Promise.resolve(fakeGenerateResult({ finishReason: "tool-calls" }));
    const result = await completeWithModel(
      { messages: [], model },
      fakeLanguage,
      fake as never
    );
    expect(result.finishReason).toBe("toolUse");
  });

  it("catches generateText errors and returns error finishReason + errorMessage", async () => {
    const fake = () => Promise.reject(new Error("provider exploded"));
    const result = await completeWithModel(
      { messages: [], model },
      fakeLanguage,
      fake as never
    );
    expect(result.finishReason).toBe("error");
    expect(result.errorMessage).toBe("provider exploded");
    expect(result.content).toEqual([]);
  });

  it("catches abort errors and returns error finishReason", async () => {
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";
    const fake = () => Promise.reject(abortError);
    const result = await completeWithModel(
      { messages: [], model },
      fakeLanguage,
      fake as never
    );
    expect(result.finishReason).toBe("error");
    expect(result.errorMessage).toBe("Aborted");
  });
});

describe("CompleteResult type", () => {
  it("has the expected shape", () => {
    const result: CompleteResult = {
      content: [{ type: "text", text: "x" }],
      finishReason: "stop",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    expect(result.finishReason).toBe("stop");
  });
});
