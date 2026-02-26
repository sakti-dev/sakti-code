export interface TaskRunEvent {
  eventId: string;
  runId: string;
  taskSessionId: string;
  eventSeq: number;
  eventType: string;
  dedupeKey: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface AppendTaskRunEventInput {
  runId: string;
  taskSessionId: string;
  eventType: string;
  payload: Record<string, unknown>;
  dedupeKey?: string;
  eventId?: string;
}

export interface ITaskRunEventRepository {
  append(input: AppendTaskRunEventInput): Promise<TaskRunEvent>;
  listByRunId(runId: string): Promise<TaskRunEvent[]>;
  getLatestByRunId(runId: string): Promise<TaskRunEvent | null>;
  listAfter(runId: string, afterEventSeq: number, limit: number): Promise<TaskRunEvent[]>;
}

export const migrationCheckpoint = {
  task: "Create task-run events repository",
  status: "implemented-minimally",
} as const;
