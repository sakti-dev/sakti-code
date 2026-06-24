# pi-ai → @ai-sdk runtime + models.dev generic ingestion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `@earendil-works/pi-ai` (`packages/ai/`) data-driven from models.dev so every provider is selectable with zero per-provider code, by adopting the opencode method (dynamic `@ai-sdk/*` loading driven by each model's `npm` field) — porting opencode's *proven logic* into pi-ai's existing plain-TS structure, while preserving pi-ai's compat fixes as model metadata.

**Architecture:** Keep pi-ai's plain-TS shape (`Provider` interface, `createProvider`, `Models`, `EventStream`, `async`/`AsyncIterable`) that `packages/agent` and `apps/desktop` already consume. Do **not** adopt Effect-TS. Add three new seams inside `packages/ai/`, each a port of proven opencode logic:
1. **`api/ai-sdk.ts`** — converts `streamText().fullStream` → pi-ai's `AssistantMessageEvent`. Template: opencode `session/llm/ai-sdk.ts` (`toLLMEvents`), reshaped to pi-ai's protocol.
2. **`providers/ai-sdk-loader.ts`** — `BUNDLED_PROVIDERS` + `resolveSdk`. Near-verbatim port of opencode `provider/provider.ts:107-134` and `:1639-1771`.
3. **`providers/ai-sdk-transform.ts`** — compat middleware reading `model.compat`. Branch-by-branch port of pi-ai `openai-completions.ts:594-666` (the fixes), structured like opencode `provider/transform.ts:1257` (`providerOptions`).

models.dev's `provider.npm` field is the routing key. Existing hand-written API impls stay (parallel path); models opt into the @ai-sdk path via `api: "ai-sdk"` + `npm`. The `@sakti-code/agent` package needs **zero changes**.

**Tech Stack:** TypeScript, `vitest`, `@ai-sdk/*` packages, existing pi-ai `typebox` + `EventStream`. **No Effect-TS. No new event layer.**

**Constraints (from `AGENTS.md`):**
- `exactOptionalPropertyTypes: true` → conditional spread `...(x !== undefined ? { x } : {})`, never pass `undefined`.
- TS 6.0 → `include`/`references` top-level; `shell` in `execSync` is a string.
- Tests in `packages/ai/test/*.test.ts`, vitest `globals: true`, node env.
- No `console.log`/`any`; prefer `unknown`. `for...of` over `.forEach`.
- Before commit: `nubx ultracite fix`. Typecheck: `cd packages/ai && nub run typecheck`. Test: `cd packages/ai && nub run test`.

---

## ⚠️ Port Discipline Guardrails — READ BEFORE EVERY TASK

These rules apply to **every** task below. They exist because LLM executors tend to *reinvent* instead of *port*, which introduces slop. Violating any rule requires a written justification in the task's Lineage Map.

### Rule R1 — Read-before-write (mandatory, blocking)
Before writing any code in a task whose title contains "Port" or "Verbatim", the executor MUST first use the Read tool on the exact opencode/pi-ai reference cited in that task's **Reference** block, and quote the relevant lines into its working context. No writing may begin until the reference has been read in the current task. If the reference is unread, the task is incomplete by definition.

### Rule R2 — Lineage Map artifact (mandatory per porting task)
Every task tagged `[PORT]` must produce a **Lineage Map** table appended as a comment block at the top of the new file (or in the test if the file is too small). Format:

```ts
// LINEAGE MAP (do not delete; required by plan guardrail R2)
// SOURCE: openspec/references/opencode/packages/opencode/src/provider/provider.ts
// ┌─ opencode (file:lines) ───────┬─ this file (symbol:lines) ──┬─ identical? ─┬─ divergence ─────────┐
// │ provider.ts:107-134          │ BUNDLED_PROVIDERS           │ yes          │ stripped Effect types │
// │ provider.ts:1639-1700        │ resolveSdk (options block)  │ yes          │ removed Hash cache    │
// └───────────────────────────────┴─────────────────────────────┴──────────────┴───────────────────────┘
```

The `identical?` column is one of: `yes` | `logic-only` (control flow copied, types/Effect stripped) | `adapted` (semantics preserved, shape changed — divergence column MUST explain why).

### Rule R3 — Diff gate before commit
Before the commit step in any `[PORT]` task, the executor must explicitly state in its final message: *"No logic was added that is not present in the cited reference."* If any logic was added, it must either (a) be removed, or (b) be listed in the Lineage Map with a justification. The executing-plans reviewer treats an unjustified addition as a failure.

### Rule R4 — Hard bans
- **No `effect` imports.** No `Layer`, `Effect.gen`, `Context.Service`, `Schema.brand`, `InstanceState`. The words `yield*` may not appear in any new file. If a ported function seems to need Effect, it must be rewritten to plain `async`/`Promise`/`AsyncIterable` — that rewrite IS the task.
- **No new fields on pi-ai's `Model` beyond `npm` and the existing ones.** Do not invent `capabilities`, `variants`, `status` (those are opencode's shape). pi-ai's `Model` stays as defined in `types.ts:660`.
- **No new API wire code.** The `@ai-sdk/*` package IS the wire layer for `api: "ai-sdk"` models. There must be no hand-written `fetch("/v1/messages")`, no SSE parser, no request-body builder for ai-sdk models. (The existing 9 impls are untouched and keep their wire code for non-ai-sdk models.)
- **No reinvented `thinkingFormat` values.** The only legal values are those already in pi-ai's `OpenAICompletionsCompat.thinkingFormat` union (`types.ts:485-495`): `openai | openrouter | deepseek | together | zai | qwen | chat-template | qwen-chat-template | string-thinking | ant-ling`. If a port seems to need a new value, stop and flag it.
- **No `console.log`, `any`, `debugger`.** `unknown` over `any`.

