import { createRoot } from "solid-js";
import type { SessionStore } from "./session-store.ts";
import { createSessionStore } from "./session-store.ts";

export class SessionRegistry {
  private readonly stores = new Map<string, SessionStore>();
  private readonly disposers = new Map<string, () => void>();

  get(sessionId: string): SessionStore {
    let store = this.stores.get(sessionId);
    if (!store) {
      store = createRoot((dispose) => {
        this.disposers.set(sessionId, dispose);
        return createSessionStore();
      });
      this.stores.set(sessionId, store);
    }
    return store;
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
