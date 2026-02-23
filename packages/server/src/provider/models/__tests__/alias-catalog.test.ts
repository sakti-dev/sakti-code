import { describe, expect, it } from "vitest";
import { createModelCatalogService, normalizeProviderAlias } from "../catalog";

describe("alias catalog coverage", () => {
  it("normalizes known provider aliases", () => {
    expect(normalizeProviderAlias("Kimi")).toBe("moonshot");
    expect(normalizeProviderAlias("moonshot")).toBe("moonshot");
    expect(normalizeProviderAlias("zen")).toBe("zai");
    expect(normalizeProviderAlias("z.ai coding plan")).toBe("zai");
  });

  it("merges aliased providers into canonical provider ids", async () => {
    const service = createModelCatalogService({
      adapters: [],
      modelsDevSource: async () => ({
        kimi: {
          name: "Kimi",
          models: {
            "kimi-k2": { id: "kimi-k2", name: "Kimi K2" },
          },
        },
        zen: {
          name: "Zen",
          models: {
            "glm-4.7": { id: "glm-4.7", name: "GLM-4.7 Zen" },
          },
        },
      }),
      snapshotSource: async () => ({}),
    });

    const models = await service.list();
    const ids = models.map(model => model.id);

    expect(ids).toContain("moonshot/kimi-k2");
    expect(ids).toContain("zai/glm-4.7");
  });
});
