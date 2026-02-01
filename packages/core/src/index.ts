/**
 * @ekacode/core
 *
 * Core ekacode package - Mastra agents, tools, and utilities
 */

// Mastra instance
export { mastra, memory } from "./memory/mastra";

// Memory
export { EkacodeMemory, getMemory } from "./memory";

// Agents
export { buildAgentModel, createRoleAgent } from "./agents";
export type { AgentModels, AgentProfile, RoleAgentOverrides } from "./agents";
export { createCoderAgent } from "./agents/coder";
export { createPlannerAgent } from "./agents/planner";

// Tools
export {
  // Filesystem tools
  applyPatchTool,
  // Shell tools
  bashTool,
  editTool,
  globTool,
  lsTool,
  multieditTool,
  readTool,
  writeTool,
} from "./tools";

// Search tools
export { grepTool, webfetchTool } from "./tools";

// Sequential thinking
export {
  createSequentialThinkingTool,
  createSequentialThinkingToolWithDb,
  sequentialThinking,
  type DatabaseStorageConfig,
  type SequentialThinkingStorage,
  type Session,
  type SessionSerialized,
  type ThoughtEntry,
} from "./tools/sequential-thinking";

// Sequential thinking storage
export {
  MemoryStorage,
  createDatabaseStorage,
  createSession,
  deserializeSession,
  serializeSession,
} from "./tools/sequential-thinking-storage";

// Search docs tools
export {
  astQuery,
  createAstQueryTool,
  createFileReadTool,
  createGrepSearchTool,
  createSearchDocsTool,
  fileRead,
  grepSearch,
  searchDocs,
} from "./tools/search-docs";

// Search docs infrastructure
export {
  getSessionStore,
  type ClonedRepo,
  type DocSession,
} from "./tools/search-docs/session-store";

export { getSubAgentManager, resetSubAgentManager } from "./tools/search-docs/sub-agent";

export {
  gitManager,
  type CloneOptions,
  type CloneResult,
  type GitError,
} from "./tools/search-docs/git-manager";

export {
  gitClone,
  gitProbe,
  importMapLookup,
  registryLookup,
  type PackageRegistryEntry,
} from "./tools/search-docs/discovery-tools";

// Tool registry
export { toolRegistry } from "./tools/registry";
export type { ToolName } from "./tools/registry";

// Factory function
export { createTools, getDefaultTools } from "./tools/registry";

// Re-export base utilities
export {
  assertExternalDirectory,
  containsPath,
  detectBinaryFile,
  normalizePath,
} from "./tools/base/filesystem";
export { truncateOutput } from "./tools/base/truncation";
export { TRUNCATION_LIMITS } from "./tools/base/types";
export type { ToolExecutionContext, TruncationResult } from "./tools/base/types";

// Security
export type { PermissionAction, PermissionRule, PermissionType } from "@ekacode/shared";
export {
  PermissionDeniedError,
  PermissionManager,
  PermissionRejectedError,
  PermissionTimeoutError,
} from "./security/permission-manager";
export {
  createDefaultRules,
  evaluatePatterns,
  evaluatePermission,
  expandPath,
  findMatchingRule,
  formatConfigRules,
  globToRegex,
  matchesGlob,
  parseConfigRules,
  type PermissionConfig,
} from "./security/permission-rules";

// Workspace
export { WorkspaceInstance } from "./workspace/instance";

// Instance context system
export type { InstanceContext, ProjectInfo, VCSInfo } from "./instance/context";
export { Instance } from "./instance/index.ts";

// Config
export { initializePermissionRules, loadPermissionConfig } from "./config/permissions";

// Hybrid Agent
export {
  HybridAgent,
  buildMcpPromptRegistry,
  createDefaultPromptRegistry,
  createPromptRegistry,
  createZaiHybridAgent,
} from "./agents/hybrid-agent";
export type {
  HybridAgentOptions,
  Intent,
  IntentId,
  PromptHandler,
  PromptRegistry,
  VisionImage,
  VisionRequest,
} from "./agents/hybrid-agent";

// State Machine (XState RLM Workflow)
export * from "./state";

export const ekacodeVersion = "0.0.1";
