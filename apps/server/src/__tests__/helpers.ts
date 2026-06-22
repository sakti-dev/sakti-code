import { Database } from "bun:sqlite";
import { initDatabase } from "@sakti-code/db";
import { Elysia } from "elysia";
import { createContext } from "../context.ts";
import { createApiKeyStore } from "../lib/api-key-store.ts";

// Elysia plugin composition erases generics
type AnyElysia = Elysia<any, any, any, any, any, any, any>;

export async function makeApp(routes: AnyElysia[]) {
  const db = await initDatabase(new Database(":memory:"));
  const apiKeys = createApiKeyStore(`/tmp/sakti-test-keys-${Date.now()}.json`);
  const ctx = createContext(db, {}, apiKeys);
  let app: AnyElysia = new Elysia({ prefix: "/api" }).state("ctx", ctx);
  for (const route of routes) {
    app = app.use(route as AnyElysia);
  }
  app.compile();
  return { app, db, ctx };
}
