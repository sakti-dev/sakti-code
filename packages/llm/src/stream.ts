import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { FinishReason, LanguageModelUsage } from "ai";
import { streamText as aiStreamText } from "ai";
import { calculateCost } from "./cost.ts";
import { toModelMessages } from "./messages.ts";
import { resolveLanguageModel } from "./provider/resolve.ts";
import { buildHeaders, buildProviderOptions } from "./provider/transform.ts";
import type {
  Message,
  Model,
  ModelThinkingLevel,
  StopReason,
  Usage,
} from "./types.ts";

/**
 * # Stream entry point
 *
 * The single function the agent loop calls. Wires together everything from
 * Phases 1–4:
 *
 * 1. **Resolve model** → `resolveLanguageModel` (Phase 2) gives a `LanguageModelV3`.
 * 2. **Convert messages** → `toModelMessages` (Phase 4 Task 4.1).
 * 3. **Build providerOptions** → `buildProviderOptions` (Phase 3) for reasoning.
 * 4. **Build headers** → `buildHeaders` (Phase 3) for session-affinity.
 * 5. **Call streamText** → @ai-sdk's `streamText` returns `{ fullStream, ... }`.
 * 6. **Map result** → `mapUsage` + `mapFinishReason` give our `FinishResult`.
 *
 * `stream()` is **async** because `resolveLanguageModel` does dynamic imports.
 * The agent loop (Phase 5) calls `const { fullStream, result } = await stream(req)`.
 *
 * ## Testability
 *
 * The `runStreamText` parameter injects the streamText implementation so tests
 * can verify result-mapping without real API calls. Production callers omit it
 * (defaults to @ai-sdk's `streamText`).
 */

// ─── types ───────────────────────────────────────────────────────────────────

/** Request parameters for a streaming LLM call. */
export interface StreamRequest {
  abortSignal?: AbortSignal;
  /** API key; wins over env resolution. */
  apiKey?: string;
  /** Override base URL; wins over `model.baseUrl`. */
  baseURL?: string;
  /** Extra HTTP headers (merged with session-affinity headers). */
  headers?: Record<string, string>;
  /** Max output tokens. */
  maxOutputTokens?: number;
  /**
   * Max SDK-level retry attempts on transient errors (429/500/503).
   * Default 0 (fail fast, matching pi-ai). @ai-sdk handles exponential
   * backoff internally when > 0.
   */
  maxRetries?: number;
  /** Conversation history (our Message type, converted to @ai-sdk format). */
  messages: Message[];
  /** The model descriptor from the catalog. */
  model: Model;
  /** Session id (for session-affinity header providers). */
  sessionId?: string;
  /** System prompt (passed to streamText separately, not as a message). */
  system?: string;
  /** Temperature. */
  temperature?: number;
  /** Thinking level — drives buildProviderOptions. */
  thinkingLevel?: ModelThinkingLevel;
  /** Tools (already in @ai-sdk tool format). */
  tools?: Record<string, unknown>;
  /** Top-p. */
  topP?: number;
}

/** Simplified finish result — our view of what streamText resolves. */
export interface FinishResult {
  finishReason: StopReason;
  responseId?: string;
  responseModel?: string;
  usage: Usage;
}

/** The return shape: a stream to iterate + a result promise to await. */
export interface StreamResult {
  /** @ai-sdk's fullStream — iterate to get text-delta/reasoning/tool-call/finish/error parts. */
  fullStream: AsyncIterable<unknown>;
  /** Resolves when the stream finishes with mapped usage/cost + finishReason. */
  result: Promise<FinishResult>;
}

/** Minimal shape of streamText's return that we consume. */
interface StreamTextStream {
  finishReason: PromiseLike<FinishReason>;
  fullStream: AsyncIterable<unknown>;
  response: PromiseLike<{ id?: string; modelId?: string }>;
  usage: PromiseLike<LanguageModelUsage>;
}

/** Injectable streamText runner (for tests). */
type RunStreamText = (options: Record<string, unknown>) => StreamTextStream;

// ─── pure mappers ────────────────────────────────────────────────────────────

