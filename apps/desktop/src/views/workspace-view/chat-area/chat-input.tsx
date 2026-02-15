import {
  ModelSelector,
  type CommandCenterMode,
  type ModelSelectorSection,
} from "@/components/model-selector";
import type { AgentMode } from "@/core/chat/types";
import { cn } from "@/utils";
import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  mergeProps,
  onMount,
  type Component,
} from "solid-js";

export interface ChatInputModelOption {
  id: string;
  providerId: string;
  providerName?: string;
  name?: string;
  connected: boolean;
}

export interface ChatInputProps {
  value?: string;
  onValueChange?: (value: string) => void;
  onSend?: () => void;
  onAttachment?: () => void;
  onMention?: () => void;
  mode?: AgentMode;
  onModeChange?: (mode: AgentMode) => void;
  selectedModel?: string;
  modelOptions?: ChatInputModelOption[];
  getModelSections?: (query: string) => ModelSelectorSection[];
  getConnectedModelOptions?: (query: string) => ChatInputModelOption[];
  getNotConnectedModelOptions?: (query: string) => ChatInputModelOption[];
  onModelChange?: (modelId: string) => void;
  isSending?: boolean;
  disabled?: boolean;
  placeholder?: string;
  class?: string;
}

export const ChatInput: Component<ChatInputProps> = props => {
  const DEBUG_PREFIX = "[model-selector-debug]";
  const merged = mergeProps(
    {
      value: "",
      isSending: false,
      disabled: false,
      mode: "plan" as AgentMode,
      selectedModel: "",
      modelOptions: [] as ChatInputModelOption[],
      placeholder: "Type your message...",
    },
    props
  );

  const [inputValue, setInputValue] = createSignal(merged.value);
  const [isFocused, setIsFocused] = createSignal(false);
  const [isModelSelectorOpen, setIsModelSelectorOpen] = createSignal(false);
  const [commandMode, setCommandMode] = createSignal<CommandCenterMode>("model");
  const [modelSearch, setModelSearch] = createSignal("");
  let textareaRef: HTMLTextAreaElement | undefined;
  const fallbackFilteredModels = createMemo(() => {
    const query = modelSearch().trim().toLowerCase();
    if (!query) return merged.modelOptions;
    return merged.modelOptions.filter(model => {
      const haystack = `${model.id} ${model.name ?? ""} ${model.providerId}`.toLowerCase();
      return haystack.includes(query);
    });
  });
  const connectedModels = createMemo(() =>
    merged.getConnectedModelOptions
      ? merged.getConnectedModelOptions(modelSearch())
      : fallbackFilteredModels().filter(model => model.connected)
  );
  const notConnectedModels = createMemo(() =>
    merged.getNotConnectedModelOptions
      ? merged.getNotConnectedModelOptions(modelSearch())
      : fallbackFilteredModels().filter(model => !model.connected)
  );
  const fallbackModelSections = createMemo<ModelSelectorSection[]>(() => {
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
  });
  const modelSections = createMemo(() => {
    if (!isModelSelectorOpen()) return [] as ModelSelectorSection[];
    return merged.getModelSections
      ? merged.getModelSections(modelSearch())
      : fallbackModelSections();
  });

  const autoResize = () => {
    if (!textareaRef) return;
    textareaRef.style.height = "24px";
    const nextHeight = Math.min(textareaRef.scrollHeight, 200);
    textareaRef.style.height = `${nextHeight}px`;
  };

  createEffect(() => {
    const value = merged.value;
    setInputValue(value);
    if (value === "") autoResize();
  });

  const canSend = () => inputValue().trim().length > 0 && !merged.isSending && !merged.disabled;

  const handleSend = () => {
    if (!canSend()) return;
    merged.onSend?.();
  };

  const handleInput = (e: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    const value = e.currentTarget.value;
    setInputValue(value);
    merged.onValueChange?.(value);
    autoResize();

    const trimmed = value.trimStart();
    if (trimmed.startsWith("/model")) {
      setCommandMode("model");
      setModelSearch(trimmed.slice("/model".length).trim());
      setIsModelSelectorOpen(true);
      return;
    }
    if (trimmed.startsWith("/mcp")) {
      setCommandMode("mcp");
      setModelSearch(trimmed.slice("/mcp".length).trim());
      setIsModelSelectorOpen(true);
      return;
    }
    if (trimmed.startsWith("/skills")) {
      setCommandMode("skills");
      setModelSearch(trimmed.slice("/skills".length).trim());
      setIsModelSelectorOpen(true);
      return;
    }
    if (/(^|\s)@[\w/-]*$/.test(value)) {
      setCommandMode("context");
      setModelSearch(value.split("@").pop()?.trim() ?? "");
      setIsModelSelectorOpen(true);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  onMount(() => {
    autoResize();
  });

  const modeLabel = () => (merged.mode === "plan" ? "Plan" : "Build");
  const modelLabel = () => {
    if (!merged.selectedModel) return "Select model";
    const selected = merged.modelOptions.find(model => model.id === merged.selectedModel);
    if (!selected) return merged.selectedModel;
    return selected.name ?? selected.id;
  };

  const toggleMode = () => {
    const nextMode: AgentMode = merged.mode === "plan" ? "build" : "plan";
    merged.onModeChange?.(nextMode);
  };

  const handleModelPick = (modelId: string) => {
    console.log(`${DEBUG_PREFIX} chat-input:onModelPick`, {
      modelId,
      selectedModel: merged.selectedModel,
    });
    merged.onModelChange?.(modelId);
    setIsModelSelectorOpen(false);
    setModelSearch("");
  };

  return (
    <div
      data-component="chat-input"
      class={cn(
        "rounded-xl border p-3 shadow-lg transition-all duration-200",
        "bg-background/95 border-border/50 glass-effect backdrop-blur",
        "focus-within:ring-primary/20 focus-within:ring-2",
        isFocused() && "border-primary/40 shadow-xl",
        merged.class
      )}
    >
      <textarea
        ref={textareaRef}
        value={inputValue()}
        rows={1}
        disabled={merged.disabled}
        placeholder={merged.placeholder}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        class={cn(
          "scrollbar-thin w-full resize-none bg-transparent px-1 py-2 outline-none",
          "text-foreground placeholder:text-muted-foreground/60",
          "max-h-[200px] min-h-6",
          merged.disabled && "cursor-not-allowed opacity-60"
        )}
      />

      <div class="mt-2 flex items-center justify-between">
        <div class="flex items-center gap-1">
          <button
            type="button"
            onClick={merged.onMention}
            disabled={merged.disabled}
            class="text-muted-foreground/70 hover:text-primary hover:bg-muted/40 rounded-lg p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            title="@ mention files or symbols"
            aria-label="Mention"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width={2}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={merged.onAttachment}
            disabled={merged.disabled}
            class="text-muted-foreground/70 hover:text-primary hover:bg-muted/40 rounded-lg p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            title="Attach file or image"
            aria-label="Attach"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width={2}
                d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={toggleMode}
            disabled={merged.disabled}
            class="text-muted-foreground/80 hover:text-primary hover:border-primary/40 border-border/40 hover:bg-muted/40 flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            title={`Switch to ${merged.mode === "plan" ? "Build" : "Plan"} mode`}
          >
            {modeLabel()}
          </button>
        </div>

        <div class="flex items-center gap-2">
          <Show when={merged.modelOptions.length > 0}>
            <div class="flex flex-col items-end gap-0.5">
              <button
                type="button"
                onClick={() => {
                  setCommandMode("model");
                  setIsModelSelectorOpen(open => !open);
                }}
                class="bg-background border-border hover:bg-muted rounded border px-2 py-1 text-xs"
                aria-label="Open model selector"
              >
                {modelLabel()}
              </button>
              <p class="text-muted-foreground/60 text-[10px]">Connected / Not Connected</p>
              <ModelSelector
                open={isModelSelectorOpen()}
                onOpenChange={setIsModelSelectorOpen}
                mode={commandMode()}
                onModeChange={setCommandMode}
                selectedModelId={merged.selectedModel}
                modelSections={modelSections()}
                onSearchChange={setModelSearch}
                onSelect={handleModelPick}
              />
            </div>
          </Show>
          <Show when={merged.modelOptions.length === 0}>
            <span class="text-muted-foreground/60 select-none text-xs">{modelLabel()}</span>
          </Show>
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend()}
            class={cn(
              "rounded-lg p-2 transition-all duration-200",
              "flex items-center justify-center",
              !canSend() && "bg-muted/20 text-muted-foreground/50 cursor-not-allowed opacity-50",
              canSend() && "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
            title="Send message"
            aria-label="Send"
          >
            {merged.isSending ? (
              <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                />
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            ) : (
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div class="text-muted-foreground/50 mt-2 flex items-center justify-between text-[10px]">
        <span>Enter to send, Shift+Enter for a new line</span>
        <span>{inputValue().length} chars</span>
      </div>
    </div>
  );
};
