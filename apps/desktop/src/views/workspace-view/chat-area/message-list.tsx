import { Component, For, Show } from "solid-js";
import { MessageBubble, ThinkingBubble } from "./message-bubble";
import { ToolCallBlock } from "./tool-call-block";
import { Icon } from "/@/components/icon";
import { createAutoScroll } from "/@/hooks/create-auto-scroll";
import { cn } from "/@/lib/utils";
import type { ChatUIMessage } from "/@/types/ui-message";

interface MessageListProps {
  /** Messages to display */
  messages: ChatUIMessage[];
  /** Whether AI is currently generating */
  isGenerating?: boolean;
  /** Current thinking content (if any) */
  thinkingContent?: string;
  /** Additional CSS classes */
  class?: string;
  /** Callback when messages are scrolled to bottom */
  onScrollToBottom?: () => void;
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

  return (
    <div
      ref={autoScroll.scrollRef}
      onScroll={e => autoScroll.handleScroll(e.currentTarget)}
      class={cn("scrollbar-thin flex-1 overflow-y-auto", "px-4 py-4", props.class)}
    >
      {/* Messages */}
      <div class="mx-auto max-w-3xl">
        <For each={props.messages}>
          {(message, index) => (
            <div class="group">
              <MessageBubble message={message} delay={Math.min(index() * 50, 300)} />

              {/* Tool calls - extracted from parts */}
              <Show
                when={message.parts?.some(
                  part => part.type === "tool-call" || part.type === "tool-result"
                )}
              >
                <div class="ml-12 mt-2 space-y-1">
                  <For each={message.parts}>
                    {part =>
                      part.type === "tool-call" ? (
                        <ToolCallBlock
                          toolCall={{
                            id: (part as unknown as { toolCallId: string }).toolCallId,
                            name: (part as unknown as { toolName?: string }).toolName || "unknown",
                            arguments:
                              ((part as unknown as { args?: Record<string, unknown> })
                                .args as Record<string, unknown>) || {},
                            status: "pending",
                            timestamp: new Date(),
                          }}
                        />
                      ) : null
                    }
                  </For>
                </div>
              </Show>
            </div>
          )}
        </For>

        {/* Current thinking (while generating) */}
        <Show when={props.isGenerating && props.thinkingContent}>
          <ThinkingBubble content={props.thinkingContent || ""} />
        </Show>

        {/* Typing indicator */}
        <Show when={props.isGenerating && !props.thinkingContent}>
          <div class={cn("mb-4 flex items-center gap-2", "animate-fade-in-up")}>
            <div class={cn("rounded-xl px-4 py-3", "bg-card/30 border-border/30 border")}>
              <div class="flex gap-1">
                <span class="typing-dot bg-primary/60 h-2 w-2 rounded-full" />
                <span class="typing-dot bg-primary/60 h-2 w-2 rounded-full" />
                <span class="typing-dot bg-primary/60 h-2 w-2 rounded-full" />
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
