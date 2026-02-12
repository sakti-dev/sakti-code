import type { DiffChange } from "@/core/chat/types";
import { cn } from "@/utils";
import { Component, For, mergeProps, Show } from "solid-js";

interface DiffViewProps {
  /** Diff changes to display */
  changes?: DiffChange[];
  /** Accept change handler */
  onAccept?: (change: DiffChange) => void;
  /** Reject change handler */
  onReject?: (change: DiffChange) => void;
  /** Accept all handler */
  onAcceptAll?: () => void;
  /** Reject all handler */
  onRejectAll?: () => void;
  /** Additional CSS classes */
  class?: string;
}

/**
 * DiffView - Simplified diff viewer with accept/reject actions
 *
 * Design Features:
 * - Green highlights for additions
 * - Red highlights for removals
 * - Yellow for modifications
 * - Per-change accept/reject buttons
 * - Accept all / Reject all actions
 */
export const DiffView: Component<DiffViewProps> = props => {
  const merged = mergeProps(
    {
      changes: [],
    },
    props
  );

  const changeConfig = (change: DiffChange) => {
    switch (change.type) {
      case "addition":
        return {
          bgColor: "bg-green-500/10 dark:bg-green-500/5",
          borderColor: "border-green-500/30",
          textColor: "text-green-700 dark:text-green-400",
          icon: "plus",
          label: "Added",
        };
      case "removal":
        return {
          bgColor: "bg-red-500/10 dark:bg-red-500/5",
          borderColor: "border-red-500/30",
          textColor: "text-red-700 dark:text-red-400",
          icon: "minus",
          label: "Removed",
        };
      case "modification":
        return {
          bgColor: "bg-yellow-500/10 dark:bg-yellow-500/5",
          borderColor: "border-yellow-500/30",
          textColor: "text-yellow-700 dark:text-yellow-400",
          icon: "edit",
          label: "Modified",
        };
      default:
        return {
          bgColor: "bg-muted/20",
          borderColor: "border-border/30",
          textColor: "text-muted-foreground",
          icon: "help",
          label: "Unknown",
        };
    }
  };

  const pendingChanges = () => merged.changes.filter(c => c.status === "pending");

  return (
    <div class={cn("flex h-full flex-col", props.class)}>
      {/* Header with bulk actions */}
      <Show when={pendingChanges().length > 0}>
        <div
          class={cn(
            "flex items-center justify-between px-3 py-2",
            "bg-card/10 border-border/30 border-b"
          )}
        >
          <span class="text-muted-foreground/70 text-xs font-medium">
            {pendingChanges().length} change{pendingChanges().length !== 1 ? "s" : ""} pending
          </span>
          <div class="flex items-center gap-1">
            <button
              onClick={props.onAcceptAll}
              class={cn(
                "rounded px-2 py-1 text-xs",
                "bg-green-500/10 text-green-600 dark:text-green-400",
                "transition-colors duration-150 hover:bg-green-500/20"
              )}
            >
              Accept All
            </button>
            <button
              onClick={props.onRejectAll}
              class={cn(
                "rounded px-2 py-1 text-xs",
                "bg-red-500/10 text-red-600 dark:text-red-400",
                "transition-colors duration-150 hover:bg-red-500/20"
              )}
            >
              Reject All
            </button>
          </div>
        </div>
      </Show>

      {/* Diff list */}
      <div class="scrollbar-thin flex-1 space-y-2 overflow-auto p-2">
        <For each={merged.changes}>
          {change => {
            const config = changeConfig(change);
            const isPending = change.status === "pending";

            return (
              <div
                class={cn(
                  "group rounded-lg border p-3",
                  config.bgColor,
                  config.borderColor,
                  "transition-all duration-200",
                  "hover:shadow-sm",
                  !isPending && "opacity-50"
                )}
              >
                {/* Change header */}
                <div class="mb-2 flex items-start justify-between gap-2">
                  <div class="flex min-w-0 items-center gap-2">
                    {/* Icon */}
                    <span class={cn("text-xs font-medium", config.textColor)}>{config.label}</span>

                    {/* File path */}
                    <span class="text-muted-foreground/60 truncate font-mono text-xs">
                      {change.filePath}:{change.lineNumber}
                    </span>
                  </div>

                  {/* Status */}
                  <Show when={isPending}>
                    <div class="flex items-center gap-1">
                      <button
                        onClick={() => props.onAccept?.(change)}
                        class={cn(
                          "rounded p-1 transition-colors duration-150",
                          "bg-green-500/10 text-green-600 dark:text-green-400",
                          "hover:scale-105 hover:bg-green-500/20"
                        )}
                        title="Accept change"
                      >
                        <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => props.onReject?.(change)}
                        class={cn(
                          "rounded p-1 transition-colors duration-150",
                          "bg-red-500/10 text-red-600 dark:text-red-400",
                          "hover:scale-105 hover:bg-red-500/20"
                        )}
                        title="Reject change"
                      >
                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </div>
                  </Show>

                  <Show when={!isPending}>
                    <span
                      class={cn(
                        "text-xs font-medium",
                        change.status === "accepted"
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      )}
                    >
                      {change.status === "accepted" ? "Accepted" : "Rejected"}
                    </span>
                  </Show>
                </div>

                {/* Diff content */}
                <div class="space-y-1">
                  {/* Old content (for removals/modifications) */}
                  <Show when={change.oldContent}>
                    <div
                      class={cn(
                        "rounded px-2 py-1 font-mono text-xs",
                        "bg-red-500/5 text-red-600 line-through opacity-70 dark:text-red-400"
                      )}
                    >
                      {change.oldContent}
                    </div>
                  </Show>

                  {/* New content (for additions/modifications) */}
                  <Show when={change.newContent}>
                    <div
                      class={cn(
                        "rounded px-2 py-1 font-mono text-xs",
                        change.type === "removal"
                          ? "bg-red-500/5 text-red-600 dark:text-red-400"
                          : "bg-green-500/5 text-green-600 dark:text-green-400"
                      )}
                    >
                      {change.newContent}
                    </div>
                  </Show>
                </div>
              </div>
            );
          }}
        </For>

        {/* Empty state */}
        <Show when={merged.changes.length === 0}>
          <div class="flex h-full flex-col items-center justify-center py-8 text-center">
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
            <p class="text-muted-foreground/50 text-sm">No changes to review</p>
            <p class="text-muted-foreground/30 mt-1 text-xs">
              Changes made by the AI will appear here
            </p>
          </div>
        </Show>
      </div>
    </div>
  );
};
