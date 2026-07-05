import { createEffect, type JSX, onMount, Show } from "solid-js";
import { MissionChatView } from "~/components/chat-area/mission-chat-view";
import Home from "~/components/home/home";
import { PlanChat } from "~/components/onboarding/plan-chat";
import { PlanGrid } from "~/components/onboarding/plan-grid";
import { SettingsPage } from "~/components/settings/settings-page";
import { useStore } from "~/stores/store-context";
import { activeProjectTab, filterStaleProjects } from "~/stores/workspace/project-tab-store";
import {
  ensureProjectTabs,
  filterStaleSessions,
  getActiveSessionTab,
} from "~/stores/workspace/session-tab-store";
import BannerConnection from "./banners/banner-connection";
import { BannerError, BannerHealth } from "./banners/banner-error";
import BannerUpdate from "./banners/banner-update";
import Header from "./header/header";
import SessionTabs from "./session-tabs/session-tabs";
import Sidebar from "./sidebar/sidebar";

export default function WorkspaceLayout(): JSX.Element {
  const { server, actions } = useStore();

  const activeProjectId = () => activeProjectTab()?.projectId ?? null;
  const isSettings = () => activeProjectTab()?.page === "settings";
  const isProject = () => activeProjectId() !== null;

  createEffect(() => {
    const pid = activeProjectId();
    if (pid) {
      ensureProjectTabs(pid);
      actions.listChildPlans(pid).catch(() => {});
    }
  });

  createEffect(() => {
    const pid = activeProjectId();
    if (!pid) {
      server.actions.setActiveSession(null);
      return;
    }
    server.actions.setActiveProject(pid);
    const innerTab = getActiveSessionTab(pid);
    server.actions.setActiveSession(innerTab?.sessionId ?? null);
  });

  createEffect(() => {
    const projectOrder = server.store.projectOrder;
    if (projectOrder.length > 0) {
      filterStaleProjects(new Set(projectOrder));
    }
  });

  createEffect(() => {
    const pid = activeProjectId();
    if (!pid) return;
    const validIds = new Set(
      server.store.sessionOrder
        .map((id) => server.store.sessions[id])
        .filter((s) => !!s && s.projectId === pid)
        .map((s) => s!.id),
    );
    filterStaleSessions(pid, validIds);
  });

  onMount(() => {
    actions.loadProjects().catch(() => {});
  });

  const activeInnerTab = () => {
    const pid = activeProjectId();
    if (!pid) return null;
    return getActiveSessionTab(pid);
  };

  const activeSessionId = () => activeInnerTab()?.sessionId ?? null;

  return (
    <div class="flex h-screen flex-col bg-background text-foreground">
      <Header />
      <div class="flex min-h-0 flex-1">
        <Show when={isProject() && !isSettings()}>
          <Sidebar />
        </Show>
        <main class="flex min-w-0 flex-1 flex-col">
          <Show when={isSettings()}>
            <SettingsPage />
          </Show>
          <Show when={!isProject() && !isSettings()}>
            <Home />
          </Show>
          <Show when={isProject() && !isSettings()}>
            <SessionTabs projectId={activeProjectId()!} />
            <BannerConnection />
            <BannerError />
            <BannerHealth />
            <BannerUpdate />
            <div class="relative min-h-0 flex-1">
              <div class="absolute inset-0 flex flex-col overflow-hidden">
                <Show when={activeInnerTab()?.kind === "home"}>
                  <PlanGrid projectId={activeProjectId()!} />
                </Show>
                <Show when={activeInnerTab()?.kind === "plan"}>
                  <PlanChat projectId={activeProjectId()!} sessionId={activeSessionId()} />
                </Show>
                <Show when={activeInnerTab()?.kind === "mission"}>
                  <MissionChatView sessionId={activeSessionId()!} />
                </Show>
              </div>
            </div>
          </Show>
        </main>
      </div>
    </div>
  );
}
