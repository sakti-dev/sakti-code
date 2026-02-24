/**
 * Tool registry for agent registration
 */

import {
  applyPatchTool,
  editTool,
  globTool,
  invalidTool,
  lsTool,
  multieditTool,
  questionTool,
  readTool,
  writeTool,
} from "./index";
import { grepTool } from "./search/grep.tool";
import { webfetchTool } from "./search/webfetch.tool";
import { sequentialThinking } from "./sequential-thinking";
import { bashTool } from "./shell/bash.tool";
import { taskTool } from "./task";

// Code research tools (search-docs)
import { astQuery, fileRead, grepSearch, searchDocs } from "./search-docs";

// Memory tools
import { memorySearchTool, taskMutateTool, taskQueryTool } from "../memory";

// Plan tools
import { planEnterTool, planExitTool } from "./plan";
import { taskParallelTool } from "./task-parallel";

// Spec validation tools
import {
  specValidateDesignTool,
  specValidateGapTool,
  specValidateImplTool,
} from "./spec-validation";

// Spec phase tools
import {
  specDesignTool,
  specInitTool,
  specQuickTool,
  specRequirementsTool,
  specStatusTool,
  specTasksTool,
} from "./spec-phase";

// Skill tools
import { skillTool } from "../skill/tool";

// Tool name type (union of all available tool names)
export type ToolName =
  | "read"
  | "write"
  | "edit"
  | "multiedit"
  | "apply_patch"
  | "invalid"
  | "ls"
  | "glob"
  | "question"
  | "bash"
  | "grep"
  | "webfetch"
  | "sequentialthinking"
  | "task"
  | "task-parallel"
  | "search-docs"
  | "ast-query"
  | "grep-search"
  | "file-read-docs"
  | "memory-search"
  | "task-query"
  | "task-mutate"
  | "plan-enter"
  | "plan-exit"
  | "spec-init"
  | "spec-requirements"
  | "spec-design"
  | "spec-tasks"
  | "spec-status"
  | "spec-quick"
  | "spec-validate-gap"
  | "spec-validate-design"
  | "spec-validate-impl"
  | "skill";

export const toolRegistry = {
  // Filesystem tools
  read: readTool,
  write: writeTool,
  edit: editTool,
  multiedit: multieditTool,
  apply_patch: applyPatchTool,
  invalid: invalidTool,
  ls: lsTool,
  glob: globTool,
  question: questionTool,

  // Shell tools
  bash: bashTool,

  // Search tools
  grep: grepTool,
  webfetch: webfetchTool,

  // AI Agent tools
  sequentialthinking: sequentialThinking,
  task: taskTool,
  "task-parallel": taskParallelTool,

  // Code research tools (search-docs)
  "search-docs": searchDocs,
  "ast-query": astQuery,
  "grep-search": grepSearch,
  "file-read-docs": fileRead, // Use distinct name to avoid conflict with filesystem read

  // Memory tools
  "memory-search": memorySearchTool,
  "task-query": taskQueryTool,
  "task-mutate": taskMutateTool,

  // Plan tools
  "plan-enter": planEnterTool,
  "plan-exit": planExitTool,

  // Spec phase tools
  "spec-init": specInitTool,
  "spec-requirements": specRequirementsTool,
  "spec-design": specDesignTool,
  "spec-tasks": specTasksTool,
  "spec-status": specStatusTool,
  "spec-quick": specQuickTool,

  // Spec validation tools
  "spec-validate-gap": specValidateGapTool,
  "spec-validate-design": specValidateDesignTool,
  "spec-validate-impl": specValidateImplTool,

  // Skill tools
  skill: skillTool,

  getAll(): Record<string, unknown> {
    const { getAll: _getAll, getToolNames: _getToolNames, ...tools } = this;
    return tools as Record<string, unknown>;
  },

  getToolNames(): string[] {
    return Object.keys(this);
  },
};

/**
 * Create a tools object with specified tools
 *
 * @param toolNames - Array of tool names to include
 * @returns Object containing only the specified tools
 */
export function createTools(toolNames: ToolName[]): Record<string, unknown> {
  const tools: Record<string, unknown> = {};
  for (const name of toolNames) {
    if (name in toolRegistry) {
      tools[name] = toolRegistry[name as keyof typeof toolRegistry];
    }
  }
  return tools;
}

/**
 * Get default tools for general coding tasks
 *
 * @returns Object containing commonly used tools
 */
export function getDefaultTools(): Record<string, unknown> {
  return createTools(["read", "write", "edit", "bash", "glob", "grep"]);
}

// Also export as TOOL_REGISTRY for consistency
export const TOOL_REGISTRY = toolRegistry;
