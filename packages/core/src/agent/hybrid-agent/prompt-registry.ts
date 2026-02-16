/**
 * Prompt Registry
 *
 * Manages prompt handlers and resolves prompts based on intent.
 */

import { GENERAL_IMAGE_ANALYSIS_PROMPT } from "../../prompts/hybrid-agent/general-image";
import type { PromptContext, PromptHandler, PromptRegistry, PromptResolution } from "./types";

/**
 * Create a prompt registry with optional initial handlers
 */
export function createPromptRegistry(initial: PromptHandler[] = []): PromptRegistry {
  const map = new Map<Readonly<string>, PromptHandler>(
    initial.map(handler => [handler.id, handler])
  );

  return {
    register(handler: PromptHandler): void {
      map.set(handler.id, handler);
    },

    get(id: string): PromptHandler | undefined {
      return map.get(id);
    },

    list(): PromptHandler[] {
      return Array.from(map.values());
    },

    resolve(context: PromptContext): PromptResolution {
      const handler = map.get(context.intentId);
      if (!handler) {
        throw new Error(`No prompt handler registered for intent: ${context.intentId}`);
      }
      return handler.resolve(context);
    },
  };
}

/**
 * Create a prompt registry with no initial handlers
 */
export function createEmptyPromptRegistry(): PromptRegistry {
  return createPromptRegistry([]);
}

/**
 * Create a default prompt registry with a general image fallback.
 */
export function createDefaultPromptRegistry(): PromptRegistry {
  const registry = createPromptRegistry();

  registry.register({
    id: "general-image",
    description: "General image analysis when no specific intent is detected",
    keywords: [],
    requiredMedia: "none",
    resolve: ({ userText }) => ({
      system: GENERAL_IMAGE_ANALYSIS_PROMPT,
      user: userText,
      outputFormat: "markdown",
    }),
  });

  return registry;
}
