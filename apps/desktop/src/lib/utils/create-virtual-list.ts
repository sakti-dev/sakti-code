import { type Accessor, createEffect, createMemo, createSignal, onCleanup } from "solid-js";

export interface VirtualListItem {
  index: number;
  key: string;
  size: number;
  start: number;
}

export interface CreateVirtualListOptions<T> {
  estimateSize: (item: T, index: number) => number;
  /**
   * Enable follow-to-bottom behavior. When enabled, the hook tracks
   * whether the user is following the latest content and automatically
   * scrolls to the new bottom when items change or sizes are corrected.
   *
   * - `true` — use default threshold (150px)
   * - `{ threshold: number }` — custom threshold
   * - omitted / `false` — disabled
   */
  follow?: boolean | { threshold?: number };
  getItemKey: (item: T, index: number) => string;
  items: Accessor<readonly T[]>;
  overscan?: number;
}

export interface VirtualListState {
  items: VirtualListItem[];
  totalHeight: number;
}

export interface VirtualListControls {
  /** Bump to force layout recompute (e.g. after clearing caches). */
  bumpMeasure: () => void;
  /** Whether the user is following the bottom (always true when follow is off). */
  isFollowing: () => boolean;
  /** Reactive signal that bumps when sizes are corrected. Use as a trigger dep. */
  readonly measureVersion: Accessor<number>;
  /**
   * Observe a visible item element for size correction.
   * Call in a ref callback. Returns a cleanup function for onCleanup.
   */
  observeItem: (el: Element, index: number) => () => void;
  /** Current scroll element (null until mounted). */
  readonly scrollElement: Accessor<HTMLElement | null>;
  /** Imperatively scroll to the bottom. */
  scrollToBottom: () => void;
  /** Ref callback for the scroll container element. */
  setScrollElement: (el: HTMLElement) => void;
  /** Reactive virtual list state (visible items + total height). */
  state: Accessor<VirtualListState>;
}

interface ItemLayout {
  size: number;
  start: number;
}

interface VisibleRange {
  first: number;
  last: number;
}

function computeVisibleRange(
  items: ItemLayout[],
  scrollTop: number,
  viewport: number,
  overscan: number,
): VisibleRange {
  const top = scrollTop - overscan * 300;
  const bottom = scrollTop + viewport + overscan * 300;

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
  const first = Math.max(0, lo - overscan);

  let last = first;
  while (last < items.length) {
    const item = items[last];
    if (!item || item.start > bottom) {
      break;
    }
    last++;
  }
  return { first, last: Math.min(items.length, last + overscan) };
}

export function createVirtualList<T>(options: CreateVirtualListOptions<T>): VirtualListControls {
  const overscan = options.overscan ?? 4;
  const followEnabled = options.follow !== undefined && options.follow !== false;
  const followThreshold =
    typeof options.follow === "object" ? (options.follow.threshold ?? 150) : 150;

  const [scrollEl, setScrollEl] = createSignal<HTMLElement | null>(null);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [measureVersion, setMeasureVersion] = createSignal(0);

  let userFollowing = true;
  let selfScrolling = false;

  // Measured actual sizes from ResizeObserver, keyed by item key.
  const measuredSizes = new Map<string, number>();
  // Cached VirtualListItem objects so <For> sees stable references.
  const itemCache = new Map<string, { index: number; key: string; size: number; start: number }>();
  let itemObserver: ResizeObserver | undefined;

  // Layout: accumulated starts for all items.
  const layout = createMemo<{
    items: ItemLayout[];
    keys: string[];
    totalHeight: number;
  }>(() => {
    measureVersion();
    const items = options.items();
    const layouts: ItemLayout[] = [];
    const keys: string[] = [];
    let acc = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) {
        continue;
      }
      const key = options.getItemKey(item, i);
      keys.push(key);
      const size = measuredSizes.get(key) ?? options.estimateSize(item, i);
      layouts.push({ start: acc, size });
      acc += size;
    }
    return { items: layouts, keys, totalHeight: acc };
  });

  // Visible range via binary search on accumulated starts.
  const state = createMemo<VirtualListState>(() => {
    const { items, keys, totalHeight } = layout();
    const st = scrollTop();
    const viewport = scrollEl()?.clientHeight ?? 0;
    if (items.length === 0 || viewport === 0) {
      return { items: [], totalHeight };
    }

    const { first, last } = computeVisibleRange(items, st, viewport, overscan);

    const slice: VirtualListItem[] = [];
    for (let i = first; i < last; i++) {
      const l = items[i];
      const key = keys[i];
      if (!(l && key)) {
        continue;
      }
      const cached = itemCache.get(key);
      if (cached && cached.index === i && cached.start === l.start && cached.size === l.size) {
        slice.push(cached);
      } else {
        const obj: VirtualListItem = {
          index: i,
          key,
          start: l.start,
          size: l.size,
        };
        itemCache.set(key, obj);
        slice.push(obj);
      }
    }
    return { items: slice, totalHeight };
  });

  // Item ResizeObserver for size correction.
  if (typeof ResizeObserver !== "undefined") {
    itemObserver = new ResizeObserver((entries) => {
      let changed = false;
      const items = options.items();
      for (const entry of entries) {
        const index = Number(entry.target.getAttribute("data-virtual-index"));
        const item = items[index];
        if (!item) {
          continue;
        }
        const key = options.getItemKey(item, index);
        const height = entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height;
        if (height > 0 && measuredSizes.get(key) !== height) {
          measuredSizes.set(key, height);
          changed = true;
        }
      }
      if (changed) {
        setMeasureVersion((v) => v + 1);
      }
    });
  }

  // Internal scroll listener — always tracks scrollTop for visible range.
  // When follow is enabled, also tracks userFollowing/selfScrolling.
  createEffect(() => {
    const el = scrollEl();
    if (!el) {
      return;
    }
    const handleScroll = () => {
      setScrollTop(el.scrollTop);
      if (!followEnabled) {
        return;
      }
      if (selfScrolling) {
        selfScrolling = false;
        return;
      }
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      userFollowing = distance < followThreshold;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    onCleanup(() => el.removeEventListener("scroll", handleScroll));
  });

  // Follow effect — snap to bottom in RAF when following.
  // Depends on items (new content) + measureVersion (size corrections).
  if (followEnabled) {
    createEffect(() => {
      options.items();
      measureVersion();
      requestAnimationFrame(() => {
        const el = scrollEl();
        if (!(el && userFollowing)) {
          return;
        }
        selfScrolling = true;
        el.scrollTop = el.scrollHeight;
      });
    });
  }

  onCleanup(() => {
    itemObserver?.disconnect();
    measuredSizes.clear();
    itemCache.clear();
  });

  return {
    state,
    measureVersion,
    bumpMeasure: () => setMeasureVersion((v) => v + 1),
    scrollElement: scrollEl,
    setScrollElement: (el: HTMLElement) => setScrollEl(el),
    observeItem: (el: Element, index: number) => {
      el.setAttribute("data-virtual-index", String(index));
      itemObserver?.observe(el);
      return () => itemObserver?.unobserve(el);
    },
    scrollToBottom: () => {
      const el = scrollEl();
      if (el) {
        if (followEnabled) {
          selfScrolling = true;
        }
        el.scrollTop = el.scrollHeight;
      }
    },
    isFollowing: () => userFollowing,
  };
}
