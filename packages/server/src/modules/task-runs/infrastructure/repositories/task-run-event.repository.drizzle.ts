import { and, asc, desc, eq, gt, max } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db, taskRunEvents } from "../../../../../db/index.js";
import type {
  AppendTaskRunEventInput,
  ITaskRunEventRepository,
  TaskRunEvent,
} from "../../domain/repositories/task-run-event.repository.js";

function toRecord(row: typeof taskRunEvents.$inferSelect): TaskRunEvent {
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

export class DrizzleTaskRunEventRepository implements ITaskRunEventRepository {
  async append(input: AppendTaskRunEventInput): Promise<TaskRunEvent> {
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

  async listByRunId(runId: string): Promise<TaskRunEvent[]> {
    const rows = await db
      .select()
      .from(taskRunEvents)
      .where(eq(taskRunEvents.run_id, runId))
      .orderBy(asc(taskRunEvents.event_seq));
    return rows.map(toRecord);
  }

  async getLatestByRunId(runId: string): Promise<TaskRunEvent | null> {
    const row = await db
      .select()
      .from(taskRunEvents)
      .where(eq(taskRunEvents.run_id, runId))
      .orderBy(desc(taskRunEvents.event_seq))
      .limit(1)
      .get();
    return row ? toRecord(row) : null;
  }

  async listAfter(runId: string, afterEventSeq: number, limit: number): Promise<TaskRunEvent[]> {
    const safeLimit = Math.max(1, Math.min(limit, 1000));
    const rows = await db
      .select()
      .from(taskRunEvents)
      .where(and(eq(taskRunEvents.run_id, runId), gt(taskRunEvents.event_seq, afterEventSeq)))
      .orderBy(asc(taskRunEvents.event_seq))
      .limit(safeLimit);
    return rows.map(toRecord);
  }
}

export const taskRunEventRepository = new DrizzleTaskRunEventRepository();

export const migrationCheckpoint = {
  task: "Create task-run events repository",
  status: "implemented-minimally",
} as const;
