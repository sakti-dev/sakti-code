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
  it("maps each ThinkingLevel to a thinking budget", () => {
    const high = buildProviderOptions({ level: "high", model: zaiModel() });
    expect(high).toEqual({
      zai: { thinking: { type: "enabled", budget_tokens: 16_000 } },
    });
    const xhigh = buildProviderOptions({ level: "xhigh", model: zaiModel() });
    expect(xhigh.zai).toEqual({
      thinking: { type: "enabled", budget_tokens: 32_000 },
    });
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
});
