# ZAI Anthropic Provider — hand-rolled in `@sakti-code/llm`

## Goal

Add a hand-rolled `ZaiAnthropicLanguageModel` (implements `LanguageModelV4`) under
`packages/llm/src/provider/zai-anthropic/` that speaks the **Anthropic Messages
protocol** to Z.ai's Anthropic-compatible endpoint
(`https://api.z.ai/api/anthropic/v1/messages`), with first-class support for
Z.ai-native extensions (`speed`, `output_config`) and the full GLM reasoning +
caching surface. Override the existing `zai` / `zai-coding-plan` catalog routing
so those providers resolve to this model instead of `@ai-sdk/openai-compatible`.

This intentionally overrides the project's standing `AGENTS.md` rule ("don't
hand-roll provider code") — the decision is informed and deliberate (see
"Approach" below).

## Background (why this is possible + worth doing)

- Z.ai's coding-plan exposes an **Anthropic Messages-compatible endpoint**, not
  just the OpenAI-compat one. Z.ai's own coding agent (ZCode) uses it as
  `defaultKind:"anthropic"`. Sources:
  - `openspec/references/zcode-glm-best-practices.md` (§1 Connection, §2
    Reasoning, §3 Caching, §9 speed/output_config)
  - `openspec/references/zcode-catalog-schema.md` (Patch DSL, reasoning presets)
- The OpenAI-compat path (`…/api/coding/paas/v4`, currently used by the catalog
  for `zai`) loses native `tool_use` blocks, the `thinking` field, and
  `cache_control` ergonomics — all of which are the headline quality levers on
  GLM reasoning models.
- `@ai-sdk/anthropic` v4.0.1 source is checked in under
  `openspec/references/ai/packages/anthropic/` and serves as the porting
  template. It already implements the Anthropic Messages wire shape end-to-end
  (request builder, SSE decoder, usage/stop mapping, cache-control validator).

## Approach (chosen: A — full hand-roll)

Three approaches were considered:

- **A — Full hand-roll on `@ai-sdk/provider-utils` primitives (CHOSEN).** Our own
  `ZaiAnthropicLanguageModel` speaks the Anthropic Messages protocol to Z.ai,
  with Z.ai-native fields baked in. Reuses only generic plumbing from
  `@ai-sdk/provider-utils` (`combineHeaders`, `postJsonToApi`,
  `createEventSourceResponseHandler`, `generateId`, `parseProviderOptions`,
  `createJsonErrorResponseHandler`, `parseJSON`). This mirrors the structure of
  the old `packages/zai` and of `@ai-sdk/anthropic`.
- **B — Wrap `@ai-sdk/anthropic`** via
  `createAnthropic({ baseURL, apiKey, headers, name:"zai" })`. ~10× less code
  and would cover the v1 scope (Z.ai built `speed`/`output_config`
  Anthropic-compatibly, so `@ai-sdk/anthropic` already emits them). **Rejected
  by the owner** in favour of full control.
- **C — Vendor a slice of `@ai-sdk/anthropic` into the tree.** Fork-and-maintain
  burden for little saving over A. Not chosen.

**Why A over B (the parts that actually matter):**

1. **Beta header control.** `@ai-sdk/anthropic` auto-emits Claude-era betas
   (`fast-mode-2026-02-01`, `task-budgets-2026-03-13`, `mcp-client-*`, …). Z.ai
   accepts `prompt-caching-2024-07-31` for sure; the rest is unverified and
   could 400. With A we emit **only** what Z.ai expects.
2. **Minimal schema.** We port a strict subset of the Anthropic wire schema —
   only `text`, `thinking`, `redacted_thinking`, `tool_use`, the 5 delta types,
   and the 4 message-level events. We omit mcp / container / code-execution /
   web-search / web-fetch / advisor / tool-search / fallback / compaction /
   citations — Z.ai doesn't surface them, so the schema stays small and
   Z.ai-focused.
