import { createSignal, For, Show } from "solid-js";
import { cn } from "~/lib/utils";

interface ConnectedProvider {
  id: string;
  modelCount: number;
  name: string;
}

const MOCK_CONNECTED_PROVIDERS: ConnectedProvider[] = [];

export function ModelsSettings() {
  const [isModalOpen, setIsModalOpen] = createSignal(false);
  const [hybridEnabled, setHybridEnabled] = createSignal(true);
  const [selectedVisionModel, setSelectedVisionModel] = createSignal<
    string | null
  >(null);

  return (
    <div class="mt-4 space-y-4">
      {/* Providers Card */}
      <div class="rounded-lg border border-border bg-card p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 class="font-semibold text-sm tracking-tight">Providers</h3>
            <p class="mt-0.5 text-muted-foreground text-xs">
              Connect model providers to use in sakti.
            </p>
          </div>
          <button
            class="rounded-md border border-primary/30 bg-primary/12 px-3 py-1.5 font-medium text-primary text-xs transition-colors hover:bg-primary/18"
            onClick={() => setIsModalOpen(true)}
            type="button"
          >
            Connect a provider
          </button>
        </div>

        <div class="mb-3 border-border/60 border-b" />

        <Show
          fallback={
            <div class="py-4 text-center">
              <p class="text-muted-foreground text-sm">
                No provider connected yet.
              </p>
              <button
                class="mt-3 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90"
                onClick={() => setIsModalOpen(true)}
                type="button"
              >
                Select provider
              </button>
            </div>
          }
          when={MOCK_CONNECTED_PROVIDERS.length > 0}
        >
          <div class="-mx-4 space-y-0">
            <For each={MOCK_CONNECTED_PROVIDERS}>
              {(provider, index) => (
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
                      <button
                        class="rounded-md px-2 py-1 font-medium text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground"
                        onClick={() => setIsModalOpen(true)}
                        type="button"
                      >
                        Manage
                      </button>
                      <button
                        class="rounded-md px-2 py-1 font-medium text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground"
                        type="button"
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                  <Show when={index() < MOCK_CONNECTED_PROVIDERS.length - 1}>
                    <div class="mx-4 border-border/60 border-b" />
                  </Show>
                </>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* Hybrid Vision Fallback Card */}
      <div class="rounded-lg border border-border bg-card p-4">
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
              onChange={(e) => setHybridEnabled(e.currentTarget.checked)}
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
            disabled={!hybridEnabled()}
            type="button"
          >
            {selectedVisionModel() ?? "Select vision model"}
          </button>
          <Show when={selectedVisionModel()}>
            <button
              class="shrink-0 rounded-md px-2 py-1 font-medium text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground"
              disabled={!hybridEnabled()}
              onClick={() => setSelectedVisionModel(null)}
              type="button"
            >
              Clear
            </button>
          </Show>
        </div>

        <Show when={hybridEnabled() && !selectedVisionModel()}>
          <p class="mt-2 text-primary/85 text-xs">
            Hybrid fallback is enabled but no vision model is selected yet.
          </p>
        </Show>

        <Show when={selectedVisionModel()}>
          <p class="mt-2 text-muted-foreground text-xs">
            Selected: {selectedVisionModel()}
          </p>
        </Show>
      </div>

      {/* Provider Modal */}
      <Show when={isModalOpen()}>
        <div
          aria-modal="true"
          class="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          tabIndex={-1}
        >
          <button
            aria-label="Close provider selector"
            class="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setIsModalOpen(false)}
            type="button"
          />

          <div class="model-selector-shell relative z-10 w-full max-w-5xl overflow-hidden rounded-xl border border-border/70 bg-popover/95 text-popover-foreground shadow-[0_28px_80px_rgba(0,0,0,0.6)]">
            <div class="model-selector-grain pointer-events-none absolute inset-0" />
            <div class="relative border-border/80 border-b bg-muted/45 px-4 pt-3 pb-2.5 backdrop-blur-xl">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <h3 class="font-semibold text-[13px] tracking-tight">
                    Connect a provider
                  </h3>
                  <p class="text-[10px] text-muted-foreground">
                    Search providers and connect with API key or OAuth
                  </p>
                </div>
                <button
                  class="rounded-md border border-border/80 bg-background/75 px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted/80 hover:text-foreground"
                  onClick={() => setIsModalOpen(false)}
                  type="button"
                >
                  Close
                </button>
              </div>

              <div class="mt-3">
                <label class="flex items-center gap-2 rounded-md border border-border/80 bg-background/65 px-2.5 py-2 transition-colors focus-within:border-primary/40">
                  <svg
                    class="size-4 text-muted-foreground"
                    fill="none"
                    role="img"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <title>Search</title>
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  <input
                    autofocus
                    class="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/80"
                    placeholder="Search providers..."
                    type="text"
                  />
                </label>
              </div>
            </div>

            <div class="relative grid h-[480px] min-h-0 gap-0 md:grid-cols-[1.1fr_1.4fr]">
              <div class="min-h-0 border-border/80 border-r">
                <div class="scrollbar-subtle h-full min-h-0 overflow-y-auto overscroll-contain bg-background/35 px-2 py-2">
                  <p class="px-3 py-4 text-muted-foreground text-sm">
                    No providers found.
                  </p>
                </div>
              </div>

              <div class="scrollbar-subtle h-full min-h-0 overflow-y-auto overscroll-contain bg-background/30 px-4 py-4">
                <p class="text-muted-foreground text-sm">Select a provider.</p>
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
      </Show>
    </div>
  );
}
