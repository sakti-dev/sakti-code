import { type CommandCenterMode, type ModelSelectorSection } from "@/components/model-selector";
import { type AgentMode } from "@/core/chat/types";
import { cn } from "@/utils";
import { Show, createEffect, createSignal, onMount, type Component } from "solid-js";
import { InputFooter } from "./input-footer";
import { InputToolbar } from "./input-toolbar";
import { ModelSelectorButton, type ChatInputModelOption } from "./model-selector-button";
import { PermissionBanner, type PendingPermissionBannerData } from "./permission-banner";
import { SendButton } from "./send-button";
import { useChatInput } from "./use-chat-input";

export { InputFooter } from "./input-footer";
export { InputToolbar } from "./input-toolbar";
export { ModelSelectorButton } from "./model-selector-button";
export type { ChatInputModelOption } from "./model-selector-button";
export { PermissionBanner } from "./permission-banner";
export type { PendingPermissionBannerData } from "./permission-banner";
export { SendButton } from "./send-button";

export interface ChatInputProps {
  value?: string;
  onValueChange?: (value: string) => void;
  onSend?: () => void;
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
  pendingPermission?: PendingPermissionBannerData | null;
  onPermissionApproveOnce?: (id: string) => void;
  onPermissionApproveAlways?: (id: string, patterns?: string[]) => void;
  onPermissionDeny?: (id: string) => void;
  isResolvingPermission?: boolean;
  placeholder?: string;
  class?: string;
  workspace?: string;
  getFileSearchResults?: (
    query: string
  ) => Promise<Array<{ path: string; name: string; score: number; type: "file" | "directory" }>>;
}

const defaultChatInput = {
  draftMessage: () => "",
  setDraftMessage: ((_v: string) => {}) as (v: string) => void,
  handleSendMessage: () => {},
  agentMode: () => "plan" as AgentMode,
  setAgentMode: ((_v: AgentMode) => {}) as (v: AgentMode) => void,
  modelOptions: () => [] as ChatInputModelOption[],
  selectedModel: () => "",
  connectedModelOptions: ((_q: string) => []) as (q: string) => ChatInputModelOption[],
  notConnectedModelOptions: ((_q: string) => []) as (q: string) => ChatInputModelOption[],
  modelSections: ((_q: string) => []) as (q: string) => ModelSelectorSection[],
  handleModelChange: (_m: string) => {},
  isGenerating: () => false,
  isPromptBlocked: () => false,
  pendingPermissionBanner: () => null as PendingPermissionBannerData | null,
  handleApprovePermission: ((_id: string, _p?: string[]) => {}) as (
    id: string,
    patterns?: string[]
  ) => void,
  handleDenyPermission: ((_id: string) => {}) as (id: string) => void,
  handleAnswerQuestion: ((_id: string, _a: unknown) => {}) as (id: string, answer: unknown) => void,
  handleRejectQuestion: ((_id: string) => {}) as (id: string) => void,
  workspace: () => undefined as string | undefined,
  getFileSearchResults: ((_q: string) => Promise.resolve([])) as (
    query: string
  ) => Promise<Array<{ path: string; name: string; score: number; type: "file" | "directory" }>>,
};

