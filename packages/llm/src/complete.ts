/**
 * # Non-streaming completion
 *
 * Wraps @ai-sdk's `generateText` for compaction and other one-shot completions.
 * Mirrors {@link stream} but resolves to a full result instead of a stream.
 *
 * ## Testability
 *
 * `completeWithModel` takes a pre-resolved LanguageModelV3 + injectable
 * generateText runner, so tests verify result-mapping without real API calls.
 */

import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { FinishReason, LanguageModelUsage } from "ai";
import { generateText as aiGenerateText } from "ai";
import { calculateCost } from "./cost.ts";
import { toModelMessages } from "./messages.ts";
import { resolveLanguageModel } from "./provider/resolve.ts";
import { buildHeaders, buildProviderOptions } from "./provider/transform.ts";
import { mapFinishReason } from "./stream.ts";
import type {
  Message,
  Model,
  ModelThinkingLevel,
  StopReason,
  TextContent,
  Usage,
} from "./types.ts";

// ─── types ───────────────────────────────────────────────────────────────────

/** Request parameters for a non-streaming LLM completion. */
export interface CompleteRequest {
  abortSignal?: AbortSignal;
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  maxOutputTokens?: number;
  messages: Message[];
  model: Model;
  sessionId?: string;
  system?: string;
  thinkingLevel?: ModelThinkingLevel;
}

/** Simplified completion result. */
export interface CompleteResult {
  content: TextContent[];
  errorMessage?: string;
  finishReason: StopReason;
  usage: Usage;
}

/** Minimal generateText return shape we consume. */
interface GenerateTextResultLike {
  finishReason: FinishReason;
  text: string;
  usage: LanguageModelUsage;
}

/** Injectable generateText runner (for tests). */
type RunGenerateText = (
  options: Record<string, unknown>
) => Promise<GenerateTextResultLike>;

// ─── main entry point ────────────────────────────────────────────────────────

/**
 * Start a non-streaming LLM completion.
 *
 * Errors (provider failures, aborts) are caught and returned as
 * `{ finishReason: "error", errorMessage }` — never thrown.
 */
export async function complete(
  req: CompleteRequest,
  runGenerateText?: RunGenerateText
): Promise<CompleteResult> {
  const language = await resolveLanguageModel(req.model, {
    ...(req.apiKey ? { apiKey: req.apiKey } : {}),
    ...(req.baseURL ? { baseURL: req.baseURL } : {}),
    ...(req.headers ? { headers: req.headers } : {}),
  });
  return completeWithModel(req, language, runGenerateText);
}

/**
 * Complete with a pre-resolved `LanguageModelV3`. Exported for tests.
 */
export async function completeWithModel(
  req: CompleteRequest,
  language: LanguageModelV3,
  runGenerateText?: RunGenerateText
): Promise<CompleteResult> {
  const providerOptions = buildProviderOptions({
    level: req.thinkingLevel ?? "off",
    model: req.model,
  });

  const sessionHeaders = buildHeaders({
    model: req.model,
    ...(req.sessionId ? { sessionId: req.sessionId } : {}),
  });

  const mergedHeaders = { ...sessionHeaders, ...req.headers };

  const runner =
    runGenerateText ?? (aiGenerateText as unknown as RunGenerateText);

  try {
    const raw = await runner({
      ...(mergedHeaders ? { headers: mergedHeaders } : {}),
      maxRetries: 0,
      messages: toModelMessages(req.messages),
      model: language,
      ...(providerOptions && Object.keys(providerOptions).length > 0
        ? { providerOptions }
        : {}),
      ...(req.abortSignal ? { abortSignal: req.abortSignal } : {}),
      ...(req.maxOutputTokens ? { maxOutputTokens: req.maxOutputTokens } : {}),
      ...(req.system ? { system: req.system } : {}),
    });

    return {
      content: [{ type: "text", text: raw.text }],
      finishReason: mapFinishReason(raw.finishReason),
      usage: mapCompleteUsage(raw.usage, req.model),
    };
  } catch (error) {
    // Abort or provider failure — return as error result, never throw.
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [],
      errorMessage: message,
      finishReason: "error",
      usage: emptyUsage(),
    };
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Map @ai-sdk's LanguageModelUsage to our Usage + populate cost. */
function mapCompleteUsage(raw: LanguageModelUsage, model: Model): Usage {
  const usage: Usage = {
    cacheRead: raw.inputTokenDetails.cacheReadTokens ?? 0,
    cacheWrite: raw.inputTokenDetails.cacheWriteTokens ?? 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: raw.inputTokens ?? 0,
    output: raw.outputTokens ?? 0,
    totalTokens:
      raw.totalTokens ?? (raw.inputTokens ?? 0) + (raw.outputTokens ?? 0),
  };
  calculateCost(model, usage);
  return usage;
}

function emptyUsage(): Usage {
  return {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: 0,
    output: 0,
    totalTokens: 0,
  };
}
