import { type Accessor, For, type JSX, Show } from "solid-js";
import { cn } from "~/lib/utils";
import { createAutoScroll } from "~/lib/utils/create-auto-scroll";
import type { ChatTurn } from "~/stores/session/turn-projection";
import { CHAT_TIMELINE_CLASS, CHAT_TIMELINE_RAIL_CLASS } from "../layout";
import { SessionTurn } from "./session-turn";

export interface MessageTimelineProps {
  class?: string;
  isStreaming: Accessor<boolean>;
  turns: Accessor<ChatTurn[]>;
}

export function MessageTimeline(props: MessageTimelineProps): JSX.Element {
  const autoScroll = createAutoScroll({
    working: () => props.isStreaming(),
    nearBottomDistance: 100,
    settlingPeriod: 300,
  });

  return (
    <div
      aria-live="polite"
      class={cn(CHAT_TIMELINE_CLASS, props.class)}
      onScroll={(e) => {
        autoScroll.handleScroll(e.currentTarget);
      }}
      ref={autoScroll.scrollRef}
      role="log"
    >
      <Show
        fallback={
          <div class="p-4 text-center text-muted-foreground text-sm">
            No messages yet. Start a conversation!
          </div>
        }
        when={props.turns().length > 0}
      >
        <div class={CHAT_TIMELINE_RAIL_CLASS} data-slot="timeline-rail">
          <ul class="flex flex-col gap-5" data-slot="timeline-list">
            <For each={props.turns()}>
              {(turn) => (
                <li data-testid={`turn-${turn.userMessage?.id ?? "orphan"}`}>
                  <SessionTurn
                    isStreaming={props.isStreaming}
                    turn={() => turn}
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
