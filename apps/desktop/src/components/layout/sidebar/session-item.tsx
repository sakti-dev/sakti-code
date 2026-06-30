import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import type { ParentComponent } from "solid-js";
import { cn } from "~/lib/utils";

dayjs.extend(relativeTime);

export interface SessionItemProps {
  isActive: boolean;
  onClick: (sessionId: string) => void;
  sessionId: string;
  title: string | null;
  updatedAt: number;
}

export const SessionItem: ParentComponent<SessionItemProps> = (props) => (
  <button
    class={cn(
      "flex w-full items-center gap-2 border-l-2 px-3 py-1.5 text-left text-sm transition-colors",
      props.isActive
        ? "border-l-primary bg-secondary text-foreground"
        : "border-l-transparent text-muted-foreground hover:bg-secondary/50",
    )}
    onClick={() => props.onClick(props.sessionId)}
    type="button"
  >
    <span class="min-w-0 flex-1 truncate text-xs">{props.title || "Untitled session"}</span>
    <span class="shrink-0 text-[10px] opacity-60">{dayjs(props.updatedAt).fromNow()}</span>
  </button>
);
