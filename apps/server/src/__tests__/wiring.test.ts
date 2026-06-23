import { describe, expect, it } from "vitest";
import { buildApp } from "../app.ts";
import { makeContext } from "./helpers.ts";

describe("built server", () => {
  it("responds to /api/health and /api/projects", async () => {
    const { ctx } = await makeContext();
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
    const { ctx } = await makeContext();
    expect(ctx.repos).not.toHaveProperty("messages");
    expect(ctx.repos).not.toHaveProperty("costs");
    expect(ctx.repos).not.toHaveProperty("models");
  });
});
