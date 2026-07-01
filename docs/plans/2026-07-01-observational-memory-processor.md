# Observational Memory Processor (Native Port) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Prerequisite:** The storage plan is done — `SqliteObservationalMemoryStorage` (17 methods) exists in `packages/db` and the `ObservationalMemoryStorage` interface + types live in `packages/agent`. This port drives that adapter from a sakti-native Observer/Reflector loop.

**Goal:** Port Mastra's Observational Memory **state machine** into `packages/agent` as a sakti-native processor — the Observer/Reflector loop, a real token counter, verbatim prompts, and per-turn `<observations>` injection into the system prompt — driven off our own `ObservationalMemoryStorage` and `@sakti-code/llm`. No `@mastra/*` runtime dependency.

**Why native (not "use `@mastra/memory`"):** sakti owns its loop, its LLM layer (`@sakti-code/llm`), and its DB. Mastra's full `Memory`+`Processor` is welded to `MessageList`/`RequestContext`/agent-controller and gates construction on a `Mastra` gateway feature-flag. But Mastra's _engine_ (observe/reflect/buffer/activate) is structurally standalone: it runs on `threadId`/`resourceId` + a message array + the 17-method storage contract we already built. So we port the engine's logic and swap the two coupling points — the `Agent`+`agent.stream()` LLM calls become `complete()` from `@sakti-code/llm`, and `MastraDBMessage` becomes `AgentMessage`. The storage contract is the seam; it exists precisely for this.

**Architecture:**

- `packages/agent/src/observational-memory/` (new) — the processor: `token-counter.ts` (port), `prompts.ts` (verbatim port), `observer.ts`, `reflector.ts`, `engine.ts` (state machine), `config.ts` (deps/config types), `__tests__/`. Sibling to `compaction/` (same shape: Effect-native, model+apiKey injected, no I/O, persists via injected storage).
- `packages/agent/src/core/agent-loop.ts` — gains a thin per-turn hook that runs observe/reflect and rewrites `context.systemPrompt` to include `<observations>`.
- `apps/server` — resolves `observe`/`reflect` models from `profiles.json`, constructs `ObservationalMemoryDeps`, passes it through `AgentRunDeps` (parallel to `compactionSettings`/`model`/`apiKey`). No WS events, no UI (this plan).

**Scope decisions (decided upfront, do not re-litigate during execution):**

1. **Native port.** No `@mastra/*` runtime dep. State machine + TokenCounter + prompts are ported; LLM calls use `@sakti-code/llm` `complete()`.
2. **Thread scope only** (`lookupKey = thread:{sessionId}`), matching the schema + storage plans. `resource:{projectId}` scope is deferred.
3. **`observe`/`reflect` are new optional profile modes** in `profiles.json`, falling back to `default`. Users pick cheap/fast models for OM.
4. **Real token estimation via `tokenx`** (new dep) + `image-size` — the thresholds are token-driven; the existing `chars/4` heuristic (`compaction.ts:254`) drifts too far. Port Mastra's `TokenCounter`.
5. **Verbatim prompts.** Port the observer/reflector system + task prompts and the `<observations>` injection format from Mastra unchanged; sakti-ize later only if output quality demands it.
6. **Agent-loop only, no UI/server-visibility.** No WS progress frames, no desktop controls, no REST routes for OM state. The server only constructs deps + plumbing. (A later plan adds visibility.)
7. **Phase D (async buffering) is in this plan** but ordered AFTER the sync path is green. The sync Observer/Reflector is the first shippable behavior; `swapBuffered*` driving is layered on.
8. **Two storage methods stay vestigial** (per the storage-review finding): `insertObservationalMemoryRecord` (tests only in Mastra) and `setObservingFlag` (superseded by `setBufferingObservationFlag`). We keep them on the interface but the processor never calls them.
9. **Messages come from `SessionStorage.getPathToRoot(leafId)`** filtered to `type === "message"`, **never** from a Mastra-style message DB. This is storage-plan scope decision #1.

**Tech Stack:** TypeScript, `effect` (Effect-native, matching `compaction/`), `@sakti-code/llm` (`complete`), `tokenx` + `image-size` (new deps), vitest via `vite-plus/test`. `exactOptionalPropertyTypes: true`.

---

## Mastra source of truth (port targets — read these when implementing)

