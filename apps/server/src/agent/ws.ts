import { SqliteSessionStorage } from "@sakti-code/db";
import { Elysia } from "elysia";
import pkg from "../../package.json" with { type: "json" };
import type { ServerContext } from "../context.ts";
import type { ErrorFrame, WsHandle, WsIn } from "./ws-handler.ts";
import { handleMessage } from "./ws-handler.ts";

export const SERVER_VERSION: string = pkg.version ?? "0.0.0";

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
  ctx: ServerContext,
  sessionId: string
): SqliteSessionStorage {
  const key = `${wsId}:${sessionId}`;
  let storage = connectionStores.get(key);
  if (!storage) {
    const session = ctx.repos.sessions.findById(sessionId);
    storage = new SqliteSessionStorage(ctx.db, sessionId, {
      id: sessionId,
      createdAt: session
        ? new Date(session.createdAt).toISOString()
        : new Date().toISOString(),
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

const wsIdMap = new WeakMap<object, string>();

function getWsId(ws: object): string {
  const existing = wsIdMap.get(ws);
  if (existing) {
    return existing;
  }
  const id = crypto.randomUUID();
  wsIdMap.set(ws, id);
  return id;
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

export function buildWsApp(ctx: ServerContext) {
  let terminalCallbacksWired = false;

  return new Elysia({ name: "ws" }).ws("/ws", {
    open(ws) {
      const wsId = getWsId(ws);
      wsConnections.set(wsId, ws);
      if (!terminalCallbacksWired) {
        wireTerminalCallbacks(ctx);
        terminalCallbacksWired = true;
      }
      ws.send(createWelcomeFrame());
    },
    close(ws) {
      const wsId = getWsId(ws);
      clearStorageForConnection(wsId);
      wsConnections.delete(wsId);
      ctx.terminalManager.closeByConnection(wsId);
    },
    message(ws, msg) {
      const wsId = getWsId(ws);
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
      const storage = getOrCreateStorage(wsId, ctx, inMsg.sessionId);
      handleMessage(ctx, storage, ws, inMsg);
    },
  });
}
