import {
  ModelSelector,
  type CommandCenterMode,
  type ModelSelectorSection,
} from "@/components/model-selector";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type {
  ProviderAuthMethodDescriptor,
  ProviderAuthState,
  ProviderCatalogItem,
  ProviderClient,
} from "@/core/services/api/provider-client";
import { createProviderCatalogSearchIndex } from "@/core/state/providers/provider-catalog-store";
import { cn } from "@/utils";
import { createPresence } from "@solid-primitives/presence";
import { Search } from "lucide-solid";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";

interface ModelsSettingsProps {
  client?: ProviderClient;
}

interface ProviderStateData {
  catalog: ProviderCatalogItem[];
  authMethods: Record<string, ProviderAuthMethodDescriptor[]>;
  auth: Record<string, ProviderAuthState>;
}

const DEBUG_PREFIX = "[models-settings]";

export function ModelsSettings(props: ModelsSettingsProps) {
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
  const [isVisionModelSelectorOpen, setIsVisionModelSelectorOpen] = createSignal(false);
  const [visionModelSelectorMode, setVisionModelSelectorMode] =
    createSignal<CommandCenterMode>("model");
  const [visionModelSearchQuery, setVisionModelSearchQuery] = createSignal("");
  let providerSearchInputRef: HTMLInputElement | undefined;

  const loadProviderState = async (): Promise<ProviderStateData | null> => {
    if (!props.client) return null;

    console.log(`${DEBUG_PREFIX} loadProviderState:start`);
    const statusOverrides = authStatusOverrideByProvider();
    const [catalog, authMethods, auth] = await Promise.all([
      props.client.listProviderCatalog ? props.client.listProviderCatalog() : Promise.resolve([]),
      props.client.listAuthMethods(),
      props.client.listAuthStates(),
    ]);

    const mergedCatalog = catalog.map(provider => {
      const serverMethods = authMethods[provider.id];
      const resolvedMethods = serverMethods ??
        provider.authMethods ?? [{ type: "api" as const, label: "API Key" }];

      return {
        ...provider,
        authMethods: resolvedMethods,
        connected: auth[provider.id]?.status === "connected",
      };
    });

    const mergedAuthMethods: Record<string, ProviderAuthMethodDescriptor[]> = { ...authMethods };
    for (const provider of mergedCatalog) {
      if (!mergedAuthMethods[provider.id]) {
        mergedAuthMethods[provider.id] = provider.authMethods;
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

    console.log(`${DEBUG_PREFIX} loadProviderState:done`, {
      providers: result.catalog.length,
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
  const [models] = createResource(() => props.client?.listModels());
  const [preferences, { mutate: setPreferences }] = createResource(() =>
    props.client?.getPreferences()
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

  const filteredVisionModels = createMemo(() => {
    const query = visionModelSearchQuery().trim().toLowerCase();
    if (!query) return visionModels();
    const providersById = new Map(catalogProviders().map(provider => [provider.id, provider.name]));
    return visionModels().filter(model => {
      const providerName =
        providersById.get(model.providerId) ?? model.providerName ?? model.providerId;
      const haystack =
        `${model.id} ${model.name ?? ""} ${model.providerId} ${providerName}`.toLowerCase();
      return haystack.includes(query);
    });
  });

  const hybridVisionModelSections = createMemo<ModelSelectorSection[]>(() => {
    if (!isVisionModelSelectorOpen()) return [];
    const providersById = new Map(catalogProviders().map(provider => [provider.id, provider.name]));
    const sectionsByProvider = new Map<string, ModelSelectorSection>();

    for (const model of filteredVisionModels()) {
      const providerName =
        providersById.get(model.providerId) ?? model.providerName ?? model.providerId;
      const option = {
        id: model.id,
        providerId: model.providerId,
        providerName,
        name: model.name,
        connected: true,
      };
      const existing = sectionsByProvider.get(model.providerId);
      if (existing) {
        existing.models.push(option);
        continue;
      }
      sectionsByProvider.set(model.providerId, {
        providerId: model.providerId,
        providerName,
        connected: true,
        models: [option],
      });
    }

    return Array.from(sectionsByProvider.values());
  });

  createEffect(() => {
    const providers = catalogProviders();
    if (providers.length === 0) return;
    if (!selectedProviderId()) {
      setSelectedProviderId(providers[0]!.id);
    }
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

  createEffect(() => {
    if (isVisionModelSelectorOpen()) return;
    setVisionModelSearchQuery("");
    setVisionModelSelectorMode("model");
  });

  const openExternal = async (url: string) => {
    if (window.saktiCodeAPI?.shell?.openExternal) {
      await window.saktiCodeAPI.shell.openExternal(url);
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
    if (!token || !props.client) return;

    try {
      await props.client.setToken(providerId, token);
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOauthErrorByProvider(prev => ({ ...prev, [providerId]: message }));
    }
  };

  const connectOAuth = async (providerId: string, methodIndex: number) => {
    if (!props.client) return;

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
    if (!props.client) return;

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
    if (!props.client) return;

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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
    if (!props.client) return;
    const next = await props.client.updatePreferences(input);
    setPreferences(next);
  };

  const handleHybridVisionModelSelect = (modelId: string) => {
    const model = visionModels().find(item => item.id === modelId);
    if (!model) return;
    void updateHybridPreference({
      hybridVisionModelId: model.id,
      hybridVisionProviderId: model.providerId,
    });
  };

  const openModal = (providerId?: string) => {
    const resolvedProviderId =
      providerId ?? selectedProviderId() ?? catalogProviders()[0]?.id ?? null;
    setProviderSearchQuery("");
    setSelectedProviderId(resolvedProviderId);
    setActiveIndex(0);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
  };

  const focusProviderSearchInput = () => {
    const input = providerSearchInputRef;
    if (!input) return false;
    input.focus({ preventScroll: true });
    const cursor = input.value.length;
    input.setSelectionRange(cursor, cursor);
    return document.activeElement === input;
  };

  const modalPresence = createPresence(isModalOpen, {
    transitionDuration: 220,
    initialEnter: true,
  });

  createEffect(() => {
    const shouldFocusSearchInput = isModalOpen() && modalPresence.isMounted();
    if (!shouldFocusSearchInput) return;

    const focus = () => {
      focusProviderSearchInput();
    };

    focus();
    queueMicrotask(focus);
    const frame = requestAnimationFrame(focus);

    onCleanup(() => {
      cancelAnimationFrame(frame);
    });
  });

  const isEditableElement = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable
    );
  };

  const handleProviderModalKeyDown = (event: KeyboardEvent) => {
    const ids = visibleProviders();
    const isSearchInputTarget = event.target === providerSearchInputRef;
    const isEditableTarget = isEditableElement(event.target);

    if (event.key === "ArrowDown") {
      if (ids.length === 0) return;
      if (isEditableTarget && !isSearchInputTarget) return;
      event.preventDefault();
      setActiveIndex(prev => {
        const next = (prev + 1) % ids.length;
        setSelectedProviderId(ids[next] ?? null);
        return next;
      });
      return;
    }

    if (event.key === "ArrowUp") {
      if (ids.length === 0) return;
      if (isEditableTarget && !isSearchInputTarget) return;
      event.preventDefault();
      setActiveIndex(prev => {
        const next = (prev - 1 + ids.length) % ids.length;
        setSelectedProviderId(ids[next] ?? null);
        return next;
      });
      return;
    }

    if (event.key === "Enter") {
      if (ids.length === 0) return;
      if (isEditableTarget && !isSearchInputTarget) return;
      event.preventDefault();
      const providerId = ids[activeIndex()];
      if (providerId) setSelectedProviderId(providerId);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
    }
  };

  return (
    <>
      <Card class="mt-4 p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold tracking-tight">Providers</h3>
            <p class="text-muted-foreground mt-0.5 text-xs">
              Connect model providers to use in Conductor.
            </p>
          </div>
          <button
            class="border-primary/30 bg-primary/12 text-primary hover:bg-primary/18 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
            onClick={() => openModal()}
          >
            Connect a provider
          </button>
        </div>

        <div class="border-border/60 mb-3 border-b" />

        <Show
          when={props.client && hasLoadedProviderState()}
          fallback={<p class="text-sm">Loading providers...</p>}
        >
          <Show
            when={connectedProviders().length > 0}
            fallback={
              <div class="py-4 text-center">
                <p class="text-muted-foreground text-sm">No provider connected yet.</p>
                <Button variant="primary" size="sm" class="mt-3" onClick={() => openModal()}>
                  Select provider
                </Button>
              </div>
            }
          >
            <div class="-mx-4 space-y-0">
              <For each={connectedProviders()}>
                {provider => (
                  <>
                    <div class="flex items-center justify-between gap-3 px-4 py-3">
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-sm font-medium">{provider.name}</p>
                        <p class="text-muted-foreground truncate text-xs">
                          {provider.modelCount} models
                        </p>
                      </div>
                      <div class="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          class="text-xs"
                          onClick={() => openModal(provider.id)}
                        >
                          Manage
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          class="text-xs"
                          onClick={() => void disconnect(provider.id)}
                        >
                          Disconnect
                        </Button>
                      </div>
                    </div>
                    <Show
                      when={
                        connectedProviders().indexOf(provider) < connectedProviders().length - 1
                      }
                    >
                      <div class="border-border/60 mx-4 border-b" />
                    </Show>
                  </>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Card>

      <Card class="mt-4 p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold tracking-tight">Hybrid Vision Fallback</h3>
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
        <div class="flex items-center gap-2">
          <button
            type="button"
            class={cn(
              "border-border/80 bg-background/70 hover:bg-muted/60 w-full rounded-md border px-2.5 py-2 text-left text-xs transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-60"
            )}
            disabled={(preferences()?.hybridEnabled ?? true) === false}
            onClick={() => {
              setVisionModelSelectorMode("model");
              setIsVisionModelSelectorOpen(true);
            }}
          >
            {selectedHybridVisionModel()?.name ??
              selectedHybridVisionModel()?.id ??
              "Select vision model"}
          </button>
          <Show when={preferences()?.hybridVisionModelId}>
            <Button
              variant="ghost"
              size="sm"
              class="shrink-0 text-xs"
              disabled={(preferences()?.hybridEnabled ?? true) === false}
              onClick={() =>
                void updateHybridPreference({
                  hybridVisionModelId: null,
                  hybridVisionProviderId: null,
                })
              }
            >
              Clear
            </Button>
          </Show>
        </div>
        <ModelSelector
          open={isVisionModelSelectorOpen()}
          onOpenChange={setIsVisionModelSelectorOpen}
          selectedModelId={preferences()?.hybridVisionModelId ?? undefined}
          mode={visionModelSelectorMode()}
          onModeChange={setVisionModelSelectorMode}
          modelSections={hybridVisionModelSections()}
          onSearchChange={setVisionModelSearchQuery}
          onSelect={handleHybridVisionModelSelect}
        />

        <Show
          when={
            (preferences()?.hybridEnabled ?? true) &&
            !preferences()?.hybridVisionModelId &&
            hasLoadedProviderState()
          }
        >
          <p class="text-primary/85 mt-2 text-xs">
            Hybrid fallback is enabled but no vision model is selected yet.
          </p>
        </Show>

        <Show when={selectedHybridVisionModel()}>
          <p class="text-muted-foreground mt-2 text-xs">
            Selected: {selectedHybridVisionModel()?.name ?? selectedHybridVisionModel()?.id}
          </p>
        </Show>
      </Card>

      <Show when={modalPresence.isMounted()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center p-4"
          data-testid="provider-modal"
          onKeyDown={event => handleProviderModalKeyDown(event)}
        >
          <button
            type="button"
            class="command-dialog-overlay-motion absolute inset-0 bg-black/80 backdrop-blur-sm"
            data-visible={modalPresence.isVisible() ? "" : undefined}
            data-exiting={modalPresence.isExiting() ? "" : undefined}
            onClick={closeModal}
            aria-label="Close provider selector"
          />

          <div
            class="provider-modal-content-motion model-selector-shell border-border/70 bg-popover/95 text-popover-foreground relative z-10 w-full max-w-5xl overflow-hidden rounded-xl border shadow-[0_28px_80px_rgba(0,0,0,0.6)]"
            data-visible={modalPresence.isVisible() ? "" : undefined}
            data-exiting={modalPresence.isExiting() ? "" : undefined}
          >
            <div class="model-selector-aurora pointer-events-none absolute inset-0" />
            <div class="model-selector-grain pointer-events-none absolute inset-0" />
            <div class="border-border/80 bg-muted/45 relative border-b px-4 pb-2.5 pt-3 backdrop-blur-xl">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <h3 class="text-[13px] font-semibold tracking-tight">Connect a provider</h3>
                  <p class="text-muted-foreground text-[10px]">
                    Search providers and connect with API key or OAuth
                  </p>
                </div>
                <button
                  class="border-border/80 bg-background/75 text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-md border px-2 py-1 text-xs transition-colors"
                  onClick={closeModal}
                >
                  Close
                </button>
              </div>

              <div class="mt-3">
                <label class="border-border/80 bg-background/65 focus-within:border-primary/40 flex items-center gap-2 rounded-md border px-2.5 py-2 transition-colors">
                  <Search class="text-muted-foreground size-4" />
                  <input
                    type="text"
                    ref={element => {
                      providerSearchInputRef = element;
                    }}
                    class="placeholder:text-muted-foreground/80 w-full bg-transparent text-sm outline-none"
                    placeholder="Search providers..."
                    value={providerSearchQuery()}
                    onInput={event => setProviderSearchQuery(event.currentTarget.value)}
                    autofocus
                  />
                </label>
              </div>
            </div>

            <div class="relative grid h-[480px] min-h-0 gap-0 md:grid-cols-[1.1fr_1.4fr]">
              <div class="border-border/80 min-h-0 border-r">
                <div
                  class="bg-background/35 [&::-webkit-scrollbar-thumb]:bg-border hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/50 h-full min-h-0 overflow-y-auto overscroll-contain px-2 py-2 [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2"
                  data-testid="provider-modal-list"
                >
                  <Show
                    when={providerGroups().length > 0}
                    fallback={
                      <p class="text-muted-foreground px-3 py-4 text-sm">No providers found.</p>
                    }
                  >
                    <For each={providerGroups()}>
                      {group => (
                        <div class="mb-3">
                          <p class="text-muted-foreground px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.1em]">
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
                                        ? "border-primary/45 bg-accent/70 shadow-[0_0_0_1px_color-mix(in_oklch,var(--color-primary)_45%,transparent),0_8px_24px_color-mix(in_oklch,var(--color-primary)_18%,transparent)]"
                                        : "hover:border-border/90 hover:bg-muted/70 border-transparent"
                                    )}
                                    onClick={() => setSelectedProviderId(provider.id)}
                                    data-testid={`provider-option-${provider.id}`}
                                  >
                                    <div class="flex items-center justify-between gap-2">
                                      <span class="truncate text-sm font-medium">
                                        {provider.name}
                                      </span>
                                      <div class="flex items-center gap-1">
                                        <Show when={provider.supported === false}>
                                          <span class="border-border bg-background text-muted-foreground rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                                            Preview
                                          </span>
                                        </Show>
                                        <span
                                          class={cn(
                                            "rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                                            isConnected()
                                              ? "border-primary/30 bg-primary/10 text-primary"
                                              : "border-border bg-background text-muted-foreground"
                                          )}
                                        >
                                          {isConnected() ? "Connected" : "Not Connected"}
                                        </span>
                                      </div>
                                    </div>
                                    <div class="mt-1 flex items-center justify-between gap-2">
                                      <span class="text-muted-foreground truncate text-xs">
                                        {provider.id}
                                      </span>
                                      <span class="text-muted-foreground text-[10px]">
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

              <div class="bg-background/30 [&::-webkit-scrollbar-thumb]:bg-border hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/50 h-full min-h-0 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2">
                <Show
                  when={selectedProvider()}
                  fallback={<p class="text-muted-foreground text-sm">Select a provider.</p>}
                >
                  {provider => {
                    const providerId = () => provider().id;
                    const pending = () => oauthPendingByProvider()[providerId()];
                    const busy = () => oauthBusyByProvider()[providerId()] === true;
                    const oauthError = () => oauthErrorByProvider()[providerId()];
                    const isConnected = () => auth()[providerId()]?.status === "connected";

                    return (
                      <div class="space-y-4">
                        <div class="border-border/80 bg-background/65 rounded-lg border p-3">
                          <div class="flex items-center justify-between gap-3">
                            <div class="min-w-0">
                              <p class="truncate text-sm font-semibold tracking-tight">
                                {provider().name}
                              </p>
                              <p class="text-muted-foreground truncate text-xs">{provider().id}</p>
                            </div>
                            <div class="flex items-center gap-2">
                              <span class="border-border bg-background text-muted-foreground rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide">
                                {provider().modelCount} models
                              </span>
                              <Show when={provider().popular}>
                                <span class="border-primary/35 bg-primary/12 text-primary rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide">
                                  Popular
                                </span>
                              </Show>
                            </div>
                          </div>
                          <Show when={provider().note}>
                            <p class="text-muted-foreground mt-2 text-xs">{provider().note}</p>
                          </Show>
                        </div>

                        <Show
                          when={provider().supported !== false}
                          fallback={
                            <div class="border-border bg-background/60 text-muted-foreground rounded-lg border p-3 text-xs">
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
                                  <div class="border-border/80 bg-background/60 rounded-lg border p-3">
                                    <div class="mb-3 flex items-center justify-between gap-2">
                                      <p class="text-foreground text-xs font-semibold tracking-wide">
                                        {method.label}
                                      </p>
                                      <span class="text-muted-foreground border-border rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                                        {method.type}
                                      </span>
                                    </div>

                                    <Show when={method.type === "token" || method.type === "api"}>
                                      <div class="space-y-2">
                                        <Show when={providerId() === "opencode"}>
                                          <p class="text-muted-foreground text-xs">
                                            Create an api key at{" "}
                                            <button
                                              type="button"
                                              class="text-primary hover:underline"
                                              onClick={() =>
                                                void openExternal("https://opencode.ai/auth")
                                              }
                                            >
                                              opencode.ai/auth
                                            </button>
                                          </p>
                                        </Show>
                                        <div class="flex flex-wrap items-center gap-2">
                                          <input
                                            type="password"
                                            class="border-border bg-background placeholder:text-muted-foreground/80 focus:border-primary/45 text-foreground w-full min-w-[220px] flex-1 rounded-md border px-2.5 py-2 text-xs outline-none transition-colors"
                                            placeholder="API key"
                                            value={tokenByProvider()[providerId()] || ""}
                                            onInput={event => {
                                              setTokenDraft(
                                                providerId(),
                                                event.currentTarget.value
                                              );
                                            }}
                                          />
                                          <button
                                            class="border-border/90 bg-muted/70 text-foreground hover:bg-muted rounded-md border px-2.5 py-2 text-xs font-medium transition-colors"
                                            onClick={() => void connectToken(providerId())}
                                          >
                                            Connect
                                          </button>
                                        </div>
                                      </div>
                                    </Show>

                                    <Show when={method.type === "oauth"}>
                                      <div class="flex flex-wrap items-center gap-2">
                                        <button
                                          class="border-border/90 bg-muted/70 text-foreground hover:bg-muted rounded-md border px-2.5 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                                          disabled={busy()}
                                          onClick={() => void connectOAuth(providerId(), index())}
                                        >
                                          {method.label}
                                        </button>
                                        <Show when={busy()}>
                                          <button
                                            class="border-border text-muted-foreground hover:bg-muted rounded-md border px-2.5 py-2 text-xs transition-colors"
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
                            <div class="border-primary/30 bg-primary/10 rounded-lg border p-3">
                              <div class="flex items-center justify-between gap-2">
                                <p class="text-primary text-xs font-semibold tracking-wide">
                                  Connected
                                </p>
                                <span class="text-primary border-primary/35 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                                  Active
                                </span>
                              </div>
                              <p class="text-muted-foreground mt-1 text-xs">
                                This provider is connected. You can disconnect it from here.
                              </p>
                              <div class="mt-3">
                                <button
                                  class="border-border/90 bg-muted/70 text-foreground hover:bg-muted rounded-md border px-2.5 py-2 text-xs font-medium transition-colors"
                                  onClick={() => void disconnect(providerId())}
                                >
                                  Disconnect
                                </button>
                              </div>
                            </div>
                          </Show>
                        </Show>

                        <Show when={pending()}>
                          <div class="border-border/80 bg-background/60 rounded-lg border p-3">
                            <p class="text-foreground mb-2 text-xs font-semibold tracking-wide">
                              Complete OAuth
                            </p>
                            <div class="flex flex-wrap items-center gap-2">
                              <input
                                type="text"
                                class="border-border bg-background placeholder:text-muted-foreground/80 focus:border-primary/45 text-foreground w-full min-w-[220px] flex-1 rounded-md border px-2.5 py-2 text-xs outline-none transition-colors"
                                placeholder="Paste OAuth code"
                                value={oauthCodeByProvider()[providerId()] || ""}
                                onInput={event =>
                                  setOauthCodeDraft(providerId(), event.currentTarget.value)
                                }
                              />
                              <button
                                class="border-border/90 bg-muted/70 text-foreground hover:bg-muted rounded-md border px-2.5 py-2 text-xs font-medium transition-colors"
                                onClick={() => void submitOAuthCode(providerId())}
                              >
                                Submit Code
                              </button>
                            </div>
                          </div>
                        </Show>

                        <Show when={oauthError()}>
                          <p class="text-destructive text-xs">{oauthError()}</p>
                        </Show>
                      </div>
                    );
                  }}
                </Show>
              </div>
            </div>

            <div class="text-muted-foreground border-border/80 bg-muted/55 flex items-center justify-end gap-2 border-t px-3 py-1.5 text-[10px] backdrop-blur-xl">
              <kbd class="border-border bg-background text-foreground rounded border px-1.5 py-0.5">
                Enter
              </kbd>
              <span>Select</span>
              <kbd class="border-border bg-background text-foreground ml-2 rounded border px-1.5 py-0.5">
                ↑↓
              </kbd>
              <span>Navigate</span>
              <kbd class="border-border bg-background text-foreground ml-2 rounded border px-1.5 py-0.5">
                Esc
              </kbd>
              <span>Close</span>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
}
