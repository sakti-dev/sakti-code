# Agent Loop Factory — Design

**Date:** 2026-06-30
**Status:** Approved
**Follows:** `2026-06-29-effect-single-boundary.md` (Phases H1–H5 shipped — single `Effect.runPromise` boundary at the WS edge)
**Goal:** Move the agent run-loop orchestration out of `apps/server/src/agent/runner.ts` into `packages/agent`, so a second consumer (CLI, test harness) can drive the same orchestration without duplicating it.

> **Naming note:** The factory is named `runAgentRunEffect` (file: `runner/agent-run.ts`). The existing `runAgentLoop` in `core/agent-loop.ts` is the _inner_ LLM-call loop — distinct concept, distinct name.

## Context

After Phase H, `runPromptEffect` is Effect-native end-to-end — but the **orchestration** (retry-deps assembly, `planFirstTurn` dispatch, stuck-guard policy, compaction callbacks, event-drain fiber, retry abort, ensuring cleanup) lives in `apps/server/src/agent/runner.ts:461-822`. That's ~360 LOC of agent-domain logic in the server package.

Concrete symptoms:

- `runner.ts` is 848 LOC and does too many things: run registry, settings helpers, stuck-guard state, retry-deps assembly, mid-run control, replay glue.
- The retry-deps wiring (`runner.ts:666-800`) is purely agent-domain: it calls `sessionShape.getBranch()` / `storage.setLeafId()` / `checkCompaction` / `runAutoCompationEffect` — none of which is server-specific. A second consumer (CLI, in-repo integration-test harness) would have to copy-paste the entire block.
- Settings-key prefixes (`session:<id>:consecutive_compacts`, `:auto_compaction_paused`, `:thinking_level`, …) are agent-domain keys encoded as strings inside the server. The `DEFAULT_SETTINGS` map and parsing logic are agent-domain too.
- The server-side WS handler is hard to unit-test without a real `ServerContext` because the orchestration is fused to it.

## Scope

**In scope:**

- New `runAgentRunEffect(deps)` factory in `packages/agent` — owns the orchestration (event drain, retry abort, retry-deps assembly, stuck-guard policy, planFirstTurn dispatch, ensuring cleanup). Server's `runPromptEffect` delegates to it.
- New `SessionSettings` typed view in `packages/agent` — owns the `DEFAULT_SESSION_SETTINGS` map + typed accessors over the raw `Record<string, string>`. Server constructs it from `ctx.repos.settings`; factory consumes it as plain data.
- New `StuckGuardState` typed export in `packages/agent` — currently an unnamed struct in `runner.ts`.

**Out of scope (deferred):**

- Promoting to a "fat factory" that owns harness construction too. Approach 3 in the brainstorm — design a `AgentRunnerPrimitives` plugin contract. Deferred until a real second consumer exists; current Approaches 1 cut is the responsible YAGNI line.
- Moving the settings-key-prefix storage helpers (`loadSessionSettings`, `loadDisabledSkills`, `loadStuckGuardState`, `persistStuckGuardState`, `persistSkill*`) to `packages/db` as a typed `SessionSettingsRepo`. They use `ctx.repos.settings` (a server/db concern); the typed _view_ over the resulting record lives in the agent package. Storage layer can move later without disturbing the factory.
- Run registry (`activeRuns` Map, `registerRun`/`unregisterRun`/`abortRun`/`getActiveHarness`). Server-owned concept; the factory invokes it via callbacks.
- WS handler / replay / model-resolver / execution-env / tools-builder. All server-specific; untouched.

## Final shape (after all phases)

```
┌──────────────────────────────────────────────────────────────────┐
│ apps/server/src/agent/runner.ts                                  │
│                                                                  │
│  load session / project / auth / agent context / tools           │
│  build harness (NodeExecutionEnv, PromiseSession, systemPrompt,  │
│    switchAgent)                                                  │
│  wire permission channel                                         │
│  ↓                                                               │
│  runAgentRunEffect({...})  ←─ delegated orchestration           │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ packages/agent/src/runner/agent-run.ts                           │
│                                                                  │
│  AgentRunDeps (interface: ready harness + run config + hooks)    │
│  runAgentRunEffect(deps): Effect<void, Error>                    │
│                                                                  │
│   • subscribeStream + drain fiber → emit                         │
│   • retryAbort controller                                         │
│   • registerRun hook                                             │
│   • load stuck-guard                                             │
│   • build RetryRunnerDepsEffect                                  │
│       - rollbackLeaf: sessionShape.getBranch + setLeafId         │
│       - runTurn: planFirstTurn → template/skill/prompt dispatch  │
│       - checkCompaction: checkCompaction + stuck-guard persist   │
│       - runCompaction: runAutoCompationEffect + stuck-guard      │
│   • executeWithRetryEffect                                       │
│   • Effect.ensuring: unregisterRun + Fiber.interrupt drain       │
└──────────────────────────────────────────────────────────────────┘
```

