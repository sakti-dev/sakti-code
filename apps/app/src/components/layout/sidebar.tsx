import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import { Tooltip } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useStore } from "~/stores/store-context";
import { setSidebarOpen, sidebarOpen } from "~/stores/ui-signals";
import { AddProjectInput } from "./add-project-input.tsx";
import { ProjectContextMenu } from "./project-context-menu.tsx";
import { ProjectGroup } from "./project-group.tsx";

export default function Sidebar() {
  const { server, actions } = useStore();
  const [expandedProjects, setExpandedProjects] = createSignal<Set<string>>(
    new Set()
  );
  const [showAddInput, setShowAddInput] = createSignal(false);
  const [contextMenu, setContextMenu] = createSignal<{
    projectId: string;
    x: number;
    y: number;
  } | null>(null);

  onMount(() => {
    actions.loadProjects();
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
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

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "b" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setSidebarOpen((prev) => !prev);
    }
  };

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

  const selectSession = (sessionId: string) => {
    const session = server.store.sessions[sessionId];
    if (session) {
      server.actions.setActiveProject(session.projectId);
      server.actions.setActiveSession(sessionId);
    }
  };

  const handleNewSession = async (projectId: string) => {
    server.actions.setActiveProject(projectId);
    await actions.createSession(projectId, "default");
  };

  const handleRemoveProject = (projectId: string) => {
    server.actions.removeProject(projectId);
  };

  const handleContextMenu = (projectId: string, e: MouseEvent) => {
    e.preventDefault();
    setContextMenu({ projectId, x: e.clientX, y: e.clientY });
  };

  const handleOpenInTerminal = (projectId: string) => {
    const project = server.store.projects[projectId];
    if (project) {
      // TODO: Wire to terminal store
      console.log("Open in terminal:", project.cwd);
    }
  };

  const handleOpenInEditor = (projectId: string) => {
    const project = server.store.projects[projectId];
    if (project) {
      // TODO: Wire to native API
      console.log("Open in editor:", project.cwd);
    }
  };

  const handleCopyPath = (projectId: string) => {
    const project = server.store.projects[projectId];
    if (project) {
      navigator.clipboard.writeText(project.cwd);
    }
  };

  const sessionsForProject = (projectId: string) =>
    server.store.sessionOrder
      .map((id) => server.store.sessions[id])
      .filter(
        (s): s is NonNullable<typeof s> => !!s && s.projectId === projectId
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);

  const projectCount = () => server.store.projectOrder.length;

  return (
    <>
      {/* Mobile backdrop */}
      <Show when={sidebarOpen()}>
        <button
          aria-label="Close sidebar"
          class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSidebarOpen(false);
            }
          }}
          tabIndex={-1}
          type="button"
        />
      </Show>

      {/* Sidebar panel */}
      <aside
        class={cn(
          "flex w-64 shrink-0 flex-col border-border border-r bg-card",
          "fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-in-out",
          "md:relative md:z-auto md:transition-none",
          sidebarOpen() ? "translate-x-0" : "-translate-x-full md:hidden"
        )}
      >
        {/* Header */}
        <div class="flex h-10 items-center justify-between border-border border-b px-3">
          <span class="font-semibold text-foreground text-sm">sakti-code</span>
          <Tooltip content="Close sidebar">
            <button
              class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:hidden"
              onClick={() => setSidebarOpen(false)}
              type="button"
            >
              <svg
                aria-label="Close sidebar"
                class="h-3.5 w-3.5"
                fill="currentColor"
                role="img"
                viewBox="0 0 16 16"
                xmlns="http://www.w3.org/2000/svg"
              >
                <title>Close sidebar</title>
                <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22z" />
              </svg>
            </button>
          </Tooltip>
        </div>

        {/* Projects section */}
        <div class="flex items-center justify-between px-3 py-2">
          <span class="font-medium text-muted-foreground text-xs uppercase tracking-wider">
            Projects
          </span>
          <div class="flex items-center gap-0.5">
            <Tooltip content="Add project">
              <button
                class="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setShowAddInput(true)}
                type="button"
              >
                <svg
                  aria-label="Add project"
                  class="h-3.5 w-3.5"
                  fill="currentColor"
                  role="img"
                  viewBox="0 0 16 16"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <title>Add project</title>
                  <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z" />
                </svg>
              </button>
            </Tooltip>
            <Tooltip content="Refresh">
              <button
                class="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => actions.loadProjects()}
                type="button"
              >
                <svg
                  aria-label="Refresh projects"
                  class="h-3.5 w-3.5"
                  fill="currentColor"
                  role="img"
                  viewBox="0 0 16 16"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <title>Refresh projects</title>
                  <path
                    clipRule="evenodd"
                    d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37A5.508 5.508 0 0 0 8 3.5a5.5 5.5 0 1 0 5.215 3.772.75.75 0 1 1 1.423-.474A7 7 0 1 1 12.12 3.16l1.716.005z"
                    fillRule="evenodd"
                  />
                </svg>
              </button>
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
                <span class="text-muted-foreground text-xs">
                  No projects yet
                </span>
              </div>
            }
            when={projectCount() > 0}
          >
            <For each={server.store.projectOrder}>
              {(projectId) => {
                const project = () => server.store.projects[projectId];
                const sessions = () => sessionsForProject(projectId);
                const isExpanded = () => expandedProjects().has(projectId);
                const isActive = () =>
                  server.store.activeProjectId === projectId;

                return (
                  <Show when={project()}>
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: context menu requires div */}
                    {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: context menu requires div */}
                    <div onContextMenu={(e) => handleContextMenu(projectId, e)}>
                      <ProjectGroup
                        isActive={isActive()}
                        isExpanded={isExpanded()}
                        name={project()?.name ?? "Unknown"}
                        onNewSession={handleNewSession}
                        onRemove={handleRemoveProject}
                        onSelectSession={selectSession}
                        onToggle={toggleProject}
                        projectId={projectId}
                        sessions={sessions()}
                      />
                    </div>
                  </Show>
                );
              }}
            </For>
          </Show>

          {/* Add project input */}
          <Show when={showAddInput()}>
            <AddProjectInput
              onAdd={(cwd) => {
                setShowAddInput(false);
                // TODO: Wire to API
                console.log("Add project:", cwd);
              }}
              onCancel={() => setShowAddInput(false)}
            />
          </Show>
        </ScrollArea>

        {/* Footer */}
        <div class="border-border border-t px-3 py-2">
          <span class="text-[10px] text-muted-foreground">v0.1.0</span>
        </div>
      </aside>

      {/* Context menu */}
      <Show when={contextMenu()}>
        <ProjectContextMenu
          onClose={() => setContextMenu(null)}
          onCopyPath={handleCopyPath}
          onOpenInEditor={handleOpenInEditor}
          onOpenInTerminal={handleOpenInTerminal}
          onRemove={(id) => {
            handleRemoveProject(id);
            setContextMenu(null);
          }}
          projectId={contextMenu()?.projectId ?? ""}
          projectName={
            server.store.projects[contextMenu()?.projectId ?? ""]?.name ?? ""
          }
          x={contextMenu()?.x ?? 0}
          y={contextMenu()?.y ?? 0}
        />
      </Show>
    </>
  );
}
