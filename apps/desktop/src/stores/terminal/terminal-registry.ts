import { createRoot } from "solid-js";
import { createTerminalStore, type TerminalStore } from "./terminal-store.ts";

export class TerminalRegistry {
  private readonly stores = new Map<string, TerminalStore>();
  private readonly disposers = new Map<string, () => void>();

  get(terminalId: string): TerminalStore {
    let store = this.stores.get(terminalId);
    if (!store) {
      store = createRoot((dispose) => {
        this.disposers.set(terminalId, dispose);
        return createTerminalStore();
      });
      this.stores.set(terminalId, store);
    }
    return store;
  }

  has(terminalId: string): boolean {
    return this.stores.has(terminalId);
  }

  dispose(terminalId: string): void {
    this.disposers.get(terminalId)?.();
    this.disposers.delete(terminalId);
    this.stores.delete(terminalId);
  }

  disposeAll(): void {
    for (const dispose of this.disposers.values()) {
      dispose();
    }
    this.disposers.clear();
    this.stores.clear();
  }
}
