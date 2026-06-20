import { Elysia, t } from "elysia";
import { getCtx } from "../context.ts";

const GIT_TIMEOUT_MS = 10_000;

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
    return { kind: "ok", output: stdout };
  }
  const stderr = await new Response(proc.stderr).text();
  return { kind: "ok", output: `${stdout}${stderr}`.trim() };
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
  );
