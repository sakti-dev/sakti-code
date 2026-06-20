import { describe, expect, it } from "bun:test";
import { sessionControlRoutes } from "../routes/session-controls.ts";
import { makeApp } from "./helpers.ts";

describe("session control routes (steer / follow-up)", () => {
  it("POST /steer returns 404 when no active run exists for the session", async () => {
    const { app, ctx } = await makeApp([sessionControlRoutes]);
    const project = await ctx.repos.projects.create("sc", "/tmp/sc");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/steer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "try X instead" }),
      })
    );
    expect(res.status).toBe(404);
  });

  it("POST /follow-up returns 404 when no active run exists for the session", async () => {
    const { app, ctx } = await makeApp([sessionControlRoutes]);
    const project = await ctx.repos.projects.create("sc2", "/tmp/sc2");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/follow-up`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "now refactor" }),
      })
    );
    expect(res.status).toBe(404);
  });

  it("POST /steer requires a message body", async () => {
    const { app, ctx } = await makeApp([sessionControlRoutes]);
    const project = await ctx.repos.projects.create("sc3", "/tmp/sc3");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    // Missing body → Elysia validation 422 (no active run would be 404; bad body is 422)
    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/steer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(422);
  });
});
