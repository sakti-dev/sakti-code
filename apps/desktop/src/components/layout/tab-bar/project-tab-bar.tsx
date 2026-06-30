import { motion } from "motion-solidjs";
import { FiFolder, FiPlus, FiX } from "solid-icons/fi";
import { For, type JSX, Show } from "solid-js";
import "./project-tab-bar.css";
import { cn } from "~/lib/utils";
import { useStore } from "~/stores/store-context";
import {
  activeTabIndex,
  closeTab,
  newTab,
  openTabs,
  switchTab,
} from "~/stores/workspace/tab-store";

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
    <div class="relative z-0 flex h-10 shrink-0 items-end bg-card pt-1.5">
      {/* Tabs */}
      <div class="scrollbar-none flex min-w-0 flex-1 items-stretch">
        <For each={tabs()}>
          {(tab, index) => {
            const label = () => tabLabel(tab.projectId);
            const isActive = () => index() === currentIdx();
            return (
              <div
                aria-selected={isActive()}
                class={cn(
                  "chrome-tab group flex h-8 shrink-0 cursor-pointer items-center px-3 text-xs transition-colors",
                  isActive()
                    ? "z-10 text-foreground"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
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
                {/*
                  Active background layer — slides between tabs.
                  motion-solidjs `layoutId` captures this element's box
                  and animates it from the previously-active tab to this
                  one. The chrome curves + aurora glow live inside so
                  they travel as a unit.
                */}
                <Show when={isActive()}>
                  <motion.div
                    class="chrome-tab-active-layer"
                    layoutId="chrome-tab-active"
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  >
                    <div class="chrome-tab-glow" />
                  </motion.div>
                </Show>

                {/* Content */}
                <div class="relative flex items-center gap-1.5">
                  <FiFolder class="h-3 w-3 shrink-0 opacity-70" />
                  <span class="max-w-[140px] truncate">{label()}</span>

                  {/* Close button */}
                  <button
                    aria-label={`Close ${label()} tab`}
                    class={cn(
                      "ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded transition-opacity",
                      isActive()
                        ? "opacity-60 hover:bg-secondary hover:opacity-100"
                        : "opacity-0 hover:bg-secondary group-hover:opacity-60",
                    )}
                    onClick={(e) => handleClose(e, index())}
                    tabIndex={-1}
                    type="button"
                  >
                    <FiX class="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          }}
        </For>

        {/* New tab button */}
        <button
          aria-label="New workspace"
          class="mb-px ml-1 flex h-7 w-7 shrink-0 items-center justify-center self-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          onClick={() => newTab()}
          type="button"
        >
          <FiPlus class="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Bottom separator line — active tab covers it */}
      <div class="pointer-events-none absolute right-0 bottom-0 left-0 h-px bg-border" />
    </div>
  );
}
