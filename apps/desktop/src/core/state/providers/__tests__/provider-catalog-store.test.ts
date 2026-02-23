import type { ProviderCatalogItem } from "@/core/services/api/provider-client";
import { describe, expect, it } from "vitest";

const FIXTURE: ProviderCatalogItem[] = [
  {
    id: "zai",
    name: "Z.AI",
    aliases: ["zai", "z.ai", "zen", "opencode zen"],
    authMethods: [{ type: "oauth", label: "Connect with Zen" }],
    connected: true,
    modelCount: 12,
    popular: true,
  },
  {
    id: "zai-coding-plan",
    name: "Z.AI Coding Plan",
    aliases: ["zai-coding-plan", "zai coding plan", "coding plan"],
    authMethods: [{ type: "token", label: "API Token" }],
    connected: false,
    modelCount: 3,
    popular: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    aliases: ["openai", "gpt"],
    authMethods: [{ type: "token", label: "API Token" }],
    connected: false,
    modelCount: 20,
    popular: true,
  },
  {
    id: "abacus",
    name: "Abacus",
    aliases: ["abacus"],
    authMethods: [{ type: "token", label: "API Token" }],
    connected: false,
    modelCount: 8,
    popular: false,
  },
];

describe("provider-catalog-store", () => {
  it("ranks exact provider-id queries first", async () => {
    const { createProviderCatalogSearchIndex } =
      await import("@/core/state/providers/provider-catalog-store");
    const store = createProviderCatalogSearchIndex(FIXTURE);
    const results = store.search("zai-coding-plan");
    expect(results[0]?.id).toBe("zai-coding-plan");
  });

  it("supports alias queries with focused results", async () => {
    const { createProviderCatalogSearchIndex } =
      await import("@/core/state/providers/provider-catalog-store");
    const store = createProviderCatalogSearchIndex(FIXTURE);
    const results = store.search("zen");
    expect(results[0]?.id).toBe("zai");
  });

  it("groups empty-query results into popular and other providers", async () => {
    const { createProviderCatalogSearchIndex } =
      await import("@/core/state/providers/provider-catalog-store");
    const store = createProviderCatalogSearchIndex(FIXTURE);
    const groups = store.groups("");

    expect(groups[0]?.title).toBe("Popular");
    expect(groups[0]?.providers.some(provider => provider.id === "zai")).toBe(true);
    expect(groups[1]?.title).toBe("Other");
    expect(groups[1]?.providers.some(provider => provider.id === "abacus")).toBe(true);
  });
});
