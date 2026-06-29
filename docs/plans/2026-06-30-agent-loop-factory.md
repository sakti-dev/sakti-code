# Agent Loop Factory — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract the agent run-loop orchestration from `apps/server/src/agent/runner.ts:runPromptEffect` into `packages/agent/src/runner/agent-run.ts` as `runAgentRunEffect(deps)`, so the orchestration is consumer-agnostic and `runner.ts` shrinks from 848 → ~620 LOC.

**Architecture:** Thin factory (Approach 1). Server still owns harness construction, I/O (DB/auth/fs), and run registry. Factory owns the orchestration: event-drain fiber, retry abort, `RetryRunnerDepsEffect` assembly (rollbackLeaf / runTurn with planFirstTurn dispatch / checkCompaction with stuck-guard / runCompaction), `executeWithRetryEffect`, and the `Effect.ensuring` cleanup. Stuck-guard persistence and run-registry mutations stay caller-owned, invoked via callbacks.

**Tech Stack:** `effect@4.0.0-beta.90`, `vitest`, `@sakti-code/agent`, `@sakti-code/llm`. `exactOptionalPropertyTypes: true` is on — use conditional spread `...(x !== undefined ? { x } : {})`. **No `Effect.catchAll`** in v4 — use `Effect.exit` + `Exit.isFailure` + `Cause.squash` if needed.

**Design doc:** `docs/plans/2026-06-30-agent-loop-factory-design.md` (commit `4044d483`, renamed `15f6b752`).

**Conventions:**
- Tests in `__tests__/` colocated with source, vitest, jsdom not needed.
- TDD per phase: write failing test → verify RED → implement → verify GREEN → commit.
- Each phase leaves workspace green (`pnpm run typecheck` + `pnpm run test`).
- Use the existing test pattern from `packages/agent/src/compaction/__tests__/retry-loop.test.ts` as the style reference.

**Baseline test counts** (must not regress):
- `packages/agent`: 359/359
- `apps/server`: 313/315 (2 pre-existing API-key failures in compaction route + e2e two-concurrent-sessions — must remain identical, not worse)

**Key files to read before starting:**
- `apps/server/src/agent/runner.ts:461-822` — the orchestration block being moved (verbatim target)
- `packages/agent/src/compaction/retry-loop.ts` — `RetryRunnerDepsEffect`, `executeWithRetryEffect`, `parseRetrySettings` (already exists)
- `packages/agent/src/compaction/auto-compaction.ts` — `checkCompaction`, `parseCompactionSettings`, `runAutoCompationEffect`, `CompactionDecision`
- `packages/agent/src/resources/prompt-preprocessor.ts:79` — `planFirstTurn` signature
- `packages/agent/src/index.ts` — export surface to extend
- `packages/agent/src/harness-types.ts:81-115` — `Skill`, `PromptTemplate`, `AgentHarnessResources`

---

## Phase I1 — `SessionSettings` typed view

**Goal:** Move `DEFAULT_SETTINGS` + parsing logic from `apps/server/src/agent/runner.ts:189-213` to `packages/agent` as a typed view. Server keeps `loadSessionSettings` (reads DB) but returns `Record<string,string>`; callers wrap with `parseSessionSettings`.

**Why first:** Standalone — can ship without touching the factory. Sets up clean deps for the factory (no raw `Record<string,string>` to parse).

**Caveat — `EditMode`:** The agent package cannot import from `@sakti-code/tools` (circular: tools → agent). Define a local string-union `EditMode = "replace" | "hashline"` in `session-settings.ts`. The server's `EditMode` from `@sakti-code/tools` is structurally identical and assignable.

### Task I1.1: Create `packages/agent/src/runner/session-settings.ts` with tests

**Files:**
- Create: `packages/agent/src/runner/session-settings.ts`
- Create: `packages/agent/src/runner/__tests__/session-settings.test.ts`

**Step 1: Write the failing test**

