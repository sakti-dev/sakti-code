import { describe, expect, it } from "bun:test";
import { bashRoutes } from "../routes/bash.ts";
import { makeApp } from "./helpers.ts";

describe("bash routes", () => {
  it("POST /api/sessions/:id/bash executes a command and returns output", async () => {
    const { app, ctx } = await makeApp([bashRoutes]);
    const project = await ctx.repos.projects.create("bash-test", "/tmp");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/bash`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "echo hello" }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("output");
    expect(body.output).toContain("hello");
    expect(body).toHaveProperty("exitCode", 0);
    expect(body).toHaveProperty("cancelled", false);
    expect(body).toHaveProperty("truncated", false);
  });

  it("POST /api/sessions/nope/bash returns 404", async () => {
    const { app } = await makeApp([bashRoutes]);
    const res = await app.handle(
      new Request("http://localhost/api/sessions/nope/bash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "echo hi" }),
      })
    );
    expect(res.status).toBe(404);
  });

  it("POST /api/sessions/:id/abort-bash returns ok (idempotent)", async () => {
    const { app, ctx } = await makeApp([bashRoutes]);
    const project = await ctx.repos.projects.create("bash-abort", "/tmp");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/abort-bash`, {
        method: "POST",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("POST /api/sessions/:id/bash with injectToContext appends tool message", async () => {
    const { app, ctx } = await makeApp([bashRoutes]);
    const project = await ctx.repos.projects.create("bash-inject", "/tmp");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/bash`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "echo hello", injectToContext: true }),
      })
    );

    const msgs = ctx.repos.messages.loadBySession(session.id);
    const toolMsg = msgs.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolName).toBe("user_bash");
    expect(toolMsg!.content).toContain("hello");
  });

  it("POST /api/sessions/:id/bash with timeout returns cancelled", async () => {
    const { app, ctx } = await makeApp([bashRoutes]);
    const project = await ctx.repos.projects.create("bash-timeout", "/tmp");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/bash`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "sleep 10", timeout: 1 }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelled).toBe(true);
    expect(body.output).toContain("timed out");
  });

  it("C1: timeout is in SECONDS — timeout:1 cancels a 2s sleep and reports 'after 1s'", async () => {
    const { app, ctx } = await makeApp([bashRoutes]);
    const project = await ctx.repos.projects.create("c1-sec", "/tmp");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    const t0 = Date.now();
    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/bash`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "sleep 2", timeout: 1 }),
      })
    );
    const elapsed = Date.now() - t0;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelled).toBe(true);
    expect(body.output).toBe("[Command timed out after 1s]");
    // ~1s, not 1ms (old bug) and not 2s/30s
    expect(elapsed).toBeGreaterThan(900);
    expect(elapsed).toBeLessThan(1900);
  });

  it("C2: output preserves trailing content (not trimmed)", async () => {
    const { app, ctx } = await makeApp([bashRoutes]);
    const project = await ctx.repos.projects.create("c2-trim", "/tmp");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/bash`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // printf 'a\nb\n' → exact trailing newline preserved
        body: JSON.stringify({ command: "printf 'a\nb\n'" }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.output).toBe("a\nb\n");
    expect(body.exitCode).toBe(0);
    expect(body.cancelled).toBe(false);
  });
});
