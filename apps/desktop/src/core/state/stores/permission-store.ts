/**
 * Permission Store
 *
 * Unified state management for permission requests.
 * Replaces the separate SSE connection in usePermissions.
 */

import { createStore, produce } from "solid-js/store";

/** Permission request status */
export type PermissionStatus = "pending" | "approved" | "denied";

/** Permission request data */
export interface PermissionRequest {
  /** Unique permission request ID */
  id: string;
  /** Session ID this request belongs to */
  sessionID: string;
  /** Message ID this request is associated with */
  messageID: string;
  /** Tool name requesting permission */
  toolName: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** Optional allowed patterns (for allow-always behavior) */
  patterns?: string[];
  /** Human-readable description of the operation */
  description?: string;
  /** Current status */
  status: PermissionStatus;
  /** Timestamp of creation */
  timestamp: number;
  /** Tool call ID if applicable */
  callID?: string;
}

/** Permission store state */
export interface PermissionState {
  /** Permissions indexed by ID */
  byId: Record<string, PermissionRequest>;
  /** Permission IDs grouped by session */
  bySession: Record<string, string[]>;
  /** Ordered list of pending permission IDs */
  pendingOrder: string[];
}

/** Permission store actions */
export interface PermissionActions {
  /** Add a new permission request */
  add: (request: PermissionRequest) => void;
  /** Approve a permission request */
  approve: (id: string) => void;
  /** Deny a permission request */
  deny: (id: string) => void;
  /** Resolve a permission request (approve or deny) */
  resolve: (id: string, approved: boolean) => void;
  /** Get all permissions for a session */
  getBySession: (sessionID: string) => PermissionRequest[];
  /** Get all pending permissions */
  getPending: () => PermissionRequest[];
  /** Get a specific permission by ID */
  getById: (id: string) => PermissionRequest | undefined;
  /** Remove a permission request */
  remove: (id: string) => void;
  /** Clear all resolved permissions for a session */
  clearResolved: (sessionID: string) => void;
}

/** Create empty permission state */
export function createEmptyPermissionState(): PermissionState {
  return {
    byId: {},
    bySession: {},
    pendingOrder: [],
  };
}

/** Create permission store with actions */
export function createPermissionStore(
  initialState: PermissionState = createEmptyPermissionState()
): [get: PermissionState, actions: PermissionActions] {
  const [state, setState] = createStore(initialState);

  const actions: PermissionActions = {
    add: (request: PermissionRequest) => {
      setState(
        produce((draft: PermissionState) => {
          const existing = draft.byId[request.id];
          if (existing) {
            const previousSessionIds = draft.bySession[existing.sessionID];
            if (previousSessionIds) {
              const existingIndex = previousSessionIds.indexOf(request.id);
              if (existingIndex > -1) {
                previousSessionIds.splice(existingIndex, 1);
              }
            }

            const pendingIndex = draft.pendingOrder.indexOf(request.id);
            if (pendingIndex > -1) {
              draft.pendingOrder.splice(pendingIndex, 1);
            }
          }

          // Upsert byId
          draft.byId[request.id] = request;

          // Upsert session grouping
          if (!draft.bySession[request.sessionID]) {
            draft.bySession[request.sessionID] = [];
          }
          if (!draft.bySession[request.sessionID].includes(request.id)) {
            draft.bySession[request.sessionID].push(request.id);
          }

          // Add to pending order if pending
          if (request.status === "pending" && !draft.pendingOrder.includes(request.id)) {
            draft.pendingOrder.push(request.id);
          }
        })
      );
    },

    approve: (id: string) => {
      actions.resolve(id, true);
    },

    deny: (id: string) => {
      actions.resolve(id, false);
    },

    resolve: (id: string, approved: boolean) => {
      setState(
        produce((draft: PermissionState) => {
          const request = draft.byId[id];
          if (!request) return;

          // Update status
          request.status = approved ? "approved" : "denied";

          // Remove from pending order
          const pendingIndex = draft.pendingOrder.indexOf(id);
          if (pendingIndex > -1) {
            draft.pendingOrder.splice(pendingIndex, 1);
          }
        })
      );
    },

    getBySession: (sessionID: string) => {
      const permissionIds = state.bySession[sessionID] || [];
      return permissionIds.map((id: string) => state.byId[id]).filter(Boolean);
    },

    getPending: () => {
      return state.pendingOrder.map((id: string) => state.byId[id]).filter(Boolean);
    },

    getById: (id: string) => {
      return state.byId[id];
    },

    remove: (id: string) => {
      setState(
        produce((draft: PermissionState) => {
          const request = draft.byId[id];
          if (!request) return;

          // Remove from byId
          delete draft.byId[id];

          // Remove from session grouping
          const sessionPermissions = draft.bySession[request.sessionID];
          if (sessionPermissions) {
            const index = sessionPermissions.indexOf(id);
            if (index > -1) {
              sessionPermissions.splice(index, 1);
            }
          }

          // Remove from pending order
          const pendingIndex = draft.pendingOrder.indexOf(id);
          if (pendingIndex > -1) {
            draft.pendingOrder.splice(pendingIndex, 1);
          }
        })
      );
    },

    clearResolved: (sessionID: string) => {
      setState(
        produce((draft: PermissionState) => {
          const permissionIds = draft.bySession[sessionID] || [];
          const idsToRemove: string[] = [];

          permissionIds.forEach((id: string) => {
            const request = draft.byId[id];
            if (request && request.status !== "pending") {
              idsToRemove.push(id);
              delete draft.byId[id];
            }
          });

          // Update session grouping
          draft.bySession[sessionID] = permissionIds.filter(
            (id: string) => !idsToRemove.includes(id)
          );

          // Update pending order
          draft.pendingOrder = draft.pendingOrder.filter((id: string) => !idsToRemove.includes(id));
        })
      );
    },
  };

  return [state, actions];
}
