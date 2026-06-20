import { describe, expect, it } from "bun:test";
import { costsRoutes } from "../routes/costs.ts";
import { projectsRoutes } from "../routes/projects.ts";
import { settingsRoutes } from "../routes/settings.ts";
import { makeApp } from "./helpers.ts";

describe("settings routes", () => {
  it("PUT then GET round-trips a setting", async () => {
    const { app } = await makeApp([settingsRoutes]);
    const put = await app.handle(
      new Request("http://localhost:3001/api/settings/theme", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "dark" }),
      })
    );
    expect(put.status).toBe(204);
    const got = await (
      await app.handle(new Request("http://localhost:3001/api/settings/theme"))
    ).text();
    expect(got).toBe("dark");
  });

  it("returns 404 for unknown key", async () => {
    const { app } = await makeApp([settingsRoutes]);
    const res = await app.handle(
      new Request("http://localhost:3001/api/settings/nonexistent")
    );
    expect(res.status).toBe(404);
  });
});

describe("costs routes", () => {
  it("aggregates by project (zero initially)", async () => {
    const { app, ctx } = await makeApp([projectsRoutes, costsRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp/p");
    const res = await app.handle(
      new Request(`http://localhost:3001/api/costs/projects/${project.id}`)
    );
    expect(res.status).toBe(200);
    const agg = await res.json();
    expect(agg.totalInputTokens).toBe(0);
  });
});
