import { createPresence } from "@solid-primitives/presence";
import { FiSearch } from "solid-icons/fi";
import "./models-settings.css";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import type { Client } from "~/lib/api";
import { useDismissibleVisibility } from "~/lib/ui/dismissible-stack";
import { cn } from "~/lib/utils";
import { useStore } from "~/stores/store-context";

interface ApiKeyInfo {
  hasKey: boolean;
  maskedKey: string | null;
  provider: string;
}

interface ProviderCatalogItem {
  authMethods: { label: string; type: "api" }[];
  connected: boolean;
  id: string;
  modelCount: number;
  name: string;
  note?: string;
  popular?: boolean;
}

const PROVIDER_CATALOG: Omit<ProviderCatalogItem, "connected">[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    modelCount: 8,
    popular: true,
    note: "Claude models — Opus, Sonnet, Haiku",
    authMethods: [{ label: "API Key", type: "api" }],
  },
  {
    id: "openai",
    name: "OpenAI",
    modelCount: 12,
    popular: true,
    note: "GPT-4o, o1, o3, and more",
    authMethods: [{ label: "API Key", type: "api" }],
  },
  {
    id: "google",
    name: "Google",
    modelCount: 6,
    popular: true,
    note: "Gemini Pro, Flash, and more",
    authMethods: [{ label: "API Key", type: "api" }],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    modelCount: 4,
    popular: true,
    note: "Cost-effective reasoning models",
    authMethods: [{ label: "API Key", type: "api" }],
  },
  {
    id: "xai",
    name: "xAI",
    modelCount: 3,
    note: "Grok models",
    authMethods: [{ label: "API Key", type: "api" }],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    modelCount: 200,
    popular: true,
    note: "Access 200+ models from one key",
    authMethods: [{ label: "API Key", type: "api" }],
  },
  {
    id: "groq",
    name: "Groq",
    modelCount: 5,
    note: "Ultra-fast inference",
    authMethods: [{ label: "API Key", type: "api" }],
  },
  {
    id: "mistral",
    name: "Mistral AI",
    modelCount: 6,
    note: "Open and commercial models",
    authMethods: [{ label: "API Key", type: "api" }],
  },
  {
    id: "together",
    name: "Together AI",
    modelCount: 50,
    note: "Open-source models at scale",
    authMethods: [{ label: "API Key", type: "api" }],
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    modelCount: 30,
    note: "Fast, open-source model hosting",
    authMethods: [{ label: "API Key", type: "api" }],
  },
  {
    id: "cerebras",
    name: "Cerebras",
    modelCount: 4,
    note: "Ultra-fast inference on custom hardware",
    authMethods: [{ label: "API Key", type: "api" }],
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    modelCount: 100,
    note: "Thousands of open models",
    authMethods: [{ label: "API Key", type: "api" }],
  },
  {
    id: "zai",
    name: "ZAI",
    modelCount: 3,
    authMethods: [{ label: "API Key", type: "api" }],
  },
  {
    id: "opencode",
    name: "OpenCode",
    modelCount: 2,
    authMethods: [{ label: "API Key", type: "api" }],
  },
];

async function fetchApiKeys(client: Client): Promise<ApiKeyInfo[]> {
  try {
    const res = await client.api.auth.$get();
    if (!res.ok) {
      return [];
    }
    return (await res.json()) as ApiKeyInfo[];
  } catch {
    return [];
  }
}

