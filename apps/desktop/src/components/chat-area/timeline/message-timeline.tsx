import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { cn } from "~/lib/utils";
import type { VirtualListItem } from "~/lib/utils/create-virtual-list";
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

export function MessageTimeline(props: MessageTimelineProps): JSX.Element {
  const [containerWidth, setContainerWidth] = createSignal(0);

  const virtual = createVirtualList<ChatTurn>({
    follow: { threshold: 150 },
    estimateSize: (turn) => estimateTurnHeight(turn, containerWidth()),
    getItemKey: (turn) => turn.id,
    items: props.turns,
    overscan: 4,
  });

  // Derive stable key strings + a lookup map from the virtual list state.
  // <For> compares items by reference — strings are primitives (=== by value),
  // so items with the same key survive state recomputes without DOM recreation.
  const visibleKeys = createMemo(() => virtual.state().items.map((i) => i.key));
  const itemByKey = createMemo(() => {
    const map = new Map<string, VirtualListItem>();
    for (const item of virtual.state().items) {
      map.set(item.key, item);
    }
    return map;
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

    if (props.turns().length > 0) {
      virtual.scrollToBottom();
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
          <For each={visibleKeys()}>
            {(key) => {
              const item = () => itemByKey().get(key);
              return (
                <div
                  ref={(el: HTMLDivElement) => {
                    const i = item();
                    if (i) {
                      onCleanup(virtual.observeItem(el, i.index));
                    }
                  }}
                  style={{
                    left: 0,
                    "padding-bottom": "20px",
                    position: "absolute",
                    top: 0,
                    transform: `translateY(${item()?.start ?? 0}px)`,
                    width: "100%",
                  }}
                >
                  <Show when={item()}>
                    {(i) => (
                      <Show when={props.turns()[i().index]}>
                        {(turn) => <SessionTurn isStreaming={props.isStreaming} turn={turn} />}
                      </Show>
                    )}
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
