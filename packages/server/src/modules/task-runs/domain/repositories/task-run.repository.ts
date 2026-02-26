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

export interface TaskSessionRun {
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

export interface ITaskRunRepository {
  getById(runId: string): Promise<TaskSessionRun | null>;
  listByTaskSession(taskSessionId: string): Promise<TaskSessionRun[]>;
  findByClientRequestKey(
    taskSessionId: string,
    clientRequestKey: string
  ): Promise<TaskSessionRun | null>;
  create(input: CreateTaskSessionRunInput): Promise<TaskSessionRun>;
  requestCancel(runId: string): Promise<TaskSessionRun | null>;
  updateState(
    runId: string,
    state: TaskRunState,
    additionalFields?: Partial<TaskSessionRun>
  ): Promise<void>;
}

export const migrationCheckpoint = {
  task: "Create task-run repository port",
  status: "implemented-minimally",
} as const;
