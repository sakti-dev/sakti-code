import { readFileSync } from "node:fs";
import { SqliteSessionStorage } from "@sakti-code/db";
import { Elysia } from "elysia";
import type { ServerContext } from "../context.ts";
import type { ErrorFrame, WsHandle, WsIn } from "./ws-handler.ts";
import { handleMessage } from "./ws-handler.ts";

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

const connectionStores = new Map<string, SqliteSessionStorage>();

function getOrCreateStorage(
  wsId: string,
  db: ServerContext["db"],
  sessionId: string
): SqliteSessionStorage {
  const key = `${wsId}:${sessionId}`;
  let storage = connectionStores.get(key);
  if (!storage) {
    storage = new SqliteSessionStorage(db, sessionId, {
      id: sessionId,
      createdAt: new Date().toISOString(),
    });
    connectionStores.set(key, storage);
  }
  return storage;
}

function clearStorageForConnection(wsId: string) {
  const prefix = `${wsId}:`;
  for (const key of connectionStores.keys()) {
    if (key.startsWith(prefix)) {
      connectionStores.delete(key);
    }
  }
}

const wsConnections = new Map<string, WsHandle>();

export function hasWsConnection(connectionId: string): boolean {
  return wsConnections.has(connectionId);
}

export function pushToConnection(connectionId: string, data: unknown) {
  const ws = wsConnections.get(connectionId);
  if (ws) {
    ws.send(JSON.stringify(data));
  }
}

export function registerTestConnection(connectionId: string, ws: WsHandle) {
  wsConnections.set(connectionId, ws);
}

export function unregisterTestConnection(connectionId: string) {
  wsConnections.delete(connectionId);
}

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

let terminalCallbacksWired = false;

export function buildWsApp() {
  return new Elysia({ name: "ws" }).ws("/ws", {
    open(ws) {
      const raw = ws as any;
      raw.data.wsId = raw.raw.id;
      wsConnections.set(raw.data.wsId, ws);
      if (!terminalCallbacksWired && raw.data.ctx) {
        wireTerminalCallbacks(raw.data.ctx as ServerContext);
        terminalCallbacksWired = true;
      }
      ws.send(createWelcomeFrame());
    },
    close(ws) {
      const raw = ws as any;
      clearStorageForConnection(raw.data.wsId);
      wsConnections.delete(raw.data.wsId);
      if (raw.data.ctx) {
        (raw.data.ctx as ServerContext).terminalManager.closeByConnection(
          raw.data.wsId
        );
      }
    },
    message(ws, msg) {
      const { ctx: ctx2, wsId } = (ws as any).data;
      const ctx = ctx2 as ServerContext;
      const inMsg = msg as WsIn;
      if (!inMsg.sessionId) {
        ws.send(
          JSON.stringify({
            error: "Missing sessionId",
            sessionId: "",
            type: "error",
          } satisfies ErrorFrame)
        );
        return;
      }
      const storage = getOrCreateStorage(wsId, ctx.db, inMsg.sessionId);
      handleMessage(ctx, storage, ws, inMsg);
    },
  });
}
