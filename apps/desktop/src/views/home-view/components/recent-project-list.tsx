import type { RecentProject } from "@/core/chat/types";
import { cn } from "@/utils";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { For } from "solid-js";

dayjs.extend(relativeTime);

interface RecentProjectCardProps {
  project: RecentProject;
  onOpen: (project: RecentProject) => void;
  onRemove?: (project: RecentProject) => void;
  class?: string;
}

function RecentProjectCard(props: RecentProjectCardProps) {
  return (
    <button
      onClick={() => props.onOpen(props.project)}
      class={cn(
        "group w-full rounded-lg p-4 text-left",
        "bg-card/50 hover:bg-card border-border hover:border-primary/50 border",
        "transition-all duration-200",
        "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
        props.class
      )}
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <h3 class="text-foreground group-hover:text-primary truncate text-sm font-medium transition-colors">
            {props.project.name}
          </h3>
          <p class="text-muted-foreground mt-0.5 truncate text-xs">{props.project.path}</p>
        </div>
        {props.onRemove && (
          <button
            onClick={e => {
              e.stopPropagation();
              props.onRemove?.(props.project);
            }}
            class={cn(
              "opacity-0 group-hover:opacity-100",
              "hover:bg-muted rounded p-1",
              "text-muted-foreground hover:text-destructive",
              "transition-all duration-150",
              "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-1"
            )}
            aria-label="Remove project"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        )}
      </div>
      <p class="text-muted-foreground mt-2 text-xs">{dayjs(props.project.lastOpened).fromNow()}</p>
    </button>
  );
}

interface RecentProjectsListProps {
  projects: RecentProject[];
  onOpen: (project: RecentProject) => void;
  onRemove?: (project: RecentProject) => void;
  class?: string;
}

export function RecentProjectsList(props: RecentProjectsListProps) {
  return (
    <div class={cn("flex flex-col gap-2", props.class)}>
      <For each={props.projects}>
        {project => (
          <RecentProjectCard project={project} onOpen={props.onOpen} onRemove={props.onRemove} />
        )}
      </For>
    </div>
  );
}
