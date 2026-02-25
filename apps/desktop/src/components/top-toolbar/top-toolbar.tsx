import { cn } from "@/utils";
import { Home } from "lucide-solid";
import { Show, type Component, type JSX } from "solid-js";

export interface TopToolbarProps {
  view: "homepage" | "task-session";
  title?: string;
  onGoHome?: () => void;
  actions?: JSX.Element;
  class?: string;
}

export const TopToolbar: Component<TopToolbarProps> = props => {
  return (
    <header
      class={cn(
        "flex items-center justify-between rounded-xl border border-border/40 bg-card/20 px-4 py-2.5",
        props.class
      )}
    >
      <div class="flex items-center gap-2">
        <Show when={props.view === "task-session"}>
          <button
            type="button"
            onClick={() => props.onGoHome?.()}
            class="rounded-md border border-border/40 bg-background/70 p-1.5 hover:bg-background"
            aria-label="Go home"
          >
            <Home class="h-4 w-4" />
          </button>
        </Show>

        <p class="text-foreground text-sm font-medium">
          {props.view === "homepage" ? "Homepage" : props.title ?? "Task session"}
        </p>
      </div>

      <div>{props.actions}</div>
    </header>
  );
};

export default TopToolbar;
