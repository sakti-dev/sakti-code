import { createVirtualizer } from "@tanstack/solid-virtual";
import {
  type Accessor,
  createEffect,
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

const NEAR_BOTTOM_THRESHOLD = 100;

export function MessageTimeline(props: MessageTimelineProps): JSX.Element {
  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = createSignal(0);
  const [fontVersion, setFontVersion] = createSignal(0);
  const [pinnedToBottom, setPinnedToBottom] = createSignal(true);

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
    getItemKey: (index) => props.turns()[index]?.id ?? index,
    getScrollElement: () => scrollEl(),
    overscan: 6,
  });

  // Auto-scroll: pin to bottom when streaming and user hasn't scrolled up.
  // Runs in a RAF to ensure DOM (including new content height) is committed.
  createEffect(() => {
    props.turns();
    props.isStreaming();
    if (pinnedToBottom()) {
      requestAnimationFrame(() => {
        const el = scrollEl();
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      });
    }
  });

  onMount(() => {
    const el = scrollEl();
    if (!el) {
      return;
    }

    // observeElementRect may have read dimensions before layout (0×0).
    // Manually set the correct rect and force re-measure.
    virtualizer.scrollRect = {
      width: el.offsetWidth,
      height: el.offsetHeight,
    };
    virtualizer.measure();

    const updateWidth = () => setContainerWidth(el.clientWidth);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    onCleanup(() => observer.disconnect());

    // Track whether user is near the bottom
    const handleScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      setPinnedToBottom(distance < NEAR_BOTTOM_THRESHOLD);
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    onCleanup(() => el.removeEventListener("scroll", handleScroll));

    // Initial scroll to bottom
    if (props.turns().length > 0) {
      el.scrollTop = el.scrollHeight;
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
