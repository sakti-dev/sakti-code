import { For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";

interface ConnectedProvidersListProvider {
  connected: boolean;
  id: string;
  modelCount: number;
  name: string;
}

interface ConnectedProvidersListProps {
  hasLoaded: boolean;
  onDisconnect: (providerId: string) => void;
  onOpenModal: (providerId?: string) => void;
  providers: ConnectedProvidersListProvider[];
}

export function ConnectedProvidersList(props: ConnectedProvidersListProps) {
  return (
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
          onClick={() => props.onOpenModal()}
          type="button"
        >
          Connect a provider
        </button>
      </div>

      <div class="mb-3 border-border/60 border-b" />

      <Show fallback={<p class="text-sm">Loading providers...</p>} when={props.hasLoaded}>
        <Show
          fallback={
            <div class="py-4 text-center">
              <p class="text-muted-foreground text-sm">No provider connected yet.</p>
              <Button class="mt-3" onClick={() => props.onOpenModal()} size="sm" variant="primary">
                Select provider
              </Button>
            </div>
          }
          when={props.providers.length > 0}
        >
          <div class="-mx-4 space-y-0">
            <For each={props.providers}>
              {(provider) => (
                <>
                  <div class="flex items-center justify-between gap-3 px-4 py-3">
                    <div class="min-w-0 flex-1">
                      <p class="truncate font-medium text-sm">{provider.name}</p>
                      <p class="truncate text-muted-foreground text-xs">
                        {provider.modelCount} models
                      </p>
                    </div>
                    <div class="flex items-center gap-2">
                      <Button
                        class="text-xs"
                        onClick={() => props.onOpenModal(provider.id)}
                        size="sm"
                        variant="ghost"
                      >
                        Manage
                      </Button>
                      <Button
                        class="text-xs"
                        onClick={() => props.onDisconnect(provider.id)}
                        size="sm"
                        variant="ghost"
                      >
                        Disconnect
                      </Button>
                    </div>
                  </div>
                  <Show when={props.providers.indexOf(provider) < props.providers.length - 1}>
                    <div class="mx-4 border-border/60 border-b" />
                  </Show>
                </>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </Card>
  );
}
