# agent-effect: Full Effect Migration — Design

**Date:** 2026-06-27
**Status:** Approved
**Supersedes (in scope):** `2026-06-27-agent-effect-tier5.md` (the structural port — its "future Effect-native phases" section is now active work)

## Goal

Migrate `packages/agent-effect` from a verbatim structural port (no Effect in business logic) to a fully Effect-native package: typed errors via `Data.TaggedError`, `Either` instead of `Result`, services via `Layer`, the agent loop as a `Stream`, `Session` as an `Effect.Service`, and `@effect/vitest` for tests. Along the way, fix the latent bugs surfaced in the deep-dive review (C1–C6) and address the highest-leverage performance opportunities (P1–P2).

## Constraints

| Constraint | Decision |
|------------|----------|
| Plan granularity | Whole migration in one plan (matches Tier 5 precedent) |
| Backward compat | None required — `agent-effect` has no production consumers wired yet |
| `@sakti-code/llm` | Can be modified to add Effect-native variants (`streamEffect`, `completeEffect`) |
| Test discipline | Always-green TDD — every commit keeps the full test suite passing |
| `packages/agent` | Stays as-is, Promise-based, in use by `apps/server` + `apps/desktop`. Retired in a future plan after the server rewires to `agent-effect`. No compat shim between them. |
| Approach | Vertical Slice + Horizontal Phases (Approach C) |

## Non-goals

- Wiring `agent-effect` into `apps/server` or `apps/desktop` (separate future plan).
- Migrating `packages/agent` (the original) — it stays Promise-based until retired.
- Migrating TypeBox schemas to Effect.Schema (separate concern).
- Performance optimizations beyond P1 (per-turn context rebuild) and P2 (delta `convertToLlm`) — others are deferred.
- Restoring all stripped JSDoc on modules that aren't otherwise touched.

---

## Target Architecture (End State)

### Package layout

Unchanged: still `packages/agent-effect/src/` with the same 17 source files. Module boundaries from the structural port are correct; only internals change.

### Public API shape

Every function that today returns `Promise<T>` or `Promise<Result<T, E>>` returns `Effect<T, E, R>` instead. The `R` channel carries service requirements; consumers provide them via `Layer`.

| Today | End state |
|-------|-----------|
| `buildSessionContext(...): Promise<SessionContext>` | `Effect<SessionContext, SessionError, SessionStorage>` |
| `compact(...): Promise<Result<CompactResult, CompactionError>>` | `Effect<CompactResult, CompactionError, CompletionProvider \| SessionStorage>` |
| `runWithRetry(...): Promise<RunOutcome>` | `Effect<RunOutcome, RetryError, AgentLoopDeps>` |
| `new Session(storage)` (constructor) | `Session.Service` consumed via `yield* Session` |

### Layer composition tree

```
AppRuntime (ManagedRuntime — constructed in apps/server eventually)
│
├── Config.LogLevel, Config.ApiKeys …              ← effect/Config
├── Logger.Default                                 ← @sakti-code/logger wrapped
├── Clock.Live, Random.Make                       ← effect built-ins
│
├── SessionStorage.Tag                            ← implemented by SqliteSessionStorage (packages/db)
│       ▲
│       │
├── Session.Service                               ← depends on SessionStorage
│       ▲
│       │
├── FileSystem.Tag + Command.Tag + Terminal.Tag   ← @effect/platform
│       ▲                                           (replaces custom ExecutionEnv)
│       │
├── StreamProvider.Tag    ┐
│  CompletionProvider.Tag ┘── both wrap @sakti-code/llm (new Effect variants)
│       ▲
│       │
├── AgentLoopConfig services (each a separate Layer):
│       BeforeToolCall, AfterToolCall, PrepareNextTurn,
│       GetFollowUpMessages, GetSteeringMessages,
│       TransformContext, ConvertToLlm,
│       EvaluatePermission, ResolvePermissionAsk,
│       ShouldStopAfterTurn
│       ▲
│       │
├── AgentLoop.run       ← Stream<AgentEvent, AgentLoopError, AgentLoopDeps>
│       ▲
│       │
├── Agent               ← Effect<void, AgentError, AgentLoop>
│       ▲
│       │
└── AgentHarness        ← Effect<..., AgentHarnessError, Agent | Session | Compaction | …>
```

