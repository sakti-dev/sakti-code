/**
 * Structured output strategies and provider capability detection
 */

import type { JSONSchema } from "@tanstack/ai";
import { StructuredOutputSupport } from "./types";

/**
 * Provider capability patterns
 */
const PROVIDER_PATTERNS = {
  openai: {
    modelId: ["gpt", "o1"],
    structuredOutput: StructuredOutputSupport.NATIVE_JSON_SCHEMA,
    supportsTools: true,
    supportsStreaming: true,
    supportsImages: true,
  },
  anthropic: {
    modelId: ["claude"],
    structuredOutput: StructuredOutputSupport.TOOL_BASED,
    supportsTools: true,
    supportsStreaming: true,
    supportsImages: true,
  },
  google: {
    modelId: ["gemini", "learnlm"],
    structuredOutput: StructuredOutputSupport.NATIVE_JSON_SCHEMA,
    supportsTools: true,
    supportsStreaming: true,
    supportsImages: true,
  },
  mistral: {
    modelId: ["mistral", "codestral"],
    structuredOutput: StructuredOutputSupport.TOOL_BASED,
    supportsTools: true,
    supportsStreaming: true,
    supportsImages: false,
  },
  cohere: {
    modelId: ["command"],
    structuredOutput: StructuredOutputSupport.TOOL_BASED,
    supportsTools: true,
    supportsStreaming: true,
    supportsImages: false,
  },
};

/**
 * Detect provider capabilities based on model ID
 *
 * @param providerId - Provider identifier
 * @param modelId - Model identifier
 * @returns Detected provider capabilities
 */
export function detectProviderSupport(
  providerId: string,
  modelId: string
): {
  providerId: string;
  modelId: string;
  structuredOutput: StructuredOutputSupport;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsImages: boolean;
} {
  // Normalize provider ID
  const normalizedProvider = providerId.toLowerCase().split("/")[0];

  // Check known providers
  const provider = PROVIDER_PATTERNS[normalizedProvider as keyof typeof PROVIDER_PATTERNS];

  if (provider) {
    return {
      providerId: normalizedProvider,
      modelId,
      structuredOutput: provider.structuredOutput,
      supportsTools: provider.supportsTools,
      supportsStreaming: provider.supportsStreaming,
      supportsImages: provider.supportsImages,
    };
  }

  // Fallback for unknown providers
  return {
    providerId: normalizedProvider,
    modelId,
    structuredOutput: StructuredOutputSupport.INSTRUCTION_ONLY,
    supportsTools: false,
    supportsStreaming: true, // Most providers support streaming
    supportsImages: false,
  };
}

/**
 * Parse JSON with multiple fallback strategies
 *
 * @param text - Text that may contain JSON
 * @returns Parsed JSON object
 * @throws Error if no valid JSON found
 */
export function parseJSONWithFallbacks(text: string): unknown {
  if (!text || text.trim().length === 0) {
    throw new Error("Empty text provided");
  }

  // Strategy 1: Direct JSON parse
  try {
    const parsed = JSON.parse(text.trim());
    if (parsed !== null && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    // Continue to next strategy
  }

  // Strategy 2: Extract from markdown code blocks
  const jsonCodeBlockRegex = /```(?:json)?\s*(\{[\s\S]*?\}|(?:\[[\s\S]*?\]))\s*```/;
  const codeBlockMatch = text.match(jsonCodeBlockRegex);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]);
      if (parsed !== null && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // Continue to next strategy
    }
  }

  // Strategy 3: Find JSON-like structure in mixed content
  const objectRegex = /\{[^{}]*\{[^{}]*\}[^{}]*\}|\{[^{}]*\}/g;
  const arrayRegex = /\[[^\[\]]*\[[^\[\]]*\][^\[\]]*\]|\[[^\[\]]*\]/g;

  const jsonMatches = [...(text.match(objectRegex) || []), ...(text.match(arrayRegex) || [])];

  for (const match of jsonMatches) {
    try {
      const parsed = JSON.parse(match);
      if (parsed !== null && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // Try next match
    }
  }

  // Strategy 4: Look for patterns like {"key": "value"} or {key: "value"}
  const looseJsonRegex = /\{[\s\n]*"[^"]+"[\s\n]*:[\s\n]*[^}]+\}/g;
  const looseMatches = text.match(looseJsonRegex);

  if (looseMatches) {
    for (const match of looseMatches) {
      try {
        const parsed = JSON.parse(match);
        if (parsed !== null && typeof parsed === "object") {
          return parsed;
        }
      } catch {
        // Try next match
      }
    }
  }

  throw new Error("No valid JSON found in provided text");
}

/**
 * Transform JSON Schema for OpenAI structured output compatibility
 *
 * OpenAI has strict requirements for structured output:
 * - All properties must be in required array
 * - Optional fields should have null in their type union
 * - additionalProperties must be false
 *
 * @param schema - Original JSON Schema
 * @param _requiredFields - Array of required field names (unused, kept for compatibility)
 * @returns Transformed schema compatible with OpenAI
 */
export function transformSchemaForOpenAI(
  schema: Record<string, unknown>,
  _requiredFields: string[] = []
): Record<string, unknown> {
  const transformed = { ...schema };

  // Ensure all properties are in required array
  if (schema.properties) {
    transformed.required = Object.keys(schema.properties);
  }

  // Set additionalProperties to false
  transformed.additionalProperties = false;

  return transformed;
}

/**
 * Get structured output instructions for instruction-only mode
 *
 * @param schema - JSON Schema to describe desired output
 * @returns Prompt instructions for structured output
 */
export function getStructuredOutputInstructions(schema: JSONSchema): string {
  return `Your response must be valid JSON that matches this schema:
${JSON.stringify(schema, null, 2)}

Respond ONLY with the JSON object, without any additional text or explanation.`;
}
