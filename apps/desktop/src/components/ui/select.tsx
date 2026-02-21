import type { JSX, ValidComponent } from "solid-js";
import { splitProps } from "solid-js";

import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import * as SelectPrimitive from "@kobalte/core/select";

import { cn } from "@/utils";

const Select = SelectPrimitive.Root;
const SelectHiddenSelect = SelectPrimitive.HiddenSelect;
const SelectValue = SelectPrimitive.Value;

type SelectTriggerProps<T extends ValidComponent = "button"> =
  SelectPrimitive.SelectTriggerProps<T> & {
    class?: string | undefined;
    children?: JSX.Element;
  };

const SelectTrigger = <T extends ValidComponent = "button">(
  props: PolymorphicProps<T, SelectTriggerProps<T>>
) => {
  const [local, others] = splitProps(props as SelectTriggerProps, ["class", "children"]);
  return (
    <SelectPrimitive.Trigger
      class={cn(
        "border-border/80 bg-background/70 hover:bg-muted/60 focus:ring-primary/45 focus:ring-offset-background flex h-9 w-full items-center justify-between rounded-md border px-3 py-2 text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        local.class
      )}
      {...others}
    >
      {local.children}
      <SelectPrimitive.Icon
        as="svg"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="text-muted-foreground size-4 transition-transform duration-200 data-[expanded]:rotate-180"
      >
        <path d="M6 9l6 6l6 -6" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
};

type SelectContentProps<T extends ValidComponent = "div"> =
  SelectPrimitive.SelectContentProps<T> & { class?: string | undefined };

const SelectContent = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, SelectContentProps<T>>
) => {
  const [local, others] = splitProps(props as SelectContentProps, ["class"]);
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        class={cn(
          "border-border/80 bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95 data-[closed]:slide-out-to-top-2 relative z-50 max-h-[320px] min-w-[200px] overflow-hidden rounded-xl border shadow-[0_20px_60px_rgba(0,0,0,0.4)] backdrop-blur-xl duration-200",
          local.class
        )}
        {...others}
      >
        <SelectPrimitive.Listbox class="scrollbar-thin m-0 overflow-y-auto p-1.5" />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
};

type SelectItemProps<T extends ValidComponent = "li"> = SelectPrimitive.SelectItemProps<T> & {
  class?: string | undefined;
  children?: JSX.Element;
};

const SelectItem = <T extends ValidComponent = "li">(
  props: PolymorphicProps<T, SelectItemProps<T>>
) => {
  const [local, others] = splitProps(props as SelectItemProps, ["class", "children"]);
  return (
    <SelectPrimitive.Item
      class={cn(
        "text-popover-foreground group relative flex w-full cursor-default select-none items-center rounded-lg py-2.5 pl-3 pr-10 text-sm outline-none transition-all duration-150 data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
        "hover:bg-accent/70 hover:border-primary/20 hover:shadow-[0_2px_8px_color-mix(in_oklch,var(--color-foreground)_8%,transparent)]",
        "focus-visible:bg-accent/70 focus-visible:border-primary/20 focus-visible:shadow-[0_2px_8px_color-mix(in_oklch,var(--color-foreground)_8%,transparent)]",
        "data-[selected]:bg-primary/12 data-[selected]:text-primary data-[selected]:font-medium",
        "data-[selected]:border-primary/30 data-[selected]:shadow-[0_0_0_1px_color-mix(in_oklch,var(--color-primary)_30%,transparent)]",
        local.class
      )}
      {...others}
    >
      <SelectPrimitive.ItemIndicator class="absolute right-3 flex size-4 items-center justify-center transition-transform duration-200">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="size-3.5"
        >
          <path stroke="none" d="M0 0h24v24H0z" fill="none" />
          <path d="M5 12l5 5l10 -10" />
        </svg>
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemLabel class="flex-1">{local.children}</SelectPrimitive.ItemLabel>
    </SelectPrimitive.Item>
  );
};

type SelectLabelProps<T extends ValidComponent = "label"> = SelectPrimitive.SelectLabelProps<T> & {
  class?: string | undefined;
};

const SelectLabel = <T extends ValidComponent = "label">(
  props: PolymorphicProps<T, SelectLabelProps<T>>
) => {
  const [local, others] = splitProps(props as SelectLabelProps, ["class"]);
  return (
    <SelectPrimitive.Label
      class={cn(
        "text-muted-foreground mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider transition-colors",
        local.class
      )}
      {...others}
    />
  );
};

export {
  Select,
  SelectContent,
  SelectHiddenSelect,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
};
