import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../../../../shared/controller/http/validators.js";

type Env = {
  Variables: {
    requestId: string;
    startTime: number;
    instanceContext: { directory: string } | undefined;
  };
};

const app = new Hono<Env>();
const mcpQuerySchema = z.object({
  directory: z.string().optional(),
});

interface DirectoryResolutionResult {
  ok: true;
  directory: string;
}

interface DirectoryResolutionError {
  ok: false;
  reason: string;
}

type DirectoryResolution = DirectoryResolutionResult | DirectoryResolutionError;

function resolveDirectory(
  c: Context<Env>,
  options: { allowFallbackCwd?: boolean } = {}
): DirectoryResolution {
  const queryDir = c.req.query("directory")?.trim();
  const contextDir = c.get("instanceContext")?.directory?.trim();

  const raw = queryDir || contextDir || (options.allowFallbackCwd ? process.cwd() : "");

  if (!raw) {
    return { ok: false, reason: "Directory parameter required" };
  }

  if (!raw.trim()) {
    return { ok: false, reason: "Invalid directory parameter" };
  }

  if (/\u0000/.test(raw)) {
    return { ok: false, reason: "Invalid directory parameter" };
  }

  return { ok: true, directory: raw };
}

app.get("/api/mcp/status", zValidator("query", mcpQuerySchema), async c => {
  const directory = c.req.valid("query").directory?.trim();

  if (directory === "") {
    return c.json({ error: "Directory parameter required" }, 400);
  }

  const resolution = resolveDirectory(c, { allowFallbackCwd: true });

  if (!resolution.ok) {
    return c.json({ error: resolution.reason }, 400);
  }

  return c.json({
    directory: resolution.directory,
    servers: [],
    summary: {
      total: 0,
      connected: 0,
      degraded: 0,
      offline: 0,
    },
  });
});

export const mcpRoutes = app;
