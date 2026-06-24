import { describe, expect, it } from "vitest";
import { lastAssistantTextRoutes } from "../routes/sessions/last-assistant-text.ts";
import { seedEntries } from "./entry-helpers.ts";
import { makeApp } from "./helpers.ts";

describe("last assistant text route", () => {
  it("returns text for session with assistant messages", async () => {
    const { app, ctx } = await makeApp([lastAssistantTextRoutes]);
    const project = await ctx.repos.projects.create("test", "/tmp/test-last");
    const session = await ctx.repos.sessions.create(project.id);

    await seedEntries(ctx.db, session.id, [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ]);

    const res = await app.request(
      new Request(
        `http://localhost/api/sessions/${session.id}/last-assistant-text`
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe("Hi there!");
  });

  it("returns null for session with no assistant messages", async () => {
    const { app, ctx } = await makeApp([lastAssistantTextRoutes]);
    const project = await ctx.repos.projects.create(
      "test2",
      "/tmp/test-last-2"
    );
    const session = await ctx.repos.sessions.create(project.id);

    await seedEntries(ctx.db, session.id, [{ role: "user", content: "Hello" }]);

    const res = await app.request(
      new Request(
        `http://localhost/api/sessions/${session.id}/last-assistant-text`
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBeNull();
  });

  it("unknown session returns 404", async () => {
    const { app } = await makeApp([lastAssistantTextRoutes]);
    const res = await app.request(
      new Request("http://localhost/api/sessions/nope/last-assistant-text")
    );
    expect(res.status).toBe(404);
  });
});