## Public API

### `packages/agent/src/runner/agent-run.ts`

```ts
import type { Effect } from "effect";
import type { AgentHarness, AgentHarnessEvent } from "../agent/agent-harness.ts";
import type { SessionShape } from "../session/session.ts";
import type { SessionStorageShape } from "../session/storage.ts";
import type { Logger } from "../log/logger.ts";
import type { Model } from "@sakti-code/llm";
import type {
  CompactionSettings,
  RetrySettings,
  StuckGuardState,
} from "../compaction/retry-loop.ts";
import type { ThinkingLevel } from "../types.ts";
import type { Skill } from "../skills/types.ts";
import type { PromptTemplate } from "../agent/types.ts";

export interface AgentRunDeps {
  // ── the ready-to-run harness ──────────────────────────────────
  readonly harness: AgentHarness;
  readonly sessionShape: SessionShape;
  readonly storage: SessionStorageShape;

  // ── run config (plain data) ───────────────────────────────────
  readonly message: string;
  readonly retrySettings: RetrySettings;
  readonly compactionSettings: CompactionSettings;
  readonly model: Model;
  readonly apiKey: string;
  readonly thinkingLevel?: ThinkingLevel;

  // ── for planFirstTurn dispatch (template/skill/@file expansion) ─
  readonly skills: Skill[];
  readonly templates: PromptTemplate[];
  readonly cwd: string;
  /**
   * Used by `planFirstTurn` for `@file` mention expansion. Defaults to
   * `node:fs/promises.readFile` followed by null on ENOENT. Override for
   * non-node environments or in tests.
   */
  readonly readFile?: (path: string) => Promise<string | null>;

  // ── stuck-guard: factory owns policy+mutation, caller owns persistence
  readonly loadStuckGuard: () => Effect.Effect<StuckGuardState, Error>;
  readonly persistStuckGuard: (state: StuckGuardState) => Effect.Effect<void, Error>;

  // ── output sink ───────────────────────────────────────────────
  readonly emit: (event: AgentHarnessEvent) => void;

  // ── run-registry hooks (caller's concept of "active run") ─────
  // registerRun fires after the drain fiber + retry abort exist; if it
  // returns false the loop fails with the busy error before doing any
  // provider work. unregisterRun fires in `Effect.ensuring` (always).
  readonly registerRun?: (info: {
    harness: AgentHarness;
    retryAbort: AbortController;
    unsubscribe: () => void;
  }) => boolean;
  readonly unregisterRun?: () => void;

  readonly log?: Logger;
}

export function runAgentRunEffect(deps: AgentRunDeps): Effect.Effect<void, Error>;
```

### `packages/agent/src/runner/session-settings.ts`

```ts
import type { CompactionSettings, RetrySettings } from "../compaction/retry-loop.ts";
import type { QueueMode, ThinkingLevel } from "../types.ts";
import type { EditMode } from "@sakti-code/tools";

export const DEFAULT_SESSION_SETTINGS: Readonly<Record<string, string>> = {
  auto_compaction: "false",
  auto_retry: "true",
  base_delay_ms: "2000",
  follow_up_mode: "all",
  max_retries: "3",
  steering_mode: "all",
  thinking_level: "off",
};

export interface SessionSettings {
  readonly raw: Readonly<Record<string, string>>;
  agent(): string;
  autoCompaction(): boolean;
  autoRetry(): boolean;
  editMode(): EditMode;
  followUpMode(): QueueMode;
  steeringMode(): QueueMode;
  retry(): RetrySettings;
  compaction(): CompactionSettings;
  /** null = no per-session override; use the profile default. */
  thinkingLevelOverride(): ThinkingLevel | null;
}

export function parseSessionSettings(raw: Record<string, string>): SessionSettings;
```

