import { FiAlertCircle } from "solid-icons/fi";
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  Show,
} from "solid-js";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { aggregateUsage } from "~/stores/session/usage-stats";
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

  const sessionStore = createMemo(() => {
    if (!props.sessionId) {
      return null;
    }
    return sessions.get(props.sessionId);
  });

  // Aggregate token/cost totals across the session's messages for the footer.
  const sessionStats = createMemo(() => {
    const s = sessionStore();
    if (!s) {
      return;
    }
    const totals = aggregateUsage(s.store.messages);
    // Hide the line entirely until there's at least one assistant turn.
    return totals.cost === 0 && totals.input === 0 && totals.output === 0
      ? undefined
      : totals;
  });

  const retry = () => sessionStore()?.store.retry ?? null;

  const [countdown, setCountdown] = createSignal(0);

  // Tick down every second while the retry banner is visible. The effect keys
  // off the `retry()` *reference*: the reducer must replace the object on each
  // `auto_retry_start` (not mutate in place) so the countdown resets to the
  // new attempt's delay. `onCleanup` clears the interval when the retry object
  // changes or the component unmounts.
  createEffect(() => {
    const r = retry();
    if (!r) {
      setCountdown(0);
      return;
    }
    const initial = Math.max(1, Math.round(r.delayMs / 1000));
    setCountdown(initial);
    const interval = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    onCleanup(() => clearInterval(interval));
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
      <div class="mx-auto flex max-w-3xl flex-col">
        <Show when={retry()}>
          {(r) => (
            <div
              aria-live="polite"
              class="-mb-2 flex items-center gap-3 rounded-t-xl border-warning/30 border-x border-t bg-warning/10 px-3 pt-2 pb-4 text-sm"
              role="status"
            >
              <FiAlertCircle class="size-4 shrink-0 text-warning" />
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="truncate font-medium text-warning-foreground">
                  {r().errorMessage}
                </span>
                <span class="text-muted-foreground text-xs">
                  Retrying in {countdown()}s · attempt {r().attempt} of{" "}
                  {r().maxAttempts}
                </span>
              </div>
              {/* The strip only renders when `retry()` is set, which requires a
                  live session — but guard anyway since sessionId is a separate
                  nullable prop. */}
              <Button
                onClick={() => {
                  if (props.sessionId) {
                    actions.abortRun(props.sessionId);
                  }
                }}
                size="sm"
                variant="ghost"
              >
                Cancel
              </Button>
            </div>
          )}
        </Show>
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

          <InputFooter charCount={() => value().length} stats={sessionStats} />
        </div>
      </div>
    </div>
  );
}
