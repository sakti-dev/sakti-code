import { Elysia, t } from "elysia";
import { getCtx } from "../../context.ts";

const WORKSPACE_KEY = "workspace:sessions";

const sessionPathBody = t.Object({
  sessionPath: t.String(),
});

function parsePaths(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const workspaceRoutes = new Elysia({ name: "routes.workspace" })
  .get("/api/workspace/sessions", ({ store }) => {
    const ctx = getCtx(store);
    const raw = ctx.repos.settings.get(WORKSPACE_KEY);
    return Response.json(parsePaths(raw));
  })
  .post(
    "/api/workspace/sessions",
    async ({ body, store }) => {
      const ctx = getCtx(store);
      const raw = ctx.repos.settings.get(WORKSPACE_KEY);
      const paths = parsePaths(raw);
      if (!paths.includes(body.sessionPath)) {
        paths.push(body.sessionPath);
        await ctx.repos.settings.set(WORKSPACE_KEY, JSON.stringify(paths));
      }
      return Response.json(paths);
    },
    { body: sessionPathBody }
  )
  .delete("/api/workspace/sessions/:path", async ({ params, store }) => {
    const ctx = getCtx(store);
    const decodedPath = decodeURIComponent(params.path);
    const raw = ctx.repos.settings.get(WORKSPACE_KEY);
    const paths = parsePaths(raw).filter((p: string) => p !== decodedPath);
    await ctx.repos.settings.set(WORKSPACE_KEY, JSON.stringify(paths));
    return Response.json(paths);
  });
