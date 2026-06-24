import { Show } from "solid-js";
import { setSidebarOpen, sidebarOpen } from "~/stores/workspace/ui-signals";
import { SettingsDialog } from "../../settings/settings-dialog";
import ExportButton from "./export-button";
import GitStatusBar from "./git-status-bar";
import { ReplayButton } from "./replay-button";
import SessionStats from "./session-stats";
import ThinkingSelector from "./thinking-selector";

export default function Toolbar() {
  return (
    <div class="flex items-center gap-2 border-border border-b px-4 py-2">
      <button
        class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        onClick={() => setSidebarOpen((prev) => !prev)}
        title={
          sidebarOpen() ? "Hide sidebar (Ctrl+B)" : "Show sidebar (Ctrl+B)"
        }
        type="button"
      >
        <Show
          fallback={
            <svg
              aria-label="Show sidebar"
              class="h-4 w-4"
              fill="currentColor"
              role="img"
              viewBox="0 0 16 16"
              xmlns="http://www.w3.org/2000/svg"
            >
              <title>Show sidebar</title>
              <path
                clip-rule="evenodd"
                d="M2 3.75A.75.75 0 0 1 2.75 3h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 3.75zM2 8a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8zm0 4.25a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75z"
              />
            </svg>
          }
          when={sidebarOpen()}
        >
          <svg
            aria-label="Hide sidebar"
            class="h-4 w-4"
            fill="currentColor"
            role="img"
            viewBox="0 0 16 16"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>Hide sidebar</title>
            <path
              clip-rule="evenodd"
              d="M2 3.75A.75.75 0 0 1 2.75 3h10.5a.75.75 0 0 1 .75.75v8.5a.75.75 0 0 1-.75.75H2.75a.75.75 0 0 1-.75-.75v-8.5zm1.5.75v7h2.5v-7h-2.5zm4 0v7h5v-7h-5z"
            />
          </svg>
        </Show>
      </button>

      <div class="h-5 w-px bg-border" />

      <ThinkingSelector />

      <div class="flex-1" />

      <GitStatusBar />

      <div class="h-5 w-px bg-border" />

      <SessionStats />

      <div class="flex items-center gap-1 border-border border-l pl-2">
        <Show when={import.meta.env.DEV}>
          <ReplayButton />
          <div class="h-5 w-px bg-border" />
        </Show>
        <ExportButton />
        <SettingsDialog />
      </div>
    </div>
  );
}
