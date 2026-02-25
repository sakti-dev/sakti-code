/**
 * Task Session CRUD operations
 *
 * Provides task-session storage with UUIDv7 identifiers.
 * Task sessions are created server-side and persisted to the database.
 */

import { and, desc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db, taskSessions, threads, toolSessions } from "./index";

export const DEFAULT_SESSION_TITLE = "New Chat";

type TitleSource = "auto" | "manual";

interface ThreadTitleMetadata {
  titleSource?: TitleSource;
  provisionalTitle?: boolean;
}

export type TaskSessionStatus =
  | "researching"
  | "specifying"
  | "implementing"
  | "completed"
  | "failed";

export interface TaskSessionRecord {
  taskSessionId: string;
  resourceId: string;
  threadId: string;
  workspaceId: string | null;
  title: string | null;
  status: TaskSessionStatus;
  specType: "comprehensive" | "quick" | null;
  sessionKind: "intake" | "task";
  runtimeMode: "intake" | "plan" | "build" | null;
  createdAt: Date;
  lastAccessed: Date;
  lastActivityAt: Date;
}

const SPEC_TOOL_NAME = "spec";
const SESSION_MODE_KEY = "runtimeMode";

async function getRuntimeMode(
  sessionId: string
): Promise<"intake" | "plan" | "build" | null> {
  const result = await db
    .select()
    .from(toolSessions)
    .where(
      and(
        eq(toolSessions.session_id, sessionId),
        eq(toolSessions.tool_name, SPEC_TOOL_NAME),
        eq(toolSessions.tool_key, SESSION_MODE_KEY)
      )
    )
    .get();

  if (!result || !result.data || typeof result.data !== "object") {
    return null;
  }
  const mode = (result.data as { mode?: unknown }).mode;
  return mode === "intake" || mode === "plan" || mode === "build" ? mode : null;
}

function getThreadMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return {};
}

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

/**
 * Create a new task session with a UUIDv7 identifier
 */
