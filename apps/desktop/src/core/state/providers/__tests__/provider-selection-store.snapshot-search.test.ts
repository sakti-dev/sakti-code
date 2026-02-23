import type { ProviderClient } from "@/core/services/api/provider-client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";

type SnapshotModel = { id: string; name?: string };
type SnapshotProvider = { name?: string; models?: Record<string, SnapshotModel> };
type SnapshotPayload = Record<string, SnapshotProvider>;

function normalizeProviderAlias(input: string): string {
  const normalized = input.trim().toLowerCase();
  if (["z.ai", "z-ai", "zen", "z.ai coding plan", "zai"].includes(normalized)) {
    return "zai";
  }
  if (normalized === "kimi") {
    return "moonshot";
  }
  return normalized;
}

function loadSnapshotFixture(): {
  providers: Array<{ id: string; name: string }>;
  models: Array<{ id: string; providerId: string; name?: string }>;
} {
  const fixturePath = join(
    process.cwd(),
    "..",
    "..",
    "packages",
    "server",
    "src",
    "provider",
    "models",
    "snapshot.json"
  );
  const snapshot = JSON.parse(readFileSync(fixturePath, "utf-8")) as SnapshotPayload;

  const providerMap = new Map<string, string>();
  const modelsById = new Map<string, { id: string; providerId: string; name?: string }>();

  for (const [providerKey, provider] of Object.entries(snapshot)) {
    const providerId = normalizeProviderAlias(providerKey);
    providerMap.set(providerId, provider.name ?? providerId);
    for (const model of Object.values(provider.models ?? {})) {
      const id = `${providerId}/${model.id}`;
      modelsById.set(id, {
        id,
        providerId,
        name: model.name ?? model.id,
      });
    }
  }

  const providers = Array.from(providerMap.entries()).map(([id, name]) => ({ id, name }));
  const models = Array.from(modelsById.values());
  return { providers, models };
}

describe("provider-selection-store snapshot search quality", () => {
  it("returns focused results for common provider/model queries using real snapshot data", async () => {
    const { createProviderSelectionStore } =
      await import("@/core/state/providers/provider-selection-store");

    const { providers, models } = loadSnapshotFixture();
    const auth = Object.fromEntries(
      providers.map(provider => [
        provider.id,
        {
          providerId: provider.id,
          status: "connected" as const,
          method: "token" as const,
          accountLabel: null,
          updatedAt: "2026-02-14T00:00:00.000Z",
        },
      ])
    );

    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue(providers),
      listAuthStates: vi.fn().mockResolvedValue(auth),
      listAuthMethods: vi.fn().mockResolvedValue({}),
      listModels: vi.fn().mockResolvedValue(models),
      getPreferences: vi.fn().mockResolvedValue({
        selectedProviderId: "zai",
        selectedModelId: "zai/glm-5",
        updatedAt: "2026-02-14T00:00:00.000Z",
      }),
      updatePreferences: vi.fn().mockResolvedValue({
        selectedProviderId: "zai",
        selectedModelId: "zai/glm-5",
        updatedAt: "2026-02-14T00:00:01.000Z",
      }),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
    };

    await new Promise<void>((resolve, reject) => {
      createRoot(dispose => {
        const store = createProviderSelectionStore(client);
        setTimeout(() => {
          try {
            const zaiIds = store.allResults("zai").map(model => model.id);
            expect(zaiIds.length).toBeGreaterThan(0);
            expect(zaiIds.some(id => id.includes("zai/glm-5"))).toBe(true);
            expect(zaiIds[0]?.startsWith("zai/") || zaiIds[0]?.startsWith("zai-coding-plan/")).toBe(
              true
            );
            expect(
              zaiIds.some(id => !id.startsWith("zai/") && !id.startsWith("zai-coding-plan/"))
            ).toBe(true);

            const zaiCodingPlanIds = store.allResults("zai-coding-plan").map(model => model.id);
            expect(zaiCodingPlanIds.length).toBeGreaterThan(0);
            expect(zaiCodingPlanIds[0]?.startsWith("zai-coding-plan/")).toBe(true);
            expect(zaiCodingPlanIds.some(id => id.startsWith("zai-coding-plan/"))).toBe(true);

            const openaiIds = store.allResults("openai").map(model => model.id);
            expect(openaiIds.length).toBeGreaterThan(0);
            expect(openaiIds.some(id => id.startsWith("openai/"))).toBe(true);
            expect(openaiIds[0]?.startsWith("openai/")).toBe(true);

            const glm5Ids = store.allResults("GLM-5").map(model => model.id);
            expect(glm5Ids.some(id => id.includes("glm-5"))).toBe(true);
            const topGlim5 = glm5Ids[0] ?? "";
            expect(topGlim5.endsWith("/glm-5")).toBe(true);
            expect((topGlim5.match(/\//g) ?? []).length).toBe(1);

            const claudeIds = store.allResults("claude sonnet").map(model => model.id);
            expect(claudeIds.some(id => id.startsWith("anthropic/"))).toBe(true);

            dispose();
            resolve();
          } catch (error) {
            dispose();
            reject(error);
          }
        }, 0);
      });
    });
  });
});
