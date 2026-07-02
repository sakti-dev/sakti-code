import { createRoot } from "solid-js";
import type { SessionStore } from "./session-store.ts";
import { createSessionStore } from "./session-store.ts";

const DEFAULT_LRU_CAP = 3;

export class SessionRegistry {
  /** Map insertion order = LRU recency order (oldest first). */
  private readonly stores = new Map<string, SessionStore>();
  private readonly disposers = new Map<string, () => void>();
  private readonly cap: number;

  constructor(opts: { cap?: number } = {}) {
    this.cap = opts.cap ?? DEFAULT_LRU_CAP;
  }

  /**
   * Get-or-create a session store. Access refreshes recency (most-recently-used
   * survives eviction). When the cap is exceeded the least-recently-used store
   * is disposed — its reactive root is torn down and history is dropped. The
   * caller is responsible for re-loading history on a subsequent access.
   */
  get(sessionId: string): SessionStore {
    const existing = this.stores.get(sessionId);
    if (existing) {
      this.stores.delete(sessionId);
      this.stores.set(sessionId, existing);
      return existing;
    }
    const store = createRoot((dispose) => {
      this.disposers.set(sessionId, dispose);
      return createSessionStore();
    });
    this.stores.set(sessionId, store);
    this.evictIfNeeded();
    return store;
  }

  private evictIfNeeded(): void {
    while (this.stores.size > this.cap) {
      const oldestId = this.stores.keys().next().value;
      if (oldestId === undefined) {
        break;
      }
      this.dispose(oldestId);
    }
  }

  has(sessionId: string): boolean {
    return this.stores.has(sessionId);
  }

  dispose(sessionId: string): void {
    this.disposers.get(sessionId)?.();
    this.disposers.delete(sessionId);
    this.stores.delete(sessionId);
  }

  disposeAll(): void {
    for (const dispose of this.disposers.values()) {
      dispose();
    }
    this.disposers.clear();
    this.stores.clear();
  }
}
