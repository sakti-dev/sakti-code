import type { AgentHarnessEvent } from "@sakti-code/agent";
import { createEffect, createSignal, type JSX, onMount, Show } from "solid-js";
import { TaskChatView } from "~/components/chat-area/task-chat-view";
import Home from "~/components/home/home";
import { DevToolbar } from "~/components/layout/dev-toolbar";
import { OnboardingPanel } from "~/components/onboarding/onboarding-panel";
import { dispatchEvent } from "~/stores/session/event-reducer";
import { createTokenBatcher } from "~/stores/session/token-batcher";
import { useStore } from "~/stores/store-context";
import { activeTab, filterStaleProjects } from "~/stores/workspace/tab-store";
import { replayState, setActiveIntakeSessionId, sidebarOpen } from "~/stores/workspace/ui-signals";
import BannerConnection from "./banners/banner-connection";
import { BannerError, BannerHealth } from "./banners/banner-error";
import BannerUpdate from "./banners/banner-update";
import Sidebar from "./sidebar/sidebar";
import ProjectTabBar from "./tab-bar/project-tab-bar";

// Dev-only no-op batcher for retry simulator events (no text tokens to flush).
const devBatcher = createTokenBatcher(
  () => {
    /* no-op */
  },
  { batch: false },
);

export default function WorkspaceLayout(): JSX.Element {
  const { server, actions, sessions } = useStore();

  // Sync active tab → server store
  createEffect(() => {
    const tab = activeTab();
    if (tab) {
      server.actions.setActiveProject(tab.projectId);
      server.actions.setActiveSession(tab.sessionId);
    }
  });

  // Upsert intake session when a project becomes active
  const [intakeSessionId, setIntakeSessionId] = createSignal<string | null>(null);
  createEffect(() => {
    const projectId = server.store.activeProjectId;
    if (!projectId) {
      setIntakeSessionId(null);
      setActiveIntakeSessionId(null);
      return;
    }
    actions.upsertIntakeSession(projectId).then((session) => {
      if (session && server.store.activeProjectId === projectId) {
        setIntakeSessionId(session.id);
        setActiveIntakeSessionId(session.id);
      }
    });
  });

  // Load projects on mount, then filter stale tab entries
  createEffect(() => {
    const projectOrder = server.store.projectOrder;
    if (projectOrder.length > 0) {
      const validIds = new Set(projectOrder);
      filterStaleProjects(validIds);
    }
  });

  // Load projects on mount
  onMount(() => {
    actions.loadProjects();
  });

  const activeProject = () => {
    const id = server.store.activeProjectId;
    return id ? server.store.projects[id] : undefined;
  };

  const activeSession = () => {
    const id = server.store.activeSessionId;
    return id ? server.store.sessions[id] : undefined;
  };

  const isNewTab = () => activeTab()?.projectId === null;

  const currentSessionId = () => activeSession()?.id ?? intakeSessionId();

  return (
    <div class="flex h-screen flex-col bg-background text-foreground">
      <ProjectTabBar />
      <div class="flex min-h-0 flex-1">
        <Show when={sidebarOpen() && !isNewTab()}>
          <Sidebar />
        </Show>
        <main class="flex min-w-0 flex-1 flex-col">
          <Show fallback={<Home />} when={!isNewTab()}>
            <BannerConnection />
            <BannerError />
            <BannerHealth />
            <BannerUpdate />
            {import.meta.env.DEV && (
              <DevToolbar
                onReplayPause={() => actions.replayPause(currentSessionId() ?? "")}
                onReplayReset={() => actions.replayReset(currentSessionId() ?? "")}
                onReplayResume={() => actions.replayResume(currentSessionId() ?? "")}
                onReplayStart={() => actions.replayStart(currentSessionId() ?? "")}
                onRetryEvent={(event: AgentHarnessEvent) => {
                  const sId = currentSessionId();
                  if (sId) {
                    const session = sessions.get(sId);
                    dispatchEvent(session.actions, devBatcher, event);
                  }
                }}
                replayState={replayState}
              />
            )}
            <div class="relative min-h-0 flex-1">
              <div class="absolute inset-0 flex flex-col overflow-hidden">
                <Show
                  fallback={
                    <Show fallback={<NoProjectSelected />} keyed when={activeProject()}>
                      {(project) => (
                        <OnboardingPanel
                          intakeSessionId={intakeSessionId()}
                          projectId={project.id}
                        />
                      )}
                    </Show>
                  }
                  when={activeSession()}
                >
                  {(session) => <TaskChatView sessionId={session().id} />}
                </Show>
              </div>
            </div>
          </Show>
        </main>
      </div>
    </div>
  );
}

function NoProjectSelected() {
  return (
    <div class="flex flex-1 flex-col items-center justify-center px-4">
      <div class="w-full max-w-md text-center">
        <div class="mb-3 text-3xl">{"\u{1F967}"}</div>
        <p class="text-foreground text-sm">Pick a project from the sidebar to start</p>
        <p class="mt-1 text-muted-foreground text-xs">Or add a new project to begin a session</p>
      </div>
    </div>
  );
}