3. **No Claude-shaped internals.** `@ai-sdk/anthropic` carries a hardcoded
   `getModelCapabilities` table keyed to `claude-*` ids and a large inert
   feature surface. A inherits none of that.
4. **Matches the proven old-`packages/zai` shape** the owner is familiar with.

## v1 scope (approved)

Baseline (non-negotiable): anthropic endpoint, streaming text, native `tool_use`
blocks, SSE assembly, auth via existing `auth.json` / `ctx.auth`.

Additional capabilities in scope for v1:

- Leveled thinking budgets (max 32000 / high 16000 / nothink) — strip
  `temperature`/`topP`/`topK` when thinking on; default budget 1024 when
  `type:"enabled"` but no budget.
- Prompt caching — `cache_control:{type:"ephemeral"}` on the stable system
  prefix and the last tool definition; send `anthropic-beta:
prompt-caching-2024-07-31`.
- Interleaved reasoning stream — parse `thinking` / `redacted_thinking` blocks
  and surface them as reasoning (signature-bearing for multi-turn continuity),
  never echoed back as user content.
- Z.ai-native `speed:"fast"|"standard"` + `output_config` (`effort`,
  `task_budget:{type,total,remaining?}`, `format:{type:"json_schema",schema}`).
- Structured output via `output_config.format`.

Deferred: OAuth subscription flow (the API-key path via `auth.json` covers v1).

## Module layout (`packages/llm/src/provider/zai-anthropic/`)

| File                              | Role                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `index.ts`                        | `createZaiAnthropic(opts): ProviderSDK` factory returning `{ languageModel(id) }`. Registered in `BUNDLED_PROVIDERS`.          |
| `zai-anthropic-language-model.ts` | `ZaiAnthropicLanguageModel implements LanguageModelV4` — `doGenerate` / `doStream` / `getArgs`.                                |
| `convert-to-zai-messages.ts`      | `CoreMessage[]` → Anthropic Messages body (top-level `system`, role messages, content blocks, `tool_result`, `cache_control`). |
| `map-zai-response.ts`             | non-stream response → `LanguageModelV4GenerateResult`.                                                                         |
| `zai-anthropic-api.ts`            | Zod schemas for request / stream-chunk / error (Anthropic Messages shapes, **minimal subset** + Z.ai extensions).              |
| `zai-anthropic-options.ts`        | `providerOptions.zai` schema (thinking, speed, outputConfig, cacheControl, sendReasoning).                                     |
| `zai-anthropic-error.ts`          | `{type:"error",error:{type,message}}` → `createJsonErrorResponseHandler`.                                                      |
| `__tests__/`                      | fixtures + SSE-replay tests (no network).                                                                                      |

## Integration

### Registry (`provider/registry.ts`)

One local entry (no dynamic import — it is our code):

```ts
"@sakti-code/zai-anthropic": () => Promise.resolve(createZaiAnthropic as ProviderFactory),
```

### Catalog override (choice: **G** — generation-time)

The catalog is generated from models.dev by `scripts/generate-models.ts`. Add a
special-case in the converter for providers `zai` and `zai-coding-plan`:

- `npm: "@sakti-code/zai-anthropic"`
- `baseUrl: "https://api.z.ai/api/anthropic"` (coding variant:
  `…/api/coding/anthropic`)
- drop the openai-compat `compat` (no `thinkingFormat:"zai"` — our model reads
  `providerOptions.zai` directly)
- keep `reasoning: true`

Survives regeneration because the override lives in the generator. Catalog rows
stay self-describing (UI / debug show the real endpoint). Other GLM-bearing
providers (302ai, baseten, chutes, deepinfra, huggingface, kilo, llmgateway,
amazon-bedrock, …) keep their existing `@ai-sdk/openai-compatible` / first-party
routing — only Z.ai's own provider ids are repointed.

### Endpoint & headers

- `POST {baseURL}/messages` (factory composes this from `baseURL`).
- `x-api-key: <key>` resolved from `auth.json` via `ctx.auth` (passed as
  `options.apiKey` — same key path as every other provider; no env / DB).
