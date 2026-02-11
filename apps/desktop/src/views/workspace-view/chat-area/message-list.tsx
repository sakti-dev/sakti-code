import { Icon } from "@renderer/components/icon";
import { createAutoScroll } from "@renderer/hooks/create-auto-scroll";
import { createLogger } from "@renderer/lib/logger";
import { cn } from "@renderer/lib/utils";
import { useMessages } from "@renderer/presentation/hooks/use-messages";
import { VirtualList } from "@solid-primitives/virtual";
import { Component, createEffect, createMemo, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { ThinkingBubble } from "./message-bubble";
import { SessionTurn } from "./session-turn";

interface MessageListProps {
  /** Current session ID */
  sessionId?: string;
  /** Whether AI is currently generating */
  isGenerating?: boolean;
  /** Current thinking content (if any) */
  thinkingContent?: string;
  /** Additional CSS classes */
  class?: string;
  /** Callback when messages are scrolled to bottom */
  onScrollToBottom?: () => void;
}

const logger = createLogger("desktop:views:message-list");

// Custom equality for string ID arrays
function idsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

/**
 * MessageList - Scrollable message area with smart auto-scroll
 *
 * Design Features:
 * - Smart auto-scroll that pauses when user scrolls up
 * - Smooth scroll to bottom on new messages
 * - Typing indicator when generating
 * - Collapsible thought blocks
 * - Tool execution indicators
 * - Custom scrollbar styling
 * - Visual indicator when auto-scroll is paused
 */
export const MessageList: Component<MessageListProps> = props => {
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({});

  const autoScroll = createAutoScroll({
    working: () => props.isGenerating ?? false,
    nearBottomDistance: 100,
    settlingPeriod: 300,
  });

  // Get messages for current session using new useMessages hook
  const messages = useMessages(() => props.sessionId ?? null);

  // Compute timeline as array of user message IDs only
  // Each user message ID represents a turn - SessionTurn will fetch its own data
  const userMessageIDs = createMemo(
    () => {
      const userMsgs = messages.userMessages();
      if (userMsgs.length === 0) return [];
      return userMsgs.map(m => m.id);
    },
    { equals: idsEqual }
  );

  // Determine last user message ID for "isLast" prop
  const lastUserMessageID = createMemo(() => {
    const ids = userMessageIDs();
    return ids[ids.length - 1];
  });

  createEffect(() => {
    const lastID = lastUserMessageID();
    if (!lastID) return;
    const isWorking = props.isGenerating ?? false;
    setExpanded(lastID, isWorking);
  });

  createEffect(() => {
    logger.debug("Message list projection updated", {
      sessionId: props.sessionId,
      userTurnCount: userMessageIDs().length,
      isGenerating: props.isGenerating ?? false,
      lastUserMessageId: lastUserMessageID(),
    });
  });

  return (
    <div
      ref={autoScroll.scrollRef}
      onScroll={e => autoScroll.handleScroll(e.currentTarget)}
      class={cn("scrollbar-thin flex-1 overflow-y-auto", "px-4 py-4", props.class)}
    >
      {/* Messages */}
      <div class="mx-auto max-w-3xl">
        <VirtualList
          each={userMessageIDs()}
          fallback={null}
          rowHeight={300}
          rootHeight={800}
          overscanCount={3}
          children={messageID => (
            <div class="group mb-5">
              <SessionTurn
                sessionID={props.sessionId}
                messageID={messageID}
                isLast={messageID === lastUserMessageID()}
                isGenerating={props.isGenerating}
                expanded={expanded[messageID] ?? false}
                onToggleExpanded={() => setExpanded(messageID, value => !value)}
              />
            </div>
          )}
        />

        {/* Current thinking (while generating) */}
        <Show when={props.isGenerating && props.thinkingContent}>
          <div data-testid="message-list-thinking-bubble">
            <ThinkingBubble content={props.thinkingContent || ""} />
          </div>
        </Show>

        {/* Typing indicator - content priority: hide when thinking content exists */}
        <Show when={props.isGenerating && !props.thinkingContent}>
          <div
            data-testid="message-list-typing-indicator"
            class={cn("mb-4 flex items-center gap-2", "animate-fade-in-up")}
          >
            <div class={cn("rounded-xl px-4 py-3", "bg-card/30 border-border/30 border")}>
              <div class="flex gap-1">
                <span class="typing-dot bg-primary/60 h-2 w-2 animate-pulse rounded-full" />
                <span class="typing-dot bg-primary/60 animation-delay-150 h-2 w-2 animate-pulse rounded-full" />
                <span class="typing-dot bg-primary/60 animation-delay-300 h-2 w-2 animate-pulse rounded-full" />
              </div>
            </div>
          </div>
        </Show>
      </div>

      {/* Scroll to bottom button (when not auto-scrolling) */}
      <Show when={!autoScroll.isAutoScrolling()}>
        <button
          onClick={() => {
            autoScroll.setAutoScrolling(true);
            autoScroll.scrollToBottom(true);
          }}
          class={cn(
            "fixed bottom-24 right-8 z-10",
            "rounded-lg p-2",
            "bg-card/80 border-border/40 glass-effect border backdrop-blur-sm",
            "hover:bg-card hover:border-primary/30",
            "shadow-lg transition-all duration-200",
            "hover:scale-105"
          )}
          aria-label="Scroll to bottom"
        >
          <Icon name="chevron-down" class="text-foreground/60 h-5 w-5" />
        </button>
      </Show>
    </div>
  );
};