### Runtime model

**Inside `agent-effect`: zero `Effect.runPromise` calls.** Every function returns `Effect` and declares its requirements in `R`. Only consumers (`apps/server`, `apps/desktop` — eventually) construct a `ManagedRuntime`.

Tests are also consumers: they use `@effect/vitest`'s `it.effect` + `Effect.provide(layer)`.

### "What becomes Effect" rule

- **Effect** for anything with: service requirements, typed errors, async I/O, concurrency, resources needing cleanup.
- **Plain TS** for pure transforms: string parsers, regex helpers, token estimators, message constructors.

`parseFrontmatter(text)` stays pure. `loadCommands(env)` becomes `Effect<..., FileSystem>`.

### `@sakti-code/llm` additions

Add Effect-native variants alongside the existing Promise API:
- `streamEffect(req: StreamRequest): Effect.Effect<StreamResult, LLMError, never>` using `Stream` internally
- `completeEffect(req: CompletionRequest): Effect.Effect<CompletionResult, LLMError, never>`

The Promise API stays for `packages/agent` (which doesn't migrate). `agent-effect` uses the Effect variants via two thin service tags: `StreamProvider`, `CompletionProvider`.

### Public API surface (`index.ts`)

- **From `effect`:** `Effect`, `Layer`, `ManagedRuntime`, `Context`, `Data`, `Duration`, `Schedule`, `Clock`, `Random`, `Ref`, `Queue`, `Stream`, `Sink`, `Either`, `Option`
- **Service Tags:** `SessionStorage`, `Session`, `StreamProvider`, `CompletionProvider`, the 10 `AgentLoopConfig`-derived services, `AgentLoop`, `Agent`, `AgentHarness`
- **Error classes** (now TaggedErrors)
- **Types** (no behavior): `AgentMessage`, `AgentEvent`, `AgentHarnessEvent`, etc.
- **Pure utilities** that stayed plain: `parseFrontmatter`, `estimateTokens`, `serializeConversation`, message constructors

---

## Approach: Vertical Slice + Horizontal Phases

### Slice purpose

Convert `harness/session.ts` end-to-end first. Establishes **6 reusable patterns** that every horizontal phase will copy. ~3 days. Lands green via temporary `// @migration`-tagged adapters at caller boundaries.

### Patterns the slice establishes

| # | Pattern | Established by |
|---|---------|----------------|
| 1 | **TaggedError template** — `Data.TaggedError("X")<{code, message, cause?}>` | `SessionError` conversion |
| 2 | **Service Tag + Layer** — `Context.Tag` + `Layer.effect` | `SessionStorage` interface + `InMemorySessionStorageLive` |
| 3 | **Service class** — `Effect.Service<T>()("T", { effect, dependencies })` | `Session` class |
| 4 | **Effect-returning function** — deps in `R`, data in args | `buildSessionContext` |
| 5 | **Test pattern** — `it.effect` + `TestLayer` + `Effect.provide` | `session.test.ts` rewrite |
| 6 | **Caller adapter** — `// @migration`-tagged `async` wrapper calling `Effect.runPromise` | `compaction.ts`, `branch-summarization.ts`, `auto-compaction.ts`, `agent-harness.ts` (temporary) |

Detailed pattern templates live in the implementation plan.

### Slice verification

- All 233 tests stay green (caller adapters).
- `session.test.ts` rewritten as `it.effect`.
- `SessionError` → TaggedError (template for Phase A's remaining 5).
- **C5 (Session append race) fixed** — internal storage state moves to `Ref`.
- JSDoc restored on converted types.
- `docs/patterns/agent-effect-migration-patterns.md` documents the 6 patterns with cross-refs to slice code.

---

## Horizontal Phases (after the slice)

| Phase | Scope | Patterns applied | Bug fixed | Perf fixed | Effort |
|-------|-------|------------------|-----------|------------|--------|
| **A** | Remaining 5 error classes → TaggedError (`FileError`, `ExecutionError`, `CompactionError`, `BranchSummaryError`, `AgentHarnessError`) | Pattern 1 | — | — | ~1 day |
| **B** | `Result<T,E>` / `ok` / `err` → `Either<E,T>` everywhere (compaction, branch-summarization, loader-shared, harness) | Patterns 1, 4 | Loader error chain | — | ~1 day |
| **LLM** | Add `streamEffect` / `completeEffect` to `@sakti-code/llm`; introduce `StreamProvider` + `CompletionProvider` tags in `agent-effect` | Pattern 2 | — | — | ~1 day |
| **C1+C2 vanilla** | Add error path to `EventStream`; add `.catch` to fire-and-forget loop wrappers | (vanilla fix, no Effect) | **C1, C2** | — | ~2 hours |
| **Retry** | Convert `retry-loop.ts` → `Effect.retry` + `Schedule.exponential`; `abortableSleep` → `Clock.sleep` (interruptible) | Patterns 1, 4, 5 | (cleaner abort) | — | ~1–2 days |
| **Loaders** | Convert `loader-shared.ts` + 4 entity loaders + `builtin-agents.ts` to Effect; introduce `FileSystem` Layer | Patterns 1–6 | — | P6 (parallel I/O at startup) | ~2 days |
| **Compaction** | Convert `compaction.ts` + `auto-compaction.ts` + `branch-summarization.ts` to Effect; delete caller adapters from slice | Patterns 1–5 | — | P4 (token count without full tree), P5 (no re-fetch) | ~3 days |
| **D** | Convert `loop/agent-loop.ts` — `EventStream` → `Queue`+`Stream`; `runLoop` → `Effect.gen`; `AgentLoopConfig`'s ~15 callbacks → individual services | Patterns 1–5 + new Stream/Queue pattern | **C1, C2, C4, C6** | P1 (skip rebuild when no writes), P2 (delta `convertToLlm`) | ~1–2 weeks |
| **E** | Convert `agent.ts` → Effect with `Fiber`-based lifecycle; `subscribe` → `Stream<AgentEvent>` | Patterns 1–5 | — | — | ~3 days |
| **Harness** | Convert `harness/agent-harness.ts` — ~20 mutable fields → `Ref`/`Queue`/`PubSub`; event multiplexer → `PubSub` + request/reply service; every public method → scoped `Effect` sharing one cancelable fiber | Patterns 1–5 | **C3** (abort reaches compact) | P3 (one cloneStreamOptions), P7, P8 | ~1 week |
| **F** | Migrate remaining tests to `@effect/vitest` (those not already converted inline by each phase) | Pattern 5 | — | — | ongoing |
| **FS** | Replace custom `FileSystem`/`Shell`/`ExecutionEnv` with `@effect/platform` | Pattern 2 | — | — | ~2–3 days (independent, can run anytime after Loaders) |
| **Cleanup** | Final PR: remove all `// @migration` adapters; delete dead code (M1–M4 from review); restore remaining JSDoc | — | — | — | ~1 day |

---

## Bug fix integration

| Bug | Description | Fixed by |
|-----|-------------|----------|
| **C1** | Fire-and-forget `runAgentLoop().then()` has no `.catch` — consumer hangs on rejection | Phase C1+C2 vanilla (standalone, ~2 hrs) AND naturally by Phase D (`Effect.fork`) |
| **C2** | `EventStream` has no error path — only `end(result?)` | Phase C1+C2 vanilla AND Phase D (replaced by `Stream`) |
| **C3** | `abort()` cannot reach `compact()` / `navigateTree()` — they never register `runAbortController` | Phase Harness (scoped `Effect` + `Fiber.interrupt`) |
| **C4** | Phase-reentrancy window: `phase = "idle"` set inside run; `runPromise` cleared only in outer `finally` | Phase D (`Ref<AgentHarnessPhase>` + scoped `Effect`) + Phase Harness |
| **C5** | `Session.appendMessage` read-then-write race on `leafId` | **Slice** (storage state → `Ref`) |
| **C6** | `executePreparedToolCall` catch block uses `Promise.all` — emit error masks tool error | Phase D (`Effect.gen` — no such footgun) |

**Only C1+C2 are worth fixing standalone** (2 hours, prevents real hangs during the longer migration). The rest come for free as side-effects of their phase.

---

## Performance opportunities addressed

| ID | Issue | Fixed by |
|----|-------|----------|
| **P1** | O(n²) per-turn context rebuild — `prepareNextTurn` calls `session.buildContext()` after every tool turn | Phase D: skip rebuild when no pending writes were flushed (the `hadPendingMutations` flag already exists at `agent-harness.ts:660` — reuse it) |
| **P2** | Full-list `convertToLlm` every turn | Phase D: cache converted prefix `[0..k-1]`, convert only the delta |
| **P4** | `prepareCompaction` builds full message tree just to count tokens | Phase Compaction: add `estimateTokensFromEntries(pathEntries)` that iterates entries directly |
| **P5** | `collectEntriesForBranchSummary` re-fetches entries already in `oldPath` array | Phase Compaction: iterate the already-fetched array |
| **P6** | Loader I/O fully sequential at startup | Phase Loaders: `Effect.all({concurrency: 8})` |
| **P7** | `cloneStreamOptions` called 3× per provider request | Phase Harness: one clone per request |
| **P8** | Debug-log argument objects allocated every turn even when no logger | Phase D: `if (config.logger)` guards |

**Deferred:** P3 (`structuredClone` per tool call) — wait for Phase D, address during the loop rewrite.

---

## Sequencing

```
Week 1
  Day 1-3: Slice (Session + SessionError + SessionStorage + Session tests + caller adapters + PATTERNS.md)
Week 2
  Day 4:   Phase A — remaining 5 TaggedErrors
  Day 5:   Phase B — Result → Either
  Day 6-7: Phase LLM — streamEffect/completeEffect + StreamProvider/CompletionProvider
Week 3
  Day 8:   Phase C1+C2 vanilla fix (EventStream error path)
  Day 9-10: Phase Retry — retry-loop.ts → Effect.retry + Schedule
  Day 11-13: Phase Loaders — loader-shared + 4 entity loaders + builtin-agents
Week 4-5
  Phase Compaction — compaction.ts + auto-compaction.ts + branch-summarization.ts
Week 6-7
  Phase D — agent-loop.ts (the big one)
Week 8
  Phase E — agent.ts
Week 9-10
  Phase Harness — agent-harness.ts
Week 11 (parallel, anytime after Loaders)
  Phase FS — FileSystem → @effect/platform
Week 12
  Phase Cleanup — remove all // @migration adapters, dead code, final test sweep
```

Phase F (tests → `@effect/vitest`) happens **inline with each phase**, not as a separate sweep. Every phase ships its own tests as `it.effect`.

---

## Verification gates (every phase)

Before a phase is considered done:
1. All 233+ tests pass (`pnpm run test` from `packages/agent-effect`).
2. `pnpm exec tsc --noEmit` is clean.
3. `pnpm run fix` (Biome) is clean.
4. No new `any` / unsafe casts introduced.
5. Any new `// @migration` adapters are tagged with the phase that will remove them.
6. Bugs marked "fixed by this phase" in the matrix above are demonstrably fixed (test coverage added).
7. PATTERNS.md updated if a new pattern emerged.

---

## Out of scope / future work

- **Server wiring** — `apps/server` and `apps/desktop` keep using `packages/agent`. Wiring them to `agent-effect` is a separate plan after this migration completes.
- **`packages/agent` retirement** — deleted in a follow-up plan once the server switches.
- **TypeBox → Effect.Schema** — separate concern; TypeBox stays for now.
- **P3 perf (`structuredClone` per tool call)** — deferred to a focused perf PR after Phase D.
- **Restoring all stripped JSDoc** — only restored on modules touched by this migration.
- **`packages/db`'s `SqliteSessionStorage` Effect variant** — needed only when the server wires up. Add as a follow-up.
