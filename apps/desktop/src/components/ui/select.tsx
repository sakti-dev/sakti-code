import type { Component, JSX, ValidComponent } from "solid-js";
import { Show, splitProps } from "solid-js";

import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import * as SelectPrimitive from "@kobalte/core/select";

import { cn } from "@/utils";

// Select Root
type SelectProps<T extends ValidComponent = "div"> = SelectPrimitive.SelectRootProps<T> & {
  class?: string | undefined;
  children?: JSX.Element;
};

const Select = <T extends ValidComponent = "div">(props: PolymorphicProps<T, SelectProps<T>>) => {
  const [local, rest] = splitProps(props as SelectProps, ["class", "children"]);

  return (
    <SelectPrimitive.Root class={cn("relative", local.class)} {...rest}>
      {local.children}
    </SelectPrimitive.Root>
  );
};

// Select Trigger
type SelectTriggerProps<T extends ValidComponent = "button"> =
  SelectPrimitive.SelectTriggerProps<T> & {
    class?: string | undefined;
    children?: JSX.Element;
  };

const SelectTrigger = <T extends ValidComponent = "button">(
  props: PolymorphicProps<T, SelectTriggerProps<T>>
) => {
  const [local, rest] = splitProps(props as SelectTriggerProps, ["class", "children"]);

  return (
    <SelectPrimitive.Trigger
      class={cn(
        "bg-background border-border ring-offset-background placeholder:text-muted-foreground focus:border-ring focus:ring-ring/50 flex h-10 w-full items-center justify-between rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-50",
        local.class
      )}
      {...rest}
    >
      {local.children}
      <SelectPrimitive.Icon class="text-muted-foreground">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-4 w-4 opacity-50"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
};

// Select Value
type SelectValueProps<T extends ValidComponent = "span"> = SelectPrimitive.SelectValueProps<T> & {
  class?: string | undefined;
  placeholder?: string;
};

const SelectValue = <T extends ValidComponent = "span">(
  props: PolymorphicProps<T, SelectValueProps<T>>
) => {
  const [local, rest] = splitProps(props as SelectValueProps, ["class", "placeholder"]);

  return (
    <SelectPrimitive.Value class={cn("text-foreground", local.class)} {...rest}>
      <Show
        when={!local.placeholder}
        fallback={<span class="text-muted-foreground">{local.placeholder}</span>}
      >
        {local.placeholder}
      </Show>
    </SelectPrimitive.Value>
  );
};

// Select Portal
const SelectPortal: Component<SelectPrimitive.SelectPortalProps> = props => {
  return <SelectPrimitive.Portal {...props}>{props.children}</SelectPrimitive.Portal>;
};

// Select Content
type SelectContentProps<T extends ValidComponent = "div"> =
  SelectPrimitive.SelectContentProps<T> & {
    class?: string | undefined;
    children?: JSX.Element;
  };

const SelectContent = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, SelectContentProps<T>>
) => {
  const [local, rest] = splitProps(props as SelectContentProps, ["class", "children"]);

  return (
    <SelectPortal>
      <SelectPrimitive.Content
        class={cn(
          "bg-popover text-popover-foreground data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95 relative z-50 max-h-[300px] overflow-y-auto rounded-md border shadow-lg",
          local.class
        )}
        {...rest}
      >
        <SelectPrimitive.Listbox class="p-1" />
      </SelectPrimitive.Content>
    </SelectPortal>
  );
};

// Select Item
type SelectItemProps<T extends ValidComponent = "div"> = SelectPrimitive.SelectItemProps<T> & {
  class?: string | undefined;
  children?: JSX.Element;
};

const SelectItem = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, SelectItemProps<T>>
) => {
  const [local, rest] = splitProps(props as SelectItemProps, ["class", "children"]);

  return (
    <SelectPrimitive.Item
      class={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        local.class
      )}
      {...rest}
    >
      <span class="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="text-primary h-4 w-4"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemLabel>{local.children}</SelectPrimitive.ItemLabel>
    </SelectPrimitive.Item>
  );
};

// Select Label
type SelectLabelProps<T extends ValidComponent = "div"> = SelectPrimitive.SelectLabelProps<T> & {
  class?: string | undefined;
};

const SelectLabel = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, SelectLabelProps<T>>
) => {
  const [local, rest] = splitProps(props as SelectLabelProps, ["class"]);

  return (
    <SelectPrimitive.Label class={cn("px-2 py-1.5 text-sm font-semibold", local.class)} {...rest} />
  );
};

// Select Section (for grouping items)
type SelectSectionProps<T extends ValidComponent = "div"> =
  SelectPrimitive.SelectSectionProps<T> & {
    class?: string | undefined;
    children?: JSX.Element;
  };

const SelectSection = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, SelectSectionProps<T>>
) => {
  const [local, rest] = splitProps(props as SelectSectionProps, ["class", "children"]);

  return (
    <SelectPrimitive.Section class={cn("p-1", local.class)} {...rest}>
      {local.children}
    </SelectPrimitive.Section>
  );
};

export {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectPortal,
  SelectSection,
  SelectTrigger,
  SelectValue,
};
