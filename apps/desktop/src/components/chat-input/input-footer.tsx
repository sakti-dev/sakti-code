import type { Accessor } from "solid-js";
import { Show } from "solid-js";
import { formatCost, formatTokens, type SessionUsageStats } from "~/stores/session/usage-stats";

interface InputFooterProps {
  charCount: Accessor<number>;
  /** Aggregated session usage; when absent, no stats line is shown. */
  stats?: Accessor<SessionUsageStats | undefined>;
}

export function InputFooter(props: InputFooterProps) {
  return (
    <div class="flex items-center justify-between text-[10px] text-muted-foreground/50">
      <span>Enter to send, Shift+Enter for a new line</span>
      <div class="flex items-center gap-2">
        <Show when={props.stats?.()}>
          {(stats) => (
            <span
              class="tabular-nums"
              title={`Input ${stats().input.toLocaleString()} · Output ${stats().output.toLocaleString()} · Reasoning ${stats().reasoningTokens.toLocaleString()}`}
            >
              {formatCost(stats().cost)} · {formatTokens(stats().input)} in ·{" "}
              {formatTokens(stats().output)} out
            </span>
          )}
        </Show>
        <span>{props.charCount()} chars</span>
      </div>
    </div>
  );
}
