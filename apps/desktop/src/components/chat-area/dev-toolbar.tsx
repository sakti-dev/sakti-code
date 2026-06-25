import type { AgentHarnessEvent } from "@sakti-code/agent";
import { createSignal, type JSX, Match, onCleanup, Switch } from "solid-js";
import { Button } from "~/components/ui/button";
import type { ReplayState } from "~/stores/workspace/ui-signals";

/** Realistic sustained-throttle error used across all simulated attempts. */
const RETRY_ERROR_MESSAGE = "429 Too Many Requests — rate limited";
/** Production retry defaults — kept fixed so the preview is predictable. */
const MAX_ATTEMPTS = 3;
/** Exponential backoff schedule: base 2000ms → 2s, 4s, 8s. */
const RETRY_SCHEDULE = [
  { attempt: 1, delayMs: 2000 },
  { attempt: 2, delayMs: 4000 },
  { attempt: 3, delayMs: 8000 },
] as const;

export interface DevToolbarProps {
  onReplayPause: () => void;
  onReplayReset: () => void;
  onReplayResume: () => void;
  onReplayStart: () => void;
  /** Dispatch a retry event (auto_retry_start/end) into the session reducer. */
  onRetryEvent: (event: AgentHarnessEvent) => void;
  /** Reactive replay state — drives which replay buttons show. */
  replayState: () => ReplayState;
  sessionId: string;
}

/**
 * Dev-only toolbar for visually verifying UI states that are hard to reach
 * normally (replay, transient-error retry). Gated at the mount site by
 * `import.meta.env.DEV`; this component itself is dev tooling, not product UI.
 *
 * Pure presentational + props-driven: the parent wires replay callbacks to
 * existing store actions and `onRetryEvent` to the session reducer, so the
 * toolbar renders directly in tests without a StoreProvider.
 */
export function DevToolbar(props: DevToolbarProps): JSX.Element {
  // Retry-sim state. `retryRunning` drives the button label; timers are
  // cleared on stop or unmount so a mid-sequence navigation can't leak a
  // banner or leave pending dispatches behind.
  const [retryRunning, setRetryRunning] = createSignal(false);
  // Pending timeouts for the in-flight retry sequence; cleared on stop/unmount.
  let timers: ReturnType<typeof setTimeout>[] = [];
  // Last attempt number dispatched — used to label the abort end event.
  let currentAttempt = 0;

  function clearTimers(): void {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers = [];
  }

  function emitStart(attempt: number, delayMs: number): void {
    currentAttempt = attempt;
    props.onRetryEvent({
      type: "auto_retry_start",
      attempt,
      delayMs,
      errorMessage: RETRY_ERROR_MESSAGE,
      maxAttempts: MAX_ATTEMPTS,
    });
  }

  function emitEnd(): void {
    props.onRetryEvent({
      type: "auto_retry_end",
      success: false,
      attempt: currentAttempt,
      finalError: RETRY_ERROR_MESSAGE,
    });
  }

  function startRetry(): void {
    setRetryRunning(true);
    currentAttempt = 0;
    // Cumulative offset for each scheduled event. The first start fires
    // immediately (elapsed === 0) so the banner appears the instant the dev
    // clicks — matching the real loop, which emits auto_retry_start before
    // the first backoff sleep. Later starts + the final end are scheduled at
    // their cumulative offset via setTimeout (real 2s/4s/8s timing).
    let elapsed = 0;
    for (const step of RETRY_SCHEDULE) {
      const { attempt, delayMs } = step;
      if (elapsed === 0) {
        emitStart(attempt, delayMs);
      } else {
        const at = elapsed;
        timers.push(setTimeout(() => emitStart(attempt, delayMs), at));
      }
      elapsed += delayMs;
    }
    timers.push(
      setTimeout(() => {
        emitEnd();
        setRetryRunning(false);
      }, elapsed)
    );
  }

  function stopRetry(): void {
    clearTimers();
    // Only emit an end if a start actually went out.
    if (currentAttempt > 0) {
      emitEnd();
    }
    setRetryRunning(false);
  }

  // Clean up any pending timers if the toolbar unmounts mid-sequence.
  onCleanup(clearTimers);

  return (
    <div
      class="flex items-center gap-2 border-border border-b border-dashed bg-muted/40 px-3 py-1.5 text-xs"
      data-testid="dev-toolbar"
    >
      <span class="rounded bg-foreground/10 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground uppercase tracking-wide">
        DEV
      </span>
      <Switch>
        <Match when={props.replayState() === "idle"}>
          <Button onClick={props.onReplayStart} size="sm" variant="ghost">
            Replay session
          </Button>
        </Match>
        <Match when={props.replayState() === "playing"}>
          <Button onClick={props.onReplayPause} size="sm" variant="ghost">
            Pause
          </Button>
          <Button onClick={props.onReplayReset} size="sm" variant="ghost">
            Reset
          </Button>
        </Match>
        <Match when={props.replayState() === "paused"}>
          <Button onClick={props.onReplayResume} size="sm" variant="ghost">
            Resume
          </Button>
          <Button onClick={props.onReplayReset} size="sm" variant="ghost">
            Reset
          </Button>
        </Match>
      </Switch>
      <Button
        onClick={() => (retryRunning() ? stopRetry() : startRetry())}
        size="sm"
        variant="ghost"
      >
        {retryRunning() ? "Stop retry" : "Trigger retry"}
      </Button>
    </div>
  );
}
