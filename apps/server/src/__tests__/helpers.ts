import { DatabaseSync } from "node:sqlite";
import { initDatabase } from "@sakti-code/db";
import type { Hono } from "hono";
import { createContext, ctxMiddleware } from "../context.ts";
import { factory } from "../factory.ts";
import { createApiKeyStore } from "../lib/api-key-store.ts";

type AnyHono = Hono;

export async function makeApp(routes: AnyHono[]) {
  const db = await initDatabase(new DatabaseSync(":memory:"));
  const apiKeys = createApiKeyStore(`/tmp/sakti-test-keys-${Date.now()}.json`);
  const ctx = createContext(db, {}, apiKeys);

  let rest = factory.createApp();
  for (const route of routes) {
    rest = rest.route("/", route);
  }

  const app = factory.createApp().use(ctxMiddleware(ctx)).route("/api", rest);
  return { app, db, ctx };
}
