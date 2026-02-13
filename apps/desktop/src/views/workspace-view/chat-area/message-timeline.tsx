/**
 * MessageTimeline Component
 *
 * Turn-based conversation timeline with OpenCode-like layout.
 */

import type { ChatTurn } from "@/core/chat/hooks/turn-projection";
import { For, Show, type Accessor, type JSX } from "solid-js";
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
  return (
    <div
      data-component="message-timeline"
      class={props.class}
      classList={{
        "flex flex-col h-full overflow-y-auto [scrollbar-gutter:stable]": true,
      }}
      role="log"
      aria-label="Conversation"
    >
      <Show
        when={props.turns().length > 0}
        fallback={
          <div class="text-muted-foreground flex flex-1 items-center justify-center text-sm">
            No messages yet. Start a conversation!
          </div>
        }
      >
        <ul
          data-slot="timeline-list"
          class="flex flex-col gap-5 p-4 pb-[calc(var(--prompt-height,10rem)+5rem)]"
          role="list"
        >
          <For each={props.turns()}>
            {turn => (
              <li data-testid={`turn-${turn.userMessage.id}`} role="listitem">
                <SessionTurn
                  turn={() => turn}
                  isStreaming={props.isStreaming}
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
      </Show>
    </div>
  );
}
