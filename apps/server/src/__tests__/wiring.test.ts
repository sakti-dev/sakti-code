import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { initDatabase } from "@sakti-code/db";
import { Elysia } from "elysia";
import { buildServer } from "../index.ts";

describe("built server", () => {
  it("responds to /health and /api/projects", async () => {
    const db = await initDatabase(new Database(":memory:"));
    const app = buildServer({ db });
    const health = await (
      await app.handle(new Request("http://localhost:3001/health"))
    ).json();
    expect(health.status).toBe("ok");
    const projects = await (
      await app.handle(new Request("http://localhost:3001/api/projects"))
    ).json();
    expect(projects).toEqual([]);
  });

  it("accepts extra route modules via routes array", async () => {
    const db = await initDatabase(new Database(":memory:"));
    const customRoutes = new Elysia({ name: "routes.custom" }).get(
      "/api/custom",
      () => ({ custom: true })
    );
    const app = buildServer({ db, routes: [customRoutes] });
    const res = await app.handle(
      new Request("http://localhost:3001/api/custom")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.custom).toBe(true);
  });
});
