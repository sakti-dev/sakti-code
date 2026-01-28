/**
 * Hybrid Agent Type Definitions
 *
 * Provider-agnostic hybrid agent that combines text and vision models.
 */

import type { LanguageModelV3 } from "@ai-sdk/provider";

/**
 * Unique intent identifier
 */
export type IntentId = string;

/**
 * Intent classification result
 */
export interface Intent {
  id: IntentId;
  confidence: number;
  reasoning?: string;
  promptParams?: Record<string, unknown>;
}

/**
 * Output format for prompts
 */
export type OutputFormat = "code" | "text" | "json" | "markdown";

/**
 * Prompt resolution context
 */
export interface PromptContext {
  intentId: IntentId;
  userText: string;
  promptParams?: Record<string, unknown>;
}

/**
 * Resolved prompt with system and user components
 */
export interface PromptResolution {
  system: string;
  user: string;
  outputFormat?: OutputFormat;
}

/**
 * Prompt handler definition
 *
 * Mirrors MCP tool registration pattern
 */
export interface PromptHandler {
  id: IntentId;
  description?: string;
  inputSchema?: unknown;
  keywords?: string[];
  requiredMedia?: "image" | "video" | "none";
  minImages?: number;
  resolve(context: PromptContext): PromptResolution;
}

/**
 * Prompt registry interface
 */
export interface PromptRegistry {
  register(handler: PromptHandler): void;
  get(id: IntentId): PromptHandler | undefined;
  list(): PromptHandler[];
  resolve(context: PromptContext): PromptResolution;
}

/**
 * Vision image data
 */
export interface VisionImage {
  id: string;
  data: string | Uint8Array;
  mediaType: string;
}

/**
 * Vision request
 */
export interface VisionRequest {
  intent: Intent;
  images: VisionImage[];
  userText: string;
}

/**
 * Image normalization function type
 */
export type NormalizeImage = (image: VisionImage) => VisionImage;

/**
 * Prompt registry loader function type
 */
export type PromptRegistryLoader = () => PromptRegistry;

/**
 * Hybrid agent options
 */
export interface HybridAgentOptions {
  /**
   * Model ID for the agent (defaults to "hybrid")
   */
  modelId?: string;

  /**
   * Text model instance (LanguageModelV3)
   */
  textModel: LanguageModelV3;

  /**
   * Vision model instance (LanguageModelV3)
   */
  visionModel: LanguageModelV3;

  /**
   * Function to load the prompt registry
   */
  loadPrompts: PromptRegistryLoader;

  /**
   * Optional image normalization function
   */
  normalizeImage?: NormalizeImage;
}
