import type {
  ProviderAuthMethodDescriptor,
  ProviderAuthState,
  ProviderCatalogItem,
  ProviderClient,
} from "@/core/services/api/provider-client";
import { createProviderCatalogSearchIndex } from "@/core/state/providers/provider-catalog-store";
import { cn } from "@/utils";
import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js";

interface ProviderSettingsProps {
  client: ProviderClient;
}

interface ProviderStateData {
  catalog: ProviderCatalogItem[];
  authMethods: Record<string, ProviderAuthMethodDescriptor[]>;
  auth: Record<string, ProviderAuthState>;
}

const PROVIDER_SETTINGS_DEBUG_PREFIX = "[provider-settings]";

function fallbackCatalogFromProviders(input: {
  providers: Array<{ id: string; name: string }>;
  authMethods: Record<string, ProviderAuthMethodDescriptor[]>;
  auth: Record<string, ProviderAuthState>;
}): ProviderCatalogItem[] {
  return input.providers.map(provider => ({
    id: provider.id,
    name: provider.name,
    aliases: [provider.id, provider.name.toLowerCase()],
    authMethods: input.authMethods[provider.id] ?? [{ type: "api", label: "API Key" }],
    connected: input.auth[provider.id]?.status === "connected",
    modelCount: 0,
    popular:
      provider.id === "opencode" ||
      provider.id === "zai" ||
      provider.id === "openai" ||
      provider.id === "anthropic",
    supported: true,
  }));
}

