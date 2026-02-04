/**
 * RunCard Component (Planning Mode)
 *
 * Aggregated view for planning sessions showing:
 * - Header with title, status chip, and elapsed time
 * - Files edited section
 * - Progress groups with collapsible items
 */

import { For, Show, createMemo, type Component } from "solid-js";
import type {
  AgentEvent,
  ChatMessageMetadata,
  ChatUIMessage,
  RunCardData,
  RunFileData,
  RunGroupData,
} from "../../types/ui-message";
import { ThoughtIndicator } from "../activity-feed/thought-indicator";
import { FileRow } from "./file-row";
import { ProgressGroup } from "./progress-group";
import { StatusChip } from "./status-chip";

export interface RunCardProps {
  message: ChatUIMessage;
  metadata?: ChatMessageMetadata;
}

/**
 * Extract RunCardData from message parts
 * Note: AI SDK data parts have type like "data-data-run" (data- prefix + dataType name)
 */
function extractRunCardData(message: ChatUIMessage): RunCardData | null {
  for (const part of message.parts) {
    if (part.type === "data-data-run") {
      return (part as { type: "data-data-run"; data: RunCardData }).data;
    }
  }
  return null;
}

/**
 * Extract all files from message parts
 */
function extractFiles(message: ChatUIMessage): RunFileData[] {
  const files: RunFileData[] = [];
  for (const part of message.parts) {
    if (part.type === "data-data-run-file") {
      files.push((part as { type: "data-data-run-file"; data: RunFileData }).data);
    }
  }
  return files;
}

/**
 * Extract all groups from message parts
 */
function extractGroups(message: ChatUIMessage): RunGroupData[] {
  const groups: RunGroupData[] = [];
  for (const part of message.parts) {
    if (part.type === "data-data-run-group") {
      groups.push((part as { type: "data-data-run-group"; data: RunGroupData }).data);
    }
  }
  return groups.sort((a, b) => a.index - b.index);
}

/**
 * Extract all events from message parts
 */
function extractEvents(message: ChatUIMessage): Record<string, AgentEvent> {
  const events: Record<string, AgentEvent> = {};
  for (const part of message.parts) {
    if (part.type === "data-data-run-item") {
      const event = (part as { type: "data-data-run-item"; data: AgentEvent }).data;
      events[event.id] = event;
    }
  }
  return events;
}

/**
 * Format elapsed time as "Ns" or "N min Ns"
 */
function formatElapsed(ms?: number): string {
  if (!ms) return "";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export const RunCard: Component<RunCardProps> = props => {
  const runCardData = createMemo(() => extractRunCardData(props.message));
  const files = createMemo(() => extractFiles(props.message));
  const groups = createMemo(() => extractGroups(props.message));
  const eventsById = createMemo(() => extractEvents(props.message));

  const data = runCardData();

  return (
    <div class="ag-run-card animate-fade-in-up">
      {/* Header */}
      <div class="ag-run-card-header">
        <div class="flex flex-col gap-0.5">
          <div class="ag-run-card-title">{data?.title ?? "Planning Session"}</div>
          <Show when={data?.subtitle}>
            <div class="ag-run-card-subtitle">{data!.subtitle}</div>
          </Show>
        </div>
        <div class="flex items-center gap-3">
          <Show when={data?.elapsedMs}>
            <span class="text-muted-foreground font-mono text-xs">
              {formatElapsed(data!.elapsedMs)}
            </span>
          </Show>
          <StatusChip status={data?.status ?? "planning"} />
        </div>
      </div>

      {/* Files Section */}
      <Show when={files().length > 0}>
        <div class="ag-files-section">
          <div class="text-muted-foreground mb-2 text-xs font-medium">Files Edited</div>
          <For each={files()}>{file => <FileRow file={file} />}</For>
        </div>
      </Show>

      {/* Progress Groups */}
      <Show when={groups().length > 0}>
        <div class="ag-progress-section">
          <For each={groups()}>
            {group => <ProgressGroup group={group} eventsById={eventsById()} />}
          </For>
        </div>
      </Show>

      {/* Thinking Indicator (if currently thinking) */}
      <Show when={data?.status === "planning" || data?.status === "executing"}>
        <div class="px-4 pb-3">
          <ThoughtIndicator status="thinking" />
        </div>
      </Show>
    </div>
  );
};

export default RunCard;
