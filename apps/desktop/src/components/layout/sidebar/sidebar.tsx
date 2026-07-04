import { createMemo, For, onCleanup, onMount, type JSX, Show } from "solid-js";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import { Tooltip } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useStore } from "~/stores/store-context";
import { activeProjectTab } from "~/stores/workspace/project-tab-store";
import {
  getActiveSessionTab,
  openDraftIntakeTab,
  openSessionTab,
} from "~/stores/workspace/session-tab-store";
import { setSidebarOpen, sidebarOpen } from "~/stores/workspace/ui-signals";
import { ArchivedAccordion, type ArchivedMission } from "./archived-accordion.tsx";
import { MissionRow, type StreamPhase } from "./mission-row.tsx";

export default function Sidebar(): JSX.Element {
  const { server, actions, sessions } = useStore();

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
  });
  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "b" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setSidebarOpen((prev) => !prev);
    }
  };

  const activeProjectId = () => activeProjectTab()?.projectId ?? null;

  const missions = createMemo(() => {
    const pid = activeProjectId();
    if (!pid) return [];
    return server.store.sessionOrder
      .map((id) => server.store.sessions[id])
      .filter((s): s is NonNullable<typeof s> => !!s && s.projectId === pid && s.kind === "mission")
      .sort((a, b) => b.updatedAt - a.updatedAt);
  });

  const activeMissions = createMemo(() => missions().filter((m) => m.status !== "merged"));
  const archivedMissions = createMemo<ArchivedMission[]>(() =>
    missions()
      .filter((m) => m.status === "merged")
      .map((m) => ({
        id: m.id,
        title: m.title,
        updatedAt: m.updatedAt,
        streamPhase: phaseOf(m.id),
      })),
  );

  const phaseOf = (sessionId: string): StreamPhase => {
    const reg = sessions.get(sessionId);
    return (reg?.store.streaming.phase ?? "idle") as StreamPhase;
  };

  const activeSessionId = () => {
    const pid = activeProjectId();
    if (!pid) return null;
    return getActiveSessionTab(pid)?.sessionId ?? null;
  };

  const selectSession = (sessionId: string) => {
    const pid = activeProjectId();
    if (pid) openSessionTab(pid, sessionId, "mission");
  };

  const handleRename = (sessionId: string, title: string) => {
    void actions.renameSession(sessionId, title);
  };

  const handleDelete = (sessionId: string) => {
    const meta = server.store.sessions[sessionId];
    const label = meta?.title || "this mission";
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) {
      return;
    }
    void actions.deleteSession(sessionId);
  };

  const handleNewMission = () => {
    const pid = activeProjectId();
    if (!pid) return;
    openDraftIntakeTab(pid);
  };

  return (
    <>
      <Show when={sidebarOpen()}>
        <button
          aria-label="Close sidebar"
          class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSidebarOpen(false);
          }}
          tabIndex={-1}
          type="button"
        />
      </Show>

      <aside
        class={cn(
          "flex w-64 shrink-0 flex-col border-border border-r bg-card",
          "fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-in-out",
          "md:relative md:z-auto md:transition-none",
          sidebarOpen() ? "translate-x-0" : "-translate-x-full md:hidden",
        )}
      >
        <div class="flex h-10 items-center justify-between px-3">
          <span class="font-medium text-muted-foreground text-xs uppercase tracking-wider">
            Missions
          </span>
          <div class="flex items-center gap-0.5">
            <Tooltip content="New mission">
              <button
                class="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                disabled={!activeProjectId()}
                onClick={handleNewMission}
                type="button"
              >
                <svg
                  aria-label="New mission"
                  class="h-3.5 w-3.5"
                  fill="currentColor"
                  role="img"
                  viewBox="0 0 16 16"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <title>New mission</title>
                  <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z" />
                </svg>
              </button>
            </Tooltip>
            <Tooltip content="Close sidebar">
              <button
                class="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground md:hidden"
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
        </div>

        <Separator />

        <ScrollArea class="flex-1">
          <Show
            fallback={
              <div class="px-3 py-8 text-center text-muted-foreground text-xs">
                {activeProjectId() ? "No missions yet" : "Select a project"}
              </div>
            }
            when={activeMissions().length > 0}
          >
            <For each={activeMissions()}>
              {(m) => (
                <MissionRow
                  isActive={activeSessionId() === m.id}
                  status={m.status}
                  streamPhase={phaseOf(m.id)}
                  title={m.title}
                  updatedAt={m.updatedAt}
                  onClick={() => selectSession(m.id)}
                  onRename={(title) => handleRename(m.id, title)}
                  onDelete={() => handleDelete(m.id)}
                />
              )}
            </For>
          </Show>

          <Show when={archivedMissions().length > 0}>
            <ArchivedAccordion
              missions={archivedMissions()}
              activeId={activeSessionId()}
              onSelect={selectSession}
            />
          </Show>
        </ScrollArea>

        <div class="border-border border-t px-3 py-2">
          <span class="text-[10px] text-muted-foreground">v0.1.0</span>
        </div>
      </aside>
    </>
  );
}
