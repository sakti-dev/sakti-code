import type {
  TaskSession,
  TaskSessionKind,
} from "../../domain/repositories/task-session.repository.js";
import { taskSessionRepository } from "../../infrastructure/repositories/task-session.repository.drizzle.js";

export interface ListTaskSessionsInput {
  workspaceId?: string;
  kind?: TaskSessionKind;
}

export interface ListTaskSessionsOutput {
  taskSessions: TaskSession[];
}

export async function listTaskSessionsUsecase(
  input: ListTaskSessionsInput
): Promise<ListTaskSessionsOutput> {
  const sessions = await taskSessionRepository.list({
    workspaceId: input.workspaceId,
    kind: input.kind,
  });

  return { taskSessions: sessions };
}

export async function getLatestTaskSessionByWorkspaceUsecase(
  workspaceId: string,
  kind: TaskSessionKind
): Promise<TaskSession | null> {
  return taskSessionRepository.getLatestByWorkspace(workspaceId, kind);
}

export const migrationCheckpoint = {
  task: "Create list task-sessions usecase",
  status: "implemented-minimally",
} as const;
