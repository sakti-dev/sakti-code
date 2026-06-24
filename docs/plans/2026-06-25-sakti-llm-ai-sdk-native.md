# `@sakti-code/llm` — greenfield @ai-sdk-native runtime

> **Supersedes** `2026-06-25-pi-ai-ai-sdk-models-dev.md`. That plan bridged `@ai-sdk` → pi-ai's `AssistantMessageEvent` protocol via a custom adapter. An audit (consumer map below) showed the protocol's downstream payload is semantically tiny (a delta string + a text/thinking kind), the adapter was the highest-risk piece, and going `@ai-sdk`-native is cheap. Real blast radius: `agent-loop.ts` ~30 lines, `replay-runner.ts` ~10, UI reducer 4. We're deleting `packages/ai` and rebuilding as `@sakti-code/llm`, modeling the provider/transform layer on opencode (plain TS, no Effect), and changing the agent loop to consume `@ai-sdk`'s `fullStream` directly.

## Goal

Replace `packages/ai` (`@earendil-works/pi-ai`, a subtree of `earendil-works/pi`) with a new `packages/llm` (`@sakti-code/llm`) that is `@ai-sdk`-native end to end. The agent loop consumes `streamText().fullStream` directly — **no `AssistantMessageEvent` protocol, no adapter**. The UI seam becomes a slim delta event. Zero per-provider hand-written API code: every provider routes through `@ai-sdk/*` factories driven by models.dev's `npm` field.

## Architecture

```
packages/llm  (new — replaces packages/ai; greenfield; opencode as reference)
  ├─ catalog/         models.dev → Model<"ai-sdk"> (build-time generation)
  ├─ provider/        BUNDLED_PROVIDERS registry + resolveLanguageModel + transform
  ├─ stream.ts        stream(req) → { fullStream, result }   ← the single entry point
  ├─ messages.ts      our Message[] → @ai-sdk ModelMessage[]
  ├─ cost.ts          calculateCost
  ├─ auth/            env API-key resolution
  └─ types.ts         message contract (AssistantMessage etc., kept shape) + Model + compat

packages/agent  (loop logic only — does NOT import "ai")
  ├─ imports message types + stream() from @sakti-code/llm
  ├─ iterates llm.stream(...).fullStream natively
  ├─ accumulates fullStream → AssistantMessage
  └─ emits AgentEvent  (message_update now carries slim { delta, kind })

apps/server    WS forwards AgentEvent (only message_update payload shape changes)
apps/desktop   event-reducer reads slim delta instead of assistantMessageEvent (4 lines)
```

