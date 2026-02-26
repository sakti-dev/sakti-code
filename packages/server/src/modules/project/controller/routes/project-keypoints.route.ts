import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../../../index.js";
import { zValidator } from "../../../../shared/controller/http/validators.js";
import {
  createProjectKeypoint as createProjectKeypointUseCase,
  deleteProjectKeypoint as deleteProjectKeypointUseCase,
  listProjectKeypoints as listProjectKeypointsUseCase,
} from "../../application/usecases/project-keypoints.usecase.js";

const keypointsApp = new Hono<Env>();

const keypointQuerySchema = z.object({
  workspaceId: z.string().min(1),
});

const createKeypointSchema = z.object({
  workspaceId: z.string().min(1),
  taskSessionId: z.string().min(1),
  taskTitle: z.string().min(1),
  milestone: z.enum(["started", "completed"]),
  summary: z.string().min(1),
  artifacts: z.array(z.string()).optional(),
});

const keypointIdParamSchema = z.object({
  id: z.string().min(1),
});

function serializeKeypoint(
  keypoint: Awaited<ReturnType<typeof listProjectKeypointsUseCase>>[number]
) {
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

keypointsApp.get("/api/project-keypoints", zValidator("query", keypointQuerySchema), async c => {
  const { workspaceId } = c.req.valid("query");

  try {
    const keypoints = await listProjectKeypointsUseCase(workspaceId);
    return c.json({ keypoints: keypoints.map(serializeKeypoint) });
  } catch (error) {
    console.error("Failed to list project keypoints:", error);
    return c.json({ error: "Failed to list project keypoints" }, 500);
  }
});

keypointsApp.post("/api/project-keypoints", zValidator("json", createKeypointSchema), async c => {
  try {
    const { workspaceId, taskSessionId, taskTitle, milestone, summary, artifacts } =
      c.req.valid("json");

    const keypoint = await createProjectKeypointUseCase({
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

keypointsApp.delete(
  "/api/project-keypoints/:id",
  zValidator("param", keypointIdParamSchema),
  async c => {
    const { id } = c.req.valid("param");

    try {
      await deleteProjectKeypointUseCase(id);
      return c.json({ success: true });
    } catch (error) {
      console.error("Failed to delete project keypoint:", error);
      return c.json({ error: "Failed to delete project keypoint" }, 500);
    }
  }
);

export { keypointsApp };
