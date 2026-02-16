/**
 * Hybrid Agent Module Index
 *
 * Public exports for the hybrid agent functionality.
 */

// Main agent class
export { HybridAgent } from "./hybrid-agent";

// Prompt registry
export {
  createDefaultPromptRegistry,
  createEmptyPromptRegistry,
  createPromptRegistry,
} from "./prompt-registry";

// Z.ai adapter factory
export { buildMcpPromptRegistry, createZaiHybridAgent } from "./zai-hybrid-agent";

// Intent classifier
export {
  IntentClassifier,
  classifyByKeywords,
  getAvailableIntents,
  getIntentKeywords,
} from "./intent-classifier";

// Types
export type {
  HybridAgentOptions,
  Intent,
  IntentId,
  NormalizeImage,
  OutputFormat,
  PromptContext,
  PromptHandler,
  PromptRegistry,
  PromptResolution,
  VisionImage,
  VisionRequest,
} from "./types";

// Vision request handler
export {
  VisionRequestHandler,
  extractTextFromContent,
  imagesToContentParts,
} from "./vision-request-handler";

// Image utilities
export {
  extractImagesAndText,
  hasImageParts,
  selectVisionStrategy,
  stripImageParts,
} from "./image-utils";

// Prompt injector
export {
  createHybridPrompt,
  injectVisionAnalysis,
  injectVisionAnalysisInUserMessage,
} from "./prompt-injector";

// Prompts
export * from "../../prompts/hybrid-agent/index";