**Why `packages/llm` owns the `streamText` call:** the compat wiring (`providerOptions` from `thinkingFormat`, session-affinity headers, `wrapLanguageModel` cache-control middleware) is provider knowledge, not agent knowledge. Centralizing it keeps all "@ai-sdk + provider quirks" cohesive in one module and leaves the agent pure loop logic. (opencode's split is analogous: `provider/` resolves, `session/llm.ts` streams.)

## Decisions locked

1. **No Effect-TS.** Port opencode logic to plain `async`/`AsyncIterable`.
2. **Adopt opencode's architecture/patterns, not its type shapes.** Keep our `AssistantMessage` etc. (widely depended on).
3. **`packages/llm` owns the `streamText` call** (compat wiring co-locates with it).
4. **Keep `AssistantMessage` shape** (~20 consumers: compaction/db/UI hydrate).
5. **Rename** `@earendil-works/pi-ai` → `@sakti-code/llm`. Clean break; touches every import.
6. **UI seam = Option 2**: `AgentEvent.message_update` carries `{ delta: string; kind: "text"|"thinking" }`; the dead per-token partial-message snapshot is dropped (perf win).
7. **models.dev at build time** (no runtime fetch — simpler for a desktop app).
8. **Big-bang cutover per layer**: build `packages/llm` alongside, swap agent → server → UI in one coordinated pass, then delete `packages/ai`.

## Constraints (from `AGENTS.md`)

- `exactOptionalPropertyTypes: true` → conditional spread `...(x !== undefined ? { x } : {})`, never pass `undefined`.
- TS 6.0 → `include`/`references` top-level in tsconfig; `shell` in `execSync` is a `string`.
- Tests: `packages/llm/src/__tests__/*.test.ts`, `packages/agent/src/__tests__/`, vitest `globals: true`, node env.
- No `console.log`/`any`/`debugger`. `unknown` over `any` (incl. `ToolCall.arguments: Record<string, unknown>`, `ToolResultMessage<TDetails = unknown>`). `for...of` over `.forEach()`. Arrow callbacks.
- `expectTypeOf<T>()` no-arg form fails for interfaces under vitest 3.2.6 / expect-type 1.3.0 — use `const x = {} as T; expectTypeOf(x)` instead.
- Before commit: `nubx ultracite fix`. Typecheck: `cd packages/llm && nub run typecheck`. Test: `cd packages/llm && nub run test`.

---

## Guardrails (light — greenfield)

- **No Effect-TS.** No `yield*`, `Layer`, `Effect.gen`, branded schemas. opencode-in-Effect → rewrite to plain `async`/`Promise`/`AsyncIterable`. That rewrite IS the task.
- **No `any`, `console.log`, `debugger`.**
- **No reinvented `thinkingFormat` values.** Legal set = pi-ai's existing union (`openai | openrouter | deepseek | together | zai | qwen | chat-template | qwen-chat-template | string-thinking | ant-ling`). These carry pi-ai's empirical per-provider knowledge; opencode's `transform.ts` is the structural template for how each value becomes `providerOptions`.
- **opencode = reference for ported logic** (provider resolution, transform, streamText option set). A brief comment citing the line range ported is enough — no heavy Lineage-Map ceremony (this is greenfield).
- **Perf invariant:** streaming updates MUST NOT clone/ship the accumulated partial message. Only deltas flow per-token; the full message ships on `message_end`. (Current code clones per-token at `agent-loop.ts:354` and the UI ignores it — that dies in Phase 5.)

---

## Consumer map (why this is cheap)

The audit that justified the pivot. `AssistantMessageEvent` reaches only:

| Layer | File:lines | Role | Lines touched |
|---|---|---|---|
| Consumer | `packages/agent/src/loop/agent-loop.ts:330-358` | the one real consumer (switch over events) | ~30 (replaced) |
| Type leak | `packages/agent/src/types.ts:506-511` | `AgentEvent.message_update.assistantMessageEvent` | 1 field (changed) |
| Synthesizer | `apps/server/src/agent/replay-runner.ts:~225` | replays a stored message as a stream | ~10 (changed) |
| UI reader | `apps/desktop/src/stores/session/event-reducer.ts:150-153` | reads only `type` + `.delta` | 4 (changed) |
| Callers | `agent.ts:270`, `agent-harness.ts:484`, `agent-loop.ts:313` | call the stream entry point | 3 sites (retarget) |

`AssistantMessage` (the final type) stays; ~20 files keep working unchanged.

---

## Reference Manifest

Verify each path exists before relying on it.

| ID | Path | What | Phase |
|----|------|------|-------|
| OC-LOADER | `openspec/references/opencode/.../provider/provider.ts:107-134` | `BUNDLED_PROVIDERS` map | 2 |
| OC-RESOLVE | `…provider.ts:1639-1771` | `resolveSDK` (options/baseURL/apiKey + dynamic import) | 2 |
| OC-GETLANG | `…provider.ts:1801-1830` | languageModel dispatch | 2 |
| OC-FALLBACK | `…provider.ts:1747-1767` | runtime `import()` fallback for unlisted npm | 2 |
| OC-MD | `…provider.ts:1188-1271` | `fromModelsDev*` field mapping | 1 |
| OC-TRANSFORM | `…provider/transform.ts:329-344, 731, 1067-1170, 1257` | providerOptions, cache_control, reasoning | 3 |
| OC-STREAM | `…session/llm.ts:280-353` | `streamText` call + `wrapLanguageModel` | 4 |
| OC-MDSVC | `…core/src/models-dev.ts` | fetch/cache (Effect — **reference only**) | 1 |
| PI-COMPAT | `packages/ai/src/api/openai-completions.ts:594-666` | thinkingFormat **data values** (primary for the per-provider assignments) | 3 |
| PI-CACHE | `packages/ai/src/api/openai-completions.ts:731` | cacheControlFormat gating | 3 |
| PI-COST | `packages/ai/src/models.ts:385-395` | `calculateCost` | 1 |
| PI-GENMODEL | `packages/ai/scripts/generate-models.ts` | current per-provider ingestion + `COMPAT_OVERRIDES` values | 1 |
| PI-AUTH | `packages/ai/src/auth/types.ts` | `ProviderAuth`/`AuthResult`/`ModelAuth` | 1 |
| AG-LOOP | `packages/agent/src/loop/agent-loop.ts:300-365` | current stream consumption (replaced) | 5 |
| AG-STREAMFN | `packages/agent/src/types.ts:24-26` | `StreamFn` type | 5 |
| AG-EVENT | `packages/agent/src/types.ts:493-535` | `AgentEvent` shape (`message_update` field changed) | 5 |
| UI-REDUCER | `apps/desktop/src/stores/session/event-reducer.ts:145-156` | UI delta consumer | 6 |
| SRV-REPLAY | `apps/server/src/agent/replay-runner.ts:215-235` | event synthesizer | 6 |

---

## Phase 1 — `packages/llm` foundation (types + catalog + cost) ✓ DONE

> **47/47 tests green · typecheck clean · ultracite fix clean.**
> Catalog: 4147 models / 142 providers (matches opencode's models.dev set).
>
> Three deviations from the original plan text (approved during execution):
> 1. **Task 1.3 trimmed** — skipped `ProviderAuth`/`ApiKeyAuth`/`OAuthAuth`/`CredentialStore` (login/OAuth orchestration is server-owned). packages/llm only resolves env keys + carries `ModelAuth`/`AuthResult`.
> 2. **Task 1.4 target changed** — source is **opencode's models.dev set, NOT pi-ai's count** (user directive: "provider count should match opencode, this is the sole reason we wrote our own"). pi-ai's per-model compat sprawl collapsed to a 4-entry provider-level `PROVIDER_COMPAT` table.
> 3. **`any` → `unknown`** on `ToolCall.arguments` + `ToolResultMessage<TDetails>` (per "no any" guardrail).

### Task 1.1 — Scaffold package ✓
- `packages/llm/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}` following the `packages/tools` convention (exports → `./src/index.ts`).
- Deps added per-phase (Phase 1 only needs `typebox`; `@ai-sdk/*` + `ai` arrive in Phase 2/4 when first imported).
- `tsconfig.json` includes `src/**/*.ts` + `scripts/**/*.ts`.
- `vitest.config.ts` — node env, `src/**/__tests__/**/*.test.ts`.

### Task 1.2 — Message + Model types ✓ (TDD: 12 tests)
- `src/types.ts` — kept: content blocks, messages, `Usage`, `StopReason`, `OpenAICompletionsCompat` (verbatim, 10 thinkingFormat values), `ThinkingLevelMap`, `Tool`, `Context`, `KnownProvider`.
- **`Model` is non-generic** (not `Model<"ai-sdk">` with a type param) — `api: "ai-sdk"` literal. The old `Model<TApi extends Api>` generic is gone.
- **`AssistantMessage.api: string`** (NOT literal `"ai-sdk"`) — widened for DB compat (historical rows carry legacy api values).
- Dropped: `KnownApi`/`Api`, `AssistantMessageEvent`/`AssistantMessageEventStream`, `ProviderStreams`/`StreamFunction`/`*StreamOptions`, `AnthropicMessagesCompat`/`OpenAIResponsesCompat`, all image-generation types.
- `ToolCall.arguments: Record<string, unknown>`; `ToolResultMessage<TDetails = unknown>` (not `any`).
- `AssistantMessageDiagnostic` inlined (small, tightly coupled to `AssistantMessage`).

### Task 1.3 — Auth resolution ✓ (TDD: 13 tests)
- `src/auth/types.ts` — `ModelAuth`, `AuthResult` only. **Skipped** `ProviderAuth`/`ApiKeyAuth`/`OAuthAuth`/`CredentialStore` (server-owned login flow; packages/llm's stream layer receives a resolved `apiKey` string).
- `src/auth/env.ts` — `getEnvApiKey`/`findEnvKeys` + the 30-provider env-var map. Dropped: Bun sandbox `/proc/self/environ` fallback (Node-only); Vertex ADC + Bedrock ambient checks (`@ai-sdk/google-vertex` + `@ai-sdk/amazon-bedrock` handle those internally).

### Task 1.4 — models.dev build-time ingestion ✓ (TDD: 16 tests on converter)
- **Target: opencode's models.dev provider set** (NOT pi-ai's count). Result: 142 providers, 4147 tool-capable models, 1152 non-tool dropped.
- `src/catalog/types.ts` — `ModelsDevProvider`/`ModelsDevModel`/`ModelsDevCatalog` (minimal typed view of the API JSON).
- `src/catalog/convert.ts` — `convertModelsDevModel(provider, model): Model | null`. Ports opencode's `fromModelsDevModel` (`provider.ts:1188-1231`) field mapping: `id/name` verbatim, `api: "ai-sdk"`, `baseUrl ← provider.api`, `npm ← model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible"`, cost snake→camelCase, limits, modalities. Drops `tool_call !== true`.
- `src/catalog/compat.ts` — `PROVIDER_COMPAT`: **4-entry** provider-level table (`deepseek`/`zai`/`zai-coding-plan`/`togetherai`). First-party `@ai-sdk/*` providers get NO compat (the factory handles reasoning). Unmapped `@ai-sdk/openai-compatible` providers default to `{ thinkingFormat: "openai" }`.
- `scripts/generate-models.ts` — build-time generator (`nub run generate-models`). Fetches `https://models.dev/api.json`, writes `src/catalog/generated.ts` (single committed file; 1.3 MB).
- `src/catalog/generated.ts` — committed catalog data. Biome override added: formatter+linter disabled, `files.maxSize` bumped to 2 MB.
- `src/catalog/index.ts` — entry point re-exporting `CATALOG`/`ALL_MODELS`/`PROVIDERS`.
- **Verification gate (revised):** provider set matches models.dev = opencode's set. ✓ (142 providers with ≥1 tool-capable model).

### Task 1.5 — `calculateCost` ✓ (TDD: 6 tests)
- `src/cost.ts` — ported verbatim from PI-COST (`models.ts:385-395`), incl. Anthropic `cacheWrite1h` 2× premium. Signature: `calculateCost(model: Model, usage: Usage): Usage["cost"]` (non-generic; mutates in place).

---

## Phase 2 — Provider resolution (port opencode `provider.ts`, plain TS) ✓ DONE

> **15 new tests (62 total) · typecheck clean · ultracite fix clean.**
> Factory injection: tests pass fake factories to verify option passing without
> real API setup.

### Task 2.1 — `BUNDLED_PROVIDERS` registry ✓
- `src/provider/registry.ts` — 11-entry map (the @ai-sdk packages installed in
  the workspace: anthropic, openai, google, google-vertex + /anthropic subpath,
  azure, amazon-bedrock, mistral, openai-compatible, xai, gateway). Each maps
  to `() => import(npm).then(m => m.createX as ProviderFactory)`.
- Factory cast: each `createX` is cast to the generic `ProviderFactory` because
  @ai-sdk packages declare specific, incompatible settings types (e.g.
  `createOpenAICompatible` requires `baseURL`). Safe — the catalog guarantees
  the fields per provider.
- Missing providers (groq, cerebras, togetherai, cohere, etc.) rely on the
  dynamic-import fallback in the resolver. They work when the user installs them.

### Task 2.2 — `resolveLanguageModel` ✓ (TDD: 15 tests)
- `src/provider/resolve.ts` — `resolveLanguageModel(model, options, factoryMap?)`.
  Ports opencode's `resolveSDK` + `getLanguage` to plain TS.
- `resolveBaseURL(url, env)` — pure `${VAR}` substitution helper (extracted,
  top-level regex). Empty URL → undefined (factory default).
- SDK cache: module-level `Map<string, ProviderSDK>` keyed by `JSON({npm, opts})`.
  Skipped when a non-default `factoryMap` is injected (so tests get fresh SDKs).
  `clearResolveCache()` exported for test isolation.
- `buildFactoryOptions` — merges: `options.baseURL ?? model.baseUrl` → resolveBaseURL;
  `options.apiKey`; headers (`options.headers` first, `model.headers` override).
- Dynamic-import fallback (`loadFactoryFromNpm`): when npm not in factory map,
  `import(npm)`, find `create*` export, call it. Skipped opencode's `Npm.add`
  auto-install (desktop app — can't auto-install at runtime).
- Dropped: opencode's fetch/SSE wrapper, `Hash.fast` SDK cache key, custom
  `modelLoaders` plugin hooks, Effect plumbing.

---

## Phase 3 — Compat transform (port opencode `transform.ts`, plain TS)

### Task 3.1 — `buildProviderOptions` (thinkingFormat)
- `src/provider/transform.ts` — `buildProviderOptions(model, level): Record<string, unknown>`.
- **Reads `model.compat.thinkingFormat`** (populated at catalog generation in Phase 1; see `src/catalog/compat.ts`). First-party `@ai-sdk/*` models have NO compat — skip entirely. Only `@ai-sdk/openai-compatible` models reach this logic.
- **opencode's `transform.ts` is the structural template** (how each value emits `providerOptions` for `streamText`). **pi-ai's `openai-completions.ts:594-666` (PI-COMPAT) is the data-values source** (which fields each format produces — preserve these exactly). One branch per `thinkingFormat` value:
  - `zai` → `thinking:{type:"enabled"}` + `reasoning_effort`
  - `qwen` → `enable_thinking: !!effort`
  - `qwen-chat-template` → `chat_template_kwargs.enable_thinking`
  - `chat-template` → `chat_template_kwargs` from compat
  - `deepseek` → `thinking:{type:…}` + `reasoning_effort`
  - `openrouter` → `reasoning:{effort}`
  - `ant-ling` → `reasoning:{effort}` only when effort non-null
  - `together` → `reasoning:{enabled}` + `reasoning_effort`
  - `string-thinking` → top-level `thinking: string`
  - `openai` (fallthrough) → `reasoning_effort`
- Honor `thinkingLevelMap`: `null` → unsupported → omit. Port the resolution verbatim.
- `level === "off"` or `model.reasoning === false` → `{}`.
- **One test per value (10 tests)** asserting the exact `providerOptions` keys, citing the PI-COMPAT line range each branch came from.

### Task 3.2 — `buildHeaders` + cache-control middleware
- `buildHeaders(model, options)`: when `compat.sendSessionAffinityHeaders && options.sessionId`, emit `session_id`/`x-client-request-id`/`x-session-affinity` (mirror PI-COMPAT header logic).
- `applyCacheControl` via `wrapLanguageModel({ model, middleware:[{ specificationVersion:"v3", transformParams }] })` (port OC-STREAM `:325-343`). When `compat.cacheControlFormat === "anthropic"` and cache retention enabled, attach `cache_control:{type:"ephemeral"}` to system prompt / last user message (mirror OC-TRANSFORM `:329-344`).
- Tests: headers present/absent per flag; cache_control markers attached when configured.

---

## Phase 4 — `stream()` entry point

### Task 4.1 — Message conversion
- `src/messages.ts` — `toModelMessages(messages: Message[], system?: string): ModelMessage[]` (returns @ai-sdk `CoreMessage`/`ModelMessage`). Handle: text/image/thinking content, toolCall, tool results, system prompt. Round-trip tests for every content type (text, image, thinking, toolCall, toolResult, multi-content assistant).

### Task 4.2 — `stream()`
- `src/stream.ts`:
  ```ts
  interface StreamRequest {
    model: Model<"ai-sdk">;
    messages: Message[];
    system?: string;
    tools?: /* @ai-sdk ToolSpecification */;
    abortSignal?: AbortSignal;
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    thinkingLevel?: ModelThinkingLevel;
    sessionId?: string;
    apiKey?: string;
  }
  interface FinishResult {
    usage: Usage;         // populated incl. cost via calculateCost
    finishReason: StopReason;
    responseId?: string;
    responseModel?: string;
  }
  interface StreamResult {
    fullStream: AsyncIterable<FullStreamPart>;
    result: Promise<FinishResult>;
  }
  export function stream(req: StreamRequest): StreamResult
  ```
- Wire: `resolveLanguageModel` → `buildProviderOptions` → `buildHeaders` → `wrapLanguageModel` (cache) → `streamText({ model: wrapped, messages: toModelMessages(...), tools, providerOptions, headers, maxRetries: 0, abortSignal, … })`.
- Port the `streamText` option set from OC-STREAM (`:280-353`) line for line.
- `result` promise: on stream finish, read `totalUsage`, map to `Usage` (input/output/totalTokens/cacheRead/cacheWrite from `inputTokenDetails`), run `calculateCost`, map `finishReason` → `StopReason` (`stop`, `length`, `tool-calls`/`tool-use` → `toolUse`, default `stop`).
- **Inject `runStreamText` for tests** so `stream()` is testable with fake parts (no real API calls).

---

## Phase 5 — Agent loop `@ai-sdk`-native cutover

### Task 5.1 — Retarget agent deps
- `packages/agent/package.json`: replace `@earendil-works/pi-ai` → `@sakti-code/llm` (workspace).
- Update every import in `packages/agent/src/**`: message types + `stream` now from `@sakti-code/llm`. (Grep `@earendil-works/pi-ai` → rewrite each.)

### Task 5.2 — Replace stream consumption
- Replace `agent-loop.ts:313-364` (the `streamFunction(...)` + `for await (event of response)` switch) with:
  - `const { fullStream, result } = stream({ model, messages: llmMessages, system, tools, abortSignal, thinkingLevel, sessionId, apiKey, … });`
  - Iterate `fullStream`: `text-start/delta/end` → accumulate text block + emit slim delta; `reasoning-*` → accumulate thinking + emit slim delta (kind:"thinking"); `tool-call` → accumulate tool call; `finish` → read `await result`, build final `AssistantMessage` (content + usage + stopReason + calculateCost already applied); `error` → build error `AssistantMessage`.
  - Accumulator state: current text index, current thinking index, tool-call array, usage. (The accumulator that used to live in pi-ai's 9 API impls now lives here — once.)
- Map @ai-sdk `finishReason` → our `StopReason`.
- Emit lifecycle: `message_start` (on first partial), `message_update` (per delta — slim), `message_end` (final AssistantMessage).

### Task 5.3 — Slim UI seam (Option 2 + perf fix)
- `AgentEvent.message_update` payload (AG-EVENT `:506-511`):
  - **Remove** `assistantMessageEvent: AssistantMessageEvent`.
  - **Remove** the per-token `message: {...partialMessage}` clone (the dead payload — perf invariant).
  - **Add** `delta: { text: string; kind: "text"|"thinking" }`.
  - `message` only flows on `message_start` / `message_end`.
- Update `StreamFn` (AG-STREAMFN) → matches `@sakti-code/llm`'s `stream` signature.

### Task 5.4 — Agent tests
- `agent-loop.test.ts`, `agent.test.ts`: replace `AssistantMessageEvent` fixtures with `fullStream` parts (fake `stream` injected via dep injection); assert accumulation + slim-delta emission + final AssistantMessage usage/cost.
- `harness/*` tests: update fixtures.

---

## Phase 6 — Server + UI cutover

### Task 6.1 — Server WS + replay
- `apps/server/src/agent/replay-runner.ts:~225` (SRV-REPLAY): synthesize `{ type:"message_update", delta:{ text: chunk, kind: deltaType } }` instead of `assistantMessageEvent:{type, contentIndex, delta, partial}`. No `message` field per chunk.
- WS handler forwards `AgentEvent` unchanged (the payload type changed; serialization is structural).
- Update `apps/server/src/__tests__/composition.test.ts`, `ws.test.ts`, `e2e.test.ts`, `compaction.test.ts` fixtures.

### Task 6.2 — Desktop UI reducer
- `apps/desktop/src/stores/session/event-reducer.ts:150-153` (UI-REDUCER): read `event.delta.kind === "text" → batcher.append(msgId, event.delta.text)`; `=== "thinking" → actions.appendThinkingToken(msgId, event.delta.text)`. (4 lines.)
- Update `apps/desktop/src/stores/session/__tests__/event-reducer.test.ts` + `hydrate-messages.ts` if it reads the old field.

---

## Phase 7 — Delete `packages/ai` + finalize

### Task 7.1 — Remove `packages/ai`
- `git rm -r packages/ai` (drops the subtree contents; the squashed-lineage commits stay in history).
- Delete `scripts/sync-pi-ai.sh` (no longer relevant).
- `openspec/MODELS-CATALOG.md` — rewrite as the new `@sakti-code/llm` maintainer guide (or delete; the old pi-subtree playbook is obsolete).
- Keep the `pi` git remote? Optional — harmless. Default: remove (we're done with pi).

### Task 7.2 — No stale imports
- `rg "@earendil-works/pi-ai|AssistantMessageEvent|AssistantMessageEventStream|streamSimple|ProviderStreams"` across `packages/**` and `apps/**` → must be zero hits. (`openspec/references/` excluded — that's the read-only clone.)

### Task 7.3 — Lockfile + workspace
- `pnpm install` regenerates the lockfile without `@earendil-works/pi-ai`.
- Confirm `@sakti-code/llm` resolves in agent, server, desktop.

---

## Phase 8 — Verification

### Task 8.1 — Workspace lint + typecheck
- `nubx ultracite fix` → clean.
- `nub run typecheck` → clean across `packages/llm`, `packages/agent`, `packages/db`, `packages/tools`, `apps/server`, `apps/desktop`.

### Task 8.2 — Test suite green
- `nub run test` across all packages.

### Task 8.3 — Per-provider smoke matrix (gated `SAKTI_SMOKE=1`)
- anthropic, openai, google, xai, groq — live calls through `llm.stream`. Each returns text + correct usage/cost + correct reasoning behavior per `thinkingFormat`.

### Task 8.4 — Streaming perf check
- Confirm WS streaming payload ships deltas only (no per-token message clone). Inspect via a logged payload or WS inspector.

---

## Risk register

- **The old plan's #1 risk (the adapter) is ELIMINATED.** There is no adapter; the agent consumes `fullStream` directly.
- **Provider resolution correctness (Phase 2).** Dynamic import + factory dispatch must match `@ai-sdk`'s expected options. *Mitigation:* per-provider smoke (8.3).
- **Compat regression (Phase 3).** `thinkingFormat` ported wrong → silent reasoning breakage. *Mitigation:* one test per value (10 cases) + smoke.
- **Agent loop cutover (Phase 5).** The loop is ~825 lines; the stream seam is ~30 lines but accumulation logic is real. *Mitigation:* full agent test suite green; do a vertical slice (anthropic only) first before genericizing.
- **models.dev count regression (Phase 1).** *Resolved:* catalog targets opencode's models.dev set (142 providers / 4147 models), not pi-ai's count. Provider-level compat table (`PROVIDER_COMPAT`) covers the 4 openai-compatible providers needing non-default reasoning encoding; first-party `@ai-sdk/*` factories handle the rest.
- **Message conversion bugs (Phase 4.1).** *Mitigation:* round-trip tests for every content type.

## Out of scope

- Image generation via `@ai-sdk` (separate path).
- Runtime models.dev fetch/cache/TTL (build-time only).
- Effect-TS (banned).
- Preserving pi-ai's 9 hand-written API impls (the whole package is deleted in Phase 7).
- Push-back to pi-ai upstream (we no longer track pi).
- Biome/lint overrides beyond the targeted `packages/ai/src/types.ts` one (which itself goes when packages/ai is deleted).
