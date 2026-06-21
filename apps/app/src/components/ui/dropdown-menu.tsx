import { DropdownMenu as DropdownMenuPrimitive } from "@kobalte/core/dropdown-menu";
import { type JSX, type ParentComponent, splitProps } from "solid-js";
import { cn } from "~/lib/utils";

const DropdownMenu = DropdownMenuPrimitive;

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

const DropdownMenuContent: ParentComponent<
  JSX.IntrinsicElements["div"] & { class?: string }
> = (props) => {
  const [local, others] = splitProps(props, ["class", "children"]);
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        class={cn(
          "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
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
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
};

const DropdownMenuItem: ParentComponent<
  JSX.IntrinsicElements["div"] & {
    class?: string;
    shortcut?: string;
  }
> = (props) => {
  const [local, others] = splitProps(props, ["class", "children", "shortcut"]);
  return (
    <DropdownMenuPrimitive.Item
      class={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-sm px-3 py-1.5 text-sm outline-none transition-colors",
        "focus:bg-accent focus:text-accent-foreground",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        local.class
      )}
      {...others}
    >
      {local.children}
      {local.shortcut && (
        <span class="ml-auto text-muted-foreground text-xs tracking-widest">
          {local.shortcut}
        </span>
      )}
    </DropdownMenuPrimitive.Item>
  );
};

const DropdownMenuSeparator: ParentComponent<{ class?: string }> = (props) => (
  <DropdownMenuPrimitive.Separator
    class={cn("-mx-1 my-1 h-px bg-muted", props.class)}
  />
);

const DropdownMenuLabel: ParentComponent<
  JSX.IntrinsicElements["div"] & { class?: string }
> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <DropdownMenuPrimitive.Label
      class={cn(
        "px-2 py-1.5 font-semibold text-foreground text-sm",
        local.class
      )}
      {...others}
    />
  );
};

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
