import * as ButtonPrimitive from "@kobalte/core/button";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import { FiLoader } from "solid-icons/fi";
import type { JSX, ValidComponent } from "solid-js";
import { splitProps } from "solid-js";

import { cn } from "~/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg" | "icon-sm" | "icon-md" | "icon-lg";

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 hover:bg-primary/90 active:shadow-md active:scale-[0.98]",
  secondary:
    "bg-secondary text-secondary-foreground shadow-md shadow-secondary/50 hover:shadow-lg hover:bg-secondary/80 active:shadow-sm active:scale-[0.98]",
  ghost:
    "text-muted-foreground hover:bg-accent hover:text-accent-foreground active:scale-[0.98]",
  danger:
    "bg-destructive text-destructive-foreground shadow-lg shadow-destructive/20 hover:shadow-xl hover:shadow-destructive/30 hover:bg-destructive/90 active:shadow-md active:scale-[0.98]",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs font-medium gap-1.5 rounded-md",
  md: "h-10 px-4 text-sm font-medium gap-2 rounded-lg",
  lg: "h-12 px-6 text-base font-medium gap-2.5 rounded-xl",
  "icon-sm": "size-7 rounded-md",
  "icon-md": "size-9 rounded-lg",
  "icon-lg": "size-11 rounded-xl",
};

type ButtonProps<T extends ValidComponent = "button"> =
  ButtonPrimitive.ButtonRootProps<T> & {
    class?: string;
    children?: JSX.Element;
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    square?: boolean;
  };

const ButtonLoader = () => <FiLoader class="size-4 animate-spin" />;

const Button = <T extends ValidComponent = "button">(
  props: PolymorphicProps<T, ButtonProps<T>>
) => {
  const [local, others] = splitProps(props as ButtonProps, [
    "variant",
    "size",
    "class",
    "loading",
    "square",
    "children",
  ]);

  const variant = () => local.variant ?? "primary";
  const size = () => local.size ?? "md";

  return (
    <ButtonPrimitive.Root
      class={cn(
        "group relative inline-flex items-center justify-center whitespace-nowrap font-medium transition-all duration-200 ease-out",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "overflow-hidden before:absolute before:inset-0 before:-z-10 before:opacity-0 before:transition-opacity before:duration-300",
        local.square && "aspect-square p-0",
        variantStyles[variant()],
        sizeStyles[size()],
        local.loading && "cursor-wait before:animate-pulse",
        local.class
      )}
      disabled={local.loading || others.disabled}
      {...others}
    >
      {local.loading ? (
        <span class="flex items-center gap-2">
          <ButtonLoader />
          <span class="animate-pulse">Loading</span>
        </span>
      ) : (
        <span class="flex items-center gap-2">{local.children}</span>
      )}
    </ButtonPrimitive.Root>
  );
};

export type { ButtonProps, ButtonSize, ButtonVariant };
export { Button };