export function ProviderSettings(props: ProviderSettingsProps) {
  const [tokenByProvider, setTokenByProvider] = createSignal<Record<string, string>>({});
  const [oauthCodeByProvider, setOauthCodeByProvider] = createSignal<Record<string, string>>({});
  const [oauthPendingByProvider, setOauthPendingByProvider] = createSignal<
    Record<string, { methodIndex: number; authorizationId: string }>
  >({});
  const [oauthBusyByProvider, setOauthBusyByProvider] = createSignal<Record<string, boolean>>({});
  const [oauthErrorByProvider, setOauthErrorByProvider] = createSignal<Record<string, string>>({});
  const [oauthRunByProvider, setOauthRunByProvider] = createSignal<Record<string, string>>({});
  const [isModalOpen, setIsModalOpen] = createSignal(false);
  const [selectedProviderId, setSelectedProviderId] = createSignal<string | null>(null);
  const [providerSearchQuery, setProviderSearchQuery] = createSignal("");
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [authStatusOverrideByProvider, setAuthStatusOverrideByProvider] = createSignal<
    Record<string, "connected" | "disconnected">
  >({});

  const loadProviderState = async (): Promise<ProviderStateData> => {
    console.log(`${PROVIDER_SETTINGS_DEBUG_PREFIX} loadProviderState:start`);
    const statusOverrides = authStatusOverrideByProvider();
    const [providers, authMethods, auth, catalog] = await Promise.all([
      props.client.listProviders(),
      props.client.listAuthMethods(),
      props.client.listAuthStates(),
      props.client.listProviderCatalog ? props.client.listProviderCatalog() : Promise.resolve([]),
    ]);

    const fallbackCatalog = fallbackCatalogFromProviders({ providers, authMethods, auth });
    const supportedProviderIds = new Set(providers.map(provider => provider.id));
    const mergedCatalog = (catalog.length > 0 ? catalog : fallbackCatalog).map(provider => {
      const isSupported = supportedProviderIds.has(provider.id);
      const serverMethods = authMethods[provider.id];
      const resolvedMethods =
        serverMethods ??
        (isSupported
          ? [{ type: "api" as const, label: "API Key" }]
          : provider.authMethods.length > 0
            ? provider.authMethods
            : [{ type: "api" as const, label: "API Key" }]);

      return {
        ...provider,
        authMethods: resolvedMethods,
        connected: auth[provider.id]?.status === "connected" || provider.connected,
        supported: typeof provider.supported === "boolean" ? provider.supported : isSupported,
      };
    });

    const mergedAuthMethods: Record<string, ProviderAuthMethodDescriptor[]> = { ...authMethods };
    for (const provider of mergedCatalog) {
      if (!mergedAuthMethods[provider.id]) {
        mergedAuthMethods[provider.id] =
          supportedProviderIds.has(provider.id) && authMethods[provider.id]
            ? authMethods[provider.id]
            : provider.authMethods;
      }
    }

    const mergedAuth: Record<string, ProviderAuthState> = { ...auth };
    for (const provider of mergedCatalog) {
      if (!mergedAuth[provider.id]) {
        mergedAuth[provider.id] = {
          providerId: provider.id,
          status: provider.connected ? "connected" : "disconnected",
          method:
            provider.authMethods[0]?.type === "api"
              ? "token"
              : (provider.authMethods[0]?.type ?? "token"),
          accountLabel: null,
          updatedAt: new Date().toISOString(),
        };
      }
    }

    for (const [providerId, forcedStatus] of Object.entries(statusOverrides)) {
      const existing = mergedAuth[providerId];
      if (existing) {
        mergedAuth[providerId] = {
          ...existing,
          status: forcedStatus,
        };
      } else {
        mergedAuth[providerId] = {
          providerId,
          status: forcedStatus,
          method: forcedStatus === "connected" ? "token" : "none",
          accountLabel: null,
          updatedAt: new Date().toISOString(),
        };
      }
    }

    const catalogWithResolvedStatus = mergedCatalog.map(item => ({
      ...item,
      connected: mergedAuth[item.id]?.status === "connected",
    }));

    const result = {
      catalog: catalogWithResolvedStatus,
      authMethods: mergedAuthMethods,
      auth: mergedAuth,
    };

    if (Object.keys(statusOverrides).length > 0) {
      const nextOverrides = { ...statusOverrides };
      let changed = false;
      for (const [providerId, forcedStatus] of Object.entries(statusOverrides)) {
        const observedStatus = auth[providerId]?.status ?? "disconnected";
        if (observedStatus === forcedStatus) {
          delete nextOverrides[providerId];
          changed = true;
        }
      }
      if (changed) {
        setAuthStatusOverrideByProvider(nextOverrides);
      }
    }

    console.log(`${PROVIDER_SETTINGS_DEBUG_PREFIX} loadProviderState:done`, {
      providers: providers.length,
      catalog: result.catalog.length,
      connectedProviders: Object.values(result.auth).filter(item => item.status === "connected")
        .length,
      connectedProviderIds: Object.entries(result.auth)
        .filter(([, state]) => state.status === "connected")
        .map(([id]) => id),
      activeOverrides: authStatusOverrideByProvider(),
    });
    return result;
  };

  const [providerState, { refetch: refetchProviderState, mutate: mutateProviderState }] =
    createResource(loadProviderState);
  const [models] = createResource(() => props.client.listModels());
  const [preferences, { mutate: setPreferences }] = createResource(() =>
    props.client.getPreferences()
  );

  const catalogProviders = createMemo<ProviderCatalogItem[]>(() => providerState()?.catalog ?? []);
  const authMethods = createMemo<Record<string, ProviderAuthMethodDescriptor[]>>(
    () => providerState()?.authMethods ?? {}
  );
  const auth = createMemo<Record<string, ProviderAuthState>>(() => providerState()?.auth ?? {});
  const hasLoadedProviderState = createMemo(() => providerState() !== undefined);

  const searchIndex = createMemo(() => createProviderCatalogSearchIndex(catalogProviders()));
  const providerGroups = createMemo(() => searchIndex().groups(providerSearchQuery()));
  const visibleProviders = createMemo(() =>
    providerGroups().flatMap(group => group.providers.map(provider => provider.id))
  );

  const selectedProvider = createMemo(() => {
    const selectedId = selectedProviderId();
    const providers = catalogProviders();
    if (selectedId) {
      const matched = providers.find(provider => provider.id === selectedId);
      if (matched) return matched;
    }
    return providers[0] ?? null;
  });

  const connectedProviders = createMemo(() =>
    catalogProviders().filter(provider => auth()[provider.id]?.status === "connected")
  );

  const methodsForSelected = createMemo(() => {
    const provider = selectedProvider();
    if (!provider) return [];
    return authMethods()[provider.id] ?? provider.authMethods ?? [];
  });
  const visionModels = createMemo(() => {
    const authState = auth();
    return (models() ?? []).filter(model => {
      const connected = authState[model.providerId]?.status === "connected";
      if (!connected) return false;
      return model.modalities?.input?.includes("image") ?? model.capabilities?.vision ?? false;
    });
  });
  const selectedHybridVisionModel = createMemo(() =>
    visionModels().find(model => model.id === preferences()?.hybridVisionModelId)
  );

  createEffect(() => {
    const providers = catalogProviders();
    if (providers.length === 0) return;
    if (!selectedProviderId()) {
      setSelectedProviderId(providers[0]!.id);
      console.log(`${PROVIDER_SETTINGS_DEBUG_PREFIX} selectedProvider:auto`, {
        providerId: providers[0]!.id,
      });
    }
  });

  createEffect(() => {
    const selectedId = selectedProviderId();
    if (!selectedId) return;
    console.log(`${PROVIDER_SETTINGS_DEBUG_PREFIX} selectedProvider:changed`, {
      providerId: selectedId,
    });
  });

  createEffect(() => {
    if (!isModalOpen()) return;
    const ids = visibleProviders();
    if (ids.length === 0) return;
    const selected = selectedProviderId();
    if (!selected || !ids.includes(selected)) {
      setSelectedProviderId(ids[0] ?? null);
      setActiveIndex(0);
      return;
    }
    const selectedIndex = ids.indexOf(selected);
    if (selectedIndex >= 0) setActiveIndex(selectedIndex);
  });

  const openExternal = async (url: string) => {
    if (window.ekacodeAPI?.shell?.openExternal) {
      await window.ekacodeAPI.shell.openExternal(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const setTokenDraft = (providerId: string, token: string) => {
    setTokenByProvider(prev => ({ ...prev, [providerId]: token }));
  };

  const setOauthCodeDraft = (providerId: string, code: string) => {
    setOauthCodeByProvider(prev => ({ ...prev, [providerId]: code }));
  };

  const connectToken = async (providerId: string) => {
    const token = tokenByProvider()[providerId]?.trim();
    if (!token) return;
    console.log(`${PROVIDER_SETTINGS_DEBUG_PREFIX} connectToken:start`, {
      providerId,
      tokenLength: token.length,
    });

    try {
      await props.client.setToken(providerId, token);
      console.log(`${PROVIDER_SETTINGS_DEBUG_PREFIX} connectToken:setToken:ok`, { providerId });
      setAuthStatusOverrideByProvider(prev => ({ ...prev, [providerId]: "connected" }));
      mutateProviderState(prev => {
        if (!prev) return prev;
        const currentAuth = prev.auth[providerId];
        return {
          ...prev,
          catalog: prev.catalog.map(item =>
            item.id === providerId ? { ...item, connected: true } : item
          ),
          auth: {
            ...prev.auth,
            [providerId]: {
              providerId,
              status: "connected",
              method: "token",
              accountLabel: currentAuth?.accountLabel ?? null,
              updatedAt: new Date().toISOString(),
            },
          },
        };
      });
      setTokenDraft(providerId, "");
      setOauthErrorByProvider(prev => ({ ...prev, [providerId]: "" }));
      await refetchProviderState();
      const connectedState = providerState()?.auth?.[providerId]?.status;
      if (connectedState !== "connected") {
        console.log(`${PROVIDER_SETTINGS_DEBUG_PREFIX} connectToken:refetch:not-connected`, {
          providerId,
          status: connectedState ?? "missing",
        });
        mutateProviderState(prev => {
          if (!prev) return prev;
          const currentAuth = prev.auth[providerId];
          return {
            ...prev,
            catalog: prev.catalog.map(item =>
              item.id === providerId ? { ...item, connected: true } : item
            ),
            auth: {
              ...prev.auth,
              [providerId]: {
                providerId,
                status: "connected",
                method: "token",
                accountLabel: currentAuth?.accountLabel ?? null,
                updatedAt: new Date().toISOString(),
              },
            },
          };
        });
      }
      console.log(`${PROVIDER_SETTINGS_DEBUG_PREFIX} connectToken:refetch:done`, {
        providerId,
        status: connectedState ?? "missing",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`${PROVIDER_SETTINGS_DEBUG_PREFIX} connectToken:error`, {
        providerId,
        message,
      });
      setOauthErrorByProvider(prev => ({ ...prev, [providerId]: message }));
    }
  };

  const connectOAuth = async (providerId: string, methodIndex: number) => {
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setOauthRunByProvider(prev => ({ ...prev, [providerId]: runId }));
    setOauthBusyByProvider(prev => ({ ...prev, [providerId]: true }));
    setOauthErrorByProvider(prev => ({ ...prev, [providerId]: "" }));

    try {
      const authorization = await props.client.oauthAuthorize(providerId, methodIndex);
      await openExternal(authorization.url);

      if (authorization.method === "auto") {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          if (oauthRunByProvider()[providerId] !== runId) {
            setOauthBusyByProvider(prev => ({ ...prev, [providerId]: false }));
            return;
          }
          const callback = await props.client.oauthCallback(
            providerId,
            methodIndex,
            authorization.authorizationId
          );
          if (callback.status === "connected") {
            setOauthBusyByProvider(prev => ({ ...prev, [providerId]: false }));
            await refetchProviderState();
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 750));
        }
        setOauthErrorByProvider(prev => ({
          ...prev,
          [providerId]: "Authorization is still pending. Retry or continue waiting.",
        }));
        return;
      }

      setOauthPendingByProvider(prev => ({
        ...prev,
        [providerId]: { methodIndex, authorizationId: authorization.authorizationId },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOauthErrorByProvider(prev => ({ ...prev, [providerId]: message }));
    } finally {
      setOauthBusyByProvider(prev => ({ ...prev, [providerId]: false }));
    }
  };

  const submitOAuthCode = async (providerId: string) => {
    const pending = oauthPendingByProvider()[providerId];
    const code = oauthCodeByProvider()[providerId]?.trim();
    if (!pending || !code) return;

    try {
      const callback = await props.client.oauthCallback(
        providerId,
        pending.methodIndex,
        pending.authorizationId,
        code
      );

      if (callback.status === "connected") {
        setOauthPendingByProvider(prev => {
          const next = { ...prev };
          delete next[providerId];
          return next;
        });
        setOauthCodeByProvider(prev => ({ ...prev, [providerId]: "" }));
        setOauthErrorByProvider(prev => ({ ...prev, [providerId]: "" }));
        await refetchProviderState();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOauthErrorByProvider(prev => ({ ...prev, [providerId]: message }));
    }
  };

  const cancelOAuth = (providerId: string) => {
    setOauthRunByProvider(prev => ({ ...prev, [providerId]: `${Date.now()}-cancelled` }));
    setOauthBusyByProvider(prev => ({ ...prev, [providerId]: false }));
  };

  const disconnect = async (providerId: string) => {
    console.log(`${PROVIDER_SETTINGS_DEBUG_PREFIX} disconnect:start`, { providerId });
    const previous = providerState()?.auth?.[providerId];
    setAuthStatusOverrideByProvider(prev => ({ ...prev, [providerId]: "disconnected" }));
    mutateProviderState(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        catalog: prev.catalog.map(item =>
          item.id === providerId ? { ...item, connected: false } : item
        ),
        auth: {
          ...prev.auth,
          [providerId]: {
            providerId,
            status: "disconnected",
            method: "token",
            accountLabel: null,
            updatedAt: new Date().toISOString(),
          },
        },
      };
    });

    try {
      await props.client.clearToken(providerId);
      await refetchProviderState();
      const disconnectedState = providerState()?.auth?.[providerId]?.status;
      if (disconnectedState === "connected") {
        console.log(`${PROVIDER_SETTINGS_DEBUG_PREFIX} disconnect:refetch:still-connected`, {
          providerId,
        });
      }
      console.log(`${PROVIDER_SETTINGS_DEBUG_PREFIX} disconnect:done`, {
        providerId,
        status: disconnectedState ?? "missing",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`${PROVIDER_SETTINGS_DEBUG_PREFIX} disconnect:error`, {
        providerId,
        message,
      });
      setAuthStatusOverrideByProvider(prevOverrides => {
        const next = { ...prevOverrides };
        delete next[providerId];
        return next;
      });
      mutateProviderState(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          catalog: prev.catalog.map(item =>
            item.id === providerId ? { ...item, connected: previous?.status === "connected" } : item
          ),
          auth: {
            ...prev.auth,
            [providerId]: {
              providerId,
              status: previous?.status ?? "disconnected",
              method: previous?.method ?? "token",
              accountLabel: previous?.accountLabel ?? null,
              updatedAt: previous?.updatedAt ?? new Date().toISOString(),
            },
          },
        };
      });
      setOauthErrorByProvider(prevErrors => ({ ...prevErrors, [providerId]: message }));
    }
  };
  const updateHybridPreference = async (
    input: Partial<{
      hybridEnabled: boolean;
      hybridVisionProviderId: string | null;
      hybridVisionModelId: string | null;
    }>
  ) => {
    const next = await props.client.updatePreferences(input);
    setPreferences(next);
  };

  const openModal = (providerId?: string) => {
    const resolvedProviderId =
      providerId ?? selectedProviderId() ?? catalogProviders()[0]?.id ?? null;
    console.log(`${PROVIDER_SETTINGS_DEBUG_PREFIX} modal:open`, {
      requestedProviderId: providerId ?? null,
      resolvedProviderId,
    });
    setProviderSearchQuery("");
    setSelectedProviderId(resolvedProviderId);
    setActiveIndex(0);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
  };

  const handleSearchKeyDown = (event: KeyboardEvent) => {
    const ids = visibleProviders();
    if (ids.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(prev => {
        const next = (prev + 1) % ids.length;
        setSelectedProviderId(ids[next] ?? null);
        return next;
      });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(prev => {
        const next = (prev - 1 + ids.length) % ids.length;
        setSelectedProviderId(ids[next] ?? null);
        return next;
      });
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const providerId = ids[activeIndex()];
      if (providerId) setSelectedProviderId(providerId);
    }
  };

  return (
    <section class="mb-8">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-foreground text-lg font-medium">Providers</h2>
        <button
          class="bg-primary text-primary-foreground rounded px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
          onClick={() => openModal()}
        >
          Connect a provider
        </button>
      </div>

      <div class="bg-card border-border rounded-lg border p-4">
        <Show
          when={hasLoadedProviderState()}
          fallback={<p class="text-sm">Loading providers...</p>}
        >
          <Show
            when={connectedProviders().length > 0}
            fallback={
              <div class="text-center">
                <p class="text-muted-foreground text-sm">No provider connected yet.</p>
                <button
                  class="bg-primary text-primary-foreground mt-3 rounded px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
                  onClick={() => openModal()}
                >
                  Select provider
                </button>
              </div>
            }
          >
            <div class="space-y-3">
              <For each={connectedProviders()}>
                {provider => (
                  <div
                    class="border-border bg-background/70 rounded border p-3"
                    data-testid={`provider-${provider.id}`}
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <p class="truncate text-sm font-medium">{provider.name}</p>
                        <p class="text-muted-foreground truncate text-xs">{provider.id}</p>
                      </div>
                      <div class="flex items-center gap-2">
                        <span class="rounded-full border border-emerald-300/50 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-300">
                          Connected
                        </span>
                        <span class="text-muted-foreground text-[10px]">
                          {provider.modelCount} models
                        </span>
                      </div>
                    </div>
                    <div class="mt-3 flex items-center gap-2">
                      <button
                        class="border-border hover:bg-muted rounded border px-2 py-1 text-xs transition-colors"
                        onClick={() => openModal(provider.id)}
                      >
                        Manage
                      </button>
                      <button
                        class="border-border hover:bg-muted rounded border px-2 py-1 text-xs transition-colors"
                        onClick={() => void disconnect(provider.id)}
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>

      <div class="bg-card border-border mt-4 rounded-lg border p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-medium">Hybrid Vision Fallback</h3>
            <p class="text-muted-foreground mt-0.5 text-xs">
              Auto-route image prompts from text-only models to a vision-capable model.
            </p>
          </div>
          <label class="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={preferences()?.hybridEnabled ?? true}
              onChange={event =>
                void updateHybridPreference({ hybridEnabled: event.currentTarget.checked })
              }
            />
            Enabled
          </label>
        </div>

        <label class="text-muted-foreground mb-1 block text-xs">Vision fallback model</label>
        <select
          class="border-border bg-background w-full rounded border px-2 py-1.5 text-xs"
          value={preferences()?.hybridVisionModelId ?? ""}
          disabled={(preferences()?.hybridEnabled ?? true) === false}
          onChange={event => {
            const modelId = event.currentTarget.value || null;
            const model = visionModels().find(item => item.id === modelId);
            void updateHybridPreference({
              hybridVisionModelId: model?.id ?? null,
              hybridVisionProviderId: model?.providerId ?? null,
            });
          }}
        >
          <option value="">Select vision model</option>
          <For each={visionModels()}>
            {model => (
              <option value={model.id}>
                {model.name ?? model.id} ({model.providerId})
              </option>
            )}
          </For>
        </select>

        <Show
          when={
            (preferences()?.hybridEnabled ?? true) &&
            !preferences()?.hybridVisionModelId &&
            hasLoadedProviderState()
          }
        >
          <p class="mt-2 text-xs text-amber-600 dark:text-amber-300">
            Hybrid fallback is enabled but no vision model is selected yet.
          </p>
        </Show>

        <Show when={selectedHybridVisionModel()}>
          <p class="text-muted-foreground mt-2 text-xs">
            Selected: {selectedHybridVisionModel()?.name ?? selectedHybridVisionModel()?.id}
          </p>
        </Show>
      </div>

      <Show when={isModalOpen()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center p-4"
          data-testid="provider-modal"
        >
          <button
            type="button"
            class="data-expanded:animate-in data-expanded:fade-in-0 absolute inset-0 bg-black/65 backdrop-blur-sm duration-150"
            data-expanded=""
            onClick={closeModal}
            aria-label="Close provider selector"
          />

          <div class="data-expanded:animate-in data-expanded:fade-in-0 data-expanded:zoom-in-95 relative z-10 w-full max-w-5xl overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-950 text-zinc-100 shadow-[0_28px_80px_rgba(0,0,0,0.6)] duration-200">
            <div class="border-b border-zinc-800/90 bg-zinc-900/75 px-4 py-3">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <h3 class="text-base font-semibold tracking-tight">Connect a provider</h3>
                  <p class="text-xs text-zinc-400">
                    Search providers and connect with API key or OAuth
                  </p>
                </div>
                <button
                  class="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
                  onClick={closeModal}
                >
                  Close
                </button>
              </div>

              <div class="mt-3">
                <label class="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/70 px-2.5 py-2 transition-colors focus-within:border-zinc-600">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="size-4 text-zinc-500"
                  >
                    <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
                    <path d="M21 21l-6 -6" />
                  </svg>
                  <input
                    type="text"
                    class="w-full bg-transparent text-sm outline-none placeholder:text-zinc-500"
                    placeholder="Search providers..."
                    value={providerSearchQuery()}
                    onInput={event => setProviderSearchQuery(event.currentTarget.value)}
                    onKeyDown={event => handleSearchKeyDown(event)}
                    autofocus
                  />
                </label>
              </div>
            </div>

            <div class="grid h-[560px] min-h-0 gap-0 md:grid-cols-[1.1fr_1.4fr]">
              <div class="min-h-0 border-r border-zinc-800/90">
                <div
                  class="h-full min-h-0 overflow-y-auto overscroll-contain px-2 py-2 [scrollbar-color:rgba(113,113,122,0.65)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-600/70 hover:[&::-webkit-scrollbar-thumb]:bg-zinc-500/75 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2"
                  data-testid="provider-modal-list"
                >
                  <Show
                    when={providerGroups().length > 0}
                    fallback={<p class="px-3 py-4 text-sm text-zinc-500">No providers found.</p>}
                  >
                    <For each={providerGroups()}>
                      {group => (
                        <div class="mb-3">
                          <p class="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
                            {group.title}
                          </p>
                          <div class="space-y-1">
                            <For each={group.providers}>
                              {provider => {
                                const isSelected = () => selectedProviderId() === provider.id;
                                const isConnected = () =>
                                  auth()[provider.id]?.status === "connected";
                                return (
                                  <button
                                    class={cn(
                                      "duration-120 group w-full rounded-md border px-2.5 py-2 text-left transition-all",
                                      isSelected()
                                        ? "border-zinc-600 bg-zinc-800/85 shadow-[0_0_0_1px_rgba(59,130,246,0.25),0_10px_22px_rgba(15,23,42,0.45)]"
                                        : "border-transparent hover:border-zinc-700/70 hover:bg-zinc-900/80"
                                    )}
                                    onClick={() => {
                                      console.log(
                                        `${PROVIDER_SETTINGS_DEBUG_PREFIX} providerOption:click`,
                                        {
                                          providerId: provider.id,
                                          previousSelectedProviderId: selectedProviderId(),
                                        }
                                      );
                                      setSelectedProviderId(provider.id);
                                    }}
                                    data-testid={`provider-option-${provider.id}`}
                                  >
                                    <div class="flex items-center justify-between gap-2">
                                      <span class="truncate text-sm font-medium">
                                        {provider.name}
                                      </span>
                                      <div class="flex items-center gap-1">
                                        <Show when={provider.supported === false}>
                                          <span class="rounded-full border border-amber-300/35 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                                            Preview
                                          </span>
                                        </Show>
                                        <span
                                          class={cn(
                                            "rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                                            isConnected()
                                              ? "border-emerald-300/40 bg-emerald-500/10 text-emerald-300"
                                              : "border-zinc-600 bg-zinc-800 text-zinc-400"
                                          )}
                                        >
                                          {isConnected() ? "Connected" : "Not Connected"}
                                        </span>
                                      </div>
                                    </div>
                                    <div class="mt-1 flex items-center justify-between gap-2">
                                      <span class="truncate text-xs text-zinc-500">
                                        {provider.id}
                                      </span>
                                      <span class="text-[10px] text-zinc-500">
                                        {provider.modelCount} models
                                      </span>
                                    </div>
                                  </button>
                                );
                              }}
                            </For>
                          </div>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </div>

              <div class="h-full min-h-0 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-color:rgba(113,113,122,0.65)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-600/70 hover:[&::-webkit-scrollbar-thumb]:bg-zinc-500/75 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2">
                <Show
                  when={selectedProvider()}
                  fallback={<p class="text-sm text-zinc-500">Select a provider.</p>}
                >
                  {provider => {
                    const providerId = () => provider().id;
                    const pending = () => oauthPendingByProvider()[providerId()];
                    const busy = () => oauthBusyByProvider()[providerId()] === true;
                    const oauthError = () => oauthErrorByProvider()[providerId()];
                    const isConnected = () => auth()[providerId()]?.status === "connected";

                    return (
                      <div class="space-y-4">
                        <div class="rounded-lg border border-zinc-800/80 bg-zinc-900/70 p-3">
                          <div class="flex items-center justify-between gap-3">
                            <div class="min-w-0">
                              <p class="truncate text-sm font-semibold tracking-tight">
                                {provider().name}
                              </p>
                              <p class="truncate text-xs text-zinc-500">{provider().id}</p>
                            </div>
                            <div class="flex items-center gap-2">
                              <span class="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-300">
                                {provider().modelCount} models
                              </span>
                              <Show when={provider().popular}>
                                <span class="rounded-full border border-sky-300/40 bg-sky-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-sky-300">
                                  Popular
                                </span>
                              </Show>
                            </div>
                          </div>
                          <Show when={provider().note}>
                            <p class="mt-2 text-xs text-zinc-400">{provider().note}</p>
                          </Show>
                        </div>

                        <Show
                          when={provider().supported !== false}
                          fallback={
                            <div class="rounded-lg border border-amber-300/25 bg-amber-500/5 p-3 text-xs text-amber-200">
                              This provider is listed from the catalog but is not yet configurable
                              in this build.
                            </div>
                          }
                        >
                          <Show
                            when={isConnected()}
                            fallback={
                              <For each={methodsForSelected()}>
                                {(method, index) => (
                                  <div class="rounded-lg border border-zinc-800/80 bg-zinc-900/60 p-3">
                                    <div class="mb-3 flex items-center justify-between gap-2">
                                      <p class="text-xs font-semibold tracking-wide text-zinc-300">
                                        {method.label}
                                      </p>
                                      <span class="rounded-full border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                                        {method.type}
                                      </span>
                                    </div>

                                    <Show when={method.type === "token" || method.type === "api"}>
                                      <div class="space-y-2">
                                        <Show when={providerId() === "opencode"}>
                                          <p class="text-xs text-zinc-400">
                                            Create an api key at https://opencode.ai/auth
                                          </p>
                                        </Show>
                                        <div class="flex flex-wrap items-center gap-2">
                                          <input
                                            type="password"
                                            class="w-full min-w-[220px] flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-zinc-500"
                                            placeholder="API key"
                                            value={tokenByProvider()[providerId()] || ""}
                                            onInput={event => {
                                              const value = event.currentTarget.value;
                                              console.log(
                                                `${PROVIDER_SETTINGS_DEBUG_PREFIX} tokenInput:change`,
                                                {
                                                  providerId: providerId(),
                                                  selectedProviderId: selectedProviderId(),
                                                  tokenLength: value.length,
                                                }
                                              );
                                              setTokenDraft(providerId(), value);
                                            }}
                                          />
                                          <button
                                            class="rounded-md border border-zinc-600 bg-zinc-800 px-2.5 py-2 text-xs font-medium text-zinc-100 transition-colors hover:bg-zinc-700"
                                            onClick={() => {
                                              console.log(
                                                `${PROVIDER_SETTINGS_DEBUG_PREFIX} tokenConnect:click`,
                                                {
                                                  providerId: providerId(),
                                                  selectedProviderId: selectedProviderId(),
                                                }
                                              );
                                              void connectToken(providerId());
                                            }}
                                          >
                                            Connect
                                          </button>
                                        </div>
                                      </div>
                                    </Show>

                                    <Show when={method.type === "oauth"}>
                                      <div class="flex flex-wrap items-center gap-2">
                                        <button
                                          class="rounded-md border border-zinc-600 bg-zinc-800 px-2.5 py-2 text-xs font-medium text-zinc-100 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
                                          disabled={busy()}
                                          onClick={() => void connectOAuth(providerId(), index())}
                                        >
                                          {method.label}
                                        </button>
                                        <Show when={busy()}>
                                          <button
                                            class="rounded-md border border-zinc-700 px-2.5 py-2 text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
                                            onClick={() => cancelOAuth(providerId())}
                                          >
                                            Cancel OAuth
                                          </button>
                                        </Show>
                                      </div>
                                    </Show>
                                  </div>
                                )}
                              </For>
                            }
                          >
                            <div class="rounded-lg border border-emerald-300/30 bg-emerald-500/5 p-3">
                              <div class="flex items-center justify-between gap-2">
                                <p class="text-xs font-semibold tracking-wide text-emerald-300">
                                  Connected
                                </p>
                                <span class="rounded-full border border-emerald-300/35 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
                                  Active
                                </span>
                              </div>
                              <p class="mt-1 text-xs text-zinc-400">
                                This provider is connected. You can disconnect it from here.
                              </p>
                              <div class="mt-3">
                                <button
                                  class="rounded-md border border-zinc-600 bg-zinc-800 px-2.5 py-2 text-xs font-medium text-zinc-100 transition-colors hover:bg-zinc-700"
                                  onClick={() => void disconnect(providerId())}
                                >
                                  Disconnect
                                </button>
                              </div>
                            </div>
                          </Show>
                        </Show>

                        <Show when={pending()}>
                          <div class="rounded-lg border border-zinc-800/80 bg-zinc-900/60 p-3">
                            <p class="mb-2 text-xs font-semibold tracking-wide text-zinc-300">
                              Complete OAuth
                            </p>
                            <div class="flex flex-wrap items-center gap-2">
                              <input
                                type="text"
                                class="w-full min-w-[220px] flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-zinc-500"
                                placeholder="Paste OAuth code"
                                value={oauthCodeByProvider()[providerId()] || ""}
                                onInput={event =>
                                  setOauthCodeDraft(providerId(), event.currentTarget.value)
                                }
                              />
                              <button
                                class="rounded-md border border-zinc-600 bg-zinc-800 px-2.5 py-2 text-xs font-medium text-zinc-100 transition-colors hover:bg-zinc-700"
                                onClick={() => void submitOAuthCode(providerId())}
                              >
                                Submit Code
                              </button>
                            </div>
                          </div>
                        </Show>

                        <Show when={oauthError()}>
                          <p class="text-xs text-red-400">{oauthError()}</p>
                        </Show>
                      </div>
                    );
                  }}
                </Show>
              </div>
            </div>

            <div class="flex items-center justify-end gap-2 border-t border-zinc-800/90 bg-zinc-900/80 px-3 py-1.5 text-[10px] text-zinc-400">
              <kbd class="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
                Enter
              </kbd>
              <span>Select</span>
              <kbd class="ml-2 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
                ↑↓
              </kbd>
              <span>Navigate</span>
              <kbd class="ml-2 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
                Esc
              </kbd>
              <span>Close</span>
            </div>
          </div>
        </div>
      </Show>
    </section>
  );
}
