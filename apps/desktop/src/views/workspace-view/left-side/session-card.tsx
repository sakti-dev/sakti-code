import { Component, Show, mergeProps } from "solid-js";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/utils";
import { Bookmark } from "lucide-solid";

/**
 * Task session summary used in sidebar cards
 */
interface BaseSession {
  id?: string;
  taskSessionId?: string;
  title: string;
  lastUpdated?: Date;
  lastActivityAt?: string;
  lastAccessed?: string;
  status: "active" | "archived";
  isPinned?: boolean;
  messages?: unknown[];
}

interface SessionCardProps {
  /** Session data */
  session: BaseSession;
  /** Whether this session is currently selected */
  isActive?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Context menu trigger */
  onContextMenu?: (e: MouseEvent) => void;
  /** Pin toggle handler */
  onTogglePin?: () => void;
  /** Additional CSS classes */
  class?: string;
  /** Animation delay for stagger effect */
  delay?: number;
}

/**
 * SessionCard - Individual session item in the session list
 *
 * Design Features:
 * - Soft glow on active state (breathing animation)
 * - Hover scale (1.01) + subtle shadow
 * - Fade-in animation on mount
 * - Pin indicator for important sessions
 * - Relative timestamp display
 */
export const SessionCard: Component<SessionCardProps> = props => {
  const merged = mergeProps(
    {
      isActive: false,
      delay: 0,
    },
    props
  );

  // Get session date from either format
  const getSessionDate = (): Date => {
    if (props.session.lastUpdated) return new Date(props.session.lastUpdated);
    if (props.session.lastActivityAt) return new Date(props.session.lastActivityAt);
    if (props.session.lastAccessed) return new Date(props.session.lastAccessed);
    return new Date();
  };

  // Format relative timestamp
  const formatRelativeTime = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  // Get animation delay class
  const getDelayClass = () => {
    const delays: Record<number, string> = {
      0: "",
      100: "delay-100",
      150: "delay-150",
      200: "delay-200",
      300: "delay-300",
    };
    return delays[merged.delay] || "";
  };

  // Get message count
  const messageCount = () => props.session.messages?.length ?? 0;

  return (
    <Card
      data-component="task-session-card"
      variant="interactive"
      class={cn(
        "group relative cursor-pointer p-3",
        "transition-all duration-200",
        // Animation
        "animate-fade-in-up opacity-0",
        getDelayClass(),
        // Active state overrides
        merged.isActive && [
          "bg-primary/5 border-primary/40",
          "shadow-[0_0_20px_-5px_rgba(var(--primary),0.15)]",
          "animate-breathe",
        ],
        // Archived state
        props.session.status === "archived" && "opacity-60",
        merged.class
      )}
      onClick={props.onClick}
      onContextMenu={props.onContextMenu}
    >
      {/* Session header */}
      <div class="flex items-start justify-between gap-2">
        {/* Title */}
        <div class="min-w-0 flex-1">
          <h3
            class={cn(
              "truncate text-sm font-medium",
              merged.isActive ? "text-foreground" : "text-foreground/80 group-hover:text-foreground"
            )}
          >
            {props.session.title}
          </h3>
        </div>

        {/* Pin button */}
        <Show when={props.onTogglePin}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={e => {
              e.stopPropagation();
              props.onTogglePin?.();
            }}
            class={cn(
              props.session.isPinned
                ? "text-primary"
                : "text-muted-foreground opacity-0 group-hover:opacity-60"
            )}
          >
            <Bookmark class="h-3.5 w-3.5" fill={props.session.isPinned ? "currentColor" : "none"} />
          </Button>
        </Show>
      </div>

      {/* Session metadata */}
      <div class="mt-1.5 flex items-center gap-2">
        {/* Timestamp */}
        <span class="text-muted-foreground/70 text-xs">{formatRelativeTime(getSessionDate())}</span>

        {/* Message count - only show if available */}
        <Show when={messageCount() > 0}>
          <span class="text-muted-foreground/50 text-xs">· {messageCount()} messages</span>
        </Show>

        {/* Status indicator */}
        <Show when={props.session.status === "active"}>
          <span
            class={cn(
              "ml-auto h-1.5 w-1.5 rounded-full",
              merged.isActive ? "bg-primary animate-pulse" : "bg-muted-foreground/40"
            )}
          />
        </Show>
      </div>

      {/* Active glow border (bottom) */}
      <Show when={merged.isActive}>
        <div class="via-primary/40 absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-gradient-to-r from-transparent to-transparent" />
      </Show>
    </Card>
  );
};
