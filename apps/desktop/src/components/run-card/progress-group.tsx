/**
 * ProgressGroup Component
 *
 * Collapsible group of progress items in the run card
 */

import { For, Show, createSignal, type Component } from "solid-js";
import type { AgentEvent, RunGroupData } from "../../types/ui-message";
import { ActionRow } from "../activity-feed/action-row";

export interface ProgressGroupProps {
  group: RunGroupData;
  eventsById: Record<string, AgentEvent>;
}

export const ProgressGroup: Component<ProgressGroupProps> = props => {
  const [isCollapsed, setIsCollapsed] = createSignal(props.group.collapsed);

  const toggleCollapse = () => setIsCollapsed(!isCollapsed());

  const events = () => props.group.itemsOrder.map(id => props.eventsById[id]).filter(Boolean);

  return (
    <div class="ag-progress-group">
      {/* Group Header */}
      <div class="ag-progress-group-header" onClick={toggleCollapse}>
        <svg
          class={`ag-progress-group-chevron ${
            isCollapsed() ? "ag-progress-group-chevron--collapsed" : ""
          }`}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            stroke-width="1.5"
            fill="none"
            stroke-linecap="round"
          />
        </svg>
        <span>{props.group.title}</span>
        <span class="text-muted-foreground/60">({events().length})</span>
      </div>

      {/* Group Items */}
      <Show when={!isCollapsed()}>
        <div class="ag-collapsible">
          <For each={events()}>{event => <ActionRow event={event} />}</For>
        </div>
      </Show>
    </div>
  );
};

export default ProgressGroup;
