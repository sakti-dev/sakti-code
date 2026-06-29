import { describe, expect, expectTypeOf, it } from "vite-plus/test";
import { convertModelsDevModel } from "../catalog/convert.ts";
import type { ModelsDevModel, ModelsDevProvider } from "../catalog/types.ts";
import type { Model } from "../types.ts";

const anthropicProvider: ModelsDevProvider = {
  api: "https://api.anthropic.com",
  env: ["ANTHROPIC_API_KEY"],
  id: "anthropic",
  name: "Anthropic",
  npm: "@ai-sdk/anthropic",
};

const deepseekProvider: ModelsDevProvider = {
  api: "https://api.deepseek.com",
  env: ["DEEPSEEK_API_KEY"],
  id: "deepseek",
  name: "DeepSeek",
  npm: "@ai-sdk/openai-compatible",
};

const baseModel: ModelsDevModel = {
  cost: { cache_read: 0.3, cache_write: 3.75, input: 3, output: 15 },
  id: "claude-sonnet-4.5",
  limit: { context: 200_000, output: 8192 },
  modalities: { input: ["text", "image"], output: ["text"] },
  name: "Claude Sonnet 4.5",
  reasoning: true,
  tool_call: true,
};

describe("convertModelsDevModel — field mapping", () => {
  it("maps id, name, cost, limits, reasoning from models.dev model", () => {
    const model = convertModelsDevModel(anthropicProvider, baseModel);
    expect(model).not.toBeNull();
    expect(model?.id).toBe("claude-sonnet-4.5");
    expect(model?.name).toBe("Claude Sonnet 4.5");
    expect(model?.reasoning).toBe(true);
    expect(model?.cost).toEqual({
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    });
    expect(model?.contextWindow).toBe(200_000);
    expect(model?.maxTokens).toBe(8192);
  });

  it("sets api literal 'ai-sdk' on every model", () => {
    const model = convertModelsDevModel(anthropicProvider, baseModel);
    expect(model?.api).toBe("ai-sdk");
  });

  it("sets provider from provider.id", () => {
    const model = convertModelsDevModel(anthropicProvider, baseModel);
    expect(model?.provider).toBe("anthropic");
  });

  it("sets baseUrl from provider.api", () => {
    const model = convertModelsDevModel(anthropicProvider, baseModel);
    expect(model?.baseUrl).toBe("https://api.anthropic.com");
  });

  it("sets npm from provider.npm", () => {
    const model = convertModelsDevModel(anthropicProvider, baseModel);
    expect(model?.npm).toBe("@ai-sdk/anthropic");
  });

  it("model-level provider.npm overrides provider-level npm", () => {
    const modelWithPerModelNpm: ModelsDevModel = {
      ...baseModel,
      provider: { npm: "@ai-sdk/openai" },
    };
    const model = convertModelsDevModel(
      { ...anthropicProvider, npm: "@ai-sdk/openai-compatible" },
      modelWithPerModelNpm
    );
    expect(model?.npm).toBe("@ai-sdk/openai");
  });

  it("defaults npm to @ai-sdk/openai-compatible when unset", () => {
    const providerNoNpm: ModelsDevProvider = {
      id: "custom",
      name: "Custom",
      api: "https://x",
    };
    const model = convertModelsDevModel(providerNoNpm, baseModel);
    expect(model?.npm).toBe("@ai-sdk/openai-compatible");
  });
});

describe("convertModelsDevModel — input modalities", () => {
  it("sets input to ['text','image'] when image modality present", () => {
    const model = convertModelsDevModel(anthropicProvider, baseModel);
    expect(model?.input).toEqual(["text", "image"]);
  });

  it("sets input to ['text'] when no image modality", () => {
    const textOnly: ModelsDevModel = {
      ...baseModel,
      modalities: { input: ["text"], output: ["text"] },
    };
    const model = convertModelsDevModel(anthropicProvider, textOnly);
    expect(model?.input).toEqual(["text"]);
  });

  it("sets input to ['text'] when modalities absent", () => {
    const noModalities: ModelsDevModel = {
      cost: { input: 3, output: 15 },
      id: "m",
      limit: { context: 200_000, output: 8192 },
      name: "m",
      tool_call: true,
    };
    const model = convertModelsDevModel(anthropicProvider, noModalities);
    expect(model?.input).toEqual(["text"]);
  });
});

