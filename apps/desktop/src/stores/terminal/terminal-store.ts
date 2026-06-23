import { createStore } from "solid-js/store";

const MAX_BUFFER_CHARS = 512_000;

export interface TerminalStoreData {
  bufferLength: number;
  cols: number;
  exitCode: number | null;
  rows: number;
}

export interface TerminalStore {
  appendData: (data: string) => void;
  readonly buffer: string;
  reset: () => void;
  resize: (cols: number, rows: number) => void;
  setExit: (code: number) => void;
  store: TerminalStoreData;
}

export function createTerminalStore(): TerminalStore {
  let buffer = "";

  const [store, setStore] = createStore<TerminalStoreData>({
    bufferLength: 0,
    exitCode: null,
    cols: 80,
    rows: 24,
  });

  return {
    store,
    get buffer() {
      return buffer;
    },
    appendData(data) {
      buffer += data;
      if (buffer.length > MAX_BUFFER_CHARS) {
        buffer = buffer.slice(-Math.floor(MAX_BUFFER_CHARS / 2));
      }
      setStore("bufferLength", buffer.length);
    },
    setExit(code) {
      setStore("exitCode", code);
    },
    resize(cols, rows) {
      setStore("cols", cols);
      setStore("rows", rows);
    },
    reset() {
      buffer = "";
      setStore("bufferLength", 0);
      setStore("exitCode", null);
    },
  };
}
