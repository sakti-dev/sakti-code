import { FiLoader, FiSend } from "solid-icons/fi";
import { createEffect, createSignal, type JSX, Show } from "solid-js";
import { useStore } from "~/stores/store-context";
import { ModelPickerButton } from "./model-picker-button";

export interface ChatInputProps {
  disabled?: boolean;
  placeholder?: string;
  sessionId: string | null;
}

export function ChatInput(props: ChatInputProps): JSX.Element {
  const { actions, sessions } = useStore();
  const [value, setValue] = createSignal("");
  // biome-ignore lint/suspicious/noUnassignedVariables: assigned by SolidJS ref
  let textareaRef: HTMLTextAreaElement | undefined;

  const isGenerating = () => {
    if (!props.sessionId) {
      return false;
    }
    const session = sessions.get(props.sessionId);
    const phase = session.store.streaming.phase;
    return (
      phase === "thinking" || phase === "writing" || phase === "tool_running"
    );
  };

  const canSend = () =>
    value().trim().length > 0 && !isGenerating() && !props.disabled;

  const send = () => {
    if (!(canSend() && props.sessionId)) {
      return;
    }
    const text = value().trim();
    actions.sendPrompt(props.sessionId, text);
    setValue("");
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // Auto-resize textarea
  createEffect(() => {
    const el = textareaRef;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  });

  return (
    <div class="border-border border-t p-3">
      <div class="mx-auto max-w-3xl">
        <div class="flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-primary/50">
          <ModelPickerButton sessionId={props.sessionId} />
          <textarea
            class="max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent py-1 text-foreground text-sm outline-none placeholder:text-muted-foreground"
            disabled={props.disabled || !props.sessionId}
            onInput={(e) => setValue(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder={props.placeholder ?? "Send a message…"}
            ref={textareaRef}
            rows={1}
            value={value()}
          />
          <Show
            fallback={
              <button
                class="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground"
                disabled
                type="button"
              >
                <FiSend class="size-4" />
              </button>
            }
            when={canSend()}
          >
            <button
              class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
              onClick={send}
              type="button"
            >
              <Show
                fallback={<FiLoader class="size-4 animate-spin" />}
                when={!isGenerating()}
              >
                <FiSend class="size-4" />
              </Show>
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
}