```ts
// packages/agent/src/runner/__tests__/session-settings.test.ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_SETTINGS,
  parseSessionSettings,
} from "../session-settings";

describe("DEFAULT_SESSION_SETTINGS", () => {
  it("includes all keys used by the runner", () => {
    expect(DEFAULT_SESSION_SETTINGS.auto_compaction).toBe("false");
    expect(DEFAULT_SESSION_SETTINGS.auto_retry).toBe("true");
    expect(DEFAULT_SESSION_SETTINGS.base_delay_ms).toBe("2000");
    expect(DEFAULT_SESSION_SETTINGS.follow_up_mode).toBe("all");
    expect(DEFAULT_SESSION_SETTINGS.max_retries).toBe("3");
    expect(DEFAULT_SESSION_SETTINGS.steering_mode).toBe("all");
    expect(DEFAULT_SESSION_SETTINGS.thinking_level).toBe("off");
  });
});

describe("parseSessionSettings", () => {
  it("returns defaults when raw is empty", () => {
    const s = parseSessionSettings({});
    expect(s.agent()).toBe("build");
    expect(s.autoCompaction()).toBe(false);
    expect(s.autoRetry()).toBe(true);
    expect(s.editMode()).toBe("hashline");
    expect(s.followUpMode()).toBe("all");
    expect(s.steeringMode()).toBe("all");
    expect(s.thinkingLevelOverride()).toBeNull();
  });

  it("honors overrides", () => {
    const s = parseSessionSettings({
      agent: "explore",
      auto_compaction: "true",
      auto_retry: "false",
      base_delay_ms: "500",
      edit_mode: "replace",
      follow_up_mode: "one-at-a-time",
      max_retries: "5",
      steering_mode: "one-at-a-time",
      thinking_level: "high",
    });
    expect(s.agent()).toBe("explore");
    expect(s.autoCompaction()).toBe(true);
    expect(s.autoRetry()).toBe(false);
    expect(s.editMode()).toBe("replace");
    expect(s.followUpMode()).toBe("one-at-a-time");
    expect(s.steeringMode()).toBe("one-at-a-time");
    expect(s.thinkingLevelOverride()).toBe("high");
  });

  it("editMode falls back to hashline for unknown values", () => {
    expect(parseSessionSettings({ edit_mode: "garbage" }).editMode()).toBe(
      "hashline",
    );
  });

  it("thinkingLevelOverride returns null for 'off' (delegate to profile)", () => {
    expect(
      parseSessionSettings({ thinking_level: "off" }).thinkingLevelOverride(),
    ).toBeNull();
  });

  it("retry() parses base_delay_ms + max_retries + auto_retry", () => {
    const s = parseSessionSettings({
      auto_retry: "false",
      base_delay_ms: "1500",
      max_retries: "7",
    });
    expect(s.retry()).toEqual({
      autoRetry: false,
      baseDelayMs: 1500,
      maxRetries: 7,
    });
  });

  it("retry() falls back to defaults for missing keys", () => {
    const s = parseSessionSettings({});
    expect(s.retry()).toEqual({
      autoRetry: true,
      baseDelayMs: 2000,
      maxRetries: 3,
    });
  });

  it("compaction() delegates to parseCompactionSettings", () => {
    const s = parseSessionSettings({ auto_compaction: "true" });
    expect(s.compaction().autoCompactionEnabled).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/agent && pnpm run test -- session-settings 2>&1 | tail -20
```
Expected: FAIL with "Failed to resolve import" or "parseSessionSettings is not exported".

**Step 3: Implement `session-settings.ts`**

Look at `apps/server/src/agent/runner.ts:189-213` for the `DEFAULT_SETTINGS` map and verify the keys match. Then look at `packages/agent/src/compaction/retry-loop.ts:86-130` for the `RetrySettings` shape and `parseRetrySettings` behavior, and `packages/agent/src/compaction/auto-compaction.ts:323` for `parseCompactionSettings`.

```ts
// packages/agent/src/runner/session-settings.ts
import {
  parseCompactionSettings,
  type CompactionSettings,
} from "../compaction/auto-compaction.ts";
import {
  parseRetrySettings,
  type RetrySettings,
} from "../compaction/retry-loop.ts";
import type { QueueMode, ThinkingLevel } from "../types.ts";

/**
 * String literal mirroring `@sakti-code/tools`'s `EditMode`. Defined locally
 * to avoid a circular dep (tools → agent). The server's `EditMode` is
 * structurally identical and assignable.
 */
export type EditMode = "replace" | "hashline";

export const DEFAULT_SESSION_SETTINGS: Readonly<Record<string, string>> = {
  auto_compaction: "false",
  auto_retry: "true",
  // Exponential backoff base for application-level retry (2s → 4s → 8s).
  // Matches pi's coding-agent defaults (settings-manager.ts:807-813).
  base_delay_ms: "2000",
  follow_up_mode: "all",
  max_retries: "3",
  steering_mode: "all",
  thinking_level: "off",
};

export const DEFAULT_AGENT_NAME = "build";

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
  /**
   * null = no per-session override; the caller should fall back to the
   * profile default. "off" also returns null (off is the absence of
   * thinking).
   */
  thinkingLevelOverride(): ThinkingLevel | null;
}

export function parseSessionSettings(
  raw: Record<string, string>,
): SessionSettings {
  const merged = { ...DEFAULT_SESSION_SETTINGS, ...raw };
  return {
    raw: merged,
    agent: () => merged.agent ?? DEFAULT_AGENT_NAME,
    autoCompaction: () => merged.auto_compaction === "true",
    autoRetry: () => merged.auto_retry !== "false",
    editMode: () =>
      merged.edit_mode === "replace" ? "replace" : "hashline",
    followUpMode: () =>
      merged.follow_up_mode === "one-at-a-time"
        ? "one-at-a-time"
        : "all",
    steeringMode: () =>
      merged.steering_mode === "one-at-a-time"
        ? "one-at-a-time"
        : "all",
    retry: () => parseRetrySettings(merged),
    compaction: () => parseCompactionSettings(merged),
    thinkingLevelOverride: () => {
      const v = merged.thinking_level;
      if (v === undefined || v === "off") return null;
      return v as ThinkingLevel;
    },
  };
}
```

**Step 4: Run test to verify it passes**

```bash
cd packages/agent && pnpm run test -- session-settings 2>&1 | tail -20
```
Expected: PASS — all 8 tests.

**Step 5: Typecheck + lint**

```bash
cd packages/agent && pnpm run typecheck 2>&1 | tail -5
```
Expected: exit 0.

```bash
pnpm run fix 2>&1 | tail -3
```
Expected: exit 0; no diagnostics.

### Task I1.2: Export `SessionSettings` from `packages/agent/src/index.ts`

**Files:**
- Modify: `packages/agent/src/index.ts`

**Step 1: Add exports**

Insert after the existing `compaction/retry-loop` exports (around line 69), grouped logically with other runner-related exports. Use this exact block:

