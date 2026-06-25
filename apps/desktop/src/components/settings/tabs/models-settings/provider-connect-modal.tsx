import { createPresence } from "@solid-primitives/presence";
import { FiSearch } from "solid-icons/fi";
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import { useDismissibleVisibility } from "~/lib/ui/dismissible-stack";
import { cn } from "~/lib/utils";

interface ProviderConnectModalProvider {
  connected: boolean;
  id: string;
  modelCount: number;
  name: string;
}

interface ProviderConnectModalProps {
  initialProviderId?: string;
  isOpen: boolean;
  onClose: () => void;
  onConnect: (providerId: string, key: string) => Promise<boolean>;
  onDisconnect: (providerId: string) => Promise<boolean>;
  providers: ProviderConnectModalProvider[];
}

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

export function ProviderConnectModal(props: ProviderConnectModalProps) {
  const [searchQuery, setSearchQuery] = createSignal("");
  const [selectedProviderId, setSelectedProviderId] = createSignal<
    string | null
  >(null);
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [tokenByProvider, setTokenByProvider] = createSignal<
    Record<string, string>
  >({});
  const [errorByProvider, setErrorByProvider] = createSignal<
    Record<string, string>
  >({});
  const providerStackId = createUniqueId();
  let providerSearchInputRef: HTMLInputElement | undefined;

  const {
    isTopmost: isProviderTopmost,
    show: showProviderStack,
    hide: hideProviderStack,
  } = useDismissibleVisibility(providerStackId);

  const modalPresence = createPresence(() => props.isOpen, {
    transitionDuration: 220,
    initialEnter: true,
  });

  createEffect(() => {
    if (modalPresence.isMounted()) {
      showProviderStack();
    } else {
      hideProviderStack();
    }
  });

  createEffect(() => {
    if (!props.isOpen) {
      setSearchQuery("");
      setActiveIndex(0);
      setTokenByProvider({});
      setErrorByProvider({});
      return;
    }
    const initialId = props.initialProviderId;
    const targetId =
      initialId && props.providers.some((p) => p.id === initialId)
        ? initialId
        : (props.providers[0]?.id ?? null);
    setSelectedProviderId(targetId);
  });

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

  createEffect(() => {
    const shouldFocus = props.isOpen && modalPresence.isMounted();
    if (!shouldFocus) {
      return;
    }

    const doFocus = () => {
      focusProviderSearchInput();
    };

    doFocus();
    queueMicrotask(doFocus);
    const frame = requestAnimationFrame(doFocus);

    onCleanup(() => {
      cancelAnimationFrame(frame);
    });
  });

  const filteredProviders = createMemo(() => {
    const query = searchQuery().trim().toLowerCase();
    if (!query) {
      return props.providers;
    }
    return props.providers.filter((provider) => {
      const haystack = `${provider.id} ${provider.name}`.toLowerCase();
      return haystack.includes(query);
    });
  });

  const visibleProviderIds = createMemo(() =>
    filteredProviders().map((p) => p.id)
  );

  const selectedProvider = createMemo(() => {
    const selectedId = selectedProviderId();
    if (selectedId) {
      const matched = props.providers.find((p) => p.id === selectedId);
      if (matched) {
        return matched;
      }
    }
    return props.providers[0] ?? null;
  });

  createEffect(() => {
    if (!props.isOpen) {
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

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
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

    const ok = await props.onConnect(providerId, token);
    if (ok) {
      setTokenByProvider((prev) => ({ ...prev, [providerId]: "" }));
      setErrorByProvider((prev) => ({ ...prev, [providerId]: "" }));
    } else {
      setErrorByProvider((prev) => ({
        ...prev,
        [providerId]: "Failed to save API key.",
      }));
    }
  };

  const setTokenDraft = (providerId: string, token: string) => {
    setTokenByProvider((prev) => ({ ...prev, [providerId]: token }));
  };

  return (
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
          onKeyDown={(event) => handleKeyDown(event)}
          role="dialog"
          style={{
            "pointer-events": isProviderTopmost() ? "auto" : undefined,
          }}
          tabIndex={-1}
        >
          <button
            aria-label="Close provider selector"
            class="absolute inset-0 bg-black/80 backdrop-blur-sm"
            data-exiting={modalPresence.isExiting() ? "" : undefined}
            data-stack-overlay={providerStackId}
            data-visible={modalPresence.isVisible() ? "" : undefined}
            onClick={props.onClose}
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
                  onClick={props.onClose}
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
                      setSearchQuery(event.currentTarget.value)
                    }
                    placeholder="Search providers..."
                    ref={(element) => {
                      providerSearchInputRef = element;
                    }}
                    type="text"
                    value={searchQuery()}
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
                            </div>
                          </div>
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
                              This provider is connected. You can disconnect it
                              from here.
                            </p>
                            <div class="mt-3">
                              <button
                                class="rounded-md border border-border/90 bg-muted/70 px-2.5 py-2 font-medium text-foreground text-xs transition-colors hover:bg-muted"
                                onClick={() => props.onDisconnect(providerId())}
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
  );
}