- `anthropic-version: 2023-06-01`.
- `anthropic-beta: prompt-caching-2024-07-31` when caching is on (the **only**
  beta we emit — this is the key A-vs-B difference).
- `content-type: application/json` + merged static headers.

## Request building (`getArgs`, shared by `doGenerate` + `doStream`)

Body shape — Anthropic Messages with Z.ai-native extensions:

```jsonc
{
  "model": "glm-5.2",
  "max_tokens": 4096,                          // required; = requested + thinkingBudget
  "system": [                                  // top-level, NOT in messages
    { "type":"text", "text":"…stable prefix…",
      "cache_control": { "type":"ephemeral" } } // marker on last stable block
  ],
  "messages": [
    { "role":"user", "content":[{"type":"text","text":"…"}] },
    { "role":"assistant", "content":[
      { "type":"thinking","thinking":"…","signature":"…" },
      { "type":"text","text":"…" },
      { "type":"tool_use","id":"…","name":"Read","input":{…} }
    ]},
    { "role":"user", "content":[
      { "type":"tool_result","tool_use_id":"…","content":"…" }
    ]}
  ],
  "tools": [{ "name":"Read","description":"…","input_schema":{…JSONSchema…},
              "cache_control":{"type":"ephemeral"} }],
  "tool_choice": { "type":"auto" },            // auto | any | tool | none
  "thinking": { "type":"enabled","budget_tokens":32000 },
  // Z.ai-native extensions (outside standard Anthropic):
  "speed": "fast",
  "output_config": { "effort":"high",
                     "task_budget":{"type":"tokens","total":N,"remaining":M},
                     "format":{"type":"json_schema","schema":{…}} }
}
```

Rules baked into `getArgs`:

1. `system` is top-level; split stable vs dynamic; `cache_control:{type:"ephemeral"}`
   on the last stable block **and** the last tool. A shared `CacheControlValidator`
   (ported from `@ai-sdk/anthropic/get-cache-control.ts`) caps at Anthropic's 4
   breakpoints and emits warnings on overflow.
2. `max_tokens` required; `max_tokens = requested + thinkingBudget`, capped at
   model max.
3. `thinking`: `{type:"enabled", budget_tokens}` or `{type:"disabled"}`. Default
   budget **1024** when `enabled` but no budget.
4. **Strip `temperature` / `topP` / `topK` when `thinking.type` is `enabled` or
   `adaptive`** (GLM rejects sampling params while thinking) — emit
   `unsupported` warnings.
5. Z.ai-native `speed` / `output_config` emitted only when the caller sets them
   via `providerOptions.zai`; never invented.
6. Tools use Anthropic's native `input_schema` (JSON Schema projected from the
   typebox `TSchema`), **not** OpenAI's `{type:"function",function:{…}}`
   wrapper. `sanitizeJsonSchema` strips `$ref`/`$schema` Anthropic rejects.
7. `tool_result` blocks carry `tool_use_id` + content (text or image).
8. `sendReasoning:true` — replay signature-bearing `thinking` blocks in
   assistant turns for multi-turn continuity (Anthropic protocol). UI shows
   them as reasoning, not user content.

### `providerOptions.zai` namespace

Factory sets `provider:"zai.messages"` so `parseProviderOptions({provider:"zai"})`
resolves. Schema:

```ts
{
  thinking?:  { type:"enabled"|"disabled"|"adaptive"; budgetTokens?: number; display?:"omitted"|"summarized" },
  speed?:     "fast"|"standard",
  outputConfig?: { effort?:"low"|"medium"|"high"|"xhigh"|"max";
                   taskBudget?: { type:"tokens"; total:number; remaining?:number };
                   format?: { type:"json_schema"; schema:object } },
  cacheControl?: { system?: boolean; tools?: boolean }, // default {system:true, tools:true}
  sendReasoning?: boolean                               // default true
}
```

## Streaming (`doStream`)