```ts
export type { EditMode as SessionEditMode, SessionSettings } from "./runner/session-settings.ts";
export {
  DEFAULT_AGENT_NAME as DEFAULT_SESSION_AGENT_NAME,
  DEFAULT_SESSION_SETTINGS,
  parseSessionSettings,
} from "./runner/session-settings.ts";
```

Note: `EditMode` is renamed to `SessionEditMode` on export to avoid clashing with the server's `EditMode` import from `@sakti-code/tools` (structurally identical but conceptually distinct).

**Step 2: Verify**

```bash
cd packages/agent && pnpm run typecheck 2>&1 | tail -3 && pnpm run test 2>&1 | grep "Tests " | head -2
```
Expected: typecheck exit 0; tests 367 passed (359 + 8 new). No regressions.

### Task I1.3: Migrate `apps/server` to use `parseSessionSettings`

**Files:**
- Modify: `apps/server/src/agent/runner.ts:189-213` — delete `DEFAULT_SETTINGS` constant; `loadSessionSettings` keeps returning `Record<string,string>` but no longer merges defaults (the typed view does that).
- Modify: any callers that read from `loadSessionSettings(...)` directly to wrap with `parseSessionSettings`.

**Step 1: Update `loadSessionSettings`**

Find (around line 201-213):
```ts
const DEFAULT_SETTINGS: Record<string, string> = { ... };

export function loadSessionSettings(
  ctx: ServerContext,
  sessionId: string
): Record<string, string> {
  const prefix = `session:${sessionId}:`;
  const rows = ctx.repos.settings.getByPrefix(prefix);
  const overrides: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.slice(prefix.length);
    overrides[key] = row.value;
  }
  return { ...DEFAULT_SETTINGS, ...overrides };
}
```

Replace with (delete `DEFAULT_SETTINGS` entirely):
```ts
export function loadSessionSettings(
  ctx: ServerContext,
  sessionId: string
): Record<string, string> {
  const prefix = `session:${sessionId}:`;
  const rows = ctx.repos.settings.getByPrefix(prefix);
  const overrides: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.slice(prefix.length);
    overrides[key] = row.value;
  }
  return overrides;
}
```

**Step 2: Update callers inside runner.ts**

At each call site that does `const settings = loadSessionSettings(ctx, sessionId);` and then reads `settings.foo`, wrap with `parseSessionSettings`:

In `runPromptEffect` (around line 502):
```ts
const settings = parseSessionSettings(loadSessionSettings(ctx, sessionId));
```

Then update downstream reads:
- `settings.follow_up_mode` → `settings.followUpMode()`
- `settings.steering_mode` → `settings.steeringMode()`
- `parseCompactionSettings(settings)` → `settings.compaction()`
- `parseRetrySettings(settings)` → `settings.retry()`
- `settings.agent ?? DEFAULT_AGENT_NAME` → `settings.agent()`

Add the import at the top:
```ts
import { parseSessionSettings } from "@sakti-code/agent";
```

Keep `parseCompactionSettings`/`parseRetrySettings`/`DEFAULT_AGENT_NAME` imports if still used elsewhere in runner.ts (likely no after migration — remove unused).

**Step 3: Run server tests**

```bash
cd apps/server && pnpm run typecheck 2>&1 | tail -3 && pnpm run test 2>&1 | grep -E "Tests |FAIL " | head -5
```
Expected: typecheck exit 0; tests 313 passed, 2 failed (the pre-existing API-key failures). No new failures.

**Step 4: Lint fix**

```bash
pnpm run fix 2>&1 | tail -3
```

**Step 5: Commit**

```bash
git add packages/agent/src/runner/ packages/agent/src/index.ts apps/server/src/agent/runner.ts
git commit -m "feat(agent): SessionSettings typed view (Phase I1)

Move DEFAULT_SESSION_SETTINGS + parsing logic from
apps/server/src/agent/runner.ts into packages/agent as a typed view.
Server's loadSessionSettings keeps reading DB rows but no longer merges
defaults — callers wrap with parseSessionSettings.

EditMode defined locally (string union) to avoid circular dep on
@sakti-code/tools; exported as SessionEditMode."
```

---

## Phase I2 — `StuckGuardState` typed export

**Goal:** Promote the `StuckGuardState` interface from `apps/server/src/agent/runner.ts:286-289` to a typed export in `packages/agent`. Small but sets up the factory's deps shape.

### Task I2.1: Add `StuckGuardState` to `packages/agent`

