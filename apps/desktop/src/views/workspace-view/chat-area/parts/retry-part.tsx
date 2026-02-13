import { cn } from "@/utils";
import {
  formatRetryCountdown,
  readRetrySecondsLeft,
} from "@/views/workspace-view/chat-area/retry-timing";
import { createEffect, createSignal, onCleanup, Show, type Component } from "solid-js";

export interface RetryPartProps {
  part: Record<string, unknown>;
  class?: string;
}

function readAttempt(part: Record<string, unknown>): number | undefined {
  const attempt = part.attempt;
  return typeof attempt === "number" && Number.isFinite(attempt) ? attempt : undefined;
}

function readMessage(part: Record<string, unknown>): string {
  const error = part.error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  const message = part.message;
  if (typeof message === "string" && message.length > 0) return message;
  return "Retrying after transient upstream issue";
}

function readErrorKind(part: Record<string, unknown>): string | undefined {
  const error = part.error;
  if (!error || typeof error !== "object") return undefined;
  const metadata = (error as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  const value = (metadata as { kind?: unknown }).kind;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNext(part: Record<string, unknown>): number | undefined {
  const next = part.next;
  if (typeof next === "number" && Number.isFinite(next) && next > 0) return next;
  return undefined;
}

export const RetryPart: Component<RetryPartProps> = props => {
  const attempt = () => readAttempt(props.part);
  const message = () => readMessage(props.part);
  const kind = () => readErrorKind(props.part);
  const next = () => readNext(props.part);
  const [secondsLeft, setSecondsLeft] = createSignal(0);
  const [hasCountdown, setHasCountdown] = createSignal(false);

  createEffect(() => {
    const nextAt = next();
    if (!nextAt) {
      setSecondsLeft(0);
      setHasCountdown(false);
      return;
    }

    const initialLeft = readRetrySecondsLeft(nextAt) ?? 0;
    setSecondsLeft(initialLeft);
    if (initialLeft <= 0) {
      setHasCountdown(true);
      return;
    }

    const update = () => {
      const left = readRetrySecondsLeft(nextAt) ?? 0;
      setSecondsLeft(left);
    };

    update();
    setHasCountdown(true);
    const interval = setInterval(update, 1000);
    onCleanup(() => clearInterval(interval));
  });

  const retryingText = () => {
    if (!hasCountdown()) return "retrying shortly";
    const left = secondsLeft();
    if (left <= 0) return "retrying now";
    return `retrying in ${formatRetryCountdown(left)}`;
  };

  return (
    <div
      data-component="retry-part"
      class={cn(
        "rounded-lg border border-amber-300/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100",
        props.class
      )}
    >
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span data-slot="retry-label" class="font-medium">
          Retry attempt
          <Show when={attempt() !== undefined}>
            <span data-slot="retry-attempt"> #{attempt()}</span>
          </Show>
        </span>
        <span data-slot="retry-message" class="text-amber-100/90">
          {message()}
        </span>
        <span data-slot="retry-countdown" class="text-xs text-amber-200/80">
          {retryingText()}
        </span>
        <Show when={kind()}>
          <span data-slot="retry-kind" class="text-xs text-amber-200/80">
            ({kind()})
          </span>
        </Show>
      </div>
    </div>
  );
};
