import {
  clone,
  createWorktree,
  getVcsInfo,
  getWorkspacesDir,
  listLocalBranches,
  listRemoteBranches,
  worktreeExists,
} from "@sakti-code/core/server";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../../../index.js";
import { resolveDirectory } from "../../../../routes/_shared/directory-resolver.js";
import { zValidator } from "../../../../shared/controller/http/validators.js";

const vcsRouter = new Hono<Env>();

const vcsQuerySchema = z.object({
  directory: z.string().optional(),
});

vcsRouter.get("/api/vcs", zValidator("query", vcsQuerySchema), async c => {
  const directory = c.req.valid("query").directory?.trim();

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

const ListRemoteBranchesSchema = z.object({
  url: z.string().url("Invalid repository URL"),
});

vcsRouter.post(
  "/api/vcs/remote-branches",
  zValidator("json", ListRemoteBranchesSchema),
  async c => {
    try {
      const { url } = c.req.valid("json");

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
  }
);

const ListLocalBranchesSchema = z.object({
  path: z.string().min(1, "Path is required"),
});

vcsRouter.post("/api/vcs/branches", zValidator("json", ListLocalBranchesSchema), async c => {
  try {
    const { path } = c.req.valid("json");
    const branches = await listLocalBranches(path);

    return c.json({ branches });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list branches";
    return c.json({ error: message }, 400);
  }
});

const CloneSchema = z.object({
  url: z.string().url("Invalid repository URL"),
  targetDir: z.string().min(1, "Target directory is required"),
  branch: z.string().min(1, "Branch is required"),
});

vcsRouter.post("/api/vcs/clone", zValidator("json", CloneSchema), async c => {
  try {
    const { url, targetDir, branch } = c.req.valid("json");
    const clonePath = await clone({ url, targetDir, branch });

    return c.json({ path: clonePath });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to clone repository";
    return c.json({ error: message }, 400);
  }
});

const CreateWorktreeSchema = z.object({
  repoPath: z.string().min(1, "Repository path is required"),
  worktreeName: z.string().min(1, "Worktree name is required"),
  branch: z.string().min(1, "Branch is required"),
  worktreesDir: z.string().min(1, "Worktrees directory is required"),
  createBranch: z.boolean().optional(),
});

vcsRouter.post("/api/vcs/worktree", zValidator("json", CreateWorktreeSchema), async c => {
  try {
    const { repoPath, worktreeName, branch, worktreesDir, createBranch } = c.req.valid("json");
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

const worktreeExistsQuerySchema = z.object({
  name: z.string().min(1),
  worktreesDir: z.string().min(1),
});

vcsRouter.get(
  "/api/vcs/worktree/exists",
  zValidator("query", worktreeExistsQuerySchema),
  async c => {
    const { name, worktreesDir } = c.req.valid("query");

    const exists = await worktreeExists(name, worktreesDir);

    return c.json({ exists });
  }
);

vcsRouter.get("/api/vcs/workspaces-dir", async c => {
  const path = getWorkspacesDir();
  return c.json({ path });
});

export default vcsRouter;
