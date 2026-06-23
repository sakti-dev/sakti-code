import { createVirtualizer } from "@tanstack/solid-virtual";
import {
  type Accessor,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { cn } from "~/lib/utils";
import type { ChatTurn } from "~/stores/session/turn-projection";
import { CHAT_TIMELINE_CLASS } from "../layout";
import { clearPretextCache, estimateTurnHeight } from "./estimate-turn-height";
import { SessionTurn } from "./session-turn";

export interface MessageTimelineProps {
  class?: string;
  isStreaming: Accessor<boolean>;
  turns: Accessor<ChatTurn[]>;
}

export function MessageTimeline(props: MessageTimelineProps): JSX.Element {
  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = createSignal(0);
  const [fontVersion, setFontVersion] = createSignal(0);

  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return props.turns().length;
    },
    estimateSize: (index: number) => {
      fontVersion();
      const width = containerWidth();
      const turn = props.turns()[index];
      return turn ? estimateTurnHeight(turn, width) : 200;
    },
    followOnAppend: true,
    getItemKey: (index) => props.turns()[index]?.id ?? index,
    getScrollElement: () => scrollEl(),
    overscan: 6,
    scrollEndThreshold: 80,
    anchorTo: "end",
  });

  onMount(() => {
    const el = scrollEl();
    if (!el) {
      return;
    }

    const updateWidth = () => setContainerWidth(el.clientWidth);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    onCleanup(() => observer.disconnect());

    if (props.turns().length > 0) {
      virtualizer.scrollToEnd();
    }

    if (typeof document !== "undefined" && document.fonts) {
      document.fonts.ready.then(() => {
        clearPretextCache();
        setFontVersion((v) => v + 1);
      });
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
                  "padding-bottom": "20px",
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
