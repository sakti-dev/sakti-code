import { type Accessor, createMemo, createSignal, onCleanup } from "solid-js";

export interface VirtualListItem {
  index: number;
  key: string;
  size: number;
  start: number;
}

export interface CreateVirtualListOptions<T> {
  estimateSize: (item: T, index: number) => number;
  getItemKey: (item: T, index: number) => string;
  items: Accessor<readonly T[]>;
  overscan?: number;
}

export interface VirtualListState {
  items: VirtualListItem[];
  totalHeight: number;
}

export interface VirtualListControls {
  bumpMeasure: () => void;
  /** Bump to force layout recompute (e.g. after clearing caches). */
  readonly measureVersion: Accessor<number>;
  /**
   * Observe a visible item element for size correction.
   * Call in a ref callback. Returns a cleanup function for onCleanup.
   */
  observeItem: (el: Element, index: number) => () => void;
  /** Scroll event handler — pass to onScroll. */
  onScroll: (e: Event) => void;
  /** Current scroll element (null until mounted). */
  readonly scrollElement: Accessor<HTMLElement | null>;
  /** Ref callback for the scroll container element. */
  setScrollElement: (el: HTMLElement) => void;
  /** Reactive virtual list state (visible items + total height). */
  state: Accessor<VirtualListState>;
}

interface ItemLayout {
  size: number;
  start: number;
}

export function createVirtualList<T>(
  options: CreateVirtualListOptions<T>
): VirtualListControls {
  const overscan = options.overscan ?? 4;
  const [scrollEl, setScrollEl] = createSignal<HTMLElement | null>(null);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [measureVersion, setMeasureVersion] = createSignal(0);

  // Measured actual sizes from ResizeObserver, keyed by item key.
  const measuredSizes = new Map<string, number>();
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

    const top = st - overscan * 300;
    const bottom = st + viewport + overscan * 300;

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
    last = Math.min(items.length, last + overscan);

    const slice: VirtualListItem[] = [];
    for (let i = first; i < last; i++) {
      const l = items[i];
      const key = keys[i];
      if (l && key) {
        slice.push({ index: i, key, start: l.start, size: l.size });
      }
    }
    return { items: slice, totalHeight };
  });

  // Set up item ResizeObserver lazily (needs to be in reactive scope)
  // but we create it eagerly so observeItem works immediately.
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
        const height =
          entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height;
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

  onCleanup(() => {
    itemObserver?.disconnect();
    measuredSizes.clear();
  });

  return {
    state,
    measureVersion,
    bumpMeasure: () => setMeasureVersion((v) => v + 1),
    scrollElement: scrollEl,
    setScrollElement: (el: HTMLElement) => setScrollEl(el),
    onScroll: (e: Event) => {
      const target = e.currentTarget as HTMLElement;
      setScrollTop(target.scrollTop);
    },
    observeItem: (el: Element, index: number) => {
      el.setAttribute("data-virtual-index", String(index));
      itemObserver?.observe(el);
      return () => itemObserver?.unobserve(el);
    },
  };
}
