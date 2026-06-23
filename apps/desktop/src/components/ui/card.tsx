import type { Component, ComponentProps } from "solid-js";
import { splitProps } from "solid-js";

import { cn } from "~/lib/utils";

type CardVariant = "default" | "elevated" | "interactive" | "bordered";

interface CardProps extends ComponentProps<"div"> {
  variant?: CardVariant;
}

const Card: Component<CardProps> = (props) => {
  const [local, others] = splitProps(props, ["variant", "class"]);

  const variantStyles: Record<CardVariant, string> = {
    default: "bg-card border-border",
    elevated: "bg-card shadow-lg border-border/50",
    interactive:
      "bg-card/50 border-border/50 hover:border-primary/30 hover:bg-card/80 hover:shadow-md hover:shadow-primary/5 cursor-pointer transition-all duration-200",
    bordered: "bg-transparent border-input",
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

const CardHeader: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div
      class={cn("flex flex-col space-y-1.5 p-5 pb-0", local.class)}
      {...others}
    />
  );
};

const CardTitle: Component<ComponentProps<"h3">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <h3
      class={cn(
        "font-semibold text-base text-card-foreground leading-tight tracking-tight",
        local.class
      )}
      {...others}
    />
  );
};

const CardDescription: Component<ComponentProps<"p">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <p class={cn("text-muted-foreground text-sm", local.class)} {...others} />
  );
};

const CardContent: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("p-5 pt-3", local.class)} {...others} />;
};

const CardFooter: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div
      class={cn("flex items-center gap-3 p-5 pt-0", local.class)}
      {...others}
    />
  );
};

const CardAction: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div
      class={cn(
        "absolute top-3 right-3 opacity-0 transition-opacity duration-200",
        "group-hover:opacity-100",
        local.class
      )}
      {...others}
    />
  );
};

const CardItem: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <div
      class={cn("flex items-center justify-between gap-4 p-4", local.class)}
      {...others}
    />
  );
};

const CardItemContent: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("flex flex-col", local.class)} {...others} />;
};

const CardItemLabel: Component<ComponentProps<"span">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <span
      class={cn("font-medium text-card-foreground text-sm", local.class)}
      {...others}
    />
  );
};

const CardItemDescription: Component<ComponentProps<"p">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return (
    <p class={cn("text-muted-foreground text-xs", local.class)} {...others} />
  );
};

const CardItemAction: Component<ComponentProps<"div">> = (props) => {
  const [local, others] = splitProps(props, ["class"]);
  return <div class={cn("flex items-center gap-2", local.class)} {...others} />;
};

export type { CardProps, CardVariant };
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
