import { createResource, For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";
import { useStore } from "~/stores/store-context";

interface Model {
  contextWindow: number;
  id: string;
  input: string[];
  name: string;
  provider: string;
  reasoning: boolean;
}

export default function ModelSelector() {
  const { api, server } = useStore();

  const [providers, { refetch: refetchProviders }] = createResource(
    async () => {
      const res = await api.api.models.available.$get();
      if (!res.ok) {
        return [] as string[];
      }
      return (await res.json()) as string[];
    }
  );

  const [providerModels, { refetch: refetchProviderModels }] = createResource(
    () => providers() ?? [],
    async (providerList) => {
      const results: Record<string, Model[]> = {};
      for (const provider of providerList) {
        const res = await api.api.models.available[":provider"].$get({
          param: { provider },
        });
        if (res.ok) {
          results[provider] = (await res.json()) as Model[];
        }
      }
      return results;
    }
  );

  const handleRefresh = () => {
    refetchProviders();
    refetchProviderModels();
  };

  const activeSession = () => {
    const id = server.store.activeSessionId;
    return id ? server.store.sessions[id] : undefined;
  };

  const currentModelLabel = () => {
    const session = activeSession();
    if (!session) {
      return "No model";
    }
    const models = providerModels();
    if (!models) {
      if (!session.modelId) {
        return "Select profile";
      }
      return session.modelId;
    }
    for (const providerModelsList of Object.values(models)) {
      const found = providerModelsList.find((m) => m.id === session.modelId);
      if (found) {
        return found.name || found.id;
      }
    }
    if (!session.modelId) {
      return "Select profile";
    }
    return session.modelId;
  };

  const handleSelect = async (_model: Model) => {
    // TODO: replace with profile selector in follow-up plan
  };

  const providerLabel = (provider: string) => {
    if (provider.length === 0) {
      return "Unknown";
    }
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger<typeof Button>
        as={Button}
        class="h-7 gap-1.5 text-xs"
        size="sm"
        variant="ghost"
      >
        <svg
          aria-label="Model"
          class="h-3.5 w-3.5 shrink-0"
          fill="currentColor"
          role="img"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>Model</title>
          <path d="M8 1a.5.5 0 0 1 .424.235l2.5 4a.5.5 0 0 1-.025.526l-2.5 3.5a.5.5 0 0 1-.798 0l-2.5-3.5a.5.5 0 0 1-.025-.526l2.5-4A.5.5 0 0 1 8 1zM6.28 5.5 8 2.752 9.72 5.5l-1.72 2.408L6.28 5.5z" />
          <path d="M2.5 10a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5v-3zm1 .5v2h9v-2h-9z" />
        </svg>
        <span class="max-w-[180px] truncate">{currentModelLabel()}</span>
        <svg
          aria-label="Toggle model list"
          class="h-3 w-3 shrink-0"
          fill="currentColor"
          role="img"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>Toggle model list</title>
          <path
            clip-rule="evenodd"
            d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06z"
          />
        </svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent class="max-h-[400px] w-80 overflow-y-auto">
        <div class="flex items-center justify-between border-border border-b px-3 py-2">
          <span class="font-medium text-foreground text-xs">
            Available Models
          </span>
          <button
            class={cn(
              "rounded p-1 text-muted-foreground transition-colors hover:text-foreground",
              providers.loading && "animate-spin"
            )}
            onClick={handleRefresh}
            title="Refresh models"
            type="button"
          >
            <svg
              aria-label="Refresh"
              class="h-3.5 w-3.5"
              fill="currentColor"
              role="img"
              viewBox="0 0 16 16"
              xmlns="http://www.w3.org/2000/svg"
            >
              <title>Refresh</title>
              <path
                clip-rule="evenodd"
                d="M3.083 5.802a5 5 0 0 1 8.92-.798.75.75 0 1 0 1.37-.61 6.5 6.5 0 0 0-11.595 1.036L1 4.75V7.5h2.75L3.083 5.802zM12.917 10.198a5 5 0 0 1-8.92.798.75.75 0 0 0-1.37.61 6.5 6.5 0 0 0 11.595-1.036L15 11.25V8.5h-2.75l.667 1.698z"
              />
            </svg>
          </button>
        </div>
        <Show
          fallback={
            <div class="flex items-center justify-center py-8">
              <span class="text-muted-foreground text-xs">Loading models…</span>
            </div>
          }
          when={!providers.loading && providers()}
        >
          <For each={providers() as string[]}>
            {(provider) => (
              <>
                <div class="px-3 pt-2 pb-1">
                  <span class="font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
                    {providerLabel(provider)}
                  </span>
                </div>
                <For each={providerModels()?.[provider] ?? []}>
                  {(model) => {
                    const isActive = () =>
                      activeSession()?.modelId === model.id;
                    return (
                      <DropdownMenuItem
                        class={cn(
                          "flex w-full items-center gap-2 px-3 py-1.5 text-left",
                          isActive()
                            ? "bg-accent text-accent-foreground"
                            : "text-foreground hover:bg-secondary"
                        )}
                        onSelect={() => handleSelect(model)}
                      >
                        <span
                          class={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            isActive()
                              ? "bg-accent-foreground"
                              : "bg-transparent"
                          )}
                        />
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-1.5">
                            <span class="truncate font-medium text-xs">
                              {model.name || model.id}
                            </span>
                            <Show when={model.reasoning}>
                              <span class="shrink-0 rounded bg-warning/30 px-1 py-0.5 font-medium text-[9px] text-warning-foreground">
                                reasoning
                              </span>
                            </Show>
                            <Show when={model.input.includes("image")}>
                              <span class="shrink-0 rounded bg-success/30 px-1 py-0.5 font-medium text-[9px] text-success-foreground">
                                vision
                              </span>
                            </Show>
                          </div>
                          <div class="mt-0.5 text-[10px] text-muted-foreground">
                            {model.id}
                            <Show when={model.contextWindow > 0}>
                              {" · "}
                              {Math.round(model.contextWindow / 1000)}k ctx
                            </Show>
                          </div>
                        </div>
                      </DropdownMenuItem>
                    );
                  }}
                </For>
              </>
            )}
          </For>
        </Show>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
