import { describe, expect, it } from "bun:test";
import { exportRoutes } from "../routes/export.ts";
import { forkingRoutes } from "../routes/forking.ts";
import { namingRoutes } from "../routes/naming.ts";
import { makeApp } from "./helpers.ts";

describe("fork routes", () => {
  it("POST /api/sessions/:id/fork with no body creates a forked session with all messages", async () => {
    const { app, ctx } = await makeApp([forkingRoutes]);
    const project = await ctx.repos.projects.create("fork-test", "/tmp/fork");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");
    await ctx.repos.messages.append(session.id, {
      role: "user",
      content: "Hello",
    });
    await ctx.repos.messages.append(session.id, {
      role: "assistant",
      content: "Hi!",
    });

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    const forked = await res.json();
    expect(forked).toHaveProperty("parentSessionId", session.id);
    expect(forked).toHaveProperty("id");
    expect(forked.id).not.toBe(session.id);

    // Verify messages were copied
    const msgs = ctx.repos.messages.loadBySession(forked.id);
    expect(msgs).toHaveLength(2);
  });

  it("POST /api/sessions/:id/fork with messageIndex creates partial fork", async () => {
    const { app, ctx } = await makeApp([forkingRoutes]);
    const project = await ctx.repos.projects.create("fork-test2", "/tmp/fork2");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");
    await ctx.repos.messages.append(session.id, { role: "user", content: "A" });
    await ctx.repos.messages.append(session.id, {
      role: "assistant",
      content: "B",
    });
    await ctx.repos.messages.append(session.id, { role: "user", content: "C" });

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageIndex: 1 }),
      })
    );
    expect(res.status).toBe(200);
    const forked = await res.json();
    const msgs = ctx.repos.messages.loadBySession(forked.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe("A");
    expect(msgs[1].content).toBe("B");
  });

  it("POST /api/sessions/nope/fork returns 404", async () => {
    const { app } = await makeApp([forkingRoutes]);
    const res = await app.handle(
      new Request("http://localhost/api/sessions/nope/fork", {
        method: "POST",
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(404);
  });
});

describe("fork-messages route", () => {
  it("returns user/assistant messages with messageIndex and textPreview", async () => {
    const { app, ctx } = await makeApp([forkingRoutes]);
    const project = await ctx.repos.projects.create("fm-test", "/tmp/fm");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");
    await ctx.repos.messages.append(session.id, {
      role: "user",
      content: "Hello",
    });
    await ctx.repos.messages.append(session.id, {
      role: "assistant",
      content: "Hi there!",
    });
    await ctx.repos.messages.append(session.id, {
      role: "tool",
      content: "result",
      toolCallId: "t1",
      toolName: "bash",
    });

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/fork-messages`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Tool messages excluded, only user + assistant
    expect(body).toHaveLength(2);
    expect(body[0]).toHaveProperty("messageIndex", 0);
    expect(body[0]).toHaveProperty("role", "user");
    expect(body[0]).toHaveProperty("textPreview", "Hello");
    expect(body[1]).toHaveProperty("messageIndex", 1);
    expect(body[1]).toHaveProperty("role", "assistant");
  });

  it("empty session returns []", async () => {
    const { app, ctx } = await makeApp([forkingRoutes]);
    const project = await ctx.repos.projects.create(
      "fm-empty",
      "/tmp/fm-empty"
    );
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/fork-messages`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("unknown session returns 404", async () => {
    const { app } = await makeApp([forkingRoutes]);
    const res = await app.handle(
      new Request("http://localhost/api/sessions/nope/fork-messages")
    );
    expect(res.status).toBe(404);
  });
});

describe("naming route", () => {
  it("PATCH /api/sessions/:id/name sets title", async () => {
    const { app, ctx } = await makeApp([namingRoutes]);
    const project = await ctx.repos.projects.create("name-test", "/tmp/name");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/name`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "My Session" }),
      })
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.title).toBe("My Session");
  });

  it("empty title clears to null", async () => {
    const { app, ctx } = await makeApp([namingRoutes]);
    const project = await ctx.repos.projects.create("name-test2", "/tmp/name2");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o", {
      title: "Old",
    });

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/name`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "" }),
      })
    );
    const updated = await res.json();
    expect(updated.title).toBeNull();
  });

  it("unknown session returns 404", async () => {
    const { app } = await makeApp([namingRoutes]);
    const res = await app.handle(
      new Request("http://localhost/api/sessions/nope/name", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Test" }),
      })
    );
    expect(res.status).toBe(404);
  });
});

describe("export route", () => {
  it("returns HTML with messages rendered", async () => {
    const { app, ctx } = await makeApp([exportRoutes]);
    const project = await ctx.repos.projects.create(
      "export-test",
      "/tmp/export"
    );
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o", {
      title: "ExportMe",
    });
    await ctx.repos.messages.append(session.id, {
      role: "user",
      content: "Hello",
    });
    await ctx.repos.messages.append(session.id, {
      role: "assistant",
      content: "World",
    });

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/export-html`)
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).toContain("ExportMe");
    expect(html).toContain("Hello");
    expect(html).toContain("World");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("empty session returns HTML with no messages", async () => {
    const { app, ctx } = await makeApp([exportRoutes]);
    const project = await ctx.repos.projects.create(
      "export-empty",
      "/tmp/export-empty"
    );
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/export-html`)
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No messages in this session");
  });

  it("unknown session returns 404", async () => {
    const { app } = await makeApp([exportRoutes]);
    const res = await app.handle(
      new Request("http://localhost/api/sessions/nope/export-html")
    );
    expect(res.status).toBe(404);
  });
});