| What                                                   | Mastra file:line                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine state machine (observe/reflect/buffer/activate) | `openspec/references/mastra/packages/memory/src/processors/observational-memory/observational-memory.ts` (3713 ln)                                                                                                                                |
| Observer runner (LLM call shape)                       | `…/observer-runner.ts:117` (`createAgent`), `:247-283` (payload + `agent.stream`)                                                                                                                                                                 |
| Observer prompts                                       | `…/observer-agent.ts:375` (`buildObserverSystemPrompt`), `:1361` (`buildObserverTaskPrompt`), `:1072` (`buildObserverHistoryMessage`), plus `OBSERVER_EXTRACTION_INSTRUCTIONS` / `OBSERVER_GUIDELINES` / `buildObserverOutputFormat` in same file |
| Reflector runner                                       | `…/reflector-runner.ts:373` (`buildReflectorPrompt` call), `:410` (`agent.stream`), compression-level escalation `:482`                                                                                                                           |
| Reflector prompts + parser                             | `…/reflector-agent.ts:226` (`buildReflectorPrompt`), `:287` (`parseReflectorOutput`), `COMPRESSION_GUIDANCE`                                                                                                                                      |
| Injection format + constants                           | `…/constants.ts:48` (`OBSERVATION_CONTINUATION_HINT`), `:61` (`OBSERVATION_CONTEXT_PROMPT`), `:67` (`OBSERVATION_CONTEXT_INSTRUCTIONS`); `…/observational-memory.ts:1586` (`formatObservationsForContext`)                                        |
| TokenCounter                                           | `…/token-counter.ts` (1878 ln; imports `estimateTokenCount` from `tokenx`, `image-size`; constants `TOKENS_PER_MESSAGE=3.8`, `TOKENS_PER_CONVERSATION=24`)                                                                                        |
| Threshold/buffer math                                  | `…/thresholds.ts` (`resolveBufferTokens`, `resolveBlockAfter`, `resolveActivationRatio`, `resolveRetentionFloor`, `calculateDynamicThreshold`)                                                                                                    |
| Buffering coordinator                                  | `…/buffering-coordinator.ts` (183 ln)                                                                                                                                                                                                             |
| Defaults                                               | `openspec/references/mastra/mastracode/src/constants.ts:29-33` (`DEFAULT_OM_MODEL_ID`, `DEFAULT_OBS_THRESHOLD=30_000`, `DEFAULT_REF_THRESHOLD=40_000`); `…/constants.ts:4` (`OBSERVATIONAL_MEMORY_DEFAULTS`)                                      |

## sakti integration anchors (verified)

| Concern                             | File:line                                               | Symbol                                                                                              |
| ----------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Per-step loop / model call          | `packages/agent/src/core/agent-loop.ts:280-308`         | inner `while` body; `streamAssistantResponse` at `:437`, model invoked `:463-481`                   |
| Per-turn system-prompt rewrite hook | `packages/agent/src/core/agent-loop.ts:364-380`         | `config.prepareNextTurn` → returns new `context.systemPrompt`                                       |
| Loop config type                    | `packages/agent/src/types.ts:67-118`                    | `AgentLoopConfig`                                                                                   |
| Turn-update shape                   | `packages/agent/src/types.ts:59-63`                     | `AgentLoopTurnUpdate.context.systemPrompt`                                                          |
| System-prompt composer              | `packages/agent/src/resources/system-prompt.ts:115-137` | `composeSystemPrompt`                                                                               |
| Run deps (OM resources attach here) | `packages/agent/src/runner/agent-run.ts:22-60`          | `AgentRunDeps`                                                                                      |
| Loop config factory                 | `packages/agent/src/agent/agent-harness.ts:651-694`     | `createLoopConfig`                                                                                  |
| OM storage interface (exists)       | `packages/agent/src/observational-memory-storage.ts`    | `ObservationalMemoryStorage`, `ObservationalMemoryRecord`                                           |
| `complete()` one-shot               | `packages/llm/src/complete.ts:74-84`                    | `complete(CompleteRequest): Promise<CompleteResult>` (value-encoded errors, `finishReason:"error"`) |
| SessionStorage                      | `packages/agent/src/session/storage.ts:6-21`            | `SessionStorageShape.getPathToRoot`                                                                 |
| Entry "message" type                | `packages/agent/src/session/entries.ts:14-17`           | `MessageEntry` (`type: "message"`)                                                                  |
| entries → AgentMessage              | `packages/agent/src/session/session.ts:28-101`          | `buildSessionContextFromEntries`                                                                    |
| `AgentMessage` union                | `packages/agent/src/types.ts:159-164`                   | —                                                                                                   |
| Profile mode union                  | `apps/server/src/lib/kind-to-mode.ts:1`                 | `ProfileMode`                                                                                       |
| Mode → model resolver               | `apps/server/src/lib/profile-resolver.ts:19-47`         | `resolveModelRef` (optional modes fall back to `default`)                                           |
| profiles.json schema                | `apps/server/src/lib/profiles-store.ts:13-18, 52-58`    | `modelsSchema` / `Profile.models`                                                                   |
| Server run assembly                 | `apps/server/src/agent/runner.ts:525-569`               | compose prompt + `runAgentRunEffect({...})`                                                         |
| Agent index re-exports              | `packages/agent/src/index.ts:90-107`                    | OM storage types already exported                                                                   |

