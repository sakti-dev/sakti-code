import { FaRegularClock } from "solid-icons/fa";
import { For, Show } from "solid-js";
import type { Project, SessionMeta } from "~/stores/server/server-store";

interface ProjectCardProps {
  onOpen: () => void;
  project: Project;
  sessions: SessionMeta[];
}

export function ProjectCard(props: ProjectCardProps) {
  const formatRelativeTime = (timestamp: number): string => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60_000);
    const hours = Math.floor(diff / 3_600_000);
    const days = Math.floor(diff / 86_400_000);

    if (minutes < 1) {
      return "Just now";
    }
    if (minutes < 60) {
      return `${minutes}m ago`;
    }
    if (hours < 24) {
      return `${hours}h ago`;
    }
    return `${days}d ago`;
  };

  const sortedSessions = () => [...props.sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  const latestSessionTime = () => {
    const sessions = sortedSessions();
    const first = sessions[0];
    return first ? first.updatedAt : props.project.updatedAt;
  };

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: Card container is intentionally clickable while preserving nested buttons.
    // biome-ignore lint/a11y/noStaticElementInteractions: Card container handles click and keyboard activation intentionally.
    <div
      class="cursor-pointer rounded-xl border border-border/50 bg-card p-4 transition-colors hover:bg-muted/50"
      onClick={() => props.onOpen()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onOpen();
        }
      }}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Card container is keyboard-navigable for selection.
      tabIndex={0}
    >
      <div class="mb-3 flex items-start justify-between">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <svg
              aria-label="Project"
              class="h-5 w-5 text-primary"
              fill="currentColor"
              role="img"
              viewBox="0 0 16 16"
              xmlns="http://www.w3.org/2000/svg"
            >
              <title>Project</title>
              <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z" />
            </svg>
          </div>
          <div>
            <h3 class="font-semibold text-foreground">{props.project.name}</h3>
            <p class="max-w-[200px] truncate text-muted-foreground text-xs">{props.project.cwd}</p>
          </div>
        </div>
        <span class="text-muted-foreground text-xs">{formatRelativeTime(latestSessionTime())}</span>
      </div>

      <div class="border-border/50 border-t pt-3">
        <Show
          fallback={<p class="py-2 text-muted-foreground text-sm">No sessions yet</p>}
          when={sortedSessions().length > 0}
        >
          <div class="space-y-1.5">
            <For each={sortedSessions()}>
              {(session) => (
                <div class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-foreground text-sm">
                  <span class="text-muted-foreground">
                    <FaRegularClock class="h-4 w-4" />
                  </span>
                  <span class="flex-1 truncate">{session.title ?? "Untitled session"}</span>
                  <span class="text-muted-foreground text-xs">
                    {formatRelativeTime(session.updatedAt)}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
