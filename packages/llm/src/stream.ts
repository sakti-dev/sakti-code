import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { Logger } from "@sakti-code/logger";
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
  /** Optional logger — when set, stream errors/finish are logged (surfaces provider failures like "Upstream request failed"). Omit to keep zero overhead. */
  logger?: Logger;
  /** Max output tokens. */
  maxOutputTokens?: number;
  /** Conversation history (our Message type, converted to @ai-sdk format). */
  messages: Message[];
  /** The model descriptor from the catalog. */
  model: Model;
  /** Session id (for session-affinity header providers + OpenAI prompt cache key). */
  sessionId?: string;
  /** System prompt (passed to streamText separately, not as a message). */
  system?: string;
  /** Temperature. */
  temperature?: number;
  /** Thinking level — drives buildProviderOptions. */
  thinkingLevel?: ModelThinkingLevel;
  /**
   * Force tool choice: `"none"` = no tools, `"auto"` = model decides,
   * `"required"` = must call one. opencode forces `"none"` on the last agent
   * step so the model emits a final answer instead of another tool call.
   */
  toolChoice?: "auto" | "none" | "required";
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
 * OpenAI session-id format (`ses_` + 64 hex). When a session id matches, the
 * `ses_` prefix is stripped for use as `promptCacheKey` (matches opencode's
 * derivation in `session/runner/llm.ts`). Top-level so it isn't re-compiled
 * per call.
 */
const OPENAI_SESSION_ID_PATTERN = /^ses_[0-9a-f]{64}$/;

/**
 * Derive a stable per-session OpenAI prompt-cache key. Strips the `ses_`
 * prefix from a 64-hex session id; returns other ids verbatim; returns
 * `undefined` when no session id is set (caller omits the hint entirely).
 */
function promptCacheKeyFor(sessionId: string | undefined): string | undefined {
  if (sessionId === undefined) {
    return;
  }
  return OPENAI_SESSION_ID_PATTERN.test(sessionId)
    ? sessionId.slice(4)
    : sessionId;
}

/**
 * Map @ai-sdk's `LanguageModelUsage` to our `Usage` and populate cost.
 *
 * @ai-sdk uses nested `inputTokenDetails` / `outputTokenDetails`; we use flat
 * fields. `undefined` values default to 0. Cost is populated in-place via
 * {@link calculateCost}.
 *
 * **Non-cached input (B1):** `raw.inputTokens` is the INCLUSIVE total (it
 * includes cached reads/writes). {@link calculateCost} prices `usage.input`
 * at the input rate AND charges `cacheRead`/`cacheWrite` separately, so
 * feeding the inclusive total would double-count cached tokens. We use
 * `inputTokenDetails.noCacheTokens` (the non-cached subset) when the provider
 * reports the breakdown, falling back to `inputTokens` for providers that
 * don't. This matches @opencode-ai/llm's `Usage` contract invariant:
 * `nonCachedInput + cacheRead + cacheWrite = inputTokens`.
 */
