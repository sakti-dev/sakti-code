import { createVirtualizer } from "@tanstack/solid-virtual";
import {
  type Accessor,
  createSignal,
  For,
  type JSX,
  onMount,
  Show,
} from "solid-js";
import { cn } from "~/lib/utils";
import type { ChatTurn } from "~/stores/session/turn-projection";
import { CHAT_TIMELINE_CLASS } from "../layout";
import { SessionTurn } from "./session-turn";

export interface MessageTimelineProps {
  class?: string;
  isStreaming: Accessor<boolean>;
  turns: Accessor<ChatTurn[]>;
}

export function MessageTimeline(props: MessageTimelineProps): JSX.Element {
  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement | null>(null);

  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return props.turns().length;
    },
    estimateSize: () => 200,
    followOnAppend: true,
    getItemKey: (index) => props.turns()[index]?.id ?? index,
    getScrollElement: () => scrollEl(),
    overscan: 6,
    scrollEndThreshold: 80,
    anchorTo: "end",
  });

  onMount(() => {
    if (props.turns().length > 0) {
      virtualizer.scrollToEnd();
    }
  });

  return (
    <div
      aria-live="polite"
      class={cn(CHAT_TIMELINE_CLASS, props.class)}
      ref={setScrollEl}
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
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
            width: "100%",
          }}
        >
          <For each={virtualizer.getVirtualItems()}>
            {(virtualItem) => (
              <div
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                style={{
                  left: 0,
                  position: "absolute",
                  top: 0,
                  transform: `translateY(${virtualItem.start}px)`,
                  width: "100%",
                }}
              >
                <Show when={props.turns()[virtualItem.index]}>
                  {(turn) => (
                    <SessionTurn isStreaming={props.isStreaming} turn={turn} />
                  )}
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
