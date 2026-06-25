import { FiAlertCircle } from "solid-icons/fi";
import type { JSX } from "solid-js";
import { Button } from "~/components/ui/button";
import type { RetryState } from "~/stores/types";

interface RetryBannerProps {
  /** Called when the user clicks Cancel — the parent wires this to abortRun. */
  onCancel: () => void;
  /** Active retry state (the banner is only rendered when this is non-null). */
  retry: RetryState;
}

/**
 * Banner shown while the server retries a failed LLM turn. Displays the error
 * that triggered the retry, the attempt count, the backoff delay, and a Cancel
 * button that aborts the run (interrupting both the backoff sleep and any
 * in-progress turn).
 *
 * Pure presentational component — the parent gates it with `<Show>` on the
 * session store's `retry` field and supplies the cancel handler.
 */
export function RetryBanner(props: RetryBannerProps): JSX.Element {
  const delaySeconds = () =>
    Math.max(1, Math.round(props.retry.delayMs / 1000));

  return (
    <div
      aria-live="polite"
      class="flex items-center gap-3 border-warning/30 border-b bg-warning/10 px-4 py-2.5 text-sm"
      role="status"
    >
      <FiAlertCircle class="size-4 shrink-0 text-warning" />
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="truncate font-medium text-warning-foreground">
          {props.retry.errorMessage}
        </span>
        <span class="text-muted-foreground text-xs">
          Retrying in {delaySeconds()}s · attempt {props.retry.attempt} of{" "}
          {props.retry.maxAttempts}
        </span>
      </div>
      <Button onClick={() => props.onCancel()} size="sm" variant="ghost">
        Cancel
      </Button>
    </div>
  );
}
