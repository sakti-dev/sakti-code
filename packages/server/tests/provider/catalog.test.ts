import { describe, expect, it } from "vitest";
import type { ProviderAdapter } from "../../src/provider/adapters/base";
import {
  createModelCatalogService,
  normalizeProviderAlias,
} from "../../src/provider/models/catalog";

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
          models: {
            "glm-4.7": { id: "glm-4.7", name: "GLM 4.7 models.dev" },
            "glm-4.6v": { id: "glm-4.6v", name: "GLM 4.6V models.dev" },
          },
        },
      }),
      snapshotSource: async () => ({
        zai: {
          name: "Z.AI",
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
  });

  it("normalizes alias provider names to canonical ids", () => {
    expect(normalizeProviderAlias("Z.AI")).toBe("zai");
    expect(normalizeProviderAlias("z-ai")).toBe("zai");
    expect(normalizeProviderAlias("zen")).toBe("zai");
    expect(normalizeProviderAlias("kimi")).toBe("moonshot");
    expect(normalizeProviderAlias("z.ai coding plan")).toBe("zai");
  });
});
