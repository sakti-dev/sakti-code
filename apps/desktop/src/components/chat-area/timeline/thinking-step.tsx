import { TbOutlineBrain } from "solid-icons/tb";
import { type Component, createMemo, createSignal } from "solid-js";
import { Markdown } from "~/components/ui/markdown";
import { formatDuration } from "~/lib/format-duration";
import { CollapsibleStep } from "./collapsible-step.tsx";
import type { ThinkingMessagePart } from "./thinking-helpers.ts";
import { TimelineStep } from "./timeline-step.tsx";

export interface ThinkingStepProps {
  isLast: boolean;
  isStreaming: boolean;
  part: ThinkingMessagePart;
}

/**
 * A thinking part rendered as a timeline step. The brain icon pulses while
 * active. Auto-expand formula: `userToggled ?? (isStreaming && isLast)` —
 * expanded while streaming as the last step, collapsed otherwise, with manual
 * toggle overriding the auto behavior.
 */
export const ThinkingStep: Component<ThinkingStepProps> = (props) => {
  const isActive = createMemo(
    () =>
      props.part.startedAt !== undefined &&
      props.part.endedAt === undefined &&
      props.isStreaming === true,
  );

  const label = createMemo(() => {
    if (isActive()) {
      return "Thinking...";
    }
    const { startedAt, endedAt } = props.part;
    if (startedAt !== undefined && endedAt !== undefined) {
      return `Thought for ${formatDuration(endedAt - startedAt)}`;
    }
    return "Thought";
  });

  const [userToggled, setUserToggled] = createSignal<boolean | null>(null);
  const expanded = createMemo(() => {
    if (userToggled() !== null) {
      return userToggled()!;
    }
    return props.isStreaming && props.isLast;
  });

  return (
    <TimelineStep
      icon={<TbOutlineBrain class="h-4 w-4" classList={{ "animate-pulse": isActive() }} />}
      isLast={props.isLast}
    >
      <CollapsibleStep
        expanded={expanded()}
        label={<span classList={{ "animate-shimmer text-shimmer": isActive() }}>{label()}</span>}
        onToggle={() => setUserToggled(!expanded())}
      >
        <div class="max-h-[200px] overflow-y-auto py-1 italic leading-relaxed text-muted-foreground">
          <Markdown class="prose-p:m-0 text-sm" isStreaming={isActive()} text={props.part.text} />
        </div>
      </CollapsibleStep>
    </TimelineStep>
  );
};
