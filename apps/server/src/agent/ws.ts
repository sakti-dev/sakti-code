import { readFileSync } from "node:fs";
import { SqliteSessionStore } from "@sakti-code/db";
import { Elysia } from "elysia";
import type { ServerContext } from "../context.ts";
import type { WsHandle, WsIn } from "./ws-handler.ts";
import { handleMessage } from "./ws-handler.ts";

// ── Server version (read once from package.json) ──

export const SERVER_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf-8")
    );
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

export function createWelcomeFrame(): string {
  return JSON.stringify({
    type: "welcome",
    version: SERVER_VERSION,
    cwd: process.cwd(),
  });
}

// ── Connection-scoped stores ──

const connectionStores = new Map<string, SqliteSessionStore>();

function getOrCreateStore(
  wsId: string,
  db: ServerContext["db"]
): SqliteSessionStore {
  let store = connectionStores.get(wsId);
  if (!store) {
    store = new SqliteSessionStore(db);
    connectionStores.set(wsId, store);
  }
  return store;
}

// ── Terminal push: WS connections keyed by connection ID ──

const wsConnections = new Map<string, WsHandle>();

/** Whether a WS connection with the given id is currently open. */
export function hasWsConnection(connectionId: string): boolean {
  return wsConnections.has(connectionId);
}

export function pushToConnection(connectionId: string, data: unknown) {
  const ws = wsConnections.get(connectionId);
  if (ws) {
    ws.send(JSON.stringify(data));
  }
}

// Test-only seams over the connection map so terminal-push behavior can be
// exercised without a real WS round-trip.
export function registerTestConnection(connectionId: string, ws: WsHandle) {
  wsConnections.set(connectionId, ws);
}

export function unregisterTestConnection(connectionId: string) {
  wsConnections.delete(connectionId);
}

// ── Wire terminal manager callbacks (called once during setup) ──

function wireTerminalCallbacks(ctx: ServerContext) {
  ctx.terminalManager.onData = (terminalId, connectionId, data) => {
    pushToConnection(connectionId, {
      type: "push",
      channel: "terminal.data",
      data: { terminalId, data },
    });
  };
  ctx.terminalManager.onExit = (terminalId, connectionId, exitCode, signal) => {
    pushToConnection(connectionId, {
      type: "push",
      channel: "terminal.exit",
      data: {
        terminalId,
        exitCode,
        ...(signal === undefined ? {} : { signal }),
      },
    });
  };
}

// ── Elysia WS lifecycle handler ──

let terminalCallbacksWired = false;

export function buildWsApp() {
  return new Elysia({ name: "ws" }).ws("/ws", {
    open(ws) {
      // biome-ignore lint/suspicious/noExplicitAny: Elysia WS raw shape
      const raw = ws as any;
      raw.data.wsId = raw.raw.id;
      // Register WS connection for terminal push
      wsConnections.set(raw.data.wsId, ws);
      // Wire terminal callbacks once
      if (!terminalCallbacksWired && raw.data.ctx) {
        wireTerminalCallbacks(raw.data.ctx as ServerContext);
        terminalCallbacksWired = true;
      }
      // Send welcome frame on connect
      ws.send(createWelcomeFrame());
    },
    close(ws) {
      // biome-ignore lint/suspicious/noExplicitAny: Elysia WS raw shape
      const raw = ws as any;
      connectionStores.delete(raw.data.wsId);
      wsConnections.delete(raw.data.wsId);
      // Clean up terminals owned by this connection
      if (raw.data.ctx) {
        (raw.data.ctx as ServerContext).terminalManager.closeByConnection(
          raw.data.wsId
        );
      }
    },
    message(ws, msg) {
      // biome-ignore lint/suspicious/noExplicitAny: Elysia WS data shape
      const { ctx: ctx2, wsId } = (ws as any).data;
      const ctx = ctx2 as ServerContext;
      const store = getOrCreateStore(wsId, ctx.db);
      handleMessage(ctx, store, ws, msg as WsIn);
    },
  });
}
