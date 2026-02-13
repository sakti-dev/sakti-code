import {
  getChatPerfSnapshot,
  type ChatPerfSnapshot,
} from "@/core/chat/services/chat-perf-telemetry";
import { cn } from "@/utils";
import { createMemo, createSignal, onCleanup, onMount, Show, type Component } from "solid-js";

interface PerfSample {
  snapshot: ChatPerfSnapshot;
  at: number;
}

function ratePerSec(current: number, previous: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return Math.max(0, ((current - previous) / elapsedMs) * 1000);
}

function formatRate(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

export const ChatPerfPanel: Component<{ class?: string }> = props => {
  const [visible, setVisible] = createSignal(true);
  const [sample, setSample] = createSignal<PerfSample>({
    snapshot: getChatPerfSnapshot(),
    at: Date.now(),
  });
  const [previous, setPrevious] = createSignal<PerfSample>({
    snapshot: getChatPerfSnapshot(),
    at: Date.now(),
  });

  let timer: ReturnType<typeof setInterval> | undefined;

  onMount(() => {
    timer = setInterval(() => {
      setPrevious(sample());
      setSample({
        snapshot: getChatPerfSnapshot(),
        at: Date.now(),
      });
    }, 300);
  });

  onCleanup(() => {
    if (timer) clearInterval(timer);
  });

  const elapsedMs = createMemo(() => Math.max(1, sample().at - previous().at));

  const rates = createMemo(() => {
    const curr = sample().snapshot.counters;
    const prev = previous().snapshot.counters;
    const elapsed = elapsedMs();
    return {
      sse: ratePerSec(curr.sseEvents, prev.sseEvents, elapsed),
      stream:
        ratePerSec(curr.streamTextDeltas, prev.streamTextDeltas, elapsed) +
        ratePerSec(curr.streamDataParts, prev.streamDataParts, elapsed),
      projections: ratePerSec(curr.turnProjections, prev.turnProjections, elapsed),
      upserts: ratePerSec(curr.partUpserts, prev.partUpserts, elapsed),
    };
  });

  const avgProjectionMs = createMemo(() => {
    const counters = sample().snapshot.counters;
    if (counters.turnProjections <= 0) return 0;
    return counters.turnProjectionMs / counters.turnProjections;
  });

  const counters = createMemo(() => sample().snapshot.counters);

  return (
    <div class={cn("pointer-events-none absolute right-3 top-3 z-20", props.class)}>
      <Show
        when={visible()}
        fallback={
          <button
            type="button"
            class="bg-background/85 pointer-events-auto rounded border px-2 py-1 text-[10px]"
            onClick={() => setVisible(true)}
          >
            Perf
          </button>
        }
      >
        <div
          data-testid="chat-perf-panel"
          class={cn(
            "pointer-events-auto w-64 rounded-lg border p-3",
            "bg-background/85 border-border/60 shadow-sm backdrop-blur-sm",
            "font-mono text-[11px]"
          )}
        >
          <div class="mb-2 flex items-center justify-between text-xs">
            <span class="text-foreground/90 font-semibold">Stream Perf</span>
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground"
              onClick={() => setVisible(false)}
            >
              Hide
            </button>
          </div>

          <div class="grid grid-cols-2 gap-x-3 gap-y-1">
            <span class="text-muted-foreground">SSE/s</span>
            <span class="text-right">{formatRate(rates().sse)}</span>

            <span class="text-muted-foreground">Stream/s</span>
            <span class="text-right">{formatRate(rates().stream)}</span>

            <span class="text-muted-foreground">Turns/s</span>
            <span class="text-right">{formatRate(rates().projections)}</span>

            <span class="text-muted-foreground">Upserts/s</span>
            <span class="text-right">{formatRate(rates().upserts)}</span>

            <span class="text-muted-foreground">Avg turn ms</span>
            <span class="text-right">{avgProjectionMs().toFixed(2)}</span>

            <span class="text-muted-foreground">Coalesced</span>
            <span class="text-right">{counters().coalescedUpdates}</span>

            <span class="text-muted-foreground">Skipped dup</span>
            <span class="text-right">{counters().skippedOptimisticUpdates}</span>

            <span class="text-muted-foreground">Retry attempts</span>
            <span class="text-right">{counters().retryAttempts}</span>

            <span class="text-muted-foreground">Retry recovered</span>
            <span class="text-right">{counters().retryRecovered}</span>

            <span class="text-muted-foreground">Retry exhausted</span>
            <span class="text-right">{counters().retryExhausted}</span>
          </div>
        </div>
      </Show>
    </div>
  );
};
