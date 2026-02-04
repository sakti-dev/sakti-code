/**
 * StatusChip Component
 *
 * Displays the current status of a run (planning, executing, done, error)
 */

import type { Component } from "solid-js";
import type { RunCardData } from "../../types/ui-message";

export interface StatusChipProps {
  status: RunCardData["status"];
}

const STATUS_LABELS: Record<RunCardData["status"], string> = {
  planning: "Planning",
  executing: "Executing",
  done: "Done",
  error: "Error",
};

export const StatusChip: Component<StatusChipProps> = props => {
  const statusClass = () => `ag-status-chip--${props.status}`;

  return (
    <span class={`ag-status-chip ${statusClass()}`}>
      <StatusIcon status={props.status} />
      {STATUS_LABELS[props.status]}
    </span>
  );
};

/**
 * Status icon based on current status
 */
const StatusIcon: Component<StatusChipProps> = props => {
  // Use inline SVG for better control
  switch (props.status) {
    case "planning":
      return (
        <svg class="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="8" r="3" class="animate-pulse-subtle" />
        </svg>
      );
    case "executing":
      return (
        <svg
          class="h-3 w-3 animate-spin"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="8" cy="8" r="6" stroke-dasharray="28" stroke-linecap="round" />
        </svg>
      );
    case "done":
      return (
        <svg class="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
          <path
            d="M13.5 4.5L6 12l-3.5-3.5"
            stroke="currentColor"
            stroke-width="2"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      );
    case "error":
      return (
        <svg class="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
          <path
            d="M8 5v4M8 11h.01"
            stroke="currentColor"
            stroke-width="2"
            fill="none"
            stroke-linecap="round"
          />
        </svg>
      );
    default:
      return null;
  }
};

export default StatusChip;
