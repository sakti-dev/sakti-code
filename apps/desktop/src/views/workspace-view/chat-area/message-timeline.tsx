/**
 * MessageTimeline Component
 *
 * Turn-based conversation timeline with OpenCode-like layout.
 * Includes auto-scroll functionality similar to MessageList.
 */

import type { ChatTurn } from "@/core/chat/hooks/turn-projection";
import { createAutoScroll } from "@/core/shared/utils/create-auto-scroll";
import { cn } from "@/utils";
import { For, Show, createSignal, onCleanup, type Accessor, type JSX } from "solid-js";
import { SessionTurn } from "./session-turn";

export interface MessageTimelineProps {
  turns: Accessor<ChatTurn[]>;
  isStreaming: Accessor<boolean>;
  onRetry?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  onCopy?: (messageId: string) => void;
  onPermissionApprove?: (id: string, patterns?: string[]) => void | Promise<void>;
  onPermissionDeny?: (id: string) => void | Promise<void>;
  onQuestionAnswer?: (id: string, answer: unknown) => void | Promise<void>;
  onQuestionReject?: (id: string) => void | Promise<void>;
  class?: string;
}

export function MessageTimeline(props: MessageTimelineProps): JSX.Element {
  const [isScrollActive, setIsScrollActive] = createSignal(false);
  const autoScroll = createAutoScroll({
    working: () => props.isStreaming(),
    nearBottomDistance: 100,
    settlingPeriod: 300,
  });
  let scrollPauseTimeout: ReturnType<typeof setTimeout> | undefined;

  const markScrollActive = () => {
    setIsScrollActive(true);
    if (scrollPauseTimeout) {
      clearTimeout(scrollPauseTimeout);
    }
    scrollPauseTimeout = setTimeout(() => {
      setIsScrollActive(false);
      scrollPauseTimeout = undefined;
    }, 180);
  };

  onCleanup(() => {
    if (scrollPauseTimeout) clearTimeout(scrollPauseTimeout);
  });

  return (
    <div
      ref={autoScroll.scrollRef}
      onScroll={e => {
        autoScroll.handleScroll(e.currentTarget);
        markScrollActive();
      }}
      role="log"
      aria-live="polite"
      class={cn("scrollbar-thin min-h-0 flex-1 overflow-y-auto", "px-4 py-4", props.class)}
    >
      <Show
        when={props.turns().length > 0}
        fallback={
          <div class="text-muted-foreground p-4 text-center text-sm">
            No messages yet. Start a conversation!
          </div>
        }
      >
        <div class="mx-auto max-w-3xl">
          <ul role="list" data-slot="timeline-list" class="flex flex-col gap-5">
            <For each={props.turns()}>
              {turn => (
                <li role="listitem" data-testid={`turn-${turn.userMessage.id}`}>
                  <SessionTurn
                    turn={() => turn}
                    isStreaming={props.isStreaming}
                    isScrollActive={isScrollActive}
                    onRetry={props.onRetry}
                    onDelete={props.onDelete}
                    onCopy={props.onCopy}
                    onPermissionApprove={props.onPermissionApprove}
                    onPermissionDeny={props.onPermissionDeny}
                    onQuestionAnswer={props.onQuestionAnswer}
                    onQuestionReject={props.onQuestionReject}
                  />
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </div>
  );
}
