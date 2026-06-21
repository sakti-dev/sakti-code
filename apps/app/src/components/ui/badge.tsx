import { cva, type VariantProps } from "class-variance-authority";
import type { ParentComponent } from "solid-js";
import { cn } from "~/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 font-semibold text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow",
        outline: "text-foreground",
        success: "border-transparent bg-success text-success-foreground shadow",
        warning: "border-transparent bg-warning text-warning-foreground shadow",
        info: "border-transparent bg-info text-info-foreground shadow",
      },
      size: {
        sm: "px-2 py-0.5 text-[10px]",
        md: "px-2.5 py-0.5 text-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
);

type BadgeVariants = VariantProps<typeof badgeVariants>;

export interface BadgeProps {
  children?: unknown;
  class?: string;
  size?: BadgeVariants["size"];
  variant?: BadgeVariants["variant"];
}

export const Badge: ParentComponent<BadgeProps> = (props) => (
  <span
    class={cn(
      badgeVariants({ variant: props.variant, size: props.size }),
      props.class
    )}
  >
    {props.children}
  </span>
);
