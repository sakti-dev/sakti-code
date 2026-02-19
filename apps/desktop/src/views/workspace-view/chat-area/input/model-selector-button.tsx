import {
  ModelSelector,
  type CommandCenterMode,
  type ModelSelectorSection,
} from "@/components/model-selector";
import { Show, type Accessor, type Component, type Setter } from "solid-js";

export interface ChatInputModelOption {
  id: string;
  providerId: string;
  providerName?: string;
  name?: string;
  connected: boolean;
}

interface ModelSelectorButtonProps {
  modelOptions: ChatInputModelOption[];
  selectedModel: string;
  workspaceRoot?: string;
  isOpen: Accessor<boolean>;
  setIsOpen: Setter<boolean>;
  commandMode: Accessor<CommandCenterMode>;
  setCommandMode: Setter<CommandCenterMode>;
  searchQuery: Accessor<string>;
  setSearchQuery: Setter<string>;
  fileSearchResults: Accessor<
    Array<{ path: string; name: string; score: number; type: "file" | "directory" }>
  >;
  setFileSearchResults: Setter<
    Array<{ path: string; name: string; score: number; type: "file" | "directory" }>
  >;
  onModelChange: (modelId: string) => void;
  getModelSections?: (query: string) => ModelSelectorSection[];
  getConnectedModelOptions?: (query: string) => ChatInputModelOption[];
  getNotConnectedModelOptions?: (query: string) => ChatInputModelOption[];
  getFileSearchResults?: (
    query: string
  ) => Promise<Array<{ path: string; name: string; score: number; type: "file" | "directory" }>>;
  onValueChange: (value: string) => void;
  inputValue: Accessor<string>;
}

export const ModelSelectorButton: Component<ModelSelectorButtonProps> = props => {
  const fallbackFilteredModels = () => {
    const query = props.searchQuery().trim().toLowerCase();
    if (!query) return props.modelOptions;
    return props.modelOptions.filter(model => {
      const haystack = `${model.id} ${model.name ?? ""} ${model.providerId}`.toLowerCase();
      return haystack.includes(query);
    });
  };

  const connectedModels = () =>
    props.getConnectedModelOptions
      ? props.getConnectedModelOptions(props.searchQuery())
      : fallbackFilteredModels().filter(model => model.connected);

  const notConnectedModels = () =>
    props.getNotConnectedModelOptions
      ? props.getNotConnectedModelOptions(props.searchQuery())
      : fallbackFilteredModels().filter(model => !model.connected);

  const fallbackModelSections = (): ModelSelectorSection[] => {
    const map = new Map<string, ModelSelectorSection>();
    for (const model of [...connectedModels(), ...notConnectedModels()]) {
      const providerName = model.providerName ?? model.providerId;
      const existing = map.get(model.providerId);
      if (existing) {
        existing.models.push(model);
        existing.connected = existing.connected || model.connected;
        continue;
      }
      map.set(model.providerId, {
        providerId: model.providerId,
        providerName,
        connected: model.connected,
        models: [model],
      });
    }
    return Array.from(map.values());
  };

  const modelSections = () => {
    if (!props.isOpen()) return [] as ModelSelectorSection[];
    return props.getModelSections
      ? props.getModelSections(props.searchQuery())
      : fallbackModelSections();
  };

  const modelLabel = () => {
    if (!props.selectedModel) return "Select model";
    const selected = props.modelOptions.find(model => model.id === props.selectedModel);
    if (!selected) return props.selectedModel;
    return selected.name ?? selected.id;
  };

  const handleModelPick = (modelId: string) => {
    props.onModelChange(modelId);
    props.setIsOpen(false);
    props.setSearchQuery("");
  };

  const handleToggle = () => {
    props.setCommandMode("model");
    props.setSearchQuery("");
    props.setFileSearchResults([]);
    props.setIsOpen(open => !open);
  };

  const handleFileSelect = (file: { path: string }) => {
    const value = props.inputValue();
    const atIndex = value.lastIndexOf("@");
    const newValue = value.slice(0, atIndex) + `@${file.path} `;
    props.onValueChange(newValue);
    props.setIsOpen(false);
    props.setSearchQuery("");
    props.setFileSearchResults([]);
  };

  return (
    <Show when={props.modelOptions.length > 0}>
      <div class="flex flex-col items-end gap-0.5">
        <button
          type="button"
          onClick={handleToggle}
          class="bg-background border-border hover:bg-muted rounded border px-2 py-1 text-xs"
          aria-label="Open model selector"
        >
          {modelLabel()}
        </button>
        <p class="text-muted-foreground/60 text-[10px]">Connected / Not Connected</p>
        <ModelSelector
          open={props.isOpen()}
          onOpenChange={props.setIsOpen}
          mode={props.commandMode()}
          onModeChange={props.setCommandMode}
          workspaceRoot={props.workspaceRoot}
          searchQuery={props.searchQuery()}
          selectedModelId={props.selectedModel}
          modelSections={modelSections()}
          onSearchChange={props.setSearchQuery}
          onSelect={handleModelPick}
          fileSearchResults={props.fileSearchResults()}
          onFileSelect={handleFileSelect}
        />
      </div>
    </Show>
  );
};
