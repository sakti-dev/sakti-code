import { cn } from "@/utils";
import { type Component } from "solid-js";

export type TaskCardStatus =
  | "researching"
  | "specifying"
  | "implementing"
  | "completed"
  | "failed";

export interface TaskCardData {
  taskSessionId: string;
  title: string;
  status: TaskCardStatus;
  specType: "comprehensive" | "quick" | null;
  lastActivityAt: string;
}

export interface TaskCardProps {
  task: TaskCardData;
  active?: boolean;
  onSelect?: (taskSessionId: string) => void;
  class?: string;
}

function formatLastActivity(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMinutes = Math.floor(Math.max(0, now - then) / 60000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

function statusClass(status: TaskCardStatus): string {
  switch (status) {
    case "researching":
      return "bg-blue-500/10 text-blue-700";
    case "specifying":
      return "bg-amber-500/10 text-amber-700";
    case "implementing":
      return "bg-emerald-500/10 text-emerald-700";
    case "completed":
      return "bg-green-500/10 text-green-700";
    case "failed":
      return "bg-red-500/10 text-red-700";
  }
}

export const TaskCard: Component<TaskCardProps> = props => {
  return (
    <button
      type="button"
      class={cn(
        "w-full rounded-lg border border-border/40 bg-card/20 p-3 text-left transition-colors",
        "hover:bg-card/35",
        props.active && "ring-primary/30 border-primary/40 ring-2",
        props.class
      )}
      data-active={props.active ? "true" : "false"}
      onClick={() => props.onSelect?.(props.task.taskSessionId)}
    >
      <div class="flex items-start justify-between gap-3">
        <h3 class="text-foreground text-sm font-semibold">{props.task.title}</h3>
        <span class={cn("rounded px-2 py-0.5 text-[11px] font-medium", statusClass(props.task.status))}>
          {props.task.status}
        </span>
      </div>

      <div class="text-muted-foreground mt-2 flex items-center gap-2 text-xs">
        {props.task.specType ? (
          <span class="rounded border border-border/40 px-1.5 py-0.5">{props.task.specType}</span>
        ) : (
          <span class="rounded border border-border/30 px-1.5 py-0.5">unspecified</span>
        )}
        <span>•</span>
        <span>{formatLastActivity(props.task.lastActivityAt)}</span>
      </div>
    </button>
  );
};

export default TaskCard;
