import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { FinishReason, LanguageModelUsage } from "ai";
import { describe, expect, it } from "vite-plus/test";
import { streamWithModel } from "../stream.ts";
import type { StreamRequest } from "../stream.ts";
import type { Model } from "../types.ts";

const model: Model = {
  api: "ai-sdk",
  baseUrl: "",
  contextWindow: 8192,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "m",
  input: ["text"],
  maxTokens: 2048,
  name: "m",
  provider: "openai",
  reasoning: false,
};

const language: LanguageModelV4 = {
  modelId: "m",
  provider: "openai",
  specificationVersion: "v4",
} as LanguageModelV4;

const sampleUsage: LanguageModelUsage = {
  inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 0, noCacheTokens: 0 },
  inputTokens: 0,
  outputTokenDetails: { reasoningTokens: 0, textTokens: 0 },
  outputTokens: 0,
  totalTokens: 0,
};

/** Minimal fake streamText result matching the StreamTextStream shape stream() consumes. */
function fakeRunner(capture: { current: Record<string, unknown> }) {
  return (options: Record<string, unknown>) => {
    capture.current = options;
    return {
      fullStream: (async function* () {})(),
      finishReason: Promise.resolve("stop" as FinishReason),
      response: Promise.resolve({ id: "r", modelId: "m" }),
      usage: Promise.resolve(sampleUsage),
    };
  };
}

describe("StreamRequest.systemMessages", () => {
  it("accepts an array of observation chunk strings alongside the base system", () => {
    const req: StreamRequest = {
      model,
      messages: [],
      system: "base instructions",
      systemMessages: ["observation chunk 1", "observation chunk 2"],
    };
    expect(req.systemMessages).toEqual(["observation chunk 1", "observation chunk 2"]);
    expect(req.system).toBe("base instructions");
  });

  it("systemMessages is optional", () => {
    const req: StreamRequest = { model, messages: [], system: "base" };
    expect(req.systemMessages).toBeUndefined();
  });
});

describe("stream system block composition", () => {
  it("passes base + chunks as separate system content blocks via the system param (not instructions)", () => {
    const captured: { current: Record<string, unknown> } = { current: {} };
    streamWithModel(
      { model, messages: [], system: "base", systemMessages: ["chunk-1", "chunk-2"] },
      language,
      fakeRunner(captured),
    );
    expect(Array.isArray(captured.current.system)).toBe(true);
    expect(captured.current.instructions).toBeUndefined();
    const blocks = captured.current.system as Array<Record<string, unknown>>;
    expect(blocks).toHaveLength(3);
    expect(blocks[0]!.text).toBe("base");
    expect(blocks[0]!.providerOptions).toBeDefined();
    expect(blocks[1]!.text).toBe("chunk-1");
    expect(blocks[2]!.text).toBe("chunk-2");
    expect("providerOptions" in blocks[1]!).toBe(false);
  });

  it("falls back to instructions (string) when no systemMessages are present", () => {
    const captured: { current: Record<string, unknown> } = { current: {} };
    streamWithModel({ model, messages: [], system: "base" }, language, fakeRunner(captured));
    expect(captured.current.instructions).toBe("base");
    expect(captured.current.system).toBeUndefined();
  });

  it("passes only chunks as system blocks when base is absent", () => {
    const captured: { current: Record<string, unknown> } = { current: {} };
    streamWithModel(
      { model, messages: [], systemMessages: ["only-chunk"] },
      language,
      fakeRunner(captured),
    );
    expect(Array.isArray(captured.current.system)).toBe(true);
    const blocks = captured.current.system as Array<Record<string, unknown>>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toBe("only-chunk");
  });
});
