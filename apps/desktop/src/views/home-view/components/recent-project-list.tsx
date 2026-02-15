import type { RecentProject } from "@/core/chat/types";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

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
    <Card
      variant="interactive"
      class={cn("group w-full p-4 text-left", props.class)}
      onClick={() => props.onOpen(props.project)}
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <h3 class="text-foreground group-hover:text-primary truncate text-sm font-medium transition-colors">
            {props.project.name}
          </h3>
          <p class="text-muted-foreground mt-0.5 truncate text-xs">{props.project.path}</p>
        </div>
        {props.onRemove && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={e => {
              e.stopPropagation();
              props.onRemove?.(props.project);
            }}
            class={cn(
              "opacity-0 group-hover:opacity-100",
              "text-muted-foreground hover:text-destructive"
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
          </Button>
        )}
      </div>
      <p class="text-muted-foreground mt-2 text-xs">{dayjs(props.project.lastOpened).fromNow()}</p>
    </Card>
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
