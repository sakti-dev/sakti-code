import { readFileSync } from "node:fs";
import { SqliteSessionStore } from "@sakti-code/db";
import { Elysia } from "elysia";
import type { ServerContext } from "../context.ts";
import type { WsIn } from "./ws-handler.ts";
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

// ── Connection-scoped store map (keyed by Bun's stable ws id) ──

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

// ── Elysia WS lifecycle handler ──

export function buildWsApp() {
  return new Elysia({ name: "ws" }).ws("/ws", {
    open(ws) {
      // biome-ignore lint/suspicious/noExplicitAny: Elysia WS raw shape
      (ws as any).data.wsId = (ws as any).raw.id;
      // Send welcome frame on connect
      ws.send(createWelcomeFrame());
    },
    close(ws) {
      // biome-ignore lint/suspicious/noExplicitAny: Elysia WS raw shape
      connectionStores.delete((ws as any).data.wsId);
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
