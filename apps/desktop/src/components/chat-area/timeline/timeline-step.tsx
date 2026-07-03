import { type Component, type JSX, Show } from "solid-js";
import { cn } from "~/lib/utils";

export interface TimelineStepProps {
  children: JSX.Element;
  class?: string;
  icon: JSX.Element;
  isLast: boolean;
}

/**
 * One row of the chain-of-thought stepper: an icon column (with a vertical
 * connector line to the next step, unless this is the last step) and a content
 * column.
 */
export const TimelineStep: Component<TimelineStepProps> = (props) => {
  return (
    <div class={cn("flex gap-2 text-sm", props.class)} data-component="timeline-step">
      <div class="relative flex flex-col items-center">
        <div class="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
          {props.icon}
        </div>
        <Show when={!props.isLast}>
          <div class="w-px flex-1 bg-border" data-slot="timeline-connector" />
        </Show>
      </div>
      <div class="min-w-0 flex-1 pb-3">{props.children}</div>
    </div>
  );
};
