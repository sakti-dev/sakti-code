/**
 * Session CRUD operations
 *
 * Provides session storage with UUIDv7 identifiers.
 * Sessions are created server-side and persisted to the database.
 */

import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db, sessions, threads } from "./index";

export const DEFAULT_SESSION_TITLE = "New Chat";

type TitleSource = "auto" | "manual";

interface ThreadTitleMetadata {
  titleSource?: TitleSource;
  provisionalTitle?: boolean;
}

/**
 * Session data structure
 */
export interface Session {
  sessionId: string; // UUIDv7
  resourceId: string; // userId or "local"
  threadId: string; // == sessionId
  title: string | null;
  createdAt: Date; // unix timestamp ms
  lastAccessed: Date; // unix timestamp ms
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
 * Create a new session with a UUIDv7 identifier
 *
 * @param resourceId - User ID or "local" for single-user desktop
 * @returns The created session
 */
export async function createSession(resourceId: string): Promise<Session> {
  const sessionId = uuidv7();
  const now = new Date();

  const session = {
    session_id: sessionId,
    resource_id: resourceId,
    thread_id: sessionId, // threadId == sessionId for memory integration
    title: DEFAULT_SESSION_TITLE,
    created_at: now,
    last_accessed: now,
  };

  await db.insert(sessions).values(session);
  await ensureThreadRecord(session.thread_id, resourceId, DEFAULT_SESSION_TITLE);

  return {
    sessionId: session.session_id,
    resourceId: session.resource_id,
    threadId: session.thread_id,
    title: session.title,
    createdAt: session.created_at,
    lastAccessed: session.last_accessed,
  };
}

/**
 * Create a new session with a provided session ID
 *
 * @param resourceId - User ID or "local" for single-user desktop
 * @param sessionId - Explicit session ID to use
 * @returns The created session
 */
export async function createSessionWithId(resourceId: string, sessionId: string): Promise<Session> {
  const now = new Date();

  const session = {
    session_id: sessionId,
    resource_id: resourceId,
    thread_id: sessionId,
    title: DEFAULT_SESSION_TITLE,
    created_at: now,
    last_accessed: now,
  };

  await db.insert(sessions).values(session);
  await ensureThreadRecord(session.thread_id, resourceId, DEFAULT_SESSION_TITLE);

  return {
    sessionId: session.session_id,
    resourceId: session.resource_id,
    threadId: session.thread_id,
    title: session.title,
    createdAt: session.created_at,
    lastAccessed: session.last_accessed,
  };
}

/**
 * Get a session by ID
 *
 * @param sessionId - The session ID to retrieve
 * @returns The session or null if not found
 */
export async function getSession(sessionId: string): Promise<Session | null> {
  const result = await db.select().from(sessions).where(eq(sessions.session_id, sessionId)).get();

  if (!result) {
    return null;
  }

  await ensureThreadRecord(
    result.thread_id,
    result.resource_id,
    result.title ?? DEFAULT_SESSION_TITLE
  );

  return {
    sessionId: result.session_id,
    resourceId: result.resource_id,
    threadId: result.thread_id,
    title: result.title,
    createdAt: result.created_at,
    lastAccessed: result.last_accessed,
  };
}

/**
 * Update the last_accessed timestamp for a session
 *
 * @param sessionId - The session ID to update
 */
export async function touchSession(sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ last_accessed: new Date() })
    .where(eq(sessions.session_id, sessionId));
}

/**
 * Delete a session
 *
 * @param sessionId - The session ID to delete
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.session_id, sessionId));
}

/**
 * Get all sessions
 *
 * @returns All sessions ordered by last accessed (most recent first)
 */
export async function getAllSessions(): Promise<Session[]> {
  const results = await db.select().from(sessions).orderBy(sessions.last_accessed).all();

  return results
    .map(row => ({
      sessionId: row.session_id,
      resourceId: row.resource_id,
      threadId: row.thread_id,
      title: row.title,
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
    }))
    .reverse(); // Most recent first
}

function normalizeTitle(raw: string): string | null {
  const compact = raw.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  const max = 80;
  return compact.length > max ? compact.slice(0, max).trimEnd() : compact;
}

export async function updateSessionTitle(
  sessionId: string,
  title: string,
  options: {
    source?: TitleSource;
    onlyIfProvisional?: boolean;
  } = {}
): Promise<boolean> {
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) return false;

  const session = await db.select().from(sessions).where(eq(sessions.session_id, sessionId)).get();
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
    .update(sessions)
    .set({ title: normalizedTitle })
    .where(eq(sessions.session_id, sessionId));

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
