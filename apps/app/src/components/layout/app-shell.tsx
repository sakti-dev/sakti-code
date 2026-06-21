import { Show } from "solid-js";
import { sidebarOpen } from "~/stores/ui-signals";
import BannerConnection from "./banner-connection";
import { BannerError, BannerHealth } from "./banner-error";
import BannerUpdate from "./banner-update";
import ContentTabBar from "./content-tab-bar";
import Sidebar from "./sidebar";
import Toolbar from "./toolbar";

export default function AppShell() {
  return (
    <div class="flex h-screen bg-background text-foreground">
      <Show when={sidebarOpen()}>
        <Sidebar />
      </Show>
      <div class="flex min-w-0 flex-1 flex-col">
        <BannerConnection />
        <BannerError />
        <BannerHealth />
        <BannerUpdate />
        <main class="flex min-w-0 flex-1 flex-col">
          <Toolbar />
          <ContentTabBar />
          <div class="relative min-h-0 flex-1">
            <div class="absolute inset-0 flex items-center justify-center">
              <span class="text-muted-foreground text-sm">Content area</span>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
