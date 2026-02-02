import { Component, createEffect, createSignal, mergeProps, onMount } from "solid-js";
import { cn } from "/@/lib/utils";
import type { AgentMode } from "/@/types";

interface ChatInputProps {
  /** Current input value */
  value?: string;
  /** Value change handler */
  onValueChange?: (value: string) => void;
  /** Send handler */
  onSend?: () => void;
  /** Attachment handler */
  onAttachment?: () => void;
  /** Mention handler */
  onMention?: () => void;
  /** Current agent mode */
  mode?: AgentMode;
  /** Mode change handler */
  onModeChange?: (mode: AgentMode) => void;
  /** Selected model ID */
  selectedModel?: string;
  /** Whether currently sending */
  isSending?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Additional CSS classes */
  class?: string;
}

/**
 * ChatInput - Auto-resizing textarea with action buttons
 *
 * Design Features:
 * - Floating glass-morphic design
 * - Auto-resize with max height
 * - @ mention button for file/symbol reference
 * - Attachment button for images/files
 * - Mode selector pill (Plan/Build)
 * - Model name display
 * - Send button with keyboard shortcut (Cmd+Enter)
 * - Focus ring animation
 */
export const ChatInput: Component<ChatInputProps> = props => {
  const merged = mergeProps(
    {
      value: "",
      isSending: false,
      mode: "plan" as AgentMode,
      selectedModel: "claude-sonnet",
      placeholder: "Type your message...",
    },
    props
  );

  const [inputValue, setInputValue] = createSignal(merged.value);
  const [isFocused, setIsFocused] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;

  // Auto-resize textarea
  const autoResize = () => {
    if (!textareaRef) return;
    textareaRef.style.height = "24px"; // Min height
    const newHeight = Math.min(textareaRef.scrollHeight, 200); // Max 200px
    textareaRef.style.height = `${newHeight}px`;
  };

  // Update input value prop
  createEffect(() => {
    const value = merged.value;
    setInputValue(value);
    if (value === "" && textareaRef) {
      autoResize();
    }
  });

  // Handle input changes
  const handleInput = (e: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    const value = e.currentTarget.value;
    setInputValue(value);
    merged.onValueChange?.(value);
    autoResize();
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (inputValue().trim() && !merged.isSending) {
        merged.onSend?.();
      }
    }
  };

  // Focus textarea on mount
  onMount(() => {
    textareaRef?.focus();
  });

  // Mode display with icon
  const modeDisplay = () =>
    merged.mode === "plan" ? { label: "Plan", icon: "📋" } : { label: "Build", icon: "🔨" };

  // Handle mode toggle
  const handleModeToggle = () => {
    const newMode: AgentMode = merged.mode === "plan" ? "build" : "plan";
    merged.onModeChange?.(newMode);
  };

  // Model name display
  const modelDisplay = () => {
    switch (merged.selectedModel) {
      case "claude-opus":
        return "Opus 4.5";
      case "claude-sonnet":
        return "Sonnet 4.5";
      case "gpt-4":
        return "GPT-4";
      default:
        return "Sonnet 4.5";
    }
  };

  const canSend = () => inputValue().trim().length > 0 && !merged.isSending;

  return (
    <div
      class={cn(
        "mx-4 mb-4",
        "rounded-xl p-3",
        "bg-card/40 border-border/40 border",
        "glass-effect shadow-lg backdrop-blur-sm",
        "focus-within:ring-primary/20 focus-within:ring-2",
        "transition-all duration-200",
        isFocused() && "border-primary/40 shadow-xl",
        merged.class
      )}
    >
      {/* Textarea - full width */}
      <textarea
        ref={textareaRef}
        value={inputValue()}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={merged.placeholder}
        class={cn(
          "w-full resize-none bg-transparent",
          "text-foreground placeholder:text-muted-foreground/60",
          "outline-none",
          "max-h-50 min-h-6 py-2",
          "scrollbar-thin"
        )}
        rows={1}
      />

      {/* Footer with actions */}
      <div class="mt-2 flex items-center justify-between">
        {/* Left group: attachment + mention + mode selector */}
        <div class="flex items-center gap-1">
          {/* @ mention button */}
          <button
            onClick={props.onMention}
            class={cn(
              "rounded-lg p-2 transition-all duration-150",
              "hover:bg-card/30 hover:scale-105",
              "text-muted-foreground/60 hover:text-primary"
            )}
            title="@ mention files or symbols"
          >
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width={2}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          </button>

          {/* Attachment button */}
          <button
            onClick={props.onAttachment}
            class={cn(
              "rounded-lg p-2 transition-all duration-150",
              "hover:bg-card/30 hover:scale-105",
              "text-muted-foreground/60 hover:text-primary"
            )}
            title="Attach file or image"
          >
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width={2}
                d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
              />
            </svg>
          </button>

          {/* Mode selector pill */}
          <button
            onClick={handleModeToggle}
            class={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5",
              "border-border/30 hover:border-primary/40 border",
              "text-xs font-medium",
              "transition-all duration-150",
              "hover:bg-card/30 hover:scale-105",
              "text-muted-foreground/70 hover:text-primary"
            )}
            title={`Click to switch to ${merged.mode === "plan" ? "Build" : "Plan"} mode`}
          >
            <span>{modeDisplay().icon}</span>
            <span>{modeDisplay().label}</span>
          </button>
        </div>

        {/* Right group: model name + send button */}
        <div class="flex items-center gap-2">
          {/* Model name - display only */}
          <span class={cn("text-muted-foreground/60 select-none text-xs")}>{modelDisplay()}</span>

          {/* Send button */}
          <button
            onClick={() => canSend() && merged.onSend?.()}
            disabled={!canSend()}
            class={cn(
              "rounded-lg p-2 transition-all duration-200",
              "flex items-center justify-center",
              // Disabled state
              !canSend() && [
                "cursor-not-allowed opacity-40",
                "bg-muted/20 text-muted-foreground/50",
              ],
              // Enabled state
              canSend() && [
                "bg-primary text-primary-foreground",
                "hover:bg-primary/90 hover:scale-105",
                "hover:shadow-[0_0_20px_-5px_rgba(var(--primary),0.4)]",
              ]
            )}
            title="Send message (Cmd+Enter)"
          >
            {merged.isSending ? (
              <svg class="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
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
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

      {/* Footer hint */}
      <div class="text-muted-foreground/50 mt-2 flex items-center justify-between text-[10px]">
        <span>Press Enter to start a new line, Cmd+Enter to send</span>
        <span>{inputValue().length} chars</span>
      </div>
    </div>
  );
};
