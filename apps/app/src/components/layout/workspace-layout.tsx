import { useNavigate } from "@solidjs/router";
import { createEffect, Show } from "solid-js";
import { useStore } from "~/stores/store-context";
import { sidebarOpen } from "~/stores/ui-signals";
import BannerConnection from "./banner-connection";
import { BannerError, BannerHealth } from "./banner-error";
import BannerUpdate from "./banner-update";
import ContentTabBar from "./content-tab-bar";
import Sidebar from "./sidebar";
import Toolbar from "./toolbar";

export default function WorkspaceLayout() {
  const { server } = useStore();
  const navigate = useNavigate();

  createEffect(() => {
    if (!server.store.activeProjectId) {
      navigate("/");
    }
  });

  const activeProject = () => {
    const id = server.store.activeProjectId;
    return id ? server.store.projects[id] : undefined;
  };

  const activeSession = () => {
    const id = server.store.activeSessionId;
    return id ? server.store.sessions[id] : undefined;
  };

  return (
    <div class="flex h-screen bg-background text-foreground">
      <Show when={sidebarOpen()}>
        <Sidebar />
      </Show>
      <div class="flex min-w-0 flex-1">
        <main class="flex min-w-0 flex-1 flex-col">
          <BannerConnection />
          <BannerError />
          <BannerHealth />
          <BannerUpdate />
          <Toolbar />
          <ContentTabBar />
          <div class="relative min-h-0 flex-1">
            <div class="absolute inset-0 flex flex-col overflow-hidden">
              <Show
                fallback={
                  <Show fallback={<NoProjectSelected />} when={activeProject()}>
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
