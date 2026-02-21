/**
 * VCS API Routes
 *
 * GET /api/vcs - Get version control state (git)
 * POST /api/vcs/remote-branches - List remote branches from a repository URL
 * POST /api/vcs/branches - List local branches from a repo path
 * POST /api/vcs/clone - Clone a repository
 * POST /api/vcs/worktree - Create a git worktree
 * GET /api/vcs/worktree/exists - Check if worktree name exists
 * GET /api/vcs/workspaces-dir - Get workspaces directory path
 */

import {
  clone,
  createWorktree,
  getVcsInfo,
  getWorkspacesDir,
  listLocalBranches,
  listRemoteBranches,
  worktreeExists,
} from "@ekacode/core/server";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../index";
import { resolveDirectory } from "./_shared/directory-resolver";

const vcsRouter = new Hono<Env>();

/**
 * Get VCS state
 */
vcsRouter.get("/api/vcs", async c => {
  const directory = c.req.query("directory")?.trim();

  if (directory === "") {
    return c.json({ error: "Directory parameter required" }, 400);
  }

  const resolution = resolveDirectory(c, { allowFallbackCwd: true });

  if (!resolution.ok) {
    return c.json({ error: resolution.reason }, 400);
  }

  const vcs = await getVcsInfo(resolution.directory);

  return c.json({
    directory: resolution.directory,
    type: vcs.type,
    branch: vcs.branch,
    commit: vcs.commit,
    dirty: false,
    ahead: undefined,
    behind: undefined,
    status: vcs.type === "none" ? "uninitialized" : "clean",
  });
});

/**
 * List remote branches from a repository URL
 */
const ListRemoteBranchesSchema = z.object({
  url: z.string().url("Invalid repository URL"),
});

vcsRouter.post("/api/vcs/remote-branches", async c => {
  try {
    const body = await c.req.json();
    const parsed = ListRemoteBranchesSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
    }

    const { url } = parsed.data;

    // Validate allowed hosts
    const allowedHosts = ["github.com", "gitlab.com", "bitbucket.org"];
    try {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname.replace(/^www\./, "");
      if (!allowedHosts.includes(hostname)) {
        return c.json(
          {
            error: `URL hostname not allowed: ${hostname}. Only ${allowedHosts.join(", ")} are supported.`,
          },
          400
        );
      }
    } catch {
      return c.json({ error: "Invalid URL format" }, 400);
    }

    const branches = await listRemoteBranches(url);

    return c.json({ branches });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list remote branches";
    return c.json({ error: message }, 500);
  }
});

/**
 * List local branches from a repo path
 */
const ListLocalBranchesSchema = z.object({
  path: z.string().min(1, "Path is required"),
});

vcsRouter.post("/api/vcs/branches", async c => {
  try {
    const body = await c.req.json();
    const parsed = ListLocalBranchesSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
    }

    const { path } = parsed.data;
    const branches = await listLocalBranches(path);

    return c.json({ branches });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list branches";
    return c.json({ error: message }, 400);
  }
});

/**
 * Clone a repository
 */
const CloneSchema = z.object({
  url: z.string().url("Invalid repository URL"),
  targetDir: z.string().min(1, "Target directory is required"),
  branch: z.string().min(1, "Branch is required"),
});

vcsRouter.post("/api/vcs/clone", async c => {
  try {
    const body = await c.req.json();
    const parsed = CloneSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
    }

    const { url, targetDir, branch } = parsed.data;
    const clonePath = await clone({ url, targetDir, branch });

    return c.json({ path: clonePath });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to clone repository";
    return c.json({ error: message }, 400);
  }
});

/**
 * Create a git worktree
 */
const CreateWorktreeSchema = z.object({
  repoPath: z.string().min(1, "Repository path is required"),
  worktreeName: z.string().min(1, "Worktree name is required"),
  branch: z.string().min(1, "Branch is required"),
  worktreesDir: z.string().min(1, "Worktrees directory is required"),
  createBranch: z.boolean().optional(),
});

vcsRouter.post("/api/vcs/worktree", async c => {
  try {
    const body = await c.req.json();
    const parsed = CreateWorktreeSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
    }

    const { repoPath, worktreeName, branch, worktreesDir, createBranch } = parsed.data;
    const worktreePath = await createWorktree({
      repoPath,
      worktreeName,
      branch,
      worktreesDir,
      createBranch,
    });

    return c.json({ worktreePath });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create worktree";
    return c.json({ error: message }, 400);
  }
});

/**
 * Check if worktree name exists
 */
vcsRouter.get("/api/vcs/worktree/exists", async c => {
  const name = c.req.query("name");
  const worktreesDir = c.req.query("worktreesDir");

  if (!name) {
    return c.json({ error: "Name parameter is required" }, 400);
  }

  if (!worktreesDir) {
    return c.json({ error: "Worktrees directory parameter is required" }, 400);
  }

  const exists = await worktreeExists(name, worktreesDir);

  return c.json({ exists });
});

/**
 * Get workspaces directory path
 */
vcsRouter.get("/api/vcs/workspaces-dir", async c => {
  const path = getWorkspacesDir();
  return c.json({ path });
});

export default vcsRouter;
