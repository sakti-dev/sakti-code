import type { AgentMode } from "@/core/chat/types";
import type { Component } from "solid-js";

interface InputToolbarProps {
  mode: AgentMode;
  disabled: boolean;
  onMention: () => void;
  onAttachment: () => void;
  onModeChange: (mode: AgentMode) => void;
}

export const InputToolbar: Component<InputToolbarProps> = props => {
  const modeLabel = () => (props.mode === "plan" ? "Plan" : "Build");

  const toggleMode = () => {
    const nextMode: AgentMode = props.mode === "plan" ? "build" : "plan";
    props.onModeChange(nextMode);
  };

  return (
    <div class="flex items-center gap-1">
      <button
        type="button"
        onClick={props.onMention}
        disabled={props.disabled}
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
        onClick={props.onAttachment}
        disabled={props.disabled}
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
        disabled={props.disabled}
        class="text-muted-foreground/80 hover:text-primary hover:border-primary/40 border-border/40 hover:bg-muted/40 flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        title={`Switch to ${props.mode === "plan" ? "Build" : "Plan"} mode`}
      >
        {modeLabel()}
      </button>
    </div>
  );
};
