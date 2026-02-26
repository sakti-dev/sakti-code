import { and, asc, desc, eq, gt, max } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import { db, taskRunEvents } from "./index";

export interface TaskRunEventRecord {
  eventId: string;
  runId: string;
  taskSessionId: string;
  eventSeq: number;
  eventType: string;
  dedupeKey: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}

function toRecord(row: typeof taskRunEvents.$inferSelect): TaskRunEventRecord {
  return {
    eventId: row.event_id,
    runId: row.run_id,
    taskSessionId: row.task_session_id,
    eventSeq: row.event_seq,
    eventType: row.event_type,
    dedupeKey: row.dedupe_key,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

export async function appendTaskRunEvent(input: {
  runId: string;
  taskSessionId: string;
  eventType: string;
  payload: Record<string, unknown>;
  dedupeKey?: string;
  eventId?: string;
}): Promise<TaskRunEventRecord> {
  if (input.dedupeKey) {
    const existing = await db
      .select()
      .from(taskRunEvents)
      .where(
        and(eq(taskRunEvents.run_id, input.runId), eq(taskRunEvents.dedupe_key, input.dedupeKey))
      )
      .get();
    if (existing) {
      return toRecord(existing);
    }
  }

  return db.transaction(async tx => {
    const last = await tx
      .select({ value: max(taskRunEvents.event_seq) })
      .from(taskRunEvents)
      .where(eq(taskRunEvents.run_id, input.runId))
      .get();
    const eventSeq = (last?.value ?? 0) + 1;
    const eventId = input.eventId ?? uuidv7();
    const now = new Date();

    await tx.insert(taskRunEvents).values({
      event_id: eventId,
      run_id: input.runId,
      task_session_id: input.taskSessionId,
      event_seq: eventSeq,
      event_type: input.eventType,
      dedupe_key: input.dedupeKey ?? null,
      payload: input.payload,
      created_at: now,
    });

    return {
      eventId,
      runId: input.runId,
      taskSessionId: input.taskSessionId,
      eventSeq,
      eventType: input.eventType,
      dedupeKey: input.dedupeKey ?? null,
      payload: input.payload,
      createdAt: now,
    };
  });
}

export async function listTaskRunEventsAfter(input: {
  runId: string;
  afterEventSeq?: number;
  limit?: number;
}): Promise<TaskRunEventRecord[]> {
  const after = input.afterEventSeq ?? 0;
  const limit = Math.max(1, Math.min(input.limit ?? 100, 1000));

  const rows = await db
    .select()
    .from(taskRunEvents)
    .where(and(eq(taskRunEvents.run_id, input.runId), gt(taskRunEvents.event_seq, after)))
    .orderBy(asc(taskRunEvents.event_seq))
    .limit(limit);

  return rows.map(toRecord);
}

export async function getLastTaskRunEventSeq(runId: string): Promise<number> {
  const row = await db
    .select({ seq: taskRunEvents.event_seq })
    .from(taskRunEvents)
    .where(eq(taskRunEvents.run_id, runId))
    .orderBy(desc(taskRunEvents.event_seq))
    .limit(1)
    .get();

  return row?.seq ?? 0;
}
