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
import { createVirtualList } from "~/lib/utils/create-virtual-list";
import type { ChatTurn } from "~/stores/session/turn-projection";
import { CHAT_TIMELINE_CLASS } from "../layout";
import { clearPretextCache, estimateTurnHeight } from "./estimate-turn-height";
import { SessionTurn } from "./session-turn";

export interface MessageTimelineProps {
  class?: string;
  isStreaming: Accessor<boolean>;
  turns: Accessor<ChatTurn[]>;
}

const NEAR_BOTTOM_THRESHOLD = 150;

export function MessageTimeline(props: MessageTimelineProps): JSX.Element {
  const [containerWidth, setContainerWidth] = createSignal(0);

  let userPinned = true;
  let selfScrolling = false;

  const virtual = createVirtualList<ChatTurn>({
    items: props.turns,
    estimateSize: (turn) => estimateTurnHeight(turn, containerWidth()),
    getItemKey: (turn) => turn.id,
    overscan: 4,
  });

  // Auto-scroll: snap to bottom in RAF when user is pinned.
  // Depends on both turns (new content) and measureVersion (size corrections
  // from ResizeObserver — when a big markdown block is measured taller than
  // the Pretext estimate, the inner div grows and we need to re-scroll).
  createEffect(() => {
    props.turns();
    virtual.measureVersion();
    requestAnimationFrame(() => {
      const el = virtual.scrollElement();
      if (!(el && userPinned)) {
        return;
      }
      selfScrolling = true;
      el.scrollTop = el.scrollHeight;
    });
  });

  onMount(() => {
    const el = virtual.scrollElement();
    if (!el) {
      return;
    }

    const updateWidth = () => setContainerWidth(el.clientWidth);
    updateWidth();

    const widthObserver = new ResizeObserver(updateWidth);
    widthObserver.observe(el);
    onCleanup(() => widthObserver.disconnect());

    el.addEventListener(
      "scroll",
      () => {
        if (selfScrolling) {
          selfScrolling = false;
          return;
        }
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        userPinned = distance < NEAR_BOTTOM_THRESHOLD;
      },
      { passive: true }
    );

    if (props.turns().length > 0) {
      el.scrollTop = el.scrollHeight;
    }

    if (typeof document !== "undefined" && document.fonts) {
      document.fonts.ready.then(() => {
        clearPretextCache();
        virtual.bumpMeasure();
      });
    }
  });

  return (
    <div
      aria-live="polite"
      class={cn(CHAT_TIMELINE_CLASS, props.class)}
      ref={virtual.setScrollElement}
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
            height: `${virtual.state().totalHeight}px`,
            position: "relative",
            width: "100%",
          }}
        >
          <For each={virtual.state().items}>
            {(item) => (
              <div
                ref={(el: HTMLDivElement) =>
                  onCleanup(virtual.observeItem(el, item.index))
                }
                style={{
                  left: 0,
                  "padding-bottom": "20px",
                  position: "absolute",
                  top: 0,
                  transform: `translateY(${item.start}px)`,
                  width: "100%",
                }}
              >
                <Show when={props.turns()[item.index]}>
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
