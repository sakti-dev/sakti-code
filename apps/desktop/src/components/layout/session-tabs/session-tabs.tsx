import { motion } from "motion-solidjs";
import { FiHome, FiMessageSquare, FiX } from "solid-icons/fi";
import { For, type JSX, Show } from "solid-js";
import { cn } from "~/lib/utils";
import {
  closeSessionTab,
  ensureProjectTabs,
  getActiveSessionIndex,
  getSessionTabs,
  switchSessionTab,
  type SessionTabKind,
} from "~/stores/workspace/session-tab-store";
import "./session-tabs.css";

interface SessionTabsProps {
  projectId: string;
}

function tabLabel(kind: SessionTabKind): string {
  switch (kind) {
    case "home":
      return "Home";
    case "plan":
      return "Plan";
    case "mission":
      return "Mission";
  }
}

function TabIcon(props: { kind: SessionTabKind }): JSX.Element {
  switch (props.kind) {
    case "home":
      return <FiHome class="h-3 w-3 shrink-0 opacity-70" />;
    case "plan":
    case "mission":
      return <FiMessageSquare class="h-3 w-3 shrink-0 opacity-70" />;
  }
}

export default function SessionTabs(props: SessionTabsProps): JSX.Element {
  ensureProjectTabs(props.projectId);
  const tabs = () => getSessionTabs(props.projectId);
  const activeIdx = () => getActiveSessionIndex(props.projectId);

  return (
    <div class="relative z-0 flex h-10 shrink-0 items-end overflow-hidden bg-card">
      <div class="scrollbar-none flex min-w-0 flex-1 items-stretch">
        <For each={tabs()}>
          {(tab, index) => {
            const isActive = () => index() === activeIdx();
            return (
              <div
                aria-selected={isActive()}
                class={cn(
                  "session-tab group flex h-8 shrink-0 cursor-pointer items-center px-3 text-xs transition-colors",
                  isActive()
                    ? "z-10 text-foreground"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
                onClick={() => switchSessionTab(props.projectId, index())}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    switchSessionTab(props.projectId, index());
                  }
                }}
                onPointerDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    if (tab.kind !== "home") closeSessionTab(props.projectId, index());
                  }
                }}
                role="tab"
                tabIndex={0}
              >
                <Show when={isActive()}>
                  <motion.div
                    class="session-tab-active-layer"
                    layoutId={`session-tab-active-${props.projectId}`}
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  >
                    <div class="session-tab-glow" />
                  </motion.div>
                </Show>

                <div class="relative flex items-center gap-1.5">
                  <TabIcon kind={tab.kind} />
                  <span class="max-w-[140px] truncate">{tabLabel(tab.kind)}</span>

                  <Show when={tab.kind !== "home"}>
                    <button
                      aria-label={`Close ${tabLabel(tab.kind)} tab`}
                      class={cn(
                        "ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded transition-opacity",
                        isActive()
                          ? "opacity-60 hover:bg-secondary hover:opacity-100"
                          : "opacity-0 hover:bg-secondary group-hover:opacity-60",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        closeSessionTab(props.projectId, index());
                      }}
                      tabIndex={-1}
                      type="button"
                    >
                      <FiX class="h-3 w-3" />
                    </button>
                  </Show>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
