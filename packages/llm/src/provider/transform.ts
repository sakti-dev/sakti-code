import type {
  ChatTemplateKwargValue,
  Model,
  ModelThinkingLevel,
  OpenAICompletionsCompat,
  ThinkingLevel,
} from "../types.ts";

/**
 * # Provider options transform
 *
 * Turns a {@link Model}'s `compat.thinkingFormat` + the requested thinking
 * level into the `providerOptions` object that `streamText` sends to the
 * `@ai-sdk/openai-compatible` factory. The factory reads
 * `providerOptions[providerName]` and merges those fields into the request body.
 *
 * ## What's ported
 *
 * The 10-branch `thinkingFormat` dispatch is a verbatim port of pi-ai's
 * `openai-completions.ts:594-668`. Each format has its own function (annotated
 * with the source line range) so the logic is independently readable. The
 * `chat-template` kwarg resolver ports pi-ai's `resolveChatTemplateKwargValue`
 * (`:706-725`).
 *
 * ## Who reaches this code
 *
 * Only `@ai-sdk/openai-compatible` models (those carrying `model.compat`).
 * First-party `@ai-sdk/*` factories (anthropic, openai, google, …) handle
 * reasoning internally and have no `compat` — `buildProviderOptions` returns
 * `{}` for them.
 *
 * ## `null` in thinkingLevelMap
 *
 * A `null` value in the map marks a level as **unsupported**. Each format
 * handles `null` per pi-ai's per-format semantics — some suppress the effort
 * field (`typeof effort === "string"` guard), others fall back to the raw
 * level (`??` operator). This per-format inconsistency is preserved exactly.
 */

/** A resolved chat-template kwarg value (primitives only, no `$var` objects). */
type ResolvedKwargValue = string | number | boolean | null;

/**
 * Build the `providerOptions` object for a stream request.
 *
 * Returns `{ [model.provider]: { ...formatFields } }` — the flat thinkingFormat
 * fields scoped under the provider name. Returns `{}` when no reasoning params
 * apply (first-party provider, non-reasoning model, or a level the model
 * doesn't support).
 *
 * @param input.model - must carry `compat` (only openai-compatible models do)
 * @param input.level - the runtime thinking level ("off" to disable reasoning)
 */
export function buildProviderOptions(input: {
  level: ModelThinkingLevel;
  model: Model;
}): Record<string, unknown> {
  const { level, model } = input;

  if (!(model.compat && model.reasoning)) {
    return {};
  }

  const reasoningEffort: ThinkingLevel | undefined =
    level === "off" ? undefined : level;
  const format = compatThinkingFormat(model.compat);

  const params = buildReasoningParams(
    model,
    reasoningEffort,
    format,
    model.compat
  );

  if (Object.keys(params).length === 0) {
    return {};
  }
  return { [model.provider]: params };
}

/** Extract the thinkingFormat from compat, defaulting to "openai". */
function compatThinkingFormat(
  compat: OpenAICompletionsCompat
): NonNullable<OpenAICompletionsCompat["thinkingFormat"]> {
  return compat.thinkingFormat ?? "openai";
}

/**
 * Dispatch to the per-format builder. Each case returns the flat params object;
 * the switch itself has no nested logic, keeping cognitive complexity low.
 */
function buildReasoningParams(
  model: Model,
  reasoningEffort: ThinkingLevel | undefined,
  format: NonNullable<OpenAICompletionsCompat["thinkingFormat"]>,
  compat: OpenAICompletionsCompat
): Record<string, unknown> {
  switch (format) {
    case "zai":
      return zaiParams(model, reasoningEffort, compat);
    case "qwen":
      return { enable_thinking: !!reasoningEffort };
    case "qwen-chat-template":
      return {
        chat_template_kwargs: {
          enable_thinking: !!reasoningEffort,
          preserve_thinking: true,
        },
      };
    case "chat-template":
      return chatTemplateParams(model, reasoningEffort, compat);
    case "deepseek":
      return deepseekParams(model, reasoningEffort, compat);
    case "openrouter":
      return openrouterParams(model, reasoningEffort);
    case "ant-ling":
      return antLingParams(model, reasoningEffort);
    case "together":
      return togetherParams(model, reasoningEffort, compat);
    case "string-thinking":
      return stringThinkingParams(model, reasoningEffort);
    default:
      return openaiParams(model, reasoningEffort, compat);
  }
}

