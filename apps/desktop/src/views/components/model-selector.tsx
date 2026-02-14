import type { ProviderModel } from "@/core/services/api/provider-client";
import { For } from "solid-js";

interface ModelSelectorProps {
  models: ProviderModel[];
  selectedModelId: string;
  onChange: (modelId: string) => void;
}

export function ModelSelector(props: ModelSelectorProps) {
  return (
    <label class="flex items-center gap-3 text-sm">
      <span class="text-muted-foreground">Model</span>
      <select
        class="bg-background border-border rounded border px-2 py-1 text-sm"
        value={props.selectedModelId}
        onInput={event => props.onChange(event.currentTarget.value)}
      >
        <For each={props.models}>
          {model => (
            <option value={model.id} disabled={model.capabilities?.text === false}>
              {model.name || model.id} ({model.providerId})
            </option>
          )}
        </For>
      </select>
    </label>
  );
}
