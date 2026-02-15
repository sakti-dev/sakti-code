import type { Component, ComponentProps } from "solid-js";
import { splitProps } from "solid-js";

import { cn } from "@/utils";

type CardVariant = "default" | "elevated" | "interactive" | "bordered";

interface CardProps extends ComponentProps<"div"> {
  variant?: CardVariant;
}

const Card: Component<CardProps> = props => {
  const [local, others] = splitProps(props, ["variant", "class"]);

  const variantStyles: Record<CardVariant, string> = {
    default: "bg-zinc-50 dark:bg-zinc-900/50 border-zinc-200 dark:border-zinc-800",
    elevated:
      "bg-white dark:bg-zinc-900 shadow-lg shadow-zinc-200/50 dark:shadow-zinc-950/50 border-zinc-200/50 dark:border-zinc-800/50",
    interactive:
      "bg-zinc-50/50 dark:bg-zinc-900/50 border-zinc-200/50 dark:border-zinc-800/50 hover:border-primary/30 hover:bg-zinc-100/80 dark:hover:bg-zinc-800/60 hover:shadow-md hover:shadow-primary/5 cursor-pointer transition-all duration-200",
    bordered: "bg-transparent border-zinc-300 dark:border-zinc-700",
  };

  const variant = () => local.variant ?? "default";

  return (
    <div
      class={cn(
        "relative overflow-hidden rounded-xl border",
        "transition-all duration-200",
        variantStyles[variant()],
        local.class
      )}
      {...others}
    />
  );
};

const CardHeader: Component<ComponentProps<"div">> = props => {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("flex flex-col space-y-1.5 p-5 pb-0", local.class)} {...others} />;
};

const CardTitle: Component<ComponentProps<"h3">> = props => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <h3
      class={cn(
        "text-base font-semibold leading-tight tracking-tight text-zinc-900 dark:text-zinc-100",
        local.class
      )}
      {...others}
    />
  );
};

const CardDescription: Component<ComponentProps<"p">> = props => {
  const [local, others] = splitProps(props, ["class"]);
  return <p class={cn("text-sm text-zinc-500 dark:text-zinc-400", local.class)} {...others} />;
};

const CardContent: Component<ComponentProps<"div">> = props => {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("p-5 pt-3", local.class)} {...others} />;
};

const CardFooter: Component<ComponentProps<"div">> = props => {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("flex items-center gap-3 p-5 pt-0", local.class)} {...others} />;
};

const CardAction: Component<ComponentProps<"div">> = props => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "absolute right-3 top-3 opacity-0 transition-opacity duration-200",
        "group-hover:opacity-100",
        local.class
      )}
      {...others}
    />
  );
};

const CardItem: Component<ComponentProps<"div">> = props => {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("flex items-center justify-between gap-4 p-4", local.class)} {...others} />;
};

const CardItemContent: Component<ComponentProps<"div">> = props => {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("flex flex-col", local.class)} {...others} />;
};

const CardItemLabel: Component<ComponentProps<"span">> = props => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <span
      class={cn("text-sm font-medium text-zinc-900 dark:text-zinc-100", local.class)}
      {...others}
    />
  );
};

const CardItemDescription: Component<ComponentProps<"p">> = props => {
  const [local, others] = splitProps(props, ["class"]);
  return <p class={cn("text-xs text-zinc-500 dark:text-zinc-400", local.class)} {...others} />;
};

const CardItemAction: Component<ComponentProps<"div">> = props => {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("flex items-center gap-2", local.class)} {...others} />;
};

export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardItem,
  CardItemAction,
  CardItemContent,
  CardItemDescription,
  CardItemLabel,
  CardTitle,
};
export type { CardProps, CardVariant };