export function mapUsage(raw: LanguageModelUsage, model: Model): Usage {
  const noCache = raw.inputTokenDetails.noCacheTokens;
  // outputTokenDetails.reasoningTokens is the non-deprecated path; the
  // top-level reasoningTokens is @ai-sdk's deprecated alias (still emitted).
  // Matches @opencode-ai/llm's ai-sdk bridge fallback.
  const reasoningTokens =
    raw.outputTokenDetails.reasoningTokens ?? raw.reasoningTokens;
  const usage: Usage = {
    cacheRead: raw.inputTokenDetails.cacheReadTokens ?? 0,
    cacheWrite: raw.inputTokenDetails.cacheWriteTokens ?? 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    // noCacheTokens is the non-cached subset; fall back to the inclusive
    // total when the provider doesn't report the breakdown.
    input: noCache ?? raw.inputTokens ?? 0,
    output: raw.outputTokens ?? 0,
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
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
  const reasoningOptions = buildProviderOptions({
    level: req.thinkingLevel ?? "off",
    model: req.model,
  });

  // Hint the OpenAI prompt cache with a stable per-session key so cached
  // prefixes reuse across turns. opencode derives this from session.id
  // (stripping a `ses_<64hex>` prefix); we mirror that. No-op for providers
  // that don't read providerOptions.openai.promptCacheKey.
  const promptCacheKey = promptCacheKeyFor(req.sessionId);
  const providerOptions =
    promptCacheKey === undefined
      ? reasoningOptions
      : {
          ...reasoningOptions,
          openai: {
            ...(reasoningOptions.openai as object | undefined),
            promptCacheKey,
          },
        };

  const sessionHeaders = buildHeaders({
    model: req.model,
    ...(req.sessionId ? { sessionId: req.sessionId } : {}),
  });

  const mergedHeaders = mergeRequestHeaders(sessionHeaders, req.headers);

  const runner = runStreamText ?? (aiStreamText as unknown as RunStreamText);

  req.logger?.debug("stream request", {
    apiKey: req.apiKey,
    baseURL: req.model.baseUrl,
    hasApiKey: req.apiKey !== undefined,
    headerKeys: mergedHeaders ? Object.keys(mergedHeaders) : [],
    maxOutputTokens: req.maxOutputTokens,
    messageCount: req.messages.length,
    model: req.model.id,
    provider: req.model.provider,
    thinkingLevel: req.thinkingLevel ?? "off",
    toolCount: req.tools ? Object.keys(req.tools).length : 0,
  });

  const raw = runner({
    ...(mergedHeaders ? { headers: mergedHeaders } : {}),
    maxRetries: 0,
    // Pass the target model so reasoning signatures are only forwarded when
    // they were produced by the same model (cross-model guard, B4).
    messages: toModelMessages(req.messages, {
      ...(req.model.id ? { targetModel: req.model.id } : {}),
    }),
    model: language,
    ...(providerOptions && Object.keys(providerOptions).length > 0
      ? { providerOptions }
      : {}),
    ...(req.abortSignal ? { abortSignal: req.abortSignal } : {}),
    ...(req.maxOutputTokens ? { maxOutputTokens: req.maxOutputTokens } : {}),
    ...(req.system ? { system: req.system } : {}),
    ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
    ...(req.tools ? { tools: req.tools } : {}),
    ...(req.toolChoice ? { toolChoice: req.toolChoice } : {}),
    ...(req.topP === undefined ? {} : { topP: req.topP }),
  });

  return {
    fullStream:
      req.logger === undefined
        ? raw.fullStream
        : logStream(raw.fullStream, req.logger, req.model),
    result: mapStreamResult(req.model, raw, req.logger),
  };
}

/**
 * Pass-through wrapper that logs each stream `error` part with the full error
 * object + model/provider/baseURL context, then yields the part unchanged so
 * the agent loop still sees it. This is the layer that surfaces previously
 * silent provider failures (e.g. `"Upstream request failed"`) into `llm.log`.
 */
async function* logStream(
  inner: AsyncIterable<unknown>,
  logger: Logger,
  model: Model
): AsyncIterable<unknown> {
  for await (const part of inner) {
    if (
      typeof part === "object" &&
      part !== null &&
      (part as { type?: string }).type === "error"
    ) {
      logger.error("stream error", (part as { error?: unknown }).error, {
        baseURL: model.baseUrl,
        model: model.id,
        provider: model.provider,
      });
    }
    yield part;
  }
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
  raw: StreamTextStream,
  logger?: Logger
): Promise<FinishResult> {
  return (async () => {
    const [usage, finishReason, response] = await Promise.all([
      raw.usage,
      raw.finishReason,
      raw.response,
    ]);
    const mappedUsage = mapUsage(usage, model);
    // Log the RAW provider usage alongside our mapped view so a "stop with 0
    // tokens" outcome is immediately diagnosable: if raw shows outputTokens>0
    // but mapped is 0, our mapping is at fault; if raw is 0, the provider
    // genuinely returned an empty completion (quota/rate-limit/empty body).
    logger?.debug("stream finish", {
      baseURL: model.baseUrl,
      finishReason,
      model: model.id,
      provider: model.provider,
      rawUsage: usage,
      usage: mappedUsage,
    });
    return {
      finishReason: mapFinishReason(finishReason),
      usage: mappedUsage,
      ...(response.id ? { responseId: response.id } : {}),
      ...(response.modelId ? { responseModel: response.modelId } : {}),
    };
  })();
}
