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
export type PermissionType = "read" | "edit" | "external_directory" | "bash" | "mode_switch";

export type PermissionAction = "allow" | "deny" | "ask";

export interface PermissionRule {
  permission: PermissionType;
  pattern: string; // glob pattern (e.g., "*.ts", "/etc/**", "git*")
  action: PermissionAction;
}

export interface PermissionRequest {
  id: string;
  permission: PermissionType;
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
