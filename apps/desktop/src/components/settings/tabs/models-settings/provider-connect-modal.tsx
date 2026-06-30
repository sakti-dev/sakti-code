import { For, Show } from "solid-js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { SearchBar } from "~/components/ui/search-bar";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { cn } from "~/lib/utils";
import { useProviderConnect } from "./use-provider-connect";

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

export const ProviderConnectModal = (props: ProviderConnectModalProps) => {
  const {
    connectToken,
    errorByProvider,
    filteredProviders,
    handleKeyDown,
    searchQuery,
    selectedProvider,
    selectedProviderId,
    setProviderSearchInputRef,
    setSearchQuery,
    setSelectedProviderId,
    setTokenDraft,
    tokenByProvider,
  } = useProviderConnect({
    initialProviderId: () => props.initialProviderId,
    isOpen: () => props.isOpen,
    onConnect: props.onConnect,
    providers: () => props.providers,
  });

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
      open={props.isOpen}
    >
      <DialogContent class="max-w-5xl" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <div class="flex items-center justify-between gap-3">
            <div>
              <DialogTitle>Connect a provider</DialogTitle>
              <DialogDescription>Search providers and connect with API key</DialogDescription>
            </div>
          </div>

          <div class="mt-3">
            <SearchBar
              inputProps={{
                autofocus: true,
                ref: setProviderSearchInputRef,
              }}
              onInput={setSearchQuery}
              placeholder="Search providers..."
              value={searchQuery()}
            />
          </div>
        </DialogHeader>

        <div class="relative grid h-[480px] min-h-0 gap-0 md:grid-cols-[1.1fr_1.4fr]">
          <div class="min-h-0 border-border/80 border-r">
            <div class="h-full min-h-0 overflow-y-auto overscroll-contain bg-background/35 px-2 py-2 [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/40 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2.5">
              <Show
                fallback={
                  <p class="px-3 py-4 text-muted-foreground text-sm">No providers found.</p>
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
                        const isSelected = () => selectedProviderId() === provider.id;
                        const isConnected = () => provider.connected;
                        return (
                          <button
                            class={cn(
                              "group w-full rounded-md border px-2.5 py-2 text-left transition-all duration-120",
                              isSelected()
                                ? "border-primary/45 bg-accent/70 shadow-[0_0_0_1px_color-mix(in_oklch,var(--color-primary)_45%,transparent),0_8px_24px_color-mix(in_oklch,var(--color-primary)_18%,transparent)]"
                                : "border-transparent hover:border-border/90 hover:bg-muted/70",
                            )}
                            data-testid={`provider-option-${provider.id}`}
                            onClick={() => setSelectedProviderId(provider.id)}
                            type="button"
                          >
                            <div class="flex items-center justify-between gap-2">
                              <span class="truncate font-medium text-sm">{provider.name}</span>
                              <div class="flex items-center gap-1">
                                <span
                                  class={cn(
                                    "rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                                    isConnected()
                                      ? "border-primary/30 bg-primary/10 text-primary"
                                      : "border-border bg-background text-muted-foreground",
                                  )}
                                >
                                  {isConnected() ? "Connected" : "Not Connected"}
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
              fallback={<p class="text-muted-foreground text-sm">Select a provider.</p>}
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
                          <p class="truncate text-muted-foreground text-xs">{provider().id}</p>
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
                              <TextField class="contents">
                                <TextFieldInput
                                  class="min-w-[220px] flex-1"
                                  onInput={(event) => {
                                    setTokenDraft(providerId(), event.currentTarget.value);
                                  }}
                                  placeholder="API key"
                                  type="password"
                                  value={tokenByProvider()[providerId()] ?? ""}
                                />
                              </TextField>
                              <button
                                class="rounded-md border border-border/90 bg-muted/70 px-2.5 py-2 font-medium text-foreground text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={
                                  (tokenByProvider()[providerId()] ?? "").trim().length === 0
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
                          <p class="font-semibold text-primary text-xs tracking-wide">Connected</p>
                          <span class="rounded-full border border-primary/35 px-1.5 py-0.5 text-[10px] text-primary uppercase tracking-wide">
                            Active
                          </span>
                        </div>
                        <p class="mt-1 text-muted-foreground text-xs">
                          This provider is connected. You can disconnect it from here.
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

        <DialogFooter>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
