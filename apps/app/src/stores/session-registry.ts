import type { SessionStore } from "./session-store.ts";
import { createSessionStore } from "./session-store.ts";

export class SessionRegistry {
  private readonly stores = new Map<string, SessionStore>();

  get(sessionId: string): SessionStore {
    let store = this.stores.get(sessionId);
    if (!store) {
      store = createSessionStore(sessionId);
      this.stores.set(sessionId, store);
    }
    return store;
  }

  has(sessionId: string): boolean {
    return this.stores.has(sessionId);
  }

  dispose(sessionId: string): void {
    this.stores.delete(sessionId);
  }

  disposeAll(): void {
    this.stores.clear();
  }
}
