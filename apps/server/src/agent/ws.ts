import { upgradeWebSocket } from "@hono/node-server";
import { SqliteSessionStorage } from "@sakti-code/db";
import { Hono } from "hono";
import { Compile } from "typebox/compile";
import pkg from "../../package.json" with { type: "json" };
import type { ServerContext } from "../context.ts";
import type { WsHandle } from "./ws-handler.ts";
import { handleMessage, wsBodySchema } from "./ws-handler.ts";

export const SERVER_VERSION: string = pkg.version ?? "0.0.0";

export function createWelcomeFrame(): {
  cwd: string;
  type: "welcome";
  version: string;
} {
  return {
    type: "welcome",
    version: SERVER_VERSION,
    cwd: process.cwd(),
  };
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
    ws.send(data);
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

// Compiled once: validates inbound WS frames against wsBodySchema.
const bodyChecker = Compile(wsBodySchema);

/** Wraps a Hono WSContext (send takes string) as a WsHandle that accepts object frames. */
function asWsHandle(ws: { send: (data: string) => void }): WsHandle {
  return {
    send: (data: unknown) => ws.send(JSON.stringify(data)),
  };
}

export function buildWsApp(ctx: ServerContext): Hono {
  let terminalCallbacksWired = false;

  return new Hono().get(
    "/ws",
    upgradeWebSocket(() => ({
      onOpen(_evt, ws) {
        const wsId = getWsId(ws);
        const handle = asWsHandle(ws);
        wsConnections.set(wsId, handle);
        if (!terminalCallbacksWired) {
          wireTerminalCallbacks(ctx);
          terminalCallbacksWired = true;
        }
        handle.send(createWelcomeFrame());
      },
      onMessage(evt, ws) {
        const wsId = getWsId(ws);
        const handle = asWsHandle(ws);
        let msg: unknown;
        if (typeof evt.data !== "string") {
          handle.send({
            error: "Text frames only",
            sessionId: "",
            type: "error",
          });
          return;
        }
        try {
          msg = JSON.parse(evt.data);
        } catch {
          handle.send({ error: "Invalid JSON", sessionId: "", type: "error" });
          return;
        }
        if (!bodyChecker.Check(msg)) {
          handle.send({
            error: "Invalid message shape",
            sessionId: "",
            type: "error",
          });
          return;
        }
        const parsed = msg as { sessionId?: string };
        if (!parsed.sessionId) {
          handle.send({
            error: "Missing sessionId",
            sessionId: "",
            type: "error",
          });
          return;
        }
        const storage = getOrCreateStorage(wsId, ctx, parsed.sessionId);
        handleMessage(
          ctx,
          storage,
          handle,
          msg as Parameters<typeof handleMessage>[3]
        );
      },
      onClose(_evt, ws) {
        const wsId = getWsId(ws);
        clearStorageForConnection(wsId);
        wsConnections.delete(wsId);
        ctx.terminalManager.closeByConnection(wsId);
      },
    }))
  );
}
