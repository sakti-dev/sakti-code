import { Elysia, t } from "elysia";
import { getCtx } from "../context.ts";

const GIT_TIMEOUT_MS = 10_000;

async function runGit(
  args: string[],
  cwd: string
): Promise<{ output: string; timedOut: boolean }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => proc.kill(), GIT_TIMEOUT_MS);

  try {
    const exited = await proc.exited;
    clearTimeout(timer);
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const output = exited === 0 ? stdout : `${stdout}${stderr}`.trim();
    return { output, timedOut: false };
  } catch {
    clearTimeout(timer);
    return { output: "git timed out", timedOut: true };
  }
}

const statusQuery = t.Object({ projectId: t.String() });
const branchQuery = t.Object({ projectId: t.String() });
const diffQuery = t.Object({
  path: t.Optional(t.String()),
  projectId: t.String(),
  staged: t.Optional(t.Boolean()),
});
const logQuery = t.Object({
  limit: t.Optional(t.Integer()),
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
      const { output } = await runGit(["status", "--short"], project.cwd);
      return output;
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
      const { output } = await runGit(
        ["branch", "--show-current"],
        project.cwd
      );
      return output;
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
      const { output } = await runGit(args, project.cwd);
      return output;
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
      const { output } = await runGit(
        ["log", "-n", String(limit), "--oneline"],
        project.cwd
      );
      return output;
    },
    { query: logQuery }
  );
