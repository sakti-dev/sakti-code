/**
 * Project Keypoints CRUD operations
 *
 * Provides storage for project milestones with deduplication semantics.
 * Latest keypoint per (task_session_id, milestone) wins.
 */

import { and, desc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db, projectKeypoints } from "./index";

export type ProjectKeypointMilestone = "started" | "completed";

export interface CreateProjectKeypointInput {
  workspaceId: string;
  taskSessionId: string;
  taskTitle: string;
  milestone: ProjectKeypointMilestone;
  summary: string;
  artifacts?: string[];
}

export interface ProjectKeypointRecord {
  id: string;
  workspaceId: string;
  taskSessionId: string;
  taskTitle: string;
  milestone: ProjectKeypointMilestone;
  completedAt: Date;
  summary: string;
  artifacts: string[];
  createdAt: Date;
}

/**
 * Create a new project keypoint
 * If a keypoint with the same (taskSessionId, milestone) exists, it will be replaced (latest wins).
 */
export async function createProjectKeypoint(
  input: CreateProjectKeypointInput
): Promise<ProjectKeypointRecord> {
  const now = new Date();
  const keypointId = uuidv7();

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await db.transaction(async tx => {
        await tx
          .delete(projectKeypoints)
          .where(
            and(
              eq(projectKeypoints.task_session_id, input.taskSessionId),
              eq(projectKeypoints.milestone, input.milestone)
            )
          );

        await tx.insert(projectKeypoints).values({
          id: keypointId,
          workspace_id: input.workspaceId,
          task_session_id: input.taskSessionId,
          task_title: input.taskTitle,
          milestone: input.milestone,
          completed_at: now,
          summary: input.summary,
          artifacts: input.artifacts ?? [],
          created_at: now,
        });
      });
      break;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      const isBusy = code === "SQLITE_BUSY";
      if (!isBusy || attempt === maxAttempts) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 10 * attempt));
    }
  }

  return {
    id: keypointId,
    workspaceId: input.workspaceId,
    taskSessionId: input.taskSessionId,
    taskTitle: input.taskTitle,
    milestone: input.milestone,
    completedAt: now,
    summary: input.summary,
    artifacts: input.artifacts ?? [],
    createdAt: now,
  };
}

/**
 * List project keypoints for a workspace
 */
export async function listProjectKeypointsByWorkspace(
  workspaceId: string
): Promise<ProjectKeypointRecord[]> {
  const results = await db
    .select()
    .from(projectKeypoints)
    .where(eq(projectKeypoints.workspace_id, workspaceId))
    .orderBy(desc(projectKeypoints.completed_at));

  return results.map(row => ({
    id: row.id,
    workspaceId: row.workspace_id,
    taskSessionId: row.task_session_id,
    taskTitle: row.task_title,
    milestone: row.milestone as ProjectKeypointMilestone,
    completedAt: row.completed_at,
    summary: row.summary,
    artifacts: row.artifacts,
    createdAt: row.created_at,
  }));
}

/**
 * Get a project keypoint by ID
 */
export async function getProjectKeypoint(
  id: string
): Promise<ProjectKeypointRecord | null> {
  const result = await db
    .select()
    .from(projectKeypoints)
    .where(eq(projectKeypoints.id, id))
    .get();

  if (!result) {
    return null;
  }

  return {
    id: result.id,
    workspaceId: result.workspace_id,
    taskSessionId: result.task_session_id,
    taskTitle: result.task_title,
    milestone: result.milestone as ProjectKeypointMilestone,
    completedAt: result.completed_at,
    summary: result.summary,
    artifacts: result.artifacts,
    createdAt: result.created_at,
  };
}

/**
 * Delete a project keypoint
 */
export async function deleteProjectKeypoint(id: string): Promise<void> {
  await db.delete(projectKeypoints).where(eq(projectKeypoints.id, id));
}
