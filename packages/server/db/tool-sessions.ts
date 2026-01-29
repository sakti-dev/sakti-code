/**
 * Tool session CRUD operations
 *
 * Provides per-tool session isolation with UUIDv7 identifiers.
 * Tool sessions are children of user sessions and are deleted when the parent is deleted.
 */

import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db, toolSessions } from "./index";

/**
 * Tool session data structure
 */
export interface ToolSession {
  toolSessionId: string; // UUIDv7
  sessionId: string; // parent session
  toolName: string; // e.g., "sequential-thinking"
  toolKey: string; // optional sub-key (defaults to empty string)
  data: unknown; // tool-specific state
  createdAt: Date; // unix timestamp ms
  lastAccessed: Date; // unix timestamp ms
}

/**
 * Get or create a tool session
 *
 * If a tool session exists for the given session/toolName/toolKey combination,
 * it will be returned. Otherwise, a new one will be created.
 *
 * @param sessionId - The parent session ID
 * @param toolName - The tool name (e.g., "sequential-thinking")
 * @param toolKey - Optional sub-key for multiple instances of the same tool
 * @returns The tool session
 */
export async function getToolSession(
  sessionId: string,
  toolName: string,
  toolKey: string = ""
): Promise<ToolSession> {
  // Try to find existing session
  const existing = await db
    .select()
    .from(toolSessions)
    .where(
      and(
        eq(toolSessions.session_id, sessionId),
        eq(toolSessions.tool_name, toolName),
        eq(toolSessions.tool_key, toolKey)
      )
    )
    .get();

  if (existing) {
    const now = new Date();
    await db
      .update(toolSessions)
      .set({ last_accessed: now })
      .where(eq(toolSessions.tool_session_id, existing.tool_session_id));

    return {
      toolSessionId: existing.tool_session_id,
      sessionId: existing.session_id,
      toolName: existing.tool_name,
      toolKey: existing.tool_key,
      data: existing.data,
      createdAt: existing.created_at,
      lastAccessed: now,
    };
  }

  // Create new tool session
  const toolSessionId = uuidv7();
  const now = new Date();

  const newSession = {
    tool_session_id: toolSessionId,
    session_id: sessionId,
    tool_name: toolName,
    tool_key: toolKey,
    data: null,
    created_at: now,
    last_accessed: now,
  };

  await db
    .insert(toolSessions)
    .values(newSession)
    .onConflictDoNothing({
      target: [toolSessions.session_id, toolSessions.tool_name, toolSessions.tool_key],
    });

  const created = await db
    .select()
    .from(toolSessions)
    .where(
      and(
        eq(toolSessions.session_id, sessionId),
        eq(toolSessions.tool_name, toolName),
        eq(toolSessions.tool_key, toolKey)
      )
    )
    .get();

  if (!created) {
    throw new Error("Failed to create tool session");
  }

  return {
    toolSessionId: created.tool_session_id,
    sessionId: created.session_id,
    toolName: created.tool_name,
    toolKey: created.tool_key,
    data: created.data,
    createdAt: created.created_at,
    lastAccessed: created.last_accessed,
  };
}

/**
 * Update tool session data
 *
 * @param toolSessionId - The tool session ID to update
 * @param data - The new data to store
 */
export async function updateToolSession(toolSessionId: string, data: unknown): Promise<void> {
  const now = new Date();
  await db
    .update(toolSessions)
    .set({ data, last_accessed: now })
    .where(eq(toolSessions.tool_session_id, toolSessionId));
}

/**
 * Delete a tool session
 *
 * @param toolSessionId - The tool session ID to delete
 */
export async function deleteToolSession(toolSessionId: string): Promise<void> {
  await db.delete(toolSessions).where(eq(toolSessions.tool_session_id, toolSessionId));
}
