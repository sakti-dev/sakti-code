import type { Accessor } from "solid-js";

interface InputFooterProps {
  charCount: Accessor<number>;
}

export function InputFooter(props: InputFooterProps) {
  return (
    <div class="flex items-center justify-between text-[10px] text-muted-foreground/50">
      <span>Enter to send, Shift+Enter for a new line</span>
      <span>{props.charCount()} chars</span>
    </div>
  );
}