/** Resolve a level through thinkingLevelMap; undefined → raw level, null → null. */
function resolveEffort(model: Model, level: ThinkingLevel): string | null {
  const mapped = model.thinkingLevelMap?.[level];
  return mapped === undefined ? level : mapped;
}

// ─── per-format builders (each annotated with pi-ai source line range) ───────

/** pi-ai :594-606 — `thinking: { type }` + conditional `reasoning_effort`. */
function zaiParams(
  model: Model,
  reasoningEffort: ThinkingLevel | undefined,
  compat: OpenAICompletionsCompat
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    thinking: { type: reasoningEffort ? "enabled" : "disabled" },
  };
  if (reasoningEffort && compat.supportsReasoningEffort) {
    const effort = resolveEffort(model, reasoningEffort);
    if (typeof effort === "string") {
      params.reasoning_effort = effort;
    }
  }
  return params;
}

/** pi-ai :619-628 — `thinking: { type }` + conditional `reasoning_effort`. */
function deepseekParams(
  model: Model,
  reasoningEffort: ThinkingLevel | undefined,
  compat: OpenAICompletionsCompat
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (reasoningEffort) {
    params.thinking = { type: "enabled" };
  } else if (model.thinkingLevelMap?.off !== null) {
    params.thinking = { type: "disabled" };
  }
  if (reasoningEffort && compat.supportsReasoningEffort) {
    const effort = resolveEffort(model, reasoningEffort);
    if (typeof effort === "string") {
      params.reasoning_effort = effort;
    }
  }
  return params;
}

/** pi-ai :629-638 — `reasoning: { effort }`. Null map entries fall back to raw level (?? operator). */
function openrouterParams(
  model: Model,
  reasoningEffort: ThinkingLevel | undefined
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (reasoningEffort) {
    params.reasoning = {
      effort: model.thinkingLevelMap?.[reasoningEffort] ?? reasoningEffort,
    };
  } else if (model.thinkingLevelMap?.off !== null) {
    params.reasoning = { effort: model.thinkingLevelMap?.off ?? "none" };
  }
  return params;
}

/** pi-ai :639-643 — `reasoning: { effort }` ONLY when effort maps to a non-null string. */
function antLingParams(
  model: Model,
  reasoningEffort: ThinkingLevel | undefined
): Record<string, unknown> {
  if (!reasoningEffort) {
    return {};
  }
  const effort = model.thinkingLevelMap?.[reasoningEffort];
  return typeof effort === "string" ? { reasoning: { effort } } : {};
}

/** pi-ai :644-652 — `reasoning: { enabled }` toggle + conditional `reasoning_effort`. */
function togetherParams(
  model: Model,
  reasoningEffort: ThinkingLevel | undefined,
  compat: OpenAICompletionsCompat
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    reasoning: { enabled: !!reasoningEffort },
  };
  if (reasoningEffort && compat.supportsReasoningEffort) {
    const effort = resolveEffort(model, reasoningEffort);
    if (typeof effort === "string") {
      params.reasoning_effort = effort;
    }
  }
  return params;
}

/** pi-ai :653-659 — top-level `thinking: string`. */
function stringThinkingParams(
  model: Model,
  reasoningEffort: ThinkingLevel | undefined
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (reasoningEffort) {
    params.thinking =
      model.thinkingLevelMap?.[reasoningEffort] ?? reasoningEffort;
  } else if (model.thinkingLevelMap?.off !== null) {
    params.thinking = model.thinkingLevelMap?.off ?? "none";
  }
  return params;
}

/** pi-ai :660-667 — default `reasoning_effort` (the OpenAI convention). */
function openaiParams(
  model: Model,
  reasoningEffort: ThinkingLevel | undefined,
  compat: OpenAICompletionsCompat
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (reasoningEffort && compat.supportsReasoningEffort) {
    const effort = resolveEffort(model, reasoningEffort);
    if (typeof effort === "string") {
      params.reasoning_effort = effort;
    }
  } else if (!reasoningEffort && compat.supportsReasoningEffort) {
    const offValue = model.thinkingLevelMap?.off;
    if (typeof offValue === "string") {
      params.reasoning_effort = offValue;
    }
  }
  return params;
}

