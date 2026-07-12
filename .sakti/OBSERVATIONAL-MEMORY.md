# Observational Memory (OM)

> How OM works in sakti-code. Every claim below is grounded in code — file:line
> references point to the exact source. This is a reference for maintainers.

## TL;DR (mental model)

OM compresses a long conversation so it fits the model's context window without a
separate "compaction" pass. As the conversation grows, an **observer** LLM
extractes concise observations from chunks of messages; a **reflector** LLM later
consolidates observations. Observed messages are **pruned** from the live context
(the observations replace them), keeping the working window small.

Two things make this non-obvious in our port:

1. **OM runs in two timing modes** — a *detached, fire-and-forget* "buffering"
   mode (default, runs in the background) and a *synchronous* mode (only when the
   hard threshold is crossed). See [Execution modes](#execution-modes).
2. **We diverge from Mastra's storage model** for cache-friendliness. Thread-scope
   observations live in the **session tree** (rendered as in-stream
   `<observation>` user messages), NOT in `record.activeObservations`. This keeps
   the system-prompt prefix stable (cache hits). See
   [Storage model (divergence from Mastra)](#storage-model-divergence-from-mastra).

---

## Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │              agent loop turn                │
                    │  (packages/agent/src/core/agent-loop.ts)    │
                    │                                             │
   user prompt ───► │  ...LLM call + tool loop...                │
                    │          │                                  │
                    │          ▼  at turn boundary (line 443-456) │
                    │   ┌──────────────────────────────┐          │
                    │   │ maybeObserve → maybeReflect  │ ◄── awaited wrapper
                    │   └──────────────────────────────┘          │
                    │          │                                  │
                    │          ▼  read-only injection (459-483)   │
                    │   inject project <observation> blocks       │
                    └────────────────────┬────────────────────────┘
                                         │
              ┌──────────────────────────┴───────────────────────────┐
              ▼                                                      ▼
   ┌─────────────────────┐                            ┌──────────────────────────┐
   │ ObservationalMemory │                            │ session tree (DB)        │
   │      Engine         │                            │  message                 │
   │ (engine.ts ~1142 L) │ ── appendEntry ──────────► │  observation             │
   │                     │                            │  reflection              │
   │  maybeObserve       │ ── updateActiveObs ──────► │  observation_prune       │
   │  maybeReflect       │                            │  om_marker (custom)      │
   │  forceObserve       │                            └──────────────────────────┘
   │  forceReflect       │
   │  detach() ◄─────────┼── fire-and-forget background ops (buffering)
   └─────────┬───────────┘
             │
             ▼  storage layer
   ┌─────────────────────────────────────────────┐
   │ observational_memory table (SQLite/Drizzle) │
   │  per thread:   lookup_key = thread:<sid>    │
   │  per project:  lookup_key = resource:<pid>  │
   └─────────────────────────────────────────────┘
```

### Key files

| Concern | File | Lines |
|---|---|---|
| Engine (all logic) | `packages/agent/src/observational-memory/engine.ts` | — |
| Buffering coordinator | `packages/agent/src/observational-memory/buffering-coordinator.ts` | — |
| Observer LLM call | `packages/agent/src/observational-memory/observer.ts` | 53-62 |
| Reflector LLM call | `packages/agent/src/observational-memory/reflector.ts` | 57 |
| Cleanup + retention floor | `packages/agent/src/observational-memory/cleanup.ts` | 21-98 |
| Prompts + formatters | `packages/agent/src/observational-memory/prompts.ts` | 815-840 |
| Config types | `packages/agent/src/observational-memory/config.ts` | — |
| **Loop integration (turn hook)** | `packages/agent/src/core/agent-loop.ts` | **443-456** |
| **Loop integration (read-only)** | `packages/agent/src/core/agent-loop.ts` | **459-483** |
| Runner assembles OM deps | `apps/server/src/agent/runner.ts` | 457-489 |
| Engine construction + drain | `packages/agent/src/runner/agent-run.ts` | 97-136, 216-227 |
| Config resolution + defaults | `apps/server/src/agent/config/resolve-observational-memory.ts` | 122-150 |
| Graduation (thread→resource) | `apps/server/src/agent/config/graduation.ts` | — |
| DB store | `packages/db/src/observational-memory-store.ts` | — |
| **Context builder (renders observations)** | `packages/agent/src/session/session.ts` | **28-89** |
| Observation → LLM message | `packages/agent/src/session/messages.ts` | 57-63, 125-135 |
| Entry types | `packages/agent/src/session/entries.ts` | 73-88 |
| DB schema | `packages/db/src/schema.ts` | 121-178 |

---

## Execution modes

OM hooks the agent loop once per turn, at the **turn boundary** (`agent-loop.ts:443-456`).
The hook is awaited, but what happens *inside* depends on how close the context is
to the threshold:

| Situation | Path | Blocks the next turn? |
|---|---|---|
| `pendingTokens >= observation` threshold | `await runSyncObserve` (`engine.ts:182`) | **Yes** |
| Below threshold, crossed a buffer interval (default 20% of threshold) | `detach("buffer observation", maybeBufferObservation(...))` (`engine.ts:189-194`) | **No** — fire-and-forget |
| Run teardown | `waitForBuffering(30_000)` (`agent-run.ts:222`) | drains any in-flight detached op |

`detach` (`engine.ts:834-836`) is a true fire-and-forget — `void op.catch(...)`.
The detached op **does** call the observer LLM (`runObserver` at `engine.ts:389`),
stages its result as a `bufferedObservationChunk`, and is later "activated" (merged
into active) — a pure storage op, no LLM (`engine.ts:455`).

So the **default behavior is parallel**: while the agent runs its next turn, a
detached observer is producing the next observation chunk in the background. This
mirrors Mastra's `void om.buffer(...)` fire-and-forget design.

### Triggers (buffering coordinator)

- **Sync observation** fires when `pendingTokens >= observation` threshold
  (`engine.ts:174`). The threshold is **dynamic** in Mastra (lowers as observations
  grow); ours is currently fixed at the configured value.
- **Detached buffering** fires when `shouldTriggerAsyncObservation` is true
  (`buffering-coordinator.ts:173-197`): buffering enabled AND a `bufferTokens`
  interval boundary was crossed AND no op already in flight. Near the threshold
  (within ~10%) the effective interval is **halved** to ramp up (`:190-191`).
- **Activation** runs at the start of the next observation cycle
  (`maybeActivateBufferedObservations`, `engine.ts:455-526`): buffered chunks are
  merged into the session tree as `ObservationEntry` rows and their message IDs
  become eligible for pruning.

### Defaults (`resolve-observational-memory.ts:122-130`)

- `observationBufferTokens: 0.2` (ratio of the observation threshold → ~20% intervals)
- `observationBufferActivation: 0.8`
- `reflectionBufferActivation: 0.5`
- `observation` / `reflection` thresholds: **user-configurable** in `settings.json`
  (we do NOT hardcode Mastra's 30k/40k).

---

## Storage model (divergence from Mastra)

This is the most important (and most subtle) part of our port.

| Scope | Where observation TEXT lives | Where `observedMessageIds` lives | How it reaches the LLM |
|---|---|---|---|
| **thread** (per-session, the default) | **session tree** `ObservationEntry` (`engine.ts:871`, `appendObservationEntry:1098`) | `observational_memory` record | rendered as in-stream `<observation>` **user** message (`session.ts:77-78` → `messages.ts:125-135`) |
| **resource** (per-project, read-only cross-session) | `record.activeObservations` (field on the OM record) | `record.observedMessageIds` | `<observations>` **system**-message chunks via `buildObservationsBlock` (`prompts.ts:836-840` → `runner.ts:487`) |

For **thread scope**, `record.activeObservations` is deliberately left `""`
(`engine.ts:876`). Consequently `buildContextSystemMessages` (`engine.ts:719-721`)
returns `undefined` for thread scope — by design. The engine's system-message path
is only live for resource scope.

**Why the divergence?** Cache-friendliness. Putting observations in the session
tree (as in-stream user messages) keeps the system prompt byte-identical across
turns, so the prompt-cache prefix stays warm. Mastra stores both scopes in
`activeObservations` and injects as a system message, which shifts the cache
prefix on every observation change.

### What's atomic (and what isn't)

- **Mastra** writes `activeObservations` + `observedMessageIds` + `lastObservedAt`
  in one atomic `updateActiveObservations` call — so "ids populated but content
  empty" is unreachable.
- **Ours (thread)** splits the write: observation text → tree, ids/tokens/cursors
  → record. The linkage is implicit (same `runSyncObserve` call), not enforced by
  the storage layer. This is acceptable because the context builder renders both
  from the same tree, but it means: **do not read `record.activeObservations` to
  decide whether thread-scope observations exist** — check the tree instead.

---

## How observations reach the LLM

`buildSessionContextFromEntries` (`session.ts:28-89`) walks the path-to-root and
builds the message list:

1. Find the **latest** `observation_prune` entry; its `observedEntryIds` becomes
   the skip-set (`session.ts:51-58`).
2. For each entry in path order, `appendMessage`:
   - **skip** if the entry's id is in the prune skip-set (`session.ts:62`)
   - `message` → push as-is
   - `observation` → `createObservationMessage` (`session.ts:77-78`)
   - `reflection` → `createReflectionMessage` (`session.ts:79-80`)
3. The `ObservationMessage` (role `"observation"`) is converted to an LLM
   `user` message wrapping `<observation>…</observation>` (`messages.ts:125-135`).

So the model sees observations as **in-stream user messages**, interleaved with
the unobserved (recent) messages, with the observed (old) messages skipped.

---

## Pruning

Once messages are observed, they're removed from the *live* context (not from the
DB — pruning is logical, via a cumulative skip-set).

- `pruneObservedMessages` (`engine.ts:733-787`) runs at the end of every
  `maybeObserve` (and `forceObserve`). It:
  1. Reads `record.observedMessageIds` (the only guard — it does NOT check
     `activeObservations`).
  2. Computes candidates via `getObservedEntryIdsForCleanup` (`cleanup.ts:46-98`),
     honoring a retention floor.
  3. Finds the latest existing `observation_prune` entry and builds a cumulative
     set.
  4. **Idempotency guard** (`engine.ts` post-fix): if the latest prune entry
     already covers every candidate, skip — this is a no-op turn. Prevents the
     "21 prune entries from one observation" bloat.
  5. Otherwise appends a new `ObservationPruneEntry` with the cumulative set.

- The context builder uses **"latest prune entry wins"** (`session.ts:52-57`):
  it scans newest→oldest, takes the first `observation_prune`, uses its
  `observedEntryIds` as the skip-set.

- The retention floor prevents stripping the context bare: with buffering ON
  (`observationBufferActivation: 0.8`), `resolveRetentionFloor` keeps ~20% of the
  threshold (`cleanup.ts:21-28`).

---

## The two OM channels (compose each turn)

Every turn, the agent loop applies **both** of these, in sequence:

1. **Own-OM (thread-scope, read-write)** — `config.observationalMemory`
   (`agent-loop.ts:443-456`). Runs `maybeObserve` → `maybeReflect` for *this*
   session's own thread. Failures are caught + logged (best-effort).
2. **Read-only OM (resource-scope)** — `config.observationalMemoryReadOnly`
   (`agent-loop.ts:459-483`). Reads the *project's* `resource:<projectId>` record
   and injects its observations as ephemeral user messages. Built unconditionally
   for every session (`runner.ts:484-489`), so cross-session memory is always
   available even if own-OM isn't configured.

---

## Graduation (thread → resource rollup)

When a plan session transitions to build/mission, `buildGraduation`
(`graduation.ts`) creates a one-shot engine with **`scope: "resource"`** and calls
`forceObserve` + `forceReflect` over the child transcript. This lands the
reflection in the project's `resource:<projectId>` slot, which all future sessions
read via the read-only channel. `resolveOmConfig` is called with the child's real
`kind` (`graduation.ts:31`); the resource scope is forced at `graduation.ts:51`.

---

## Lifecycle events (WS)

The engine emits events via `onOmEvent` (wired at `agent-run.ts:102-131`),
forwarded to the WS client and persisted as `om_marker` custom-message entries
for reload after a session reopen.

| Event | When | `operationType` |
|---|---|---|
| `om_status` | end of every `maybeObserve`/`maybeReflect` (token-window snapshot) | — |
| `om_start` / `om_end` | around an LLM operation | `observation` / `reflection` / `buffering` |
| `om_failed` | error branch of an LLM operation | same |
| `om_activation` | buffered chunks merged into active | `observation` / `reflection` |

An `om_start`/`om_end` pair with `operationType: "buffering"` is direct evidence a
**detached** background observe/reflector ran.

---

## Run teardown

`runAgentRunEffect` wraps the run in `Effect.ensuring` (`agent-run.ts:216-227`)
that calls `omEngine.waitForBuffering(30_000)`. This drains any still-detached
buffering op before the run tears down, so a slow observer completes rather than
being orphaned. `waitForBuffering` does `Promise.race([Promise.allSettled(...), timeout])`
— it can't reject.

The engine shares the retry loop's `AbortSignal` (`agent-run.ts:99-101`), so a
user cancel propagates to in-flight background observation.

---

## Our port vs Mastra — summary

| Aspect | Mastra | sakti-code | Why we diverge |
|---|---|---|---|
| Observation storage (thread) | `record.activeObservations` | session-tree `ObservationEntry` | cache-friendly (system prompt stays stable) |
| Injection (thread) | system message (`addSystem`) | in-stream `<observation>` user message | same |
| Background buffering | `void om.buffer(...)` fire-and-forget | `detach(...)` fire-and-forget | aligned |
| Sync over-threshold | `await om.observe(...)` | `await runSyncObserve(...)` | aligned |
| Activation | merge into `activeObservations`, no LLM | append `ObservationEntry` to tree, no LLM | aligned (different store) |
| Pruning | `messageList.removeByIds` (in-memory) | `ObservationPruneEntry` skip-set (persisted) | persisted so it survives reload |
| Atomic content+ids | yes (one storage call) | **no** (text→tree, ids→record) | acceptable: builder reads both from tree |
| Prune guard on `activeObservations` | not needed (atomic) | not needed (guard on latest prune set) | idempotency guard added |

### Reference paths (Mastra)
- `references/mastra/packages/memory/src/processors/observational-memory/observational-memory.ts` — engine
- `references/mastra/packages/memory/src/processors/observational-memory/observation-turn/step.ts` — per-step logic
- `references/mastra/packages/memory/src/processors/observational-memory/observation-strategies/` — sync / async-buffer strategies
- `references/mastra/packages/memory/src/processors/observational-memory/buffering-coordinator.ts`
- `references/mastra/mastracode/sdk/src/agents/memory.ts` — mastracode's OM config

---

## Configuring OM

In `~/.sakti/agent/settings.json`:

```json
{
  "observationalMemory": {
    "observationThreshold": 100000,
    "reflectionThreshold": 120000,
    "buffering": {
      "observationBufferTokens": 0.2,
      "observationBufferActivation": 0.8,
      "reflectionBufferActivation": 0.5
    }
  }
}
```

The observe/reflect **models** come from the session's profile
(`profiles.json`), resolved per mode (`default` / `plan` / `spec` / `build`) via
`resolveOmConfig` (`resolve-observational-memory.ts`).

---

## Verifying OM is running

- `~/.sakti/logs/agent.1.log` → `"om deps assembled"` (armed), `"silent empty response"`/`"stream response"` (turn outcomes).
- `~/.sakti/logs/llm.1.log` → a second `stream request` (beyond the main turn) with the observe/reflect model = a background OM call fired.
- DB: `SELECT lookup_key, scope, origin_type, generation_count, total_tokens_observed, length(active_observations) FROM observational_memory WHERE thread_id = '<sid>' OR resource_id = '<pid>'`.
- `session_entries`: `observation`, `reflection`, `observation_prune`, `om_marker` rows.

**Note on `active_observations` being empty:** for thread scope this is **expected**
(observation text lives in the session tree, not the record). It is NOT a sign of
failure. For resource scope, `active_observations` should be non-empty after a
graduation.
