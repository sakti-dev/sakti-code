import type { ParentComponent } from "solid-js";
import { cn } from "~/lib/utils";

export interface SeparatorProps {
  class?: string;
  orientation?: "horizontal" | "vertical";
}

export const Separator: ParentComponent<SeparatorProps> = (props) => (
  <hr
    aria-orientation={props.orientation ?? "horizontal"}
    class={cn(
      "shrink-0 border-border",
      props.orientation === "vertical"
        ? "h-full w-px border-x-0 border-y-0 border-l"
        : "h-px w-full border-x-0 border-y-0 border-t",
      props.class,
    )}
  />
);
