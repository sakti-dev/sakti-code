/**
 * Reflector Agent - Phase 3 Reflection
 *
 * LLM agent that condenses observations while preserving temporal context and entity names.
 */

import type { LanguageModelV3 } from "@ai-sdk/provider";
import { generateText } from "ai";
import { COMPRESSION_GUIDANCE, REFLECTOR_SYSTEM_PROMPT } from "../../prompts/reflector";

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
