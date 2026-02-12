import { Icon } from "@/components/shared/icon";
import { useMessages } from "@/core/chat/hooks/use-messages";
import type { Message, Part } from "@/core/chat/types/sync";
import { createAutoScroll } from "@/core/shared/utils/create-auto-scroll";
import { createLogger } from "@/shared/logger";
import { cn } from "@/utils";
import type { Part as SharedPart } from "@ekacode/shared/event-types";
import { Component, createEffect, For, Show } from "solid-js";
import AssistantMessage from "../../../components/assistant-message";
import { MessageBubble, ThinkingBubble } from "./message-bubble";

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

function toSyncParts(parts: SharedPart[], messageId: string, sessionId: string): Part[] {
  return parts.map((part, index) => {
    const raw = part as Record<string, unknown>;
    const rawMessageId = raw.messageID;
    const rawSessionId = raw.sessionID;

    return {
      ...raw,
      id: typeof part.id === "string" ? part.id : `${messageId}-part-${index}`,
      type: part.type,
      messageID: typeof rawMessageId === "string" ? rawMessageId : messageId,
      sessionID: typeof rawSessionId === "string" ? rawSessionId : sessionId,
    };
  });
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
  const autoScroll = createAutoScroll({
    working: () => props.isGenerating ?? false,
    nearBottomDistance: 100,
    settlingPeriod: 300,
  });

  // Get messages for current session using new useMessages hook
  const messages = useMessages(() => props.sessionId ?? null);

  createEffect(() => {
    logger.info("Message list projection updated", {
      sessionId: props.sessionId,
      totalMessageCount: messages.count(),
      timelineItemCount: messages.timeline().length,
      isGenerating: props.isGenerating ?? false,
      hasRenderableAssistantContent: messages.hasRenderableAssistantContent(),
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
        <For each={messages.timeline()}>
          {item => (
            <div class="group mb-5">
              <Show
                when={item.kind === "assistant"}
                fallback={
                  <MessageBubble
                    message={
                      {
                        info: {
                          role: "user",
                          id: item.messageId,
                          sessionID: item.sessionId,
                          time: { created: item.ts },
                        },
                        parts: [
                          {
                            id: `${item.messageId}-text`,
                            type: "text",
                            messageID: item.messageId,
                            sessionID: item.sessionId,
                            text: item.kind === "user" ? item.text : "",
                          },
                        ],
                        createdAt: item.ts,
                      } satisfies Message
                    }
                  />
                }
              >
                <div class="mb-4 flex w-full justify-start">
                  <div
                    class={cn(
                      "max-w-[90%] rounded-2xl rounded-tl-sm p-4 shadow-sm",
                      "bg-card/30 border-border/30 text-foreground border"
                    )}
                  >
                    <AssistantMessage
                      messageID={item.messageId}
                      sessionID={item.sessionId}
                      fallbackParts={toSyncParts(
                        (item as { parts: SharedPart[] }).parts,
                        item.messageId,
                        item.sessionId
                      )}
                    />
                  </div>
                </div>
              </Show>
            </div>
          )}
        </For>

        {/* Current thinking (while generating) */}
        <Show when={props.isGenerating && props.thinkingContent}>
          <div data-testid="message-list-thinking-bubble">
            <ThinkingBubble content={props.thinkingContent || ""} />
          </div>
        </Show>

        {/* Typing indicator - content priority: hide once assistant content exists */}
        <Show
          when={
            (props.isGenerating ?? false) &&
            !messages.hasRenderableAssistantContent() &&
            !props.thinkingContent
          }
        >
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
