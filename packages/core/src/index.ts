/**
 * @sakti-code/core
 *
 * Core sakti-code package - Mastra agents, tools, and utilities
 */

// Memory System (Phase 1)
export {
  executeMemorySearch,
  executeTaskMutate,
  executeTaskQuery,
  memorySearchTool,
  messageStorage,
  taskMutateTool,
  taskQueryTool,
  taskStorage,
  type BlockedStatus,
  type CreateMessageInput,
  type CreateTaskInput,
  type ListMessagesOptions,
  type ListTasksOptions,
  type SearchResult,
  type UpdateTaskInput,
} from "./memory";

// Agents
export { buildAgentModel, createRoleAgent } from "./agent";
export type { AgentModels, AgentProfile, RoleAgentOverrides } from "./agent";
export { createCoderAgent } from "./agent/coder";
export { createPlannerAgent } from "./agent/planner";
export { listAgents } from "./agent/registry";

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

// Testing helpers
export * from "./testing";

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
export type { PermissionAction, PermissionRule, PermissionType } from "@sakti-code/shared";
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
} from "./agent/hybrid-agent";
export type {
  HybridAgentOptions,
  Intent,
  IntentId,
  PromptHandler,
  PromptRegistry,
  VisionImage,
  VisionRequest,
} from "./agent/hybrid-agent";

// Agent System (new architecture)
export {
  PHASE_ITERATION_LIMITS,
  PHASE_MODELS,
  createAgent,
  createBuildAgent,
  createExploreAgent,
  createPlanAgent,
} from "./agent/workflow/factory";
export {
  buildModel,
  exploreModel,
  getBuildModel,
  getExploreModel,
  getModelByReference,
  getPlanModel,
  getVisionModel,
  planModel,
  visionModel,
} from "./agent/workflow/model-provider";
export {
  AgentConfig,
  AgentEvent,
  AgentInput,
  AgentResult,
  AgentType,
} from "./agent/workflow/types";
export { PHASE_PROMPTS } from "./prompts";
export { AgentProcessor } from "./session/processor";

// Session Management (new architecture)
export { SessionController } from "./session/controller";
export { SessionManager } from "./session/manager";
export { ShutdownHandler } from "./session/shutdown";
export { Checkpoint, SessionConfig, SessionPhase, SessionStatus } from "./session/types";

// Plugin hook compatibility layer (OpenCode-style hook names)
export {
  applyToolDefinitionHook,
  clearCorePluginHooks,
  resolveHookModel,
  setCorePluginHooks,
  triggerChatHeadersHook,
  triggerChatParamsHook,
} from "./plugin/hooks";
export type {
  ChatHeadersOutput,
  ChatHookInput,
  ChatParamsOutput,
  CorePluginHooks,
  ToolDefinitionOutput,
} from "./plugin/hooks";

// Skill System
export {
  SkillDiscovery,
  SkillInfo,
  SkillManager,
  discoverLocalSkills,
  fetchRemoteSkills,
  getSkillManager,
  initializeSkills,
  setSkillManager,
  setSkillPermissionRules,
  skillInfoToApiResponse,
  skillTool,
  skillToolSchema,
  type SkillApiResponse,
} from "./skill";

// LSP
export { LSP, LSPServerRegistry } from "./lsp";
export type { LSPDiagnostic, LSPRange, LSPServerInfo, LSPStatus } from "./lsp";

export const saktiCodeVersion = "0.0.1";
