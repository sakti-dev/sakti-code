import { createTerminalStore, type TerminalStore } from "./terminal-store.ts";

const registry = new Map<string, TerminalStore>();

export function getTerminalStore(terminalId: string): TerminalStore {
  let store = registry.get(terminalId);
  if (!store) {
    store = createTerminalStore(terminalId);
    registry.set(terminalId, store);
  }
  return store;
}

export function disposeTerminalStore(terminalId: string): void {
  registry.delete(terminalId);
}