export const ChatInput: Component<ChatInputProps> = props => {
  let chatInput = defaultChatInput;

  try {
    chatInput = useChatInput() ?? defaultChatInput;
  } catch {
    // Context not available - use defaults
  }

  const value = () => props.value ?? chatInput.draftMessage();
  const onValueChange = () => props.onValueChange ?? chatInput.setDraftMessage;
  const onSend = () => props.onSend ?? chatInput.handleSendMessage;
  const mode = () => props.mode ?? chatInput.agentMode();
  const onModeChange = () => props.onModeChange ?? chatInput.setAgentMode;
  const selectedModel = () => props.selectedModel ?? chatInput.selectedModel();
  const modelOptions = () => props.modelOptions ?? chatInput.modelOptions();
  const modelSections = props.getModelSections ?? chatInput.modelSections;
  const connectedModelOptions = props.getConnectedModelOptions ?? chatInput.connectedModelOptions;
  const notConnectedModelOptions =
    props.getNotConnectedModelOptions ?? chatInput.notConnectedModelOptions;
  const onModelChange = () => props.onModelChange ?? chatInput.handleModelChange;
  const isSending = () => props.isSending ?? chatInput.isGenerating();
  const disabled = () => props.disabled ?? chatInput.isPromptBlocked();
  const pendingPermission = () => props.pendingPermission ?? chatInput.pendingPermissionBanner();
  const onPermissionApproveOnce = () =>
    props.onPermissionApproveOnce ?? chatInput.handleApprovePermission;
  const onPermissionApproveAlways = () =>
    props.onPermissionApproveAlways ?? chatInput.handleApprovePermission;
  const onPermissionDeny = () => props.onPermissionDeny ?? chatInput.handleDenyPermission;
  const isResolvingPermission = () => props.isResolvingPermission ?? false;
  const placeholder = () => props.placeholder ?? "Send a message...";
  const workspace = () => props.workspace ?? chatInput.workspace();
  const fileSearchResultsFn = props.getFileSearchResults ?? chatInput.getFileSearchResults;

  const [isFocused, setIsFocused] = createSignal(false);
  const [isModelSelectorOpen, setIsModelSelectorOpen] = createSignal(false);
  const [commandMode, setCommandMode] = createSignal<CommandCenterMode>("model");
  const [modelSearch, setModelSearch] = createSignal("");
  const [fileSearchResults, setFileSearchResults] = createSignal<
    Array<{ path: string; name: string; score: number; type: "file" | "directory" }>
  >([]);
  let fileSearchRequestSeq = 0;
  let textareaRef: HTMLTextAreaElement | undefined;

  const autoResize = () => {
    if (!textareaRef) return;
    textareaRef.style.height = "24px";
    const nextHeight = Math.min(textareaRef.scrollHeight, 200);
    textareaRef.style.height = `${nextHeight}px`;
  };

  createEffect(() => {
    const v = value();
    if (v === "") autoResize();
  });

  createEffect(() => {
    if (commandMode() !== "context" || !isModelSelectorOpen()) {
      setFileSearchResults([]);
      return;
    }

    const searchQuery = modelSearch();
    const requestId = ++fileSearchRequestSeq;

    fileSearchResultsFn(searchQuery)
      .then(results => {
        if (requestId === fileSearchRequestSeq) {
          setFileSearchResults(results);
        }
      })
      .catch(() => {
        if (requestId === fileSearchRequestSeq) {
          setFileSearchResults([]);
        }
      });
  });

  const canSend = () => value().trim().length > 0 && !isSending() && !disabled();

  const handleSend = () => {
    if (!canSend()) return;
    onSend()();
  };

  const handleInput = (e: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    const v = e.currentTarget.value;
    onValueChange()(v);
    autoResize();

    const trimmed = v.trimStart();
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
    if (/(^|\s)@([^\s]*)$/.test(v)) {
      setCommandMode("context");
      const searchQuery = v.split("@").pop()?.trim() ?? "";
      setModelSearch(searchQuery);
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

  const handleModeChange = (m: AgentMode) => {
    onModeChange()(m);
  };

  const modelLabel = () => {
    const selectedModelId = selectedModel();
    if (!selectedModelId) return "Select model";
    const selected = modelOptions().find(model => model.id === selectedModelId);
    if (!selected) return selectedModelId;
    return selected.name ?? selected.id;
  };

  return (
    <div
      data-component="chat-input"
      class={cn(
        "rounded-xl border p-3 shadow-lg transition-all duration-200",
        "bg-background/95 border-border/50 glass-effect backdrop-blur",
        "focus-within:ring-primary/20 focus-within:ring-2",
        isFocused() && "border-primary/40 shadow-xl",
        props.class
      )}
    >
      <PermissionBanner
        permission={pendingPermission()}
        isResolvingPermission={isResolvingPermission()}
        onApproveOnce={onPermissionApproveOnce()}
        onApproveAlways={onPermissionApproveAlways()}
        onDeny={onPermissionDeny()}
      />

      <textarea
        ref={textareaRef}
        value={value()}
        rows={1}
        disabled={disabled()}
        placeholder={placeholder()}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        class={cn(
          "scrollbar-thin w-full resize-none bg-transparent px-1 py-2 outline-none",
          "text-foreground placeholder:text-muted-foreground/60",
          "max-h-[200px] min-h-6",
          disabled() && "cursor-not-allowed opacity-60"
        )}
      />

      <div class="mt-2 flex items-center justify-between">
        <InputToolbar
          mode={mode()}
          disabled={disabled()}
          onMention={() => {}}
          onAttachment={() => {}}
          onModeChange={handleModeChange}
        />

        <div class="flex items-center gap-2">
          <Show when={modelOptions().length > 0}>
            <ModelSelectorButton
              modelOptions={modelOptions()}
              selectedModel={selectedModel()}
              workspaceRoot={workspace()}
              isOpen={isModelSelectorOpen}
              setIsOpen={setIsModelSelectorOpen}
              commandMode={commandMode}
              setCommandMode={setCommandMode}
              searchQuery={modelSearch}
              setSearchQuery={setModelSearch}
              fileSearchResults={fileSearchResults}
              setFileSearchResults={setFileSearchResults}
              onModelChange={onModelChange()}
              getModelSections={modelSections}
              getConnectedModelOptions={connectedModelOptions}
              getNotConnectedModelOptions={notConnectedModelOptions}
              getFileSearchResults={fileSearchResultsFn}
              onValueChange={onValueChange()}
              inputValue={value}
            />
          </Show>
          <Show when={modelOptions().length === 0}>
            <span class="text-muted-foreground/60 select-none text-xs">{modelLabel()}</span>
          </Show>
          <SendButton canSend={canSend} isSending={isSending()} onClick={handleSend} />
        </div>
      </div>

      <InputFooter charCount={() => value().length} />
    </div>
  );
};