### Rule R5 — Test intent preservation
When migrating an existing pi-ai test (Phase 5), the executor MUST cite the original test file + the assertion being preserved, and the new assertion must test the **same intent** (e.g. "ZAI sends `thinking.type: "enabled"`"). Only the exact request field paths may shift to match what `@ai-sdk/openai-compatible` emits. A migration that weakens the assertion is a failure.

### Rule R6 — Single source of truth for "what opencode does"
If, during a port, the executor is unsure how opencode handles a case, the answer is **read the reference again**, not reason about it. Cite the line you relied on. If opencode and pi-ai genuinely conflict (e.g. a thinkingFormat value opencode lacks), the pi-ai behavior wins (we're preserving pi-ai's fixes) and the Lineage Map records the conflict.

---

## Reference Manifest

One place to find every source the plan cites. **Verify each path exists before relying on it.**

| ID | Path | What it is | Used by |
|----|------|-----------|---------|
| OC-LOADER | `openspec/references/opencode/packages/opencode/src/provider/provider.ts:107-134` | `BUNDLED_PROVIDERS` map | Task 2.1 |
| OC-RESOLVE | `…/provider/provider.ts:1639-1771` | `resolveSDK` (options/baseURL/apiKey/headers + dynamic import) | Task 2.2 |
| OC-GETLANG | `…/provider/provider.ts:1801-1830` | `getLanguage` (sdk → languageModel dispatch) | Task 2.2 |
| OC-MD-MODEL | `…/provider/provider.ts:1188-1237` | `fromModelsDevModel` (field mapping) | Task 4.2 |
| OC-MD-PROV | `…/provider/provider.ts:1239-1271` | `fromModelsDevProvider` (loop over models) | Task 4.2 |
| OC-ADAPTER | `openspec/references/opencode/packages/opencode/src/session/llm/ai-sdk.ts` (whole, 288 lines) | `toLLMEvents` — fullStream → LLMEvent switch | Task 1.1-1.3 |
| OC-STREAM | `…/session/llm.ts:280-353` | `streamText` call + options | Task 2.3, 3.3 |
| OC-WRAP | `…/session/llm.ts:325-343` | `wrapLanguageModel` + `transformParams` middleware | Task 3.3 |
| OC-TRANSFORM | `openspec/references/opencode/packages/opencode/src/provider/transform.ts:1257-1170` region | `providerOptions`, reasoning translation, `switch(model.api.npm):731`, cache_control `:329-344`, enable_thinking `:1109,1166` | Task 3.1-3.2 |
| OC-MD-SVC | `openspec/references/opencode/packages/core/src/models-dev.ts` | fetch/cache/TTL (Effect — **reference only, do not port**) | Task 4.3 |
| PI-COMPAT | `packages/ai/src/api/openai-completions.ts:594-666` | `thinkingFormat` switch (the fixes — **primary port source**) | Task 3.1 |
| PI-CACHE | `packages/ai/src/api/openai-completions.ts:731` | `cacheControlFormat` handling | Task 3.2 |
| PI-MODEL | `packages/ai/src/types.ts:660-690` | pi-ai `Model` interface | Task 0.2 |
| PI-EVENT | `packages/ai/src/types.ts:447-459` | `AssistantMessageEvent` protocol | Task 1.1 |
| PI-USAGE | `packages/ai/src/types.ts:352-367` | `Usage` shape | Task 1.1 |
| PI-COST | `packages/ai/src/models.ts:385-395` | `calculateCost` | Task 1.3 |
| PI-EVSTREAM | `packages/ai/src/utils/event-stream.ts` | `AssistantMessageEventStream` | Task 1.1 |
| PI-LAZY | `packages/ai/src/api/lazy.ts` | `lazyStream`, `lazyApi` | Task 2.3 |
| PI-PROVIDER | `packages/ai/src/models.ts:32-72, 295-369` | `Provider` interface + `createProvider` | Task 5.1 |
| PI-AUTH | `packages/ai/src/auth/types.ts` | `ProviderAuth`, `AuthResult`, `ModelAuth` | Task 2.2, 5.1 |
| PI-GENMODEL | `packages/ai/scripts/generate-models.ts` | current per-provider ingestion | Task 4.3 |
| PI-ALL | `packages/ai/src/providers/all.ts` | `builtinProviders` | Task 5.2 |
| AG-STREAM | `packages/agent/src/types.ts:24-26` | `StreamFn` | Task 6.1 |
| AG-AGENT | `packages/agent/src/agent.ts:270` | `streamFn ?? streamSimple` | Task 6.1 |

---

## Phase 0 — Dependencies & types

### Task 0.1: Add @ai-sdk dependencies

**Files:** Modify `packages/ai/package.json`

**Step 1:** Before editing, run `npm view ai version @ai-sdk/anthropic version @ai-sdk/openai-compatible version @ai-sdk/google version @ai-sdk/openai version` and record the latest versions. Cross-check against opencode's `openspec/references/opencode/packages/opencode/package.json` — prefer the exact versions opencode pins, so the ported behavior matches.

**Step 2:** Add to `dependencies`: `ai`, `@ai-sdk/provider`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/google-vertex`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, `@ai-sdk/azure`, `@ai-sdk/amazon-bedrock`, `@ai-sdk/mistral`, `@ai-sdk/xai` (versions from Step 1).

**Step 3:** `nub install` (workspace root). Verify `node_modules/ai` and `node_modules/@ai-sdk/anthropic` exist.

**Step 4:** `git add packages/ai/package.json package-lock.json && git commit -m "feat(ai): add @ai-sdk runtime dependencies"`

---

### Task 0.2: Add `"ai-sdk"` Api + `Model.npm` field `[PORT]`

**Reference (R1):** Read PI-MODEL (`packages/ai/src/types.ts:660-690`) and PI-EVENT (`:447-459`). Quote the current `Model` and `KnownApi` into your context before editing.

**Files:** Modify `packages/ai/src/types.ts`; Create `packages/ai/test/ai-sdk-model-type.test.ts`

**Port rules:**
- Add `"ai-sdk"` to the `KnownApi` union (PI-EVENT region `:15-24`). Do not reorder existing members.
- Add `npm?: string;` as the **last** field of `Model`. Do not add any other field.
- For `compat` on `Model<"ai-sdk">`, reuse `OpenAICompletionsCompat` (the fixes are authored against it). Add the conditional branch `TApi extends "ai-sdk" ? OpenAICompletionsCompat : …` to the existing `compat` ternary. Do not invent a new compat shape.

**Step 1 — failing test:**
```ts
import { describe, expect, it } from "vitest";
import type { Api, Model } from "../src/types.ts";

