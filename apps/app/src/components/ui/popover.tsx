import { Popover as PopoverPrimitive } from "@kobalte/core/popover";
import { type JSX, type ParentComponent, splitProps } from "solid-js";
import { cn } from "~/lib/utils";

const Popover = PopoverPrimitive;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverPortal = PopoverPrimitive.Portal;

const PopoverContent: ParentComponent<
  JSX.IntrinsicElements["div"] & { class?: string }
> = (props) => {
  const [local, others] = splitProps(props, ["class", "children"]);
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        class={cn(
          "z-50 w-72 rounded-lg border bg-popover p-4 text-popover-foreground shadow-md outline-none",
          "data-[expanded]:fade-in-0 data-[expanded]:zoom-in-95 data-[expanded]:animate-in",
          "data-[closed]:fade-out-0 data-[closed]:zoom-out-95 data-[closed]:animate-out",
          "data-[side=top]:slide-in-from-bottom-2",
          "data-[side=bottom]:slide-in-from-top-2",
          "data-[side=left]:slide-in-from-right-2",
          "data-[side=right]:slide-in-from-left-2",
          local.class
        )}
        {...others}
      >
        {local.children}
        <PopoverPrimitive.Arrow class="fill-popover" />
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
};

export { Popover, PopoverContent, PopoverPortal, PopoverTrigger };
