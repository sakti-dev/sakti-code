import { FiLoader, FiSend } from "solid-icons/fi";
import type { Accessor } from "solid-js";
import { cn } from "~/lib/utils";

interface SendButtonProps {
  canSend: Accessor<boolean>;
  isSending: boolean;
  onClick: () => void;
}

export function SendButton(props: SendButtonProps) {
  return (
    <button
      aria-label="Send"
      class={cn(
        "flex items-center justify-center rounded-lg p-2 transition-all duration-200",
        !props.canSend() && "cursor-not-allowed bg-muted/20 text-muted-foreground/50 opacity-50",
        props.canSend() && "bg-primary text-primary-foreground hover:bg-primary/90",
      )}
      disabled={!props.canSend()}
      onClick={props.onClick}
      title="Send message"
      type="button"
    >
      {props.isSending ? <FiLoader class="size-4 animate-spin" /> : <FiSend class="size-4" />}
    </button>
  );
}