### `StuckGuardState` (already implicitly defined; promote to typed export)

```ts
// packages/agent/src/compaction/retry-loop.ts (or a new types file)
export interface StuckGuardState {
  consecutiveCompacts: number;
  paused: boolean;
}
```

## Server's `runPromptEffect` after migration

```ts
export function runPromptEffect(
  ctx: ServerContext,
  sessionId: string,
  message: string,
  storage: SessionStorageShape,
  eventCallback: (event: AgentHarnessEvent) => void,
  permissionAskedSink: (frame: PermissionFrame) => void,
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    // ── I/O: load session/project/auth ──────────────────────────
    const session = ctx.repos.sessions.findById(sessionId);
    if (!session) {
      return yield* Effect.fail(new Error(`Session not found: ${sessionId}`));
    }
    const project = ctx.repos.projects.findById(session.projectId);
    if (!project) {
      return yield* Effect.fail(new Error(`Project not found: ${session.projectId}`));
    }
    const auth = resolveAuth(ctx, session);
    if (!auth) {
      return yield* Effect.fail(new Error("No API key configured"));
    }

    // ── Load + resolve agent context ────────────────────────────
    const settings = parseSessionSettings(loadSessionSettings(ctx, sessionId));
    const loadedContext = yield* Effect.tryPromise({
      try: () => loadAgentContext(project.cwd),
      catch: (e: unknown) => new Error(`Failed to load agent context: ${String(e)}`),
    });
    const disabledSkills = loadDisabledSkills(ctx, sessionId);
    const activeSkills = loadedContext.skills.filter((s) => !disabledSkills.has(s.name));

    // ── Build tools + harness (server-specific) ─────────────────
    const tools = buildTools(project.cwd, settings.editMode());
    const isIntake = session.kind === "intake";
    if (isIntake) tools.push(createProposeSessionTool() as (typeof tools)[number]);
    const thinkingLevel = resolveThinkingLevel(ctx, sessionId, session, auth.thinkingLevel);

    const sessionInstance = new PromiseSession(storage);
    const sessionShape = promiseSessionAsShape(sessionInstance);
    const harness = new HarnessClass({
      /* …same as today… */
    });

    // ── Resolve agent + wire permission + switchAgent ───────────
    const agent = resolveAgentByName(settings.agent(), loadedContext.agents);
    const agentRuleset = agent.permission ?? fromConfig({ "*": "allow" });
    const channel = getPermissionChannel(sessionId);
    channel.setSink(permissionAskedSink);
    harness.setPermissionEvaluator((p, pat) => channel.evaluate(p, pat, agentRuleset));
    harness.setPermissionAskResolver((req) => channel.ask(req));

    if (!isIntake) {
      // …composeSystemPrompt + switchAgentEffect (unchanged)…
    }

    // ── Delegate the orchestration ──────────────────────────────
    yield* runAgentRunEffect({
      harness,
      sessionShape,
      storage,
      message,
      retrySettings: settings.retry(),
      compactionSettings: settings.compaction(),
      model: auth.model,
      apiKey: auth.apiKey,
      ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
      skills: activeSkills,
      templates: loadedContext.commands,
      cwd: project.cwd,
      loadStuckGuard: () => Effect.sync(() => loadStuckGuardState(ctx, sessionId)),
      persistStuckGuard: (s) => Effect.tryPromise(() => persistStuckGuardState(ctx, sessionId, s)),
      emit: eventCallback,
      registerRun: ({ harness: h, retryAbort, unsubscribe }) =>
        registerRun(sessionId, h, unsubscribe, retryAbort),
      unregisterRun: () => unregisterRun(sessionId),
      ...(ctx.log === undefined ? {} : { log: ctx.log.agent }),
    });
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        getPermissionChannel(sessionId).rejectPending();
      }),
    ),
    Effect.mapError((error) => {
      const err = error instanceof Error ? error : new Error(`Run failed: ${String(error)}`);
      ctx.log?.agent.error("run failed", err, { sessionId });
      return err;
    }),
  );
}
```

**Net change:** `runPromptEffect` body shrinks from ~360 LOC to ~80 LOC; the deleted block moves verbatim into `runAgentRunEffect`.

