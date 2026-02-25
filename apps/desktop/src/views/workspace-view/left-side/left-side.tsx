import { useWorkspace } from "@/state/providers";
import { cn } from "@/utils";
import Resizable from "@corvu/resizable";
import { Plus, Search, Settings } from "lucide-solid";
import { Component } from "solid-js";
import { SessionList } from "./session-list";

interface SessionSidebarProps {
  class?: string;
}

/**
 * SessionSidebar - Left panel containing the session manager
 *
 * Consumes workspace context internally for session data.
 * Props only for UI customization.
 */
export const LeftSide: Component<SessionSidebarProps> = props => {
  const ctx = useWorkspace();

  const handleSessionClick = (session: { taskSessionId?: string }) => {
    if (session.taskSessionId) {
      ctx.setActiveTaskSessionId(session.taskSessionId);
    }
  };

  const handleNewSession = async () => {
    await ctx.createTaskSession("task");
  };

  return (
    <Resizable.Panel
      initialSize={0.2}
      minSize={0.12}
      collapsible
      collapsedSize={0}
      class={cn("bg-card/5 animate-fade-in-left flex h-full w-full min-w-0 flex-col", props.class)}
    >
      {/* Header */}
      <div
        class={cn(
          "flex shrink-0 items-center justify-between gap-2 px-3 py-3",
          "border-border/30 border-b"
        )}
      >
        <h2 class="text-foreground truncate text-sm font-semibold">Tasks</h2>
        <button
          onClick={handleNewSession}
          class={cn(
            "shrink-0 rounded-lg p-2 transition-all duration-200",
            "bg-card/20 hover:bg-card/40",
            "border-border/30 hover:border-primary/30 border",
            "hover:scale-105 hover:shadow-sm",
            "group"
          )}
          aria-label="New task"
        >
          <Plus
            class={cn(
              "text-muted-foreground h-4 w-4",
              "group-hover:text-primary transition-colors duration-200"
            )}
          />
        </button>
      </div>

      {/* Search/Filter (placeholder) */}
      <div class="shrink-0 px-3 pb-2 pt-3">
        <div
          class={cn(
            "relative",
            "bg-card/20 border-border/30 rounded-lg border",
            "focus-within:ring-primary/20 focus-within:ring-2",
            "transition-all duration-200"
          )}
        >
          <Search
            class={cn(
              "absolute left-3 top-1/2 shrink-0 -translate-y-1/2",
              "text-muted-foreground/50 h-4 w-4"
            )}
          />
          <input
            type="text"
            placeholder="Filter..."
            class={cn(
              "w-full bg-transparent py-2 pl-10 pr-3",
              "text-foreground placeholder:text-muted-foreground/40 text-sm",
              "truncate outline-none"
            )}
            disabled
          />
        </div>
      </div>

      {/* Task List */}
      <div class="scrollbar-default min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <SessionList
          sessions={ctx.taskSessions()}
          activeSessionId={ctx.activeTaskSessionId() ?? ""}
          onSessionClick={handleSessionClick}
        />
      </div>

      {/* Footer - Settings/Profile (placeholder) */}
      <div class={cn("border-border/30 border-t px-4 py-2", "flex items-center justify-between")}>
        <div
          class={cn(
            "flex items-center gap-2 rounded-md px-2 py-1.5",
            "hover:bg-card/20 cursor-pointer",
            "transition-colors duration-150"
          )}
        >
          <div
            class={cn(
              "h-6 w-6 rounded-full",
              "from-primary/40 to-primary/20 bg-gradient-to-br",
              "border-primary/30 border"
            )}
          />
          <span class="text-muted-foreground/80 text-xs">sakti-code</span>
        </div>
        <button
          class={cn("hover:bg-card/20 rounded-md p-1.5", "transition-colors duration-150")}
          aria-label="Settings"
        >
          <Settings class="text-muted-foreground/60 h-4 w-4" />
        </button>
      </div>
    </Resizable.Panel>
  );
};
