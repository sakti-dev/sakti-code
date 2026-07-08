import { execSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  absorbChangeContent,
  cleanMainChangeDir,
  createMissionWorktree,
  deleteMissionBranch,
  detectDefaultBranch,
  linkDependencyDirs,
  missionBranchExists,
  preflightWorktree,
  removeMissionWorktree,
  worktreePathFor,
} from "../worktree.ts";

function initGitRepo(dir: string): void {
  execSync("git init -b main", { cwd: dir, shell: "/bin/sh" });
  execSync("git config user.email test@test.com", { cwd: dir, shell: "/bin/sh" });
  execSync("git config user.name test", { cwd: dir, shell: "/bin/sh" });
  execSync("git commit --allow-empty -m init", { cwd: dir, shell: "/bin/sh" });
}

describe("worktree ops", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "sakti-wt-"));
    process.env.SAKTI_AGENT_DIR = join(projectDir, "agent");
  });

  afterEach(() => {
    // Clean up worktrees + the project dir.
    try {
      execSync("git worktree prune", { cwd: projectDir, shell: "/bin/sh", stdio: "ignore" });
    } catch {
      // ignore
    }
    rmSync(projectDir, { recursive: true, force: true });
    delete process.env.SAKTI_AGENT_DIR;
  });

  describe("detectDefaultBranch", () => {
    it("returns 'main' for a repo initialized with main", () => {
      initGitRepo(projectDir);
      expect(detectDefaultBranch(projectDir)).toBe("main");
    });

    it("returns null for a non-git directory", () => {
      expect(detectDefaultBranch(projectDir)).toBeNull();
    });
  });

  describe("preflightWorktree", () => {
    it("passes for a clean git repo", () => {
      initGitRepo(projectDir);
      expect(preflightWorktree(projectDir, null)).toBeNull();
    });

    it("returns an error message for a non-git directory", () => {
      const err = preflightWorktree(projectDir, null);
      expect(err).not.toBeNull();
      expect(err).toContain("git");
    });
  });

  describe("preflightWorktree clean check", () => {
    it("passes when only .sakti/changes/<change>/ is dirty", () => {
      initGitRepo(projectDir);
      mkdirSync(join(projectDir, ".sakti/changes/add"), { recursive: true });
      writeFileSync(join(projectDir, ".sakti/changes/add/proposal.md"), "x");
      expect(preflightWorktree(projectDir, "add")).toBeNull();
    });

    it("passes when a tracked file under .sakti/changes/<change>/ is modified", () => {
      initGitRepo(projectDir);
      mkdirSync(join(projectDir, ".sakti/changes/add"), { recursive: true });
      writeFileSync(join(projectDir, ".sakti/changes/add/proposal.md"), "x");
      execSync("git add .sakti/changes/add/proposal.md", { cwd: projectDir, shell: "/bin/sh" });
      execSync("git commit -m add-change", { cwd: projectDir, shell: "/bin/sh" });
      writeFileSync(join(projectDir, ".sakti/changes/add/proposal.md"), "changed");
      expect(preflightWorktree(projectDir, "add")).toBeNull();
    });

    it("returns an error when an unrelated file is dirty", () => {
      initGitRepo(projectDir);
      mkdirSync(join(projectDir, "src"), { recursive: true });
      writeFileSync(join(projectDir, "src/dirty.ts"), "oops");
      const err = preflightWorktree(projectDir, "add");
      expect(err).not.toBeNull();
      expect(err).toContain("clean");
    });

    it("returns an error when another .sakti path is dirty", () => {
      initGitRepo(projectDir);
      mkdirSync(join(projectDir, ".sakti/changes/add"), { recursive: true });
      writeFileSync(join(projectDir, ".sakti/changes/add/proposal.md"), "x");
      mkdirSync(join(projectDir, ".sakti/changes/other"), { recursive: true });
      writeFileSync(join(projectDir, ".sakti/changes/other/proposal.md"), "y");
      const err = preflightWorktree(projectDir, "add");
      expect(err).not.toBeNull();
      expect(err).toContain("other");
    });

    it("requires a fully clean tree when no active change is given", () => {
      initGitRepo(projectDir);
      writeFileSync(join(projectDir, "loose.txt"), "x");
      expect(preflightWorktree(projectDir, null)).not.toBeNull();
    });
  });

  describe("worktreePathFor", () => {
    it("returns <base>/<projectBasename>--<changeName>", () => {
      expect(worktreePathFor("/tmp/base", "/home/u/code/myapp", "pid1", "add-thing")).toBe(
        "/tmp/base/myapp--add-thing",
      );
    });

    it("appends --<projectId[:8]> when the primary path already exists", () => {
      const base = mkdtempSync(join(tmpdir(), "sakti-wp-"));
      const projectCwd = "/home/u/code/myapp";
      // Pre-create the primary path so it collides.
      mkdirSync(join(base, "myapp--dupe"), { recursive: true });
      const p = worktreePathFor(base, projectCwd, "abcdefgh12345678", "dupe");
      expect(p).toBe(join(base, "myapp--dupe--abcdefgh"));
      rmSync(base, { recursive: true, force: true });
    });

    it("does not append a suffix when there is no collision", () => {
      const base = mkdtempSync(join(tmpdir(), "sakti-wp2-"));
      const p = worktreePathFor(base, "/home/u/code/myapp", "pid1", "clean");
      expect(p).toBe(join(base, "myapp--clean"));
      rmSync(base, { recursive: true, force: true });
    });
  });

  describe("createMissionWorktree + removeMissionWorktree", () => {
    it("creates a worktree under <base>/<projectBasename>--<changeName> and a sakti/<changeName> branch", () => {
      initGitRepo(projectDir);
      const wtPath = createMissionWorktree(projectDir, "proj-test001", "add-feature");
      expect(existsSync(wtPath)).toBe(true);
      expect(wtPath).toContain("add-feature");
      expect(wtPath).toContain("--add-feature");
      // The branch exists in the worktree.
      const branch = execSync("git branch --list sakti/add-feature", {
        cwd: projectDir,
        shell: "/bin/sh",
      }).toString();
      expect(branch).toContain("sakti/add-feature");
    });

    it("removeMissionWorktree removes the dir but keeps the branch", () => {
      initGitRepo(projectDir);
      const wt = createMissionWorktree(projectDir, "proj-test001", "add-feature");
      removeMissionWorktree(projectDir, wt);
      expect(existsSync(wt)).toBe(false);
      const branch = execSync("git branch --list sakti/add-feature", {
        cwd: projectDir,
        shell: "/bin/sh",
      }).toString();
      expect(branch).toContain("sakti/add-feature");
    });

    it("reuses a surviving sakti/<changeName> branch instead of failing", () => {
      // After an archive→done teardown the branch is kept; a later mission with
      // the same change name must not hard-fail on `worktree add -b` (duplicate
      // branch). It should re-checkout the existing branch.
      initGitRepo(projectDir);
      const wt = createMissionWorktree(projectDir, "proj-test001", "recycle");
      removeMissionWorktree(projectDir, wt);
      // Second creation with the surviving branch — must not throw.
      const wt2 = createMissionWorktree(projectDir, "proj-test001", "recycle");
      expect(existsSync(wt2)).toBe(true);
      expect(wt2).toBe(wt);
    });
  });

  describe("absorbChangeContent", () => {
    it("copies .sakti/changes/<change>/ into the worktree and commits it on the branch", () => {
      initGitRepo(projectDir);
      // Main repo has an uncommitted change dir.
      mkdirSync(join(projectDir, ".sakti/changes/add-feature"), { recursive: true });
      writeFileSync(join(projectDir, ".sakti/changes/add-feature/proposal.md"), "# proposal");
      // Create the worktree (base checkout, no change dir).
      const wt = createMissionWorktree(projectDir, "proj-aaaaaaaa", "add-feature");
      absorbChangeContent(projectDir, wt, "add-feature");
      // The change dir now exists in the worktree AND is committed on sakti/add-feature.
      expect(existsSync(join(wt, ".sakti/changes/add-feature/proposal.md"))).toBe(true);
      const committed = execSync(`git -C "${wt}" show --stat --oneline HEAD`, {
        shell: "/bin/sh",
      }).toString();
      expect(committed).toContain(".sakti/changes/add-feature/proposal.md");
    });

    it("is a no-op when main has no change dir", () => {
      initGitRepo(projectDir);
      const wt = createMissionWorktree(projectDir, "proj-bbbbbbbb", "nochange");
      expect(() => absorbChangeContent(projectDir, wt, "nochange")).not.toThrow();
    });
  });

  describe("cleanMainChangeDir", () => {
    it("removes the change dir from the main working tree", () => {
      initGitRepo(projectDir);
      const dir = join(projectDir, ".sakti/changes/killme");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "proposal.md"), "x");
      cleanMainChangeDir(projectDir, "killme");
      expect(existsSync(dir)).toBe(false);
    });

    it("is a no-op when the dir is absent", () => {
      initGitRepo(projectDir);
      expect(() => cleanMainChangeDir(projectDir, "absent")).not.toThrow();
    });

    it("throws instead of dirtying main when the change dir is tracked", () => {
      initGitRepo(projectDir);
      const dir = join(projectDir, ".sakti/changes/tracked");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "proposal.md"), "x");
      execSync("git add .sakti/changes/tracked/proposal.md", { cwd: projectDir, shell: "/bin/sh" });
      execSync("git commit -m tracked-change", { cwd: projectDir, shell: "/bin/sh" });
      expect(() => cleanMainChangeDir(projectDir, "tracked")).toThrow("tracked change dir");
      const status = execSync("git status --porcelain", {
        cwd: projectDir,
        shell: "/bin/sh",
      }).toString();
      expect(status).toBe("");
    });
  });

  describe("linkDependencyDirs", () => {
    it("symlinks each configured dependency dir that exists in main", () => {
      initGitRepo(projectDir);
      mkdirSync(join(projectDir, "node_modules"), { recursive: true });
      mkdirSync(join(projectDir, ".venv"), { recursive: true });
      const wt = createMissionWorktree(projectDir, "proj-cccccccc", "dep");
      linkDependencyDirs(projectDir, wt, ["node_modules", ".venv", "target"]);
      expect(readlinkSync(join(wt, "node_modules"))).toBe(join(projectDir, "node_modules"));
      expect(readlinkSync(join(wt, ".venv"))).toBe(join(projectDir, ".venv"));
      expect(existsSync(join(wt, "target"))).toBe(false);
    });

    it("is a no-op when main has none of the configured dependency dirs", () => {
      initGitRepo(projectDir);
      const wt = createMissionWorktree(projectDir, "proj-dddddddd", "nodep");
      expect(() => linkDependencyDirs(projectDir, wt, ["node_modules", ".venv"])).not.toThrow();
      expect(existsSync(join(wt, "node_modules"))).toBe(false);
      expect(existsSync(join(wt, ".venv"))).toBe(false);
    });

    it("does not replace an existing worktree path", () => {
      initGitRepo(projectDir);
      mkdirSync(join(projectDir, "target"), { recursive: true });
      const wt = createMissionWorktree(projectDir, "proj-eeeeeeee", "existing");
      mkdirSync(join(wt, "target"), { recursive: true });
      linkDependencyDirs(projectDir, wt, ["target"]);
      expect(lstatSync(join(wt, "target")).isSymbolicLink()).toBe(false);
    });
  });

  describe("mission branch helpers", () => {
    it("reports and deletes mission branches by change name", () => {
      initGitRepo(projectDir);
      expect(missionBranchExists(projectDir, "cleanup")).toBe(false);
      const wt = createMissionWorktree(projectDir, "proj-test001", "cleanup");
      expect(missionBranchExists(projectDir, "cleanup")).toBe(true);
      removeMissionWorktree(projectDir, wt);
      deleteMissionBranch(projectDir, "cleanup");
      expect(missionBranchExists(projectDir, "cleanup")).toBe(false);
    });
  });
});
