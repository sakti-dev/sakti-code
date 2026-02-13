/**
 * SessionTurn Component
 *
 * Renders a single turn (user message + assistant response) in the timeline.
 * Assistant parts are displayed inline in chronological order.
 */

import type { ChatTurn } from "@/core/chat/hooks/turn-projection";
import { useStatusThrottledValue } from "@/core/chat/hooks/use-status-throttled-value";
import { cn } from "@/utils";
import { Part } from "@/views/workspace-view/chat-area/message-part";
import {
  formatRetryCountdown,
  readRetrySecondsLeft,
} from "@/views/workspace-view/chat-area/retry-timing";
import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  type Accessor,
  type JSX,
} from "solid-js";

export interface SessionTurnProps {
  turn: Accessor<ChatTurn>;
  isStreaming: Accessor<boolean>;
  isScrollActive?: Accessor<boolean>;
  onRetry?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  onCopy?: (messageId: string) => void;
  onPermissionApprove?: (id: string, patterns?: string[]) => void | Promise<void>;
  onPermissionDeny?: (id: string) => void | Promise<void>;
  onQuestionAnswer?: (id: string, answer: unknown) => void | Promise<void>;
  onQuestionReject?: (id: string) => void | Promise<void>;
  class?: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function getUserText(turn: ChatTurn): string {
  const textPart = turn.userParts.find(p => p.type === "text");
  if (textPart && typeof textPart.text === "string") {
    return textPart.text;
  }
  return "";
}

function getAssistantText(turn: ChatTurn): string {
  if (turn.finalTextPart && typeof turn.finalTextPart.text === "string") {
    return turn.finalTextPart.text;
  }
  return "";
}

function getLastAssistantMessageId(turn: ChatTurn): string | undefined {
  return turn.assistantMessages[turn.assistantMessages.length - 1]?.id;
}

function getUserCreatedAt(turn: ChatTurn): number | undefined {
  const time = turn.userMessage.time as { created?: unknown } | undefined;
  return typeof time?.created === "number" ? time.created : undefined;
}

export function SessionTurn(props: SessionTurnProps): JSX.Element {
  const turn = props.turn;

  // Throttle status label during streaming
  const statusLabel = useStatusThrottledValue(() => turn().statusLabel, turn().working ? 2500 : 0);
  const [retrySeconds, setRetrySeconds] = createSignal(0);
  const [liveDurationMs, setLiveDurationMs] = createSignal(turn().durationMs);

  createEffect(() => {
    const retry = turn().retry;
    if (!retry) {
      setRetrySeconds(0);
      return;
    }

    const updateSeconds = () => {
      setRetrySeconds(readRetrySecondsLeft(retry.next) ?? 0);
    };
    updateSeconds();
    const timer = setInterval(updateSeconds, 1000);
    onCleanup(() => clearInterval(timer));
  });

  createEffect(() => {
    const currentTurn = turn();
    const updateDuration = () => {
      if (!currentTurn.working) {
        setLiveDurationMs(currentTurn.durationMs);
        return;
      }
      const createdAt = getUserCreatedAt(currentTurn);
      if (!createdAt) {
        setLiveDurationMs(currentTurn.durationMs);
        return;
      }
      setLiveDurationMs(Math.max(0, Date.now() - createdAt));
    };

    updateDuration();
    if (!currentTurn.working) return;

    const timer = setInterval(updateDuration, 1000);
    onCleanup(() => clearInterval(timer));
  });

  const retryMessage = () => {
    const message = turn().retry?.message ?? "";
    if (!message) return "Retrying";
    return message.length > 60 ? `${message.slice(0, 60)}...` : message;
  };

  const retryStatusText = () => {
    const retry = turn().retry;
    if (!retry || typeof retry.next !== "number") return "retrying shortly";
    if (retrySeconds() <= 0) return "retrying now";
    return `retrying in ${formatRetryCountdown(retrySeconds())}`;
  };

  return (
    <div
      data-component="session-turn"
      data-slot="session-turn-root"
      class={props.class}
      classList={{
        "flex flex-col gap-3": true,
      }}
    >
      {/* User message (sticky shell) */}
      <div
        data-slot="session-turn-sticky"
        class={cn("bg-background sticky top-0 z-10", "flex flex-col gap-2")}
      >
        <div data-slot="session-turn-user" class="bg-muted/30 rounded-lg p-3">
          <div class="text-muted-foreground mb-1 text-xs">You</div>
          <div class="text-sm">{getUserText(turn())}</div>
        </div>
      </div>

      {/* Working status */}
      <Show when={turn().working || Boolean(turn().retry)}>
        <div
          data-slot="session-turn-status"
          class="text-muted-foreground flex items-center gap-2 px-3 text-xs"
        >
          <div class="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <Show when={turn().retry} fallback={<span>{statusLabel() ?? "Working"}</span>}>
            <span>{retryMessage()}</span>
            <span>· {retryStatusText()}</span>
            <span>· #{turn().retry?.attempt}</span>
          </Show>
          <span>·</span>
          <span>{formatDuration(liveDurationMs())}</span>
        </div>
      </Show>

      {/* Chronological assistant stream */}
      <Show when={turn().assistantMessages.length > 0}>
        <div data-slot="session-turn-stream" class="space-y-2 px-3 [overflow-anchor:none]">
          <Show when={turn().error && !turn().working}>
            <div class="bg-destructive/10 text-destructive mb-3 rounded-lg p-3 text-sm">
              {turn().error}
            </div>
          </Show>

          <div data-slot="session-turn-visible-stream-live" aria-live="off">
            <For each={turn().orderedParts}>
              {part => (
                <Part
                  part={part as Record<string, unknown>}
                  isStreaming={props.isStreaming()}
                  isScrollActive={props.isScrollActive?.()}
                  onPermissionApprove={props.onPermissionApprove}
                  onPermissionDeny={props.onPermissionDeny}
                  onQuestionAnswer={props.onQuestionAnswer}
                  onQuestionReject={props.onQuestionReject}
                />
              )}
            </For>
          </div>

          <div class="sr-only" data-slot="session-turn-sr-summary-live" aria-live="polite">
            {!turn().working ? getAssistantText(turn()) : ""}
          </div>

          <Show
            when={!turn().working && turn().orderedParts.length === 0 && getAssistantText(turn())}
          >
            <div data-slot="session-turn-fallback-summary">
              <Part
                part={{ type: "text", text: getAssistantText(turn()) }}
                isStreaming={props.isStreaming()}
                isScrollActive={props.isScrollActive?.()}
              />
            </div>
          </Show>

          <Show when={!turn().working}>
            <div class="mt-3 flex items-center gap-2">
              <button
                type="button"
                class="rounded border px-2 py-1 text-xs transition-colors"
                onClick={() =>
                  props.onRetry?.(getLastAssistantMessageId(turn()) ?? turn().userMessage.id)
                }
              >
                Retry
              </button>
              <button
                type="button"
                class="rounded border px-2 py-1 text-xs transition-colors"
                onClick={() => {
                  const assistantId = getLastAssistantMessageId(turn()) ?? turn().userMessage.id;
                  props.onCopy?.(assistantId);
                }}
              >
                Copy
              </button>
              <button
                type="button"
                class="rounded border px-2 py-1 text-xs transition-colors"
                onClick={() => props.onDelete?.(turn().userMessage.id)}
              >
                Delete
              </button>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={turn().assistantMessages.length === 0 && turn().working}>
        <div class="text-muted-foreground flex items-center justify-center py-8 text-sm">
          Waiting for response...
        </div>
      </Show>
    </div>
  );
}
