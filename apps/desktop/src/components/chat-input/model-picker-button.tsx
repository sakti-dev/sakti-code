import { createResource, For, Show } from "solid-js";
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

export function ModelPickerButton(props: { sessionId: string | null }) {
  const { api, server } = useStore();

  const [providers] = createResource(async () => {
    const res = await api.api.models.available.$get();
    if (!res.ok) {
      return [] as string[];
    }
    return (await res.json()) as string[];
  });

  const [providerModels] = createResource(
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

  const session = () => {
    const id = props.sessionId;
    return id ? server.store.sessions[id] : undefined;
  };

  const currentLabel = () => {
    const s = session();
    if (!s) {
      return "No model";
    }
    const models = providerModels();
    if (!models) {
      return s.modelId;
    }
    for (const list of Object.values(models)) {
      const found = list.find((m) => m.id === s.modelId);
      if (found) {
        return found.name || found.id;
      }
    }
    return s.modelId;
  };

  const handleSelect = (model: Model) => {
    if (!props.sessionId) {
      return;
    }
    server.actions.updateSession(props.sessionId, { modelId: model.id });
  };

  const providerLabel = (p: string) =>
    p.length === 0 ? "Unknown" : p.charAt(0).toUpperCase() + p.slice(1);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        as="button"
        class="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground"
        type="button"
      >
        <span class="max-w-[140px] truncate">{currentLabel()}</span>
        <svg
          aria-label="Toggle model list"
          class="size-3 shrink-0"
          fill="currentColor"
          viewBox="0 0 16 16"
        >
          <path
            clip-rule="evenodd"
            d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06z"
          />
        </svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent class="max-h-[400px] w-72 overflow-y-auto">
        <Show
          fallback={
            <div class="py-6 text-center text-muted-foreground text-xs">
              Loading models…
            </div>
          }
          when={!providers.loading && providerModels()}
        >
          <For each={providers() ?? []}>
            {(provider) => (
              <>
                <div class="px-3 pt-2 pb-1">
                  <span class="font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
                    {providerLabel(provider)}
                  </span>
                </div>
                <For each={providerModels()?.[provider] ?? []}>
                  {(model) => {
                    const isActive = () => session()?.modelId === model.id;
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
                            "size-1.5 shrink-0 rounded-full",
                            isActive()
                              ? "bg-accent-foreground"
                              : "bg-transparent"
                          )}
                        />
                        <div class="min-w-0 flex-1">
                          <span class="truncate font-medium text-xs">
                            {model.name || model.id}
                          </span>
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
