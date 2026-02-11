/**
 * Session Store
 *
 * Store for session info and status.
 *
 * Updated for Batch 2: Data Integrity - Added cascade delete support
 */

import type { SessionStatusPayload } from "@ekacode/shared/event-types";
import { createStore, produce } from "solid-js/store";

export interface SessionInfo {
  sessionID: string;
  directory: string;
}

export interface SessionState {
  // Session info
  byId: Record<string, SessionInfo>;
  // Session status
  status: Record<string, SessionStatusPayload["status"]>;
  // Ordered session IDs per directory
  byDirectory: Record<string, string[]>;
}

export function createEmptySessionState(): SessionState {
  return {
    byId: {},
    status: {},
    byDirectory: {},
  };
}

/**
 * Cascade delete callback type
 */
export type OnSessionDelete = (sessionId: string) => void;

export interface SessionActions {
  upsert: (session: SessionInfo) => void;
  remove: (sessionId: string) => void;
  setStatus: (sessionId: string, status: SessionStatusPayload["status"]) => void;
  getByDirectory: (directory: string) => SessionInfo[];
  getById: (sessionId: string) => SessionInfo | undefined;
  getStatus: (sessionId: string) => SessionStatusPayload["status"] | undefined;
  /**
   * Set callback for cascade delete
   * @internal Used by StoreProvider to link with message/part stores
   */
  _setOnDelete: (callback: OnSessionDelete) => void;
}

/**
 * Create session store with actions
 *
 * Batch 2: Data Integrity - Added cascade delete support
 * @param initialState - Initial state
 * @param options - Store options
 * @param options.onDelete - Callback for cascade delete
 */
export function createSessionStore(
  initialState: SessionState = createEmptySessionState(),
  options: {
    onDelete?: OnSessionDelete;
  } = {}
): [get: SessionState, actions: SessionActions] {
  const [state, setState] = createStore(initialState);
  let onDeleteCallback = options.onDelete;

  const actions: SessionActions = {
    upsert: (session: SessionInfo) => {
      setState(
        produce((draft: SessionState) => {
          // Upsert to byId
          draft.byId[session.sessionID] = session;

          // Add to directory order if not present
          if (!draft.byDirectory[session.directory]) {
            draft.byDirectory[session.directory] = [];
          }
          if (!draft.byDirectory[session.directory].includes(session.sessionID)) {
            draft.byDirectory[session.directory].push(session.sessionID);
          }
        })
      );
    },

    remove: (sessionId: string) => {
      const session = state.byId[sessionId];
      if (!session) return;

      setState(
        produce((draft: SessionState) => {
          // Remove from byId
          delete draft.byId[sessionId];

          // Remove status
          delete draft.status[sessionId];

          // Remove from directory order
          const directory = session.directory;
          const directorySessions = draft.byDirectory[directory];
          if (directorySessions) {
            const index = directorySessions.indexOf(sessionId);
            if (index > -1) {
              directorySessions.splice(index, 1);
            }
            // Clean up empty directory arrays
            if (directorySessions.length === 0) {
              delete draft.byDirectory[directory];
            }
          }
        })
      );

      // Batch 2: Data Integrity - Cascade delete
      // Notify listeners (message/part stores) to clean up
      if (onDeleteCallback) {
        onDeleteCallback(sessionId);
      }
    },

    setStatus: (sessionId: string, status: SessionStatusPayload["status"]) => {
      setState("status", sessionId, status);
    },

    getByDirectory: (directory: string) => {
      const sessionIds = state.byDirectory[directory] || [];
      return sessionIds.map((id: string) => state.byId[id]).filter(Boolean);
    },

    getById: (sessionId: string) => {
      return state.byId[sessionId];
    },

    getStatus: (sessionId: string) => {
      return state.status[sessionId];
    },

    _setOnDelete: (callback: OnSessionDelete) => {
      onDeleteCallback = callback;
    },
  };

  return [state, actions];
}
