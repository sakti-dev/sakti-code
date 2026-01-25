/**
 * Shared types for ekacode packages
 */

// Workspace types
export interface WorkspaceConfig {
  root: string;
  worktree?: string;
}

// Session context
export interface SessionContext {
  sessionID: string;
  messageID: string;
  agent: string;
  abort?: AbortSignal;
}

// Permission types
export interface PermissionRequest {
  id: string;
  permission: "read" | "edit" | "external_directory" | "bash";
  patterns: string[];
  always: string[];
  sessionID: string;
  metadata?: Record<string, unknown>;
}

export interface PermissionResponse {
  id: string;
  approved: boolean;
  patterns?: string[];
}
