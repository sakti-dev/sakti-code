import type {
  TaskSession,
  TaskSessionKind,
  TaskSessionStatus,
  TaskSpecType,
} from "../../domain/repositories/task-session.repository.js";
import { taskSessionRepository } from "../../infrastructure/repositories/task-session.repository.drizzle.js";

export interface UpdateTaskSessionInput {
  status?: TaskSessionStatus;
  specType?: TaskSpecType;
  title?: string;
}

export interface UpdateTaskSessionOutput {
  taskSession: TaskSession;
}

export async function updateTaskSessionUsecase(
  taskSessionId: string,
  input: UpdateTaskSessionInput
): Promise<UpdateTaskSessionOutput> {
  await taskSessionRepository.update(taskSessionId, input);

  const taskSession = await taskSessionRepository.getById(taskSessionId);
  if (!taskSession) {
    throw new Error("Task session not found");
  }

  return { taskSession };
}

export async function getTaskSessionUsecase(taskSessionId: string): Promise<TaskSession | null> {
  return taskSessionRepository.getById(taskSessionId);
}

export async function deleteTaskSessionUsecase(taskSessionId: string): Promise<void> {
  return taskSessionRepository.delete(taskSessionId);
}

export async function getLatestTaskSessionByWorkspaceUsecase(
  workspaceId: string,
  kind: TaskSessionKind
): Promise<TaskSession | null> {
  return taskSessionRepository.getLatestByWorkspace(workspaceId, kind);
}

export const migrationCheckpoint = {
  task: "Create patch task-session usecase",
  status: "implemented-minimally",
} as const;
