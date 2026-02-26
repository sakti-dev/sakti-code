import {
  createProjectKeypoint as dbCreateProjectKeypoint,
  deleteProjectKeypoint as dbDeleteProjectKeypoint,
  listProjectKeypointsByWorkspace as dbListProjectKeypointsByWorkspace,
} from "../../../../../db/project-keypoints.js";

export interface ProjectKeypoint {
  id: string;
  workspaceId: string;
  taskSessionId: string;
  taskTitle: string;
  milestone: "started" | "completed";
  completedAt: Date;
  summary: string;
  artifacts: string[];
  createdAt: Date;
}

export interface CreateProjectKeypointInput {
  workspaceId: string;
  taskSessionId: string;
  taskTitle: string;
  milestone: "started" | "completed";
  summary: string;
  artifacts?: string[];
}

function serializeKeypoint(
  keypoint: Awaited<ReturnType<typeof dbListProjectKeypointsByWorkspace>>[number]
): ProjectKeypoint {
  return {
    id: keypoint.id,
    workspaceId: keypoint.workspaceId,
    taskSessionId: keypoint.taskSessionId,
    taskTitle: keypoint.taskTitle,
    milestone: keypoint.milestone,
    completedAt: keypoint.completedAt,
    summary: keypoint.summary,
    artifacts: keypoint.artifacts,
    createdAt: keypoint.createdAt,
  };
}

export async function listProjectKeypoints(workspaceId: string): Promise<ProjectKeypoint[]> {
  const keypoints = await dbListProjectKeypointsByWorkspace(workspaceId);
  return keypoints.map(serializeKeypoint);
}

export async function createProjectKeypoint(
  input: CreateProjectKeypointInput
): Promise<ProjectKeypoint> {
  const keypoint = await dbCreateProjectKeypoint({
    workspaceId: input.workspaceId,
    taskSessionId: input.taskSessionId,
    taskTitle: input.taskTitle,
    milestone: input.milestone,
    summary: input.summary,
    artifacts: input.artifacts,
  });

  return serializeKeypoint(keypoint);
}

export async function deleteProjectKeypoint(id: string): Promise<void> {
  await dbDeleteProjectKeypoint(id);
}
