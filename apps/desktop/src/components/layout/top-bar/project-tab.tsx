import { motion } from "motion-solidjs";
import { FiFolder, FiPlus, FiX } from "solid-icons/fi";
import { For, type JSX, Show } from "solid-js";
import { cn } from "~/lib/utils";
import { useStore } from "~/stores/store-context";
import {
  activeTabIndex,
  closeTab,
  newTab,
  openTabs,
  switchTab,
} from "~/stores/workspace/tab-store";

interface ProjectTabProps {
  projectId: string | null;
  label: string;
  index: number;
  isActive: boolean;
}

function ProjectTab(props: ProjectTabProps): JSX.Element {
  const handleClose = (e: MouseEvent): void => {
    e.stopPropagation();
    closeTab(props.index);
  };

  const handleMiddleClick = (e: MouseEvent): void => {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(props.index);
    }
  };

  return (
    <div
      class={cn(
        "group relative inline-flex h-7 cursor-pointer items-center justify-center whitespace-nowrap px-3 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        props.isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      onClick={() => switchTab(props.index)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          switchTab(props.index);
        }
      }}
      onPointerDown={(e) => handleMiddleClick(e)}
      role="tab"
      tabIndex={0}
    >
      <Show when={props.isActive}>
        <motion.div
          class="absolute inset-0 bg-background shadow-sm"
          layoutId="active-tab-bg"
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
        >
          <div class="tab-glow" />
        </motion.div>
      </Show>
      <span class="relative z-10 flex items-center gap-1.5">
        <FiFolder class="h-3 w-3 shrink-0 opacity-70" />
        <span class="max-w-[140px] truncate">{props.label}</span>
        <button
          aria-label={`Close ${props.label} tab`}
          class={cn(
            "ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded transition-opacity",
            props.isActive
              ? "opacity-60 hover:bg-secondary hover:opacity-100"
              : "opacity-0 hover:bg-secondary group-hover:opacity-60",
          )}
          onClick={(e) => handleClose(e)}
          tabIndex={-1}
          type="button"
        >
          <FiX class="h-3 w-3" />
        </button>
      </span>
    </div>
  );
}

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

  return (
    <div class="flex h-9 items-center">
      <div class="flex border border-border rounded-md overflow-hidden">
        <For each={tabs()}>
          {(tab, index) => (
            <ProjectTab
              projectId={tab.projectId}
              label={tabLabel(tab.projectId)}
              index={index()}
              isActive={index() === currentIdx()}
            />
          )}
        </For>
      </div>
      <button
        aria-label="New workspace"
        class="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        onClick={() => newTab()}
        type="button"
      >
        <FiPlus class="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
