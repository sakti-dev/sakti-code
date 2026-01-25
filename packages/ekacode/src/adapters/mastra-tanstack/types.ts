/**
 * Type definitions for @ekacode/mastra-tanstack adapter
 */

/**
 * Type alias for model IDs supported by Mastra's router
 * Format: "provider/model" (e.g., "openai/gpt-4o")
 */
export type MastraTextModelId = `${string}/${string}` | string;

/**
 * Provider options for Mastra text adapter
 */
export interface MastraTextProviderOptions {
  /**
   * Optional custom API key to use instead of gateway resolution
   */
  apiKey?: string;

  /**
   * Optional custom base URL for OpenAI-compatible providers
   */
  url?: string;

  /**
   * Optional custom headers to include in requests
   */
  headers?: Record<string, string>;

  /**
   * Optional custom gateways to use
   */
  gateways?: Array<Record<string, unknown>>;

  /**
   * Index signature to match MastraProviderOptions
   */
  [key: string]: unknown;
}

/**
 * Input modalities supported by different providers
 */
export type MastraInputModalities = ["text", "image"];

/**
 * Message metadata by modality
 */
export interface MastraMessageMetadataByModality {
  text: {
    role: "user" | "assistant" | "system";
  };
  image: {
    mimeType: string;
    size: number;
  };
  audio: {
    mimeType: string;
    duration: number;
  };
  video: {
    mimeType: string;
    duration: number;
  };
  document: {
    mimeType: string;
    size: number;
  };
}

/**
 * Modality types
 */
export type MastraModality = "text" | "image";

/**
 * Provider capabilities detection result
 */
export interface ProviderCapabilities {
  /**
   * Provider identifier (e.g., 'openai', 'anthropic', 'google')
   */
  providerId: string;

  /**
   * Model identifier
   */
  modelId: string;

  /**
   * Supported structured output approach
   */
  structuredOutput: StructuredOutputSupport;

  /**
   * Whether tool/function calling is supported
   */
  supportsTools: boolean;

  /**
   * Whether streaming is supported
   */
  supportsStreaming: boolean;

  /**
   * Whether image inputs are supported
   */
  supportsImages: boolean;
}

/**
 * Enum for structured output support levels
 */
export enum StructuredOutputSupport {
  /**
   * Native JSON schema mode (OpenAI-style)
   */
  NATIVE_JSON_SCHEMA = "native-json-schema",

  /**
   * Tool-based structured output (Anthropic-style)
   */
  TOOL_BASED = "tool-based",

  /**
   * Instruction-only JSON parsing
   */
  INSTRUCTION_ONLY = "instruction-only",
}
