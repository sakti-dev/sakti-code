import type { FileTab as FileTabType } from "@/core/chat/types";
import { cn } from "@/utils";
import { Component, For, mergeProps, Show } from "solid-js";
import { FileTab } from "./file-tab";

interface FileContextProps {
  /** Open file tabs */
  openFiles?: FileTabType[];
  /** Tab click handler */
  onTabClick?: (tab: FileTabType) => void;
  /** Tab close handler */
  onTabClose?: (tab: FileTabType) => void;
  /** Additional CSS classes */
  class?: string;
}

/**
 * FileContext - Top section of right panel showing open files
 *
 * Design Features:
 * - Tab bar with file list
 * - Active file highlighting
 * - File close buttons
 * - Modified indicators
 */
export const FileContext: Component<FileContextProps> = props => {
  const merged = mergeProps(
    {
      openFiles: [],
    },
    props
  );

  const activeTab = () => merged.openFiles.find(t => t.isActive);

  return (
    <div class={cn("flex h-[60%] flex-col", "border-border/30 border-b", props.class)}>
      {/* Tab bar */}
      <div
        class={cn(
          "flex items-center gap-0.5 px-2 py-1",
          "bg-card/10 border-border/30 border-b",
          "scrollbar-thin overflow-x-auto"
        )}
      >
        {/* Label */}
        <span class="text-muted-foreground/50 flex-shrink-0 px-2 py-1 text-xs font-medium uppercase tracking-wider">
          Files
        </span>

        {/* Divider */}
        <div class="bg-border/30 mx-1 h-4 w-px flex-shrink-0" />

        {/* Tabs */}
        <For each={merged.openFiles}>
          {tab => (
            <FileTab
              tab={tab}
              onClick={() => props.onTabClick?.(tab)}
              onClose={() => props.onTabClose?.(tab)}
            />
          )}
        </For>

        {/* Empty state hint */}
        <Show when={merged.openFiles.length === 0}>
          <span class="text-muted-foreground/40 px-3 py-1 text-xs italic">No files open</span>
        </Show>
      </div>

      {/* File content area (placeholder) */}
      <div class="flex-1 overflow-auto p-4">
        <Show
          when={activeTab()}
          fallback={
            <div class="flex h-full flex-col items-center justify-center text-center">
              <svg
                class="text-muted-foreground/20 mb-3 h-12 w-12"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <p class="text-muted-foreground/50 text-sm">No file selected</p>
              <p class="text-muted-foreground/30 mt-1 text-xs">Open a file to see its contents</p>
            </div>
          }
        >
          {tab => (
            <div class="h-full">
              {/* File header */}
              <div class="border-border/20 mb-3 flex items-center justify-between border-b pb-2">
                <div class="flex items-center gap-2">
                  <svg
                    class="text-primary/60 h-4 w-4"
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
                  <span class="text-foreground/80 text-sm font-medium">{tab().name}</span>
                  <Show when={tab().isModified}>
                    <span class="bg-primary/20 text-primary/70 rounded px-1.5 py-0.5 text-[10px] font-medium">
                      Modified
                    </span>
                  </Show>
                </div>
                <span class="text-muted-foreground/40 font-mono text-xs">{tab().path}</span>
              </div>

              {/* Placeholder content */}
              <div class="text-muted-foreground/30 text-sm italic">
                File content preview will appear here...
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
};
