import { Database } from "bun:sqlite";
import { initDatabase } from "@sakti-code/db";
import { Elysia } from "elysia";
import { createContext } from "../context.ts";

// Elysia plugin composition erases generics
type AnyElysia = Elysia<any, any, any, any, any, any, any>;

export async function makeApp(routes: AnyElysia[]) {
  const db = await initDatabase(new Database(":memory:"));
  const ctx = createContext(db);
  let app = new Elysia().state("ctx", ctx);
  for (const route of routes) {
    app = app.use(route as typeof app);
  }
  app.compile();
  return { app, db, ctx };
}
