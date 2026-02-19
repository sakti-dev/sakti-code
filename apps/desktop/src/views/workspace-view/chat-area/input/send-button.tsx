import { cn } from "@/utils";
import type { Accessor, Component } from "solid-js";

interface SendButtonProps {
  canSend: Accessor<boolean>;
  isSending: boolean;
  onClick: () => void;
}

export const SendButton: Component<SendButtonProps> = props => {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={!props.canSend()}
      class={cn(
        "rounded-lg p-2 transition-all duration-200",
        "flex items-center justify-center",
        !props.canSend() && "bg-muted/20 text-muted-foreground/50 cursor-not-allowed opacity-50",
        props.canSend() && "bg-primary text-primary-foreground hover:bg-primary/90"
      )}
      title="Send message"
      aria-label="Send"
    >
      {props.isSending ? (
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
  );
};
