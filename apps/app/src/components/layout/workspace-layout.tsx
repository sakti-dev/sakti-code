import { createEffect, type JSX, onMount, Show } from "solid-js";
import Home from "~/pages/home";
import { useStore } from "~/stores/store-context";
import { activeTab, filterStaleProjects } from "~/stores/tab-store";
import { sidebarOpen } from "~/stores/ui-signals";
import BannerConnection from "./banners/banner-connection";
import { BannerError, BannerHealth } from "./banners/banner-error";
import BannerUpdate from "./banners/banner-update";
import Sidebar from "./sidebar/sidebar";
import ProjectTabBar from "./tab-bar/project-tab-bar";
import Toolbar from "./toolbar/toolbar";

export default function WorkspaceLayout(): JSX.Element {
  const { server, actions } = useStore();

  // Sync active tab → server store
  createEffect(() => {
    const tab = activeTab();
    if (tab) {
      server.actions.setActiveProject(tab.projectId);
      server.actions.setActiveSession(tab.sessionId);
    }
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
            <Toolbar />
            <div class="relative min-h-0 flex-1">
              <div class="absolute inset-0 flex flex-col overflow-hidden">
                <Show
                  fallback={
                    <Show
                      fallback={<NoProjectSelected />}
                      when={activeProject()}
                    >
                      <NoSessionSelected
                        projectName={activeProject()?.name ?? ""}
                      />
                    </Show>
                  }
                  when={activeSession()}
                >
                  <div class="flex flex-1 items-center justify-center px-4">
                    <div class="w-full max-w-md text-center">
                      <p class="text-muted-foreground text-sm">
                        Chat view coming soon
                      </p>
                    </div>
                  </div>
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
        <p class="text-foreground text-sm">
          Pick a project from the sidebar to start
        </p>
        <p class="mt-1 text-muted-foreground text-xs">
          Or add a new project to begin a session
        </p>
      </div>
    </div>
  );
}

function NoSessionSelected(props: { projectName: string }) {
  return (
    <div class="flex flex-1 flex-col items-center justify-center px-4">
      <div class="w-full max-w-md text-center">
        <div class="mb-3 text-3xl">{"\u{1F967}"}</div>
        <p class="text-muted-foreground text-sm">
          Ready to work on{" "}
          <span class="font-medium text-foreground">{props.projectName}</span>
        </p>
        <p class="mt-1 text-muted-foreground text-xs">
          Create a new session to start chatting
        </p>
      </div>
    </div>
  );
}