async function setApiKey(
  client: Client,
  provider: string,
  key: string
): Promise<boolean> {
  try {
    const res = await client.api.auth[":provider"].$post({
      param: { provider },
      json: { key },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function deleteApiKey(
  client: Client,
  provider: string
): Promise<boolean> {
  try {
    const res = await client.api.auth[":provider"].$delete({
      param: { provider },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function ModelsSettings() {
  const { api: client } = useStore();
  const [tokenByProvider, setTokenByProvider] = createSignal<
    Record<string, string>
  >({});
  const [errorByProvider, setErrorByProvider] = createSignal<
    Record<string, string>
  >({});
  const [isModalOpen, setIsModalOpen] = createSignal(false);
  const [selectedProviderId, setSelectedProviderId] = createSignal<
    string | null
  >(null);
  const [providerSearchQuery, setProviderSearchQuery] = createSignal("");
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [hybridEnabled, setHybridEnabled] = createSignal(true);
  const providerStackId = createUniqueId();
  const {
    isTopmost: isProviderTopmost,
    show: showProviderStack,
    hide: hideProviderStack,
  } = useDismissibleVisibility(providerStackId);
  let providerSearchInputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (modalPresence.isMounted()) {
      showProviderStack();
    } else {
      hideProviderStack();
    }
  });

  const [apiKeyInfos, { refetch: refetchApiKeys, mutate: mutateApiKeys }] =
    createResource(() => fetchApiKeys(client));

  const connectedSet = createMemo(() => {
    const infos = apiKeyInfos();
    if (!infos) {
      return new Set<string>();
    }
    return new Set(
      infos.filter((info) => info.hasKey).map((info) => info.provider)
    );
  });

  const catalogProviders = createMemo<ProviderCatalogItem[]>(() =>
    PROVIDER_CATALOG.map((provider) => ({
      ...provider,
      connected: connectedSet().has(provider.id),
    }))
  );

  const hasLoaded = createMemo(() => apiKeyInfos() !== undefined);

  const filteredProviders = createMemo(() => {
    const query = providerSearchQuery().trim().toLowerCase();
    if (!query) {
      return catalogProviders();
    }
    return catalogProviders().filter((provider) => {
      const haystack = `${provider.id} ${provider.name}`.toLowerCase();
      return haystack.includes(query);
    });
  });

  const visibleProviderIds = createMemo(() =>
    filteredProviders().map((provider) => provider.id)
  );

  const selectedProvider = createMemo(() => {
    const selectedId = selectedProviderId();
    const providers = catalogProviders();
    if (selectedId) {
      const matched = providers.find((provider) => provider.id === selectedId);
      if (matched) {
        return matched;
      }
    }
    return providers[0] ?? null;
  });

  const connectedProviders = createMemo(() =>
    catalogProviders().filter((provider) => provider.connected)
  );

  createEffect(() => {
    const providers = catalogProviders();
    if (providers.length === 0) {
      return;
    }
    if (!selectedProviderId()) {
      setSelectedProviderId(providers[0]?.id ?? null);
    }
  });

  createEffect(() => {
    if (!isModalOpen()) {
      return;
    }
    const ids = visibleProviderIds();
    if (ids.length === 0) {
      return;
    }
    const selected = selectedProviderId();
    if (!(selected && ids.includes(selected))) {
      setSelectedProviderId(ids[0] ?? null);
      setActiveIndex(0);
      return;
    }
    const selectedIndex = ids.indexOf(selected);
    if (selectedIndex >= 0) {
      setActiveIndex(selectedIndex);
    }
  });

  const setTokenDraft = (providerId: string, token: string) => {
    setTokenByProvider((prev) => ({ ...prev, [providerId]: token }));
  };

  const connectToken = async (providerId: string) => {
    const tokenDraft = tokenByProvider()[providerId];
    const token = typeof tokenDraft === "string" ? tokenDraft.trim() : "";
    if (token.length === 0) {
      setErrorByProvider((prev) => ({
        ...prev,
        [providerId]: "API key is required.",
      }));
      return;
    }

    const ok = await setApiKey(client, providerId, token);
    if (ok) {
      mutateApiKeys((prev) =>
        (prev ?? []).map((info) =>
          info.provider === providerId
            ? {
                ...info,
                hasKey: true,
                maskedKey: `...${token.slice(-4)}`,
              }
            : info
        )
      );
      setTokenDraft(providerId, "");
      setErrorByProvider((prev) => ({ ...prev, [providerId]: "" }));
      await refetchApiKeys();
    } else {
      setErrorByProvider((prev) => ({
        ...prev,
        [providerId]: "Failed to save API key.",
      }));
    }
  };

  const disconnect = async (providerId: string) => {
    const ok = await deleteApiKey(client, providerId);
    if (ok) {
      mutateApiKeys((prev) =>
        (prev ?? []).map((info) =>
          info.provider === providerId
            ? { ...info, hasKey: false, maskedKey: null }
            : info
        )
      );
      await refetchApiKeys();
    } else {
      setErrorByProvider((prev) => ({
        ...prev,
        [providerId]: "Failed to remove API key.",
      }));
    }
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
    if (!input) {
      return false;
    }
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
    if (!shouldFocusSearchInput) {
      return;
    }

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
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable
    );
  };

  const navigateProvider = (direction: 1 | -1) => {
    const ids = visibleProviderIds();
    if (ids.length === 0) {
      return;
    }
    setActiveIndex((prev) => {
      const next = (prev + direction + ids.length) % ids.length;
      setSelectedProviderId(ids[next] ?? null);
      return next;
    });
  };

  const handleProviderModalKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
      return;
    }

    const ids = visibleProviderIds();
    if (ids.length === 0) {
      return;
    }

    const isSearchInputTarget = event.target === providerSearchInputRef;
    if (isEditableElement(event.target) && !isSearchInputTarget) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      navigateProvider(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      navigateProvider(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const providerId = ids[activeIndex()];
      if (providerId) {
        setSelectedProviderId(providerId);
      }
    }
  };

  return (
    <>
      <Card class="mt-4 p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 class="font-semibold text-sm tracking-tight">Providers</h3>
            <p class="mt-0.5 text-muted-foreground text-xs">
              Connect model providers to use in sakti.
            </p>
          </div>
          <button
            class="rounded-md border border-primary/30 bg-primary/12 px-3 py-1.5 font-medium text-primary text-xs transition-colors hover:bg-primary/18"
            onClick={() => openModal()}
            type="button"
          >
            Connect a provider
          </button>
        </div>

        <div class="mb-3 border-border/60 border-b" />

        <Show
          fallback={<p class="text-sm">Loading providers...</p>}
          when={hasLoaded()}
        >
          <Show
            fallback={
              <div class="py-4 text-center">
                <p class="text-muted-foreground text-sm">
                  No provider connected yet.
                </p>
                <Button
                  class="mt-3"
                  onClick={() => openModal()}
                  size="sm"
                  variant="primary"
                >
                  Select provider
                </Button>
              </div>
            }
            when={connectedProviders().length > 0}
          >
            <div class="-mx-4 space-y-0">
              <For each={connectedProviders()}>
                {(provider) => (
                  <>
                    <div class="flex items-center justify-between gap-3 px-4 py-3">
                      <div class="min-w-0 flex-1">
                        <p class="truncate font-medium text-sm">
                          {provider.name}
                        </p>
                        <p class="truncate text-muted-foreground text-xs">
                          {provider.modelCount} models
                        </p>
                      </div>
                      <div class="flex items-center gap-2">
                        <Button
                          class="text-xs"
                          onClick={() => openModal(provider.id)}
                          size="sm"
                          variant="ghost"
                        >
                          Manage
                        </Button>
                        <Button
                          class="text-xs"
                          onClick={() => disconnect(provider.id)}
                          size="sm"
                          variant="ghost"
                        >
                          Disconnect
                        </Button>
                      </div>
                    </div>
                    <Show
                      when={
                        connectedProviders().indexOf(provider) <
                        connectedProviders().length - 1
                      }
                    >
                      <div class="mx-4 border-border/60 border-b" />
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
            <h3 class="font-semibold text-sm tracking-tight">
              Hybrid Vision Fallback
            </h3>
            <p class="mt-0.5 text-muted-foreground text-xs">
              Auto-route image prompts from text-only models to a vision-capable
              model.
            </p>
          </div>
          <label class="flex items-center gap-2 text-xs">
            <input
              checked={hybridEnabled()}
              onChange={(event) =>
                setHybridEnabled(event.currentTarget.checked)
              }
              type="checkbox"
            />
            Enabled
          </label>
        </div>

        <p class="mb-1 block text-muted-foreground text-xs">
          Vision fallback model
        </p>
        <div class="flex items-center gap-2">
          <button
            class={cn(
              "w-full rounded-md border border-border/80 bg-background/70 px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted/60",
              "disabled:cursor-not-allowed disabled:opacity-60"
            )}
            disabled={true}
            type="button"
          >
            Select vision model
          </button>
        </div>

        <Show when={hybridEnabled()}>
          <p class="mt-2 text-primary/85 text-xs">
            Hybrid fallback is enabled but no vision model is selected yet.
          </p>
        </Show>
      </Card>

      <Show when={modalPresence.isMounted()}>
        <Portal>
          {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Modal wrapper listens for keyboard shortcuts while focus may be inside nested content. */}
          <div
            aria-modal="true"
            class={cn(
              "fixed inset-0 z-50 flex items-center justify-center p-4",
              !isProviderTopmost() && "pointer-events-none opacity-0"
            )}
            data-kb-top-layer={isProviderTopmost() ? "" : undefined}
            data-testid="provider-modal"
            onKeyDown={(event) => handleProviderModalKeyDown(event)}
            role="dialog"
            style={{
              "pointer-events": isProviderTopmost() ? "auto" : undefined,
            }}
            tabIndex={-1}
          >
            <button
              aria-label="Close provider selector"
              class="command-dialog-overlay-motion absolute inset-0 bg-black/80 backdrop-blur-sm"
              data-exiting={modalPresence.isExiting() ? "" : undefined}
              data-stack-overlay={providerStackId}
              data-visible={modalPresence.isVisible() ? "" : undefined}
              onClick={closeModal}
              type="button"
            />

            <div
              class="provider-modal-content-motion model-selector-shell relative z-10 w-full max-w-5xl overflow-hidden rounded-xl border border-border/70 bg-popover/95 text-popover-foreground shadow-[0_28px_80px_rgba(0,0,0,0.6)]"
              data-exiting={modalPresence.isExiting() ? "" : undefined}
              data-stack-content={providerStackId}
              data-visible={modalPresence.isVisible() ? "" : undefined}
            >
              <div class="model-selector-grain pointer-events-none absolute inset-0" />
              <div class="relative border-border/80 border-b bg-muted/45 px-4 pt-3 pb-2.5 backdrop-blur-xl">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <h3 class="font-semibold text-[13px] tracking-tight">
                      Connect a provider
                    </h3>
                    <p class="text-[10px] text-muted-foreground">
                      Search providers and connect with API key
                    </p>
                  </div>
                  <button
                    class="rounded-md border border-border/80 bg-background/75 px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted/80 hover:text-foreground"
                    onClick={closeModal}
                    type="button"
                  >
                    Close
                  </button>
                </div>

                <div class="mt-3">
                  <label class="flex items-center gap-2 rounded-md border border-border/80 bg-background/65 px-2.5 py-2 transition-colors focus-within:border-primary/40">
                    <FiSearch class="size-4 text-muted-foreground" />
                    <input
                      autofocus
                      class="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/80"
                      onInput={(event) =>
                        setProviderSearchQuery(event.currentTarget.value)
                      }
                      placeholder="Search providers..."
                      ref={(element) => {
                        providerSearchInputRef = element;
                      }}
                      type="text"
                      value={providerSearchQuery()}
                    />
                  </label>
                </div>
              </div>

              <div class="relative grid h-[480px] min-h-0 gap-0 md:grid-cols-[1.1fr_1.4fr]">
                <div class="min-h-0 border-border/80 border-r">
                  <div class="h-full min-h-0 overflow-y-auto overscroll-contain bg-background/35 px-2 py-2 [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/40 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2.5">
                    <Show
                      fallback={
                        <p class="px-3 py-4 text-muted-foreground text-sm">
                          No providers found.
                        </p>
                      }
                      when={filteredProviders().length > 0}
                    >
                      <div class="mb-3">
                        <p class="px-2 pb-1 font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.1em]">
                          All Providers
                        </p>
                        <div class="space-y-1">
                          <For each={filteredProviders()}>
                            {(provider) => {
                              const isSelected = () =>
                                selectedProviderId() === provider.id;
                              const isConnected = () => provider.connected;
                              return (
                                <button
                                  class={cn(
                                    "group w-full rounded-md border px-2.5 py-2 text-left transition-all duration-120",
                                    isSelected()
                                      ? "border-primary/45 bg-accent/70 shadow-[0_0_0_1px_color-mix(in_oklch,var(--color-primary)_45%,transparent),0_8px_24px_color-mix(in_oklch,var(--color-primary)_18%,transparent)]"
                                      : "border-transparent hover:border-border/90 hover:bg-muted/70"
                                  )}
                                  data-testid={`provider-option-${provider.id}`}
                                  onClick={() =>
                                    setSelectedProviderId(provider.id)
                                  }
                                  type="button"
                                >
                                  <div class="flex items-center justify-between gap-2">
                                    <span class="truncate font-medium text-sm">
                                      {provider.name}
                                    </span>
                                    <div class="flex items-center gap-1">
                                      <Show when={provider.popular}>
                                        <span class="rounded-full border border-primary/35 bg-primary/12 px-1.5 py-0.5 text-[10px] text-primary uppercase tracking-wide">
                                          Popular
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
                                        {isConnected()
                                          ? "Connected"
                                          : "Not Connected"}
                                      </span>
                                    </div>
                                  </div>
                                  <div class="mt-1 flex items-center justify-between gap-2">
                                    <span class="truncate text-muted-foreground text-xs">
                                      {provider.id}
                                    </span>
                                    <span class="text-[10px] text-muted-foreground">
                                      {provider.modelCount} models
                                    </span>
                                  </div>
                                </button>
                              );
                            }}
                          </For>
                        </div>
                      </div>
                    </Show>
                  </div>
                </div>

                <div class="h-full min-h-0 overflow-y-auto overscroll-contain bg-background/30 px-4 py-4 [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/40 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2.5">
                  <Show
                    fallback={
                      <p class="text-muted-foreground text-sm">
                        Select a provider.
                      </p>
                    }
                    when={selectedProvider()}
                  >
                    {(provider) => {
                      const providerId = () => provider().id;
                      const isConnected = () => provider().connected;
                      const error = () => errorByProvider()[providerId()];

                      return (
                        <div class="space-y-4">
                          <div class="rounded-lg border border-border/80 bg-background/65 p-3">
                            <div class="flex items-center justify-between gap-3">
                              <div class="min-w-0">
                                <p class="truncate font-semibold text-sm tracking-tight">
                                  {provider().name}
                                </p>
                                <p class="truncate text-muted-foreground text-xs">
                                  {provider().id}
                                </p>
                              </div>
                              <div class="flex items-center gap-2">
                                <span class="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground uppercase tracking-wide">
                                  {provider().modelCount} models
                                </span>
                                <Show when={provider().popular}>
                                  <span class="rounded-full border border-primary/35 bg-primary/12 px-2 py-0.5 text-[10px] text-primary uppercase tracking-wide">
                                    Popular
                                  </span>
                                </Show>
                              </div>
                            </div>
                            <Show when={provider().note}>
                              <p class="mt-2 text-muted-foreground text-xs">
                                {provider().note}
                              </p>
                            </Show>
                          </div>

                          <Show
                            fallback={
                              <div class="rounded-lg border border-border/80 bg-background/60 p-3">
                                <div class="mb-3 flex items-center justify-between gap-2">
                                  <p class="font-semibold text-foreground text-xs tracking-wide">
                                    API Key
                                  </p>
                                  <span class="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase tracking-wide">
                                    api
                                  </span>
                                </div>
                                <div class="space-y-2">
                                  <div class="flex flex-wrap items-center gap-2">
                                    <input
                                      class="w-full min-w-[220px] flex-1 rounded-md border border-border bg-background px-2.5 py-2 text-foreground text-xs outline-none transition-colors placeholder:text-muted-foreground/80 focus:border-primary/45"
                                      onInput={(event) => {
                                        setTokenDraft(
                                          providerId(),
                                          event.currentTarget.value
                                        );
                                      }}
                                      placeholder="API key"
                                      type="password"
                                      value={
                                        tokenByProvider()[providerId()] ?? ""
                                      }
                                    />
                                    <button
                                      class="rounded-md border border-border/90 bg-muted/70 px-2.5 py-2 font-medium text-foreground text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                                      disabled={
                                        (
                                          tokenByProvider()[providerId()] ?? ""
                                        ).trim().length === 0
                                      }
                                      onClick={() => connectToken(providerId())}
                                      type="button"
                                    >
                                      Connect
                                    </button>
                                  </div>
                                </div>
                              </div>
                            }
                            when={isConnected()}
                          >
                            <div class="rounded-lg border border-primary/30 bg-primary/10 p-3">
                              <div class="flex items-center justify-between gap-2">
                                <p class="font-semibold text-primary text-xs tracking-wide">
                                  Connected
                                </p>
                                <span class="rounded-full border border-primary/35 px-1.5 py-0.5 text-[10px] text-primary uppercase tracking-wide">
                                  Active
                                </span>
                              </div>
                              <p class="mt-1 text-muted-foreground text-xs">
                                This provider is connected. You can disconnect
                                it from here.
                              </p>
                              <div class="mt-3">
                                <button
                                  class="rounded-md border border-border/90 bg-muted/70 px-2.5 py-2 font-medium text-foreground text-xs transition-colors hover:bg-muted"
                                  onClick={() => disconnect(providerId())}
                                  type="button"
                                >
                                  Disconnect
                                </button>
                              </div>
                            </div>
                          </Show>

                          <Show when={error()}>
                            <p class="text-destructive text-xs">{error()}</p>
                          </Show>
                        </div>
                      );
                    }}
                  </Show>
                </div>
              </div>

              <div class="flex items-center justify-end gap-2 border-border/80 border-t bg-muted/55 px-3 py-1.5 text-[10px] text-muted-foreground backdrop-blur-xl">
                <kbd class="rounded border border-border bg-background px-1.5 py-0.5 text-foreground">
                  Enter
                </kbd>
                <span>Select</span>
                <kbd class="ml-2 rounded border border-border bg-background px-1.5 py-0.5 text-foreground">
                  ↑↓
                </kbd>
                <span>Navigate</span>
                <kbd class="ml-2 rounded border border-border bg-background px-1.5 py-0.5 text-foreground">
                  Esc
                </kbd>
                <span>Close</span>
              </div>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  );
}
