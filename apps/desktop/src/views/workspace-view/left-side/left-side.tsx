import { cn } from "@/utils";
import Resizable from "@corvu/resizable";
import { Component, mergeProps } from "solid-js";
import { SessionList } from "./session-list";

/**
 * Base session interface that both types implement
 */
interface BaseSession {
  id?: string;
  sessionId?: string;
  title: string;
  lastUpdated?: Date;
  lastAccessed?: string;
  status: "active" | "archived";
  isPinned?: boolean;
}

interface SessionSidebarProps {
  /** All sessions to display */
  sessions: BaseSession[];
  /** Currently active session ID */
  activeSessionId?: string;
  /** Session click handler */
  onSessionClick?: (session: BaseSession) => void;
  /** New session handler */
  onNewSession?: () => void;
  /** Session context menu handler */
  onSessionContextMenu?: (session: BaseSession, e: MouseEvent) => void;
  /** Pin toggle handler */
  onTogglePin?: (session: BaseSession) => void;
  /** Loading state */
  isLoading?: boolean;
  /** Additional CSS classes */
  class?: string;
}

/**
 * SessionSidebar - Left panel containing the session manager
 *
 * Design Features:
 * - Header with "Sessions" title
 * - "New Session" button with + icon
 * - Search/filter functionality (placeholder for future)
 * - SessionList integration
 */
export const LeftSide: Component<SessionSidebarProps> = props => {
  const merged = mergeProps(
    {
      activeSessionId: "",
    },
    props
  );

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
        <h2 class="text-foreground truncate text-sm font-semibold">Sessions</h2>
        <button
          onClick={props.onNewSession}
          class={cn(
            "shrink-0 rounded-lg p-2 transition-all duration-200",
            "bg-card/20 hover:bg-card/40",
            "border-border/30 hover:border-primary/30 border",
            "hover:scale-105 hover:shadow-sm",
            "group"
          )}
          aria-label="New session"
        >
          <svg
            class={cn(
              "text-muted-foreground h-4 w-4",
              "group-hover:text-primary transition-colors duration-200"
            )}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
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
          <svg
            class={cn(
              "absolute left-3 top-1/2 shrink-0 -translate-y-1/2",
              "text-muted-foreground/50 h-4 w-4"
            )}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
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

      {/* Session List */}
      <div class="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <SessionList
          sessions={props.sessions}
          activeSessionId={merged.activeSessionId}
          onSessionClick={props.onSessionClick}
          onSessionContextMenu={props.onSessionContextMenu}
          onTogglePin={props.onTogglePin}
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
          <span class="text-muted-foreground/80 text-xs">ekacode</span>
        </div>
        <button
          class={cn("hover:bg-card/20 rounded-md p-1.5", "transition-colors duration-150")}
          aria-label="Settings"
        >
          <svg
            class="text-muted-foreground/60 h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      </div>
    </Resizable.Panel>
  );
};
