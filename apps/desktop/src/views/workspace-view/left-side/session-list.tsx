import { cn } from "@/utils";
import { ChevronDown, MessageCircle } from "lucide-solid";
import { Component, For, Show, createSignal } from "solid-js";
import { SessionCard } from "./session-card";

/**
 * Task session summary used by the left sidebar
 */
interface TaskSessionSummary {
  id?: string;
  taskSessionId?: string;
  title: string;
  lastUpdated?: Date;
  lastActivityAt?: string;
  lastAccessed?: string;
  status: "active" | "archived";
  isPinned?: boolean;
}

interface SessionGroup {
  title: string;
  sessions: TaskSessionSummary[];
  isCollapsed?: boolean;
}

interface SessionListProps {
  /** All sessions to display */
  sessions: TaskSessionSummary[];
  /** Currently active session ID */
  activeSessionId?: string;
  /** Session click handler */
  onSessionClick?: (session: TaskSessionSummary) => void;
  /** Session context menu handler */
  onSessionContextMenu?: (session: TaskSessionSummary, e: MouseEvent) => void;
  /** Pin toggle handler */
  onTogglePin?: (session: TaskSessionSummary) => void;
  /** Additional CSS classes */
  class?: string;
}

/**
 * SessionList - Grouped task session list with collapsible sections
 *
 * Groups sessions by:
 * - Pinned (always first)
 * - Today
 * - Yesterday
 * - This Week
 * - Older
 *
 * Design Features:
 * - Collapsible group sections
 * - Empty state with helpful message
 * - Smooth height transitions on collapse
 */
export const SessionList: Component<SessionListProps> = props => {
  const [collapsedGroups, setCollapsedGroups] = createSignal<Set<string>>(new Set());

  // Group task sessions by time period
  const groupSessions = (): SessionGroup[] => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    // Helper to get date from session (handles both formats)
    const getSessionDate = (s: TaskSessionSummary): Date => {
      if (s.lastUpdated) return new Date(s.lastUpdated);
      if (s.lastActivityAt) return new Date(s.lastActivityAt);
      if (s.lastAccessed) return new Date(s.lastAccessed);
      return new Date(0); // Fallback to epoch
    };

    const groups: SessionGroup[] = [];

    // Pinned sessions
    const pinned = props.sessions.filter(s => s.isPinned);
    if (pinned.length > 0) {
      groups.push({ title: "Pinned", sessions: pinned });
    }

    // Today
    const todaySessions = props.sessions.filter(s => !s.isPinned && getSessionDate(s) >= today);
    if (todaySessions.length > 0) {
      groups.push({ title: "Today", sessions: todaySessions });
    }

    // Yesterday
    const yesterdaySessions = props.sessions.filter(
      s => !s.isPinned && getSessionDate(s) >= yesterday && getSessionDate(s) < today
    );
    if (yesterdaySessions.length > 0) {
      groups.push({ title: "Yesterday", sessions: yesterdaySessions });
    }

    // This Week
    const weekSessions = props.sessions.filter(
      s => !s.isPinned && getSessionDate(s) >= weekAgo && getSessionDate(s) < yesterday
    );
    if (weekSessions.length > 0) {
      groups.push({ title: "This Week", sessions: weekSessions });
    }

    // Older
    const olderSessions = props.sessions.filter(s => !s.isPinned && getSessionDate(s) < weekAgo);
    if (olderSessions.length > 0) {
      groups.push({ title: "Older", sessions: olderSessions });
    }

    return groups;
  };

  const toggleGroup = (title: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  };

  const isGroupCollapsed = (title: string) => collapsedGroups().has(title);

  return (
    <div class={cn("flex flex-col gap-4", props.class)}>
      <For each={groupSessions()}>
        {(group, groupIndex) => (
          <div
            class={cn(
              "animate-fade-in-up",
              groupIndex() === 0 ? "delay-100" : "",
              groupIndex() === 1 ? "delay-150" : "",
              groupIndex() === 2 ? "delay-200" : ""
            )}
          >
            {/* Group header */}
            <button
              onClick={() => toggleGroup(group.title)}
              class={cn(
                "flex w-full items-center gap-2 px-3 py-2",
                "text-muted-foreground/70 text-xs font-medium uppercase tracking-wider",
                "hover:text-muted-foreground transition-colors duration-150"
              )}
            >
              <ChevronDown
                class={cn(
                  "h-3 w-3 transition-transform duration-200",
                  isGroupCollapsed(group.title) && "-rotate-90"
                )}
              />
              <span>{group.title}</span>
              <span class="ml-auto text-[10px] opacity-60">{group.sessions.length}</span>
            </button>

            {/* Group content */}
            <Show when={!isGroupCollapsed(group.title)}>
              <div class="mt-1 flex flex-col gap-1.5">
                <For each={group.sessions}>
                  {(session, sessionIndex) => (
                    <SessionCard
                      session={session}
                      isActive={
                        session.taskSessionId === props.activeSessionId ||
                        session.id === props.activeSessionId
                      }
                      onClick={() => props.onSessionClick?.(session)}
                      onContextMenu={e => props.onSessionContextMenu?.(session, e)}
                      onTogglePin={() => props.onTogglePin?.(session)}
                      delay={Math.min(sessionIndex() * 50, 300)}
                    />
                  )}
                </For>
              </div>
            </Show>
          </div>
        )}
      </For>

      {/* Empty state */}
      <Show when={props.sessions.length === 0}>
        <div class="flex flex-col items-center justify-center px-4 py-12 text-center">
          <div
            class={cn(
              "mb-3 h-12 w-12 rounded-full",
              "bg-card/20 border-border/30 border",
              "flex items-center justify-center"
            )}
          >
            <MessageCircle class="text-muted-foreground/40 h-6 w-6" />
          </div>
          <p class="text-muted-foreground/70 text-sm">No tasks yet</p>
          <p class="text-muted-foreground/50 mt-1 text-xs">
            Start planning to create your first task
          </p>
        </div>
      </Show>
    </div>
  );
};
