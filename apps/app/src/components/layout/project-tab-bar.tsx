import { FiPlus, FiX } from "solid-icons/fi";
import { For, type JSX, Show } from "solid-js";
import { cn } from "~/lib/utils";
import { useStore } from "~/stores/store-context";
import {
  activeTabIndex,
  closeTab,
  newTab,
  openTabs,
  switchTab,
} from "~/stores/tab-store";

export default function ProjectTabBar(): JSX.Element {
  const { server } = useStore();
  const tabs = openTabs;
  const currentIdx = activeTabIndex;

  const tabLabel = (projectId: string | null): string => {
    if (projectId === null) {
      return "New Workspace";
    }
    return server.store.projects[projectId]?.name ?? "Unknown";
  };

  const handleClose = (e: MouseEvent, index: number): void => {
    e.stopPropagation();
    closeTab(index);
  };

  const handleMiddleClick = (e: MouseEvent, index: number): void => {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(index);
    }
  };

  return (
    <div class="flex h-9 shrink-0 items-center border-border border-b bg-card">
      {/* Tabs — scrollable */}
      <div class="scrollbar-none flex min-w-0 flex-1 items-stretch overflow-x-auto">
        <For each={tabs()}>
          {(tab, index) => {
            const label = () => tabLabel(tab.projectId);
            const isActive = () => index() === currentIdx();
            return (
              <div
                aria-selected={isActive()}
                class={cn(
                  "group relative flex h-9 shrink-0 cursor-pointer items-center gap-1.5 border-border border-r px-3 text-xs transition-colors",
                  isActive()
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
                onClick={() => switchTab(index())}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    switchTab(index());
                  }
                }}
                onPointerDown={(e) => handleMiddleClick(e, index())}
                role="tab"
                tabIndex={0}
              >
                {/* Active indicator bar */}
                <Show when={isActive()}>
                  <span class="absolute top-0 left-0 h-0.5 w-full bg-primary" />
                </Show>

                <span class="max-w-[140px] truncate">{label()}</span>

                {/* Close button */}
                <button
                  aria-label={`Close ${label()} tab`}
                  class="ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-secondary group-hover:opacity-100"
                  onClick={(e) => handleClose(e, index())}
                  tabIndex={-1}
                  type="button"
                >
                  <FiX class="h-3 w-3" />
                </button>
              </div>
            );
          }}
        </For>

        {/* New tab button */}
        <button
          aria-label="New tab"
          class="flex h-9 shrink-0 items-center justify-center px-3 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          onClick={() => newTab()}
          type="button"
        >
          <FiPlus class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
