export type TaskSessionStatus =
  | "researching"
  | "specifying"
  | "implementing"
  | "completed"
  | "failed";

export type TaskSessionKind = "intake" | "task";

export type TaskSpecType = "comprehensive" | "quick" | null;

export type RuntimeMode = "intake" | "plan" | "build" | null;

export interface TaskSession {
  taskSessionId: string;
  resourceId: string;
  threadId: string;
  workspaceId: string | null;
  title: string | null;
  status: TaskSessionStatus;
  specType: TaskSpecType;
  sessionKind: TaskSessionKind;
  runtimeMode: RuntimeMode;
  createdAt: Date;
  lastAccessed: Date;
  lastActivityAt: Date;
}

export interface CreateTaskSessionInput {
  resourceId: string;
  workspaceId?: string;
  sessionKind?: TaskSessionKind;
}

export interface UpdateTaskSessionInput {
  status?: TaskSessionStatus;
  specType?: TaskSpecType;
  title?: string;
}

export interface ListTaskSessionOptions {
  kind?: TaskSessionKind;
  workspaceId?: string;
}

export interface ITaskSessionRepository {
  create(input: CreateTaskSessionInput): Promise<TaskSession>;
  getById(id: string): Promise<TaskSession | null>;
  list(options?: ListTaskSessionOptions): Promise<TaskSession[]>;
  getLatestByWorkspace(workspaceId: string, kind: TaskSessionKind): Promise<TaskSession | null>;
  update(id: string, input: UpdateTaskSessionInput): Promise<void>;
  delete(id: string): Promise<void>;
}

export const migrationCheckpoint = {
  task: "Create task-session repository port",
  status: "implemented-minimally",
} as const;
