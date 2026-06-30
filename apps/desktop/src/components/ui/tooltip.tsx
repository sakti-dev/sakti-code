import * as TooltipPrimitive from "@kobalte/core/tooltip";
import type { ParentComponent } from "solid-js";
import { cn } from "~/lib/utils";

export interface TooltipProps {
  children: Parameters<typeof TooltipPrimitive.Trigger>[0]["children"];
  class?: string;
  content: Parameters<typeof TooltipPrimitive.Content>[0]["children"];
  openDelay?: number;
  placement?: "top" | "right" | "bottom" | "left";
}

export const Tooltip: ParentComponent<TooltipProps> = (props) => (
  <TooltipPrimitive.Root openDelay={props.openDelay ?? 300} placement={props.placement ?? "top"}>
    <TooltipPrimitive.Trigger>{props.children}</TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        class={cn(
          "z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-popover-foreground text-xs shadow-md",
          "data-[expanded]:fade-in-0 data-[expanded]:zoom-in-95 data-[expanded]:animate-in",
          "data-[closed]:fade-out-0 data-[closed]:zoom-out-95 data-[closed]:animate-out",
          "data-[side=top]:slide-in-from-bottom-2",
          "data-[side=bottom]:slide-in-from-top-2",
          "data-[side=left]:slide-in-from-right-2",
          "data-[side=right]:slide-in-from-left-2",
          props.class,
        )}
      >
        {props.content}
        <TooltipPrimitive.Arrow class="fill-popover" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>
);