---

## lookupKey + threshold conventions

- `lookupKey = thread:{sessionId}` (resource scope deferred). The processor is constructed per run with a fixed `{ threadId: sessionId, resourceId: projectId }`.
- "Current" record = latest by `generationCount DESC` (the storage adapter already enforces this).
- **Observation threshold** (`messageTokens`, default `30_000`): when pending message tokens exceed it, run the Observer over un-observed messages → `updateActiveObservations` (sync) or `updateBufferedObservations` (async).
- **Reflection threshold** (`observationTokens`, default `40_000`): when `record.observationTokenCount` exceeds it, run the Reflector → `createReflectionGeneration` (sync) or `updateBufferedReflection` (async).
- **Cursor**: `record.lastObservedAt` gates which messages are "un-observed" (`entry.createdAt > lastObservedAt`). `record.observedMessageIds` is a safeguard, pruned to ids newer than `lastObservedAt`.

---

## Phase A — Foundations (no behavior yet)

### Task 1: Port `TokenCounter`

**Files:**

- Create: `packages/agent/src/observational-memory/token-counter.ts`
- Create: `packages/agent/src/observational-memory/__tests__/token-counter.test.ts`
- Modify: `packages/agent/package.json` (add `tokenx`, `image-size` deps), root via `vp install`

Port `openspec/references/mastra/…/token-counter.ts`. Changes at port time:

- Swap `import type { MastraDBMessage } from "@mastra/core/agent"` → sakti's `AgentMessage` (`packages/agent/src/types.ts`). Adapt `countMessage`/`countMessageAsync` to the sakti message union (`Message | CustomMessage | BashExecutionMessage | …`). Use `convertToLlm`-style extraction for text/image parts.
- Keep `estimateTokenCount` from `tokenx` and `image-size` verbatim. Keep the constants (`TOKENS_PER_MESSAGE = 3.8`, `TOKENS_PER_CONVERSATION = 24`), the per-provider image-tile tables, and the `AsyncLocalStorage` model-context plumbing.
- Drop the remote-attachment fetch (`fetchProviderAttachmentTokenEstimate`) for v1 — local image-size estimation only.
- Public API to preserve: `countString(str)`, `countMessage(msg)`, `countMessages(msgs)`, `countObservations(str)` (sync), + `runWithModelContext(ctx, fn)`.

**TDD:** test `countString`/`countMessages` determinism on fixed strings; test that a message with an image part yields a positive token count via `image-size` (use a tiny fixture png); test `runWithModelContext` nesting. Verify `tokenx` resolves before writing (`vp install` then import).

**Commit:** `feat(agent): port tokenx-based TokenCounter for observational memory`

---

### Task 2: Port prompt bundles (verbatim)

**Files:**

- Create: `packages/agent/src/observational-memory/prompts.ts`
- Create: `packages/agent/src/observational-memory/__tests__/prompts.test.ts`

