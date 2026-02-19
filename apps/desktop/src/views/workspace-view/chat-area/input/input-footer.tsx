import type { Accessor, Component } from "solid-js";

interface InputFooterProps {
  charCount: Accessor<number>;
}

export const InputFooter: Component<InputFooterProps> = props => {
  return (
    <div class="text-muted-foreground/50 mt-2 flex items-center justify-between text-[10px]">
      <span>Enter to send, Shift+Enter for a new line</span>
      <span>{props.charCount()} chars</span>
    </div>
  );
};
