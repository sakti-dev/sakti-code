import type { SessionStore } from "./session-store.ts";
import { createSessionStore } from "./session-store.ts";

const registry = new Map<string, SessionStore>();

export function getSessionStore(sessionId: string): SessionStore {
  let store = registry.get(sessionId);
  if (!store) {
    store = createSessionStore(sessionId);
    registry.set(sessionId, store);
  }
  return store;
}

export function hasSessionStore(sessionId: string): boolean {
  return registry.has(sessionId);
}

export function disposeSessionStore(sessionId: string): void {
  registry.delete(sessionId);
}
