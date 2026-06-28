import { type Component, For, Show } from "solid-js";
import type { PlaygroundTheme } from "../hooks/use-playground-theme";
import type { SelectionProbeState } from "../hooks/use-selection-probe";
import type {
  PlaygroundBenchmarkState,
  PlaygroundPreset,
  PlaygroundStreamControls,
  PlaygroundStreamMode,
} from "../types/playground";

export interface WorkbenchControlsPanelProps {
  activePresetId: PlaygroundPreset["id"];
  benchmarkState: PlaygroundBenchmarkState;
  controls: PlaygroundStreamControls;
  isStreaming: boolean;
  onControlsChange: (next: PlaygroundStreamControls) => void;
  onPresetSelect: (preset: PlaygroundPreset) => void;
  onProbeSelection: () => void;
  onRenderOnce: () => void;
  onReset: () => void;
  onRunBenchmark: () => void;
  onSimulateStream: () => void;
  onThemeChange: (next: PlaygroundTheme) => void;
  presets: PlaygroundPreset[];
  probeState: SelectionProbeState;
  selectionProbeEnabled: boolean;
  theme: PlaygroundTheme;
}

const STREAM_MODES: Array<{ label: string; value: PlaygroundStreamMode }> = [
  { label: "Append", value: "append" },
  { label: "Rewrite Tail", value: "rewrite-tail" },
];

export const WorkbenchControlsPanel: Component<WorkbenchControlsPanelProps> = (
  props
) => {
  const updateControls = (patch: Partial<PlaygroundStreamControls>) => {
    props.onControlsChange({
      ...props.controls,
      ...patch,
    });
  };

  const baseButtonClass =
    "inline-flex items-center justify-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50";
  const activeButtonClass =
    "border-primary bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground";
  const fieldClass =
    "h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs";

  return (
    <section class="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-xs">
      <header class="flex flex-col gap-1">
        <h2 class="font-semibold text-foreground text-lg tracking-tight">
          Workbench
        </h2>
        <p class="text-muted-foreground text-sm leading-6">
          Pick a replay preset, run the stream, and inspect compact diagnostics.
        </p>
      </header>

      <div class="flex flex-wrap gap-2">
        <button
          aria-pressed={props.theme === "light"}
          class={
            props.theme === "light"
              ? `${baseButtonClass} ${activeButtonClass}`
              : baseButtonClass
          }
          onClick={() => props.onThemeChange("light")}
          type="button"
        >
          Light
        </button>
        <button
          aria-pressed={props.theme === "dark"}
          class={
            props.theme === "dark"
              ? `${baseButtonClass} ${activeButtonClass}`
              : baseButtonClass
          }
          onClick={() => props.onThemeChange("dark")}
          type="button"
        >
          Dark
        </button>
      </div>

      <Show when={props.presets.length > 1}>
        <div class="flex flex-wrap gap-2">
          <For each={props.presets}>
            {(preset) => (
              <button
                class={
                  preset.id === props.activePresetId
                    ? `${baseButtonClass} ${activeButtonClass}`
                    : baseButtonClass
                }
                onClick={() => props.onPresetSelect(preset)}
                type="button"
              >
                {preset.label}
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <label class="flex min-w-0 flex-col gap-2">
          <span class="font-medium text-muted-foreground text-sm">
            Chunk Size
          </span>
          <input
            class={fieldClass}
            min="1"
            onInput={(event) => {
              updateControls({
                chunkSize: Number(event.currentTarget.value) || 1,
              });
            }}
            type="number"
            value={props.controls.chunkSize}
          />
        </label>

        <label class="flex min-w-0 flex-col gap-2">
          <span class="font-medium text-muted-foreground text-sm">
            Interval (ms)
          </span>
          <input
            class={fieldClass}
            min="1"
            onInput={(event) => {
              updateControls({
                intervalMs: Number(event.currentTarget.value) || 1,
              });
            }}
            type="number"
            value={props.controls.intervalMs}
          />
        </label>

        <label class="flex min-w-0 flex-col gap-2">
          <span class="font-medium text-muted-foreground text-sm">Mode</span>
          <select
            class={fieldClass}
            onInput={(event) => {
              updateControls({
                mode: event.currentTarget.value as PlaygroundStreamMode,
              });
            }}
            value={props.controls.mode}
          >
            <For each={STREAM_MODES}>
              {(mode) => <option value={mode.value}>{mode.label}</option>}
            </For>
          </select>
        </label>
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          class={baseButtonClass}
          onClick={props.onRenderOnce}
          type="button"
        >
          Render once
        </button>
        <button
          class={baseButtonClass}
          disabled={props.isStreaming}
          onClick={props.onSimulateStream}
          type="button"
        >
          {props.isStreaming ? "Streaming..." : "Simulate stream"}
        </button>
        <button class={baseButtonClass} onClick={props.onReset} type="button">
          Reset
        </button>
        <button
          class={baseButtonClass}
          disabled={!props.selectionProbeEnabled}
          onClick={props.onProbeSelection}
          type="button"
        >
          Probe selection
        </button>
        <button
          class={baseButtonClass}
          disabled={props.benchmarkState.isRunning}
          onClick={props.onRunBenchmark}
          type="button"
        >
          {props.benchmarkState.isRunning
            ? "Running benchmark..."
            : "Run benchmark"}
        </button>
      </div>

      <div class="flex flex-wrap gap-3 text-muted-foreground text-sm">
        <span>
          {props.selectionProbeEnabled
            ? props.probeState.statusMessage
            : "Selection probe unavailable"}
        </span>
        <span>
          <Show
            fallback={`Completed ${props.benchmarkState.completedRuns} / ${props.benchmarkState.totalRuns}`}
            when={props.benchmarkState.isRunning}
          >
            {`Running ${props.benchmarkState.completedRuns + 1} / ${props.benchmarkState.totalRuns}`}
          </Show>
        </span>
      </div>
    </section>
  );
};
