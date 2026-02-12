import type { DiffChange, FileTab as FileTabType, TerminalOutput } from "@/core/chat/types";
import { cn } from "@/utils";
import Resizable from "@corvu/resizable";
import { Accessor, Component, mergeProps, Show } from "solid-js";
import { DiffView } from "./diff-view";
import { FileContext } from "./file-context";
import { TerminalPanel } from "./terminal-panel";

interface ContextPanelProps {
  /** Open file tabs */
  openFiles?: FileTabType[];
  /** Diff changes */
  diffChanges?: DiffChange[];
  /** Terminal output */
  terminalOutput?: TerminalOutput[];
  /** Active tab type (files/diff) - as signal or value */
  activeTopTab?: Accessor<"files" | "diff"> | "files" | "diff";
  /** On active top tab change */
  onActiveTopTabChange?: (tab: "files" | "diff") => void;
  /** Tab click handler */
  onTabClick?: (tab: FileTabType) => void;
  /** Tab close handler */
  onTabClose?: (tab: FileTabType) => void;
  /** Accept diff change */
  onAcceptDiff?: (change: DiffChange) => void;
  /** Reject diff change */
  onRejectDiff?: (change: DiffChange) => void;
  /** Accept all diffs */
  onAcceptAllDiffs?: () => void;
  /** Reject all diffs */
  onRejectAllDiffs?: () => void;
  /** Clear terminal */
  onClearTerminal?: () => void;
  /** Additional CSS classes */
  class?: string;
}

/**
 * ContextPanel - Right panel split vertically into FileContext (top) and TerminalPanel (bottom)
 *
 * Design Features:
 * - 60/40 vertical split
 * - Tab selector for top section (Files / Diffs)
 * - Resizable divider (future enhancement)
 * - Consistent styling with rest of workspace
 */
export const ContextPanel: Component<ContextPanelProps> = props => {
  const merged = mergeProps(
    {
      openFiles: [],
      diffChanges: [],
      terminalOutput: [],
      activeTopTab: "files" as "files" | "diff",
    },
    props
  );

  // Get active tab value (handle both signal and value)
  const getActiveTab = (): "files" | "diff" => {
    const val = merged.activeTopTab;
    return typeof val === "function" ? val() : val;
  };

  // Handle tab change
  const handleTabChange = (tab: "files" | "diff") => {
    props.onActiveTopTabChange?.(tab);
  };

  return (
    <Resizable.Panel
      initialSize={0.3}
      minSize={0.15}
      collapsible
      collapsedSize={0}
      class="overflow-visible"
    >
      <div class={cn("bg-card/5 animate-fade-in-right flex h-full flex-col", props.class)}>
        {/* Top section - Files or Diffs */}
        <div class="border-border/30 flex h-[60%] flex-col border-b">
          {/* Tab selector */}
          <div
            class={cn(
              "flex items-center gap-0.5 px-2 py-1",
              "bg-card/10 border-border/30 border-b"
            )}
          >
            <button
              onClick={() => handleTabChange("files")}
              class={cn(
                "rounded-t-lg px-3 py-1.5 text-sm transition-colors duration-150",
                getActiveTab() === "files"
                  ? ["text-foreground font-medium", "bg-card/40 border-primary border-b-2"]
                  : [
                      "text-muted-foreground hover:text-foreground",
                      "hover:bg-card/30 border-b-2 border-transparent",
                    ]
              )}
            >
              Files
            </button>
            <button
              onClick={() => handleTabChange("diff")}
              class={cn(
                "rounded-t-lg px-3 py-1.5 text-sm transition-colors duration-150",
                getActiveTab() === "diff"
                  ? ["text-foreground font-medium", "bg-card/40 border-primary border-b-2"]
                  : [
                      "text-muted-foreground hover:text-foreground",
                      "hover:bg-card/30 border-b-2 border-transparent",
                    ]
              )}
            >
              Diffs
            </button>

            {/* Spacer */}
            <div class="flex-1" />

            {/* Count badge */}
            <Show
              when={
                getActiveTab() === "files"
                  ? merged.openFiles.length > 0
                  : merged.diffChanges.length > 0
              }
            >
              <span
                class={cn(
                  "rounded-full px-2 py-0.5 text-xs",
                  "bg-primary/10 text-primary/70 font-medium"
                )}
              >
                {getActiveTab() === "files"
                  ? merged.openFiles.length
                  : merged.diffChanges.filter(c => c.status === "pending").length}
              </span>
            </Show>
          </div>

          {/* Content */}
          <Show when={getActiveTab() === "files"}>
            <FileContext
              openFiles={merged.openFiles}
              onTabClick={props.onTabClick}
              onTabClose={props.onTabClose}
            />
          </Show>

          <Show when={getActiveTab() === "diff"}>
            <DiffView
              changes={merged.diffChanges}
              onAccept={props.onAcceptDiff}
              onReject={props.onRejectDiff}
              onAcceptAll={props.onAcceptAllDiffs}
              onRejectAll={props.onRejectAllDiffs}
            />
          </Show>
        </div>

        {/* Bottom section - Terminal */}
        <div class="h-[40%]">
          <TerminalPanel output={merged.terminalOutput} onClear={props.onClearTerminal} />
        </div>
      </div>
    </Resizable.Panel>
  );
};
