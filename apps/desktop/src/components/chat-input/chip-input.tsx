import { createSignal, type JSX, onMount, Show } from "solid-js";
import { cn } from "~/lib/utils";
import { serializeEditor } from "./chip-model";

export interface ChipInputApi {
  clear: () => void;
  focus: () => void;
}

export interface ChipInputProps {
  class?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  registerApi?: (api: ChipInputApi) => void;
}

export function ChipInput(props: ChipInputProps): JSX.Element {
  let editorRef: HTMLDivElement | undefined;
  const [empty, setEmpty] = createSignal(true);
  // IME composition guard — suppress key handling mid-composition.
  let composing = false;

  const emit = () => {
    if (!editorRef) {
      return;
    }
    const text = serializeEditor(editorRef);
    setEmpty(text.length === 0 && editorRef.childNodes.length === 0);
    props.onChange(text);
  };

  const api: ChipInputApi = {
    clear: () => {
      if (editorRef) {
        editorRef.textContent = "";
        emit();
      }
    },
    focus: () => editorRef?.focus(),
  };

  onMount(() => {
    props.registerApi?.(api);
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if (composing) {
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      props.onSubmit?.();
    }
    // Shift+Enter falls through → default contenteditable newline (pre-wrap renders \n).
  };

  return (
    <div class="relative">
      <Show when={empty() && props.placeholder}>
        <div class="pointer-events-none absolute inset-0 px-1 py-2 text-muted-foreground/60">
          {props.placeholder}
        </div>
      </Show>
      {/* biome-ignore lint/a11y/useSemanticElements: contenteditable host holds inline chip spans; <textarea> cannot */}
      <div
        aria-multiline="true"
        class={cn(
          "scrollbar-default w-full resize-none bg-transparent px-1 py-2 outline-none",
          "max-h-[200px] min-h-6 overflow-y-auto whitespace-pre-wrap break-words",
          "text-foreground",
          props.class
        )}
        contenteditable={props.disabled ? "false" : "true"}
        data-component="chip-input"
        onCompositionEnd={() => {
          composing = false;
          emit();
        }}
        onCompositionStart={() => {
          composing = true;
        }}
        onInput={emit}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          // Force plain-text paste (strip HTML, keep text + newlines).
          e.preventDefault();
          const text = e.clipboardData?.getData("text/plain") ?? "";
          document.execCommand("insertText", false, text);
        }}
        ref={(el: HTMLDivElement) => {
          editorRef = el;
        }}
        role="textbox"
        tabIndex={0}
      />
    </div>
  );
}
