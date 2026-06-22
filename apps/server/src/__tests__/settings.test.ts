import { describe, expect, it } from "vitest";
import { sessionSettingsRoutes } from "../routes/sessions/session-settings.ts";
import { makeApp } from "./helpers.ts";

const DEFAULTS = {
  auto_compaction: false,
  auto_retry: true,
  follow_up_mode: "all",
  max_retries: 3,
  steering_mode: "all",
  thinking_level: "off",
};

describe("session settings routes", () => {
  it("GET returns merged defaults for a new session", async () => {
    const { app, ctx } = await makeApp([sessionSettingsRoutes]);
    const project = await ctx.repos.projects.create("ss", "/tmp/ss");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/settings`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DEFAULTS);
  });

  it("PATCH then GET round-trips a single key, others stay at defaults", async () => {
    const { app, ctx } = await makeApp([sessionSettingsRoutes]);
    const project = await ctx.repos.projects.create("ss-rt", "/tmp/ss-rt");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    const patch = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auto_compaction: true }),
      })
    );
    expect(patch.status).toBe(204);

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/settings`)
    );
    expect(await res.json()).toEqual({ ...DEFAULTS, auto_compaction: true });
  });

  it("PATCH coerces and round-trips a numeric/string key", async () => {
    const { app, ctx } = await makeApp([sessionSettingsRoutes]);
    const project = await ctx.repos.projects.create("ss-num", "/tmp/ss-num");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          max_retries: 7,
          steering_mode: "one-at-a-time",
        }),
      })
    );

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/settings`)
    );
    expect(await res.json()).toEqual({
      ...DEFAULTS,
      max_retries: 7,
      steering_mode: "one-at-a-time",
    });
  });

  it("GET unknown session returns 404", async () => {
    const { app } = await makeApp([sessionSettingsRoutes]);
    const res = await app.request(
      new Request("http://localhost/api/sessions/nope/settings")
    );
    expect(res.status).toBe(404);
  });

  it("PATCH unknown session returns 404", async () => {
    const { app } = await makeApp([sessionSettingsRoutes]);
    const res = await app.request(
      new Request("http://localhost/api/sessions/nope/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auto_retry: false }),
      })
    );
    expect(res.status).toBe(404);
  });

  it("settings are stored under the session:{id}:{key} convention", async () => {
    const { app, ctx } = await makeApp([sessionSettingsRoutes]);
    const project = await ctx.repos.projects.create("ss-kv", "/tmp/ss-kv");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auto_retry: false }),
      })
    );

    expect(ctx.repos.settings.get(`session:${session.id}:auto_retry`)).toBe(
      "false"
    );
  });
});
