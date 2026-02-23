import type { ProviderClient } from "@/core/services/api/provider-client";
import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";

describe("provider-selection-store", () => {
  it("hydrates models and groups results by connection state", async () => {
    const { createProviderSelectionStore } =
      await import("@/core/state/providers/provider-selection-store");

    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([
        { id: "zai", name: "Z.AI" },
        { id: "openai", name: "OpenAI" },
      ]),
      listAuthStates: vi.fn().mockResolvedValue({
        zai: {
          providerId: "zai",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T00:00:00.000Z",
        },
        openai: {
          providerId: "openai",
          status: "disconnected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T00:00:00.000Z",
        },
      }),
      listAuthMethods: vi.fn().mockResolvedValue({}),
      listModels: vi.fn().mockResolvedValue([
        { id: "zai/glm-4.7", providerId: "zai", name: "GLM 4.7" },
        { id: "openai/gpt-4o-mini", providerId: "openai", name: "GPT-4o mini" },
      ]),
      getPreferences: vi.fn().mockResolvedValue({
        selectedProviderId: "zai",
        selectedModelId: "zai/glm-4.7",
        updatedAt: "2026-02-14T00:00:00.000Z",
      }),
      updatePreferences: vi.fn().mockResolvedValue({
        selectedProviderId: "zai",
        selectedModelId: "zai/glm-4.7",
        updatedAt: "2026-02-14T00:00:01.000Z",
      }),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
    };

    await new Promise<void>(resolve => {
      createRoot(dispose => {
        const store = createProviderSelectionStore(client);
        setTimeout(() => {
          expect(store.connectedResults("")).toHaveLength(1);
          expect(store.notConnectedResults("")).toHaveLength(1);
          expect(store.connectedResults("glm")[0]?.id).toBe("zai/glm-4.7");
          dispose();
          resolve();
        }, 0);
      });
    });
  });

  it("persists model preference updates", async () => {
    const { createProviderSelectionStore } =
      await import("@/core/state/providers/provider-selection-store");

    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([{ id: "zai", name: "Z.AI" }]),
      listAuthStates: vi.fn().mockResolvedValue({
        zai: {
          providerId: "zai",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T00:00:00.000Z",
        },
      }),
      listAuthMethods: vi.fn().mockResolvedValue({}),
      listModels: vi.fn().mockResolvedValue([{ id: "zai/glm-4.7", providerId: "zai" }]),
      getPreferences: vi.fn().mockResolvedValue({
        selectedProviderId: null,
        selectedModelId: null,
        updatedAt: "2026-02-14T00:00:00.000Z",
      }),
      updatePreferences: vi.fn().mockResolvedValue({
        selectedProviderId: "zai",
        selectedModelId: "zai/glm-4.7",
        updatedAt: "2026-02-14T00:00:01.000Z",
      }),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
    };

    await new Promise<void>(resolve => {
      createRoot(dispose => {
        const store = createProviderSelectionStore(client);
        setTimeout(async () => {
          await store.setSelectedModel("zai/glm-4.7");
          expect(client.updatePreferences).toHaveBeenCalledWith({
            selectedModelId: "zai/glm-4.7",
            selectedProviderId: "zai",
          });
          dispose();
          resolve();
        }, 0);
      });
    });
  });

  it("updates selected model optimistically before persistence resolves", async () => {
    const { createProviderSelectionStore } =
      await import("@/core/state/providers/provider-selection-store");

    let resolveUpdate: (() => void) | null = null;
    const updatePreferences = vi.fn().mockImplementation(
      () =>
        new Promise(resolve => {
          resolveUpdate = () =>
            resolve({
              selectedProviderId: "openai",
              selectedModelId: "openai/gpt-4o-mini",
              updatedAt: "2026-02-14T00:00:01.000Z",
            });
        })
    );

    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([
        { id: "zai", name: "Z.AI" },
        { id: "openai", name: "OpenAI" },
      ]),
      listAuthStates: vi.fn().mockResolvedValue({
        zai: {
          providerId: "zai",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T00:00:00.000Z",
        },
        openai: {
          providerId: "openai",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T00:00:00.000Z",
        },
      }),
      listAuthMethods: vi.fn().mockResolvedValue({}),
      listModels: vi.fn().mockResolvedValue([
        { id: "zai/glm-4.7", providerId: "zai", name: "GLM 4.7" },
        { id: "openai/gpt-4o-mini", providerId: "openai", name: "GPT-4o mini" },
      ]),
      getPreferences: vi
        .fn()
        .mockResolvedValueOnce({
          selectedProviderId: "zai",
          selectedModelId: "zai/glm-4.7",
          updatedAt: "2026-02-14T00:00:00.000Z",
        })
        .mockResolvedValue({
          selectedProviderId: "openai",
          selectedModelId: "openai/gpt-4o-mini",
          updatedAt: "2026-02-14T00:00:01.000Z",
        }),
      updatePreferences,
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
    };

    await new Promise<void>((resolve, reject) => {
      createRoot(dispose => {
        const store = createProviderSelectionStore(client);
        setTimeout(async () => {
          try {
            const pending = store.setSelectedModel("openai/gpt-4o-mini");
            expect(store.data()?.preferences.selectedModelId).toBe("openai/gpt-4o-mini");
            expect(store.data()?.preferences.selectedProviderId).toBe("openai");
            resolveUpdate?.();
            await pending;
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

  it("rolls back optimistic selected model when persistence fails", async () => {
    const { createProviderSelectionStore } =
      await import("@/core/state/providers/provider-selection-store");

    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([
        { id: "zai", name: "Z.AI" },
        { id: "openai", name: "OpenAI" },
      ]),
      listAuthStates: vi.fn().mockResolvedValue({
        zai: {
          providerId: "zai",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T00:00:00.000Z",
        },
        openai: {
          providerId: "openai",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T00:00:00.000Z",
        },
      }),
      listAuthMethods: vi.fn().mockResolvedValue({}),
      listModels: vi.fn().mockResolvedValue([
        { id: "zai/glm-4.7", providerId: "zai", name: "GLM 4.7" },
        { id: "openai/gpt-4o-mini", providerId: "openai", name: "GPT-4o mini" },
      ]),
      getPreferences: vi.fn().mockResolvedValue({
        selectedProviderId: "zai",
        selectedModelId: "zai/glm-4.7",
        updatedAt: "2026-02-14T00:00:00.000Z",
      }),
      updatePreferences: vi.fn().mockRejectedValue(new Error("failed to persist")),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
    };

    await new Promise<void>((resolve, reject) => {
      createRoot(dispose => {
        const store = createProviderSelectionStore(client);
        setTimeout(async () => {
          try {
            await expect(store.setSelectedModel("openai/gpt-4o-mini")).rejects.toThrow(
              "failed to persist"
            );
            expect(store.data()?.preferences.selectedModelId).toBe("zai/glm-4.7");
            expect(store.data()?.preferences.selectedProviderId).toBe("zai");
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

  it("keeps persisted model when a subsequent preferences fetch is stale", async () => {
    const { createProviderSelectionStore } =
      await import("@/core/state/providers/provider-selection-store");

    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([
        { id: "opencode", name: "OpenCode Zen" },
        { id: "openai", name: "OpenAI" },
      ]),
      listAuthStates: vi.fn().mockResolvedValue({
        opencode: {
          providerId: "opencode",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T00:00:00.000Z",
        },
        openai: {
          providerId: "openai",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T00:00:00.000Z",
        },
      }),
      listAuthMethods: vi.fn().mockResolvedValue({}),
      listModels: vi.fn().mockResolvedValue([
        { id: "opencode/glm-4.7-free", providerId: "opencode", name: "GLM 4.7 Free" },
        { id: "opencode/minimax-m2.5-free", providerId: "opencode", name: "MiniMax M2.5 Free" },
      ]),
      getPreferences: vi
        .fn()
        .mockResolvedValueOnce({
          selectedProviderId: "opencode",
          selectedModelId: "opencode/glm-4.7-free",
          updatedAt: "2026-02-14T00:00:00.000Z",
        })
        .mockResolvedValue({
          // Stale value returned by immediate read-after-write
          selectedProviderId: "opencode",
          selectedModelId: "opencode/glm-4.7-free",
          updatedAt: "2026-02-14T00:00:00.000Z",
        }),
      updatePreferences: vi.fn().mockResolvedValue({
        selectedProviderId: "opencode",
        selectedModelId: "opencode/minimax-m2.5-free",
        updatedAt: "2026-02-14T00:00:02.000Z",
      }),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
    };

    await new Promise<void>((resolve, reject) => {
      createRoot(dispose => {
        const store = createProviderSelectionStore(client);
        setTimeout(async () => {
          try {
            await store.setSelectedModel("opencode/minimax-m2.5-free");
            expect(store.data()?.preferences.selectedModelId).toBe("opencode/minimax-m2.5-free");
            expect(store.data()?.preferences.selectedProviderId).toBe("opencode");
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

  it("groups model search results by provider name", async () => {
    const { createProviderSelectionStore } =
      await import("@/core/state/providers/provider-selection-store");

    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([
        { id: "zai", name: "Z.AI" },
        { id: "openai", name: "OpenAI" },
      ]),
      listAuthStates: vi.fn().mockResolvedValue({
        zai: {
          providerId: "zai",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T00:00:00.000Z",
        },
        openai: {
          providerId: "openai",
          status: "disconnected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T00:00:00.000Z",
        },
      }),
      listAuthMethods: vi.fn().mockResolvedValue({}),
      listModels: vi.fn().mockResolvedValue([
        { id: "zai/glm-4.7", providerId: "zai", name: "GLM 4.7" },
        { id: "openai/gpt-4o-mini", providerId: "openai", name: "GPT-4o mini" },
      ]),
      getPreferences: vi.fn().mockResolvedValue({
        selectedProviderId: "zai",
        selectedModelId: "zai/glm-4.7",
        updatedAt: "2026-02-14T00:00:00.000Z",
      }),
      updatePreferences: vi.fn().mockResolvedValue({
        selectedProviderId: "zai",
        selectedModelId: "zai/glm-4.7",
        updatedAt: "2026-02-14T00:00:01.000Z",
      }),
      setToken: vi.fn().mockResolvedValue(undefined),
      clearToken: vi.fn().mockResolvedValue(undefined),
      oauthAuthorize: vi.fn(),
      oauthCallback: vi.fn(),
    };

    await new Promise<void>(resolve => {
      createRoot(dispose => {
        const store = createProviderSelectionStore(client);
        setTimeout(() => {
          const sections = store.providerGroupedSections("");
          expect(sections).toHaveLength(2);
          expect(sections[0]?.providerName).toBe("Z.AI");
          expect(sections[0]?.models[0]?.name).toBe("GLM 4.7");
          expect(sections[1]?.providerName).toBe("OpenAI");
          dispose();
          resolve();
        }, 0);
      });
    });
  });

  it("caches grouped sections for repeated queries", async () => {
    const { createProviderSelectionStore } =
      await import("@/core/state/providers/provider-selection-store");

    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([
        { id: "zai", name: "Z.AI" },
        { id: "openai", name: "OpenAI" },
      ]),
      listAuthStates: vi.fn().mockResolvedValue({
        zai: {
          providerId: "zai",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T00:00:00.000Z",
        },
        openai: {
          providerId: "openai",
          status: "disconnected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T00:00:00.000Z",
        },
      }),
      listAuthMethods: vi.fn().mockResolvedValue({}),
      listModels: vi.fn().mockResolvedValue([
        { id: "zai/glm-4.7", providerId: "zai", name: "GLM 4.7" },
        { id: "openai/gpt-4o-mini", providerId: "openai", name: "GPT-4o mini" },
      ]),
      getPreferences: vi.fn().mockResolvedValue({
        selectedProviderId: "zai",
        selectedModelId: "zai/glm-4.7",
        updatedAt: "2026-02-14T00:00:00.000Z",
      }),
      updatePreferences: vi.fn().mockResolvedValue({
        selectedProviderId: "zai",
        selectedModelId: "zai/glm-4.7",
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
            const first = store.providerGroupedSections("");
            const second = store.providerGroupedSections("");
            const third = store.providerGroupedSections("gpt");

            expect(second).toBe(first);
            expect(third).not.toBe(first);

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

  it("matches provider-name queries and alias-like tokens", async () => {
    const { createProviderSelectionStore } =
      await import("@/core/state/providers/provider-selection-store");

    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([
        { id: "zai", name: "Z.AI" },
        { id: "openai", name: "OpenAI" },
      ]),
      listAuthStates: vi.fn().mockResolvedValue({
        zai: {
          providerId: "zai",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T00:00:00.000Z",
        },
        openai: {
          providerId: "openai",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T00:00:00.000Z",
        },
      }),
      listAuthMethods: vi.fn().mockResolvedValue({}),
      listModels: vi.fn().mockResolvedValue([
        { id: "zai/glm-5", providerId: "zai", name: "GLM-5" },
        { id: "abacus/sonnet", providerId: "abacus", name: "Sonnet 4" },
        { id: "openai/gpt-4o-mini", providerId: "openai", name: "GPT-4o mini" },
      ]),
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
            expect(store.allResults("openai").map(model => model.id)).toContain(
              "openai/gpt-4o-mini"
            );
            expect(store.allResults("z.ai").map(model => model.id)).toContain("zai/glm-5");
            expect(store.allResults("zai").map(model => model.id)).toContain("zai/glm-5");
            expect(store.allResults("zai").map(model => model.id)).not.toContain(
              "openai/gpt-4o-mini"
            );
            expect(store.allResults("zai").map(model => model.id)).not.toContain("abacus/sonnet");
            expect(store.allResults("zen").map(model => model.id)).toContain("zai/glm-5");
            expect(store.allResults("opencode zen").map(model => model.id)).toContain("zai/glm-5");
            expect(store.allResults("zai-coding-plan").map(model => model.id)).toContain(
              "zai/glm-5"
            );
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

  it("keeps hyphenated exact-model queries visible", async () => {
    const { createProviderSelectionStore } =
      await import("@/core/state/providers/provider-selection-store");

    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([{ id: "zai", name: "Z.AI" }]),
      listAuthStates: vi.fn().mockResolvedValue({
        zai: {
          providerId: "zai",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T00:00:00.000Z",
        },
      }),
      listAuthMethods: vi.fn().mockResolvedValue({}),
      listModels: vi.fn().mockResolvedValue([
        { id: "zai/glm-5", providerId: "zai", name: "GLM-5" },
        { id: "zai/glm-4.7", providerId: "zai", name: "GLM-4.7" },
      ]),
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
            const prefix = store.allResults("glm-").map(model => model.id);
            const exact = store.allResults("glm-5").map(model => model.id);
            expect(prefix).toContain("zai/glm-5");
            expect(exact).toContain("zai/glm-5");
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

  it("keeps generic queries broad while ranking provider-intent matches higher", async () => {
    const { createProviderSelectionStore } =
      await import("@/core/state/providers/provider-selection-store");

    const client: ProviderClient = {
      listProviders: vi.fn().mockResolvedValue([
        { id: "zai-coding-plan", name: "Z.AI Coding Plan" },
        { id: "openai", name: "OpenAI" },
      ]),
      listAuthStates: vi.fn().mockResolvedValue({
        "zai-coding-plan": {
          providerId: "zai-coding-plan",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T00:00:00.000Z",
        },
        openai: {
          providerId: "openai",
          status: "connected",
          method: "token",
          accountLabel: null,
          updatedAt: "2026-02-14T00:00:00.000Z",
        },
      }),
      listAuthMethods: vi.fn().mockResolvedValue({}),
      listModels: vi.fn().mockResolvedValue([
        { id: "zai-coding-plan/glm-5", providerId: "zai-coding-plan", name: "GLM-5 Coding Plan" },
        { id: "openai/gpt-coding-plan", providerId: "openai", name: "GPT Coding Plan Assistant" },
      ]),
      getPreferences: vi.fn().mockResolvedValue({
        selectedProviderId: "zai-coding-plan",
        selectedModelId: "zai-coding-plan/glm-5",
        updatedAt: "2026-02-14T00:00:00.000Z",
      }),
      updatePreferences: vi.fn().mockResolvedValue({
        selectedProviderId: "zai-coding-plan",
        selectedModelId: "zai-coding-plan/glm-5",
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
            const results = store.allResults("coding plan");
            expect(results.length).toBe(2);
            expect(results[0]?.providerId).toBe("zai-coding-plan");
            expect(results.some(model => model.providerId === "openai")).toBe(true);
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
