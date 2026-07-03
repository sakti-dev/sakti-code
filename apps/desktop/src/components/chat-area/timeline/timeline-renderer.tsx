import { FiCircle, FiFileText, FiFolder, FiSearch, FiTerminal } from "solid-icons/fi";
import { type Component, createMemo, For, type JSX } from "solid-js";
import { Markdown } from "~/components/ui/markdown";
import { cn } from "~/lib/utils";
import type { MessagePart } from "~/stores/types.ts";
import { normalizeToolName } from "../tools/tool-name.ts";
import {
  formatBashSummary,
  formatEditSummary,
  formatFindSummary,
  formatGenericToolSummary,
  formatGlobSummary,
  formatGrepSummary,
  formatReadSummary,
  formatTaskCreateSummary,
  formatTaskUpdateSummary,
  formatVscodeDiagnosticsSummary,
  formatWebfetchSummary,
  formatWriteSummary,
} from "../tools/tool-summary-formatters.ts";
import { ToolSummaryRow } from "../tools/tool-summary-row.tsx";
import { Part, resolvePartStreaming } from "../parts/message-part.tsx";
import { ExploreStep } from "./explore-step.tsx";
import { ThinkingStep } from "./thinking-step.tsx";
import { groupTimelineParts, type TimelineItem, type ToolCallPart } from "./timeline-grouping.ts";
import { TimelineStep } from "./timeline-step.tsx";

export interface TimelineRendererProps {
  class?: string;
  isStreaming: boolean;
  parts: MessagePart[];
}

type ToolIcon = "file" | "folder" | "terminal" | "search";
const TOOL_ICON_MAP: Record<string, ToolIcon> = {
  bash: "terminal",
  edit: "file",
  find: "folder",
  glob: "folder",
  grep: "search",
  ls: "folder",
  read: "file",
  write: "file",
};

function ToolIconCmp(props: { icon: ToolIcon }) {
  switch (props.icon) {
    case "file": {
      return <FiFileText class="h-4 w-4" />;
    }
    case "folder": {
      return <FiFolder class="h-4 w-4" />;
    }
    case "terminal": {
      return <FiTerminal class="h-4 w-4" />;
    }
    case "search": {
      return <FiSearch class="h-4 w-4" />;
    }
  }
}

function formatToolSummary(part: ToolCallPart): string {
  const name = normalizeToolName(part.toolName);
  const input =
    part.input && typeof part.input === "object" ? (part.input as Record<string, unknown>) : {};
  const toolPart = { args: input, output: part.result, tool: name };
  switch (name) {
    case "read": {
      return formatReadSummary(toolPart);
    }
    case "write": {
      return formatWriteSummary(toolPart);
    }
    case "edit": {
      return formatEditSummary(toolPart);
    }
    case "bash": {
      return formatBashSummary(toolPart);
    }
    case "find": {
      return formatFindSummary(toolPart);
    }
    case "glob": {
      return formatGlobSummary(toolPart);
    }
    case "grep": {
      return formatGrepSummary(toolPart);
    }
    case "TaskCreate": {
      return formatTaskCreateSummary(toolPart);
    }
    case "TaskUpdate": {
      return formatTaskUpdateSummary(toolPart);
    }
    case "webfetch": {
      return formatWebfetchSummary(toolPart);
    }
    case "vscode_get_diagnostics": {
      return formatVscodeDiagnosticsSummary(toolPart);
    }
    default: {
      return formatGenericToolSummary(toolPart);
    }
  }
}

/**
 * Reuse "single" item wrappers across recomputations, keyed by their underlying
 * part reference, so `<For>` (which reconciles by item reference) keeps existing
 * step nodes mounted. Explore-group wrappers are returned fresh on each
 * recompute (they have no mount animation, and auto-expand re-applies on
 * remount), so we don't fight their growing membership.
 */
function useStableItems() {
  const singleCache = new WeakMap<MessagePart, { kind: "single"; part: MessagePart }>();
  return (parts: MessagePart[]): TimelineItem[] => {
    const grouped = groupTimelineParts(parts);
    return grouped.map((item) => {
      if (item.kind === "single") {
        let cached = singleCache.get(item.part);
        if (!cached) {
          cached = { kind: "single", part: item.part };
          singleCache.set(item.part, cached);
        }
        return cached;
      }
      return item;
    });
  };
}

function renderTimelineItem(
  item: TimelineItem,
  isLast: () => boolean,
  isStreaming: () => boolean,
): JSX.Element {
  if (item.kind === "explore") {
    return <ExploreStep isLast={isLast()} isStreaming={isStreaming()} parts={item.parts} />;
  }
  const part = item.part;
  if (part.type === "thinking" && part.text.trim() !== "") {
    return <ThinkingStep isLast={isLast()} isStreaming={isStreaming()} part={part} />;
  }
  if (part.type === "tool_call") {
    // `name`/`icon` derive from toolName, which is immutable for a given part,
    // so reading them once is fine. `status` and `summary` are read inline in
    // the JSX below so they stay reactive to in-place mutations (the store
    // mutates status/result in place on completion — reading them through the
    // JSX attribute getter re-subscribes, updating the row without a remount).
    const name = normalizeToolName(part.toolName);
    const icon = TOOL_ICON_MAP[name] ?? "file";
    return (
      <TimelineStep icon={<ToolIconCmp icon={icon} />} isLast={isLast()}>
        <ToolSummaryRow
          class="pt-0"
          icon={icon}
          showIcon={false}
          status={
            part.status === "running" ? "running" : part.status === "error" ? "error" : "completed"
          }
          summary={formatToolSummary(part)}
        />
      </TimelineStep>
    );
  }
  if (part.type === "text" && part.text.trim() !== "") {
    // Text is the assistant's prose — the answer itself, not a footnote. Render
    // it prominent (normal foreground) rather than muted. A small rounded marker
    // (same as compaction/om) sits in the icon column for visual consistency
    // with the other steps; the trailing answer (isLast) gets no connector.
    return (
      <TimelineStep icon={<FiCircle class="h-2 w-2 text-muted-foreground/40" />} isLast={isLast()}>
        <div class="pb-1">
          <Markdown
            class="prose-p:m-0"
            isStreaming={resolvePartStreaming(part, isStreaming())}
            text={part.text}
          />
        </div>
      </TimelineStep>
    );
  }
  // compaction, om_marker, and any other registered part type: render via the
  // shared part registry so they stay visible inside the timeline instead of
  // being silently dropped. (Thinking/text with empty text fall through here
  // too and render nothing, since no component is registered for "empty".)
  if (part.type === "compaction" || part.type === "om_marker") {
    return (
      <TimelineStep icon={<FiCircle class="h-2 w-2 text-muted-foreground/40" />} isLast={isLast()}>
        <Part isStreaming={resolvePartStreaming(part, isStreaming())} part={part} />
      </TimelineStep>
    );
  }
  return null;
}

export const TimelineRenderer: Component<TimelineRendererProps> = (props) => {
  const buildItems = useStableItems();
  const items = createMemo(() => buildItems(props.parts));
  const lastIndex = createMemo(() => items().length - 1);

  return (
    <div class={cn("flex flex-col", props.class)} data-component="timeline-renderer">
      <For each={items()}>
        {(item, index) => {
          // isLast is reactive so the connector line updates when steps are
          // appended, without re-running this callback (the item reference is
          // stable, so the chosen step component is not remounted).
          const isLast = () => index() === lastIndex();
          const isStreaming = () => props.isStreaming;
          return renderTimelineItem(item, isLast, isStreaming);
        }}
      </For>
    </div>
  );
};
