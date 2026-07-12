import { FiSend, FiSquare } from "solid-icons/fi";
import type { Accessor } from "solid-js";
import { cn } from "~/lib/utils";

interface SendButtonProps {
  canSend: Accessor<boolean>;
  isSending: boolean;
  onSend: () => void;
  onAbort: () => void;
}

export function SendButton(props: SendButtonProps) {
  const streaming = () => props.isSending;
  const disabled = () => !streaming() && !props.canSend();

  return (
    <button
      aria-label={streaming() ? "Stop" : "Send"}
      class={cn(
        "flex items-center justify-center rounded-lg p-2 transition-all duration-200",
        disabled() && "cursor-not-allowed bg-muted/20 text-muted-foreground/50 opacity-50",
        !disabled() && !streaming() && "bg-primary text-primary-foreground hover:bg-primary/90",
        streaming() &&
          "bg-destructive/10 text-destructive ring-1 ring-destructive/30 hover:bg-destructive/20",
      )}
      disabled={disabled()}
      onClick={() => {
        if (streaming()) {
          props.onAbort();
        } else {
          props.onSend();
        }
      }}
      title={streaming() ? "Stop generating" : "Send message"}
      type="button"
    >
      {streaming() ? <FiSquare class="size-4" /> : <FiSend class="size-4" />}
    </button>
  );
}
