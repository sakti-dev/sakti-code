import { DatabaseSync } from "node:sqlite";
import { initDatabase } from "@sakti-code/db";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.ts";
import { createContext } from "../context.ts";
import { createApiKeyStore } from "../lib/api-key-store.ts";

describe("built server", () => {
  it("responds to /api/health and /api/projects", async () => {
    const db = await initDatabase(new DatabaseSync(":memory:"));
    const ctx = createContext(
      db,
      {},
      createApiKeyStore(`/tmp/sakti-test-keys-${Date.now()}.json`)
    );
    const server = buildApp(ctx);
    const health = await (
      await server.request("http://localhost:3001/api/health")
    ).json();
    expect(health.status).toBe("ok");
    const projects = await (
      await server.request("http://localhost:3001/api/projects")
    ).json();
    expect(projects).toEqual([]);
  });
});

describe("ServerContext", () => {
  it("does not have messages or costs repos", async () => {
    const db = await initDatabase(new DatabaseSync(":memory:"));
    const ctx = createContext(
      db,
      {},
      createApiKeyStore(`/tmp/sakti-test-keys-${Date.now()}.json`)
    );
    expect(ctx.repos).not.toHaveProperty("messages");
    expect(ctx.repos).not.toHaveProperty("costs");
  });
});
