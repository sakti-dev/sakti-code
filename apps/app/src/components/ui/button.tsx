import { cva, type VariantProps } from "class-variance-authority";
import type { JSX, ParentComponent } from "solid-js";
import { cn } from "~/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 rounded-md px-3 text-xs",
        md: "h-9 px-4 py-2",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
);

type ButtonVariants = VariantProps<typeof buttonVariants>;

export type ButtonProps = {
  children?: unknown;
  class?: string;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  size?: ButtonVariants["size"];
  type?: "button" | "submit" | "reset";
  variant?: ButtonVariants["variant"];
} & Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class">;

export const Button: ParentComponent<ButtonProps> = (props) => (
  <button
    class={cn(
      buttonVariants({ variant: props.variant, size: props.size }),
      props.loading && "pointer-events-none opacity-70",
      props.class
    )}
    disabled={props.disabled || props.loading}
    onClick={props.onClick}
    type={props.type ?? "button"}
  >
    {props.loading && (
      <svg
        aria-label="Loading"
        class="size-4 animate-spin"
        fill="none"
        role="img"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <title>Loading</title>
        <circle
          class="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          stroke-width="4"
        />
        <path
          class="opacity-75"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          fill="currentColor"
        />
      </svg>
    )}
    {props.children}
  </button>
);
