import type { StreamRequest } from "@sakti-code/llm";
import type { Logger } from "@sakti-code/logger";

/**
 * # Harness → stream() request builder
 *
 * The {@link AgentHarness} wraps the agent loop's `StreamFn` to inject
 * harness-owned concerns (sessionId from session metadata, api-key/header
 * overrides from auth + `before_provider_request` hooks, and the stream
 * logger). This pure function builds the final {@link StreamRequest} passed to
 * `@sakti-code/llm`'s `stream()`.
 *
 * ## Why this is extracted
 *
 * `AgentHarness.createStreamFn` used to cherry-pick fields and silently dropped
 * `maxOutputTokens`, `toolChoice`, `temperature`, and `topP`. That made the
 * agent loop's `maxOutputTokens: model.maxTokens` ineffective on the production
 * (server) path — the provider fell back to its default output cap. Extracting
 * the construction to a pure function makes the full forwarding contract
 * unit-testable (the harness's `testStreamFn` injection point short-circuits
 * before this construction, so it cannot cover this path).
 *
 * ## Caller responsibilities
 *
 * The caller resolves the effective api key (`auth.apiKey ?? req.apiKey`) and
 * the hook-merged headers before calling. This function only forwards.
 */
export function buildHarnessStreamRequest(
  req: StreamRequest,
  opts: {
    /** Hook-merged headers (turn-state + auth + caller). */
    headers?: Record<string, string>;
    /** Stream logger (falls back to the agent logger at the caller). */
    logger?: Logger;
    /** Session id from session metadata — always injected. */
    sessionId: string;
    /** Auth-resolved api key. Wins over the loop's `req.apiKey`. */
    apiKey?: string;
  }
): StreamRequest {
  const apiKey = opts.apiKey ?? req.apiKey;
  return {
    model: req.model,
    messages: req.messages,
    sessionId: opts.sessionId,
    ...(req.system ? { system: req.system } : {}),
    ...(req.tools ? { tools: req.tools } : {}),
    ...(req.thinkingLevel ? { thinkingLevel: req.thinkingLevel } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(opts.headers ? { headers: opts.headers } : {}),
    ...(req.maxOutputTokens ? { maxOutputTokens: req.maxOutputTokens } : {}),
    ...(req.toolChoice ? { toolChoice: req.toolChoice } : {}),
    ...(req.baseURL ? { baseURL: req.baseURL } : {}),
    ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
    ...(req.topP === undefined ? {} : { topP: req.topP }),
    ...(req.abortSignal ? { abortSignal: req.abortSignal } : {}),
    ...(opts.logger === undefined ? {} : { logger: opts.logger }),
  };
}
