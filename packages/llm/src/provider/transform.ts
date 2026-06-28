import type {
  Model,
  ModelThinkingLevel,
  OpenAICompletionsCompat,
  ThinkingLevel,
} from "../types.ts";
import { ZAI_THINKING_BUDGETS } from "./zai-anthropic/thinking-budgets.ts";

/**
 * Matches Z.ai "fast-tier" model ids — turbo / flash / highspeed. Per
 * `zcode-glm-best-practices.md §9`, these pair with `speed:"fast"` for the
 * cheapest acceptable-quality turn.
 */
const TURBO_MODEL_PATTERN = /(turbo|flash|highspeed)/i;

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
 * The 3-branch `thinkingFormat` dispatch covers the formats the catalog
 * actually emits: `openai` (default), `zai`, and `deepseek`. Each format has
 * its own function so the logic is independently readable.
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

  // Hand-rolled Z.ai Anthropic provider: bypasses the OpenAI-compat
  // `compat.thinkingFormat` machinery and emits providerOptions.zai.thinking
  // directly. See docs/plans/2026-06-28-zai-anthropic-provider-design.md
  // §"Reasoning levels + providerOptions.zai transform".
  if (model.npm === "@sakti-code/zai-anthropic") {
    if (!model.reasoning) {
      return {};
    }
    // Per `zcode-glm-best-practices.md §9`: pair turbo/flash/highspeed
    // variants with `speed:"fast"` — the cheapest acceptable-quality path.
    if (TURBO_MODEL_PATTERN.test(model.id)) {
      return level === "off"
        ? {
            zai: {
              thinking: { type: "disabled" },
              speed: "fast",
            },
          }
        : {
            zai: {
              thinking: {
                type: "enabled",
                budget_tokens: ZAI_THINKING_BUDGETS[level],
              },
              speed: "fast",
            },
          };
    }
    if (level === "off") {
      return { zai: { thinking: { type: "disabled" } } };
    }
    return {
      zai: {
        thinking: {
          type: "enabled",
          budget_tokens: ZAI_THINKING_BUDGETS[level],
        },
      },
    };
  }

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
    case "deepseek":
      return deepseekParams(model, reasoningEffort, compat);
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
