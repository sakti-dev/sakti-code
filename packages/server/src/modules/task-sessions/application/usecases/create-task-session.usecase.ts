import type {
  TaskSession,
  TaskSessionKind,
} from "../../domain/repositories/task-session.repository.js";
import { taskSessionRepository } from "../../infrastructure/repositories/task-session.repository.drizzle.js";

export interface CreateTaskSessionInput {
  resourceId: string;
  workspaceId?: string;
  sessionKind?: TaskSessionKind;
}

export interface CreateTaskSessionOutput {
  taskSession: TaskSession;
}

export async function createTaskSessionUsecase(
  input: CreateTaskSessionInput
): Promise<CreateTaskSessionOutput> {
  const taskSession = await taskSessionRepository.create({
    resourceId: input.resourceId,
    workspaceId: input.workspaceId,
    sessionKind: input.sessionKind ?? "task",
  });

  return { taskSession };
}
