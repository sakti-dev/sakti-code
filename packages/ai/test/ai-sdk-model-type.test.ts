import { describe, expect, it } from "vitest";
import type { Api, Model } from "../src/types.ts";

describe("Model ai-sdk support", () => {
  it("accepts api 'ai-sdk' with npm + OpenAICompletionsCompat", () => {
    const model: Model<"ai-sdk"> = {
      id: "claude-sonnet-4-5",
      name: "Claude Sonnet 4.5",
      api: "ai-sdk",
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      contextWindow: 200_000,
      maxTokens: 64_000,
      npm: "@ai-sdk/anthropic",
      compat: { thinkingFormat: "openai" },
    };
    expect(model.npm).toBe("@ai-sdk/anthropic");
    expect(model.api).toBe("ai-sdk");
  });
  it("treats ai-sdk as a known Api", () => {
    const a: Api = "ai-sdk";
    expect(a).toBe("ai-sdk");
  });
});
