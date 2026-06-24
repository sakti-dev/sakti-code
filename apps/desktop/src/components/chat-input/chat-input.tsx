import { createEffect, createMemo, createSignal, type JSX } from "solid-js";
import { cn } from "~/lib/utils";
import { useStore } from "~/stores/store-context";
import { InputFooter } from "./input-footer";
import { ProfileSelect } from "./profile-select";
import { SendButton } from "./send-button";

export interface ChatInputProps {
  disabled?: boolean;
  placeholder?: string;
  sessionId: string | null;
}

export function ChatInput(props: ChatInputProps): JSX.Element {
  const { actions, sessions } = useStore();
  const [value, setValue] = createSignal("");
  const [isFocused, setIsFocused] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;

  const isGenerating = createMemo(() => {
    if (!props.sessionId) {
      return false;
    }
    const session = sessions.get(props.sessionId);
    const phase = session.store.streaming.phase;
    return (
      phase === "thinking" || phase === "writing" || phase === "tool_running"
    );
  });

  const canSend = () =>
    value().trim().length > 0 && !isGenerating() && !!props.sessionId;

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

  const autoResize = () => {
    if (!textareaRef) {
      return;
    }
    textareaRef.style.height = "24px";
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 200)}px`;
  };

  createEffect(() => {
    if (value() === "") {
      autoResize();
    }
  });

  return (
    <div class="w-full px-4 pb-4">
      <div class="mx-auto max-w-3xl">
        <div
          class={cn(
            "flex w-full min-w-0 flex-col gap-3 rounded-xl border p-3 shadow-lg transition-all duration-200",
            "glass-effect border-border/50 bg-background/95 backdrop-blur",
            "focus-within:ring-2 focus-within:ring-primary/20",
            isFocused() && "border-primary/40 shadow-xl"
          )}
          data-component="chat-input"
        >
          <textarea
            class={cn(
              "scrollbar-default w-full resize-none bg-transparent px-1 py-2 outline-none",
              "text-foreground placeholder:text-muted-foreground/60",
              "max-h-[200px] min-h-6"
            )}
            disabled={props.disabled}
            onBlur={() => setIsFocused(false)}
            onFocus={() => setIsFocused(true)}
            onInput={(e) => {
              setValue(e.currentTarget.value);
              autoResize();
            }}
            onKeyDown={handleKeyDown}
            placeholder={props.placeholder ?? "Send a message…"}
            ref={(el: HTMLTextAreaElement) => {
              textareaRef = el;
            }}
            rows={1}
            value={value()}
          />

          <div class="flex items-center justify-end gap-2">
            <ProfileSelect sessionId={props.sessionId} />
            <SendButton
              canSend={canSend}
              isSending={isGenerating()}
              onClick={send}
            />
          </div>

          <InputFooter charCount={() => value().length} />
        </div>
      </div>
    </div>
  );
}
