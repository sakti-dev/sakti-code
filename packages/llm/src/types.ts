/**
 * # `@sakti-code/llm` — message contract + model descriptor
 *
 * This module is the single source of truth for the data shapes that flow
 * through the agent ↔ llm ↔ server ↔ UI stack. It is the @ai-sdk-native
 * successor to `@earendil-works/pi-ai`'s `types.ts`.
 *
 * ## What survived the pivot (and what didn't)
 *
 * Ported from pi-ai and kept stable so the ~20 existing consumers (agent loop,
 * DB hydration, compaction, server replay, UI reducers) keep working:
 * - Content blocks: `TextContent`, `ThinkingContent`, `ImageContent`, `ToolCall`
 * - Messages: `UserMessage`, `AssistantMessage`, `ToolResultMessage`, `Message`
 * - `Usage` (incl. the Anthropic `cacheWrite1h` split) and `StopReason`
 * - `OpenAICompletionsCompat` — verbatim, including the 10-value `thinkingFormat`
 *   union. This carries pi-ai's empirical per-provider reasoning knowledge;
 *   the transform layer (Phase 3) turns it into `providerOptions`.
 *
 * Dropped because the @ai-sdk-native world does not need them:
 * - `KnownApi` / `Api` union — every model now routes through `@ai-sdk/*`, so
 *   `Model.api` is the literal `"ai-sdk"`. No more 9 hand-written API impls.
 * - `AssistantMessageEvent` / `AssistantMessageEventStream` — the streaming
 *   protocol that justified the adapter in the abandoned plan. The agent now
 *   consumes `streamText().fullStream` directly (Phase 5).
 * - `ProviderStreams`, `StreamFunction`, `ApiOptionsMap`, `*StreamOptions` —
 *   the old multi-API streaming dispatch. Replaced by `stream()` (Phase 4).
 * - `AnthropicMessagesCompat`, `OpenAIResponsesCompat` — API-specific quirks
 *   that `@ai-sdk/anthropic` / `@ai-sdk/openai` now handle internally.
 * - All image-generation types — out of scope (see plan §"Out of scope").
 *
 * ## Type widening for DB compat
 *
 * `AssistantMessage.api` is intentionally `string`, NOT the literal `"ai-sdk"`.
 * Historical DB rows carry legacy api values (`"openai-completions"`,
 * `"anthropic-messages"`, …). Widening to `string` means those rows still
 * typecheck when hydrated; new messages get `"ai-sdk"`.
 *
 * Conversely `Model.api` IS the literal `"ai-sdk"` — the catalog only ever
 * produces ai-sdk models post-cutover.
 *
 * ## `any` → `unknown`
 *
 * pi-ai used `Record<string, any>` for `ToolCall.arguments` and
 * `<TDetails = any>` for `ToolResultMessage`. Both are now `unknown`, which is
 * the honest type for JSON-parsed payloads. The downstream agent already has
 * a biome override permitting `any`, so the Phase 5 cutover can cast where
 * needed without introducing a new override here.
 */

import type { TSchema } from "typebox";

// ─────────────────────────────────────────────────────────────────────────────
// Provider identifiers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Known provider ids from pi-ai's catalog. Kept as a literal union for editor
 * autocomplete and as documentation of which providers the env-key resolver
 * and catalog generator recognise.
 *
 * `Model.provider` is typed `ProviderId` (this union extended with
 * `string & {}`), so custom providers still typecheck — the union is advisory,
 * not exhaustive.
 */
export type KnownProvider =
  | "amazon-bedrock"
  | "ant-ling"
  | "anthropic"
  | "google"
  | "google-vertex"
  | "openai"
  | "azure-openai-responses"
  | "openai-codex"
  | "nvidia"
  | "deepseek"
  | "github-copilot"
  | "xai"
  | "groq"
  | "cerebras"
  | "openrouter"
  | "vercel-ai-gateway"
  | "zai"
  | "zai-coding-cn"
  | "mistral"
  | "minimax"
  | "minimax-cn"
  | "moonshotai"
  | "moonshotai-cn"
  | "huggingface"
  | "fireworks"
  | "together"
  | "opencode"
  | "opencode-go"
  | "kimi-coding"
  | "cloudflare-workers-ai"
  | "cloudflare-ai-gateway"
  | "xiaomi"
  | "xiaomi-token-plan-cn"
  | "xiaomi-token-plan-ams"
  | "xiaomi-token-plan-sgp";

