/**
 * Prompt Injector
 *
 * Inject vision analysis results into prompts for the text model.
 */

import type { LanguageModelV3Prompt } from "@ai-sdk/provider";

/**
 * Inject vision analysis into a prompt
 *
 * This function takes a prompt with images (which have been stripped)
 * and injects the vision analysis results as a system message at the beginning.
 */
export function injectVisionAnalysis(args: {
  prompt: LanguageModelV3Prompt;
  analysis: string;
}): LanguageModelV3Prompt {
  const { prompt, analysis } = args;

  // Create the vision analysis message
  const visionMessage: LanguageModelV3Prompt[0] = {
    role: "system",
    content: `[Vision Analysis Result]\n\n${analysis}\n\nUse this vision analysis to inform your response to the user.`,
  };

  // Inject at the beginning, before all other messages
  return [visionMessage, ...prompt];
}

/**
 * Inject vision analysis into the last user message
 *
 * Alternative approach: append the analysis to the last user message
 * instead of creating a separate system message.
 */
export function injectVisionAnalysisInUserMessage(args: {
  prompt: LanguageModelV3Prompt;
  analysis: string;
}): LanguageModelV3Prompt {
  const { prompt, analysis } = args;

  // Find the last user message
  let lastUserMessageIndex = -1;
  for (let i = prompt.length - 1; i >= 0; i--) {
    if (prompt[i].role === "user") {
      lastUserMessageIndex = i;
      break;
    }
  }

  // If no user message found, inject as system message
  if (lastUserMessageIndex === -1) {
    return injectVisionAnalysis({ prompt, analysis });
  }

  // Clone the prompt to avoid mutation
  const newPrompt = [...prompt];
  const userMessage = newPrompt[lastUserMessageIndex];

  // Append vision analysis to the user message content
  const visionContent = `\n\n---\n\n[Image Analysis]\n${analysis}`;

  if (typeof userMessage.content === "string") {
    // Content is a string, append to it
    userMessage.content = userMessage.content + visionContent;
  } else if (userMessage.content.length === 0) {
    // Empty content array, add text part
    userMessage.content = [{ type: "text", text: visionContent }];
  } else {
    // Convert array content to string and append
    let text = "";
    for (const part of userMessage.content) {
      if (part.type === "text" && typeof part.text === "string") {
        text += part.text;
      }
    }
    userMessage.content = text + visionContent;
  }

  return newPrompt;
}

/**
 * Create a prompt with injected analysis and original query
 *
 * This is useful for the text model to understand both the vision analysis
 * and the user's original request.
 */
export function createHybridPrompt(args: {
  originalPrompt: LanguageModelV3Prompt;
  visionAnalysis: string;
}): LanguageModelV3Prompt {
  const { originalPrompt, visionAnalysis } = args;

  // Use the system message injection approach
  return injectVisionAnalysis({
    prompt: originalPrompt,
    analysis: visionAnalysis,
  });
}
