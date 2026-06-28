import type { LanguageModelV4 } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { streamWithModel } from "../stream.ts";
import type { Model } from "../types.ts";

const zaiModel: Model = {
  api: "ai-sdk",
  baseUrl: "https://api.z.ai/api/anthropic",
  contextWindow: 200_000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "glm-5.2",
  input: ["text"],
  maxTokens: 64_000,
  name: "GLM-5.2",
  npm: "@sakti-code/zai-anthropic",
  provider: "zai",
  reasoning: true,
};

interface RunnerOptions {
  providerOptions?: Record<string, unknown>;
}

describe("streamWithModel providerOptions passthrough", () => {
  it("merges caller speed with auto-derived thinking (auto wins on thinking)", () => {
    let captured: RunnerOptions | undefined;
    const fakeRunner = ((opts: RunnerOptions): unknown => {
      captured = opts;
      return {
        fullStream: (async function* () {
          // empty
        })(),
        usage: Promise.resolve({
          inputTokenDetails: {},
          inputTokens: 0,
          outputTokenDetails: {},
          outputTokens: 0,
          totalTokens: 0,
        }),
        finishReason: Promise.resolve("stop" as const),
        response: Promise.resolve({}),
      };
    }) as unknown as Parameters<typeof streamWithModel>[2];

    streamWithModel(
      {
        model: zaiModel,
        messages: [{ role: "user", content: "hi", timestamp: 0 }],
        thinkingLevel: "xhigh",
        providerOptions: { zai: { speed: "fast" } },
      },
      {} as LanguageModelV4,
      fakeRunner
    );

    expect(captured?.providerOptions?.zai).toMatchObject({
      thinking: { type: "enabled", budget_tokens: 32_000 },
      speed: "fast",
    });
  });

  it("uses auto-derived thinking only when caller provides no zai namespace", () => {
    let captured: RunnerOptions | undefined;
    const fakeRunner = ((opts: RunnerOptions): unknown => {
      captured = opts;
      return {
        fullStream: (async function* () {
          // empty
        })(),
        usage: Promise.resolve({
          inputTokenDetails: {},
          inputTokens: 0,
          outputTokenDetails: {},
          outputTokens: 0,
          totalTokens: 0,
        }),
        finishReason: Promise.resolve("stop" as const),
        response: Promise.resolve({}),
      };
    }) as unknown as Parameters<typeof streamWithModel>[2];

    streamWithModel(
      {
        model: zaiModel,
        messages: [{ role: "user", content: "hi", timestamp: 0 }],
        thinkingLevel: "high",
      },
      {} as LanguageModelV4,
      fakeRunner
    );

    expect(captured?.providerOptions?.zai).toEqual({
      thinking: { type: "enabled", budget_tokens: 32_000 },
    });
  });
});