SSE event → `LanguageModelV4StreamPart` mapping (standard Anthropic Messages
protocol; reasoning arrives as `thinking` blocks, **not** as
`delta.reasoning_content`):

| SSE event             | Emission                                                                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message_start`       | `response-metadata` `{id, modelId}`; seed usage (`input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`)                                                                          |
| `content_block_start` | open block by index → `text-start` / `reasoning-start` / `tool-input-start` `{id, toolName}`. `redacted_thinking` → reasoning with `redactedData` metadata                                          |
| `content_block_delta` | `text_delta`→`text-delta`; `thinking_delta`→`reasoning-delta`; `signature_delta`→stash onto reasoning's `providerMetadata.signature`; `input_json_delta`→`tool-input-delta` (append `partial_json`) |
| `content_block_stop`  | close block → `text-end` / `reasoning-end` / `tool-input-end` + `tool-call` (safe-parse accumulated JSON via `parseJSON` — **never** raw `JSON.parse`, per repo AGENTS)                             |
| `message_delta`       | update `stop_reason`; accumulate `output_tokens` + cache tokens                                                                                                                                     |
| `message_stop`        | no-op (finish emitted in `flush`)                                                                                                                                                                   |
| `error`               | emit `error`; `finishReason.unified = "error"`                                                                                                                                                      |
| `ping`                | ignore                                                                                                                                                                                              |
| `flush`               | emit `finish` `{finishReason:{unified,raw}, usage, providerMetadata}`                                                                                                                               |

Per-index block state `Map<number, {type, id, toolName?, inputChunks?:string[]}>`
(pattern from `anthropic-language-model.ts:1488-1579`). `includeRawChunks`
honored (emit `raw` parts).

## Non-stream (`doGenerate`)

POST without `stream:true`, parse the minimal response schema, map `content[]`
→ V4 content (`text`, `reasoning` with `signature`, `tool-call`), `usage`,
`finishReason`. Shares `getArgs`.

## Reasoning levels + `providerOptions.zai` transform

**Where the mapping lives.** Extend `buildProviderOptions`
(`provider/transform.ts`) with a new branch detected by
`model.npm === "@sakti-code/zai-anthropic"`. Returns
`{ zai: { thinking, speed?, outputConfig? } }`. `stream.ts` is untouched (single
call site passes it through).

**Level → thinking budget.** Module-local constant in
`provider/zai-anthropic/`, consumed by the new branch (the existing
`Model.thinkingLevelMap` is string-typed, so numeric budgets don't fit there):

```ts
const ZAI_THINKING_BUDGETS: Record<ThinkingLevel, number> = {
  minimal: 2000, // ≥ Anthropic floor of 1024
  low: 8000,
  medium: 16000, // zcode "high"
  high: 16000,
  xhigh: 32000, // zcode "max"
};
// level === "off"            → { type:"disabled" }
// level === ThinkingLevel    → { type:"enabled", budget_tokens: ZAI_THINKING_BUDGETS[level] }
```

(Tunable constant — zcode exposes only max/high/nothink; we graduate the 5
tiers. Default-budget-1024 rule still applies if a caller overrides with no
budget.)

**Exposing `speed` / `outputConfig` through `stream()`.** Add an optional field
to `StreamRequest` (`stream.ts`):

```ts
providerOptions?: Record<string, unknown>;
```

Deep-merged with the auto-derived `{ zai: { thinking } }`; caller-provided keys
win, so the agent can set
`providerOptions: { zai: { speed:"fast", outputConfig:{ effort:"high" } } }`
without touching the thinking level. Delivers the full v1 surface through
`stream()`; `buildProviderOptions` stays the thinking-level authority.

## Errors, usage, retry (mostly inherited)

- **Error response handler:** port the Anthropic error shape
  `{type:"error",error:{type,message}}`. Mid-stream `error` events →
  `{type:"error",error}` part + `finishReason.unified="error"`.
- **Retry / overflow classifiers: unchanged.** `isRetryableAssistantError`
  (`retry.ts`) already matches `overloaded`, `rate.?limit`,
  `stream ended before message_stop`, `network.?error`, … and
  `isContextOverflow` (`context-overflow.ts`) already covers
  `model_context_window_exceeded`, prompt-too-long patterns, and z.ai's
  **silent overflow** (case 2: `input + cacheRead > contextWindow` with
  `stopReason:"stop"`). We just emit standard error text and honest usage →
  both classifiers work as-is.
- **Usage → `Usage`: unchanged.** Our model emits V4 `LanguageModelV4Usage` with
  `inputTokenDetails.{noCacheTokens, cacheReadTokens, cacheWriteTokens}`; the
  existing `mapUsage` (`stream.ts:146`) reads exactly these. **Must populate
  `noCacheTokens = input_tokens`** (the non-cached subset) so `calculateCost`
  doesn't double-charge cached tokens (the `mapUsage` B1 invariant).
  `cacheWrite1h` stays `undefined` (GLM reports no 1h split); `reasoningTokens`
  undefined (Anthropic folds thinking into output).
- **Abort:** pass `options.abortSignal` straight through to `postJsonToApi` +
  the SSE transform; aborted streams close naturally.

## Testing (TDD, per AGENTS.md)

Tests colocated in `provider/zai-anthropic/__tests__/`. **No network** — inject
a fake `FetchFunction`.

- **Fixtures:** captured SSE event arrays (`message_start`, `content_block_start`/
  `_delta`/`_stop`, `message_delta`, `message_stop`, `error`, `ping`) replayed
  through `doStream`'s transform — port the fixture style from
  `@ai-sdk/anthropic/__fixtures__/`.
- **`getArgs` (snapshot + assertions):** level→budget; temperature/topP/topK
  strip when thinking on; `cache_control` on last system block + last tool
  (≤4 breakpoints); `speed`/`output_config` only when set; `input_schema` from
  the typebox `TSchema`; `max_tokens = requested + budget`.
- **`doStream`:** each SSE event → correct stream part; interleaved reasoning
  (`thinking` → `reasoning-start/delta/end` + `signature_delta`→metadata);
  `input_json_delta` accumulation → `tool-call` with safe-parsed input;
  `redacted_thinking`; `error` event; usage accumulation from `message_delta`;
  `finish` emission.
- **`doGenerate`:** `content[]` → V4 content (text / reasoning+signature /
  tool-call); usage; finishReason.
- **`convert-to-zai-messages`:** system→top-level; user text+image; assistant
  text+thinking+tool_use replay; `tool_result` with `tool_use_id`.
- **Integration via `streamWithModel` + injected fake model:** the new
  `buildProviderOptions` zai branch yields the right `providerOptions.zai`; the
  `StreamRequest.providerOptions` passthrough deep-merges (caller wins on
  `speed`/`outputConfig`).
- **Registry:** `"@sakti-code/zai-anthropic"` loader resolves to a
  `LanguageModelV4` with `provider === "zai.messages"`.

## Verification

- `cd packages/llm && pnpm run typecheck`
- `cd packages/llm && pnpm run test`
- `pnpm run fix` before committing (Ultracite / Biome)

## References

- `openspec/references/zcode-glm-best-practices.md` — endpoint, reasoning
  levels, caching, speed/output_config, streaming.
- `openspec/references/zcode-catalog-schema.md` — Patch DSL, reasoning presets,
  composition rules.
- `openspec/references/ai/packages/anthropic/src/` — porting template
  (`anthropic-language-model.ts`, `anthropic-api.ts`, `convert-to-anthropic-prompt.ts`,
  `convert-anthropic-usage.ts`, `map-anthropic-stop-reason.ts`,
  `get-cache-control.ts`, `anthropic-error.ts`, `anthropic-provider.ts`).
- `openspec/references/sakti-code-old/packages/zai/` — the old hand-rolled
  OpenAI-compat Z.ai provider; structural inspiration for the new package
  shape (different protocol, same bones).
