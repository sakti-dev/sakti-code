import { Elysia, t } from "elysia";
import { getCtx } from "../context.ts";

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
    return Bun.spawn(["git", ...args], {
      cwd,
      env: { ...process.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
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
  const proc = trySpawnGit(args, cwd);
  if (proc === null) {
    return { kind: "spawn-error", output: "git not found" };
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  const code = await proc.exited;
  clearTimeout(timer);

  if (timedOut) {
    return { kind: "timeout", output: "git timed out" };
  }

  const stdout = await new Response(proc.stdout).text();
  if (code === 0) {
    return { kind: "ok", code, output: stdout };
  }
  const stderr = await new Response(proc.stderr).text();
  return { kind: "ok", code, output: `${stdout}${stderr}`.trim() };
}

async function runGitTimed(
  args: string[],
  cwd: string,
  timeoutMs: number = GIT_TIMEOUT_MS
): Promise<string> {
  const result = await runGit(args, cwd, timeoutMs);
  // runGit returns spawn-error / timeout as `kind`; treat both as empty string.
  // For non-zero exits, runGit merges stderr into `output` — callers that need
  // to distinguish success from failure should use `runGit` directly.
  return result.kind === "ok" ? result.output : "";
}

async function hasHead(cwd: string): Promise<boolean> {
  // Check the exit code directly: `git rev-parse HEAD` exits non-zero when no
  // commit exists, but runGit merges stderr into `output` for non-zero exits,
  // so checking output emptiness would be unreliable.
  const result = await runGit(["rev-parse", "HEAD"], cwd);
  return result.kind === "ok" && result.code === 0;
}

function handleResult(result: GitResult): Response | string {
  if (result.kind === "spawn-error") {
    return new Response(result.output, { status: 500 });
  }
  return result.output;
}

const statusQuery = t.Object({ projectId: t.String() });
const branchQuery = t.Object({ projectId: t.String() });
const diffQuery = t.Object({
  path: t.Optional(t.String()),
  projectId: t.String(),
  staged: t.Optional(t.Boolean()),
});
const logQuery = t.Object({
  limit: t.Optional(t.Integer({ minimum: 0 })),
  projectId: t.String(),
});
const turnDiffQuery = t.Object({
  projectId: t.String(),
  files: t.Optional(t.Array(t.String())),
});

export const gitRoutes = new Elysia({ name: "routes.git" })
  .get(
    "/api/git/status",
    async ({ query, store }) => {
      const ctx = getCtx(store);
      const project = await ctx.repos.projects.findById(query.projectId);
      if (!project) {
        return new Response("Not found", { status: 404 });
      }
      return handleResult(await runGit(["status", "--short"], project.cwd));
    },
    { query: statusQuery }
  )
  .get(
    "/api/git/branch",
    async ({ query, store }) => {
      const ctx = getCtx(store);
      const project = await ctx.repos.projects.findById(query.projectId);
      if (!project) {
        return new Response("Not found", { status: 404 });
      }
      return handleResult(
        await runGit(["branch", "--show-current"], project.cwd)
      );
    },
    { query: branchQuery }
  )
  .get(
    "/api/git/diff",
    async ({ query, store }) => {
      const ctx = getCtx(store);
      const project = await ctx.repos.projects.findById(query.projectId);
      if (!project) {
        return new Response("Not found", { status: 404 });
      }
      const args: string[] = ["diff"];
      if (query.staged) {
        args.push("--cached");
      }
      if (query.path) {
        args.push("--", query.path);
      }
      return handleResult(await runGit(args, project.cwd));
    },
    { query: diffQuery }
  )
  .get(
    "/api/git/log",
    async ({ query, store }) => {
      const ctx = getCtx(store);
      const project = await ctx.repos.projects.findById(query.projectId);
      if (!project) {
        return new Response("Not found", { status: 404 });
      }
      const limit = query.limit ?? 20;
      return handleResult(
        await runGit(["log", "-n", String(limit), "--oneline"], project.cwd)
      );
    },
    { query: logQuery }
  )
  .get(
    "/api/git/turn-diff",
    async ({ query, store }) => {
      const ctx = getCtx(store);
      const project = await ctx.repos.projects.findById(query.projectId);
      if (!project) {
        return new Response("Not found", { status: 404 });
      }

      const cwd = project.cwd;
      const hasHeadCommit = await hasHead(cwd);
      if (!hasHeadCommit) {
        return Response.json({ files: [], diff: "", cwd });
      }

      const diffArgs: string[] = ["diff", "HEAD"];
      const numstatArgs: string[] = ["diff", "HEAD", "--numstat"];
      if (query.files && query.files.length > 0) {
        diffArgs.push("--", ...query.files);
        numstatArgs.push("--", ...query.files);
      }

      const [diff, numstat] = await Promise.all([
        runGitTimed(diffArgs, cwd),
        runGitTimed(numstatArgs, cwd),
      ]);

      const files = parseNumstat(numstat);

      return Response.json({ files, diff, cwd });
    },
    { query: turnDiffQuery }
  );
