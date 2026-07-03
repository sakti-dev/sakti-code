import { type Component, Show } from "solid-js";
import { cn } from "~/lib/utils";
import type { ToolIconCmp, ToolPartData } from "./store.tsx";

export interface ToolSummaryRowProps {
  class?: string;
  error?: string;
  icon: ToolIconCmp;
  part: ToolPartData;
  /** When false, the leading icon is hidden (used when the icon lives on a parent TimelineStep). */
  showIcon?: boolean;
  status: "running" | "completed" | "error" | "pending";
  summary: string | { main: string; muted?: string };
}

export const ToolSummaryRow: Component<ToolSummaryRowProps> = (props) => {
  const mainText = () => (typeof props.summary === "string" ? props.summary : props.summary.main);
  const mutedText = () => (typeof props.summary === "string" ? undefined : props.summary.muted);

  return (
    <div
      class={cn(
        "flex items-center gap-2 py-1.5 text-sm",
        props.status === "error" && "text-destructive",
        props.class,
      )}
      data-component="tool-summary-row"
      data-status={props.status}
    >
      <Show when={props.showIcon !== false}>
        <props.icon part={props.part} />
      </Show>

      <span class="min-w-0 truncate" data-slot="summary-main">
        {mainText()}
      </span>

      <Show when={mutedText()}>
        <span class="shrink-0 text-muted-foreground text-xs" data-slot="summary-muted">
          {mutedText()}
        </span>
      </Show>

      <Show when={props.error && props.status === "error"}>
        <span class="text-destructive text-xs" data-slot="error-message">
          {props.error}
        </span>
      </Show>
    </div>
  );
};
