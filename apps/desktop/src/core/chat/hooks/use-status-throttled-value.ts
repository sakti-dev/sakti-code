import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";

/**
 * Throttles status label changes so each visible status remains on screen
 * for at least minIntervalMs to reduce flicker during rapid streaming updates.
 */
export function useStatusThrottledValue<T>(
  value: Accessor<T | undefined>,
  minIntervalMs: number
): Accessor<T | undefined> {
  const [throttled, setThrottled] = createSignal<T | undefined>(value());
  let lastChangeAt = Date.now();

  createEffect(() => {
    const next = value();
    const current = throttled();

    if (next === current || next === undefined) {
      return;
    }

    const now = Date.now();
    const elapsed = now - lastChangeAt;

    if (minIntervalMs <= 0 || elapsed >= minIntervalMs) {
      setThrottled(() => next);
      lastChangeAt = now;
      return;
    }

    const timeout = setTimeout(() => {
      const latest = value();
      if (latest !== undefined) {
        setThrottled(() => latest);
        lastChangeAt = Date.now();
      }
    }, minIntervalMs - elapsed);

    onCleanup(() => clearTimeout(timeout));
  });

  return throttled;
}
