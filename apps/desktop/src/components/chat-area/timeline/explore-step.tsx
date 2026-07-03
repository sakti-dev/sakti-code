import { TbOutlineSearch } from "solid-icons/tb";
import { type Component, createMemo, createSignal, For } from "solid-js";
import {
  formatFindSummary,
  formatGenericToolSummary,
  formatGlobSummary,
  formatGrepSummary,
  formatLsSummary,
  formatReadSummary,
} from "../tools/tool-summary-formatters.ts";
import { normalizeToolName } from "../tools/tool-name.ts";
import { ToolSummaryRow } from "../tools/tool-summary-row.tsx";
import { CollapsibleStep } from "./collapsible-step.tsx";
import type { ToolCallPart } from "./timeline-grouping.ts";
import { TimelineStep } from "./timeline-step.tsx";

export interface ExploreStepProps {
  isLast: boolean;
  isStreaming: boolean;
  parts: ToolCallPart[];
}

const TOOL_ICON_MAP: Record<string, "file" | "search" | "folder"> = {
  find: "folder",
  glob: "folder",
  grep: "search",
  ls: "folder",
  read: "file",
};

function formatExploreSummary(part: ToolCallPart): string {
  const name = normalizeToolName(part.toolName);
  const input =
    part.input && typeof part.input === "object" ? (part.input as Record<string, unknown>) : {};
  const toolPart = { args: input, output: part.result, tool: name };
  switch (name) {
    case "read": {
      return formatReadSummary(toolPart);
    }
    case "grep": {
      return formatGrepSummary(toolPart);
    }
    case "glob": {
      return formatGlobSummary(toolPart);
    }
    case "find": {
      return formatFindSummary(toolPart);
    }
    case "ls": {
      return formatLsSummary(toolPart);
    }
    default: {
      return formatGenericToolSummary(toolPart);
    }
  }
}

/**
 * A group of consecutive explore tools (read/grep/glob/find/ls) collapsed into
 * one "Explored N files" step. Shares the same auto-expand formula as
 * ThinkingStep: `userToggled ?? (isStreaming && isLast)`.
 */
export const ExploreStep: Component<ExploreStepProps> = (props) => {
  const label = createMemo(() => `Explored ${props.parts.length} files`);

  const [userToggled, setUserToggled] = createSignal<boolean | null>(null);
  const expanded = createMemo(() => {
    if (userToggled() !== null) {
      return userToggled()!;
    }
    return props.isStreaming && props.isLast;
  });

  return (
    <TimelineStep icon={<TbOutlineSearch class="h-4 w-4" />} isLast={props.isLast}>
      <CollapsibleStep
        expanded={expanded()}
        label={label()}
        onToggle={() => setUserToggled(!expanded())}
      >
        <div class="flex flex-col">
          <For each={props.parts}>
            {(part) => {
              const name = normalizeToolName(part.toolName);
              const icon = TOOL_ICON_MAP[name] ?? "file";
              return (
                <ToolSummaryRow
                  icon={icon}
                  status={part.status === "running" ? "running" : "completed"}
                  summary={formatExploreSummary(part)}
                />
              );
            }}
          </For>
        </div>
      </CollapsibleStep>
    </TimelineStep>
  );
};
