import { describe, expect, it } from "vitest";
import {
  createProviderRegistry,
  listProviderDescriptors,
  resolveProviderAdapter,
} from "../registry";

describe("provider registry", () => {
  it("includes zai provider descriptor by default", () => {
    const providers = listProviderDescriptors();

    const zai = providers.find(provider => provider.id === "zai");

    expect(zai).toBeDefined();
    expect(zai?.name).toBe("Z.AI");
    expect(zai?.auth.kind).toBe("token");
  });

  it("resolves a provider adapter by id", () => {
    const adapter = resolveProviderAdapter("zai");

    expect(adapter).toBeDefined();
    if (!adapter) {
      throw new Error("Expected zai adapter to be registered");
    }

    expect(adapter.id).toBe("zai");
    expect(typeof adapter.listModels).toBe("function");
    expect(typeof adapter.getAuthState).toBe("function");
  });

  it("returns undefined for unknown provider", () => {
    const adapter = resolveProviderAdapter("unknown-provider");
    expect(adapter).toBeUndefined();
  });

  it("can build a registry instance with zai adapter", async () => {
    const registry = createProviderRegistry();

    expect(registry.adapters.has("zai")).toBe(true);

    const zai = registry.adapters.get("zai");
    const auth = await zai?.getAuthState();

    expect(auth?.providerId).toBe("zai");
    expect(["connected", "disconnected"]).toContain(auth?.status);
  });
});
