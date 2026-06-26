/** biome-ignore-all lint/a11y/noNoninteractiveElementInteractions: addon delegates focus to input on click */
/** biome-ignore-all lint/a11y/useKeyWithClickEvents: addon click is focus delegation, not an action */
/** biome-ignore-all lint/a11y/useSemanticElements: div+role used for input group composition */
import { cva, type VariantProps } from "class-variance-authority";
import type { JSX } from "solid-js";
import { splitProps } from "solid-js";

import type { ButtonProps } from "~/components/ui/button";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/* ── InputGroup ─────────────────────────────────────────────────── */

export function InputGroup(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "group/input-group relative flex h-9 w-full min-w-0 items-center overflow-hidden rounded-md border border-input bg-background outline-none transition-colors",
        "has-disabled:bg-muted/50 has-disabled:opacity-50",
        "has-[[data-slot=input-group-control]:focus-visible]:ring-2 has-[[data-slot=input-group-control]:focus-visible]:ring-ring/30",
        "has-[[data-slot][aria-invalid=true]]:border-destructive has-[[data-slot][aria-invalid=true]]:ring-2 has-[[data-slot][aria-invalid=true]]:ring-destructive/15",
        "has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col",
        "has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col",
        "has-[>textarea]:h-auto",
        "has-[>[data-align=block-end]]:[&>input]:pt-3",
        "has-[>[data-align=block-start]]:[&>input]:pb-3",
        "has-[>[data-align=inline-end]]:[&>input]:pr-1.5",
        "has-[>[data-align=inline-start]]:[&>input]:pl-1.5",
        local.class
      )}
      data-slot="input-group"
      role="group"
      {...others}
    />
  );
}

/* ── InputGroupAddon ────────────────────────────────────────────── */

const inputGroupAddonVariants = cva(
  "flex h-auto shrink-0 cursor-text select-none items-center justify-center gap-2 py-1.5 font-medium text-muted-foreground text-sm group-data-[disabled]/input-group:opacity-50 [&>svg:not([class*='size-'])]:size-4",
  {
    variants: {
      align: {
        "inline-start": "order-first pl-2",
        "inline-end": "order-last pr-2",
        "block-start":
          "order-first w-full justify-start px-2.5 pt-2 group-has-[>input]/input-group:pt-2 [.border-b]:pb-2",
        "block-end":
          "order-last w-full justify-start px-2.5 pb-2 group-has-[>input]/input-group:pb-2 [.border-t]:pt-2",
      },
      separator: {
        true: "self-stretch border-input",
        false: "",
      },
    },
    compoundVariants: [
      { align: "inline-end", separator: true, class: "w-9 border-l px-0 py-0" },
      {
        align: "inline-start",
        separator: true,
        class: "w-9 border-r px-0 py-0",
      },
      { align: "block-start", separator: true, class: "border-b pb-2" },
      { align: "block-end", separator: true, class: "border-t pt-2" },
    ],
    defaultVariants: {
      align: "inline-start",
      separator: false,
    },
  }
);

type InputGroupAddonProps = JSX.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof inputGroupAddonVariants>;

export function InputGroupAddon(props: InputGroupAddonProps) {
  const [local, others] = splitProps(props, ["class", "align", "separator"]);
  return (
    <div
      class={cn(
        inputGroupAddonVariants({
          align: local.align,
          separator: local.separator,
        }),
        local.class
      )}
      data-align={local.align ?? "inline-start"}
      data-slot="input-group-addon"
      onClick={(e: MouseEvent) => {
        const target = e.currentTarget as HTMLElement;
        if ((e.target as HTMLElement).closest("button")) {
          return;
        }
        target.parentElement?.querySelector("input")?.focus();
      }}
      role="group"
      {...others}
    />
  );
}

/* ── InputGroupButton ───────────────────────────────────────────── */

const inputGroupButtonVariants = cva(
  "flex h-full w-full items-center justify-center rounded-none text-sm shadow-none",
  {
    variants: {
      size: {
        xs: "gap-1 px-1.5 [&>svg:not([class*='size-'])]:size-3.5",
        "icon-xs": "size-auto p-0 [&>svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-auto p-0 [&>svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  }
);

type InputGroupButtonProps = Omit<ButtonProps, "size"> &
  VariantProps<typeof inputGroupButtonVariants> & {
    onClick?: (e: MouseEvent) => void;
    type?: "button" | "submit" | "reset";
  };

export function InputGroupButton(props: InputGroupButtonProps) {
  const [local, others] = splitProps(props, [
    "class",
    "size",
    "variant",
    "type",
    "onClick",
  ]);
  return (
    <Button
      class={cn(inputGroupButtonVariants({ size: local.size }), local.class)}
      onClick={local.onClick}
      size="sm"
      type={local.type ?? "button"}
      variant={local.variant ?? "ghost"}
      {...others}
    />
  );
}

/* ── InputGroupText ─────────────────────────────────────────────── */

export function InputGroupText(props: JSX.HTMLAttributes<HTMLSpanElement>) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <span
      class={cn(
        "flex items-center gap-2 text-muted-foreground text-sm [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none",
        local.class
      )}
      {...others}
    />
  );
}

/* ── InputGroupInput ────────────────────────────────────────────── */

export function InputGroupInput(
  props: JSX.InputHTMLAttributes<HTMLInputElement>
) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <input
      class={cn(
        "min-w-0 flex-1 rounded-none border-0 bg-transparent text-sm shadow-none outline-none ring-0 focus-visible:outline-none focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0",
        local.class
      )}
      data-slot="input-group-control"
      {...others}
    />
  );
}

/* ── InputGroupTextarea ─────────────────────────────────────────── */

export function InputGroupTextarea(
  props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement>
) {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <textarea
      class={cn(
        "flex-1 resize-none rounded-none border-0 bg-transparent py-2 shadow-none ring-0 focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0",
        local.class
      )}
      data-slot="input-group-control"
      {...others}
    />
  );
}
