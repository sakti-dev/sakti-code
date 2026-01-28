/**
 * Vision Prompt Builder
 *
 * Build prompts for vision model calls.
 */

import type { LanguageModelV3Prompt } from "@ai-sdk/provider";
import type { PromptRegistry, PromptResolution, VisionImage, VisionRequest } from "./types";
import { imagesToContentParts } from "./vision-request-handler";

// User content type (text + file only, no reasoning/tool parts)
type UserContent =
  | { type: "text"; text: string }
  | { type: "file"; data: string | Uint8Array; mediaType: string };

/**
 * Build a vision prompt from a vision request
 *
 * This constructs the appropriate prompt structure for the vision model
 * based on the intent and available prompt resolution.
 */
export function buildVisionPrompt(
  request: VisionRequest,
  promptRegistry: PromptRegistry
): LanguageModelV3Prompt {
  const { intent, images, userText } = request;

  // Resolve the prompt based on intent
  let promptResolution: PromptResolution;
  try {
    promptResolution = promptRegistry.resolve({
      intentId: intent.id,
      userText,
      promptParams: intent.promptParams,
    });
  } catch (_error) {
    // Fallback to general image if handler not found
    promptResolution = promptRegistry.resolve({
      intentId: "general-image",
      userText,
    });
  }

  // Build the prompt with system message and user message containing images + text
  const systemMessage = {
    role: "system" as const,
    content: promptResolution.system,
  };

  // Build user message with images and user text
  const userContent: UserContent[] = [
    ...(imagesToContentParts(images) as UserContent[]),
    { type: "text", text: promptResolution.user },
  ];

  const userMessage: LanguageModelV3Prompt[0] = {
    role: "user",
    content: userContent,
  };

  return [systemMessage, userMessage];
}

/**
 * Build a minimal vision prompt for multi-image comparison
 *
 * For comparison tasks, we may want to pass multiple images in a single prompt.
 */
export function buildMultiImageVisionPrompt(
  images: VisionImage[],
  userText: string,
  promptRegistry: PromptRegistry
): LanguageModelV3Prompt {
  const promptResolution = promptRegistry.resolve({
    intentId: "ui-diff",
    userText,
  });

  const systemMessage = {
    role: "system" as const,
    content: promptResolution.system,
  };

  // Include all images in a single user message
  const userContent: UserContent[] = [
    ...(imagesToContentParts(images) as UserContent[]),
    { type: "text", text: promptResolution.user || userText },
  ];

  const userMessage: LanguageModelV3Prompt[0] = {
    role: "user",
    content: userContent,
  };

  return [systemMessage, userMessage];
}
