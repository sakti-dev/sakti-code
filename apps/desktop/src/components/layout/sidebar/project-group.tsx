import { For, type ParentComponent, Show } from "solid-js";
import { cn } from "~/lib/utils";
import { SessionItem } from "./session-item.tsx";

export interface Session {
  createdAt: number;
  id: string;
  modelId: string | null;
  profileId: string | null;
  projectId: string;
  thinkingLevel: string;
  title: string | null;
  updatedAt: number;
}

export interface ProjectGroupProps {
  isActive: boolean;
  isExpanded: boolean;
  name: string;
  onNewSession?: (projectId: string) => void;
  onRemove?: (projectId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onToggle: (projectId: string) => void;
  projectId: string;
  sessions: Session[];
}

export const ProjectGroup: ParentComponent<ProjectGroupProps> = (props) => (
  <div class="border-border border-b">
    <button
      class={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
        "hover:bg-secondary/50",
        props.isActive && "bg-secondary/30",
      )}
      onClick={() => props.onToggle(props.projectId)}
      type="button"
    >
      <svg
        aria-label={props.isExpanded ? "Collapse" : "Expand"}
        class={cn(
          "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
          props.isExpanded && "rotate-90",
        )}
        fill="none"
        role="img"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <title>{props.isExpanded ? "Collapse" : "Expand"}</title>
        <path d="m9 18 6-6-6-6" />
      </svg>
      <svg
        aria-label="Project"
        class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        fill="none"
        role="img"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <title>Project</title>
        <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
      </svg>
      <span class="min-w-0 flex-1 truncate font-medium text-foreground text-xs">{props.name}</span>
      <span class="shrink-0 text-[10px] text-muted-foreground">{props.sessions.length}</span>
    </button>

    <Show when={props.isExpanded}>
      <div class="border-border border-t bg-background/50">
        <Show
          fallback={<div class="px-6 py-2 text-muted-foreground text-xs">No sessions</div>}
          when={props.sessions.length > 0}
        >
          <For each={props.sessions}>
            {(session) => (
              <SessionItem
                isActive={false}
                onClick={props.onSelectSession}
                sessionId={session.id}
                title={session.title}
                updatedAt={session.updatedAt}
              />
            )}
          </For>
        </Show>
      </div>
    </Show>
  </div>
);