## Why Approach 1 (not 3)

Approach 3 ("fat factory") would also move **harness construction** into the factory, requiring a 12-method `AgentRunnerPrimitives` plugin contract (loadSession, loadProject, resolveAuth, loadSettings, loadDisabledSkills, loadStuckGuard, persistStuckGuard, loadAgentContext, buildTools, createExecutionEnv, openStorage, wirePermission). With "both plausible but unsure" as the second-consumer signal, designing that plugin contract now means guessing at the right shape without two real consumers to drive it.

The honest signals:

- The **orchestration** (retry-deps assembly, planFirstTurn dispatch, compaction callbacks) is genuinely consumer-agnostic — it only depends on `harness` + `sessionShape` + `storage` + run config. Approach 1 extracts exactly this.
- The **I/O shape** (DB rows + auth.json + agent dir scan in server vs. file-backed config + fs scan in CLI) varies wildly. Forcing it into one primitives contract now would lock in server-shaped assumptions.

If a real CLI lands and the harness-assembly code is duplicating, **that's** the moment to promote Approach 1 → Approach 3. Until then, Approach 1 is the responsible cut.

## Testing strategy

**New tests (in `packages/agent/src/runner/__tests__/`):**

- `session-settings.test.ts` — `parseSessionSettings` returns defaults for empty raw, honors overrides, retry/compaction parse correctly, editMode falls back to "hashline", thinkingLevelOverride returns null when unset.
- `agent-loop.test.ts` — uses a **real** `AgentHarness` with a fake model/loop:
  - Emits `agent_start` … `agent_stop` events reach `emit`.
  - `registerRun` hook fires with harness + retryAbort + unsubscribe; `unregisterRun` fires in ensuring.
  - `registerRun` returning false fails the loop with the busy error.
  - Stuck-guard load/persist called with correct state on a forced compaction.
  - planFirstTurn dispatch: `/skill-name args` → `harness.skillEffect`, `/template arg` → `harness.promptFromTemplateEffect`, plain text → `harness.promptEffect`.
  - `unsubscribe` interrupts the drain fiber cleanly (no leak).

**Existing tests (unchanged):**

- `packages/agent/src/compaction/__tests__/retry-loop.test.ts` — still tests the retry loop directly via `executeWithRetryEffect`. Factory just wires it.
- `apps/server/src/agent/__tests__/` — server-side tests of `runPromptEffect` still test the I/O glue (load session, auth failure, busy session). They exercise the factory transitively.

## Migration phases (TDD)

Implementation plan deferred to the writing-plans skill output, but the high-level shape:

- **Phase I1 — `SessionSettings` typed view.** New file in `packages/agent`. Migrate `DEFAULT_SETTINGS` constant + parsing from `runner.ts`. Server's `loadSessionSettings` returns `Record<string,string>`; caller wraps with `parseSessionSettings`. Standalone — can ship without touching the factory.
- **Phase I2 — `StuckGuardState` typed export.** Tiny. Move the interface from `runner.ts` to `packages/agent`; server imports it. Sets up the factory's deps shape.
- **Phase I3 — `runAgentRunEffect` factory + tests.** Factory created in `packages/agent` with full test coverage. Not yet wired into the server.
- **Phase I4 — Migrate `runPromptEffect` to use the factory.** Delete the inline retry-deps block; delegate to the factory. Server-side tests still pass.
- **Phase I5 — Cleanup.** Remove dead code paths. Finalize exports from `packages/agent/src/index.ts`.

## Open questions / deferred decisions

- **`PromiseSession` keeps its role** as the `SessionShape` adapter over `SessionStorageShape`. The factory takes the ready `sessionShape` and doesn't know about `PromiseSession`. A future phase could replace `PromiseSession` with a direct Effect-native `SessionShape` builder, but that's orthogonal to this design.
- **`loadSessionSettings` / `loadStuckGuardState` / `persistStuckGuardState` / `loadDisabledSkills` / `persistSkill*` stay server-side** because they use `ctx.repos.settings`. The factory takes load/persist callbacks for stuck-guard (the only one it touches); the others stay in the server's pre-factory glue.
- **`resolveThinkingLevel` / `resolveEditMode`** stay server-side. They compose session-row data + DB settings + profile default — a server-specific mix. The factory takes the resolved values as plain data.
