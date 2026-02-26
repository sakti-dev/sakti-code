import type {
  TaskRunRuntimeMode,
  TaskSessionRun,
} from "../../domain/repositories/task-run.repository.js";
import { taskRunEventRepository } from "../../infrastructure/repositories/task-run-event.repository.drizzle.js";
import { taskRunRepository } from "../../infrastructure/repositories/task-run.repository.drizzle.js";

export interface CreateTaskRunInput {
  taskSessionId: string;
  runtimeMode: TaskRunRuntimeMode;
  clientRequestKey?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  maxAttempts?: number;
}

export interface CreateTaskRunOutput {
  run: TaskSessionRun;
}

export async function createTaskRunUsecase(
  input: CreateTaskRunInput
): Promise<CreateTaskRunOutput> {
  const existingWithKey = input.clientRequestKey
    ? await taskRunRepository.findByClientRequestKey(input.taskSessionId, input.clientRequestKey)
    : null;

  if (existingWithKey) {
    return { run: existingWithKey };
  }

  const activeRuns = await taskRunRepository.listByTaskSession(input.taskSessionId);
  const hasActiveRun = activeRuns.some(
    run => run.state === "queued" || run.state === "running" || run.state === "cancel_requested"
  );

  if (hasActiveRun) {
    const activeRun = activeRuns.find(
      run => run.state === "queued" || run.state === "running" || run.state === "cancel_requested"
    );
    if (activeRun) {
      throw new Error("Active run already exists for task session");
    }
  }

  const run = await taskRunRepository.create({
    taskSessionId: input.taskSessionId,
    runtimeMode: input.runtimeMode,
    clientRequestKey: input.clientRequestKey,
    input: input.input,
    metadata: input.metadata,
    maxAttempts: input.maxAttempts,
  });

  await taskRunEventRepository.append({
    runId: run.runId,
    taskSessionId: run.taskSessionId,
    eventType: "task-run.updated",
    payload: {
      state: run.state,
      runtimeMode: run.runtimeMode,
    },
    dedupeKey: `queued:${run.runId}`,
  });

  return { run };
}
