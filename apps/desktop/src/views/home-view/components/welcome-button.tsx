import { cn } from "@/utils";
import type { JSX } from "solid-js";

interface WelcomeButtonProps {
  icon: JSX.Element;
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary";
  class?: string;
}

export function WelcomeButton(props: WelcomeButtonProps) {
  const variant = () => props.variant ?? "primary";

  return (
    <button
      onClick={props.onClick}
      class={cn(
        "flex items-center gap-3 rounded-lg px-5 py-3.5",
        "text-sm font-medium transition-all duration-200",
        "hover:scale-[1.02] active:scale-[0.98]",
        "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
        variant() === "primary"
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        props.class
      )}
    >
      <span class="text-lg">{props.icon}</span>
      <span>{props.label}</span>
    </button>
  );
}
