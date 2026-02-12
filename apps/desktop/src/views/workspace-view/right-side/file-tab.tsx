import type { FileTab as FileTabType } from "@/core/chat/types";
import { cn } from "@/utils";
import { Component, mergeProps, Show } from "solid-js";

interface FileTabProps {
  /** File tab data */
  tab: FileTabType;
  /** Click handler */
  onClick?: () => void;
  /** Close handler */
  onClose?: () => void;
  /** Additional CSS classes */
  class?: string;
}

/**
 * FileTab - Individual file tab in the context panel
 *
 * Design Features:
 * - Active state with bottom border
 * - Modified indicator (dot)
 * - Close button on hover
 * - Hover background transition
 */
export const FileTab: Component<FileTabProps> = props => {
  const merged = mergeProps({}, props);

  return (
    <button
      onClick={props.onClick}
      class={cn(
        "group relative flex items-center gap-2 px-3 py-2 text-sm",
        "transition-all duration-150",
        // Active vs inactive
        props.tab.isActive
          ? ["text-foreground font-medium", "bg-card/40 border-primary border-b-2"]
          : [
              "text-muted-foreground hover:text-foreground",
              "hover:bg-card/30 border-b-2 border-transparent",
            ],
        merged.class
      )}
    >
      {/* File icon based on extension */}
      <svg
        class={cn(
          "h-4 w-4 flex-shrink-0",
          props.tab.isActive ? "text-primary" : "text-muted-foreground/50"
        )}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>

      {/* File name */}
      <span class="max-w-[120px] truncate">{props.tab.name}</span>

      {/* Modified indicator */}
      <Show when={props.tab.isModified}>
        <span
          class={cn(
            "h-1.5 w-1.5 rounded-full",
            props.tab.isActive ? "bg-primary" : "bg-muted-foreground/40"
          )}
        />
      </Show>

      {/* Close button */}
      <Show when={props.onClose}>
        <button
          onClick={e => {
            e.stopPropagation();
            props.onClose?.();
          }}
          class={cn(
            "rounded p-0.5 transition-all duration-150",
            "opacity-0 group-hover:opacity-100",
            "hover:bg-card/50",
            props.tab.isActive ? "hover:text-foreground" : "hover:text-foreground/80"
          )}
        >
          <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </Show>
    </button>
  );
};

interface FileTabListProps {
  /** All file tabs */
  tabs: FileTabType[];
  /** Tab click handler */
  onTabClick?: (tab: FileTabType) => void;
  /** Tab close handler */
  onTabClose?: (tab: FileTabType) => void;
  /** Additional CSS classes */
  class?: string;
}

/**
 * FileTabList - Horizontal list of file tabs
 */
export const FileTabList: Component<FileTabListProps> = props => {
  return (
    <div
      class={cn(
        "border-border/30 flex items-center gap-0.5 border-b",
        "bg-card/10 scrollbar-thin overflow-x-auto",
        props.class
      )}
    >
      {/* "Open Files" label */}
      <span class="text-muted-foreground/50 px-3 py-2 text-xs font-medium uppercase tracking-wider">
        Open Files
      </span>

      {/* Tabs */}
      <div class="flex items-center gap-0.5">
        {/* Tab divider */}
        <div class="bg-border/30 mx-1 h-4 w-px" />

        {/* Show first few tabs, add "+" button for more */}
        {/* TODO: Implement overflow handling with dropdown */}
        {/* For now, show all tabs */}
      </div>
    </div>
  );
};
