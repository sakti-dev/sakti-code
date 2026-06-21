import { createResource, For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useStore } from "~/stores/store-context";

interface Model {
  id: string;
  name: string;
  provider: string;
}

export default function ModelSelector() {
  const { api, server } = useStore();

  const [providers] = createResource(async () => {
    const { data, error } = await api.api.models.available.get();
    if (error || !data) {
      return [] as string[];
    }
    return data as string[];
  });

  const [providerModels] = createResource(
    () => providers() ?? [],
    async (providerList) => {
      const results: Record<string, Model[]> = {};
      for (const provider of providerList) {
        const { data, error } = await api.api.models
          .available({ provider })
          .get();
        if (!error && data) {
          results[provider] = data as Model[];
        }
      }
      return results;
    }
  );

  const activeSession = () => {
    const id = server.store.activeSessionId;
    return id ? server.store.sessions[id] : undefined;
  };

  const currentModelLabel = () => {
    const session = activeSession();
    if (!session) {
      return "Select model";
    }
    const models = providerModels();
    if (!models) {
      return session.modelId;
    }
    for (const providerModelsList of Object.values(models)) {
      const found = providerModelsList.find((m) => m.id === session.modelId);
      if (found) {
        return `${found.name} (${found.provider})`;
      }
    }
    return session.modelId;
  };

  const handleSelect = (model: Model) => {
    const session = activeSession();
    if (!session) {
      return;
    }
    server.actions.updateSession(session.id, { modelId: model.id });
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenuTrigger<typeof Button>
        as={Button}
        class="h-7 gap-1.5 text-xs"
        size="sm"
        variant="ghost"
      >
        {currentModelLabel()}
      </DropdownMenuTrigger>
      <DropdownMenuContent class="max-h-80 w-64 overflow-y-auto">
        <Show
          fallback={
            <div class="px-2 py-1.5 text-muted-foreground text-xs">
              Loading…
            </div>
          }
          when={!providers.loading && providers()}
        >
          <For each={providers() as string[]}>
            {(provider) => (
              <>
                <DropdownMenuLabel>{provider}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <For each={providerModels()?.[provider] ?? []}>
                  {(model) => (
                    <DropdownMenuItem
                      class={
                        activeSession()?.modelId === model.id
                          ? "bg-accent text-accent-foreground"
                          : ""
                      }
                      onSelect={() => handleSelect(model)}
                    >
                      <span>{model.name}</span>
                    </DropdownMenuItem>
                  )}
                </For>
              </>
            )}
          </For>
        </Show>
      </DropdownMenuContent>
    </DropdownMenu.Root>
  );
}
