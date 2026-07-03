import { TbOutlineSearch } from "solid-icons/tb";
import { type Component, createMemo, createSignal, For } from "solid-js";
import { getToolDescriptor, normalizeToolName, toToolPartData } from "../tools/index.ts";
import { ToolSummaryRow } from "../tools/tool-summary-row.tsx";
import { CollapsibleStep } from "./collapsible-step.tsx";
import type { ToolCallPart } from "./timeline-grouping.ts";
import { TimelineStep } from "./timeline-step.tsx";

export interface ExploreStepProps {
  isLast: boolean;
  isStreaming: boolean;
  parts: ToolCallPart[];
}

/**
 * A group of consecutive explore tools (read/grep/find) collapsed into one
 * "Explored (N tool calls)" step. Counts tool invocations (not files, since
 * grep/find are searches). Shares the same auto-expand formula as
 * ThinkingStep: `userToggled ?? (isStreaming && isLast)`.
 */
export const ExploreStep: Component<ExploreStepProps> = (props) => {
  const label = createMemo(() => {
    const n = props.parts.length;
    return `Explored (${n} tool call${n === 1 ? "" : "s"})`;
  });

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
              const pd = toToolPartData(part);
              const d = getToolDescriptor(normalizeToolName(part.toolName));
              return (
                <ToolSummaryRow
                  icon={d.icon}
                  part={pd}
                  status={part.status === "running" ? "running" : "completed"}
                  summary={d.summary(pd)}
                />
              );
            }}
          </For>
        </div>
      </CollapsibleStep>
    </TimelineStep>
  );
};
