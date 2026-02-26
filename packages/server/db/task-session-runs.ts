import { and, asc, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import { db, taskSessionRuns } from "./index";

export type TaskRunRuntimeMode = "intake" | "plan" | "build";
export type TaskRunState =
  | "queued"
  | "running"
  | "cancel_requested"
  | "completed"
  | "failed"
  | "canceled"
  | "stale"
  | "dead";

export interface TaskSessionRunRecord {
  runId: string;
  taskSessionId: string;
  runtimeMode: TaskRunRuntimeMode;
  state: TaskRunState;
  clientRequestKey: string | null;
  input: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  attempt: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  lastHeartbeatAt: Date | null;
  cancelRequestedAt: Date | null;
  canceledAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface CreateTaskSessionRunInput {
  taskSessionId: string;
  runtimeMode: TaskRunRuntimeMode;
  clientRequestKey?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  maxAttempts?: number;
}

function toRecord(row: typeof taskSessionRuns.$inferSelect): TaskSessionRunRecord {
  return {
    runId: row.run_id,
    taskSessionId: row.task_session_id,
    runtimeMode: row.runtime_mode as TaskRunRuntimeMode,
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

export async function getTaskSessionRunById(runId: string): Promise<TaskSessionRunRecord | null> {
  const row = await db
    .select()
    .from(taskSessionRuns)
    .where(eq(taskSessionRuns.run_id, runId))
    .get();
  return row ? toRecord(row) : null;
}

export async function listTaskSessionRuns(taskSessionId: string): Promise<TaskSessionRunRecord[]> {
  const rows = await db
    .select()
    .from(taskSessionRuns)
    .where(eq(taskSessionRuns.task_session_id, taskSessionId))
    .orderBy(desc(taskSessionRuns.created_at));

  return rows.map(toRecord);
}

export async function findTaskSessionRunByClientRequestKey(
  taskSessionId: string,
  clientRequestKey: string
): Promise<TaskSessionRunRecord | null> {
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

export async function createTaskSessionRun(
  input: CreateTaskSessionRunInput
): Promise<TaskSessionRunRecord> {
  const now = new Date();

  if (input.clientRequestKey) {
    const existing = await db
      .select()
      .from(taskSessionRuns)
      .where(
        and(
          eq(taskSessionRuns.task_session_id, input.taskSessionId),
          eq(taskSessionRuns.client_request_key, input.clientRequestKey)
        )
      )
      .get();
    if (existing) {
      return toRecord(existing);
    }
  }

  const runId = uuidv7();
  await db.insert(taskSessionRuns).values({
    run_id: runId,
    task_session_id: input.taskSessionId,
    runtime_mode: input.runtimeMode,
    state: "queued",
    client_request_key: input.clientRequestKey ?? null,
    input: input.input ?? null,
    metadata: input.metadata ?? null,
    created_at: now,
    updated_at: now,
    queued_at: now,
    max_attempts: input.maxAttempts ?? 3,
  });

  const created = await getTaskSessionRunById(runId);
  if (!created) {
    throw new Error("Failed to create task session run");
  }
  return created;
}

export async function claimNextTaskSessionRun(input: {
  workerId: string;
  leaseMs: number;
}): Promise<TaskSessionRunRecord | null> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);

  return db.transaction(async tx => {
    const candidate = await tx
      .select()
      .from(taskSessionRuns)
      .where(
        or(
          eq(taskSessionRuns.state, "queued"),
          and(
            eq(taskSessionRuns.state, "stale"),
            or(isNull(taskSessionRuns.lease_expires_at), lt(taskSessionRuns.lease_expires_at, now))!
          )
        )
      )
      .orderBy(asc(taskSessionRuns.created_at))
      .get();

    if (!candidate) {
      return null;
    }

    const updated = await tx
      .update(taskSessionRuns)
      .set({
        state: "running",
        started_at: candidate.started_at ?? now,
        updated_at: now,
        lease_owner: input.workerId,
        lease_expires_at: leaseExpiresAt,
        last_heartbeat_at: now,
      })
      .where(
        and(
          eq(taskSessionRuns.run_id, candidate.run_id),
          inArray(taskSessionRuns.state, ["queued", "stale"]) as any // eslint-disable-line @typescript-eslint/no-explicit-any
        )
      )
      .returning()
      .get();

    return updated ? toRecord(updated) : null;
  });
}

export async function heartbeatTaskSessionRun(input: {
  runId: string;
  workerId: string;
  leaseMs: number;
}): Promise<boolean> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);

  const updated = await db
    .update(taskSessionRuns)
    .set({
      updated_at: now,
      lease_expires_at: leaseExpiresAt,
      last_heartbeat_at: now,
    })
    .where(
      and(
        eq(taskSessionRuns.run_id, input.runId),
        eq(taskSessionRuns.state, "running"),
        eq(taskSessionRuns.lease_owner, input.workerId)
      )
    )
    .returning({ id: taskSessionRuns.run_id })
    .get();

  return Boolean(updated?.id);
}

export async function requestTaskSessionRunCancel(
  runId: string
): Promise<TaskSessionRunRecord | null> {
  const now = new Date();
  const existing = await getTaskSessionRunById(runId);
  if (!existing) {
    return null;
  }

  if (
    existing.state === "completed" ||
    existing.state === "failed" ||
    existing.state === "canceled" ||
    existing.state === "dead"
  ) {
    return existing;
  }

  if (existing.state === "cancel_requested") {
    return existing;
  }

  const nextState: TaskRunState = existing.state === "queued" ? "canceled" : "cancel_requested";
  const row = await db
    .update(taskSessionRuns)
    .set(
      nextState === "canceled"
        ? {
            state: "canceled",
            updated_at: now,
            canceled_at: now,
            finished_at: now,
            lease_owner: null,
            lease_expires_at: null,
          }
        : {
            state: "cancel_requested",
            cancel_requested_at: now,
            updated_at: now,
          }
    )
    .where(eq(taskSessionRuns.run_id, runId))
    .returning()
    .get();

  if (row) {
    return toRecord(row);
  }

  return existing;
}

export async function markTaskSessionRunCompleted(input: {
  runId: string;
  workerId: string;
}): Promise<boolean> {
  const now = new Date();

  const row = await db
    .update(taskSessionRuns)
    .set({
      state: "completed",
      finished_at: now,
      updated_at: now,
      lease_owner: null,
      lease_expires_at: null,
    })
    .where(
      and(
        eq(taskSessionRuns.run_id, input.runId),
        eq(taskSessionRuns.state, "running"),
        eq(taskSessionRuns.lease_owner, input.workerId)
      )
    )
    .returning({ id: taskSessionRuns.run_id })
    .get();

  return Boolean(row?.id);
}

export async function markTaskSessionRunCanceled(input: {
  runId: string;
  workerId: string;
}): Promise<boolean> {
  const now = new Date();
  const row = await db
    .update(taskSessionRuns)
    .set({
      state: "canceled",
      canceled_at: now,
      finished_at: now,
      updated_at: now,
      lease_owner: null,
      lease_expires_at: null,
    })
    .where(
      and(
        eq(taskSessionRuns.run_id, input.runId),
        inArray(taskSessionRuns.state, ["running", "cancel_requested"]) as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        eq(taskSessionRuns.lease_owner, input.workerId)
      )
    )
    .returning({ id: taskSessionRuns.run_id })
    .get();

  return Boolean(row?.id);
}

export async function markTaskSessionRunFailed(input: {
  runId: string;
  workerId: string;
  errorCode?: string;
  errorMessage?: string;
}): Promise<boolean> {
  const now = new Date();
  const row = await db
    .update(taskSessionRuns)
    .set({
      state: "failed",
      finished_at: now,
      updated_at: now,
      lease_owner: null,
      lease_expires_at: null,
      error_code: input.errorCode ?? null,
      error_message: input.errorMessage ?? null,
    })
    .where(
      and(
        eq(taskSessionRuns.run_id, input.runId),
        inArray(taskSessionRuns.state, ["running", "cancel_requested"]) as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        eq(taskSessionRuns.lease_owner, input.workerId)
      )
    )
    .returning({ id: taskSessionRuns.run_id })
    .get();

  return Boolean(row?.id);
}

export async function requeueExpiredRuns(now: Date = new Date()): Promise<number> {
  const staleRows = await db
    .update(taskSessionRuns)
    .set({
      state: "stale",
      updated_at: now,
    })
    .where(
      and(
        eq(taskSessionRuns.state, "running"),
        or(isNull(taskSessionRuns.lease_expires_at), lt(taskSessionRuns.lease_expires_at, now))!
      )
    )
    .returning({
      runId: taskSessionRuns.run_id,
      attempt: taskSessionRuns.attempt,
      maxAttempts: taskSessionRuns.max_attempts,
    });

  let requeued = 0;
  for (const row of staleRows) {
    const nextState: TaskRunState = row.attempt + 1 >= row.maxAttempts ? "dead" : "queued";
    await db
      .update(taskSessionRuns)
      .set({
        state: nextState,
        attempt: row.attempt + 1,
        updated_at: now,
        lease_owner: null,
        lease_expires_at: null,
      })
      .where(eq(taskSessionRuns.run_id, row.runId));
    if (nextState === "queued") {
      requeued += 1;
    }
  }

  return requeued;
}
