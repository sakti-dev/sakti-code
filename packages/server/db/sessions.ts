/**
 * Session CRUD operations
 *
 * Provides session storage with UUIDv7 identifiers.
 * Sessions are created server-side and persisted to the database.
 */

import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db, sessions } from "./index";

/**
 * Session data structure
 */
export interface Session {
  sessionId: string; // UUIDv7
  resourceId: string; // userId or "local"
  threadId: string; // == sessionId
  createdAt: Date; // unix timestamp ms
  lastAccessed: Date; // unix timestamp ms
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
    created_at: now,
    last_accessed: now,
  };

  await db.insert(sessions).values(session);

  return {
    sessionId: session.session_id,
    resourceId: session.resource_id,
    threadId: session.thread_id,
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
    created_at: now,
    last_accessed: now,
  };

  await db.insert(sessions).values(session);

  return {
    sessionId: session.session_id,
    resourceId: session.resource_id,
    threadId: session.thread_id,
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

  return {
    sessionId: result.session_id,
    resourceId: result.resource_id,
    threadId: result.thread_id,
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
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
    }))
    .reverse(); // Most recent first
}
