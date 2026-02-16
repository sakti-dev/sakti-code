/**
 * Reflector Agent - Phase 3 Reflection
 *
 * LLM agent that condenses observations while preserving temporal context and entity names.
 */

import type { LanguageModelV3 } from "@ai-sdk/provider";
import { generateText } from "ai";

export interface ReflectorInput {
  activeObservations: string;
  compressionPrompt?: string;
}

export interface ReflectorOutput {
  observations: string;
  currentTask?: string;
  suggestedResponse?: string;
  tokenCount: number;
}

const REFLECTOR_SYSTEM_PROMPT =
  "You are memory consciousness of an AI coding assistant. Your task is to reflect on observations and create a more compact summary.\n\n" +
  "IMPORTANT: Your reflections will be THE ENTIRETY of the assistant's memory. Any information you do not add will be immediately forgotten. Make sure you do not leave out anything. Your reflections must assume the assistant knows nothing - your reflections are the ENTIRE memory system.\n\n" +
  "When consolidating:\n" +
  "- Preserve dates/timestamps\n" +
  "- Group related items by feature\n" +
  "- Combine similar work\n" +
  "- Keep key identifiers (file paths, function names, etc.)\n" +
  "- Prioritize active work over questions\n\n" +
  "Your output should be in this format:\n\n" +
  "<observations>\n" +
  "Date: YYYY-MM-DD\n\n" +
  "High Priority (Active/Critical)\n" +
  "* Feature 1: Implementation details...\n\n" +
  "Medium Priority (In Progress/Pending)\n" +
  "* Feature 2: Implementation details...\n\n" +
  "Low Priority (Completed/Background)\n" +
  "* Feature 3: Implementation details...\n" +
  "</observations>\n\n" +
  "<current-task>Current task: [Description]</current-task>\n\n" +
  "<suggested-response>What the assistant should do next.</suggested-response>";

const COMPRESSION_GUIDANCE: Record<number, string> = {
  0: "",
  1:
    "COMPRESSION REQUIRED\n\n" +
    "Your previous reflection was the same size or larger than the original observations.\n\n" +
    "Please re-process with slightly more compression:\n" +
    "- Condense more observations into high-level summaries\n" +
    "- Keep only key details for recent work",
  2:
    "AGGRESSIVE COMPRESSION REQUIRED\n\n" +
    "Your previous reflection was still too large after compression guidance.\n\n" +
    "Please re-process with much more aggressive compression:\n" +
    "- Heavily condense everything into feature summaries\n" +
    "- Keep minimal details - only feature names and major decisions",
};

export async function callReflectorAgent(
  input: ReflectorInput,
  model: LanguageModelV3,
  timeoutMs: number = 30000
): Promise<ReflectorOutput> {
  const { activeObservations, compressionPrompt } = input;

  const systemPrompt = REFLECTOR_SYSTEM_PROMPT + (compressionPrompt ?? "");

  const userPrompt =
    "Existing observations:\n" +
    activeObservations +
    "\n\n" +
    "Please reflect and consolidate these observations into a more compact form.";

  const result = await Promise.race([
    generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      timeout: timeoutMs,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Reflector timeout")), timeoutMs)
    ),
  ]);

  const text = result.text;
  const output = parseReflectorOutput(text);

  const tokenCount = result.usage?.totalTokens ?? 0;

  return {
    observations: output.observations,
    currentTask: output.currentTask,
    suggestedResponse: output.suggestedResponse,
    tokenCount,
  };
}

function parseReflectorOutput(text: string): Omit<ReflectorOutput, "tokenCount"> {
  const observationsMatch = text.match(/<observations>([\s\S]*?)<\/observations>/);
  const currentTaskMatch = text.match(/<current-task>([\s\S]*?)<\/current-task>/);
  const suggestedResponseMatch = text.match(/<suggested-response>([\s\S]*?)<\/suggested-response>/);

  return {
    observations: observationsMatch?.[1]?.trim() ?? text,
    currentTask: currentTaskMatch?.[1]?.trim(),
    suggestedResponse: suggestedResponseMatch?.[1]?.trim(),
  };
}

export { COMPRESSION_GUIDANCE };
