import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../../../../shared/controller/http/validators.js";
import { buildMcpUsecases } from "../factory/mcp.factory.js";

type Env = {
  Variables: {
    requestId: string;
    startTime: number;
    instanceContext: { directory: string } | undefined;
  };
};

const app = new Hono<Env>();
const { getMcpStatusUsecase, resolveMcpDirectory } = buildMcpUsecases();
const mcpQuerySchema = z.object({
  directory: z.string().optional(),
});

app.get("/api/mcp/status", zValidator("query", mcpQuerySchema), async c => {
  const queryDirectory = c.req.valid("query").directory;
  if (queryDirectory?.trim() === "") {
    return c.json({ error: "Directory parameter required" }, 400);
  }

  const resolution = resolveMcpDirectory({
    directory: queryDirectory,
    fallbackDirectory: c.get("instanceContext")?.directory,
  });

  if (!resolution.ok) {
    return c.json({ error: resolution.reason }, 400);
  }

  return c.json(getMcpStatusUsecase(resolution.directory));
});

export const mcpRoutes = app;
