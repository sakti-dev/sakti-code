import { and, desc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db, taskSessions, threads } from "../../../../../db/index.js";
import type {
  CreateTaskSessionInput,
  ITaskSessionRepository,
  ListTaskSessionOptions,
  TaskSession,
  UpdateTaskSessionInput,
} from "../../domain/repositories/task-session.repository.js";

const DEFAULT_SESSION_TITLE = "New Chat";

async function ensureThreadRecord(
  threadId: string,
  resourceId: string,
  title: string = DEFAULT_SESSION_TITLE
): Promise<void> {
  const now = new Date();
  await db
    .insert(threads)
    .values({
      id: threadId,
      resource_id: resourceId,
      title,
      metadata: {
        titleSource: "auto",
        provisionalTitle: true,
      },
      created_at: now,
      updated_at: now,
    })
    .onConflictDoNothing();
}

function mapRowToTaskSession(row: typeof taskSessions.$inferSelect): TaskSession {
  return {
    taskSessionId: row.session_id,
    resourceId: row.resource_id,
    threadId: row.thread_id,
    workspaceId: row.workspace_id,
    title: row.title,
    status: row.status as TaskSession["status"],
    specType: row.spec_type as TaskSession["specType"],
    sessionKind: row.session_kind as TaskSession["sessionKind"],
    runtimeMode: null,
    createdAt: row.created_at,
    lastAccessed: row.last_accessed,
    lastActivityAt: row.last_activity_at,
  };
}

export class DrizzleTaskSessionRepository implements ITaskSessionRepository {
  async create(input: CreateTaskSessionInput): Promise<TaskSession> {
    const sessionId = uuidv7();
    const now = new Date();

    const session = {
      session_id: sessionId,
      resource_id: input.resourceId,
      thread_id: sessionId,
      workspace_id: input.workspaceId ?? null,
      title: DEFAULT_SESSION_TITLE,
      created_at: now,
      last_accessed: now,
      last_activity_at: now,
      status: "researching" as const,
      session_kind: input.sessionKind ?? "task",
      spec_type: null,
    };

    await db.insert(taskSessions).values(session);
    await ensureThreadRecord(session.thread_id, input.resourceId, DEFAULT_SESSION_TITLE);

    return {
      taskSessionId: session.session_id,
      resourceId: session.resource_id,
      threadId: session.thread_id,
      workspaceId: session.workspace_id,
      title: session.title,
      createdAt: session.created_at,
      lastAccessed: session.last_accessed,
      lastActivityAt: session.last_activity_at,
      status: session.status,
      specType: session.spec_type,
      sessionKind: session.session_kind,
      runtimeMode: null,
    };
  }

  async getById(id: string): Promise<TaskSession | null> {
    const result = await db
      .select()
      .from(taskSessions)
      .where(eq(taskSessions.session_id, id))
      .get();

    if (!result) {
      return null;
    }

    return mapRowToTaskSession(result);
  }

  async list(options?: ListTaskSessionOptions): Promise<TaskSession[]> {
    const conditions = [];
    if (options?.kind) {
      conditions.push(eq(taskSessions.session_kind, options.kind));
    }
    if (options?.workspaceId) {
      conditions.push(eq(taskSessions.workspace_id, options.workspaceId));
    }

    const results =
      conditions.length > 0
        ? await db
            .select()
            .from(taskSessions)
            .where(and(...conditions))
            .orderBy(desc(taskSessions.last_activity_at))
            .all()
        : await db.select().from(taskSessions).orderBy(desc(taskSessions.last_activity_at)).all();

    return results.map(mapRowToTaskSession);
  }

  async getLatestByWorkspace(
    workspaceId: string,
    kind: TaskSession["sessionKind"]
  ): Promise<TaskSession | null> {
    const results = await db
      .select()
      .from(taskSessions)
      .where(and(eq(taskSessions.workspace_id, workspaceId), eq(taskSessions.session_kind, kind)))
      .orderBy(desc(taskSessions.last_activity_at))
      .limit(1)
      .all();

    if (results.length === 0) {
      return null;
    }

    return mapRowToTaskSession(results[0]);
  }

  async update(id: string, input: UpdateTaskSessionInput): Promise<void> {
    const values: Record<string, unknown> = {};
    if (input.status !== undefined) values.status = input.status;
    if (input.specType !== undefined) values.spec_type = input.specType;
    if (input.title !== undefined) values.title = input.title;
    values.last_activity_at = new Date();

    await db.update(taskSessions).set(values).where(eq(taskSessions.session_id, id));
  }

  async delete(id: string): Promise<void> {
    await db.delete(taskSessions).where(eq(taskSessions.session_id, id));
  }
}

export const taskSessionRepository = new DrizzleTaskSessionRepository();
