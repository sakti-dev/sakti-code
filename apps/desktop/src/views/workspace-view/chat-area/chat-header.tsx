import { cn } from "@/utils";
import { Component, For, Show, mergeProps } from "solid-js";

interface ModelOption {
  id: string;
  name: string;
  provider: string;
  icon?: string;
}

interface BreadcrumbItem {
  label: string;
  path?: string;
}

interface ChatHeaderProps {
  /** Breadcrumb navigation items */
  breadcrumbs?: BreadcrumbItem[];
  /** Current project name */
  projectName?: string;
  /** Available model options */
  models?: ModelOption[];
  /** Currently selected model */
  selectedModel?: string;
  /** Model change handler */
  onModelChange?: (modelId: string) => void;
  /** Whether debugger is currently shown */
  isDebuggerOpen?: boolean;
  /** Debugger toggle handler */
  onToggleDebugger?: () => void;
  /** Additional CSS classes */
  class?: string;
}

/**
 * ChatHeader - Header for the chat panel with breadcrumb and model selector
 *
 * Design Features:
 * - Breadcrumb navigation showing workspace path
 * - Model selector dropdown with provider icons
 * - Project name display
 * - Minimal height to maximize chat space
 */
export const ChatHeader: Component<ChatHeaderProps> = props => {
  const merged = mergeProps(
    {
      breadcrumbs: [] as BreadcrumbItem[],
      projectName: "ekacode",
      models: [
        { id: "claude-opus", name: "Claude Opus", provider: "anthropic" },
        { id: "claude-sonnet", name: "Claude Sonnet", provider: "anthropic" },
        { id: "gpt-4", name: "GPT-4", provider: "openai" },
      ] as ModelOption[],
      selectedModel: "claude-sonnet",
    },
    props
  );

  return (
    <div
      class={cn(
        "flex items-center justify-between px-4 py-3",
        "border-border/30 border-b",
        "bg-card/5",
        props.class
      )}
    >
      {/* Breadcrumb navigation */}
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <For each={merged.breadcrumbs}>
          {(item, index) => (
            <>
              <Show when={index() > 0}>
                <svg
                  class="text-muted-foreground/40 h-4 w-4 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </Show>
              <span
                class={cn(
                  "truncate text-sm",
                  index() === merged.breadcrumbs.length - 1
                    ? "text-foreground font-medium"
                    : "text-muted-foreground/60 hover:text-muted-foreground/80 cursor-pointer transition-colors"
                )}
              >
                {item.label}
              </span>
            </>
          )}
        </For>
      </div>

      {/* Right side actions */}
      <div class="flex items-center gap-2">
        {/* Debugger toggle button */}
        <button
          onClick={props.onToggleDebugger}
          class={cn(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5",
            "border-border/30 border text-xs font-medium",
            "transition-all duration-150",
            props.isDebuggerOpen
              ? "bg-primary/20 text-primary border-primary/40"
              : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
          title="Toggle Stream Debugger"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width={2}
              d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
            />
          </svg>
          <span>Debug</span>
        </button>
      </div>
    </div>
  );
};
