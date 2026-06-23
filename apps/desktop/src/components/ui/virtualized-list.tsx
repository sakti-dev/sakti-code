import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  type JSX,
} from "solid-js";

export interface VirtualListProps<T> {
  children: (item: T, index: Accessor<number>) => JSX.Element;
  containerHeight: number;
  itemSize: number;
  items: Accessor<T[]>;
  overscan?: number;
}

export const VirtualizedList = <T,>(props: VirtualListProps<T>) => {
  const [scrollTop, setScrollTop] = createSignal(0);
  const overscan = createMemo(() => props.overscan ?? 3);
  const visibleWindow = createMemo(() => {
    const items = props.items();
    const start = Math.max(
      0,
      Math.floor(scrollTop() / props.itemSize) - overscan()
    );
    const end = Math.min(
      items.length,
      Math.ceil((scrollTop() + props.containerHeight) / props.itemSize) +
        overscan()
    );
    return { start, end, items };
  });

  const totalHeight = createMemo(() => props.items().length * props.itemSize);

  return (
    <div
      class="overflow-y-auto"
      data-component="virtualized-list"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      style={{ height: `${props.containerHeight}px` }}
    >
      <div class="relative w-full" style={{ height: `${totalHeight()}px` }}>
        <For
          each={visibleWindow().items.slice(
            visibleWindow().start,
            visibleWindow().end
          )}
        >
          {(item, localIndex) => {
            const absoluteIndex = () => visibleWindow().start + localIndex();
            return (
              <div
                class="absolute right-0 left-0"
                style={{
                  top: `${absoluteIndex() * props.itemSize}px`,
                  height: `${props.itemSize}px`,
                }}
              >
                {props.children(item, absoluteIndex)}
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};
