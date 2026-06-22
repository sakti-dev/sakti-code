import { type Context, Hono } from "hono";
import { getCtx } from "../../context.ts";
import { spawnPiped } from "../../lib/spawn.ts";

const GIT_TIMEOUT_MS = 10_000;

interface NumstatEntry {
  additions: number;
  deletions: number;
  path: string;
}

function parseNumstat(output: string): NumstatEntry[] {
  const entries: NumstatEntry[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const parts = trimmed.split("\t");
    if (parts.length < 3) {
      continue;
    }

    const addStr = parts[0] ?? "-";
    const delStr = parts[1] ?? "-";
    const path = parts.slice(2).join("\t");

    const additions = addStr === "-" ? 0 : Number.parseInt(addStr, 10);
    const deletions = delStr === "-" ? 0 : Number.parseInt(delStr, 10);

    if (path) {
      entries.push({ path, additions, deletions });
    }
  }
  return entries.toSorted((a, b) => a.path.localeCompare(b.path));
}

function trySpawnGit(args: string[], cwd: string) {
  try {
    return spawnPiped("git", args, { cwd, env: { ...process.env } });
  } catch {
    return null;
  }
}

export interface GitResult {
  code?: number;
  kind: "ok" | "timeout" | "spawn-error";
  output: string;
}

export async function runGit(
  args: string[],
  cwd: string,
  timeoutMs: number = GIT_TIMEOUT_MS
): Promise<GitResult> {
  const spawned = trySpawnGit(args, cwd);
  if (spawned === null) {
    return { kind: "spawn-error", output: "git not found" };
  }
  const { child, done } = spawned;

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);

  const result = await done;
  clearTimeout(timer);

  // Missing-binary case: Node emits an async ENOENT 'error' event.
  if (result.spawnError) {
    return { kind: "spawn-error", output: "git not found" };
  }
  if (timedOut) {
    return { kind: "timeout", output: "git timed out" };
  }
  if (result.exitCode === 0) {
    return { kind: "ok", code: result.exitCode, output: result.stdout };
  }
  return {
    kind: "ok",
    code: result.exitCode ?? 0,
    output: `${result.stdout}${result.stderr}`.trim(),
  };
}

async function runGitTimed(
  args: string[],
  cwd: string,
  timeoutMs: number = GIT_TIMEOUT_MS
): Promise<string> {
  const result = await runGit(args, cwd, timeoutMs);
  return result.kind === "ok" ? result.output : "";
}

async function hasHead(cwd: string): Promise<boolean> {
  const result = await runGit(["rev-parse", "HEAD"], cwd);
  return result.kind === "ok" && result.code === 0;
}

function handleResult(c: Context, result: GitResult) {
  if (result.kind === "spawn-error") {
    return c.text(result.output, 500);
  }
  return c.text(result.output);
}

async function findProject(c: Context, id: string) {
  const ctx = getCtx(c);
  const project = await ctx.repos.projects.findById(id);
  if (!project) {
    return null;
  }
  return project;
}

export const gitRoutes = new Hono()
  .basePath("/projects")
  .get("/:id/git/status", async (c) => {
    const project = await findProject(c, c.req.param("id"));
    if (!project) {
      return c.text("Not found", 404);
    }
    return handleResult(c, await runGit(["status", "--short"], project.cwd));
  })
  .get("/:id/git/branch", async (c) => {
    const project = await findProject(c, c.req.param("id"));
    if (!project) {
      return c.text("Not found", 404);
    }
    return handleResult(
      c,
      await runGit(["branch", "--show-current"], project.cwd)
    );
  })
  .get("/:id/git/diff", async (c) => {
    const project = await findProject(c, c.req.param("id"));
    if (!project) {
      return c.text("Not found", 404);
    }
    const stagedParam = c.req.query("staged");
    const pathParam = c.req.query("path");
    const args: string[] = ["diff"];
    if (stagedParam !== undefined && stagedParam !== "false") {
      args.push("--cached");
    }
    if (pathParam) {
      args.push("--", pathParam);
    }
    return handleResult(c, await runGit(args, project.cwd));
  })
  .get("/:id/git/log", async (c) => {
    const project = await findProject(c, c.req.param("id"));
    if (!project) {
      return c.text("Not found", 404);
    }
    const rawLimit = c.req.query("limit") ?? "20";
    const limit = Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(limit) || limit < 0) {
      return c.text("Invalid limit", 400);
    }
    return handleResult(
      c,
      await runGit(["log", "-n", String(limit), "--oneline"], project.cwd)
    );
  })
  .get("/:id/git/turn-diff", async (c) => {
    const project = await findProject(c, c.req.param("id"));
    if (!project) {
      return c.text("Not found", 404);
    }

    const cwd = project.cwd;
    const hasHeadCommit = await hasHead(cwd);
    if (!hasHeadCommit) {
      return c.json({ files: [], diff: "", cwd });
    }

    const filesParam = c.req.queries("files[]");
    const queryFiles = filesParam ? filesParam.filter(Boolean) : [];

    const diffArgs: string[] = ["diff", "HEAD"];
    const numstatArgs: string[] = ["diff", "HEAD", "--numstat"];
    if (queryFiles.length > 0) {
      diffArgs.push("--", ...queryFiles);
      numstatArgs.push("--", ...queryFiles);
    }

    const [diff, numstat] = await Promise.all([
      runGitTimed(diffArgs, cwd),
      runGitTimed(numstatArgs, cwd),
    ]);

    const files = parseNumstat(numstat);

    return c.json({ files, diff, cwd });
  });
