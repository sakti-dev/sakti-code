/**
 * Observational Memory Reflector.
 *
 * Ports Mastra's ReflectorRunner to sakti's @sakti-code/llm complete()
 * one-shot. Compresses active observations when they exceed the reflection
 * threshold, escalating compression guidance until the result fits.
 */

import { complete } from "@sakti-code/llm";
import type { ObservationalMemoryDeps } from "./config.ts";
import {
  buildReflectorPrompt,
  MAX_COMPRESSION_LEVEL,
  parseReflectorOutput,
  type CompressionLevel,
} from "./prompts.ts";

export interface ReflectorInput {
  readonly observations: string;
  readonly deps: ObservationalMemoryDeps;
  readonly abortSignal?: AbortSignal;
}

export interface ReflectorResult {
  readonly reflection: string;
  readonly tokenCount: number;
  readonly compressionLevel: number;
}

export class ReflectionError extends Error {
  readonly _tag = "ReflectionError";
  constructor(message: string) {
    super(message);
    this.name = "ReflectionError";
  }
}

function validateCompression(reflectedTokens: number, reflectionThreshold: number): boolean {
  return reflectedTokens <= reflectionThreshold;
}

/**
 * Run the Reflector over active observations, escalating compression until
 * the reflected output fits within the reflection threshold or the level cap
 * is reached.
 */
export async function runReflector(input: ReflectorInput): Promise<ReflectorResult> {
  const { observations, deps, abortSignal } = input;
  const reflectionThreshold = deps.thresholds.reflection;

  let level: CompressionLevel = 0;
  let lastResult: ReflectorResult | undefined;

  while (true) {
    const prompt = buildReflectorPrompt(observations, undefined, level);

    const result = await complete({
      model: deps.reflectModel,
      apiKey: deps.reflectApiKey,
      messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
      ...(deps.reflectThinkingLevel === undefined
        ? {}
        : { thinkingLevel: deps.reflectThinkingLevel }),
      ...(abortSignal ? { abortSignal } : {}),
    });

    if (result.finishReason === "error") {
      throw new ReflectionError(result.errorMessage ?? "Reflector completion failed");
    }

    const rawText = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    const parsed = parseReflectorOutput(rawText);

    if (parsed.degenerate) {
      // Degenerate output — escalate compression and retry.
      if (level >= MAX_COMPRESSION_LEVEL) {
        // Cap reached; return whatever we have (may be empty).
        return {
          reflection: parsed.observations,
          tokenCount: deps.tokenCounter.countObservations(parsed.observations),
          compressionLevel: level,
        };
      }
      level =
        ((level + 1) as CompressionLevel) <= MAX_COMPRESSION_LEVEL
          ? ((level + 1) as CompressionLevel)
          : MAX_COMPRESSION_LEVEL;
      continue;
    }

    const reflection = parsed.observations;
    const tokenCount = deps.tokenCounter.countObservations(reflection);
    lastResult = { reflection, tokenCount, compressionLevel: level };

    if (validateCompression(tokenCount, reflectionThreshold) || level >= MAX_COMPRESSION_LEVEL) {
      return lastResult;
    }

    level =
      ((level + 1) as CompressionLevel) <= MAX_COMPRESSION_LEVEL
        ? ((level + 1) as CompressionLevel)
        : MAX_COMPRESSION_LEVEL;
  }
}
