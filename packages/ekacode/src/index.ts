/**
 * @ekacode/ekacode
 *
 * Core ekacode package - Mastra agents, tools, and utilities
 */

// Mastra instance
export { mastra } from "./mastra";

// Agents
export { coderAgent } from "./agents/coder";

// Tools
export {
  applyPatchTool,
  editTool,
  globTool,
  lsTool,
  multieditTool,
  readTool,
  writeTool,
} from "./tools";
export { toolRegistry } from "./tools/registry";

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
export { PermissionManager } from "./security/permission-manager";

// Workspace
export { WorkspaceInstance } from "./workspace/instance";

// Mastra-TanStack Adapter
export {
  MastraLanguageModel,
  MastraTextAdapter,
  StructuredOutputSupport,
  mastraText,
  mastraTextWithModel,
} from "./adapters/mastra-tanstack";
export type {
  MastraInputModalities,
  MastraMessageMetadataByModality,
  MastraModality,
  MastraProviderOptions,
  MastraTextModelId,
  MastraTextProviderOptions,
  ProviderCapabilities,
} from "./adapters/mastra-tanstack";

// Hybrid Agent
export {
  HybridAgent,
  buildMcpPromptRegistry,
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

export const ekacodeVersion = "0.0.1";