describe("Model ai-sdk support", () => {
  it("accepts api 'ai-sdk' with npm + OpenAICompletionsCompat", () => {
    const model: Model<"ai-sdk"> = {
      id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5",
      api: "ai-sdk", provider: "anthropic", baseUrl: "https://api.anthropic.com",
      reasoning: true, input: ["text", "image"],
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      contextWindow: 200000, maxTokens: 64000,
      npm: "@ai-sdk/anthropic",
      compat: { thinkingFormat: "openai" },
    };
    expect(model.npm).toBe("@ai-sdk/anthropic");
    expect(model.api).toBe("ai-sdk");
  });
  it("treats ai-sdk as a known Api", () => {
    const a: Api = "ai-sdk";
    expect(a).toBe("ai-sdk");
  });
});
```

**Step 2:** `cd packages/ai && nub run test -- ai-sdk-model-type` → FAIL (type errors).

**Step 3:** Edit `types.ts` per port rules.

**Step 4:** Re-run → PASS. `nub run typecheck` → no new errors.

**Cross-check (R3):** Confirm you added exactly one union member and one optional field. State: "No logic was added that is not present in the cited reference."

**Step 5:** Commit `feat(ai): add 'ai-sdk' Api variant and Model.npm field`.

---

## Phase 1 — streamText → AssistantMessageEvent adapter

> This is the **one unavoidably new** piece (opencode's adapter targets `LLMEvent`; we target `AssistantMessageEvent`). Build it tight: every `fullStream` part type opencode handles must be handled here, in the same order, with the same finishReason mapping. Use OC-ADAPTER as the case-by-case checklist.

### Task 1.1: Adapter — text streaming + finish/usage `[PORT]`

**Reference (R1):** Read OC-ADAPTER in full (the whole `ai-sdk.ts` file). Read PI-EVENT, PI-USAGE, PI-COST, PI-EVSTREAM. Quote: opencode's `usage()` function (OC-ADAPTER `:44-64`), opencode's `finishReason` mapping (`:21-23`), and pi-ai's `AssistantMessageEvent` union.

**Files:** Create `packages/ai/src/api/ai-sdk.ts`, `packages/ai/test/ai-sdk-adapter.test.ts`

**Port rules:**
- The switch over `event.type` MUST enumerate the **same cases** as opencode's `toLLMEvents` (OC-ADAPTER `:80-285`): `start, start-step, finish-step, finish, text-start/delta/end, reasoning-start/delta/end, tool-input-start/delta/end, tool-call, tool-result, tool-error, error, abort, source, file, raw`. Do not drop cases. Cases with no pi-ai equivalent (`start-step`, `source`, `file`, `raw`, `tool-output-denied`, `tool-approval-request`) are matched and produce no events (mirror opencode returning `Effect.succeed([])`).
- `usageFrom` MUST port opencode's `usage()` field reads verbatim: `inputTokens`, `outputTokens`, `totalTokens`, `reasoningTokens`, `cachedInputTokens`, `inputTokenDetails.cacheReadTokens`, `inputTokenDetails.cacheWriteTokens`, `outputTokenDetails.reasoningTokens`. Assign into pi-ai's `Usage` (PI-USAGE).
- **Critical difference to implement (not port):** pi-ai events carry an accumulated **partial `AssistantMessage`** on every event (PI-EVENT). opencode's LLMEvent does not. So the adapter maintains an accumulator and clones the partial onto each emitted event. This is the sole structural divergence — record it in the Lineage Map as `adapted: partial-message accumulation, required by PI-EVENT protocol`.
- `mapStopReason`: port opencode's accepted values and add pi-ai's `toolUse` mapping for `tool-calls`/`tool-use`. Default `"stop"`.
- On `finish`, call pi-ai's `calculateCost` (PI-COST) on the resolved usage so `cost.total` is populated. opencode does not do this (LLMEvent carries cost separately) — this is a required pi-ai adaptation, record it.

**Lineage Map (R2)** at top of `api/ai-sdk.ts`: map each opencode case line to your handler line.

**Step 1 — failing test** (text streaming, full happy path):
```ts
import { describe, expect, it } from "vitest";
import { streamEventsFromFullStream } from "../src/api/ai-sdk.ts";
import type { Model } from "../src/types.ts";

const baseModel: Model<"ai-sdk"> = {
  id: "m", name: "M", api: "ai-sdk", provider: "p", baseUrl: "",
  reasoning: false, input: ["text"],
  cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 0, maxTokens: 0, npm: "@ai-sdk/openai-compatible",
};
async function* fake(parts: any[]) { for (const p of parts) yield p; }
async function collect<T>(s: AsyncIterable<T>): Promise<T[]> { const o: T[] = []; for await (const e of s) o.push(e); return o; }

