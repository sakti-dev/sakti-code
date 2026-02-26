import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../../../index.js";
import { sessionBridge } from "../../../../middleware/session-bridge.js";
import { zValidator } from "../../../../shared/controller/http/validators.js";
import { getProjectInfo, listProjects } from "../../application/usecases/get-project.usecase.js";

const projectApp = new Hono<Env>();

projectApp.use("*", sessionBridge);

const projectQuerySchema = z.object({
  directory: z.string().trim().min(1).optional(),
});

projectApp.get("/api/project", zValidator("query", projectQuerySchema), async c => {
  const queryDir = c.req.valid("query").directory;

  try {
    const projectInfo = await getProjectInfo(queryDir);
    return c.json(projectInfo);
  } catch (error) {
    if (error instanceof Error && error.message === "Directory parameter required") {
      return c.json({ error: "Directory parameter required" }, 400);
    }
    console.error("Failed to get project info:", error);
    return c.json({ error: "Failed to get project info" }, 500);
  }
});

projectApp.get("/api/projects", async c => {
  try {
    const result = await listProjects();
    return c.json(result);
  } catch (error) {
    console.error("Failed to list projects:", error);
    return c.json({ error: "Failed to list projects" }, 500);
  }
});

export { projectApp };
