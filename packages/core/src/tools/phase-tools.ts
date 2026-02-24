/**
 * Phase-specific tool mapping
 *
 * Provides tool sets for different agent phases, ensuring
 * that explore and plan agents only have read-only access while
 * build agents have full read/write access.
 */

import { AgentType } from "../agent/workflow/types";
import { createTools, ToolName } from "./registry";

/**
 * Tool names for read-only operations
 */
const READ_ONLY_TOOLS: ToolName[] = [
  "read",
  "ls",
  "glob",
  "question",
  "grep",
  "webfetch",
  "search-docs",
  "ast-query",
  "grep-search",
  "file-read-docs",
  "sequentialthinking",
  // Spec phase tools (read-only for plan mode)
  "spec-init",
  "spec-requirements",
  "spec-design",
  "spec-tasks",
  "spec-status",
  "spec-quick",
  // Spec validation tools (read-only)
  "spec-validate-gap",
  "spec-validate-design",
  "spec-validate-impl",
];

/**
 * Tool names for read + write operations
 */
const READ_WRITE_TOOLS: ToolName[] = [
  ...READ_ONLY_TOOLS,
  "write",
  "edit",
  "multiedit",
  "apply_patch",
  "bash",
  "task",
];

/**
 * Get tools for a specific agent phase
 *
 * - explore: Read-only tools for codebase exploration
 * - plan: Read-only tools for planning and research
 * - build: Full tool access for implementation
 *
 * @param type - The agent type/phase
 * @returns Object containing tools for the phase
 */
export function getToolsForPhase(type: AgentType): Record<string, unknown> {
  switch (type) {
    case "explore":
      return createTools(READ_ONLY_TOOLS);
    case "plan":
      return createTools(READ_ONLY_TOOLS);
    case "build":
      return createTools(READ_WRITE_TOOLS);
    default:
      throw new Error(`Unknown agent type: ${type}`);
  }
}

/**
 * Export tool name lists for testing
 */
export const EXPLORE_TOOLS = READ_ONLY_TOOLS;
export const BUILD_TOOLS = READ_WRITE_TOOLS;
