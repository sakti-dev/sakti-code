import { createTerminalStore, type TerminalStore } from "./terminal-store.ts";

export class TerminalRegistry {
  private readonly stores = new Map<string, TerminalStore>();

  get(terminalId: string): TerminalStore {
    let store = this.stores.get(terminalId);
    if (!store) {
      store = createTerminalStore(terminalId);
      this.stores.set(terminalId, store);
    }
    return store;
  }

  has(terminalId: string): boolean {
    return this.stores.has(terminalId);
  }

  dispose(terminalId: string): void {
    this.stores.delete(terminalId);
  }

  disposeAll(): void {
    this.stores.clear();
  }
}
