import type { Component, ComponentProps } from "solid-js";
import { splitProps } from "solid-js";

import { cn } from "~/lib/utils";

type CardVariant = "default" | "elevated" | "interactive" | "bordered";

interface CardProps extends ComponentProps<"div"> {
  variant?: CardVariant;
}

export const Card: Component<CardProps> = (props) => {
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
        local.class,
      )}
      {...others}
    />
  );
};
