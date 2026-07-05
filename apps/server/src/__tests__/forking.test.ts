import { buildSessionContextFromEntries } from "@sakti-code/agent";
import { SqliteSessionStorage } from "@sakti-code/db";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { exportRoutes } from "../routes/sessions/export.ts";
import { forkingRoutes } from "../routes/sessions/forking.ts";
import { seedEntries } from "./entry-helpers.ts";
import { makeApp } from "./helpers.ts";

describe("fork routes", () => {
  it("POST /api/sessions/:id/fork creates a forked session with all entries", async () => {
    const { app, ctx } = await makeApp([forkingRoutes]);
    const project = await ctx.repos.projects.create("fork-test", "/tmp/fork");
    const session = await ctx.repos.sessions.create(project.id);

    await seedEntries(ctx.db, session.id, [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ]);

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);
    const forked = await res.json();
    expect(forked).toHaveProperty("parentSessionId", session.id);
    expect(forked).toHaveProperty("id");
    expect(forked.id).not.toBe(session.id);

    // Verify entries were copied to the fork
    const forkedStorage = new SqliteSessionStorage(ctx.db, forked.id, {
      id: forked.id,
      createdAt: new Date().toISOString(),
    });
    const leafId = await Effect.runPromise(forkedStorage.getLeafId());
    const entries = await Effect.runPromise(forkedStorage.getPathToRoot(leafId));
    const { messages } = buildSessionContextFromEntries(entries);
    expect(messages).toHaveLength(2);
    expect((messages[0] as { content: unknown }).content).toBe("Hello");
  });

  it("POST /api/sessions/nope/fork returns 404", async () => {
    const { app } = await makeApp([forkingRoutes]);
    const res = await app.request(
      new Request("http://localhost/api/sessions/nope/fork", {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(404);
  });

  it("POST /api/sessions/:id/fork preserves session kind", async () => {
    const { app, ctx } = await makeApp([forkingRoutes]);
    const project = await ctx.repos.projects.create("fork-kind", "/tmp/fork-kind");
    const session = await ctx.repos.sessions.create(project.id, {
      kind: "plan",
    });

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);
    const forked = await res.json();
    expect(forked.kind).toBe("plan");
  });
});

describe("fork-messages route", () => {
  it("returns user/assistant messages with entryIndex and textPreview", async () => {
    const { app, ctx } = await makeApp([forkingRoutes]);
    const project = await ctx.repos.projects.create("fm-test", "/tmp/fm");
    const session = await ctx.repos.sessions.create(project.id);

    await seedEntries(ctx.db, session.id, [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
      {
        role: "toolResult",
        content: "result",
        toolCallId: "t1",
        toolName: "bash",
      },
    ]);

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/fork-messages`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Tool messages excluded, only user + assistant
    expect(body).toHaveLength(2);
    expect(body[0]).toHaveProperty("role", "user");
    expect(body[0]).toHaveProperty("textPreview", "Hello");
    expect(body[1]).toHaveProperty("role", "assistant");
  });

  it("empty session returns []", async () => {
    const { app, ctx } = await makeApp([forkingRoutes]);
    const project = await ctx.repos.projects.create("fm-empty", "/tmp/fm-empty");
    const session = await ctx.repos.sessions.create(project.id);

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/fork-messages`),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("unknown session returns 404", async () => {
    const { app } = await makeApp([forkingRoutes]);
    const res = await app.request(new Request("http://localhost/api/sessions/nope/fork-messages"));
    expect(res.status).toBe(404);
  });
});

describe("export route", () => {
  it("returns HTML with messages rendered", async () => {
    const { app, ctx } = await makeApp([exportRoutes]);
    const project = await ctx.repos.projects.create("export-test", "/tmp/export");
    const session = await ctx.repos.sessions.create(project.id, {
      title: "ExportMe",
    });

    await seedEntries(ctx.db, session.id, [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "World" },
    ]);

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/export-html`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")?.toLowerCase()).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).toContain("ExportMe");
    expect(html).toContain("Hello");
    expect(html).toContain("World");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("empty session returns HTML with no messages", async () => {
    const { app, ctx } = await makeApp([exportRoutes]);
    const project = await ctx.repos.projects.create("export-empty", "/tmp/export-empty");
    const session = await ctx.repos.sessions.create(project.id);

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/export-html`),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No messages in this session");
  });

  it("unknown session returns 404", async () => {
    const { app } = await makeApp([exportRoutes]);
    const res = await app.request(new Request("http://localhost/api/sessions/nope/export-html"));
    expect(res.status).toBe(404);
  });

  it("W7: each assistant message emits a copy button", async () => {
    const { app, ctx } = await makeApp([exportRoutes]);
    const project = await ctx.repos.projects.create("w7", "/tmp/w7");
    const session = await ctx.repos.sessions.create(project.id);

    await seedEntries(ctx.db, session.id, [{ role: "assistant", content: "hi" }]);

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/export-html`),
    );
    const html = await res.text();
    const matches = html.match(/class="copy-btn"/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(1);
  });

  it("W8: header shows the session creation date, not today", async () => {
    const { app, ctx } = await makeApp([exportRoutes]);
    const project = await ctx.repos.projects.create("w8", "/tmp/w8");
    const session = await ctx.repos.sessions.create(project.id);
    const created = new Date(session.createdAt).toISOString().slice(0, 10);

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/export-html`),
    );
    const html = await res.text();
    expect(html).toContain(created);
  });
});
