/**
 * VirtualizedList Component
 *
 * Efficiently renders large lists by only showing visible items.
 * Uses @solid-primitives/virtual for performant virtualization.
 *
 * Part of Phase 6: Cleanup & Optimization
 */

import { VirtualList } from "@solid-primitives/virtual";
import { Accessor, JSX } from "solid-js";

export interface VirtualListProps<T> {
  /** Accessor for the items to render */
  items: Accessor<T[]>;
  /** Fixed height for each item (in pixels) */
  itemSize: number;
  /** Height of the container (in pixels) */
  containerHeight: number;
  /** Render function for each item */
  children: (item: T, index: Accessor<number>) => JSX.Element;
  /** Number of extra items to render outside viewport (default: 1) */
  overscan?: number;
}

/**
 * Virtualized list component for efficient rendering of large lists
 *
 * @example
 * ```tsx
 * const [items] = createSignal([...]); // 1000+ items
 *
 * <VirtualizedList
 *   items={items}
 *   itemSize={50}
 *   containerHeight={600}
 *   overscan={5}
 *   children={(item) => <div>{item.name}</div>}
 * />
 * ```
 */
export const VirtualizedList = <T,>(props: VirtualListProps<T>) => {
  return (
    <VirtualList
      each={props.items()}
      fallback={null}
      rootHeight={props.containerHeight}
      rowHeight={props.itemSize}
      overscanCount={props.overscan ?? 3}
      children={props.children}
    />
  );
};