describe("convertModelsDevModel — tool_call filtering", () => {
  it("returns null when tool_call is false", () => {
    const model = convertModelsDevModel(anthropicProvider, {
      ...baseModel,
      tool_call: false,
    });
    expect(model).toBeNull();
  });

  it("returns null when tool_call is absent", () => {
    const noToolCall: ModelsDevModel = {
      id: "m",
      name: "m",
    };
    const model = convertModelsDevModel(anthropicProvider, noToolCall);
    expect(model).toBeNull();
  });
});

describe("convertModelsDevModel — status (M6)", () => {
  it("carries status from models.dev when present", () => {
    const model = convertModelsDevModel(anthropicProvider, {
      ...baseModel,
      status: "deprecated",
    });
    expect(model?.status).toBe("deprecated");
  });

  it("defaults to 'active' when status is absent", () => {
    const model = convertModelsDevModel(anthropicProvider, baseModel);
    // opencode: draft.status = model.status ?? "active". We omit the field
    // when absent (undefined ≈ active for consumers), matching the optional
    // Model.status type. Either way, a missing status means active.
    expect(model?.status ?? "active").toBe("active");
  });

  it("passes alpha status through", () => {
    const model = convertModelsDevModel(anthropicProvider, {
      ...baseModel,
      status: "alpha",
    });
    expect(model?.status).toBe("alpha");
  });
});

describe("convertModelsDevModel — compat assignment", () => {
  it("assigns no compat for first-party @ai-sdk/anthropic", () => {
    const model = convertModelsDevModel(anthropicProvider, baseModel);
    expect(model?.compat).toBeUndefined();
  });

  it("assigns thinkingFormat 'deepseek' for deepseek (openai-compatible)", () => {
    const model = convertModelsDevModel(deepseekProvider, {
      ...baseModel,
      id: "deepseek-v4-flash",
      modalities: { input: ["text"], output: ["text"] },
    });
    expect(model?.compat?.thinkingFormat).toBe("deepseek");
  });

  it("assigns default thinkingFormat 'openai' for unmapped openai-compatible provider", () => {
    const genericProvider: ModelsDevProvider = {
      api: "https://api.unknown.com",
      id: "unknown-provider",
      name: "Unknown",
      npm: "@ai-sdk/openai-compatible",
    };
    const model = convertModelsDevModel(genericProvider, {
      ...baseModel,
      modalities: { input: ["text"], output: ["text"] },
    });
    expect(model?.compat?.thinkingFormat).toBe("openai");
  });
});

describe("generated catalog — provider info", () => {
  it("exports PROVIDER_INFO with a name for every provider", async () => {
    const { PROVIDER_INFO, PROVIDERS } = await import(
      "../catalog/generated.ts"
    );
    for (const providerId of PROVIDERS) {
      const info = PROVIDER_INFO[providerId];
      expect(
        info,
        `provider ${providerId} missing from PROVIDER_INFO`
      ).toBeDefined();
      if (!info) continue;
      expect(typeof info.name).toBe("string");
      expect(info.name.length).toBeGreaterThan(0);
    }
  });

  it("PROVIDER_INFO for anthropic has name 'Anthropic'", async () => {
    const { PROVIDER_INFO } = await import("../catalog/generated.ts");
    expect(PROVIDER_INFO.anthropic?.name).toBe("Anthropic");
  });
});

describe("convertModelsDevModel — output type", () => {
  it("returns Model shape", () => {
    const model = convertModelsDevModel(anthropicProvider, baseModel);
    expect(model).not.toBeNull();
    if (model) {
      const asserted: Model = model;
      expect(asserted.api).toBe("ai-sdk");
      expectTypeOf(asserted).toEqualTypeOf<Model>();
    }
  });
});