describe("ai-sdk adapter text", () => {
  it("emits start -> text_* -> done with accumulated partial + cost", async () => {
    const events = await collect(streamEventsFromFullStream(baseModel, fake([
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", text: "Hel" },
      { type: "text-delta", id: "t1", text: "lo" },
      { type: "text-end", id: "t1" },
      { type: "finish", finishReason: "stop", totalUsage: { inputTokens: 1000000, outputTokens: 1000000 } },
    ])));
    expect(events.map((e) => e.type)).toEqual(["start","text_start","text_delta","text_delta","text_end","done"]);
    const done = events.at(-1)!;
    if (done.type === "done") {
      expect(done.message.content).toEqual([{ type: "text", text: "Hello" }]);
      expect(done.message.stopReason).toBe("stop");
      expect(done.message.usage.input).toBe(1000000);
      expect(done.message.usage.cost.total).toBe(18); // 3 + 15 per million
    }
  });
});
```

**Step 2:** Run → FAIL (module missing).

**Step 3:** Implement `api/ai-sdk.ts`. Skeleton:
```ts
import type { Api, AssistantMessage, AssistantMessageEvent, Model, StopReason, TextContent, ThinkingContent, ToolCall, Usage } from "../types.ts";
import { calculateCost } from "../models.ts";

type FullStreamPart = /* discriminated union of every case enumerated above */;
interface Acc { partial: AssistantMessage; textIdx: number; thinkIdx: number; toolIdx: number; texts: Map<string|undefined,{i:number;s:string}>; thinks: Map<string|undefined,{i:number;s:string}>; }

export async function* streamEventsFromFullStream(model: Model<Api>, fullStream: AsyncIterable<FullStreamPart>): AsyncGenerator<AssistantMessageEvent> {
  const acc: Acc = { /* init with initialPartial(model) */ };
  yield { type: "start", partial: snap(acc.partial) };
  for await (const part of fullStream) yield* handle(acc, model, part);
}
// handle(): switch over part.type — port each OC-ADAPTER case
// usageFrom(): port OC-ADAPTER usage() reads verbatim -> pi-ai Usage
// mapStopReason(): port + add toolUse
```

**Step 4:** Run → PASS.

**Cross-check (R3):** Open OC-ADAPTER side by side. For each case in opencode's switch, confirm your switch has a matching arm. List any opencode case you did NOT implement. (Source/file/raw/start-step must be no-ops — present but empty.) State the R3 sentence.

**Step 5:** Commit `feat(ai): streamText fullStream -> AssistantMessageEvent adapter (text + usage)`.

---

### Task 1.2: Adapter — thinking, tool-call, error, length cases `[PORT]`

**Reference (R1):** Re-read OC-ADAPTER `reasoning-*` (`:158-188`), `tool-call` (`:220-232`), `error` (`:264-265`), and `finish-step`/`finish` finishReason handling (`:87-124`).

**Files:** Modify `packages/ai/test/ai-sdk-adapter.test.ts` (adapter code from 1.1 already handles these — these are regression guards).

**Port rules:** Add one test per opencode case. Each test's input parts mirror the opencode case's event shape.

```ts
it("reasoning-* -> thinking_*", async () => { /* reasoning-start/delta/end */ });
it("tool-call -> toolcall_end with input object", async () => { /* toolCallId/toolName/input */ });
it("error part -> error event + stopReason 'error'", async () => {});
it("length finishReason -> stopReason 'length'", async () => {});
it("tool-calls finishReason -> stopReason 'toolUse'", async () => {});
```

**Cross-check:** Confirm `tool-calls`/`tool-use` map to `toolUse` (pi-ai only; opencode has no equivalent — `adapted` in Lineage Map).

Run → PASS. Commit `test(ai): cover thinking/tool/error/length in ai-sdk adapter`.

---

### Task 1.3: Adapter — cost calculation + cache token accounting `[PORT]`

**Reference (R1):** PI-COST (`models.ts:385-395`) and OC-ADAPTER `usage()` (`:44-64`).

**Port rules:**
- The adapter must read `inputTokenDetails.cacheReadTokens`/`cacheWriteTokens` (opencode's `usage()` does) and assign to `Usage.cacheRead`/`cacheWrite`.
- `calculateCost` must run on `finish` so `cost.total` is set. Add a test that asserts `cost.cacheRead` is populated when the stream reports `inputTokenDetails.cacheReadTokens`.

Run → PASS. Commit `test(ai): verify cost + cache token accounting in adapter`.

---

## Phase 2 — Dynamic @ai-sdk loader

### Task 2.1: BUNDLED_PROVIDERS lazy registry `[PORT][VERBATIM]`

**Reference (R1):** Read OC-LOADER (`provider.ts:107-134`) in full. Quote it.

**Files:** Create `packages/ai/src/providers/ai-sdk-loader.ts`, `packages/ai/test/ai-sdk-loader.test.ts`

**Port rules:**
- This is the closest-to-verbatim port in the plan. Copy the registry **entry-for-entry**: `@ai-sdk/amazon-bedrock, @ai-sdk/amazon-bedrock/mantle, @ai-sdk/anthropic, @ai-sdk/azure, @ai-sdk/google, @ai-sdk/google-vertex, @ai-sdk/google-vertex/anthropic, @ai-sdk/openai, @ai-sdk/openai-compatible, @openrouter/ai-sdk-provider, @ai-sdk/xai, @ai-sdk/mistral, @ai-sdk/groq, @ai-sdk/deepinfra, @ai-sdk/cerebras, @ai-sdk/cohere, @ai-sdk/gateway, @ai-sdk/togetherai, @ai-sdk/perplexity, @ai-sdk/vercel, @ai-sdk/alibaba, gitlab-ai-provider, @ai-sdk/github-copilot, venice-ai-sdk-provider`. Each maps to `() => import(NPM).then(m => m.createX)`. Keep the same `createX` export names.
- **Type-only divergence (record in Lineage Map as `logic-only`):** opencode types the factory as `(opts: any) => BundledSDK`. Use `(opts: Record<string, unknown>) => { languageModel(modelId: string): unknown }`. The `unknown` is intentional — pi-ai doesn't need @ai-sdk's `LanguageModelV3` type at this layer; the adapter (Phase 1) consumes the runtime via `streamText`, not the typed object.
- Drop opencode-only entries that pull internal paths (`@opencode-ai/core/github-copilot/copilot-provider`) — leave a `// TODO` and skip; covered by runtime-install fallback (Task 6.2).

