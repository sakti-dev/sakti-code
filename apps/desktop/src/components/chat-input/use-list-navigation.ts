import { createEffect, createSignal } from "solid-js";

export interface ListNavigationOptions<T> {
  onClose?: () => void;
  onPick?: (item: T) => void;
}

/**
 * Keyboard navigation for a flat command-palette list: ArrowUp/Down move with
 * wrap-around, Enter picks the active item, Escape closes. Generalizes the
 * pattern hand-rolled in model-seletor/hooks.ts. No virtualization (callers
 * keep lists small; the files endpoint caps at 20).
 */
export function useListNavigation<T extends { id: string }>(
  items: () => T[],
  options: ListNavigationOptions<T> = {}
) {
  const [activeIndex, setActiveIndex] = createSignal(0);

  // Reset to 0 whenever the item set changes shape.
  createEffect(() => {
    items();
    setActiveIndex(0);
  });

  const handleKeyDown = (event: KeyboardEvent) => {
    const list = items();
    const n = list.length;
    if (n === 0) {
      return;
    }
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % n);
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + n) % n);
        break;
      }
      case "Enter": {
        event.preventDefault();
        const item = list[activeIndex()];
        if (item) {
          options.onPick?.(item);
        }
        break;
      }
      case "Escape": {
        event.preventDefault();
        options.onClose?.();
        break;
      }
    }
  };

  const isActive = (id: string) => items()[activeIndex()]?.id === id;

  return { activeIndex, handleKeyDown, isActive };
}
