import { createMemo, createResource, createSignal, Show } from "solid-js";
import { useStore } from "~/stores/store-context";
import {
  ModelSelectorDialog,
  type ModelSelectorOption,
  type ModelSelectorSection,
} from "./model-selector-dialog";

interface Model {
  contextWindow: number;
  id: string;
  input: string[];
  name: string;
  provider: string;
  reasoning: boolean;
}

interface ProviderSummary {
  id: string;
  modelCount: number;
  name: string;
}

export interface ModelPickerButtonProps {
  onSelect: (model: {
    id: string;
    provider: string;
    reasoning: boolean;
  }) => void;
  triggerLabel: () => string;
  value: string;
}

export function ModelPickerButton(props: ModelPickerButtonProps) {
  const { api } = useStore();
  const [isOpen, setIsOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");

  const [providers] = createResource(async () => {
    const res = await api.api.models.available.$get();
    if (!res.ok) {
      return [] as ProviderSummary[];
    }
    return (await res.json()) as ProviderSummary[];
  });

  const [providerModels] = createResource(
    () => providers() ?? [],
    async (providerList) => {
      const results: Record<string, Model[]> = {};
      for (const provider of providerList) {
        const res = await api.api.models.available[":provider"].$get({
          param: { provider: provider.id },
        });
        if (res.ok) {
          results[provider.id] = (await res.json()) as Model[];
        }
      }
      return results;
    }
  );

  const [authStates] = createResource(async () => {
    const res = await api.api.auth.$get();
    if (!res.ok) {
      return [] as Array<{ provider: string; hasKey: boolean }>;
    }
    return (await res.json()) as Array<{
      provider: string;
      hasKey: boolean;
    }>;
  });

  const connectedProviders = createMemo(() => {
    const states = authStates();
    if (!states) {
      return new Set<string>();
    }
    return new Set(states.filter((s) => s.hasKey).map((s) => s.provider));
  });

  const modelOptions = createMemo<ModelSelectorOption[]>(() => {
    const models = providerModels();
    if (!models) {
      return [];
    }
    const connected = connectedProviders();
    const options: ModelSelectorOption[] = [];
    for (const [provider, providerModelList] of Object.entries(models)) {
      if (!connected.has(provider)) {
        continue;
      }
      for (const model of providerModelList) {
        const providerName =
          providers()?.find((p) => p.id === provider)?.name ?? provider;
        options.push({
          id: model.id,
          name: model.name || model.id,
          providerId: provider,
          providerName,
          connected: true,
        });
      }
    }
    return options;
  });

  const modelSections = createMemo<ModelSelectorSection[]>(() => {
    const query = searchQuery().trim().toLowerCase();
    const filtered = query
      ? modelOptions().filter((m) =>
          `${m.id} ${m.name ?? ""} ${m.providerId}`
            .toLowerCase()
            .includes(query)
        )
      : modelOptions();

    const map = new Map<string, ModelSelectorSection>();
    for (const model of filtered) {
      const existing = map.get(model.providerId);
      if (existing) {
        existing.models.push(model);
        existing.connected = existing.connected || model.connected;
        continue;
      }
      map.set(model.providerId, {
        providerId: model.providerId,
        providerName: model.providerName ?? model.providerId,
        connected: model.connected,
        models: [model],
      });
    }
    return Array.from(map.values());
  });

  return (
    <Show when={modelOptions().length > 0}>
      <div class="flex flex-col items-end gap-0.5">
        <button
          aria-label="Open model selector"
          class="flex h-7 flex-1 items-center justify-between gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-xs transition-colors hover:bg-muted/60"
          onClick={() => {
            setSearchQuery("");
            setIsOpen((open) => !open);
          }}
          type="button"
        >
          <span class="truncate">{props.triggerLabel()}</span>
          <svg
            aria-label="Toggle model list"
            class="size-3 shrink-0 text-muted-foreground"
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
        </button>
        <ModelSelectorDialog
          modelSections={modelSections()}
          onOpenChange={setIsOpen}
          onSearchChange={setSearchQuery}
          onSelect={(modelId, providerId) => {
            const models = providerModels();
            const model = models?.[providerId]?.find((m) => m.id === modelId);
            props.onSelect({
              id: modelId,
              provider: providerId,
              reasoning: model?.reasoning ?? false,
            });
            setIsOpen(false);
          }}
          open={isOpen()}
          searchQuery={searchQuery()}
          selectedModelId={props.value || undefined}
        />
      </div>
    </Show>
  );
}
