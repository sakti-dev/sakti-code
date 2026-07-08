import { describe, expect, it } from "vite-plus/test";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeApp } from "../../../__tests__/helpers.ts";
import { confirmRoutes } from "../confirm.ts";

describe("confirm route — transition gates (POST /api/sessions/:id/confirm)", () => {
  it("specify→build approve flips status specify → build", async () => {
    const { app, ctx } = await makeApp([confirmRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp/p");
    const session = await ctx.repos.sessions.create(project.id, {
      kind: "mission",
      status: "specify",
      pendingTransitionTo: "build",
      pendingTransitionBody: "spec summary",
    });

    const res = await app.request(`/api/sessions/${session.id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", to: "build", body: "spec summary" }),
    });

    expect(res.status).toBe(200);
    expect(ctx.repos.sessions.findById(session.id)?.status).toBe("build");
  });

  it("reject (NO) clears pending with NO status change, NO side-effect", async () => {
    const { app, ctx } = await makeApp([confirmRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp/p");
    const session = await ctx.repos.sessions.create(project.id, {
      kind: "mission",
      status: "specify",
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
    expect(after?.status).toBe("specify"); // unchanged
    expect(after?.pendingTransitionTo).toBeNull();
    expect(after?.pendingTransitionBody).toBeNull();
  });

  it("verify→archive approve flips status review → merged", async () => {
    const { app, ctx } = await makeApp([confirmRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp/p");
    const session = await ctx.repos.sessions.create(project.id, {
      kind: "mission",
      status: "verify",
      pendingTransitionTo: "archive",
      pendingTransitionBody: "verify clean",
    });

    const res = await app.request(`/api/sessions/${session.id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", to: "archive", body: "verify clean" }),
    });

    expect(res.status).toBe(200);
    expect(ctx.repos.sessions.findById(session.id)?.status).toBe("archive");
  });

  it("clears pendingTransition on approve", async () => {
    const { app, ctx } = await makeApp([confirmRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp/p");
    const session = await ctx.repos.sessions.create(project.id, {
      kind: "mission",
      status: "specify",
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

  it("approve returns the edge instruction for auto-start", async () => {
    const { app, ctx } = await makeApp([confirmRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp/p");
    const session = await ctx.repos.sessions.create(project.id, {
      kind: "mission",
      status: "specify",
      pendingTransitionTo: "build",
      pendingTransitionBody: "spec summary",
    });

    const res = await app.request(`/api/sessions/${session.id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", to: "build", body: "spec summary" }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { instruction?: string };
    expect(json.instruction).toBeDefined();
    expect(json.instruction).toContain("<instruction>");
    expect(json.instruction).toContain("build mode");
  });

  it("reject does NOT return an instruction", async () => {
    const { app, ctx } = await makeApp([confirmRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp/p");
    const session = await ctx.repos.sessions.create(project.id, {
      kind: "mission",
      status: "specify",
      pendingTransitionTo: "build",
      pendingTransitionBody: "spec summary",
    });

    const res = await app.request(`/api/sessions/${session.id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", to: "build", body: "needs work" }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { instruction?: string };
    expect(json.instruction).toBeUndefined();
  });

  it("plan→mission approve stamps changeName from the changes dir", async () => {
    const { app, ctx } = await makeApp([confirmRoutes]);
    // Create a real temp cwd (git repo) with a .sakti/changes/<name> dir so the
    // resolver can find it and the worktree can be created.
    const cwd = `/tmp/plan-mission-test-${Date.now()}`;
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    mkdirSync(`${cwd}/.sakti/changes/add-feature`, { recursive: true });
    writeFileSync(`${cwd}/.sakti/changes/add-feature/.sakti.yaml`, "name: add-feature\n");
    execSync("git init -b main", { cwd, shell: "/bin/sh" });
    execSync("git config user.email t@t.com", { cwd, shell: "/bin/sh" });
    execSync("git config user.name t", { cwd, shell: "/bin/sh" });
    execSync("git commit --allow-empty -m init", { cwd, shell: "/bin/sh" });

    const project = await ctx.repos.projects.create("plan-proj", cwd);
    const session = await ctx.repos.sessions.create(project.id, {
      kind: "plan",
      status: "specify",
      pendingTransitionTo: "mission",
      pendingTransitionBody: "mission brief",
    });

    const res = await app.request(`/api/sessions/${session.id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", to: "mission", body: "mission brief" }),
    });

    expect(res.status).toBe(200);
    // changeName should be stamped on the plan session.
    const after = ctx.repos.sessions.findById(session.id);
    expect(after?.changeName).toBe("add-feature");
    // worktree should be created and stamped.
    expect(after?.worktreePath).not.toBeNull();
    // plan→mission has no statusTarget — status unchanged.
    expect(after?.status).toBe("specify");
    // Pending cleared.
    expect(after?.pendingTransitionTo).toBeNull();
    rmSync(cwd, { recursive: true, force: true });
  });

  it("returns 400 for a `to` that is not a valid edge from the current phase", async () => {
    const { app, ctx } = await makeApp([confirmRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp/p");
    const session = await ctx.repos.sessions.create(project.id, {
      kind: "mission",
      status: "specify", // current phase = specify; build→verify is not legal here
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

  it("plan→mission approve creates a worktree and stamps worktreePath", async () => {
    const { app, ctx } = await makeApp([confirmRoutes]);
    const cwd = mkdtempSync(join(tmpdir(), "sakti-confirm-"));
    execSync("git init -b main", { cwd, shell: "/bin/sh" });
    execSync("git config user.email t@t.com", { cwd, shell: "/bin/sh" });
    execSync("git config user.name t", { cwd, shell: "/bin/sh" });
    execSync("git commit --allow-empty -m init", { cwd, shell: "/bin/sh" });
    execSync(`mkdir -p ${cwd}/.sakti/changes/add-feature`, { shell: "/bin/sh" });
    execSync(`echo "name: add-feature" > ${cwd}/.sakti/changes/add-feature/.sakti.yaml`, {
      shell: "/bin/sh",
    });

    try {
      const project = await ctx.repos.projects.create("p", cwd);
      const session = await ctx.repos.sessions.create(project.id, {
        kind: "plan",
        status: "specify",
        pendingTransitionTo: "mission",
        pendingTransitionBody: "brief",
      });

      const res = await app.request(`/api/sessions/${session.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", to: "mission", body: "brief" }),
      });

      expect(res.status).toBe(200);
      const after = ctx.repos.sessions.findById(session.id);
      expect(after?.changeName).toBe("add-feature");
      expect(after?.worktreePath).not.toBeNull();
      expect(existsSync(after!.worktreePath!)).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("archive→done approve removes the worktree", async () => {
    const { app, ctx } = await makeApp([confirmRoutes]);
    const cwd = mkdtempSync(join(tmpdir(), "sakti-confirm-2-"));
    execSync("git init -b main", { cwd, shell: "/bin/sh" });
    execSync("git config user.email t@t.com", { cwd, shell: "/bin/sh" });
    execSync("git config user.name t", { cwd, shell: "/bin/sh" });
    execSync("git commit --allow-empty -m init", { cwd, shell: "/bin/sh" });
    execSync(`git worktree add -b sakti/fix "${cwd}-worktrees/fix" main`, {
      cwd,
      shell: "/bin/sh",
    });

    try {
      const project = await ctx.repos.projects.create("p", cwd);
      const session = await ctx.repos.sessions.create(project.id, {
        kind: "mission",
        status: "archive",
        changeName: "fix",
        worktreePath: `${cwd}-worktrees/fix`,
        pendingTransitionTo: "done",
        pendingTransitionBody: "archive complete",
      });

      const res = await app.request(`/api/sessions/${session.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", to: "done", body: "archive complete" }),
      });

      expect(res.status).toBe(200);
      const after = ctx.repos.sessions.findById(session.id);
      expect(after?.status).toBe("done");
      expect(existsSync(`${cwd}-worktrees/fix`)).toBe(false);
      // Branch survives.
      const branch = execSync("git branch --list sakti/fix", { cwd, shell: "/bin/sh" }).toString();
      expect(branch).toContain("sakti/fix");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
