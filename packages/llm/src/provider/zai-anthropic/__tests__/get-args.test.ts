import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { ZaiLanguageModel } from "../zai-language-model.ts";

const make = () =>
  new ZaiLanguageModel("glm-5.2", {
    baseURL: "https://api.z.ai/api/anthropic",
    provider: "zai.messages",
    headers: async () => ({}),
  });

const baseOpts = (
  overrides: Partial<LanguageModelV4CallOptions> = {}
): LanguageModelV4CallOptions => ({
  prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  ...overrides,
});

describe("ZaiLanguageModel.getArgs", () => {
  it("emits thinking enabled with budget from providerOptions.zai", async () => {
    const { args } = await make().getArgs(
      baseOpts({
        providerOptions: {
          zai: { thinking: { type: "enabled", budgetTokens: 16_000 } },
        },
      })
    );
    expect(args.thinking).toEqual({ type: "enabled", budget_tokens: 16_000 });
  });

  it("defaults budget to 1024 when enabled without budgetTokens", async () => {
    const { args, warnings } = await make().getArgs(
      baseOpts({ providerOptions: { zai: { thinking: { type: "enabled" } } } })
    );
    expect(args.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
    expect(
      warnings.some(
        (w) =>
          (w.type === "unsupported" || w.type === "compatibility") &&
          w.feature === "extended thinking"
      )
    ).toBe(true);
  });

  it("strips temperature/topP/topK when thinking enabled", async () => {
    const { args, warnings } = await make().getArgs(
      baseOpts({
        temperature: 0.5,
        topP: 0.9,
        topK: 40,
        providerOptions: {
          zai: { thinking: { type: "enabled", budgetTokens: 16_000 } },
        },
      })
    );
    expect(args.temperature).toBeUndefined();
    expect(args.top_p).toBeUndefined();
    expect(args.top_k).toBeUndefined();
    expect(
      warnings.some(
        (w) => w.type === "unsupported" && w.feature === "temperature"
      )
    ).toBe(true);
  });

  it("emits speed + output_config only when set", async () => {
    const { args } = await make().getArgs(
      baseOpts({
        providerOptions: {
          zai: { speed: "fast", outputConfig: { effort: "high" } },
        },
      })
    );
    expect(args.speed).toBe("fast");
    expect(args.output_config).toEqual({ effort: "high" });
  });

  it("puts cache_control on last system block + last tool", async () => {
    const { args } = await make().getArgs(
      baseOpts({
        prompt: [
          { role: "system", content: "sys" },
          { role: "user", content: [{ type: "text", text: "hi" }] },
        ],
        tools: [
          {
            type: "function" as const,
            name: "Read",
            inputSchema: { type: "object" as const },
          },
        ],
      })
    );
    expect(args.system?.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
    expect(args.tools?.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("max_tokens = requested + thinkingBudget", async () => {
    const { args } = await make().getArgs(
      baseOpts({
        maxOutputTokens: 4096,
        providerOptions: {
          zai: { thinking: { type: "enabled", budgetTokens: 32_000 } },
        },
      })
    );
    expect(args.max_tokens).toBe(4096 + 32_000);
  });

  it("warns on frequencyPenalty / presencePenalty / seed (unsupported)", async () => {
    const { warnings } = await make().getArgs(
      baseOpts({
        frequencyPenalty: 0.5,
        presencePenalty: 0.3,
        seed: 42,
      } as Partial<LanguageModelV4CallOptions>)
    );
    const features = warnings
      .filter(
        (w): w is Extract<typeof w, { type: "unsupported" }> =>
          w.type === "unsupported"
      )
      .map((w) => w.feature);
    expect(features).toContain("frequencyPenalty");
    expect(features).toContain("presencePenalty");
    expect(features).toContain("seed");
  });

  it("emits prompt-caching beta when cache_control markers are placed", async () => {
    const { betas } = await make().getArgs(
      baseOpts({
        prompt: [
          { role: "system", content: "sys" },
          { role: "user", content: [{ type: "text", text: "hi" }] },
        ],
      })
    );
    expect(betas.has("prompt-caching-2024-07-31")).toBe(true);
  });
});
