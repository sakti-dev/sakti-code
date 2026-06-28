import { type Component, For } from "solid-js";
import type { VelomarkDebugMetrics } from "../../src/types";
import type { SelectionProbeState } from "../hooks/use-selection-probe";
import type { PlaygroundBenchmarkState } from "../types/playground";

export interface DiagnosticsStripProps {
  benchmarkState: PlaygroundBenchmarkState;
  metrics: VelomarkDebugMetrics;
  probeState: SelectionProbeState;
}

function selectionLabel(probeState: SelectionProbeState): string {
  if (!probeState.hasSelection) {
    return "No";
  }
  return probeState.anchorNodeConnected && !probeState.anchorBlockReplaced
    ? "Yes"
    : "No";
}

export const DiagnosticsStrip: Component<DiagnosticsStripProps> = (props) => {
  const metrics = () => [
    { label: "Total Blocks", value: String(props.metrics.blockCount) },
    { label: "Reused", value: String(props.metrics.reusedBlockCount) },
    { label: "Replaced", value: String(props.metrics.replacedBlockCount) },
    { label: "Appended", value: String(props.metrics.appendedBlockCount) },
    { label: "Selection Stable", value: selectionLabel(props.probeState) },
    {
      label: "Benchmark",
      value:
        props.benchmarkState.results.length > 0
          ? `${props.benchmarkState.results.length} runs`
          : `${props.benchmarkState.completedRuns} / ${props.benchmarkState.totalRuns}`,
    },
  ];

  return (
    <section class="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-xs">
      <header class="flex flex-col gap-1">
        <h2 class="font-semibold text-foreground text-lg tracking-tight">
          Diagnostics
        </h2>
        <p class="text-muted-foreground text-sm leading-6">
          Compact reuse and stability signals while the renderer updates.
        </p>
      </header>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <For each={metrics()}>
          {(metric) => (
            <div class="rounded-lg border border-border bg-background p-3">
              <dt class="font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
                {metric.label}
              </dt>
              <dd class="mt-1 font-semibold text-foreground text-sm">
                {metric.value}
              </dd>
            </div>
          )}
        </For>
      </div>
    </section>
  );
};
