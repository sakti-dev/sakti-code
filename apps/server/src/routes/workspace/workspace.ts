import { tbValidator } from "@hono/typebox-validator";
import { Hono } from "hono";
import Type from "typebox";
import { getCtx } from "../../context.ts";

const WORKSPACE_KEY = "workspace:sessions";

const sessionPathBody = Type.Object({
  sessionPath: Type.String(),
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

export const workspaceRoutes = new Hono()
  .basePath("/workspace")
  .get("/sessions", (c) => {
    const ctx = getCtx(c);
    const raw = ctx.repos.settings.get(WORKSPACE_KEY);
    return c.json(parsePaths(raw));
  })
  .post("/sessions", tbValidator("json", sessionPathBody), async (c) => {
    const ctx = getCtx(c);
    const body = c.req.valid("json");
    const raw = ctx.repos.settings.get(WORKSPACE_KEY);
    const paths = parsePaths(raw);
    if (!paths.includes(body.sessionPath)) {
      paths.push(body.sessionPath);
      await ctx.repos.settings.set(WORKSPACE_KEY, JSON.stringify(paths));
    }
    return c.json(paths);
  })
  .delete("/sessions/:path", async (c) => {
    const ctx = getCtx(c);
    const decodedPath = decodeURIComponent(c.req.param("path"));
    const raw = ctx.repos.settings.get(WORKSPACE_KEY);
    const paths = parsePaths(raw).filter((p: string) => p !== decodedPath);
    await ctx.repos.settings.set(WORKSPACE_KEY, JSON.stringify(paths));
    return c.json(paths);
  });
