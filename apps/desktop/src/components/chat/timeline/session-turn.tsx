import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from "solid-js";
import type { ChatTurn } from "~/stores/session/turn-projection";
import { getUserText } from "~/stores/session/turn-projection";
import { CHAT_COMPACT_STACK_GAP_CLASS, CHAT_STACK_GAP_CLASS } from "../layout";
import { Part } from "../parts/message-part";

export interface SessionTurnProps {
  class?: string;
  isStreaming: Accessor<boolean>;
  turn: Accessor<ChatTurn>;
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export function SessionTurn(props: SessionTurnProps): JSX.Element {
  const turn = props.turn;
  const [liveDurationMs, setLiveDurationMs] = createSignal(0);

  const isWorking = createMemo(() => turn().working);

  createEffect(() => {
    if (!isWorking()) {
      setLiveDurationMs(0);
      return;
    }

    const startedAt = turn().userMessage?.timestamp ?? Date.now();
    const updateDuration = () =>
      setLiveDurationMs(Math.max(0, Date.now() - startedAt));

    updateDuration();
    const timer = setInterval(updateDuration, 1000);
    onCleanup(() => clearInterval(timer));
  });

  return (
    <div
      class={props.class}
      classList={{ [CHAT_STACK_GAP_CLASS]: true }}
      data-component="session-turn"
      data-slot="session-turn-root"
    >
      <Show when={turn().userMessage}>
        <div class={CHAT_COMPACT_STACK_GAP_CLASS} data-slot="session-turn-user">
          <div class="rounded-lg bg-muted/30 p-3">
            <div class={CHAT_COMPACT_STACK_GAP_CLASS}>
              <div class="text-muted-foreground text-xs">You</div>
              <div class="text-sm">{getUserText(turn())}</div>
            </div>
          </div>
        </div>
      </Show>

      <Show when={turn().working}>
        <div
          class="flex items-center gap-2 px-3 text-muted-foreground text-xs"
          data-slot="session-turn-status"
        >
          <div class="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <Show when={liveDurationMs() > 0}>
            <span>{formatDuration(liveDurationMs())}</span>
          </Show>
        </div>
      </Show>

      <Show when={turn().assistantMessages.length > 0}>
        <div
          class={"flex flex-col gap-3 px-3 [overflow-anchor:none]"}
          data-slot="session-turn-stream"
        >
          <Show when={turn().error && !turn().working}>
            <div class="rounded-lg bg-destructive/10 p-3 text-destructive text-sm">
              {turn().error}
            </div>
          </Show>

          <For each={turn().assistantMessages}>
            {(msg) => (
              <div class={CHAT_COMPACT_STACK_GAP_CLASS}>
                <For each={msg.parts}>
                  {(part) => (
                    <Part isStreaming={props.isStreaming()} part={part} />
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={turn().assistantMessages.length === 0 && turn().working}>
        <div class="flex items-center justify-center py-8 text-muted-foreground text-sm">
          Waiting for response…
        </div>
      </Show>
    </div>
  );
}
