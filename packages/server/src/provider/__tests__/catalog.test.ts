import { describe, expect, it } from "vitest";
import type { ProviderAdapter } from "../adapters/base";
import { createModelCatalogService, normalizeProviderAlias } from "../models/catalog";

function createAdapter(id: string, models: Array<{ id: string; name: string }>): ProviderAdapter {
  return {
    id,
    describe() {
      return {
        id,
        name: id.toUpperCase(),
        env: [],
        api: true,
        models: true,
        auth: { kind: "token" },
      };
    },
    async listModels() {
      return models.map(model => ({
        id: model.id,
        name: model.name,
        providerId: id,
        providerName: id.toUpperCase(),
        contextWindow: 64000,
        maxOutputTokens: 8192,
        capabilities: {
          text: true,
          vision: false,
          tools: true,
          reasoning: true,
          plan: false,
        },
      }));
    },
    async getAuthState() {
      return {
        providerId: id,
        status: "disconnected" as const,
        method: "token" as const,
        accountLabel: null,
        updatedAt: "2026-02-14T11:00:00.000Z",
      };
    },
    async setCredential() {},
    async clearCredential() {},
  };
}

describe("model catalog service", () => {
  it("merges models with precedence provider adapters > models.dev > snapshot", async () => {
    const service = createModelCatalogService({
      adapters: [createAdapter("zai", [{ id: "glm-4.7", name: "GLM 4.7 Adapter" }])],
      modelsDevSource: async () => ({
        zai: {
          name: "Z.AI",
          api: "https://api.z.ai/api/paas/v4",
          npm: "@ai-sdk/openai-compatible",
          env: ["ZHIPU_API_KEY"],
          models: {
            "glm-4.7": {
              id: "glm-4.7",
              name: "GLM 4.7 models.dev",
              modalities: { input: ["text"], output: ["text"] },
            },
            "glm-4.6v": {
              id: "glm-4.6v",
              name: "GLM 4.6V models.dev",
              modalities: { input: ["text", "image"], output: ["text"] },
            },
          },
        },
      }),
      snapshotSource: async () => ({
        zai: {
          name: "Z.AI",
          api: "https://snapshot.example/v1",
          npm: "@ai-sdk/openai-compatible",
          env: ["SNAPSHOT_KEY"],
          models: {
            "glm-4.7": { id: "glm-4.7", name: "GLM 4.7 snapshot" },
            "glm-4.5": { id: "glm-4.5", name: "GLM 4.5 snapshot" },
          },
        },
      }),
    });

    const catalog = await service.list();

    const byId = new Map(catalog.map(model => [model.id, model.name]));

    expect(byId.get("zai/glm-4.7")).toBe("GLM 4.7 Adapter");
    expect(byId.get("zai/glm-4.6v")).toBe("GLM 4.6V models.dev");
    expect(byId.get("zai/glm-4.5")).toBe("GLM 4.5 snapshot");

    const modelWithProviderMeta = catalog.find(model => model.id === "zai/glm-4.6v");
    expect(modelWithProviderMeta?.providerApiUrl).toBe("https://api.z.ai/api/paas/v4");
    expect(modelWithProviderMeta?.providerNpmPackage).toBe("@sakti-code/zai");
    expect(modelWithProviderMeta?.providerEnvVars).toEqual(["ZHIPU_API_KEY"]);
    expect(modelWithProviderMeta?.modalities?.input).toContain("image");
    expect(modelWithProviderMeta?.capabilities.vision).toBe(true);
  });

  it("normalizes alias provider names to canonical ids", () => {
    expect(normalizeProviderAlias("Z.AI")).toBe("zai");
    expect(normalizeProviderAlias("z-ai")).toBe("zai");
    expect(normalizeProviderAlias("zen")).toBe("zai");
    expect(normalizeProviderAlias("kimi")).toBe("moonshot");
    expect(normalizeProviderAlias("z.ai coding plan")).toBe("zai");
  });

  it("preserves model-level npm overrides over provider-level npm", async () => {
    const service = createModelCatalogService({
      adapters: [],
      modelsDevSource: async () => ({
        opencode: {
          name: "OpenCode Zen",
          api: "https://opencode.ai/zen/v1",
          npm: "@ai-sdk/openai-compatible",
          env: ["OPENCODE_API_KEY"],
          models: {
            "kimi-k2.5": {
              id: "kimi-k2.5",
              name: "Kimi K2.5",
            },
            "gpt-5.2": {
              id: "gpt-5.2",
              name: "GPT-5.2",
              provider: {
                npm: "@ai-sdk/openai",
              },
            },
          },
        },
      }),
      snapshotSource: async () => ({}),
    });

    const catalog = await service.list();
    const kimi = catalog.find(model => model.id === "opencode/kimi-k2.5");
    const gpt = catalog.find(model => model.id === "opencode/gpt-5.2");

    expect(kimi?.providerNpmPackage).toBe("@ai-sdk/openai-compatible");
    expect(gpt?.providerNpmPackage).toBe("@ai-sdk/openai");
  });

  it("forces custom npm package for zai-coding-plan", async () => {
    const service = createModelCatalogService({
      adapters: [],
      modelsDevSource: async () => ({
        "zai-coding-plan": {
          name: "Z.AI Coding Plan",
          api: "https://api.z.ai/api/paas/v4",
          npm: "@ai-sdk/openai-compatible",
          env: ["ZHIPU_API_KEY"],
          models: {
            "glm-4.7": {
              id: "glm-4.7",
              name: "GLM 4.7",
              provider: {
                npm: "@ai-sdk/openai-compatible",
              },
            },
          },
        },
      }),
      snapshotSource: async () => ({}),
    });

    const catalog = await service.list();
    const model = catalog.find(item => item.id === "zai-coding-plan/glm-4.7");
    expect(model?.providerNpmPackage).toBe("@sakti-code/zai");
  });
});
