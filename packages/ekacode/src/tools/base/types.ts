/**
 * Tool execution context and types
 */

import type { SessionContext } from "@ekacode/shared";

export interface ToolExecutionContext extends SessionContext {
  workspaceRoot: string;
  worktreePath: string;
  ask?: (permission: string, patterns: string[]) => Promise<boolean>;
}

export interface TruncationResult {
  content: string;
  truncated: boolean;
  lineCount?: number;
}

export const TRUNCATION_LIMITS = {
  MAX_LINES: 2000,
  MAX_BYTES: 50 * 1024,
  MAX_LINE_LENGTH: 2000,
} as const;
