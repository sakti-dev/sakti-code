/**
 * Project Keypoints API - Milestone tracking for tasks
 *
 * Provides endpoints for creating and listing project keypoints.
 * Keypoints track task start/completion milestones with latest-wins deduplication.
 */

import { Hono } from "hono";
import {
  createProjectKeypoint,
  deleteProjectKeypoint,
  listProjectKeypointsByWorkspace,
} from "../../db/project-keypoints";
import type { Env } from "../index";

const app = new Hono<Env>();

function serializeKeypoint(keypoint: Awaited<ReturnType<typeof listProjectKeypointsByWorkspace>>[number]) {
  return {
    id: keypoint.id,
    workspaceId: keypoint.workspaceId,
    taskSessionId: keypoint.taskSessionId,
    taskTitle: keypoint.taskTitle,
    milestone: keypoint.milestone,
    completedAt: keypoint.completedAt.toISOString(),
    summary: keypoint.summary,
    artifacts: keypoint.artifacts,
    createdAt: keypoint.createdAt.toISOString(),
  };
}

/**
 * List project keypoints for a workspace
 *
 * Usage:
 * GET /api/project-keypoints?workspaceId=xxx
 *
 * Returns:
 * {
 *   keypoints: [
 *     { id, workspaceId, taskSessionId, taskTitle, milestone, completedAt, summary, artifacts, createdAt }
 *   ]
 * }
 */
app.get("/api/project-keypoints", async c => {
  const workspaceId = c.req.query("workspaceId");

  if (!workspaceId) {
    return c.json({ error: "workspaceId query parameter required" }, 400);
  }

  try {
    const keypoints = await listProjectKeypointsByWorkspace(workspaceId);
    const serialized = keypoints.map(serializeKeypoint);

    return c.json({ keypoints: serialized });
  } catch (error) {
    console.error("Failed to list project keypoints:", error);
    return c.json({ error: "Failed to list project keypoints" }, 500);
  }
});

/**
 * Create a new project keypoint
 *
 * Usage:
 * POST /api/project-keypoints
 * Body: {
 *   workspaceId: string,
 *   taskSessionId: string,
 *   taskTitle: string,
 *   milestone: "started" | "completed",
 *   summary: string,
 *   artifacts?: string[]
 * }
 *
 * Note: Creating a keypoint with the same (taskSessionId, milestone) replaces the previous one.
 */
app.post("/api/project-keypoints", async c => {
  try {
    const body = await c.req.json();
    const { workspaceId, taskSessionId, taskTitle, milestone, summary, artifacts } = body;

    if (!workspaceId) {
      return c.json({ error: "workspaceId is required" }, 400);
    }
    if (!taskSessionId) {
      return c.json({ error: "taskSessionId is required" }, 400);
    }
    if (!taskTitle) {
      return c.json({ error: "taskTitle is required" }, 400);
    }
    if (!milestone || !["started", "completed"].includes(milestone)) {
      return c.json({ error: "milestone must be 'started' or 'completed'" }, 400);
    }
    if (!summary) {
      return c.json({ error: "summary is required" }, 400);
    }

    const keypoint = await createProjectKeypoint({
      workspaceId,
      taskSessionId,
      taskTitle,
      milestone,
      summary,
      artifacts,
    });

    return c.json({ keypoint: serializeKeypoint(keypoint) }, 201);
  } catch (error) {
    console.error("Failed to create project keypoint:", error);
    return c.json({ error: "Failed to create project keypoint" }, 500);
  }
});

/**
 * Delete a project keypoint
 *
 * Usage:
 * DELETE /api/project-keypoints/:id
 */
app.delete("/api/project-keypoints/:id", async c => {
  const { id } = c.req.param();

  try {
    await deleteProjectKeypoint(id);
    return c.json({ success: true });
  } catch (error) {
    console.error("Failed to delete project keypoint:", error);
    return c.json({ error: "Failed to delete project keypoint" }, 500);
  }
});

export default app;