/**
 * `KnownProvider | (string & {})` — the `& {}` trick widens to `string` for
 * assignability while keeping literal autocomplete on the known set. Any
 * string is a valid `ProviderId`; the known list is for tooling only.
 */
export type ProviderId = KnownProvider | (string & {});

// ─────────────────────────────────────────────────────────────────────────────
// Thinking levels
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User-facing thinking effort tiers, ordered low → max.
 *
 * `"off"` is NOT here — it lives on {@link ModelThinkingLevel} because "off"
 * is a request-time choice, not an effort level a model maps to a value.
 */
export type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh";

/** Runtime thinking choice: `"off"` (no reasoning) or one of the effort tiers. */
export type ModelThinkingLevel = "off" | ThinkingLevel;

/**
 * Per-model map from each {@link ModelThinkingLevel} to the provider-specific
 * value the transform layer sends.
 *
 * - A `string` value (e.g. `"high"`, `"max"`, `"LOW"`) is what gets emitted
 *   into `providerOptions`.
 * - `null` marks a level as **unsupported** by this model. The transform
 *   layer omits the reasoning parameter entirely when the resolved level
 *   maps to `null`, so the model uses its default behaviour.
 * - A missing key means "use the provider's default for that level".
 *
 * Example: `{ off: null, minimal: null, low: "high", medium: "high", high: "high", xhigh: "max" }`
 * means the model reasons by default (off/minimal unsupported) and exposes
 * only high/xhigh as distinct tiers.
 */
export type ThinkingLevelMap = Partial<
  Record<ModelThinkingLevel, string | null>
>;

/**
 * Value type for `chat_template_kwargs` entries used by the `"chat-template"`
 * thinkingFormat. A literal value is sent as-is; a `{ $var }` object is
 * resolved by the transform layer from the current thinking state.
 *
 * - `{ $var: "thinking.enabled" }` → resolved to a boolean (reasoning on/off)
 * - `{ $var: "thinking.effort" }` → resolved to the mapped effort string
 * - `omitWhenOff: true` → the key is dropped entirely when thinking is off
 */
export type ChatTemplateKwargValue =
  | string
  | number
  | boolean
  | null
  | {
      $var: "thinking.enabled" | "thinking.effort";
      omitWhenOff?: boolean;
    };

// ─────────────────────────────────────────────────────────────────────────────
// Auth env/header shared types (used by auth/types.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Provider-scoped environment overrides. Values here take precedence over
 * `process.env` during auth/env resolution. Used to inject regional settings,
 * endpoint placeholders, and proxy variables per-request.
 */
export type ProviderEnv = Record<string, string>;

/**
 * HTTP headers map. A `null` value **suppresses** a provider/API default
 * header with the same name (lets callers opt out of a header the provider
 * sends by default).
 */
export type ProviderHeaders = Record<string, string | null>;

// ─────────────────────────────────────────────────────────────────────────────
// Content blocks
// ─────────────────────────────────────────────────────────────────────────────

/** Legacy text-signature metadata some providers attach (OpenAI responses). */
export interface TextSignatureV1 {
  id: string;
  phase?: "commentary" | "final_answer";
  v: 1;
}

/**
 * Text content block. `textSignature` carries opaque provider metadata
 * (legacy id string or a {@link TextSignatureV1} JSON blob) for multi-turn
 * continuity on providers that need it.
 */
export interface TextContent {
  text: string;
  textSignature?: string;
  type: "text";
}

/**
 * Reasoning/thinking content block.
 *
 * - `redacted: true` means safety filters redacted the thinking; the opaque
 *   encrypted payload is in `thinkingSignature` so it can be passed back to
 *   the API for multi-turn continuity.
 * - `thinkingSignature` carries the provider's reasoning item id (OpenAI
 *   responses) or encrypted signature (Anthropic) when present.
 */
export interface ThinkingContent {
  redacted?: boolean;
  thinking: string;
  thinkingSignature?: string;
  type: "thinking";
}

/** Image content block. `data` is base64-encoded; `mimeType` e.g. `"image/png"`. */
export interface ImageContent {
  data: string;
  mimeType: string;
  type: "image";
}

/**
 * Tool call issued by the model. `arguments` is the JSON-parsed payload —
 * `Record<string, unknown>` (not `any`) because JSON parsing gives no type
 * guarantees; callers narrow to the tool's declared schema.
 *
 * `thoughtSignature` is Google-specific: an opaque signature for reusing
 * thought context across turns.
 */
