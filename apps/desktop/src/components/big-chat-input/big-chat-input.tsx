import { cn } from "@/utils";
import { createSignal, onMount, type Component } from "solid-js";

export interface BigChatInputProps {
  placeholder?: string;
  disabled?: boolean;
  maxHeight?: number;
  class?: string;
  onSubmit: (value: string) => void;
}

export const BigChatInput: Component<BigChatInputProps> = props => {
  const [value, setValue] = createSignal("");
  let textareaRef: HTMLTextAreaElement | undefined;

  const resize = () => {
    if (!textareaRef) return;
    const maxHeight = props.maxHeight ?? 240;
    textareaRef.style.height = "auto";
    const nextHeight = Math.min(textareaRef.scrollHeight, maxHeight);
    textareaRef.style.height = `${nextHeight}px`;
  };

  const submit = () => {
    if (props.disabled) return;

    const text = value().trim();
    if (!text) return;

    props.onSubmit(text);
    setValue("");
    if (textareaRef) {
      textareaRef.value = "";
    }
    resize();
  };

  const handleInput = (event: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    setValue(event.currentTarget.value);
    resize();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  onMount(() => {
    resize();
  });

  return (
    <div class={cn("rounded-xl border border-border/40 bg-card/20 p-3", props.class)}>
      <textarea
        ref={textareaRef}
        rows={1}
        value={value()}
        placeholder={props.placeholder ?? "Ask anything about this project..."}
        disabled={props.disabled}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        class={cn(
          "scrollbar-default w-full resize-none bg-transparent text-base outline-none",
          "placeholder:text-muted-foreground/70 text-foreground min-h-7",
          props.disabled && "cursor-not-allowed opacity-60"
        )}
        aria-label="Task input"
      />
    </div>
  );
};

export default BigChatInput;
