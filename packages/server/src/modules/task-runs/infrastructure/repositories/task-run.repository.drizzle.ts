import { and, desc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db, taskSessionRuns } from "../../../../../db/index.js";
import type {
  CreateTaskSessionRunInput,
  ITaskRunRepository,
  TaskRunState,
  TaskSessionRun,
} from "../../domain/repositories/task-run.repository.js";

function toRecord(row: typeof taskSessionRuns.$inferSelect): TaskSessionRun {
  return {
    runId: row.run_id,
    taskSessionId: row.task_session_id,
    runtimeMode: row.runtime_mode as TaskSessionRun["runtimeMode"],
    state: row.state as TaskRunState,
    clientRequestKey: row.client_request_key,
    input: row.input ?? null,
    metadata: row.metadata ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    cancelRequestedAt: row.cancel_requested_at,
    canceledAt: row.canceled_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };
}

export class DrizzleTaskRunRepository implements ITaskRunRepository {
  async getById(runId: string): Promise<TaskSessionRun | null> {
    const row = await db
      .select()
      .from(taskSessionRuns)
      .where(eq(taskSessionRuns.run_id, runId))
      .get();
    return row ? toRecord(row) : null;
  }

  async listByTaskSession(taskSessionId: string): Promise<TaskSessionRun[]> {
    const rows = await db
      .select()
      .from(taskSessionRuns)
      .where(eq(taskSessionRuns.task_session_id, taskSessionId))
      .orderBy(desc(taskSessionRuns.created_at));
    return rows.map(toRecord);
  }

  async findByClientRequestKey(
    taskSessionId: string,
    clientRequestKey: string
  ): Promise<TaskSessionRun | null> {
    const row = await db
      .select()
      .from(taskSessionRuns)
      .where(
        and(
          eq(taskSessionRuns.task_session_id, taskSessionId),
          eq(taskSessionRuns.client_request_key, clientRequestKey)
        )
      )
      .get();
    return row ? toRecord(row) : null;
  }

  async create(input: CreateTaskSessionRunInput): Promise<TaskSessionRun> {
    const runId = uuidv7();
    const now = new Date();

    const row = {
      run_id: runId,
      task_session_id: input.taskSessionId,
      runtime_mode: input.runtimeMode,
      state: "queued" as TaskRunState,
      client_request_key: input.clientRequestKey ?? null,
      input: input.input ?? null,
      metadata: input.metadata ?? null,
      created_at: now,
      updated_at: now,
      queued_at: now,
      started_at: null,
      finished_at: null,
      attempt: 1,
      max_attempts: input.maxAttempts ?? 3,
      lease_owner: null,
      lease_expires_at: null,
      last_heartbeat_at: null,
      cancel_requested_at: null,
      canceled_at: null,
      error_code: null,
      error_message: null,
    };

    await db.insert(taskSessionRuns).values(row);
    return toRecord(row);
  }

  async requestCancel(runId: string): Promise<TaskSessionRun | null> {
    const existing = await this.getById(runId);
    if (!existing) return null;

    const now = new Date();
    const newState: TaskRunState = existing.state === "running" ? "cancel_requested" : "canceled";

    await db
      .update(taskSessionRuns)
      .set({
        state: newState,
        cancel_requested_at: now,
        canceled_at: newState === "canceled" ? now : null,
        updated_at: now,
      })
      .where(eq(taskSessionRuns.run_id, runId));

    return this.getById(runId);
  }

  async updateState(
    runId: string,
    state: TaskRunState,
    additionalFields?: Partial<TaskSessionRun>
  ): Promise<void> {
    const updates: Record<string, unknown> = {
      state,
      updated_at: new Date(),
    };

    if (additionalFields) {
      if (additionalFields.startedAt !== undefined) updates.started_at = additionalFields.startedAt;
      if (additionalFields.finishedAt !== undefined)
        updates.finished_at = additionalFields.finishedAt;
      if (additionalFields.errorCode !== undefined) updates.error_code = additionalFields.errorCode;
      if (additionalFields.errorMessage !== undefined)
        updates.error_message = additionalFields.errorMessage;
      if (additionalFields.attempt !== undefined) updates.attempt = additionalFields.attempt;
    }

    await db.update(taskSessionRuns).set(updates).where(eq(taskSessionRuns.run_id, runId));
  }
}

export const taskRunRepository = new DrizzleTaskRunRepository();

export const migrationCheckpoint = {
  task: "Create task-run drizzle repository",
  status: "implemented-minimally",
} as const;