Port verbatim from Mastra (do **not** rewrite prose — decision #5):

- `OBSERVER_EXTRACTION_INSTRUCTIONS`, `OBSERVER_GUIDELINES`, `buildObserverOutputFormat`, `buildObserverSystemPrompt`, `buildObserverTaskPrompt`, `buildObserverHistoryMessage` (from `observer-agent.ts`).
- `COMPRESSION_GUIDANCE`, `buildReflectorPrompt`, `parseReflectorOutput` (+ the XML-section parser + `detectDegenerateRepetition` + `sanitizeObservationLines`) from `reflector-agent.ts`.
- `OBSERVATION_CONTEXT_PROMPT`, `OBSERVATION_CONTEXT_INSTRUCTIONS`, `OBSERVATION_CONTINUATION_HINT` from `constants.ts`. (Skip `OBSERVATION_RETRIEVAL_INSTRUCTIONS` — retrieval/vector is out of scope.)

Adaptation surface (keep minimal):

- `buildObserverHistoryMessage` consumes `MastraDBMessage[]` → change to `AgentMessage[]`. Mirror `convertToLlm` text/tool-part extraction already used in `compaction/`. Preserve the `## New Message History to Observe` framing + temporal markers.
- Drop extractor/`<thread>` multi-thread branches (single-thread, no extractors in v1). Keep the functions' signatures backward-compatible by defaulting the dropped params.

**TDD:** snapshot the produced prompts for fixed inputs (existing observations + a message fixture) so future "sakti-ize" edits are intentional; test `parseReflectorOutput` on a sample `<observations>…</observations>` payload returns `{ observations, suggestedContinuation }`; test the degenerate-repetition guard rejects a pathological input.

**Commit:** `feat(agent): port observational-memory observer/reflector prompts`

---

### Task 3: OM config + deps types

**Files:**

- Create: `packages/agent/src/observational-memory/config.ts`
- Modify: `packages/agent/src/index.ts` (re-export)

Define the contract by which the server injects OM resources (parallel to `CompactionSettings`/`CompactionPrompts`):

```ts
import type { Model, ThinkingLevel } from "@sakti-code/llm";
import type { ObservationalMemoryStorage } from "../observational-memory-storage.ts";

export interface ObservationalMemoryThresholds {
  /** Run Observer when pending message tokens exceed this (default 30_000). */
  observation: number;
  /** Run Reflector when observationTokenCount exceeds this (default 40_000). */
  reflection: number;
}

/** Async-buffering knobs (Phase D). Omit/zero => sync-only. */
export interface ObservationalMemoryBuffering {
  /** Ratio of messageTokens to buffer at (e.g. 0.2). */
  observationBufferTokens: number;
  /** Activation ratio for swapBufferedToActive (e.g. 0.8). */
  observationBufferActivation: number;
  /** Activation ratio for swapBufferedReflectionToActive (e.g. 0.5). */
  reflectionBufferActivation: number;
}

export interface ObservationalMemoryDeps {
  readonly storage: ObservationalMemoryStorage;
  readonly sessionId: string;
  readonly projectId: string;
  readonly observeModel: Model;
  readonly observeApiKey: string;
  readonly observeThinkingLevel?: ThinkingLevel;
  readonly reflectModel: Model;
  readonly reflectApiKey: string;
  readonly reflectThinkingLevel?: ThinkingLevel;
  readonly thresholds: ObservationalMemoryThresholds;
  readonly buffering?: ObservationalMemoryBuffering;
  readonly tokenCounter: TokenCounter;
  /** Custom observer/reflector instruction overlay (e.g. caveman). Optional. */
  readonly instruction?: string;
}

export interface ObservationalMemoryOptions {
  readonly enabled: boolean;
  readonly deps: ObservationalMemoryDeps;
}
```

`exactOptionalPropertyTypes`: callers use conditional spreads for optional model/thinkingLevel fields. **No** `enabled` toggling inside the engine — if `enabled === false` the server simply omits `deps` and the loop hook is a no-op.

**TDD:** type-only file; add a compile-test that an `ObservationalMemoryDeps` literal type-checks and that omitting `buffering` is valid.

**Commit:** `feat(agent): add observational-memory config and deps types`

---

## Phase B — Server config plumbing

### Task 4: Add `observe` / `reflect` profile modes

**Files:**

- Modify: `apps/server/src/lib/kind-to-mode.ts` (`ProfileMode` union)
- Modify: `apps/server/src/lib/profile-resolver.ts` (`mode` param union)
- Modify: `apps/server/src/lib/profiles-store.ts` (`modelsSchema` + `Profile.models`: add `Type.Optional(modelRefSchema)` keys; interface mirrors)
- Modify: relevant tests under `apps/server/src/lib/__tests__/` (profile-resolver, profiles-store, kind-to-mode)

Add `"observe" | "reflect"` to the mode union and as optional `models` keys. `resolveModelRef` already falls back to `default` for missing modes (`profile-resolver.ts:31`), so unset observe/reflect → reuse the session's default model. `validateModelRefs` iterates `Object.entries(profile.models)` generically → new modes validated automatically. Do **not** add cases to `kindToMode` — OM modes are resolved directly by the runner, not via `session.kind`.

**TDD:** add tests: (a) a profile with only `default` resolves `observe`/`reflect` to the default model; (b) a profile with explicit `observe` resolves to it; (c) schema validates a profile with `observe`/`reflect` set; (d) migration — an existing `profiles.json` without the new keys still validates.

**Commit:** `feat(server): add observe/reflect profile modes`

---

### Task 5: `settings.json` OM enablement + server resolves OM deps

**Files:**

- Modify: `apps/server/src/lib/settings-file-store.ts` / settings schema (add `observationalMemory?: { enabled: boolean; observationThreshold?; reflectionThreshold?; buffering?; instruction? }`)
- Modify: `apps/server/src/agent/runner.ts` (build `ObservationalMemoryDeps` from resolved observe/reflect models + the run's session/project + `SqliteObservationalMemoryStorage`; pass through `AgentRunDeps.observationalMemory`)
- Modify: `packages/agent/src/runner/agent-run.ts` (`AgentRunDeps` gets `readonly observationalMemory?: ObservationalMemoryOptions`)
- Create: `apps/server/src/agent/observational-memory-deps.ts` (the builder: reads profiles + settings, resolves models via `resolveModelRef(profile, profileId, "observe"|"reflect")`, instantiates the `TokenCounter` once per server, returns `ObservationalMemoryOptions | undefined`)

When `enabled === false` or modes fail to resolve, the builder returns `undefined` and the run proceeds with no OM. This keeps OM fully opt-in and never blocks a run.

**TDD:** test the builder returns `undefined` when disabled; returns populated deps with observe/reflect models + thresholds when enabled; falls back observe→default when the profile lacks an explicit observe mode.

**Commit:** `feat(server): resolve observational-memory deps from profiles + settings`

---

## Phase C — Sync OM engine + loop integration (first user-visible behavior)

### Task 6: The Observer

**Files:**

- Create: `packages/agent/src/observational-memory/observer.ts`
- Create: `packages/agent/src/observational-memory/__tests__/observer.test.ts`

Port `ObserverRunner.call` (`observer-runner.ts:247-283`), replacing `new Agent(...)` + `agent.stream(...)` with `complete()` from `@sakti-code/llm`:

```ts
export interface ObserverInput {
  readonly messagesToObserve: AgentMessage[]; // since lastObservedAt, role !== system
  readonly existingObservations: string;
  readonly deps: ObservationalMemoryDeps;
  readonly abortSignal?: AbortSignal;
}
export interface ObserverResult {
  readonly observations: string;
  readonly suggestedContinuation?: string;
  readonly tokenCount: number; // deps.tokenCounter.countObservations(observations)
}

export async function runObserver(input: ObserverInput): Promise<ObserverResult>;
```

- Build messages: `[{ role: "user", content: buildObserverHistoryMessage(input.messagesToObserve) }]` (history message already bundles the task prompt per `observer-agent.ts:1434`). System = `buildObserverSystemPrompt(false, input.deps.instruction)`.
- Call `complete({ model: deps.observeModel, apiKey: deps.observeApiKey, messages, system, ...(deps.observeThinkingLevel === undefined ? {} : { thinkingLevel: deps.observeThinkingLevel }), abortSignal })`.
- Value-check `result.finishReason === "error"` → throw an `ObservationError` (new tagged error in this file). Else `parseReflectorOutput`-style parse is **not** needed for the observer; its raw text is the observations (the observer prompt emits `<observations>…</observations>`; extract the inner content, or keep the wrapper — match Mastra's `observer-runner.ts` extraction exactly).
- `tokenCount = deps.tokenCounter.countObservations(observations)`.

**TDD:** mock `complete` (inject a `runComplete` like compaction's `runGenerateText`); assert the system prompt is `buildObserverSystemPrompt()`, the user message contains the history, and on a fixed stub response the returned `observations` + `tokenCount` are as expected. Assert `finishReason:"error"` throws `ObservationError`.

**Commit:** `feat(agent): port observational-memory Observer (sync)`

---

### Task 7: The Reflector

**Files:**

- Create: `packages/agent/src/observational-memory/reflector.ts`
- Create: `packages/agent/src/observational-memory/__tests__/reflector.test.ts`

Port `ReflectorRunner` (`reflector-runner.ts:373-482`): compression-level escalation (0→3) until `validateCompression(reflectedTokens, reflectionThreshold)` passes. Replace `agent.stream` with `complete()`.

```ts
export interface ReflectorInput {
  readonly observations: string; // record.activeObservations
  readonly deps: ObservationalMemoryDeps;
  readonly abortSignal?: AbortSignal;
}
export interface ReflectorResult {
  readonly reflection: string;
  readonly tokenCount: number;
  readonly compressionLevel: number;
}
export async function runReflector(input: ReflectorInput): Promise<ReflectorResult>;
```

- Prompt: `buildReflectorPrompt(observations, undefined /*manualPrompt*/, level, …)`.
- Call `complete({ model: deps.reflectModel, apiKey: deps.reflectApiKey, messages: [{role:"user", content: prompt}], system: undefined, thinkingLevel: deps.reflectThinkingLevel, abortSignal })`.
- Parse via `parseReflectorOutput(result text)`. If `degenerate`, bump level and retry. Stop when `tokenCount <= reflectionThreshold` or level cap reached.

**TDD:** with a stub `complete` that returns a fixed large response, assert escalation retries until the level cap; with a small response, assert it stops at level 0. Assert `parseReflectorOutput` wiring.

**Commit:** `feat(agent): port observational-memory Reflector (sync)`

---

### Task 8: OM engine — sync state machine + context builder

**Files:**

- Create: `packages/agent/src/observational-memory/engine.ts`
- Create: `packages/agent/src/observational-memory/__tests__/engine.test.ts`

The core. Port the **sync slice** of Mastra's engine: `getOrCreateRecord`, `observe`, `reflect`, `buildContextSystemMessages`, plus the message-loading helper. This is the single most logic-dense task; reference `observational-memory.ts:1055` (`getOrCreateRecord`), `:3387` (`observe`), `:3479` (`reflect`), `:2502` (`buildContextSystemMessages`).

```ts
export class ObservationalMemoryEngine {
  constructor(private readonly deps: ObservationalMemoryDeps) {}

  /** Current record, creating an initial one if absent. */
  async getOrCreateRecord(): Promise<ObservationalMemoryRecord> {
    /* storage.getObservationalMemory → else initializeObservationalMemory */
  }

  /** Load message-kind entries since record.lastObservedAt, as AgentMessage[]. */
  async loadUnobservedMessages(record: ObservationalMemoryRecord): Promise<AgentMessage[]> {
    /* storage.getPathToRoot → filter type==="message" && createdAt > lastObservedAt → buildSessionContextFromEntries */
  }

  /** Observe if pending tokens exceed the observation threshold. Returns true if it ran. */
  async maybeObserve(record: ObservationalMemoryRecord): Promise<ObservationalMemoryRecord> {
    /* tokenCounter.countMessages(unobserved) > threshold? → runObserver → storage.updateActiveObservations → re-read record */
  }

  /** Reflect if observationTokenCount exceeds the reflection threshold. */
  async maybeReflect(record: ObservationalMemoryRecord): Promise<ObservationalMemoryRecord> {
    /* record.observationTokenCount > threshold? → setReflectingFlag(true) → runReflector → createReflectionGeneration → setReflectingFlag(false) in finally */
  }

  /** Build the <observations> system-message section (or undefined if empty). */
  buildContextSystemMessage(record: ObservationalMemoryRecord): string | undefined {
    /* port formatObservationsForContext: OBSERVATION_CONTEXT_PROMPT + <observations>…</observations> + OBSERVATION_CONTEXT_INSTRUCTIONS */
  }
}
```

Notes:

- `loadUnobservedMessages` needs the `SessionStorageShape` — add it to `ObservationalMemoryDeps` as `readonly sessionStorage: SessionStorageShape` and `readonly leafId: string | null` (Task 3 update: add these fields). The engine calls `sessionStorage.getPathToRoot(leafId)`.
- Storage sequence for one observe cycle (mirror the verified Mastra map): `getObservationalMemory` → (observe LLM, no storage) → `updateActiveObservations`. For reflect: `setReflectingFlag(true)` → (reflector LLM) → `createReflectionGeneration` → `setReflectingFlag(false)`.
- Wrap each LLM-bearing method in `Effect`-native try/catch; an OM failure must **never** abort the run — log + emit nothing + return the unchanged record (decision: OM is best-effort). This diverges from Mastra, which aborts; sakti prefers resilience.
- `buildContextSystemMessage` returns the joined `OBSERVATION_CONTEXT_PROMPT\n\n<observations>\n${activeObservations}\n</observations>\n\nOBSERVATION_CONTEXT_INSTRUCTIONS`.

**TDD:** use an in-memory `ObservationalMemoryStorage` test double (a small fake implementing the interface — keep it in the test file) + a stub `complete` + a stub `SessionStorageShape`. Assert: (a) `getOrCreateRecord` initializes then returns; (b) below threshold → no observe; above → observe writes via `updateActiveObservations`; (c) reflection triggers on observation-token overflow and creates a new generation; (d) LLM error → no throw, record unchanged; (e) `buildContextSystemMessage` shape on empty vs populated.

**Commit:** `feat(agent): port observational-memory sync engine + context builder`

---

### Task 9: Loop integration — per-turn observe/reflect + system-prompt injection

**Files:**

- Modify: `packages/agent/src/types.ts` (`AgentLoopConfig`: add optional `observationalMemory?: { engine: ObservationalMemoryEngine; getBaseSystemPrompt: () => string }`)
- Modify: `packages/agent/src/core/agent-loop.ts` (ride `prepareNextTurn` at `:364-380` to run `engine.maybeObserve` + `engine.maybeReflect` over the just-completed turn's messages, then return a `context` whose `systemPrompt` = `base + <observations>`)
- Modify: `packages/agent/src/agent/agent-harness.ts` (`createLoopConfig:651-694`: populate `observationalMemory` from `AgentRunDeps.observationalMemory`; construct the engine once per run)
- Modify: `packages/agent/src/runner/agent-run.ts` (thread `observationalMemory` from deps into the harness)
- Create: `packages/agent/src/observational-memory/__tests__/loop-integration.test.ts`

Integration design:

- **At run start** (first turn): inject `<observations>` from the existing record (cheap — no observe yet; the user's first prompt may benefit from prior session memory). The harness sets the initial `context.systemPrompt` = `composeSystemPrompt(...) + observations`.
- **`prepareNextTurn`**: after a turn completes, (1) `engine.maybeObserve(record)` + `engine.maybeReflect(record)` (best-effort, awaited but wrapped so failure doesn't break the run), (2) recompute `context.systemPrompt` = `baseSystemPrompt + <observations from latest record>` and return it in the `AgentLoopTurnUpdate`. This matches Mastra's `processInputStep` timing (observe prior messages before the next model call).
- Keep the composed base prompt stable across a turn for cache stability — only swap the observations-bearing suffix at the turn boundary (mirrors the harness's existing cache-stable refresh discipline).
- If `config.observationalMemory` is absent, `prepareNextTurn` behaves exactly as today (zero behavior change for runs without OM).

**TDD:** drive a fake loop with a stub engine that reports `observeRan`/`reflectRan` booleans and a canned `<observations>` string; assert (a) the first model call's system prompt contains `<observations>`, (b) after a turn above the observation threshold the engine's `maybeObserve` ran and the next turn's prompt reflects the new observations, (c) with no `observationalMemory` config the loop is unchanged.

**Commit:** `feat(agent): wire observational memory into the agent loop`

---

## Phase D — Async buffering (layer on once C is green)

### Task 10: Buffered observations

**Files:**

- Modify: `packages/agent/src/observational-memory/engine.ts` (add `maybeBufferObservation`, `maybeActivateBufferedObservations`)
- Create: `packages/agent/src/observational-memory/__tests__/buffering.test.ts`

Port `buffering-coordinator.ts` (183 ln) + the async-buffer observation strategy. When `deps.buffering` is set and pending tokens cross `observationBufferTokens` (resolved via `thresholds.ts:resolveBufferTokens`):

- `setBufferingObservationFlag(id, true, lastBufferedAtTokens)` → `runObserver` over the buffer-window messages → `updateBufferedObservations({ chunk })` → `setBufferingObservationFlag(id, false)`.
- Activation: when pending tokens cross `messageTokensThreshold + bufferActivation` headroom, call `storage.swapBufferedToActive({ id, messageTokensThreshold: thresholds.observation, activationRatio: resolveActivationRatio(buffering.observationBufferActivation, thresholds.observation), currentPendingTokens, forceMaxActivation: false })`. The boundary-selection math already lives in the storage adapter (verified green) — the engine only computes the ratio + passes through.

If `deps.buffering` is omitted, the engine stays sync-only (Task 8 path).

**TDD:** assert buffer-then-activate sequence issues exactly `setBufferingObservationFlag(true)` → `updateBufferedObservations` → `setBufferingObservationFlag(false)` → (later) `swapBufferedToActive`; assert sync path is untouched when `buffering` is absent.

**Commit:** `feat(agent): port observational-memory buffered observations`

---

### Task 11: Buffered reflection

**Files:**

- Modify: `packages/agent/src/observational-memory/engine.ts` (add `maybeBufferReflection`, `maybeActivateBufferedReflection`)
- Modify: the buffering test file

Port `reflector-runner.ts:590-903` (`startAsyncBufferedReflection` / `doAsyncBufferedReflection` / `tryActivateBufferedReflection`). When observation tokens cross the reflection buffer threshold:

- `setBufferingReflectionFlag(id, true)` → `runReflector` → `updateBufferedReflection({ id, reflection, tokenCount, inputTokenCount, reflectedObservationLineCount })` → `setBufferingReflectionFlag(id, false)`.
- Activation: `storage.swapBufferedReflectionToActive({ currentRecord, tokenCount })` then re-read.

Storage sequence must mirror the verified map (Task 8's commit + the storage-review): `setBufferingReflectionFlag(true)` → `updateBufferedReflection` → `setBufferingReflectionFlag(false)` → (later turn) `swapBufferedReflectionToActive`.

**TDD:** assert the buffered-reflection storage sequence + that activation creates a new generation and clears the old record's buffered fields.

**Commit:** `feat(agent): port observational-memory buffered reflection`

---

## Phase E — Finalize

### Task 12: Full suite, typecheck, lint, dogfood

**Files:** verification only (unless lint reformats).

- `vp run -r test` (all packages green; the pre-existing flaky WS test is unrelated).
- `vp check` (format + lint + typecheck across all files).
- Manual dogfood: enable OM in `settings.json`, set an explicit cheap `observe` model in `profiles.json`, run a session past the observation threshold in the desktop app, confirm `<observations>` appears in the system prompt (dev toolbar) and `getObservationalMemory` returns a growing record. Confirm turning OM off returns to baseline behavior.
- Verify the two vestigial storage methods (`insertObservationalMemoryRecord`, `setObservingFlag`) have no production callers (rg).

**Commit (if reformatted):** `style(agent): format observational-memory`

---

## Explicitly OUT of scope (do not do in this plan)

- **`resource:{projectId}` scope** (project-wide observations across sessions). Storage supports the column; processor logic deferred.
- **WS progress frames / desktop UI** for OM activity (observation/reflection/buffering indicators, manual "reflect now", observations viewer). A later plan.
- **REST routes** for OM state (`/api/sessions/:id/observational-memory`). Same later plan.
- **Vector retrieval / recall tool** (`OBSERVATION_RETRIEVAL_INSTRUCTIONS`, `@mastra/fastembed`). sakti's OM is context-injection only for v1.
- **Extractors** (`<current-task>`, `<suggested-response>`, thread-title, custom extractors). v1 ports the observation/reflection essence only.
- **Temporal-gap markers**, **caveman compression** as a runtime toggle (the prompt text is ported so it's available, but no settings wiring for the toggle — `instruction` overlay is the escape hatch).
- **Gateway/server-side OM** (Mastra's gateway bypass). sakti has no gateway.
- **Mastra's `MessageList`/`Processor`/`RequestContext`** — deliberately not imported. The engine is driven from sakti's loop via `prepareNextTurn`.

## Definition of done

- `packages/agent/src/observational-memory/` contains a native TokenCounter, verbatim-port prompts, sync Observer + Reflector (Phase C) and async buffering (Phase D), all driven off `ObservationalMemoryStorage`.
- The agent loop runs `maybeObserve`/`maybeReflect` at turn boundaries and injects `<observations>` into the system prompt; runs without OM deps are byte-for-byte unchanged.
- `profiles.json` supports optional `observe`/`reflect` modes; `settings.json` toggles OM; the server constructs `ObservationalMemoryDeps` and injects via `AgentRunDeps`.
- No `@mastra/*` runtime dependency. `tokenx` + `image-size` are the only new deps.
- OM failures never abort a run (best-effort, logged).
- `vp run -r test` and `vp check` are green; manual dogfood confirms observe/reflect/injection end-to-end.
