import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import { Tooltip } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useStore } from "~/stores/store-context";
import { setSidebarOpen } from "~/stores/ui-signals";

dayjs.extend(relativeTime);

export default function Sidebar() {
  const { server, actions } = useStore();
  const [expandedProjects, setExpandedProjects] = createSignal<Set<string>>(
    new Set()
  );

  onMount(() => {
    actions.loadProjects();
  });

  createEffect(() => {
    const projectId = server.store.activeProjectId;
    if (projectId) {
      actions.loadSessions(projectId);
      setExpandedProjects((prev) => {
        const next = new Set(prev);
        next.add(projectId);
        return next;
      });
    }
  });

  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const selectSession = (sessionId: string, projectId: string) => {
    server.actions.setActiveProject(projectId);
    server.actions.setActiveSession(sessionId);
  };

  const sessionsForProject = (projectId: string) =>
    server.store.sessionOrder
      .map((id) => server.store.sessions[id])
      .filter((s) => s && s.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt);

  const projectCount = () => server.store.projectOrder.length;

  return (
    <aside
      class={cn(
        "flex w-64 shrink-0 flex-col border-border border-r bg-card",
        "transition-all duration-200"
      )}
    >
      {/* Header */}
      <div class="flex h-10 items-center justify-between border-border border-b px-3">
        <span class="font-semibold text-foreground text-sm">sakti-code</span>
        <Tooltip content="Close sidebar">
          <Button
            class="h-6 w-6"
            onClick={() => setSidebarOpen(false)}
            size="icon"
            variant="ghost"
          >
            <svg
              aria-label="Close sidebar"
              class="h-3.5 w-3.5"
              fill="none"
              role="img"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <title>Close sidebar</title>
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Button>
        </Tooltip>
      </div>

      {/* Projects section */}
      <div class="flex items-center justify-between px-3 py-2">
        <span class="font-medium text-muted-foreground text-xs uppercase tracking-wider">
          Projects
        </span>
        <div class="flex items-center gap-0.5">
          <Tooltip content="Refresh">
            <Button
              class="h-6 w-6"
              onClick={() => actions.loadProjects()}
              size="icon"
              variant="ghost"
            >
              <svg
                aria-label="Refresh projects"
                class="h-3.5 w-3.5"
                fill="none"
                role="img"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <title>Refresh projects</title>
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 16h5v5" />
              </svg>
            </Button>
          </Tooltip>
        </div>
      </div>

      <Separator />

      {/* Project tree */}
      <ScrollArea class="flex-1">
        <Show
          fallback={
            <div class="flex flex-col items-center justify-center px-4 py-8 text-center">
              <svg
                aria-label="No projects"
                class="mb-2 h-8 w-8 text-muted-foreground/50"
                fill="none"
                role="img"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <title>No projects</title>
                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
              </svg>
              <span class="text-muted-foreground text-xs">No projects yet</span>
            </div>
          }
          when={projectCount() > 0}
        >
          <For each={server.store.projectOrder}>
            {(projectId) => {
              const project = () => server.store.projects[projectId];
              const sessions = () => sessionsForProject(projectId);
              const isExpanded = () => expandedProjects().has(projectId);
              const isActive = () => server.store.activeProjectId === projectId;

              return (
                <Show when={project()}>
                  <div class="border-border border-b">
                    {/* Project header */}
                    <button
                      class={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                        "hover:bg-secondary/50",
                        isActive() && "bg-secondary/30"
                      )}
                      onClick={() => toggleProject(projectId)}
                      type="button"
                    >
                      <svg
                        aria-label={isExpanded() ? "Collapse" : "Expand"}
                        class={cn(
                          "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                          isExpanded() && "rotate-90"
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
                        <title>{isExpanded() ? "Collapse" : "Expand"}</title>
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
                      <span class="min-w-0 flex-1 truncate font-medium text-foreground text-xs">
                        {project()?.name}
                      </span>
                      <span class="shrink-0 text-[10px] text-muted-foreground">
                        {sessions().length}
                      </span>
                    </button>

                    {/* Sessions list */}
                    <Show when={isExpanded()}>
                      <div class="border-border border-t bg-background/50">
                        <Show
                          fallback={
                            <div class="px-6 py-2 text-muted-foreground text-xs">
                              No sessions
                            </div>
                          }
                          when={sessions().length > 0}
                        >
                          <For each={sessions()}>
                            {(session) => {
                              const isSessionActive = () =>
                                server.store.activeSessionId === session.id;

                              return (
                                <button
                                  class={cn(
                                    "flex w-full items-center gap-2 border-l-2 px-3 py-1.5 text-left text-sm transition-colors",
                                    isSessionActive()
                                      ? "border-l-primary bg-secondary text-foreground"
                                      : "border-l-transparent text-muted-foreground hover:bg-secondary/50"
                                  )}
                                  onClick={() =>
                                    selectSession(session.id, session.projectId)
                                  }
                                  type="button"
                                >
                                  <span class="min-w-0 flex-1 truncate text-xs">
                                    {session.title || "Untitled session"}
                                  </span>
                                  <span class="shrink-0 text-[10px] opacity-60">
                                    {dayjs(session.updatedAt).fromNow()}
                                  </span>
                                </button>
                              );
                            }}
                          </For>
                        </Show>
                      </div>
                    </Show>
                  </div>
                </Show>
              );
            }}
          </For>
        </Show>
      </ScrollArea>

      {/* Footer */}
      <div class="border-border border-t px-3 py-2">
        <span class="text-[10px] text-muted-foreground">v0.1.0</span>
      </div>
    </aside>
  );
}
