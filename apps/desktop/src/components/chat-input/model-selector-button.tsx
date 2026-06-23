import { createMemo, createResource, createSignal, Show } from "solid-js";
import { createLogger } from "~/lib/utils";
import { useStore } from "~/stores/store-context";
import {
  ModelSelectorDialog,
  type ModelSelectorOption,
  type ModelSelectorSection,
} from "./model-selector-dialog";

const log = createLogger({ module: "model-selector-button" });

interface Model {
  contextWindow: number;
  id: string;
  input: string[];
  name: string;
  provider: string;
  reasoning: boolean;
}

export function ModelSelectorButton(props: { sessionId: string | null }) {
  const { api, server } = useStore();
  const [isOpen, setIsOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");

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
          provider.charAt(0).toUpperCase() + provider.slice(1);
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

  const session = () => {
    const id = props.sessionId;
    return id ? server.store.sessions[id] : undefined;
  };

  const modelLabel = () => {
    const s = session();
    log.debug("modelLabel", {
      sessionId: props.sessionId,
      hasSession: !!s,
      modelId: s?.modelId,
    });
    if (!s?.modelId) {
      return "Select model";
    }
    const found = modelOptions().find((m) => m.id === s.modelId);
    return found ? (found.name ?? found.id) : s.modelId;
  };

  const handleSelect = (modelId: string) => {
    log.debug("handleSelect", { modelId, sessionId: props.sessionId });
    if (!props.sessionId) {
      return;
    }
    server.actions.updateSession(props.sessionId, { modelId });
    api.api.sessions[":id"].$patch({
      param: { id: props.sessionId },
      json: { modelId },
    });
    log.debug("after updateSession", {
      modelId: server.store.sessions[props.sessionId]?.modelId,
    });
  };

  return (
    <Show when={modelOptions().length > 0}>
      <div class="flex flex-col items-end gap-0.5">
        <button
          aria-label="Open model selector"
          class="rounded border border-border bg-background px-2 py-1 text-xs hover:bg-muted"
          onClick={() => {
            setSearchQuery("");
            setIsOpen((open) => !open);
          }}
          type="button"
        >
          {modelLabel()}
        </button>
        <ModelSelectorDialog
          modelSections={modelSections()}
          onOpenChange={setIsOpen}
          onSearchChange={setSearchQuery}
          onSelect={handleSelect}
          open={isOpen()}
          searchQuery={searchQuery()}
          selectedModelId={session()?.modelId}
        />
      </div>
    </Show>
  );
}