**Files:**
- Modify: `packages/agent/src/compaction/retry-loop.ts` — add the interface near the existing `RetryRunnerDepsEffect` (it's used by `checkCompaction` callbacks).
- Modify: `packages/agent/src/index.ts` — export the type.
- Modify: `apps/server/src/agent/runner.ts:286-289` — delete the local interface, import from `@sakti-code/agent`.

**Step 1: Add the type in retry-loop.ts**

Insert immediately before `RetryRunnerDepsEffect` (around line 179):

```ts
/**
 * Persistent state for the auto-compaction stuck-guard (§4 of the
 * auto-compaction plan). Tracks consecutive auto-compactions so
 * {@link checkCompaction} can pause when the context window is too
 * small (≥2 compacts in a row that still leave the prompt over
 * threshold).
 *
 * The pure decision lives in `checkCompaction`; callers (the runner /
 * agent-run factory) own the persistence so the counter survives
 * across `runPrompt` calls and app restarts.
 */
export interface StuckGuardState {
  consecutiveCompacts: number;
  paused: boolean;
}
```

**Step 2: Export from index.ts**

In the existing `compaction/retry-loop.ts` export block (lines 58-69), add `StuckGuardState` to the type exports:

```ts
export type {
  RetryDecisionInput,
  RetryRunnerDepsEffect,
  RetrySettings,
  StuckGuardState,
} from "./compaction/retry-loop.ts";
```

**Step 3: Migrate server to use the exported type**

In `apps/server/src/agent/runner.ts`:
- Add `StuckGuardState` to the existing `import type { ... } from "@sakti-code/agent";` block (line 4-12).
- Delete the local interface at lines 286-289.

**Step 4: Verify**

```bash
cd packages/agent && pnpm run typecheck 2>&1 | tail -3
cd apps/server && pnpm run typecheck 2>&1 | tail -3
pnpm run fix 2>&1 | tail -3
```
Expected: all exit 0.

**Step 5: Commit**

```bash
git add packages/agent/src/compaction/retry-loop.ts packages/agent/src/index.ts apps/server/src/agent/runner.ts
git commit -m "refactor(agent): promote StuckGuardState to packages/agent (Phase I2)

Sets up the agent-run factory's deps shape (loadStuckGuard /
persistStuckGuard will return Effect<StuckGuardState, Error>)."
```

---

## Phase I3 — `runAgentRunEffect` factory + tests

**Goal:** Create the factory in `packages/agent`. Not yet wired into the server — fully tested in isolation. This is the biggest phase.

**Reference for the implementation:** `apps/server/src/agent/runner.ts:620-822` — the orchestration block to move verbatim. Read it before starting.

### Task I3.1: Create the factory skeleton + first test (event drain)

**Files:**
- Create: `packages/agent/src/runner/agent-run.ts`
- Create: `packages/agent/src/runner/__tests__/agent-run.test.ts`

**Step 1: Write the failing test**

The first test asserts the most basic contract: events from the harness's event stream reach `emit`, and the run registers/unregisters.

```ts
// packages/agent/src/runner/__tests__/agent-run.test.ts
import { Effect, Fiber, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentHarness } from "../../agent/agent-harness.ts";
import { AgentHarness as HarnessClass } from "../../agent/agent-harness.ts";
import { InMemorySessionStorageLive } from "../../session/storage.ts";
import { PromiseSession, promiseSessionAsShape } from "../../session/session.ts";
import { runAgentRunEffect } from "../agent-run.ts";
import { parseCompactionSettings } from "../../compaction/auto-compaction.ts";
import { parseRetrySettings } from "../../compaction/retry-loop.ts";

// Tests reuse the harness test setup pattern. The harness needs a model +
// apiKey + getApiKeyAndHeaders; we use a fake streamFn that emits one
// assistant message and stops.

function makeHarness() {
  const storage = new InMemorySessionStorageLive();
  const session = new PromiseSession(storage);
  const sessionShape = promiseSessionAsShape(session);
  // Construct a harness with a no-op streamFn. The factory tests don't
  // exercise the LLM path — they assert on event-drain / registerRun /
  // planFirstTurn dispatch wiring.
  const harness = new HarnessClass({
    env: fakeExecEnv,
    model: { id: "test", provider: "test" } as never,
    session: sessionShape,
    streamFn: async () => fakeStreamResponse(),
    getApiKeyAndHeaders: async () => ({ apiKey: "test" }),
  });
  return { harness, sessionShape, storage };
}

describe("runAgentRunEffect", () => {
  it("emits harness events via the emit callback", async () => {
    const { harness, sessionShape, storage } = makeHarness();
    const events: unknown[] = [];
    await Effect.runPromise(
      runAgentRunEffect({
        harness,
        sessionShape,
        storage,
        message: "hello",
        retrySettings: parseRetrySettings({}),
        compactionSettings: parseCompactionSettings({}),
        model: { id: "test", provider: "test" } as never,
        apiKey: "test",
        skills: [],
        templates: [],
        cwd: "/tmp",
        loadStuckGuard: () => Effect.succeed({ consecutiveCompacts: 0, paused: false }),
        persistStuckGuard: () => Effect.void,
        emit: (e) => events.push(e),
      }),
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)).toMatchObject({ type: "agent_stop" });
  });
});
```

**Step 2: Run to verify it fails**

```bash
cd packages/agent && pnpm run test -- agent-run 2>&1 | tail -10
```
Expected: FAIL — `runAgentRunEffect` not found.

**Step 3: Implement the skeleton**

```ts
// packages/agent/src/runner/agent-run.ts
import { Effect, Fiber, Stream } from "effect";
import { readFile as readFileAsync } from "node:fs/promises";
import type { AgentHarness, AgentHarnessEvent } from "../agent/agent-harness.ts";
import type { Logger } from "../log/logger.ts";
import type { SessionShape } from "../session/session.ts";
import type { SessionStorageShape } from "../session/storage.ts";
import type {
  CompactionSettings,
  RetrySettings,
  StuckGuardState,
} from "../compaction/retry-loop.ts";
import type { Skill, PromptTemplate, ThinkingLevel } from "../harness-types.ts";
import {
  executeWithRetryEffect,
  type RetryRunnerDepsEffect,
} from "../compaction/retry-loop.ts";
import {
  checkCompaction,
  runAutoCompationEffect,
} from "../compaction/auto-compaction.ts";
import { planFirstTurn } from "../resources/prompt-preprocessor.ts";
import type { Model } from "@sakti-code/llm";
import type { AssistantMessage } from "@sakti-code/llm";

const PROMPT_ARG_SPLIT = /\s+/;

export interface AgentRunDeps {
  readonly harness: AgentHarness;
  readonly sessionShape: SessionShape;
  readonly storage: SessionStorageShape;

  readonly message: string;
  readonly retrySettings: RetrySettings;
  readonly compactionSettings: CompactionSettings;
  readonly model: Model;
  readonly apiKey: string;
  readonly thinkingLevel?: ThinkingLevel;

  readonly skills: Skill[];
  readonly templates: PromptTemplate[];
  readonly cwd: string;
  readonly readFile?: (path: string) => Promise<string | null>;

  readonly loadStuckGuard: () => Effect.Effect<StuckGuardState, Error>;
  readonly persistStuckGuard: (
    state: StuckGuardState,
  ) => Effect.Effect<void, Error>;

  readonly emit: (event: AgentHarnessEvent) => void;

  readonly registerRun?: (info: {
    harness: AgentHarness;
    retryAbort: AbortController;
    unsubscribe: () => void;
  }) => boolean;
  readonly unregisterRun?: () => void;

  readonly log?: Logger;
}

/**
 * Run one agent prompt end-to-end: subscribe the event stream, register the
 * run, run `executeWithRetryEffect` with retry-deps that dispatch
 * `planFirstTurn` and apply auto-compaction policy (including the stuck-guard),
 * and clean up on exit.
 *
 * This is the consumer-agnostic orchestration that was previously inlined in
 * `apps/server/src/agent/runner.ts:runPromptEffect`. The caller builds the
 * harness and provides I/O via callbacks.
 */
export function runAgentRunEffect(
  deps: AgentRunDeps,
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    const {
      harness,
      sessionShape,
      storage,
      message,
      retrySettings,
      compactionSettings,
      model,
      apiKey,
      skills,
      templates,
      cwd,
      emit,
      loadStuckGuard,
      persistStuckGuard,
    } = deps;
    const thinkingLevel = deps.thinkingLevel;
    const log = deps.log;
    const readFile =
      deps.readFile ??
      ((p: string) =>
        readFileAsync(p, "utf-8")
          .then((s) => s)
          .catch(() => null));

    // ── Event drain (Phase F: PubSub-backed subscribeStream) ─────
    const eventStream = harness.subscribeStream();
    const drainFiber = Effect.runFork(
      Stream.runForEach(eventStream, (event) =>
        Effect.sync(() => emit(event)),
      ),
    );

    // ── Retry abort (covers backoff sleep between turns) ────────
    const retryAbort = new AbortController();
    const unsubscribe = () => {
      Effect.runPromise(Fiber.interrupt(drainFiber).pipe(Effect.exit));
    };

    if (deps.registerRun) {
      const ok = deps.registerRun({
        harness,
        retryAbort,
        unsubscribe,
      });
      if (!ok) {
        unsubscribe();
        return yield* Effect.fail(
          new Error("A run is already active for this session"),
        );
      }
    }

    // ── Stuck-guard state (cached for this run's callbacks) ─────
    const stuckGuard = yield* loadStuckGuard();

    // ── Build the retry deps ────────────────────────────────────
    let firstTurn = true;
    const depsEffect: RetryRunnerDepsEffect = {
      signal: retryAbort.signal,
      emit: (event) => emit(event),
      ...(log === undefined ? {} : { logger: log }),
      rollbackLeaf: () =>
        Effect.gen(function* () {
          const branch = yield* sessionShape.getBranch();
          const lastEntry = branch.at(-1);
          if (lastEntry?.parentId) {
            yield* storage.setLeafId(lastEntry.parentId);
          }
        }),
      runTurn: () =>
        Effect.gen(function* () {
          if (firstTurn) {
            firstTurn = false;
            log?.info("turn prompt", { messageLength: message.length });
            const plan = yield* Effect.tryPromise({
              try: () =>
                planFirstTurn(
                  message,
                  { skills, templates },
                  cwd,
                  readFile,
                ),
              catch: (e: unknown) =>
                new Error(`planFirstTurn failed: ${String(e)}`),
            });
            if (plan.kind === "template") {
              const argv = plan.args.trim()
                ? plan.args.trim().split(PROMPT_ARG_SPLIT)
                : [];
              return yield* harness.promptFromTemplateEffect(plan.name, argv);
            }
            if (plan.kind === "skill") {
              return yield* harness.skillEffect(
                plan.name,
                plan.args.length > 0 ? plan.args : undefined,
              );
            }
            return yield* harness.promptEffect(plan.text);
          }
          log?.info("turn retry");
          return yield* harness.continueEffect();
        }),
      checkCompaction: (assistantMessage: AssistantMessage) =>
        Effect.gen(function* () {
          const entries = yield* sessionShape.getBranch();
          const messages = (yield* sessionShape.buildContext()).messages;
          let latestCompactionTimestamp: number | undefined;
          for (let i = entries.length - 1; i >= 0; i--) {
            const entry = entries[i];
            if (entry?.type === "compaction") {
              const ts = Date.parse(entry.timestamp);
              latestCompactionTimestamp = Number.isNaN(ts) ? undefined : ts;
              break;
            }
          }
          const decision = checkCompaction({
            message: assistantMessage,
            messages,
            contextWindow: model.contextWindow ?? 0,
            settings: compactionSettings,
            ...(latestCompactionTimestamp === undefined
              ? {}
              : { latestCompactionTimestamp }),
            ...(stuckGuard.consecutiveCompacts > 0
              ? { consecutiveCompacts: stuckGuard.consecutiveCompacts }
              : {}),
          });
          if (decision.pauseAutoCompaction) {
            stuckGuard.paused = true;
            yield* persistStuckGuard(stuckGuard);
            log?.warn("auto-compaction paused (stuck guard)", {
              consecutiveCompacts: stuckGuard.consecutiveCompacts,
            });
          } else if (decision.resetStuckGuard) {
            stuckGuard.consecutiveCompacts = 0;
            stuckGuard.paused = false;
            yield* persistStuckGuard(stuckGuard);
          }
          return decision;
        }),
      runCompaction: () =>
        Effect.gen(function* () {
          if (stuckGuard.paused) {
            return {
              ok: false as const,
              errorMessage: "Auto-compaction paused (stuck guard)",
            };
          }
          const result = yield* runAutoCompationEffect({
            session: sessionShape,
            model,
            apiKey,
            settings: compactionSettings,
            ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
          });
          if (result.ok) {
            stuckGuard.consecutiveCompacts += 1;
            yield* persistStuckGuard(stuckGuard);
          }
          return result;
        }),
    };

    yield* executeWithRetryEffect(depsEffect, retrySettings);
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        deps.unregisterRun?.();
        // The drain fiber is interrupted via `unsubscribe`, but call it
        // explicitly here too so the ensuring block is self-contained
        // (covers the case where registerRun was not provided).
      }),
    ),
    // Note: caller's Effect.ensuring (rejectPending permission channel,
    // log error) wraps this Effect from outside — the factory only owns
    // the orchestration-internal cleanup.
  );
}
```

**Step 4: Run test**

```bash
cd packages/agent && pnpm run test -- agent-run 2>&1 | tail -15
```
Expected: PASS — the first test asserts events are drained + agent_stop is emitted.

If `fakeStreamResponse` / `fakeExecEnv` helpers don't exist in the test, look at existing harness tests in `packages/agent/src/agent/__tests__/` to find the pattern for fake streamFn + fake env. Reuse those helpers.

**Step 5: Commit**

```bash
git add packages/agent/src/runner/agent-run.ts packages/agent/src/runner/__tests__/agent-run.test.ts
git commit -m "feat(agent): runAgentRunEffect factory skeleton (Phase I3.1)

Owns event drain + retry abort + registerRun hook. Subsequent tasks
add planFirstTurn dispatch, compaction, stuck-guard, retry-deps
assembly. Not yet wired into the server."
```

### Task I3.2: Add test for `registerRun` / `unregisterRun` hooks

**Step 1: Write failing test**

```ts
describe("runAgentRunEffect registerRun/unregisterRun", () => {
  it("calls registerRun on start and unregisterRun on exit (success)", async () => {
    const { harness, sessionShape, storage } = makeHarness();
    const registered = vi.fn(() => true);
    const unregistered = vi.fn();
    await Effect.runPromise(
      runAgentRunEffect({
        ...baseDeps(harness, sessionShape, storage),
        registerRun: registered,
        unregisterRun: unregistered,
      }),
    );
    expect(registered).toHaveBeenCalledOnce();
    expect(registered.mock.calls[0]?.[0]).toMatchObject({
      harness,
      retryAbort: expect.any(AbortController),
      unsubscribe: expect.any(Function),
    });
    expect(unregistered).toHaveBeenCalledOnce();
  });

  it("fails with busy error when registerRun returns false", async () => {
    const { harness, sessionShape, storage } = makeHarness();
    const promise = Effect.runPromise(
      runAgentRunEffect({
        ...baseDeps(harness, sessionShape, storage),
        registerRun: () => false,
        unregisterRun: () => {},
      }),
    );
    await expect(promise).rejects.toThrow(/already active/);
  });

  it("calls unregisterRun even on failure", async () => {
    const { harness, sessionShape, storage } = makeHarness();
    const unregistered = vi.fn();
    // Force failure by providing a harness that rejects on promptEffect.
    const promise = Effect.runPromise(
      runAgentRunEffect({
        ...baseDeps(harness, sessionShape, storage),
        registerRun: () => true,
        unregisterRun: unregistered,
        // Override message to one that planFirstTurn rejects on:
        message: "",  // or whatever forces a failure
      }),
    );
    try { await promise; } catch { /* expected */ }
    expect(unregistered).toHaveBeenCalledOnce();
  });
});
```

**Step 2: Run — verify fails or passes**

If the skeleton from I3.1 already implements registerRun/unregisterRun correctly, these tests pass immediately. If not, fix the skeleton.

**Step 3: Commit**

```bash
git add packages/agent/src/runner/__tests__/agent-run.test.ts
git commit -m "test(agent): runAgentRunEffect register/unregister hooks (Phase I3.2)"
```

### Task I3.3: Add test for planFirstTurn dispatch

**Step 1: Write failing test**

Asserts that `/skill-name args` routes to `harness.skillEffect`, `/template arg` routes to `harness.promptFromTemplateEffect`, plain text routes to `harness.promptEffect`. Spy on the harness methods.

```ts
describe("runAgentRunEffect planFirstTurn dispatch", () => {
  it("plain text → harness.promptEffect", async () => {
    const { harness, sessionShape, storage } = makeHarness();
    const spy = vi.spyOn(harness, "promptEffect");
    await Effect.runPromise(
      runAgentRunEffect({
        ...baseDeps(harness, sessionShape, storage),
        message: "hello world",
      }),
    );
    expect(spy).toHaveBeenCalled();
  });

  it("leading / routes to promptFromTemplateEffect when template exists", async () => {
    const { harness, sessionShape, storage } = makeHarness();
    const spy = vi.spyOn(harness, "promptFromTemplateEffect");
    await Effect.runPromise(
      runAgentRunEffect({
        ...baseDeps(harness, sessionShape, storage),
        message: "/review",
        templates: [{ name: "review", content: "..." }],
      }),
    );
    expect(spy).toHaveBeenCalledWith("review", []);
  });

  it("leading skill: routes to skillEffect when skill exists", async () => {
    const { harness, sessionShape, storage } = makeHarness();
    const spy = vi.spyOn(harness, "skillEffect");
    await Effect.runPromise(
      runAgentRunEffect({
        ...baseDeps(harness, sessionShape, storage),
        message: "skill:brainstorm hello",
        skills: [
          {
            name: "brainstorm",
            content: "...",
            description: "...",
            filePath: "/tmp/x.md",
          },
        ],
      }),
    );
    expect(spy).toHaveBeenCalledWith("brainstorm", "hello");
  });
});
```

**Step 2: Run — should pass (factory already dispatches via planFirstTurn).**

**Step 3: Commit**

```bash
git add packages/agent/src/runner/__tests__/agent-run.test.ts
git commit -m "test(agent): planFirstTurn dispatch routing (Phase I3.3)"
```

### Task I3.4: Add test for stuck-guard persistence

**Step 1: Write failing test**

This requires forcing the run into a state where checkCompaction fires. Easiest path: provide a `loadStuckGuard` that returns a high `consecutiveCompacts` (forces pauseAutoCompaction decision) and assert `persistStuckGuard` is called.

```ts
describe("runAgentRunEffect stuck-guard", () => {
  it("loads stuck-guard state at run start", async () => {
    const { harness, sessionShape, storage } = makeHarness();
    const loadSpy = vi.fn(() => Effect.succeed({ consecutiveCompacts: 0, paused: false }));
    await Effect.runPromise(
      runAgentRunEffect({
        ...baseDeps(harness, sessionShape, storage),
        loadStuckGuard: loadSpy,
      }),
    );
    expect(loadSpy).toHaveBeenCalledOnce();
  });

  // The full checkCompaction/runCompaction behavior is already tested in
  // retry-loop.test.ts. Here we only verify the factory wires the callbacks.
});
```

**Step 2: Run, verify pass. Commit.**

```bash
git add packages/agent/src/runner/__tests__/agent-run.test.ts
git commit -m "test(agent): stuck-guard callback wiring (Phase I3.4)"
```

### Task I3.5: Export factory from index.ts

**Files:**
- Modify: `packages/agent/src/index.ts`

**Step 1: Add exports**

After the session-settings exports from I1.2, add:

```ts
export type { AgentRunDeps } from "./runner/agent-run.ts";
export { runAgentRunEffect } from "./runner/agent-run.ts";
```

**Step 2: Verify**

```bash
cd packages/agent && pnpm run typecheck 2>&1 | tail -3 && pnpm run test 2>&1 | grep "Tests " | head -2
pnpm run fix 2>&1 | tail -3
```
Expected: typecheck exit 0; tests pass (359 + new agent-run tests, ~10-15 new). No regressions.

**Step 3: Commit**

```bash
git add packages/agent/src/index.ts
git commit -m "feat(agent): export runAgentRunEffect (Phase I3.5)"
```

---

## Phase I4 — Migrate `runPromptEffect` to use the factory

**Goal:** Replace the 360-LOC inline retry-deps block in `apps/server/src/agent/runner.ts:runPromptEffect` with a single call to `runAgentRunEffect`.

### Task I4.1: Replace the retry-deps block with factory call

**Files:**
- Modify: `apps/server/src/agent/runner.ts:461-822` — replace lines 620-822 (everything from `// Phase F: event delivery via PubSub` through `executeWithRetryEffect(depsEffect, retrySettings);` and the `.pipe(Effect.ensuring(...), Effect.mapError(...))`) with a `runAgentRunEffect({...})` call.

**Step 1: Update imports**

Add to the `@sakti-code/agent` import block:
```ts
import {
  ...,
  runAgentRunEffect,
} from "@sakti-code/agent";
```

Remove now-unused imports:
- `executeWithRetryEffect` — moved into factory
- `RetryRunnerDepsEffect` — moved into factory
- `checkCompaction` — moved into factory
- `runAutoCompationEffect` — moved into factory
- `planFirstTurn` — moved into factory

Keep `parseRetrySettings` / `parseCompactionSettings` only if still used after the SessionSettings migration (probably not — they're now methods on the typed view).

Remove the `readFile` import from `node:fs/promises` if no longer used (it was only for planFirstTurn's @file expansion — now in the factory).

Remove `Effect, Fiber, Stream` imports if no longer used directly.

**Step 2: Replace the block**

Find lines 620-822 (the `// Phase F: event delivery` block through the end of the `.pipe(Effect.ensuring(...), Effect.mapError(...))`). Replace with:

```ts
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
      loadStuckGuard: () =>
        Effect.sync(() => loadStuckGuardState(ctx, sessionId)),
      persistStuckGuard: (s) =>
        Effect.tryPromise(() => persistStuckGuardState(ctx, sessionId, s)),
      emit: eventCallback,
      registerRun: ({ harness: h, retryAbort, unsubscribe }) =>
        registerRun(sessionId, h, unsubscribe, retryAbort),
      unregisterRun: () => unregisterRun(sessionId),
      ...(ctx.log === undefined ? {} : { log: ctx.log.agent }),
    });
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        ctx.log?.agent.info("run finished", { sessionId });
        // Reject any still-pending permission asks so the UI strip clears.
        getPermissionChannel(sessionId).rejectPending();
      }),
    ),
    Effect.mapError((error) => {
      const err =
        error instanceof Error
          ? error
          : new Error(`Run failed: ${String(error)}`);
      ctx.log?.agent.error("run failed", err, { sessionId });
      return err;
    }),
  );
}
```

Note: `run finished` log + `rejectPending` + `mapError` stay in the server — they're caller-side concerns. The factory's internal `Effect.ensuring` only handles `unregisterRun`.

**Step 3: Verify typecheck**

```bash
cd apps/server && pnpm run typecheck 2>&1 | tail -5
```
Expected: exit 0. If errors about unused imports, clean them up.

**Step 4: Run server tests**

```bash
cd apps/server && pnpm run test 2>&1 | grep -E "Tests |FAIL " | head -5
```
Expected: 313 passed, 2 failed (pre-existing API-key failures). No new failures.

If new failures appear, the migration has changed behavior — diff the failing test against the factory's wiring. Most likely cause: the `run finished` log moved or the `rejectPending` timing shifted.

**Step 5: Lint fix**

```bash
pnpm run fix 2>&1 | tail -3
```

**Step 6: Commit**

```bash
git add apps/server/src/agent/runner.ts
git commit -m "refactor(server): delegate runPromptEffect to runAgentRunEffect (Phase I4)

Replace 200+ lines of inline retry-deps assembly (event drain, retry
abort, planFirstTurn dispatch, stuck-guard policy, compaction
callbacks) with a single runAgentRunEffect call. Server keeps the
caller-side ensuring (rejectPending, run-finished log, mapError)."
```

---

## Phase I5 — Cleanup

**Goal:** Remove dead code paths exposed by the migration. Verify final state.

### Task I5.1: Check for orphaned exports / unused imports

**Step 1: Search for orphaned references**

```bash
rg -n "executeWithRetryEffect|RetryRunnerDepsEffect|runAutoCompationEffect" apps/server/src 2>&1
rg -n "planFirstTurn" apps/server/src 2>&1
```

Expected: no matches in `apps/server/src` (all moved to packages/agent).

If `routes/sessions/compaction.ts` still uses `runAutoCompationEffect` directly (it does — for the manual compaction route), leave that alone. The migration only touches `runner.ts`.

**Step 2: Verify agent package exports are coherent**

```bash
rg -n "^export" packages/agent/src/index.ts | wc -l
```
Confirm no duplicate exports. The new runner exports should be there:
- `parseSessionSettings`, `SessionSettings`, `DEFAULT_SESSION_SETTINGS`, `SessionEditMode`
- `StuckGuardState`
- `runAgentRunEffect`, `AgentRunDeps`

### Task I5.2: Final verification

**Step 1: Full workspace typecheck**

```bash
pnpm run typecheck 2>&1 | tail -5
```
Expected: exit 0.

**Step 2: Full workspace test**

```bash
cd packages/agent && pnpm run test 2>&1 | grep "Tests " | head -2
cd packages/db && pnpm run test 2>&1 | grep "Tests " | head -2
cd apps/server && pnpm run test 2>&1 | grep -E "Tests |FAIL " | head -5
cd apps/desktop && pnpm run test 2>&1 | grep "Tests " | head -2
```
Expected counts:
- agent: 359 + ~10-15 new = ~370+
- db: 36
- server: 313 passed, 2 failed (pre-existing, unchanged)
- desktop: 402

**Step 3: Lint + format**

```bash
pnpm run fix 2>&1 | tail -3
```
Expected: exit 0; no diagnostics.

**Step 4: Commit (if any cleanup)**

```bash
git add -A
git commit -m "chore: final cleanup after agent-loop-factory migration (Phase I5)"
```

---

## Risk notes

- **Phase I3.1 is the riskiest.** Constructing a real `AgentHarness` for tests requires a fake model + streamFn + env. Look at `packages/agent/src/agent/__tests__/helpers/` (or equivalent) for existing test doubles. Reuse aggressively — don't invent new fakes.
- **Phase I4 must not change behavior.** Run server tests after migration. If `e2e > two concurrent sessions` test starts flaking differently, the wiring order is wrong (most likely the `registerRun` hook timing or the ensuring block ordering).
- **`rejectPending` ownership.** Currently in the server's ensuring. The factory does NOT call it (it's not the factory's concern — it's the permission channel's lifecycle). Keep it in the server.
- **`PromiseSession` untouched.** The factory takes `sessionShape: SessionShape` (already Effect-native) and doesn't know about `PromiseSession`. The server keeps constructing it. Future Phase J (out of scope) could replace `PromiseSession` with a direct Effect-native shape builder.
