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
      env: { ...process.env, GIT_PAGER: "", LC_ALL: "C" },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    return null;
  }
}

async function runGitTimed(
  args: string[],
  cwd: string,
  timeoutMs: number = GIT_TIMEOUT_MS
): Promise<string> {
  const proc = trySpawnGit(args, cwd);
  if (!proc) {
    return "";
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  await proc.exited;
  clearTimeout(timer);

  if (timedOut) {
    return "";
  }
  return new Response(proc.stdout).text();
}

async function hasHead(cwd: string): Promise<boolean> {
  const head = await runGitTimed(["rev-parse", "HEAD"], cwd);
  return head.trim().length > 0;
}

export const turnDiffRoutes = new Elysia({ name: "routes.turnDiff" }).get(
  "/api/sessions/:id/turn-diff",
  async ({ params, query, store }) => {
    const ctx = getCtx(store);
    const session = await ctx.repos.sessions.findById(params.id);
    if (!session) {
      return new Response("Not found", { status: 404 });
    }
    const project = await ctx.repos.projects.findById(session.projectId);
    if (!project) {
      return new Response("Project not found", { status: 404 });
    }

    const cwd = project.cwd;
    const hasHeadCommit = await hasHead(cwd);
    if (!hasHeadCommit) {
      return Response.json({ files: [], diff: "", cwd });
    }

    // Build file filter args
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
