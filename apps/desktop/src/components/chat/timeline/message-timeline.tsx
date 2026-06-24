import {
  type Accessor,
  createEffect,
  createMemo,
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

const NEAR_BOTTOM_THRESHOLD = 150;
const OVERSCAN = 4;

interface ItemLayout {
  size: number;
  start: number;
}

interface VisibleItem {
  index: number;
  layout: ItemLayout;
}

export function MessageTimeline(props: MessageTimelineProps): JSX.Element {
  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = createSignal(0);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [measureVersion, setMeasureVersion] = createSignal(0);

  let userPinned = true;
  let selfScrolling = false;

  // Measured actual sizes from ResizeObserver, keyed by turn id.
  const measuredSizes = new Map<string, number>();
  let itemObserver: ResizeObserver | undefined;

  // Layout: accumulated starts for all turns.
  const layout = createMemo<{ items: ItemLayout[]; totalHeight: number }>(
    () => {
      measureVersion();
      const turns = props.turns();
      const width = containerWidth();
      const items: ItemLayout[] = [];
      let acc = 0;
      for (const turn of turns) {
        const size =
          measuredSizes.get(turn.id) ?? estimateTurnHeight(turn, width);
        items.push({ start: acc, size });
        acc += size;
      }
      return { items, totalHeight: acc };
    }
  );

  // Visible range via binary search on accumulated starts.
  const visible = createMemo<{ items: VisibleItem[]; totalHeight: number }>(
    () => {
      const { items, totalHeight } = layout();
      const st = scrollTop();
      const viewport = scrollEl()?.clientHeight ?? 0;
      if (items.length === 0 || viewport === 0) {
        return { items: [], totalHeight };
      }

      const top = st - OVERSCAN * 300;
      const bottom = st + viewport + OVERSCAN * 300;

      let lo = 0;
      let hi = items.length;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        const item = items[mid];
        if (item && item.start + item.size < top) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      const first = Math.max(0, lo - OVERSCAN);

      let last = first;
      while (last < items.length) {
        const item = items[last];
        if (!item || item.start > bottom) {
          break;
        }
        last++;
      }
      last = Math.min(items.length, last + OVERSCAN);

      const slice: VisibleItem[] = [];
      for (let i = first; i < last; i++) {
        const l = items[i];
        if (l) {
          slice.push({ index: i, layout: l });
        }
      }
      return { items: slice, totalHeight };
    }
  );

  // Auto-scroll: snap to bottom in RAF when user is pinned.
  // Depends on both turns (new content) and measureVersion (size corrections
  // from ResizeObserver — e.g. when a big markdown block is measured taller
  // than the Pretext estimate, the inner div grows and we need to re-scroll).
  createEffect(() => {
    props.turns();
    measureVersion();
    requestAnimationFrame(() => {
      const el = scrollEl();
      if (!(el && userPinned)) {
        return;
      }
      selfScrolling = true;
      el.scrollTop = el.scrollHeight;
    });
  });

  onMount(() => {
    const el = scrollEl();
    if (!el) {
      return;
    }

    const updateWidth = () => setContainerWidth(el.clientWidth);
    updateWidth();

    const widthObserver = new ResizeObserver(updateWidth);
    widthObserver.observe(el);
    onCleanup(() => widthObserver.disconnect());

    itemObserver = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const index = Number(entry.target.getAttribute("data-index"));
        const turn = props.turns()[index];
        if (!turn) {
          continue;
        }
        const height =
          entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height;
        const prev = measuredSizes.get(turn.id);
        if (height > 0 && prev !== height) {
          measuredSizes.set(turn.id, height);
          changed = true;
        }
      }
      if (changed) {
        setMeasureVersion((v) => v + 1);
      }
    });
    onCleanup(() => {
      itemObserver?.disconnect();
      measuredSizes.clear();
    });

    el.addEventListener(
      "scroll",
      () => {
        setScrollTop(el.scrollTop);
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
        measuredSizes.clear();
        setMeasureVersion((v) => v + 1);
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
            height: `${visible().totalHeight}px`,
            position: "relative",
            width: "100%",
          }}
        >
          <For each={visible().items}>
            {(item) => (
              <div
                data-index={item.index}
                ref={(el: HTMLDivElement) => {
                  itemObserver?.observe(el);
                  onCleanup(() => itemObserver?.unobserve(el));
                }}
                style={{
                  left: 0,
                  "padding-bottom": "20px",
                  position: "absolute",
                  top: 0,
                  transform: `translateY(${item.layout.start}px)`,
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
