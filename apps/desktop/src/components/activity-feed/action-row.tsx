/**
 * ActionRow Component
 *
 * Single action/event item in the activity feed or progress group.
 * Displays icon, title, subtitle, and optional actions.
 */

import { Show, type Component } from "solid-js";
import type { AgentEvent, AgentEventKind } from "../../types/ui-message";

export interface ActionRowProps {
  event: AgentEvent;
  onClick?: () => void;
}

/**
 * Get icon for event kind
 */
function getEventIcon(kind: AgentEventKind): string {
  switch (kind) {
    case "thought":
      return "🧠";
    case "note":
      return "📝";
    case "analyzed":
      return "🔍";
    case "created":
      return "➕";
    case "edited":
      return "✏️";
    case "deleted":
      return "🗑️";
    case "terminal":
      return "💻";
    case "error":
      return "❌";
    case "tool":
    default:
      return "🔧";
  }
}

/**
 * Format timestamp as relative time or time string
 */
function formatTimestamp(ts: number): string {
  const now = Date.now();
  const diff = now - ts;

  if (diff < 1000) return "now";
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;

  // Format as time
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export const ActionRow: Component<ActionRowProps> = props => {
  const handleClick = () => {
    if (props.onClick) {
      props.onClick();
      return;
    }

    // Default: handle first available action
    const action = props.event.actions?.[0];
    if (!action) return;

    switch (action.type) {
      case "open-file":
        window.electron?.ipcRenderer?.send("open-file", {
          path: action.path,
          line: action.line,
        });
        break;
      case "open-diff":
        window.electron?.ipcRenderer?.send("open-diff", { path: action.path });
        break;
      case "open-terminal":
        window.electron?.ipcRenderer?.send("focus-terminal", { id: action.id });
        break;
      case "open-url":
        window.electron?.ipcRenderer?.send("open-url", { url: action.url });
        break;
    }
  };

  return (
    <div
      class={`ag-action-row ${props.event.actions?.length ? "cursor-pointer" : ""}`}
      onClick={handleClick}
    >
      <span class={`ag-action-icon ag-action-icon--${props.event.kind}`}>
        {getEventIcon(props.event.kind)}
      </span>

      <div class="ag-action-content">
        <div class="ag-action-title">{props.event.title}</div>
        <Show when={props.event.subtitle}>
          <div class="ag-action-subtitle">{props.event.subtitle}</div>
        </Show>
      </div>

      {/* Diff stats for file events */}
      <Show when={props.event.diff}>
        <div class="ag-file-diff">
          <span class="ag-file-diff-plus">+{props.event.diff!.plus}</span>
          <span class="ag-file-diff-minus">-{props.event.diff!.minus}</span>
        </div>
      </Show>

      <span class="ag-action-timestamp">{formatTimestamp(props.event.ts)}</span>
    </div>
  );
};

export default ActionRow;
