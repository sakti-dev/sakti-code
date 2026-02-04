/**
 * ThoughtIndicator Component
 *
 * Displays "Thinking..." or "Thought for Ns" based on reasoning status.
 * Matches OpenCode's reasoning display pattern.
 */

import { Show, type Component } from "solid-js";

export interface ThoughtIndicatorProps {
  status: "thinking" | "complete";
  durationMs?: number;
  text?: string;
}

/**
 * Format duration as "Ns" or "N.Ns"
 */
function formatDuration(ms?: number): string {
  if (!ms) return "";
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

export const ThoughtIndicator: Component<ThoughtIndicatorProps> = props => {
  return (
    <div
      class={`ag-thought-indicator ${
        props.status === "thinking" ? "ag-thought-indicator--thinking" : ""
      }`}
    >
      <Show when={props.status === "thinking"} fallback={<ThoughtIcon />}>
        <SpinnerIcon />
      </Show>

      <span>
        <Show when={props.status === "complete"} fallback="Thinking...">
          Thought for {formatDuration(props.durationMs)}
        </Show>
      </span>
    </div>
  );
};

/**
 * Brain icon for completed thoughts
 */
const ThoughtIcon: Component = () => (
  <svg
    class="h-3.5 w-3.5"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle cx="8" cy="8" r="5" />
    <path d="M6 6.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5-.7 1.5-1.5 1.5h-.5v1.5" />
    <circle cx="8" cy="11" r="0.5" fill="currentColor" />
  </svg>
);

/**
 * Spinner icon for thinking state
 */
const SpinnerIcon: Component = () => (
  <svg
    class="ag-thought-spinner"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
  >
    <circle cx="8" cy="8" r="6" stroke-dasharray="28" stroke-linecap="round" opacity="0.25" />
    <path d="M8 2a6 6 0 0 1 6 6" stroke-linecap="round" />
  </svg>
);

export default ThoughtIndicator;
