import { cn } from "@/utils";
import { Component, For, Show, createSignal, mergeProps } from "solid-js";

interface TerminalTab {
  id: string;
  label: string;
  type: "terminal" | "console";
}

interface TerminalOutput {
  timestamp: Date;
  type: "info" | "warn" | "error" | "success";
  content: string;
}

interface TerminalPanelProps {
  /** Current active tab */
  activeTab?: string;
  /** Terminal output lines */
  output?: TerminalOutput[];
  /** Tab change handler */
  onTabChange?: (tabId: string) => void;
  /** Clear output handler */
  onClear?: () => void;
  /** Additional CSS classes */
  class?: string;
}

/**
 * TerminalPanel - Bottom section of right panel with terminal/console
 *
 * Design Features:
 * - Tab bar (Terminal / Console)
 * - Styled output with color coding by type
 * - Monospace font for code
 * - Clear button
 * - Auto-scroll to bottom
 * - Placeholder for xterm.js integration
 */
export const TerminalPanel: Component<TerminalPanelProps> = props => {
  const merged = mergeProps(
    {
      activeTab: "terminal",
      output: [],
    },
    props
  );

  const tabs: TerminalTab[] = [
    { id: "terminal", label: "Terminal", type: "terminal" },
    { id: "console", label: "Console", type: "console" },
  ];

  const [activeTabId, setActiveTabId] = createSignal(merged.activeTab);

  const activeTab = () => tabs.find(t => t.id === activeTabId()) || tabs[0];

  const outputConfig = (type: TerminalOutput["type"]) => {
    switch (type) {
      case "error":
        return {
          bgColor: "bg-red-500/10 dark:bg-red-500/5",
          textColor: "text-red-600 dark:text-red-400",
          icon: "✕",
        };
      case "warn":
        return {
          bgColor: "bg-yellow-500/10 dark:bg-yellow-500/5",
          textColor: "text-yellow-600 dark:text-yellow-400",
          icon: "⚠",
        };
      case "success":
        return {
          bgColor: "bg-green-500/10 dark:bg-green-500/5",
          textColor: "text-green-600 dark:text-green-400",
          icon: "✓",
        };
      default:
        return {
          bgColor: "bg-transparent",
          textColor: "text-foreground/80",
          icon: "•",
        };
    }
  };

  return (
    <div class={cn("flex h-[40%] flex-col", "bg-card/5", props.class)}>
      {/* Tab bar */}
      <div
        class={cn(
          "flex items-center justify-between px-2 py-1",
          "bg-card/10 border-border/30 border-b"
        )}
      >
        {/* Tabs */}
        <div class="flex items-center gap-0.5">
          <For each={tabs}>
            {tab => (
              <button
                onClick={() => {
                  setActiveTabId(tab.id);
                  props.onTabChange?.(tab.id);
                }}
                class={cn(
                  "rounded-t-lg px-3 py-1.5 text-sm transition-colors duration-150",
                  tab.id === activeTabId()
                    ? ["text-foreground font-medium", "bg-card/40 border-primary border-b-2"]
                    : [
                        "text-muted-foreground hover:text-foreground",
                        "hover:bg-card/30 border-b-2 border-transparent",
                      ]
                )}
              >
                {tab.label}
              </button>
            )}
          </For>
        </div>

        {/* Clear button */}
        <button
          onClick={props.onClear}
          class={cn(
            "rounded-md p-1.5 transition-all duration-150",
            "hover:bg-card/30 hover:scale-105",
            "text-muted-foreground/50 hover:text-muted-foreground"
          )}
          title="Clear output"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>

      {/* Output area */}
      <div class="scrollbar-thin flex-1 overflow-auto p-3 font-mono text-xs">
        <Show
          when={merged.output.length > 0}
          fallback={
            <div class="flex h-full flex-col items-center justify-center text-center">
              <svg
                class="text-muted-foreground/20 mb-2 h-10 w-10"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width={1.5}
                  d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <p class="text-muted-foreground/40 text-xs">
                {activeTab().type === "terminal"
                  ? "Terminal output will appear here..."
                  : "Console logs will appear here..."}
              </p>
            </div>
          }
        >
          <div class="space-y-1">
            <For each={merged.output}>
              {line => {
                const config = outputConfig(line.type);
                return (
                  <div class={cn("flex items-start gap-2 rounded px-2 py-1", config.bgColor)}>
                    <span class={cn("flex-shrink-0", config.textColor)}>{config.icon}</span>
                    <span class={cn("flex-1", config.textColor)}>{line.content}</span>
                    <span class="text-muted-foreground/30 flex-shrink-0">
                      {line.timestamp.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>

      {/* Terminal input (placeholder for future) */}
      <Show when={activeTab().type === "terminal"}>
        <div class="border-border/30 border-t px-3 py-2">
          <div
            class={cn(
              "flex items-center gap-2 rounded-md px-3 py-2",
              "bg-card/20 border-border/30 border",
              "focus-within:ring-primary/20 focus-within:ring-2",
              "transition-all duration-200"
            )}
          >
            <span class="text-muted-foreground/50">$</span>
            <input
              type="text"
              placeholder="Type a command..."
              class={cn(
                "flex-1 bg-transparent outline-none",
                "text-foreground placeholder:text-muted-foreground/40",
                "text-xs"
              )}
              disabled
            />
          </div>
        </div>
      </Show>
    </div>
  );
};
