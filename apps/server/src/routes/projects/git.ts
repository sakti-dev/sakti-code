import { Elysia, t } from "elysia";
import { getCtx, type ServerContext } from "../../context.ts";

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

  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  clearTimeout(timer);

  if (timedOut) {
    return { kind: "timeout", output: "git timed out" };
  }

  if (code === 0) {
    return { kind: "ok", code, output: stdout };
  }
  return { kind: "ok", code, output: `${stdout}${stderr}`.trim() };
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

function handleResult(result: GitResult): Response | string {
  if (result.kind === "spawn-error") {
    return new Response(result.output, { status: 500 });
  }
  return result.output;
}

async function findProject(store: { ctx?: ServerContext }, id: string) {
  const ctx = getCtx(store);
  const project = await ctx.repos.projects.findById(id);
  if (!project) {
    return null;
  }
  return project;
}

export const gitRoutes = new Elysia({ name: "routes.git", prefix: "/projects" })
  .get("/:id/git/status", async ({ params, store }) => {
    const project = await findProject(store, params.id);
    if (!project) {
      return new Response("Not found", { status: 404 });
    }
    return handleResult(await runGit(["status", "--short"], project.cwd));
  })
  .get("/:id/git/branch", async ({ params, store }) => {
    const project = await findProject(store, params.id);
    if (!project) {
      return new Response("Not found", { status: 404 });
    }
    return handleResult(
      await runGit(["branch", "--show-current"], project.cwd)
    );
  })
  .get(
    "/:id/git/diff",
    async ({ params, query, store }) => {
      const project = await findProject(store, params.id);
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
    {
      query: t.Object({
        path: t.Optional(t.String()),
        staged: t.Optional(t.Boolean()),
      }),
    }
  )
  .get(
    "/:id/git/log",
    async ({ params, query, store }) => {
      const project = await findProject(store, params.id);
      if (!project) {
        return new Response("Not found", { status: 404 });
      }
      const limit = query.limit ?? 20;
      return handleResult(
        await runGit(["log", "-n", String(limit), "--oneline"], project.cwd)
      );
    },
    {
      query: t.Object({
        limit: t.Optional(t.Integer({ minimum: 0 })),
      }),
    }
  )
  .get(
    "/:id/git/turn-diff",
    async ({ params, query, store }) => {
      const project = await findProject(store, params.id);
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
    {
      query: t.Object({
        files: t.Optional(t.Array(t.String())),
      }),
    }
  );
