import { describe, expect, it } from "vite-plus/test";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeApp } from "../../../__tests__/helpers.ts";
import { confirmRoutes } from "../confirm.ts";
import { createMissionWorktree, linkDependencyDirs } from "../../../lib/worktree.ts";

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

  it("verify→archive approve flips status verify → archive", async () => {
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
      // worktreePath is cleared — no dangling pointer to the removed dir.
      expect(after?.worktreePath).toBeNull();
      // Branch survives.
      const branch = execSync("git branch --list sakti/fix", { cwd, shell: "/bin/sh" }).toString();
      expect(branch).toContain("sakti/fix");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("plan→mission approve returns 500 and keeps the gate when worktree creation fails", async () => {
    const { app, ctx } = await makeApp([confirmRoutes]);
    const cwd = mkdtempSync(join(tmpdir(), "sakti-confirm-fail-"));
    // Has a change dir (so changeName resolves) but is NOT a git repo →
    // createMissionWorktree throws on detectDefaultBranch.
    execSync(`mkdir -p ${cwd}/.sakti/changes/broken`, { shell: "/bin/sh" });
    execSync(`echo "name: broken" > ${cwd}/.sakti/changes/broken/.sakti.yaml`, {
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

      expect(res.status).toBe(500);
      // The gate stays for retry — pending NOT cleared.
      const after = ctx.repos.sessions.findById(session.id);
      expect(after?.pendingTransitionTo).toBe("mission");
      expect(after?.worktreePath).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("plan→mission approve absorbs change content, cleans main, symlinks dependency dirs", async () => {
    const { app, ctx } = await makeApp([confirmRoutes]);
    const cwd = mkdtempSync(join(tmpdir(), "sakti-confirm-v2-"));
    execSync("git init -b main", { cwd, shell: "/bin/sh" });
    execSync("git config user.email t@t.com", { cwd, shell: "/bin/sh" });
    execSync("git config user.name t", { cwd, shell: "/bin/sh" });
    execSync("git commit --allow-empty -m init", { cwd, shell: "/bin/sh" });
    // Main has an uncommitted change dir + dependency/cache dirs.
    execSync(`mkdir -p ${cwd}/.sakti/changes/add-feature`, { shell: "/bin/sh" });
    execSync(`echo "name: add-feature" > ${cwd}/.sakti/changes/add-feature/.sakti.yaml`, {
      shell: "/bin/sh",
    });
    execSync(`echo "# proposal" > ${cwd}/.sakti/changes/add-feature/proposal.md`, {
      shell: "/bin/sh",
    });
    execSync(`mkdir -p ${cwd}/node_modules`, { shell: "/bin/sh" });
    execSync(`mkdir -p ${cwd}/.venv`, { shell: "/bin/sh" });
    process.env.SAKTI_AGENT_DIR = join(cwd, "agent");

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
      const wt = after!.worktreePath!;
      // Change content absorbed + committed in the worktree.
      expect(existsSync(join(wt, ".sakti/changes/add-feature/proposal.md"))).toBe(true);
      const committed = execSync(`git -C "${wt}" show --stat --oneline HEAD`, {
        shell: "/bin/sh",
      }).toString();
      expect(committed).toContain(".sakti/changes/add-feature/proposal.md");
      // Main cleaned — change dir gone from main.
      expect(existsSync(join(cwd, ".sakti/changes/add-feature"))).toBe(false);
      // Dependency/cache dirs symlinked from curated defaults.
      expect(readlinkSync(join(wt, "node_modules"))).toBe(join(cwd, "node_modules"));
      expect(readlinkSync(join(wt, ".venv"))).toBe(join(cwd, ".venv"));
      // Branch survives with the change content.
      expect(
        execSync(`git -C "${cwd}" branch --list sakti/add-feature`, {
          shell: "/bin/sh",
        }).toString(),
      ).toContain("sakti/add-feature");
    } finally {
      delete process.env.SAKTI_AGENT_DIR;
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("plan→mission approve returns 500 if main gets dirty before approval", async () => {
    const { app, ctx } = await makeApp([confirmRoutes]);
    const cwd = mkdtempSync(join(tmpdir(), "sakti-confirm-dirty-"));
    execSync("git init -b main", { cwd, shell: "/bin/sh" });
    execSync("git config user.email t@t.com", { cwd, shell: "/bin/sh" });
    execSync("git config user.name t", { cwd, shell: "/bin/sh" });
    execSync("git commit --allow-empty -m init", { cwd, shell: "/bin/sh" });
    execSync(`mkdir -p ${cwd}/.sakti/changes/add-feature ${cwd}/src`, { shell: "/bin/sh" });
    execSync(`echo "name: add-feature" > ${cwd}/.sakti/changes/add-feature/.sakti.yaml`, {
      shell: "/bin/sh",
    });
    execSync(`echo "# proposal" > ${cwd}/.sakti/changes/add-feature/proposal.md`, {
      shell: "/bin/sh",
    });
    execSync(`echo "dirty" > ${cwd}/src/dirty.ts`, { shell: "/bin/sh" });
    process.env.SAKTI_AGENT_DIR = join(cwd, "agent");

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

      expect(res.status).toBe(500);
      const after = ctx.repos.sessions.findById(session.id);
      expect(after?.pendingTransitionTo).toBe("mission");
      expect(after?.worktreePath).toBeNull();
    } finally {
      delete process.env.SAKTI_AGENT_DIR;
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("plan→mission approve uses global dependency symlink override from settings.json", async () => {
    const { app, ctx } = await makeApp([confirmRoutes]);
    const cwd = mkdtempSync(join(tmpdir(), "sakti-confirm-deps-"));
    execSync("git init -b main", { cwd, shell: "/bin/sh" });
    execSync("git config user.email t@t.com", { cwd, shell: "/bin/sh" });
    execSync("git config user.name t", { cwd, shell: "/bin/sh" });
    execSync("git commit --allow-empty -m init", { cwd, shell: "/bin/sh" });
    execSync(`mkdir -p ${cwd}/.sakti/changes/add-feature ${cwd}/custom-cache`, {
      shell: "/bin/sh",
    });
    execSync(`echo "name: add-feature" > ${cwd}/.sakti/changes/add-feature/.sakti.yaml`, {
      shell: "/bin/sh",
    });
    execSync(`echo "# proposal" > ${cwd}/.sakti/changes/add-feature/proposal.md`, {
      shell: "/bin/sh",
    });
    ctx.settingsFile.update({
      worktree: { dependencySymlinkDirs: ["custom-cache"] },
    });
    process.env.SAKTI_AGENT_DIR = join(cwd, "agent");

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
      expect(readlinkSync(join(after!.worktreePath!, "custom-cache"))).toBe(
        join(cwd, "custom-cache"),
      );
    } finally {
      delete process.env.SAKTI_AGENT_DIR;
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("plan→mission approve allows tracked clean change dirs and leaves main clean", async () => {
    const { app, ctx } = await makeApp([confirmRoutes]);
    const cwd = mkdtempSync(join(tmpdir(), "sakti-confirm-tracked-"));
    const stateDir = mkdtempSync(join(tmpdir(), "sakti-state-"));
    execSync("git init -b main", { cwd, shell: "/bin/sh" });
    execSync("git config user.email t@t.com", { cwd, shell: "/bin/sh" });
    execSync("git config user.name t", { cwd, shell: "/bin/sh" });
    execSync("mkdir -p .sakti/changes/add-feature", { cwd, shell: "/bin/sh" });
    execSync("printf 'name: add-feature\n' > .sakti/changes/add-feature/.sakti.yaml", {
      cwd,
      shell: "/bin/sh",
    });
    execSync("printf '# proposal\n' > .sakti/changes/add-feature/proposal.md", {
      cwd,
      shell: "/bin/sh",
    });
    execSync("git add . && git commit -m init", { cwd, shell: "/bin/sh" });
    process.env.SAKTI_AGENT_DIR = join(stateDir, "agent");

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
      expect(after?.worktreePath).not.toBeNull();
      expect(existsSync(join(cwd, ".sakti/changes/add-feature/proposal.md"))).toBe(true);
      expect(
        execSync("git status --porcelain --untracked-files=all", {
          cwd,
          shell: "/bin/sh",
        }).toString(),
      ).toBe("");
    } finally {
      delete process.env.SAKTI_AGENT_DIR;
      rmSync(cwd, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("rolls back a pre-existing mission branch when graduation fails after absorb", async () => {
    const { app, ctx } = await makeApp([confirmRoutes]);
    const cwd = mkdtempSync(join(tmpdir(), "sakti-confirm-rollback-"));
    const stateDir = mkdtempSync(join(tmpdir(), "sakti-state-"));
    execSync("git init -b main", { cwd, shell: "/bin/sh" });
    execSync("git config user.email t@t.com", { cwd, shell: "/bin/sh" });
    execSync("git config user.name t", { cwd, shell: "/bin/sh" });
    execSync("git commit --allow-empty -m init", { cwd, shell: "/bin/sh" });
    execSync("git checkout -b sakti/add-feature", { cwd, shell: "/bin/sh" });
    execSync("printf 'tracked-file\n' > cache-parent", { cwd, shell: "/bin/sh" });
    execSync("printf 'branch-original\n' > branch.txt", { cwd, shell: "/bin/sh" });
    execSync("git add cache-parent branch.txt && git commit -m branch-original", {
      cwd,
      shell: "/bin/sh",
    });
    const originalHead = execSync("git rev-parse HEAD", { cwd, shell: "/bin/sh" })
      .toString()
      .trim();
    execSync("git checkout main", { cwd, shell: "/bin/sh" });
    execSync("mkdir -p .sakti/changes/add-feature cache-parent/child", { cwd, shell: "/bin/sh" });
    execSync("printf 'name: add-feature\n' > .sakti/changes/add-feature/.sakti.yaml", {
      cwd,
      shell: "/bin/sh",
    });
    execSync("printf '# proposal\n' > .sakti/changes/add-feature/proposal.md", {
      cwd,
      shell: "/bin/sh",
    });
    ctx.settingsFile.update({ worktree: { dependencySymlinkDirs: ["cache-parent/child"] } });
    process.env.SAKTI_AGENT_DIR = join(stateDir, "agent");

    try {
      // Prove the failure trigger: create a real worktree and verify linkDependencyDirs throws
      const probeWt = createMissionWorktree(cwd, "probe-project-id", "add-feature");
      expect(() => linkDependencyDirs(cwd, probeWt, ["cache-parent/child"])).toThrow();
      execSync(`git worktree remove --force "${probeWt}"`, {
        cwd,
        shell: "/bin/sh",
        stdio: "ignore",
      });

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

      expect(res.status).toBe(500);
      expect(
        execSync("git rev-parse refs/heads/sakti/add-feature", {
          cwd,
          shell: "/bin/sh",
        })
          .toString()
          .trim(),
      ).toBe(originalHead);
      const after = ctx.repos.sessions.findById(session.id);
      expect(after?.pendingTransitionTo).toBe("mission");
      expect(after?.worktreePath).toBeNull();
    } finally {
      delete process.env.SAKTI_AGENT_DIR;
      rmSync(cwd, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