export interface ToolCall {
  arguments: Record<string, unknown>;
  id: string;
  name: string;
  thoughtSignature?: string;
  type: "toolCall";
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage + stop reasons
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Token usage accounting for a single assistant turn. All cost fields are in
 * USD; token counts are raw token counts.
 *
 * `cacheWrite1h` is the Anthropic-specific split of `cacheWrite` written with
 * 1-hour retention. Only Anthropic reports it; `calculateCost` charges those
 * tokens at 2× the base input rate (Anthropic's pricing).
 */
export interface Usage {
  cacheRead: number;
  cacheWrite: number;
  /** Subset of `cacheWrite` written with 1h retention. Only Anthropic reports this split. */
  cacheWrite1h?: number;
  /**
   * Computed cost breakdown in USD. Populated by `calculateCost(model, usage)`,
   * which mutates these fields in place. All rates are $/million-tokens from
   * `Model.cost`.
   */
  cost: {
    cacheRead: number;
    cacheWrite: number;
    input: number;
    output: number;
    total: number;
  };
  input: number;
  output: number;
  totalTokens: number;
}

/**
 * Why the model stopped generating.
 *
 * - `"stop"` — natural end-of-turn or explicit stop sequence
 * - `"length"` — hit `maxOutputTokens`
 * - `"toolUse"` — the turn ended because the model emitted a tool call
 *   (mapped from @ai-sdk's `"tool-calls"` / `"tool-use"`)
 * - `"error"` — provider/runtime error
 * - `"aborted"` — caller aborted via `AbortSignal`
 */
export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

/**
 * Redacted provider/runtime diagnostics attached to an assistant message on
 * failures and recoveries. Surfaced in status UI; not part of the prompt.
 */
export interface DiagnosticErrorInfo {
  code?: string | number;
  message: string;
  name?: string;
  stack?: string;
}

export interface AssistantMessageDiagnostic {
  details?: Record<string, unknown>;
  error?: DiagnosticErrorInfo;
  timestamp: number;
  type: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User-authored message. `content` is either a plain string (the common case)
 * or an array of content blocks (for multimodal input — text + images).
 */
export interface UserMessage {
  content: string | (TextContent | ImageContent)[];
  role: "user";
  /** Unix timestamp in milliseconds. */
  timestamp: number;
}

/**
 * Model-authored message. This is the central persisted shape — the DB stores
 * it, compaction reads/writes it, the UI hydrates it, and the agent loop
 * produces it. Keeping this shape stable across the pivot is decision #4.
 *
 * `api` is `string` (not the literal `"ai-sdk"`) deliberately: historical DB
 * rows carry legacy api values that must still typecheck when hydrated. New
 * messages produced post-cutover get `api: "ai-sdk"`.
 */
export interface AssistantMessage {
  api: string;
  /** Ordered content blocks: text, thinking, and tool calls interleaved as the model produced them. */
  content: (TextContent | ThinkingContent | ToolCall)[];
  /** Non-fatal diagnostics (recoveries, provider warnings). Omitted on clean turns. */
  diagnostics?: AssistantMessageDiagnostic[];
  /** Present only when `stopReason` is `"error"` or `"aborted"`. */
  errorMessage?: string;
  /** Concrete model id the request targeted (e.g. `"claude-sonnet-4.5"`). */
  model: string;
  /** Provider id (`"anthropic"`, `"openai"`, …). */
  provider: ProviderId;
  /** Provider-specific response/message id when the upstream API exposes one. */
  responseId?: string;
  /**
   * The concrete model that served the request, when different from the
   * requested `model`. Example: OpenRouter `auto` → `"anthropic/claude-..."`.
   */
  responseModel?: string;
  role: "assistant";
  stopReason: StopReason;
  timestamp: number;
  usage: Usage;
}

/**
 * Result of executing a tool call. One per `ToolCall` — the agent loop pairs
 * them by `toolCallId`.
 *
 * `TDetails` defaults to `unknown` (honest for JSON-parsed payloads). Callers
 * that carry structured tool metadata narrow it: `ToolResultMessage<MyDetails>`.
 */
export interface ToolResultMessage<TDetails = unknown> {
  /** Tool output — text and/or images. */
  content: (TextContent | ImageContent)[];
  /** Optional structured metadata the tool attaches (e.g. file paths, exit codes). */
  details?: TDetails;
  /** `true` when the tool errored — surfaces to the model as a failed result. */
  isError: boolean;
  role: "toolResult";
  timestamp: number;
  /** Matches the `ToolCall.id` this result answers. */
  toolCallId: string;
  toolName: string;
}

/** Discriminated union of all message roles. Narrow via `msg.role`. */
export type Message = UserMessage | AssistantMessage | ToolResultMessage;

// ─────────────────────────────────────────────────────────────────────────────
// Tools + context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool declaration. `parameters` is a typebox `TSchema` (JSON Schema) the
 * model uses to decide call shape and the agent uses to validate `ToolCall.arguments`.
 */
export interface Tool<TParameters extends TSchema = TSchema> {
  description: string;
  name: string;
  parameters: TParameters;
}

/**
 * Request context passed to the stream layer. Mirrors pi-ai's `Context` so the
 * agent loop's call site needs minimal changes in Phase 5.
 */
export interface Context {
  messages: Message[];
  systemPrompt?: string;
  tools?: Tool[];
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAICompletionsCompat + routing preferences
// (ported verbatim from pi-ai — drives providerOptions in transform.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * OpenRouter provider routing preferences.
 *
 * Controls which upstream providers OpenRouter routes requests to. Sent as
 * the `provider` field in the OpenRouter API request body. Only meaningful
 * when `Model.provider === "openrouter"` (or the base URL is openrouter.ai).
 *
 * @see https://openrouter.ai/docs/guides/routing/provider-selection
 */
export interface OpenRouterRouting {
  /** Allow backup providers to serve requests. Default: true. */
  allow_fallbacks?: boolean;
  /** `"deny"` → only zero-data-retention providers; `"allow"` (default) → any. */
  data_collection?: "deny" | "allow";
  enforce_distillable_text?: boolean;
  ignore?: string[];
  max_price?: {
    audio?: number | string;
    completion?: number | string;
    image?: number | string;
    prompt?: number | string;
    request?: number | string;
  };
  only?: string[];
  /** Ordered fallback list — try providers in sequence. */
  order?: string[];
  preferred_max_latency?:
    | number
    | {
        p50?: number;
        p75?: number;
        p90?: number;
        p99?: number;
      };
  preferred_min_throughput?:
    | number
    | {
        p50?: number;
        p75?: number;
        p90?: number;
        p99?: number;
      };
  quantizations?: string[];
  require_parameters?: boolean;
  sort?:
    | string
    | {
        by?: string;
        partition?: string | null;
      };
  zdr?: boolean;
}

/**
 * Vercel AI Gateway routing preferences. Controls which upstream providers the
 * gateway routes requests to. Only meaningful when the base URL points at the
 * Vercel AI Gateway.
 *
 * @see https://vercel.com/docs/ai-gateway/models-and-providers/provider-options
 */
export interface VercelGatewayRouting {
  only?: string[];
  order?: string[];
}

/**
 * Compatibility settings for OpenAI-compatible completions APIs.
 *
 * **Ported verbatim from pi-ai** (`packages/ai/src/types.ts:533-580`). This is
 * the data table the transform layer (Phase 3, `provider/transform.ts`) reads
 * to build `providerOptions` for `streamText`. Each field encodes a quirk of a
 * specific OpenAI-compatible provider that @ai-sdk's generic openai-compatible
 * factory does not auto-detect.
 *
 * ### `thinkingFormat` — DO NOT invent new values
 * The 10-value union is the canonical set of per-provider reasoning conventions,
 * carrying pi-ai's empirical knowledge of how each provider expects reasoning
 * configured. The transform layer has one branch per value; adding a value
 * without a transform branch silently breaks reasoning. New providers must
 * reuse an existing format.
 *
 * Values:
 * - `"openai"` — `reasoning_effort` (the default; also the fallthrough)
 * - `"openrouter"` — `reasoning: { effort }`
 * - `"deepseek"` — `thinking: { type }` + `reasoning_effort` when supported
 * - `"together"` — `reasoning: { enabled }` + `reasoning_effort` when supported
 * - `"zai"` — `thinking: { type: "enabled" }` (+ `reasoning_effort` when supported)
 * - `"qwen"` — top-level `enable_thinking: boolean`
 * - `"qwen-chat-template"` — `chat_template_kwargs.enable_thinking` + `preserve_thinking`
 * - `"chat-template"` — configurable `chat_template_kwargs` (see {@link ChatTemplateKwargValue})
 * - `"string-thinking"` — top-level `thinking: string`
 * - `"ant-ling"` — `reasoning: { effort }` only when the mapped effort is non-null
 */
export interface OpenAICompletionsCompat {
  /**
   * Apply Anthropic-style `cache_control` markers to the system prompt, last
   * tool definition, and last user/assistant text content. Only set for
   * OpenRouter-served Anthropic models.
   */
  cacheControlFormat?: "anthropic";
  /** `chat_template_kwargs` to send when `thinkingFormat` is `"chat-template"`. */
  chatTemplateKwargs?: Record<string, ChatTemplateKwargValue>;
  /** Which request field carries the output token cap. Auto-detected from URL when unset. */
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  openRouterRouting?: OpenRouterRouting;
  /** Provider requires an assistant message between tool results and the next user turn. */
  requiresAssistantAfterToolResult?: boolean;
  /** Provider requires replayed assistant messages to include an empty `reasoning_content`. */
  requiresReasoningContentOnAssistantMessages?: boolean;
  /** Provider requires thinking blocks converted to `<thinking>…</thinking>` text. */
  requiresThinkingAsText?: boolean;
  /** Provider requires the `name` field on tool results (not just `tool_call_id`). */
  requiresToolResultName?: boolean;
  /** Send `session_id`/`x-client-request-id`/`x-session-affinity` from `sessionId` when caching. */
  sendSessionAffinityHeaders?: boolean;
  supportsDeveloperRole?: boolean;
  supportsLongCacheRetention?: boolean;
  supportsReasoningEffort?: boolean;
  supportsStore?: boolean;
  supportsStrictMode?: boolean;
  supportsUsageInStreaming?: boolean;
  thinkingFormat?:
    | "openai"
    | "openrouter"
    | "deepseek"
    | "together"
    | "zai"
    | "qwen"
    | "chat-template"
    | "qwen-chat-template"
    | "string-thinking"
    | "ant-ling";
  vercelGatewayRouting?: VercelGatewayRouting;
  /** z.ai-specific: stream tool-call argument deltas via top-level `tool_stream: true`. */
  zaiToolStream?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Model descriptor (ai-sdk-only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Model descriptor for an @ai-sdk-routed model.
 *
 * Non-generic — the old `Model<TApi extends Api>` is gone because every model
 * now routes through an `@ai-sdk/*` factory. `api` is the literal `"ai-sdk"`
 * so consumers can narrow against it and so `AssistantMessage.api` (wide
 * `string`) accepts it.
 *
 * ### Key fields
 * - `npm` — the `@ai-sdk/*` provider factory package name
 *   (e.g. `"@ai-sdk/anthropic"`). The provider resolver (Phase 2) dynamic-
 *   imports this to build the `LanguageModel`.
 * - `compat` — per-provider quirks (see {@link OpenAICompletionsCompat}). The
 *   transform layer (Phase 3) turns this into `providerOptions`.
 * - `thinkingLevelMap` — per-model effort mapping (see {@link ThinkingLevelMap}).
 *   Absent entries use provider defaults; `null` marks unsupported levels.
 * - `cost` — $/million-token rates. `calculateCost` reads these.
 *
 * ### What's NOT here
 * The old `Model<TApi>` conditional `compat` typing (which selected
 * `OpenAICompletionsCompat` vs `AnthropicMessagesCompat` vs `OpenAIResponsesCompat`
 * based on `TApi`) is gone — we only carry `OpenAICompletionsCompat` now.
 */
export interface Model {
  api: "ai-sdk";
  /** Provider base URL. `${VAR}` placeholders are env-substituted at resolve time. */
  baseUrl: string;
  compat?: OpenAICompletionsCompat;
  contextWindow: number;
  cost: {
    cacheRead: number;
    cacheWrite: number;
    input: number;
    output: number;
  };
  /** Static headers merged into every request (e.g. Copilot/Kimi/NVIDIA static headers). */
  headers?: Record<string, string>;
  id: string;
  /** Input modalities the model accepts. `["text"]` always; `"image"` added when supported. */
  input: ("text" | "image")[];
  maxTokens: number;
  name: string;
  /** npm package name for the @ai-sdk provider factory (e.g. `"@ai-sdk/anthropic"`). */
  npm?: string;
  provider: ProviderId;
  /** Whether the model supports reasoning/thinking at all. */
  reasoning: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
}
