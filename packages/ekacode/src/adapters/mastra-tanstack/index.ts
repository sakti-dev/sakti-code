/**
 * @ekacode/mastra-tanstack - TanStack AI adapter for Mastra's ModelRouterLanguageModel
 *
 * This adapter provides a bridge between Mastra's gateway-based model routing system
 * and TanStack AI's streaming interface.
 *
 * @example
 * ```typescript
 * import { MastraTextAdapter } from '@ekacode/mastra-tanstack'
 * import { ModelRouterLanguageModel } from '@mastra/core'
 *
 * const mastraModel = new ModelRouterLanguageModel('openai/gpt-4o')
 * const adapter = new MastraTextAdapter('openai/gpt-4o', {}, mastraModel)
 * ```
 */

// Re-export types
export type {
  MastraInputModalities,
  MastraMessageMetadataByModality,
  MastraModality,
  MastraTextModelId,
  MastraTextProviderOptions,
  ProviderCapabilities,
} from "./types";

export { StructuredOutputSupport } from "./types";

// Re-export adapter class and interfaces
export { MastraLanguageModel, MastraTextAdapter } from "./adapters/text";
export type { MastraProviderOptions } from "./adapters/text";

// Re-export utilities for advanced usage
export { convertToAISDKMessages, convertToolsToAISDK } from "./convert";

export { isCompleteJSON, mapFinishReason, mapUsage, ToolCallAccumulator } from "./stream";

export {
  detectProviderSupport,
  parseJSONWithFallbacks,
  transformSchemaForOpenAI,
} from "./structured-output";

// Import the adapter class and types for factory functions
import type { MastraLanguageModel, MastraProviderOptions } from "./adapters/text";
import { MastraTextAdapter } from "./adapters/text";
import type { MastraTextProviderOptions } from "./types";

/**
 * Factory function to create a Mastra text adapter with a model instance
 *
 * @param modelId - Mastra model router ID (e.g., 'openai/gpt-4o', 'anthropic/claude-3-5-sonnet')
 * @param mastraModel - Pre-configured ModelRouterLanguageModel instance
 * @param config - Optional provider configuration
 * @returns Configured MastraTextAdapter instance
 *
 * @example
 * ```typescript
 * import { ModelRouterLanguageModel } from '@mastra/core'
 * import { mastraTextWithModel } from '@ekacode/mastra-tanstack'
 *
 * const mastraModel = new ModelRouterLanguageModel('openai/gpt-4o')
 * const adapter = mastraTextWithModel('openai/gpt-4o', mastraModel)
 * ```
 */
export function mastraTextWithModel<TModel extends string>(
  modelId: TModel,
  mastraModel: MastraLanguageModel,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  config?: MastraTextProviderOptions
): MastraTextAdapter {
  return new MastraTextAdapter(modelId, {} as MastraProviderOptions, mastraModel);
}

/**
 * Create a Mastra text adapter without a model (model must be set later)
 *
 * @param modelId - Mastra model router ID (e.g., 'openai/gpt-4o', 'anthropic/claude-3-5-sonnet')
 * @param config - Optional provider configuration
 * @returns Configured MastraTextAdapter instance (model must be set via setModel())
 *
 * @example
 * ```typescript
 * import { mastraText } from '@ekacode/mastra-tanstack'
 *
 * const adapter = mastraText('openai/gpt-4o')
 * // Later: adapter.setModel(mastraModel)
 * ```
 */
export function mastraText<TModel extends string>(
  modelId: TModel,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  config?: MastraTextProviderOptions
): MastraTextAdapter {
  return new MastraTextAdapter(modelId, {} as MastraProviderOptions);
}
