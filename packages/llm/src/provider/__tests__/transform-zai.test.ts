import { describe, expect, it } from "vitest";
import type { Model } from "../../types.ts";
import { buildProviderOptions } from "../transform.ts";

const zaiModel = (overrides: Partial<Model> = {}): Model => ({
  api: "ai-sdk",
  baseUrl: "https://api.z.ai/api/anthropic",
  contextWindow: 200_000,
  cost: { cacheRead: 0.26, cacheWrite: 0, input: 1.4, output: 4.4 },
  id: "glm-5.2",
  input: ["text"],
  maxTokens: 64_000,
  name: "GLM-5.2",
  npm: "@sakti-code/zai-anthropic",
  provider: "zai",
  reasoning: true,
  ...overrides,
});

describe("buildProviderOptions — zai-anthropic branch", () => {
  it("maps each ThinkingLevel to zcode's high/max budgets", () => {
    // Lower 4 tiers map to zcode "high" (16000); xhigh escalates to "max" (32000).
    expect(
      buildProviderOptions({ level: "minimal", model: zaiModel() })
    ).toEqual({
      zai: { thinking: { type: "enabled", budget_tokens: 16_000 } },
    });
    expect(buildProviderOptions({ level: "low", model: zaiModel() })).toEqual({
      zai: { thinking: { type: "enabled", budget_tokens: 16_000 } },
    });
    expect(
      buildProviderOptions({ level: "medium", model: zaiModel() })
    ).toEqual({
      zai: { thinking: { type: "enabled", budget_tokens: 16_000 } },
    });
    expect(buildProviderOptions({ level: "high", model: zaiModel() })).toEqual({
      zai: { thinking: { type: "enabled", budget_tokens: 16_000 } },
    });
    expect(buildProviderOptions({ level: "xhigh", model: zaiModel() })).toEqual(
      {
        zai: { thinking: { type: "enabled", budget_tokens: 32_000 } },
      }
    );
  });

  it("maps off to disabled", () => {
    const off = buildProviderOptions({ level: "off", model: zaiModel() });
    expect(off).toEqual({ zai: { thinking: { type: "disabled" } } });
  });

  it("returns {} for a non-reasoning zai model", () => {
    expect(
      buildProviderOptions({
        level: "high",
        model: zaiModel({ reasoning: false }),
      })
    ).toEqual({});
  });

  it("returns {} for a non-zai model", () => {
    const otherModel = zaiModel({ npm: "@ai-sdk/anthropic" });
    expect(buildProviderOptions({ level: "high", model: otherModel })).toEqual(
      {}
    );
  });

  it("auto-emits speed:'fast' for turbo / flash / highspeed variants", () => {
    const turbo = buildProviderOptions({
      level: "medium",
      model: zaiModel({ id: "glm-5-turbo" }),
    });
    expect(turbo).toEqual({
      zai: {
        thinking: { type: "enabled", budget_tokens: 16_000 },
        speed: "fast",
      },
    });
    const flash = buildProviderOptions({
      level: "off",
      model: zaiModel({ id: "glm-4.7-flash" }),
    });
    expect(flash).toEqual({
      zai: { thinking: { type: "disabled" }, speed: "fast" },
    });
  });

  it("does not emit speed for non-turbo variants", () => {
    const flagship = buildProviderOptions({
      level: "high",
      model: zaiModel({ id: "glm-5.2" }),
    });
    expect(flagship.zai).not.toHaveProperty("speed");
  });
});
