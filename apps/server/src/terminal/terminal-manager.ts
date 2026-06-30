import type { IPty } from "node-pty";

export interface ManagedTerminal {
  connectionId: string;
  createdAt: number;
  pid: number;
  pty: IPty;
  terminalId: string;
}

export type TerminalDataCallback = (terminalId: string, connectionId: string, data: string) => void;
export type TerminalExitCallback = (
  terminalId: string,
  connectionId: string,
  exitCode: number,
  signal?: number | string,
) => void;

let ptySpawnFn:
  | ((
      file: string,
      args: string[],
      options: {
        cwd?: string;
        cols?: number;
        rows?: number;
        name: string;
        env?: Record<string, string>;
      },
    ) => IPty)
  | null = null;
let ptyLoadError: string | null = null;
let ptyLoadPromise: Promise<void> | null = null;

async function loadPty(): Promise<void> {
  if (ptySpawnFn !== null || ptyLoadError !== null || ptyLoadPromise) {
    return;
  }
  ptyLoadPromise = (async () => {
    try {
      const ptyMod = await import("node-pty");
      ptySpawnFn = ptyMod.spawn;
    } catch (err) {
      ptyLoadError = err instanceof Error ? err.message : "Failed to load node-pty";
    }
  })();
  await ptyLoadPromise;
}

loadPty();

export class TerminalManager {
  private readonly terminals = new Map<string, ManagedTerminal>();
  private onDataCallback: TerminalDataCallback | null = null;
  private onExitCallback: TerminalExitCallback | null = null;

  async ensureLoaded(): Promise<void> {
    if (ptyLoadPromise) {
      await ptyLoadPromise;
    }
  }

  get ptyAvailable(): boolean {
    return ptySpawnFn !== null;
  }

  get loadError(): string | null {
    return ptyLoadError;
  }

  set onData(cb: TerminalDataCallback | null) {
    this.onDataCallback = cb;
  }

  set onExit(cb: TerminalExitCallback | null) {
    this.onExitCallback = cb;
  }

  create(
    connectionId: string,
    opts: { cwd?: string; cols?: number; rows?: number } = {},
  ): { terminalId: string; pid: number } {
    if (!ptySpawnFn) {
      throw new Error(`Terminal unavailable: ${ptyLoadError ?? "node-pty not loaded"}`);
    }

    const terminalId = crypto.randomUUID();
    const pty = ptySpawnFn("/bin/sh", [], {
      cwd: opts.cwd ?? process.cwd(),
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      name: "xterm-256color",
    });

    const managed: ManagedTerminal = {
      terminalId,
      connectionId,
      pty,
      pid: pty.pid,
      createdAt: Date.now(),
    };

    this.terminals.set(terminalId, managed);

    pty.onData((data: string) => {
      if (this.onDataCallback) {
        this.onDataCallback(terminalId, connectionId, data);
      }
    });

    pty.onExit((event) => {
      this.terminals.delete(terminalId);
      if (this.onExitCallback) {
        this.onExitCallback(terminalId, connectionId, event.exitCode, event.signal);
      }
    });

    return { terminalId, pid: pty.pid };
  }

  write(terminalId: string, data: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      throw new Error("Terminal not found");
    }
    terminal.pty.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      throw new Error("Terminal not found");
    }
    terminal.pty.resize(cols, rows);
  }

  close(terminalId: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      throw new Error("Terminal not found");
    }
    terminal.pty.kill();
    this.terminals.delete(terminalId);
  }

  closeByConnection(connectionId: string): void {
    const ids: string[] = [];
    for (const [id, terminal] of this.terminals) {
      if (terminal.connectionId === connectionId) {
        ids.push(id);
      }
    }
    for (const id of ids) {
      const terminal = this.terminals.get(id);
      if (terminal) {
        terminal.pty.kill();
        this.terminals.delete(id);
      }
    }
  }

  closeAll(): void {
    const ids = Array.from(this.terminals.keys());
    for (const id of ids) {
      const terminal = this.terminals.get(id);
      if (terminal) {
        terminal.pty.kill();
        this.terminals.delete(id);
      }
    }
  }

  get(terminalId: string): ManagedTerminal | undefined {
    return this.terminals.get(terminalId);
  }

  get size(): number {
    return this.terminals.size;
  }
}
