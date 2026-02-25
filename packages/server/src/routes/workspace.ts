/**
 * Workspace API - Returns current workspace information
 *
 * Provides information about the current directory context including
 * project detection results and VCS information.
 */

import { Instance } from "@sakti-code/core/server";
import { createLogger } from "@sakti-code/shared/logger";
import { Hono } from "hono";
import type { Env } from "../index";
import { sessionBridge } from "../middleware/session-bridge";

const app = new Hono<Env>();
const logger = createLogger("server");

// Apply session bridge middleware to establish Instance context
app.use("*", sessionBridge);

/**
 * GET /api/workspace
 *
 * Returns current workspace information including directory, project info,
 * VCS info, and context status.
 *
 * Usage:
 * GET /api/workspace?directory=/path/to/project
 * Headers:
 *   - X-Task-Session-ID: <session-id> (optional)
 *
 * Response:
 * {
 *   "directory": "/absolute/path/to/project",
 *   "project": {
 *     "name": "project-name",
 *     "root": "/absolute/path/to/project",
 *     "packageJson": { ... }
 *   },
 *   "vcs": {
 *     "type": "git",
 *     "branch": "main",
 *     "commit": "abc12345",
 *     "remote": "git@github.com:user/repo.git"
 *   },
 *   "inContext": true
 * }
 */
app.get("/api/workspace", async c => {
  const requestId = c.get("requestId");
  const session = c.get("session");

  try {
    const buildWorkspace = () => ({
      directory: Instance.directory,
      project: Instance.project,
      vcs: Instance.vcs,
      inContext: Instance.inContext,
      sessionId: session?.taskSessionId,
    });

    const workspace = Instance.inContext
      ? await (async () => {
          await Instance.bootstrap();
          return buildWorkspace();
        })()
      : await Instance.provide({
          directory: process.cwd(),
          sessionID: session?.taskSessionId,
          async fn() {
            await Instance.bootstrap();
            return buildWorkspace();
          },
        });

    logger.debug("Workspace info retrieved", {
      module: "workspace",
      requestId,
      directory: workspace.directory,
      projectName: workspace.project?.name,
      vcsType: workspace.vcs?.type,
    });

    return c.json(workspace);
  } catch (error) {
    // Instance.context will throw if not in context, but sessionBridge
    // should always establish context, so this should be rare
    logger.error("Failed to get workspace info", error instanceof Error ? error : undefined, {
      module: "workspace",
      requestId,
    });

    return c.json(
      {
        error: "Workspace context not available",
        inContext: false,
      },
      500
    );
  }
});

export default app;
