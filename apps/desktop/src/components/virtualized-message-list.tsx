/**
 * VirtualizedMessageList Component
 *
 * Specialized virtualized list for chat messages with auto-scroll support.
 * Part of Phase 6: Cleanup & Optimization
 */

import type { ChatMessage } from "@/presentation/hooks";
import { VirtualList } from "@solid-primitives/virtual";
import { Accessor, Component, JSX, createEffect, onMount } from "solid-js";

export interface VirtualizedMessageListProps {
  /** Accessor for the messages to render */
  messages: Accessor<ChatMessage[]>;
  /** Render function for each message */
  renderMessage: (message: ChatMessage) => JSX.Element;
  /** Whether to auto-scroll to bottom on new messages */
  autoScroll?: boolean;
  /** Estimated height for each message (default: dynamic based on content) */
  itemSize?: number;
  /** Height of the container (in pixels, default: 600) */
  containerHeight?: number;
  /** Number of extra messages to render outside viewport (default: 5) */
  overscan?: number;
}

/**
 * Virtualized message list component optimized for chat interfaces
 *
 * @example
 * ```tsx
 * const [messages] = createSignal([...]);
 *
 * <VirtualizedMessageList
 *   messages={messages}
 *   autoScroll={true}
 *   renderMessage={(msg) => <MessageBubble message={msg} />}
 * />
 * ```
 */
export const VirtualizedMessageList: Component<VirtualizedMessageListProps> = props => {
  const estimateSize = props.itemSize ?? 100; // Default estimated height per message
  const height = props.containerHeight ?? 600;

  let scrollElement: HTMLDivElement | undefined;
  let isUserScrolled = false;
  let lastScrollTop = 0;

  // Track user scroll to pause auto-scroll
  const handleScroll = (e: Event) => {
    const target = e.currentTarget as HTMLDivElement;
    const scrollDelta = Math.abs(target.scrollTop - lastScrollTop);
    lastScrollTop = target.scrollTop;

    // Detect if user manually scrolled (not auto-scroll)
    if (scrollDelta > 10) {
      const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
      isUserScrolled = distanceFromBottom > 100;
    }
  };

  // Auto-scroll to bottom when new messages arrive
  createEffect(() => {
    const messagesCount = props.messages().length;
    if (props.autoScroll && !isUserScrolled && messagesCount > 0 && scrollElement) {
      // Use requestAnimationFrame for smooth scrolling
      requestAnimationFrame(() => {
        scrollElement?.scrollTo({
          top: scrollElement?.scrollHeight ?? 0,
          behavior: "smooth",
        });
      });
    }
  });

  // Initial scroll to bottom on mount
  onMount(() => {
    if (props.autoScroll && scrollElement) {
      setTimeout(() => {
        scrollElement?.scrollTo({
          top: scrollElement?.scrollHeight ?? 0,
          behavior: "auto",
        });
      }, 0);
    }
  });

  return (
    <div
      ref={scrollElement}
      onScroll={handleScroll}
      style={{
        height: `${height}px`,
        overflow: "auto",
        position: "relative",
      }}
    >
      <VirtualList
        each={props.messages()}
        fallback={null}
        rootHeight={height}
        rowHeight={estimateSize}
        overscanCount={props.overscan ?? 5}
        children={message => props.renderMessage(message)}
      />
    </div>
  );
};
