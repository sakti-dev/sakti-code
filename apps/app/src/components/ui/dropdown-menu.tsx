import * as DropdownMenuPrimitive from "@kobalte/core/dropdown-menu";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import type { Component, ValidComponent } from "solid-js";
import { splitProps } from "solid-js";

import { cn } from "~/lib/utils";

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
const DropdownMenuSub = DropdownMenuPrimitive.Sub;
const DropdownMenuGroup = DropdownMenuPrimitive.Group;
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const DropdownMenu: Component<DropdownMenuPrimitive.DropdownMenuRootProps> = (
  props
) => <DropdownMenuPrimitive.Root gutter={4} {...props} />;

type DropdownMenuContentProps<T extends ValidComponent = "div"> =
  DropdownMenuPrimitive.DropdownMenuContentProps<T> & {
    class?: string;
  };

const DropdownMenuContent = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, DropdownMenuContentProps<T>>
) => {
  const [, rest] = splitProps(props as DropdownMenuContentProps, ["class"]);
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        class={cn(
          "z-50 min-w-[200px] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg",
          props.class
        )}
        {...rest}
      />
    </DropdownMenuPrimitive.Portal>
  );
};

type DropdownMenuRadioItemProps<T extends ValidComponent = "div"> =
  DropdownMenuPrimitive.DropdownMenuRadioItemProps<T> & {
    class?: string;
  };

const DropdownMenuRadioItem = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, DropdownMenuRadioItemProps<T>>
) => {
  const [, rest] = splitProps(props as DropdownMenuRadioItemProps, ["class"]);
  return (
    <DropdownMenuPrimitive.RadioItem
      class={cn(
        "relative flex cursor-default select-none items-center rounded-sm px-3 py-2 font-medium text-sm outline-none transition-all duration-150",
        "hover:bg-accent hover:text-accent-foreground hover:shadow-sm focus:bg-accent focus:text-accent-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "animate-fade-in-up",
        props.class
      )}
      {...rest}
    />
  );
};

type DropdownMenuItemProps<T extends ValidComponent = "div"> =
  DropdownMenuPrimitive.DropdownMenuItemProps<T> & {
    class?: string;
  };

const DropdownMenuItem = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, DropdownMenuItemProps<T>>
) => {
  const [, rest] = splitProps(props as DropdownMenuItemProps, ["class"]);
  return (
    <DropdownMenuPrimitive.Item
      class={cn(
        "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
        "focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        props.class
      )}
      {...rest}
    />
  );
};

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuTrigger,
};
