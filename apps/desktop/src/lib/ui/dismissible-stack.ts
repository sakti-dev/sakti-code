import { createSignal, onCleanup } from "solid-js";

/**
 * Module-scope dismissible layer stack.
 *
 * Each open dialog pushes its id when mounting and pops on cleanup.
 * Only the topmost layer is considered "visible"; lower layers get
 * `opacity-0 pointer-events-none` applied via reactive CSS.
 *
 * Based on the signal-based approach from sakti-pos — no MutationObserver,
 * no DOM querying. SolidJS reactivity drives everything.
 */

const [stack, setStack] = createSignal<string[]>([]);

export function useDismissibleVisibility(id: string) {
  const isTopmost = () => {
    const s = stack();
    return s.length === 0 || s.at(-1) === id;
  };

  const show = () => {
    setStack((s) => [...s.filter((x) => x !== id), id]);
  };

  const hide = () => {
    setStack((s) => s.filter((x) => x !== id));
  };

  onCleanup(hide);

  return { isTopmost, hide, show };
}
