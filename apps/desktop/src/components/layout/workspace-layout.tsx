import { createEffect, type JSX, onMount, Show } from "solid-js";
import { MissionChatView } from "~/components/chat-area/mission-chat-view";
import Home from "~/components/home/home";
import { SettingsPage } from "~/components/settings/settings-page";
import { OnboardingPanel } from "~/components/onboarding/onboarding-panel";
import { useStore } from "~/stores/store-context";
import { activeProjectTab, filterStaleProjects } from "~/stores/workspace/project-tab-store";
import { sidebarOpen } from "~/stores/workspace/ui-signals";
import BannerConnection from "./banners/banner-connection";
import { BannerError, BannerHealth } from "./banners/banner-error";
import BannerUpdate from "./banners/banner-update";
import Sidebar from "./sidebar/sidebar";
import Header from "./header/header";

export default function WorkspaceLayout(): JSX.Element {
  const { server, actions } = useStore();

  // Sync active tab → server store
  createEffect(() => {
    const tab = activeProjectTab();
    if (tab) {
      server.actions.setActiveProject(tab.projectId);
      server.actions.setActiveSession(tab.sessionId);
    }
  });

  // Ensure child intakes exist for the active project (list-only; the
  // OnboardingPanel grid creates on demand). Used by the sidebar plus button.
  createEffect(() => {
    const projectId = server.store.activeProjectId;
    if (!projectId) {
      return;
    }
    actions.listChildIntakes(projectId).catch(() => {});
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
    actions.loadProjects().catch(() => {});
  });

  const activeProject = () => {
    const id = server.store.activeProjectId;
    return id ? server.store.projects[id] : undefined;
  };

  const activeSession = () => {
    const id = server.store.activeSessionId;
    return id ? server.store.sessions[id] : undefined;
  };

  const isNewTab = () => activeProjectTab()?.projectId === null;
  const isSettingsTab = () => activeProjectTab()?.page === "settings";

  return (
    <div class="flex h-screen flex-col bg-background text-foreground">
      <Header />
      <div class="flex min-h-0 flex-1">
        <Show when={sidebarOpen() && !isNewTab() && !isSettingsTab()}>
          <Sidebar />
        </Show>
        <main class="flex min-w-0 flex-1 flex-col">
          <Show when={isSettingsTab()}>
            <SettingsPage />
          </Show>
          <Show when={!isSettingsTab()}>
            <Show fallback={<Home />} when={!isNewTab()}>
              <BannerConnection />
              <BannerError />
              <BannerHealth />
              <BannerUpdate />
              <div class="relative min-h-0 flex-1">
                <div class="absolute inset-0 flex flex-col overflow-hidden">
                  <Show
                    fallback={
                      <Show fallback={<NoProjectSelected />} keyed when={activeProject()}>
                        {(project) => <OnboardingPanel projectId={project.id} />}
                      </Show>
                    }
                    when={activeSession()}
                  >
                    {(session) => <MissionChatView sessionId={session().id} />}
                  </Show>
                </div>
              </div>
            </Show>
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