**Lineage Map:** one row per entry, all `yes` except the github-copilot row (`adapted: skipped, internal path`).

**Step 1 — failing test:** asserts `BUNDLED_PROVIDERS["@ai-sdk/anthropic"]` is a function, and `resolveSdkFactory("@ai-sdk/anthropic")` resolves to a function.

**Step 2-4:** Run FAIL → implement → PASS.

**Cross-check (R3):** Side-by-side the registry. Every entry present except the flagged internal one. State R3 sentence.

**Step 5:** Commit `feat(ai): BUNDLED_PROVIDERS lazy registry (port opencode provider.ts:107-134)`.

---

### Task 2.2: resolveSdk — options from auth + languageModel dispatch `[PORT]`

**Reference (R1):** Read OC-RESOLVE (`provider.ts:1639-1771`) and OC-GETLANG (`:1801-1830`). Also PI-AUTH (`auth/types.ts`). Quote the options-building block (`:1642-1699`) and the dispatch (`:1809-1823`).

**Files:** Modify `packages/ai/src/providers/ai-sdk-loader.ts`, `packages/ai/test/ai-sdk-loader.test.ts`

**Port rules (logic-only — strip Effect):**
- Port the **options-building logic** from OC-RESOLVE verbatim into plain TS:
  - `baseURL` resolution: prefer an explicit `options.baseURL`, else `model.baseUrl`; variable substitution `${VAR}` from env (OC-RESOLVE `:1664-1683`) — keep this.
  - `apiKey` assignment: `options.apiKey === undefined && provider.key → options.apiKey = provider.key` (OC-RESOLVE `:1686`). In pi-ai, the key comes from `AuthResult.auth.apiKey` (PI-AUTH) — pass it in as `provider.key`.
  - headers merge (OC-RESOLVE `:1687-1691`).
- Port the **dispatch** from OC-GETLANG: resolve factory → `factory(options).languageModel(model.api.id)` (OC-GETLANG `:1810-1821`). Skip opencode's `modelLoaders` custom path (Bedrock special-case) — record as `adapted: skipped modelLoaders, not needed for ai-sdk path`.
- **Drop (record in Lineage Map):** opencode's `Hash.fast` SDK cache (`:1693-1701`) — replace with a simple `Map<string, unknown>` keyed by `JSON.stringify({npm, options})`. Same semantics, plain TS.
- **Drop:** the custom `fetch`/SSE wrapper (`:1703-1734`) — `@ai-sdk/openai-compatible` handles fetch; we don't wrap it. Record as `adapted: fetch wrapping not required`.
- **Drop:** runtime `Npm.add()` install path (`:1747-1754`) for now — Task 6.2 adds it.

