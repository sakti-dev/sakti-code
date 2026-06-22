import { describe, expect, it } from "vitest";
import { sessionsRoutes } from "../routes/sessions/sessions.ts";
import { seedEntries } from "./entry-helpers.ts";
import { makeApp } from "./helpers.ts";

describe("GET /api/sessions/:id/messages", () => {
  it("returns messages from the entry tree", async () => {
    const { app, ctx } = await makeApp([sessionsRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp");
    const session = await ctx.repos.sessions.create(project.id, "test-model");

    await seedEntries(ctx.db, session.id, [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ]);

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/messages`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].role).toBe("user");
    expect(body[1].role).toBe("assistant");
  });

  it("returns empty array for session with no entries", async () => {
    const { app, ctx } = await makeApp([sessionsRoutes]);
    const project = await ctx.repos.projects.create("empty", "/tmp/empty");
    const session = await ctx.repos.sessions.create(project.id, "test-model");

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/messages`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
