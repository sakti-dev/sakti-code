import type { Component, JSX } from "solid-js";
import { cn } from "~/lib/utils";

export const Kbd: Component<JSX.HTMLAttributes<HTMLElement>> = (props) => (
  <kbd
    class={cn(
      "pointer-events-none inline-flex h-5 w-fit min-w-5 select-none items-center justify-center gap-1 rounded-sm bg-muted px-1 font-medium font-sans text-muted-foreground text-xs [&_svg:not([class*='size-'])]:size-3",
      props.class,
    )}
    data-slot="kbd"
    {...props}
  />
);

export const KbdGroup: Component<JSX.HTMLAttributes<HTMLDivElement>> = (props) => (
  <div class={cn("inline-flex items-center gap-1", props.class)} data-slot="kbd-group" {...props} />
);
