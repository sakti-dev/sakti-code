import { SqliteSessionStore } from "@sakti-code/db";
import { Elysia } from "elysia";
import type { ServerContext } from "../context.ts";
import type { WsIn } from "./ws-handler.ts";
import { handleMessage } from "./ws-handler.ts";

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
