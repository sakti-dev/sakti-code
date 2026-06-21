import type { ParentComponent } from "solid-js";
import { cn } from "~/lib/utils";

interface ScrollAreaProps {
  children?: unknown;
  class?: string;
  horizontal?: boolean;
  vertical?: boolean;
}

const ScrollArea: ParentComponent<ScrollAreaProps> = (props) => (
  <div
    class={cn(
      "overflow-auto",
      props.vertical !== false && "scrollbar-thin",
      props.horizontal && "scrollbar-thin",
      props.class
    )}
  >
    {props.children}
  </div>
);

export type { ScrollAreaProps };
export { ScrollArea };
