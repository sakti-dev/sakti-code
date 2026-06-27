import { parseProviderOptions } from "@ai-sdk/provider-utils";
import { describe, expect, it } from "vitest";
import { zaiAnthropicOptions } from "../zai-anthropic-options.ts";

describe("zai-anthropic options schema", () => {
  it("parses a full options object", async () => {
    const parsed = await parseProviderOptions({
      provider: "zai",
      providerOptions: {
        zai: {
          thinking: { type: "enabled", budgetTokens: 16_000 },
          speed: "fast",
          outputConfig: { effort: "high" },
          cacheControl: { system: true, tools: true },
          sendReasoning: true,
        },
      },
      schema: zaiAnthropicOptions,
    });
    expect(parsed?.thinking?.type).toBe("enabled");
    expect(parsed?.speed).toBe("fast");
    expect(parsed?.outputConfig?.effort).toBe("high");
  });

  it("parses adaptive thinking with display", async () => {
    const parsed = await parseProviderOptions({
      provider: "zai",
      providerOptions: {
        zai: { thinking: { type: "adaptive", display: "summarized" } },
      },
      schema: zaiAnthropicOptions,
    });
    expect(parsed?.thinking?.type).toBe("adaptive");
  });

  it("returns undefined when no zai key is present", async () => {
    const parsed = await parseProviderOptions({
      provider: "zai",
      providerOptions: { anthropic: { thinking: { type: "disabled" } } },
      schema: zaiAnthropicOptions,
    });
    expect(parsed).toBeUndefined();
  });
});