/** pi-ai :614-618, 689-725 — configurable chat_template_kwargs with $var resolution. */
function chatTemplateParams(
  model: Model,
  reasoningEffort: ThinkingLevel | undefined,
  compat: OpenAICompletionsCompat
): Record<string, unknown> {
  const kwargs = buildChatTemplateKwargs(model, reasoningEffort, compat);
  if (!kwargs || Object.keys(kwargs).length === 0) {
    return {};
  }
  return { chat_template_kwargs: kwargs };
}

// ─── chat-template kwarg resolution (pi-ai :689-725) ─────────────────────────

/**
 * Build the `chat_template_kwargs` object from `compat.chatTemplateKwargs`,
 * resolving `{ $var }` placeholders against the current thinking state.
 *
 * Returns `undefined` when no kwargs are configured or all resolve to undefined.
 */
function buildChatTemplateKwargs(
  model: Model,
  reasoningEffort: ThinkingLevel | undefined,
  compat: OpenAICompletionsCompat
): Record<string, ResolvedKwargValue> | undefined {
  if (!compat.chatTemplateKwargs) {
    return;
  }

  const kwargs: Record<string, ResolvedKwargValue> = {};
  for (const [key, value] of Object.entries(compat.chatTemplateKwargs)) {
    const resolved = resolveChatTemplateKwargValue(
      model,
      reasoningEffort,
      value
    );
    if (resolved !== undefined) {
      kwargs[key] = resolved;
    }
  }

  return Object.keys(kwargs).length > 0 ? kwargs : undefined;
}

/**
 * Resolve a single chat-template kwarg value (pi-ai :706-725).
 *
 * - Primitives (string/number/boolean/null) pass through unchanged.
 * - `{ $var: "thinking.enabled" }` → `!!reasoningEffort` (boolean).
 * - `{ $var: "thinking.effort" }` → the mapped effort string, or the raw level.
 * - `{ $var, omitWhenOff: true }` → omitted entirely when reasoning is off.
 */
function resolveChatTemplateKwargValue(
  model: Model,
  reasoningEffort: ThinkingLevel | undefined,
  value: ChatTemplateKwargValue
): ResolvedKwargValue | undefined {
  // Primitives pass through (null is typeof "object" in JS, hence the null check).
  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (!reasoningEffort && value.omitWhenOff) {
    return;
  }

  if (value.$var === "thinking.enabled") {
    return !!reasoningEffort;
  }

  // $var === "thinking.effort"
  return resolveEffortKwarg(model, reasoningEffort);
}

/** Resolve a `thinking.effort` kwarg to its string value (no nested ternary). */
function resolveEffortKwarg(
  model: Model,
  reasoningEffort: ThinkingLevel | undefined
): string | undefined {
  const mappedValue = reasoningEffort
    ? model.thinkingLevelMap?.[reasoningEffort]
    : model.thinkingLevelMap?.off;
  if (mappedValue === undefined) {
    return reasoningEffort;
  }
  if (typeof mappedValue === "string") {
    return mappedValue;
  }
  return;
}

// ─── session-affinity headers (pi-ai openai-completions.ts) ──────────────────

/**
 * Build session-affinity HTTP headers for providers that use them.
 *
 * Some providers (Cloudflare Workers AI, Fireworks) use session-affinity
 * headers to route requests to the same replica, maximizing prompt cache
 * hits. When `compat.sendSessionAffinityHeaders` is true and a `sessionId`
 * is available, three headers carry the session id.
 *
 * Returns `undefined` when no headers apply — the caller skips the `headers`
 * field on the stream request entirely.
 *
 * Ported from pi-ai's session-affinity header block
 * (`api/openai-completions.ts`, `sendSessionAffinityHeaders` branch).
 *
 * @param input.model - carries `compat.sendSessionAffinityHeaders`
 * @param input.sessionId - the request's session id (from stream options)
 */
export function buildHeaders(input: {
  model: Model;
  sessionId?: string;
}): Record<string, string> | undefined {
  const { sessionId } = input;
  if (!sessionId) {
    return;
  }
  if (!input.model.compat?.sendSessionAffinityHeaders) {
    return;
  }

  return {
    session_id: sessionId,
    "x-client-request-id": sessionId,
    "x-session-affinity": sessionId,
  };
}