export async function createTaskSession(
  resourceId: string,
  workspaceId?: string,
  sessionKind: "intake" | "task" = "task"
): Promise<TaskSessionRecord> {
  const sessionId = uuidv7();
  const now = new Date();

  const session = {
    session_id: sessionId,
    resource_id: resourceId,
    thread_id: sessionId,
    workspace_id: workspaceId ?? null,
    title: DEFAULT_SESSION_TITLE,
    created_at: now,
    last_accessed: now,
    last_activity_at: now,
    status: "researching" as TaskSessionStatus,
    session_kind: sessionKind,
    spec_type: null,
  };

  await db.insert(taskSessions).values(session);
  await ensureThreadRecord(session.thread_id, resourceId, DEFAULT_SESSION_TITLE);

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

/**
 * Create a new task session with a provided session ID
 */
export async function createTaskSessionWithId(
  resourceId: string,
  sessionId: string,
  workspaceId?: string,
  sessionKind: "intake" | "task" = "task"
): Promise<TaskSessionRecord> {
  const now = new Date();

  const session = {
    session_id: sessionId,
    resource_id: resourceId,
    thread_id: sessionId,
    workspace_id: workspaceId ?? null,
    title: DEFAULT_SESSION_TITLE,
    created_at: now,
    last_accessed: now,
    last_activity_at: now,
    status: "researching" as TaskSessionStatus,
    session_kind: sessionKind,
    spec_type: null,
  };

  await db.insert(taskSessions).values(session);
  await ensureThreadRecord(session.thread_id, resourceId, DEFAULT_SESSION_TITLE);

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

/**
 * Get a task session by ID
 */
export async function getTaskSession(sessionId: string): Promise<TaskSessionRecord | null> {
  const result = await db
    .select()
    .from(taskSessions)
    .where(eq(taskSessions.session_id, sessionId))
    .get();

  if (!result) {
    return null;
  }

  await ensureThreadRecord(
    result.thread_id,
    result.resource_id,
    result.title ?? DEFAULT_SESSION_TITLE
  );

  const runtimeMode = await getRuntimeMode(result.session_id);

  return {
    taskSessionId: result.session_id,
    resourceId: result.resource_id,
    threadId: result.thread_id,
    workspaceId: result.workspace_id,
    title: result.title,
    createdAt: result.created_at,
    lastAccessed: result.last_accessed,
    lastActivityAt: result.last_activity_at,
    status: result.status as TaskSessionStatus,
    specType: result.spec_type as "comprehensive" | "quick" | null,
    sessionKind: result.session_kind as "intake" | "task",
    runtimeMode,
  };
}

/**
 * List task sessions with optional filters
 */
export async function listTaskSessions(options?: {
  kind?: "intake" | "task";
  workspaceId?: string;
}): Promise<TaskSessionRecord[]> {
  const conditions = [];
  if (options?.kind) {
    conditions.push(eq(taskSessions.session_kind, options.kind));
  }
  if (options?.workspaceId) {
    conditions.push(eq(taskSessions.workspace_id, options.workspaceId));
  }

  const results = await (conditions.length > 0
    ? db
        .select()
        .from(taskSessions)
        .where(and(...conditions))
        .orderBy(desc(taskSessions.last_activity_at))
        .all()
    : db
        .select()
        .from(taskSessions)
        .orderBy(desc(taskSessions.last_activity_at))
        .all()
  );

  return Promise.all(
    results.map(async row => ({
      taskSessionId: row.session_id,
      resourceId: row.resource_id,
      threadId: row.thread_id,
      workspaceId: row.workspace_id,
      title: row.title,
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
      lastActivityAt: row.last_activity_at,
      status: row.status as TaskSessionStatus,
      specType: row.spec_type as "comprehensive" | "quick" | null,
      sessionKind: row.session_kind as "intake" | "task",
      runtimeMode: await getRuntimeMode(row.session_id),
    }))
  );
}

/**
 * Get most recent task session for a workspace
 */
export async function getLatestTaskSessionByWorkspace(
  workspaceId: string,
  kind: "intake" | "task" = "task"
): Promise<TaskSessionRecord | null> {
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

  const result = results[0];
  const runtimeMode = await getRuntimeMode(result.session_id);
  return {
    taskSessionId: result.session_id,
    resourceId: result.resource_id,
    threadId: result.thread_id,
    workspaceId: result.workspace_id,
    title: result.title,
    createdAt: result.created_at,
    lastAccessed: result.last_accessed,
    lastActivityAt: result.last_activity_at,
    status: result.status as TaskSessionStatus,
    specType: result.spec_type as "comprehensive" | "quick" | null,
    sessionKind: result.session_kind as "intake" | "task",
    runtimeMode,
  };
}

/**
 * Update task session fields
 */
export async function updateTaskSession(
  sessionId: string,
  updates: Partial<{
    status: TaskSessionStatus;
    specType: "comprehensive" | "quick" | null;
    title: string;
  }>
): Promise<void> {
  const values: Record<string, unknown> = {};
  if (updates.status !== undefined) values.status = updates.status;
  if (updates.specType !== undefined) values.spec_type = updates.specType;
  if (updates.title !== undefined) values.title = updates.title;
  values.last_activity_at = new Date();

  await db.update(taskSessions).set(values).where(eq(taskSessions.session_id, sessionId));
}

/**
 * Update the last_accessed and last_activity_at timestamps for a task session
 */
export async function touchTaskSession(sessionId: string): Promise<void> {
  const now = new Date();
  await db
    .update(taskSessions)
    .set({ last_accessed: now, last_activity_at: now })
    .where(eq(taskSessions.session_id, sessionId));
}

/**
 * Update task session title
 */
export async function updateTaskSessionTitle(
  sessionId: string,
  title: string,
  options: {
    source?: TitleSource;
    onlyIfProvisional?: boolean;
  } = {}
): Promise<boolean> {
  function normalizeTitle(raw: string): string | null {
    const compact = raw.replace(/\s+/g, " ").trim();
    if (!compact) return null;
    const max = 80;
    return compact.length > max ? compact.slice(0, max).trimEnd() : compact;
  }

  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) return false;

  const session = await db
    .select()
    .from(taskSessions)
    .where(eq(taskSessions.session_id, sessionId))
    .get();
  if (!session) return false;

  const thread = await db.select().from(threads).where(eq(threads.id, session.thread_id)).get();
  const metadata = getThreadMetadata(thread?.metadata);
  const titleMeta = metadata as ThreadTitleMetadata;
  const inferredProvisional =
    typeof thread?.title === "string" ? thread.title === DEFAULT_SESSION_TITLE : true;
  const isProvisional = titleMeta.provisionalTitle ?? inferredProvisional;
  const existingSource = titleMeta.titleSource ?? "auto";

  if (options.onlyIfProvisional && (!isProvisional || existingSource === "manual")) {
    return false;
  }

  const source: TitleSource = options.source ?? "auto";
  await db
    .update(taskSessions)
    .set({ title: normalizedTitle })
    .where(eq(taskSessions.session_id, sessionId));

  if (thread) {
    await db
      .update(threads)
      .set({
        title: normalizedTitle,
        metadata: {
          ...metadata,
          titleSource: source,
          provisionalTitle: false,
        },
        updated_at: new Date(),
      })
      .where(eq(threads.id, session.thread_id));
  } else {
    await ensureThreadRecord(session.thread_id, session.resource_id, normalizedTitle);
    await db
      .update(threads)
      .set({
        metadata: {
          titleSource: source,
          provisionalTitle: false,
        },
        updated_at: new Date(),
      })
      .where(eq(threads.id, session.thread_id));
  }

  return true;
}

/**
 * Update task session status with validation
 */
export async function updateTaskSessionStatus(
  sessionId: string,
  status: TaskSessionStatus
): Promise<void> {
  const validStatuses: TaskSessionStatus[] = [
    "researching",
    "specifying",
    "implementing",
    "completed",
    "failed",
  ];

  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid task session status: ${status}`);
  }

  await db
    .update(taskSessions)
    .set({ status, last_activity_at: new Date() })
    .where(eq(taskSessions.session_id, sessionId));
}

/**
 * Delete a task session
 */
export async function deleteTaskSession(sessionId: string): Promise<void> {
  await db.delete(taskSessions).where(eq(taskSessions.session_id, sessionId));
}
