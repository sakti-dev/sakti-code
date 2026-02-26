import type { TaskSessionRun } from "../../domain/repositories/task-run.repository.js";
import { taskRunEventRepository } from "../../infrastructure/repositories/task-run-event.repository.drizzle.js";
import { taskRunRepository } from "../../infrastructure/repositories/task-run.repository.drizzle.js";

export interface CancelTaskRunInput {
  runId: string;
}

export interface CancelTaskRunOutput {
  run: TaskSessionRun;
}

export async function cancelTaskRunUsecase(
  input: CancelTaskRunInput
): Promise<CancelTaskRunOutput> {
  const run = await taskRunRepository.requestCancel(input.runId);
  if (!run) {
    throw new Error("Run not found");
  }

  if (run.state === "cancel_requested") {
    await taskRunEventRepository.append({
      runId: run.runId,
      taskSessionId: run.taskSessionId,
      eventType: "task-run.updated",
      payload: { state: "cancel_requested" },
      dedupeKey: `cancel_requested:${run.runId}`,
    });
  } else if (run.state === "canceled") {
    await taskRunEventRepository.append({
      runId: run.runId,
      taskSessionId: run.taskSessionId,
      eventType: "run.canceled",
      payload: { reason: "cancel_requested" },
      dedupeKey: `canceled:${run.runId}`,
    });
  }

  return { run };
}

export async function getTaskRunByIdUsecase(runId: string): Promise<TaskSessionRun | null> {
  return taskRunRepository.getById(runId);
}

export async function listTaskRunsBySessionUsecase(
  taskSessionId: string
): Promise<TaskSessionRun[]> {
  return taskRunRepository.listByTaskSession(taskSessionId);
}

export const migrationCheckpoint = {
  task: "Create cancel task-run usecase",
  status: "implemented-minimally",
} as const;
