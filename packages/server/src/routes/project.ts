/**
 * Project API Routes
 *
 * GET /api/project - Get current project info
 * GET /api/projects - List all projects
 */

import { Instance } from "@ekacode/core/server";
import { Hono } from "hono";
import type { Env } from "../index";
import { sessionBridge } from "../middleware/session-bridge";

const projectRouter = new Hono<Env>();

projectRouter.use("*", sessionBridge);

/**
 * Get current project info for a directory
 */
projectRouter.get("/api/project", async c => {
  const queryDir = c.req.query("directory")?.trim();

  const buildResponse = () => ({
    id: Instance.project?.root,
    name: Instance.project?.name,
    path: Instance.project?.root,
    detectedBy: Instance.project?.packageJson ? "packageJson" : "directory",
    packageJson: Instance.project?.packageJson,
  });

  if (Instance.inContext) {
    await Instance.bootstrap();
    return c.json(buildResponse());
  }

  if (!queryDir) {
    return c.json({ error: "Directory parameter required" }, 400);
  }

  return await Instance.provide({
    directory: queryDir,
    async fn() {
      await Instance.bootstrap();
      return c.json(buildResponse());
    },
  });
});

/**
 * List all projects
 */
projectRouter.get("/api/projects", async c => {
  const cwd = process.cwd();

  const buildResponse = () => ({
    projects: [
      {
        id: Instance.project?.root,
        name: Instance.project?.name,
        path: Instance.project?.root,
        source: "current",
        lastSeen: Date.now(),
      },
    ],
  });

  if (Instance.inContext) {
    await Instance.bootstrap();
    return c.json(buildResponse());
  }

  return await Instance.provide({
    directory: cwd,
    async fn() {
      await Instance.bootstrap();
      return c.json(buildResponse());
    },
  });
});

export default projectRouter;