/**
 * Map @ai-sdk's `LanguageModelUsage` to our `Usage` and populate cost.
 *
 * @ai-sdk uses nested `inputTokenDetails` / `outputTokenDetails`; we use flat
 * fields. `undefined` values default to 0. Cost is populated in-place via
 * {@link calculateCost}.
 */
export function mapUsage(raw: LanguageModelUsage, model: Model): Usage {
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

/**
 * Map @ai-sdk's `FinishReason` string to our `StopReason`.
 *
 * @ai-sdk has no `"aborted"` — caller-side abort shows up as `"error"` or a
 * stream error. `"content-filter"` and `"other"` map to `"stop"` (treated as
 * a natural stop from the agent's perspective).
 */
export function mapFinishReason(reason: FinishReason): StopReason {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool-calls":
      return "toolUse";
    case "error":
      return "error";
    default:
      // "content-filter" | "other" → natural stop
      return "stop";
  }
}

// ─── main entry point ────────────────────────────────────────────────────────

/**
 * Start a streaming LLM call.
 *
 * @param req - the request parameters
 * @param runStreamText - injectable streamText (tests only; defaults to @ai-sdk's)
 * @returns `{ fullStream, result }`
 */
export async function stream(
  req: StreamRequest,
  runStreamText?: RunStreamText
): Promise<StreamResult> {
  const language = await resolveLanguageModel(req.model, {
    ...(req.apiKey ? { apiKey: req.apiKey } : {}),
    ...(req.baseURL ? { baseURL: req.baseURL } : {}),
    ...(req.headers ? { headers: req.headers } : {}),
  });
  return streamWithModel(req, language, runStreamText);
}

/**
 * Stream with a pre-resolved `LanguageModelV3`. Exported for tests so they can
 * verify result-mapping + option-wiring without the async model resolution.
 *
 * Synchronous (streamText returns immediately with a lazy fullStream).
 */
export function streamWithModel(
  req: StreamRequest,
  language: LanguageModelV3,
  runStreamText?: RunStreamText
): StreamResult {
  const providerOptions = buildProviderOptions({
    level: req.thinkingLevel ?? "off",
    model: req.model,
  });

  const sessionHeaders = buildHeaders({
    model: req.model,
    ...(req.sessionId ? { sessionId: req.sessionId } : {}),
  });

  const mergedHeaders = mergeRequestHeaders(sessionHeaders, req.headers);

  const runner = runStreamText ?? (aiStreamText as unknown as RunStreamText);

  const raw = runner({
    ...(mergedHeaders ? { headers: mergedHeaders } : {}),
    maxRetries: req.maxRetries ?? 0,
    messages: toModelMessages(req.messages),
    model: language,
    ...(providerOptions && Object.keys(providerOptions).length > 0
      ? { providerOptions }
      : {}),
    ...(req.abortSignal ? { abortSignal: req.abortSignal } : {}),
    ...(req.maxOutputTokens ? { maxOutputTokens: req.maxOutputTokens } : {}),
    ...(req.system ? { system: req.system } : {}),
    ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
    ...(req.tools ? { tools: req.tools } : {}),
    ...(req.topP === undefined ? {} : { topP: req.topP }),
  });

  return {
    fullStream: raw.fullStream,
    result: mapStreamResult(req.model, raw),
  };
}

/** Merge session-affinity headers with caller headers (caller wins on conflict). */
function mergeRequestHeaders(
  session: Record<string, string> | undefined,
  caller: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!(session || caller)) {
    return;
  }
  return { ...session, ...caller };
}

/** Wire streamText's promises into our FinishResult (with cost via calculateCost). */
function mapStreamResult(
  model: Model,
  raw: StreamTextStream
): Promise<FinishResult> {
  return (async () => {
    const [usage, finishReason, response] = await Promise.all([
      raw.usage,
      raw.finishReason,
      raw.response,
    ]);
    return {
      finishReason: mapFinishReason(finishReason),
      usage: mapUsage(usage, model),
      ...(response.id ? { responseId: response.id } : {}),
      ...(response.modelId ? { responseModel: response.modelId } : {}),
    };
  })();
}
