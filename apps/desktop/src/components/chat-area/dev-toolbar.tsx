import type { AgentHarnessEvent } from "@sakti-code/agent";
import { type JSX, Match, Switch } from "solid-js";
import { Button } from "~/components/ui/button";
import type { ReplayState } from "~/stores/workspace/ui-signals";

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
    </div>
  );
}
