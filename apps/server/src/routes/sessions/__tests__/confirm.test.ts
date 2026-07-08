import { describe, expect, it } from "vite-plus/test";
import { makeApp } from "../../../__tests__/helpers.ts";
import { confirmRoutes } from "../confirm.ts";

describe("confirm route — transition gates (POST /api/sessions/:id/confirm)", () => {
  it("specify→build approve flips status specifying → building", async () => {
    const { app, ctx } = await makeApp([confirmRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp/p");
    const session = await ctx.repos.sessions.create(project.id, {
      kind: "mission",
      status: "specifying",
      pendingTransitionTo: "build",
      pendingTransitionBody: "spec summary",
    });

    const res = await app.request(`/api/sessions/${session.id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", to: "build", body: "spec summary" }),
    });

    expect(res.status).toBe(200);
    expect(ctx.repos.sessions.findById(session.id)?.status).toBe("building");
  });

  it("reject (NO) clears pending with NO status change, NO side-effect", async () => {
    const { app, ctx } = await makeApp([confirmRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp/p");
    const session = await ctx.repos.sessions.create(project.id, {
      kind: "mission",
      status: "specifying",
      pendingTransitionTo: "build",
      pendingTransitionBody: "spec summary",
    });

    const res = await app.request(`/api/sessions/${session.id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", to: "build", body: "needs work" }),
    });

    expect(res.status).toBe(200);
    const after = ctx.repos.sessions.findById(session.id);
    expect(after?.status).toBe("specifying"); // unchanged
    expect(after?.pendingTransitionTo).toBeNull();
    expect(after?.pendingTransitionBody).toBeNull();
  });

  it("verify→archive approve flips status review → merged", async () => {
    const { app, ctx } = await makeApp([confirmRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp/p");
    const session = await ctx.repos.sessions.create(project.id, {
      kind: "mission",
      status: "review",
      pendingTransitionTo: "archive",
      pendingTransitionBody: "verify clean",
    });

    const res = await app.request(`/api/sessions/${session.id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", to: "archive", body: "verify clean" }),
    });

    expect(res.status).toBe(200);
    expect(ctx.repos.sessions.findById(session.id)?.status).toBe("merged");
  });

  it("clears pendingTransition on approve", async () => {
    const { app, ctx } = await makeApp([confirmRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp/p");
    const session = await ctx.repos.sessions.create(project.id, {
      kind: "mission",
      status: "specifying",
      pendingTransitionTo: "build",
      pendingTransitionBody: "spec summary",
    });

    const res = await app.request(`/api/sessions/${session.id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", to: "build", body: "spec summary" }),
    });

    expect(res.status).toBe(200);
    const after = ctx.repos.sessions.findById(session.id);
    expect(after?.pendingTransitionTo).toBeNull();
    expect(after?.pendingTransitionBody).toBeNull();
  });

  it("returns 400 for a `to` that is not a valid edge from the current phase", async () => {
    const { app, ctx } = await makeApp([confirmRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp/p");
    const session = await ctx.repos.sessions.create(project.id, {
      kind: "mission",
      status: "specifying", // current phase = specify; build→verify is not legal here
    });

    const res = await app.request(`/api/sessions/${session.id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", to: "verify", body: "x" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown session", async () => {
    const { app } = await makeApp([confirmRoutes]);
    const res = await app.request("/api/sessions/nonexistent/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", to: "build", body: "x" }),
    });
    expect(res.status).toBe(404);
  });
});
