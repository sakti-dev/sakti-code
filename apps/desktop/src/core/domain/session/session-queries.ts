/**
 * Session Queries
 *
 * Pure query functions for session data.
 */

import type { SessionInfo, SessionState } from "../../stores/session-store";

/**
 * Get sessions by directory
 */
export function getByDirectory(state: SessionState, directory: string): SessionInfo[] {
  const sessionIds = state.byDirectory[directory] || [];
  return sessionIds.map((id: string) => state.byId[id]).filter(Boolean);
}

/**
 * Get session by ID
 */
export function getById(state: SessionState, sessionId: string): SessionInfo | undefined {
  return state.byId[sessionId];
}

/**
 * Get session status
 */
export function getStatus(
  state: SessionState,
  sessionId: string
): SessionState["status"][string] | undefined {
  return state.status[sessionId];
}

/**
 * Get active (running) sessions in a directory
 */
export function getActiveSessions(state: SessionState, directory: string): SessionInfo[] {
  const sessions = getByDirectory(state, directory);
  return sessions.filter(session => {
    const status = state.status[session.sessionID];
    return status?.type === "busy";
  });
}