**Step 1 — failing test** (inject a stub factory via a registry override, per Task 2.1's test pattern): `resolveSdk({ npm, apiKey, baseUrl, modelId, headers }, { "@ai-sdk/stub": () => Promise.resolve(stub) })` returns an object whose `id === modelId` and whose options include `apiKey`/`baseURL`/`headers`.

**Step 2-4:** FAIL → implement → PASS.

**Cross-check:** Confirm baseURL `${VAR}` substitution logic matches OC-RESOLVE `:1678-1682` line for line.

**Step 5:** Commit `feat(ai): resolveSdk builds languageModel from auth options (port opencode provider.ts:1639-1771)`.

---

### Task 2.3: ProviderStreams wrapper — lazyStream over streamText `[PORT]`

**Reference (R1):** Read OC-STREAM (`session/llm.ts:280-353`) and PI-LAZY (`api/lazy.ts`). Quote `streamText({...})` options and `lazyStream`'s signature.

**Files:** Create `packages/ai/src/providers/ai-sdk-streams.ts`, `packages/ai/test/ai-sdk-streams.test.ts`

**Port rules:**
- Implement `createAISdkStreams({ resolveLanguage, runStreamText })` returning pi-ai `ProviderStreams` (PI types `:222`). Both `stream` and `streamSimple` use `lazyStream` (PI-LAZY) to return synchronously while `resolveLanguage` (Task 2.2) resolves, then pipe `runStreamText()` (which wraps the real `streamText`) through `streamEventsFromFullStream` (Phase 1).
- Port the `streamText` option set from OC-STREAM `:280-353`: `model` (the resolved language, wrapped — Task 3.3 adds `wrapLanguageModel`), `messages`, `tools`, `toolChoice`, `temperature`, `topP`, `topK`, `maxOutputTokens`, `abortSignal`, `headers`, `providerOptions`, `maxRetries: 0`. Convert pi-ai `Context` → `streamText` messages (pi-ai `Message` → `ai` `ModelMessage` — write a small `toModelMessages` helper; this is glue, not ported).
- **Inject `runStreamText` for tests** so the adapter can be tested without real API calls (the test feeds fake parts).

**Step 1 — failing test:** `createAISdkStreams({ resolveLanguage: async () => ({}), runStreamText: async function*(){ yield {type:"finish", finishReason:"stop", totalUsage:{inputTokens:1,outputTokens:0}} } }).streamSimple(model, ctx, {})` → iterating yields a final `done` event.

**Step 2-4:** FAIL → implement → PASS.

**Cross-check:** Confirm the `streamText` option list matches OC-STREAM line for line (every option opencode passes, we pass).

**Step 5:** Commit `feat(ai): ProviderStreams wrapper over streamText (port opencode llm.ts:280-353)`.

---

## Phase 3 — Compat middleware (preserving the fixes)

> This is where pi-ai's years of provider fixes survive. The fixes are **data** (`model.compat.thinkingFormat`, `model.thinkingLevelMap`, `cacheControlFormat`). Phase 0.2 kept that data on `Model<"ai-sdk">`. Now port the **consumption** logic so the data still drives behavior — only the *sink* changes (from raw request fields in `openai-completions.ts` to `providerOptions`/headers in `streamText`).

### Task 3.1: thinkingFormat → providerOptions `[PORT]`

**Reference (R1):** Read **both** — PI-COMPAT (`openai-completions.ts:594-666`) is the **primary** source (the data values and semantics we must preserve); OC-TRANSFORM (`transform.ts:1067-1170`, the `providerOptions` + reasoning translation region, and `switch(model.api.npm):731`) is the **structural** template (how opencode emits providerOptions for `streamText`).

**Files:** Create `packages/ai/src/providers/ai-sdk-transform.ts`, `packages/ai/test/ai-sdk-transform.test.ts`

**Port rules:**
- Implement `buildProviderOptions(model: Model<"ai-sdk">, level: ModelThinkingLevel): Record<string, unknown>`.
- **Branch-by-branch port of PI-COMPAT `:594-666`.** For each `thinkingFormat` value, reproduce the exact request-field semantics opencode-completions built, but emit them as `providerOptions` keys (which `@ai-sdk/openai-compatible` merges into the request body). One row per value in the Lineage Map:
  - `zai` → `thinking: { type: "enabled" }` + `reasoning_effort` (PI-COMPAT `:594-606`)
  - `qwen` → `enable_thinking: !!effort` (`:607-608`)
  - `qwen-chat-template` → `chat_template_kwargs.enable_thinking` (`:609-613`)
  - `chat-template` → `chat_template_kwargs` from compat (`:614-618`)
  - `deepseek` → `thinking: { type: ... }` + `reasoning_effort` (`:619-628`)
  - `openrouter` → `reasoning: { effort }` (`:629-638`)
  - `ant-ling` → `reasoning: { effort }` only when effort non-null (`:639-643`)
  - `together` → `reasoning: { enabled }` + `reasoning_effort` (`:644-652`)
  - `string-thinking` → top-level `thinking: string` (`:653-660`)
  - `openai` (fallthrough) → `reasoning_effort` (`:661-666`)
- **Honor `thinkingLevelMap`** exactly as PI-COMPAT does: a level mapped to `null` means unsupported → omit. The mapped string overrides the pi-ai level. Port this resolution verbatim.
- When `level === "off"` or `model.reasoning === false`, return `{}` (no reasoning fields).
- **Do not invent** reasoning fields. If a branch seems to need a field not in PI-COMPAT, stop and flag (Rule R4).

**Lineage Map:** one row per `thinkingFormat` value above, citing the PI-COMPAT line range and the transform.ts line you used as the providerOptions-shape reference.

**Step 1 — failing tests:** one per `thinkingFormat` value (10 tests), each asserting the exact `providerOptions` keys. Example for `zai`:
```ts
it("zai -> thinking.type enabled + reasoning_effort", () => {
  expect(buildProviderOptions(model({ compat: { thinkingFormat: "zai" } }), "high"))
    .toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "high" });
});
```

**Step 2-4:** FAIL → implement each branch from PI-COMPAT → PASS one branch at a time (commit per branch is acceptable).

**Cross-check (R3):** For each of the 10 values, open PI-COMPAT at the cited lines and confirm the fields emitted match. List any value whose test asserts a field NOT present in PI-COMPAT — those must be removed.

**Step 5:** Commit `feat(ai): port thinkingFormat compat -> ai-sdk providerOptions (openai-completions.ts:594-666)`.

---

### Task 3.2: cacheControlFormat + session-affinity headers `[PORT]`

**Reference (R1):** PI-CACHE (`openai-completions.ts:731`) and the cache_control marker insertion logic above it; OC-TRANSFORM cache_control region (`transform.ts:329-344`); `compat.sendSessionAffinityHeaders`/`supportsLongCacheRetention` from PI types.

**Files:** Modify `packages/ai/src/providers/ai-sdk-transform.ts`

**Port rules:**
- `buildHeaders(model, options)`: when `compat.sendSessionAffinityHeaders` and `options.sessionId`, emit `x-session-affinity`/`session_id`/`x-client-request-id` headers — mirror PI-COMPAT's header logic.
- `applyCacheControl(messages, model, options)`: when `compat.cacheControlFormat === "anthropic"` and `cacheRetention !== "none"`, attach `cache_control: { type: "ephemeral" }` to system prompt / last user message — mirror OC-TRANSFORM `:329-344` (that's the structural template) and PI-CACHE's gating condition.

**Tests:** assert headers present/absent per compat flag; assert cache_control markers attached when configured.

**Cross-check:** confirm the marker positions match OC-TRANSFORM `:329-344`.

Commit `feat(ai): port cacheControlFormat + session affinity (openai-completions.ts:731, transform.ts:329-344)`.

---

### Task 3.3: wrapLanguageModel integration `[PORT]`

**Reference (R1):** OC-WRAP (`llm.ts:325-343`). Quote the `wrapLanguageModel({ model, middleware: [{ specificationVersion: "v3", transformParams }] })` block.

**Files:** Modify `packages/ai/src/providers/ai-sdk-streams.ts`

**Port rules:**
- Wire `buildProviderOptions` (3.1) → `streamText({ providerOptions })`.
- Wire `buildHeaders` (3.2) → `streamText({ headers })`.
- Wire `applyCacheControl` (3.2) via a `wrapLanguageModel` middleware whose `transformParams` mutates `args.params.prompt` (mirror OC-WRAP `:330-338`). `specificationVersion: "v3"`.

**Test:** integration — a model with `cacheControlFormat: "anthropic"` produces a stream whose transformed prompt (captured via a spy on `runStreamText`) carries `cache_control`.

**Cross-check:** the middleware shape matches OC-WRAP line for line.

Commit `feat(ai): wire compat middleware via wrapLanguageModel (port llm.ts:325-343)`.

---

## Phase 4 — Generic models.dev ingestion

### Task 4.1: npm → routing helper

**Files:** Create `packages/ai/scripts/models-dev-routing.ts`, test.

`routeForNpm(npm?) → { api: "ai-sdk", npm }`, defaulting undefined to `@ai-sdk/openai-compatible`. Trivial; one test. Commit `feat(ai): npm routing helper`.

---

### Task 4.2: Generic models.dev → Model<"ai-sdk"> converter `[PORT]`

**Reference (R1):** Read OC-MD-MODEL (`provider.ts:1188-1237`) and OC-MD-PROV (`:1239-1271`). Read PI-GENMODEL (`scripts/generate-models.ts`) lines `714-850` (the existing per-provider field mapping for cost/limit/modalities) — this is what we factor out.

**Files:** Create `packages/ai/scripts/models-dev-generic.ts`, test.

**Port rules:**
- One function: `convertModelsDev(data: ModelsDevJson): Record<string, Model<"ai-sdk">[]>`.
- **Loop structure** ported from OC-MD-PROV (`:1239-1271`): iterate providers → iterate `provider.models` → emit a `Model<"ai-sdk">`.
- **Field mapping** from OC-MD-MODEL (`:1188-1237`) into pi-ai's `Model` shape (PI-MODEL):
  - `model.id` → `Model.id`; `model.name` → `Model.name`
  - `provider.npm ?? model.provider?.npm` → `Model.npm` (via `routeForNpm`)
  - `provider.api ?? model.provider?.api` → `Model.baseUrl`
  - `provider.env` → (used downstream by auth, not stored on Model in pi-ai)
  - cost (`model.cost.input/output/cache_read/cache_write`) → `Model.cost` (factor out of PI-GENMODEL `:749-754`)
  - `model.limit.context/output` → `contextWindow`/`maxTokens`
  - `model.modalities.input.includes("image")` → `input: ["text","image"]` else `["text"]`
  - `model.reasoning` → `Model.reasoning`; `model.tool_call` filter (skip models where `tool_call !== true`) — port this gate from PI-GENMODEL.
- **Preserve the fixes as data** — `COMPAT_OVERRIDES: Record<string, OpenAICompletionsCompat>` keyed by `${provider}` and `${provider}:${modelId}`, seeded from the values currently hardcoded in PI-GENMODEL (ZAI `thinkingFormat:"zai"`, NVIDIA compat, Together compat, Cloudflare, etc.). When converting, `model.compat = COMPAT_OVERRIDES[`${provider}:${modelId}`] ?? COMPAT_OVERRIDES[provider]`. **Extract every compat object verbatim from PI-GENMODEL** — do not paraphrase. The Lineage Map cites where each override came from.

**Tests:** feed a 2-provider fake models.dev payload; assert both providers yield `Model<"ai-sdk">[]` with correct `npm`/`baseUrl`/`compat`. Assert a model with `tool_call !== true` is dropped.

**Cross-check:** For each `COMPAT_OVERRIDES` entry, open PI-GENMODEL at the line it came from and confirm the object is identical.

Commit `feat(ai): generic models.dev -> Model<ai-sdk> converter (port provider.ts:1188-1271)`.

---

### Task 4.3: Rewrite generate-models.ts to emit ai-sdk models `[PORT]`

**Reference (R1):** Re-read PI-GENMODEL in full and OC-MD-SVC (`core/src/models-dev.ts`) — **reference only, do not port the Effect**.

**Files:** Modify `packages/ai/scripts/generate-models.ts`

**Port rules:**
- Replace the body of `loadModelsDevData()` with a call to `convertModelsDev(data)` (Task 4.2). Delete the ~30 per-provider `if (data.X?.models)` blocks (PI-GENMODEL `:723-1480`).
- **Keep** the dynamic-fetch blocks for OpenRouter / Vercel AI Gateway / NVIDIA NIM (those fetch live catalogs, not models.dev — PI-GENMODEL `:598-712`). They now emit `Model<"ai-sdk">` with `npm: "@ai-sdk/openai-compatible"` and their existing compat (carried via `COMPAT_OVERRIDES`).
- **Keep** all the thinking-level-map / anthropic-adaptive / opencode-go-quirk fixups (PI-GENMODEL `:225-551`, `:1293-1321`) — these become `COMPAT_OVERRIDES` / `thinkingLevelMap` data consumed by Task 3.1. Move them into the override table from 4.2.
- Do **not** port OC-MD-SVC's fetch/cache/TTL/`Flock` (Effect). pi-ai already fetches models.dev at build time (`generate-models.ts` runs in `npm run build`); runtime caching is a separate concern (defer).

**Step 1:** `cd packages/ai && npm run generate-models`.

**Step 2 — verification gate:** `git diff packages/ai/src/providers/*.models.ts`. Per-provider model **counts must match** the pre-change run (no models lost). Each model now carries `api: "ai-sdk"` + `npm`. If counts differ, the converter has a bug — fix before committing.

**Step 3:** `nub run test`. Many existing compat tests will go red (they target the old api impls) — that's Phase 5's scope, not this commit. Commit the generation change isolated: `refactor(ai): generate-models emits ai-sdk models from models.dev (port provider.ts fromModelsDev*)`. Note in the commit body that test migration is tracked in Phase 5.

---

## Phase 5 — Provider factory + registration + test migration

### Task 5.1: createAISdkProvider factory

**Reference (R1):** PI-PROVIDER (`models.ts:32-72, 295-369`) and `providers/anthropic.ts:7-19` (shape template).

**Files:** Create `packages/ai/src/providers/ai-sdk-provider.ts`

Implement `createAISdkProvider(id, name, models, envVars, baseUrl): Provider<"ai-sdk">` using `createProvider` with `api = createAISdkStreams(...)` (Phase 2/3) and `auth = envApiKeyAuth(envVars)` (PI-AUTH). The streams wrapper needs `resolveLanguage` to call `resolveSdk` with the per-request `AuthResult`.

Commit `feat(ai): createAISdkProvider factory`.

---

### Task 5.2: Register ai-sdk providers in all.ts `[PORT]`

**Reference (R1):** PI-ALL (`providers/all.ts`).

**Files:** Modify `packages/ai/src/providers/all.ts`

Add `builtinAISdkProviders()` that reads the regenerated `models.generated.ts` and emits one `createAISdkProvider` per provider entry (using `provider.env` for auth — extract from models.dev data, stored alongside the catalog). Include in `builtinProviders()`.

**Cross-check:** every provider key in `MODELS` (models.generated.ts) has a registered provider.

Commit `feat(ai): register ai-sdk providers from generated catalog`.

---

### Task 5.3: Migrate compat tests to the ai-sdk path `[PORT]` (Rule R5)

**Reference (R1):** For each `packages/ai/test/*-compat.test.ts` and `test/anthropic-*.test.ts`, the test file itself is the reference.

**Files:** `packages/ai/test/*.test.ts` (one provider per commit)

**Port rules (R5):**
- For each test: cite the original file + assertion at the top of the migrated test in a comment.
- Switch the model under test to `api: "ai-sdk"` + the appropriate `npm` + the same `compat` it had.
- Preserve the assertion **intent**. Update only the exact request field paths if `@ai-sdk/openai-compatible` emits a different shape (e.g. nested differently). If a field is now in `providerOptions`, assert against the captured `streamText` providerOptions instead of the raw body.
- One commit per provider: `test(ai): migrate <provider> compat tests to ai-sdk`. After each, `nub run test` must be green.

**Cross-check (R5):** for each migrated assertion, the executor states the original line and confirms the intent is preserved. A weakened assertion is a failure.

---

## Phase 6 — Agent wiring + runtime fallback

### Task 6.1: Verify agent package unchanged

**Reference (R1):** AG-STREAM (`packages/agent/src/types.ts:24-26`), AG-AGENT (`agent.ts:270`).

Confirm: `Model<"ai-sdk">` satisfies `Model<Api>`; pi-ai `Models.streamSimple` dispatches to the provider's `streamSimple` (now the ai-sdk wrapper). **No agent code change.**

Add a smoke test in `packages/agent` (`__tests__/`): construct an `Agent` with a `Model<"ai-sdk">` and a stubbed `StreamFn` yielding the adapter's `done` event; assert `agent.prompt()` completes and emits `agent_end`.

Commit `test(agent): smoke ai-sdk model through Agent`.

---

### Task 6.2: Runtime install fallback for unlisted npm packages `[PORT]`

**Reference (R1):** OC-RESOLVE (`provider.ts:1747-1767`) — the `Npm.add` + dynamic `import()` fallback.

**Files:** Modify `packages/ai/src/providers/ai-sdk-loader.ts`

Port the fallback: when `BUNDLED_PROVIDERS[npm]` is missing, dynamically `import(npm)`, find the export whose name starts with `create`, call it. (Skip opencode's `Npm.add` install-from-network — pi-ai assumes the package is installed; record as `adapted: no auto-install, requires package present`.)

Commit `feat(ai): runtime import fallback for unlisted @ai-sdk packages`.

---

### Task 6.3: Server wiring

**Files:** Find the `builtinModels()` call site in `apps/server/src/` (Grep).

Confirm the server calls `builtinModels()` (now including ai-sdk providers) and forwards `models.streamSimple` to the agent. Add a server test asserting a models.dev-only provider (e.g. `xai`) is listed by the models route.

Commit `test(server): models.dev providers selectable`.

---

## Phase 7 — End-to-end verification

### Task 7.1: Per-provider smoke matrix
For anthropic, openai, google, xai, groq — live API calls through the @ai-sdk path (gated by `SAKTI_SMOKE=1`). Each returns text + correct usage/cost. Commit `test(ai): e2e smoke matrix`.

### Task 7.2: Workspace lint + typecheck
`nubx ultracite fix && nub run typecheck` → clean. Fix `exactOptionalPropertyTypes` violations with conditional spread. Commit `chore(ai): lint/typecheck ai-sdk migration`.

---

## Lineage Map template (copy into every [PORT] file)

```ts
// LINEAGE MAP — required by plan guardrail R2. Do not delete.
// SOURCE: <opencode or pi-ai file path>
// ┌─ reference (file:lines) ────┬─ this file (symbol) ──┬─ status ─────┬─ divergence ──┐
// │                             │                       │ yes|logic-only|adapted        │
// └─────────────────────────────┴───────────────────────┴──────────────┴───────────────┘
// R3 statement: "No logic was added that is not present in the cited reference."
```

`status` meanings:
- `yes` — byte-for-byte equivalent (types only differ).
- `logic-only` — control flow copied; Effect/branded-schema stripped to plain TS.
- `adapted` — semantics preserved; shape changed. **Divergence column must explain.**

---

## Risk register & rollback

- **Highest risk:** Phase 1 adapter (cost/usage accounting). Mitigation: Tasks 1.3 + 7.1 assert cost totals against known model rates.
- **Compat regression:** Phase 3 port wrong → silent reasoning breakage. Mitigation: Task 3.1 has one test per `thinkingFormat` value (10 cases) + R5 preserves intent in Phase 5.3.
- **models.dev data bugs:** known-wrong `npm` (opencode-go minimax/qwen, per PI-GENMODEL `:1303-1321`). Mitigation: `COMPAT_OVERRIDES` (Task 4.2) carries corrections as data; extend on any new mismatch.
- **Count regression in generation:** Task 4.3 Step 2 gate catches lost models before commit.
- **Rollback:** each phase is independently committable. Models with `api !== "ai-sdk"` still route to the original 9 impls; reverting Phase 4's commit restores the old generation entirely.

## Out of scope

- Deleting the 9 hand-written API impls (later migration, post-prod-verification).
- Image generation via @ai-sdk (separate `ImagesModel` path).
- opencode's native runtime (`@opencode-ai/llm`) — different seam; not adopted.
- Runtime models.dev fetch/cache/TTL (pi-ai builds at package build time; runtime caching deferred).
- Effect-TS adoption — explicitly banned (Rule R4).
