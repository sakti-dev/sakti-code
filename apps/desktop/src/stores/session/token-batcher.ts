export interface TokenBatcher {
  append: (messageId: string, delta: string) => void;
  dispose: () => void;
}

export interface TokenBatcherOptions {
  /** When false, each append flushes immediately (no microtask batching). */
  batch?: boolean;
}

/**
 * Batches high-frequency text deltas by message ID.
 * Flushes accumulated text on the next microtask,
 * collapsing N append calls into one callback per message.
 *
 * Pass `{ batch: false }` to flush every delta synchronously
 * (useful for debugging streaming at full granularity).
 */
export function createTokenBatcher(
  onFlush: (messageId: string, accumulatedText: string) => void,
  options?: TokenBatcherOptions,
): TokenBatcher {
  const batch = options?.batch ?? true;

  if (!batch) {
    return {
      append(messageId, delta) {
        onFlush(messageId, delta);
      },
      dispose() {
        /* no-op — no buffer to clear in unbatched mode */
      },
    };
  }

  const buffer = new Map<string, string>();
  let scheduled = false;

  function flush(): void {
    scheduled = false;
    for (const [id, text] of buffer) {
      onFlush(id, text);
    }
    buffer.clear();
  }

  return {
    append(messageId: string, delta: string): void {
      buffer.set(messageId, (buffer.get(messageId) ?? "") + delta);
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    },
    dispose(): void {
      buffer.clear();
      scheduled = false;
    },
  };
}
