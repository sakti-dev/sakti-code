export interface TokenBatcher {
  append: (messageId: string, delta: string) => void;
  dispose: () => void;
}

/**
 * Batches high-frequency text deltas by message ID.
 * Flushes accumulated text on the next microtask,
 * collapsing N append calls into one callback per message.
 */
export function createTokenBatcher(
  onFlush: (messageId: string, accumulatedText: string) => void
): TokenBatcher {
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
