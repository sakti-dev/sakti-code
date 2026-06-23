import { createStore } from "solid-js/store";

export interface TerminalStoreData {
  buffer: string;
  cols: number;
  exitCode: number | null;
  rows: number;
}

export interface TerminalStore {
  appendData: (data: string) => void;
  reset: () => void;
  resize: (cols: number, rows: number) => void;
  setExit: (code: number) => void;
  store: TerminalStoreData;
}

export function createTerminalStore(_terminalId: string): TerminalStore {
  const [store, setStore] = createStore<TerminalStoreData>({
    buffer: "",
    exitCode: null,
    cols: 80,
    rows: 24,
  });

  return {
    store,
    appendData(data) {
      setStore("buffer", (prev) => prev + data);
    },
    setExit(code) {
      setStore("exitCode", code);
    },
    resize(cols, rows) {
      setStore("cols", cols);
      setStore("rows", rows);
    },
    reset() {
      setStore("buffer", "");
      setStore("exitCode", null);
    },
  };
}
