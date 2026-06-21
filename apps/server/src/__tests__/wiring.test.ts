import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { initDatabase } from "@sakti-code/db";
import { Elysia } from "elysia";
import { app } from "../app.ts";
import { createContext } from "../context.ts";

describe("built server", () => {
  it("responds to /api/health and /api/projects", async () => {
    const db = await initDatabase(new Database(":memory:"));
    const server = new Elysia()
      .state("ctx", createContext(db))
      .use(app)
      .compile();
    const health = await (
      await server.handle(new Request("http://localhost:3001/api/health"))
    ).json();
    expect(health.status).toBe("ok");
    const projects = await (
      await server.handle(new Request("http://localhost:3001/api/projects"))
    ).json();
    expect(projects).toEqual([]);
  });
});

describe("ServerContext", () => {
  it("does not have messages or costs repos", async () => {
    const db = await initDatabase(new Database(":memory:"));
    const ctx = createContext(db);
    expect(ctx.repos).not.toHaveProperty("messages");
    expect(ctx.repos).not.toHaveProperty("costs");
  });
});
