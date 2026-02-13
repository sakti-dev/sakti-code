/**
 * SessionTurn Component
 *
 * Renders a single turn (user message + assistant response) in the timeline.
 * Supports collapsible steps section for tools and reasoning.
 */

import { Collapsible } from "@/components/shared/collapsible";
import type { ChatTurn } from "@/core/chat/hooks/turn-projection";
import { useStatusThrottledValue } from "@/core/chat/hooks/use-status-throttled-value";
import { cn } from "@/utils";
import { Part } from "@/views/workspace-view/chat-area/message-part";
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

  // Steps section state
  const [stepsExpanded, setStepsExpanded] = createSignal(false);
  const stepsContentId = () => `session-turn-steps-${turn().userMessage.id}`;

  // Throttle status label during streaming
  const statusLabel = useStatusThrottledValue(() => turn().statusLabel, turn().working ? 2500 : 0);
  const [retrySeconds, setRetrySeconds] = createSignal(0);
  const [liveDurationMs, setLiveDurationMs] = createSignal(turn().durationMs);

  // Check if turn has steps (tools or reasoning)
  const hasSteps = () =>
    turn().toolParts.length > 0 ||
    turn().reasoningParts.length > 0 ||
    turn().permissionParts.length > 0 ||
    turn().questionParts.length > 0;

  const visiblePermissionParts = () =>
    turn().permissionParts.filter(part => {
      const request = (part as { request?: { status?: string } }).request;
      return request?.status !== "pending";
    });
  const visibleQuestionParts = () =>
    turn().questionParts.filter(part => {
      const request = (part as { request?: { status?: string } }).request;
      return request?.status !== "pending";
    });

  createEffect(() => {
    const retry = turn().retry;
    if (!retry) {
      setRetrySeconds(0);
      return;
    }

    const updateSeconds = () => {
      setRetrySeconds(Math.max(0, Math.round((retry.next - Date.now()) / 1000)));
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
        class={cn(
          "bg-background sticky top-0 z-10",
          "relative flex flex-col gap-2",
          "after:pointer-events-none after:-mt-1 after:block after:h-7 after:content-['']",
          "after:from-background/95 after:bg-gradient-to-b after:to-transparent"
        )}
      >
        <div data-slot="session-turn-user" class="bg-muted/30 rounded-lg p-3">
          <div class="text-muted-foreground mb-1 text-xs">You</div>
          <div class="text-sm">{getUserText(turn())}</div>
        </div>
      </div>

      {/* Steps section (collapsible) */}
      <Show when={hasSteps()}>
        <Collapsible
          open={stepsExpanded()}
          onOpenChange={setStepsExpanded}
          class="border-border/40 bg-card/50 rounded-lg border"
        >
          <Collapsible.Trigger
            data-slot="steps-trigger"
            aria-controls={stepsContentId()}
            aria-expanded={stepsExpanded()}
            onKeyDown={event => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              setStepsExpanded(!stepsExpanded());
            }}
            class={cn(
              "flex w-full items-center gap-2 p-3 text-left",
              "text-muted-foreground text-xs",
              "hover:bg-muted/50 transition-colors",
              "focus:ring-primary/30 focus:outline-none focus:ring-2"
            )}
          >
            <Show when={turn().working}>
              <div class="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            </Show>
            <Show
              when={turn().retry}
              fallback={
                <>
                  <span class="font-medium">
                    {turn().working
                      ? (statusLabel() ?? "Working")
                      : stepsExpanded()
                        ? "Hide steps"
                        : "Show steps"}
                  </span>
                </>
              }
            >
              <span>{retryMessage()}</span>
              <span>· retrying{retrySeconds() > 0 ? ` in ${retrySeconds()}s` : ""}</span>
              <span>· #{turn().retry?.attempt}</span>
            </Show>
            <span>·</span>
            <span>{formatDuration(liveDurationMs())}</span>
            <div class="ml-auto">
              <Collapsible.Arrow />
            </div>
          </Collapsible.Trigger>

          <Collapsible.Content
            id={stepsContentId()}
            data-slot="steps-content"
            class="data-[expanded]:animate-collapsible-down data-[closed]:animate-collapsible-up overflow-hidden"
          >
            <div class="border-border/40 space-y-2 border-t p-3 pt-2">
              {/* Render reasoning parts */}
              <Show when={turn().reasoningParts.length > 0}>
                <For each={turn().reasoningParts}>
                  {part => (
                    <Part
                      part={part as Record<string, unknown>}
                      isStreaming={props.isStreaming()}
                    />
                  )}
                </For>
              </Show>

              {/* Render tool parts */}
              <Show when={turn().toolParts.length > 0}>
                <For each={turn().toolParts}>
                  {part => (
                    <Part
                      part={part as Record<string, unknown>}
                      isStreaming={props.isStreaming()}
                      onPermissionApprove={props.onPermissionApprove}
                      onPermissionDeny={props.onPermissionDeny}
                      onQuestionAnswer={props.onQuestionAnswer}
                      onQuestionReject={props.onQuestionReject}
                    />
                  )}
                </For>
              </Show>

              <Show when={visiblePermissionParts().length > 0}>
                <For each={visiblePermissionParts()}>
                  {part => (
                    <Part
                      part={part as Record<string, unknown>}
                      isStreaming={props.isStreaming()}
                      onPermissionApprove={props.onPermissionApprove}
                      onPermissionDeny={props.onPermissionDeny}
                      onQuestionAnswer={props.onQuestionAnswer}
                      onQuestionReject={props.onQuestionReject}
                    />
                  )}
                </For>
              </Show>

              <Show when={visibleQuestionParts().length > 0}>
                <For each={visibleQuestionParts()}>
                  {part => (
                    <Part
                      part={part as Record<string, unknown>}
                      isStreaming={props.isStreaming()}
                      onPermissionApprove={props.onPermissionApprove}
                      onPermissionDeny={props.onPermissionDeny}
                      onQuestionAnswer={props.onQuestionAnswer}
                      onQuestionReject={props.onQuestionReject}
                    />
                  )}
                </For>
              </Show>
            </div>
          </Collapsible.Content>
        </Collapsible>
      </Show>

      {/* Working status when no steps */}
      <Show when={(turn().working || Boolean(turn().retry)) && !hasSteps()}>
        <div
          data-slot="session-turn-status"
          class="text-muted-foreground flex items-center gap-2 px-3 text-xs"
        >
          <div class="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <Show when={turn().retry} fallback={<span>{statusLabel() ?? "Working"}</span>}>
            <span>{retryMessage()}</span>
            <span>· retrying{retrySeconds() > 0 ? ` in ${retrySeconds()}s` : ""}</span>
            <span>· #{turn().retry?.attempt}</span>
          </Show>
          <span>·</span>
          <span>{formatDuration(liveDurationMs())}</span>
        </div>
      </Show>

      {/* Summary section (final text only) */}
      <Show when={turn().assistantMessages.length > 0}>
        <div data-slot="session-turn-summary" class="px-3 [overflow-anchor:none]">
          <Show when={turn().error && !turn().working}>
            <div class="bg-destructive/10 text-destructive mb-3 rounded-lg p-3 text-sm">
              {turn().error}
            </div>
          </Show>

          <Show when={getAssistantText(turn())}>
            <div data-slot="session-turn-visible-summary-live" aria-live="off">
              <Part
                part={{ type: "text", text: getAssistantText(turn()) }}
                isStreaming={props.isStreaming()}
              />
            </div>
          </Show>

          <div class="sr-only" data-slot="session-turn-sr-summary-live" aria-live="polite">
            {!turn().working ? getAssistantText(turn()) : ""}
          </div>

          <Show when={!turn().working}>
            <div class="mt-3 flex items-center gap-2">
              <button
                type="button"
                class="rounded border px-2 py-1 text-xs transition-colors"
                onClick={() => props.onRetry?.(turn().userMessage.id)}
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
