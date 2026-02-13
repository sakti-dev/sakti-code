/**
 * useThrottledValue Hook
 *
 * Throttles value updates to reduce re-renders during streaming.
 * Returns the initial value immediately, then throttles subsequent updates.
 */

import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";

/**
 * Throttles value changes to reduce update frequency
 *
 * @param value - Accessor for the value to throttle
 * @param throttleMs - Minimum time between updates in milliseconds
 * @returns Accessor for the throttled value
 *
 * @example
 * ```tsx
 * const [text, setText] = createSignal("initial");
 * const throttled = useThrottledValue(text, 100);
 *
 * setText("rapid update 1");
 * setText("rapid update 2");
 * // throttled() still returns "initial" until 100ms passes
 * ```
 */
export function useThrottledValue<T>(value: Accessor<T>, throttleMs: number): Accessor<T> {
  const [throttled, setThrottled] = createSignal<T>(value());
  let lastUpdateAt = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let pendingValue: T | undefined;

  createEffect(() => {
    const next = value();
    if (throttleMs <= 0) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      pendingValue = undefined;
      lastUpdateAt = Date.now();
      setThrottled(() => next);
      return;
    }

    const now = Date.now();
    const elapsed = now - lastUpdateAt;

    if (lastUpdateAt === 0 || elapsed >= throttleMs) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      pendingValue = undefined;
      lastUpdateAt = now;
      setThrottled(() => next);
      return;
    }

    pendingValue = next;
    if (timeout) return;

    timeout = setTimeout(() => {
      if (pendingValue !== undefined) {
        setThrottled(() => pendingValue as T);
        pendingValue = undefined;
        lastUpdateAt = Date.now();
      }
      timeout = undefined;
    }, throttleMs - elapsed);
  });

  onCleanup(() => {
    if (timeout) clearTimeout(timeout);
  });

  return throttled;
}
