# /compact Command + Seamless OM Enable/Disable + Generation Pruning

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a mode-aware `/compact` slash command (regular compaction when OM off, force-reflect when OM on), make OM enable/disable seamless mid-session, prune old OM generations at reflection time, and fix minor schema issues.

**Architecture:** Four independent layers: (1) schema fixes in `packages/db`, (2) OM generation pruning in the storage interface + engine, (3) seamless OM enable/disable via read-only observation injection in the agent loop, (4) `/compact` as a typed WS command that dispatches to compaction or forced reflection based on OM state.

**Tech Stack:** TypeScript, Effect, Drizzle ORM (node:sqlite), Hono WebSocket, SolidJS, vitest (TDD).

---

## Phase 1: Schema Fixes

### Task 1: Fix `originType` comment mismatch

**Files:**

- Modify: `packages/db/src/schema.ts:120`

**Step 1: Fix the comment**

The schema comment at line 120 says `'initialization'` but the code writes `'initial'` (see `observational-memory-store.ts:167` and `observational-memory-storage.ts:19-23`).

Change:

```ts
    originType: text("origin_type").notNull(), // 'initialization' | 'observation' | 'reflection'
```

To:

```ts
    originType: text("origin_type").notNull(), // 'initial' | 'observation' | 'reflection'
```

**Step 2: Run typecheck**

Run: `vp check`
Expected: PASS (comment-only change)

**Step 3: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "fix(db): correct originType comment to match actual values"
```

---

### Task 2: Add index on `session_entries(sessionId, kind)`

**Files:**

- Modify: `packages/db/src/schema.ts:34-51`
- Create: new migration via drizzle-kit

**Step 1: Add index to schema**

In `packages/db/src/schema.ts`, change the `sessionEntries` table definition's index array:

```ts
export const sessionEntries = sqliteTable(
  "session_entries",
  {
    // ... columns unchanged ...
  },
  (table) => [
    uniqueIndex("session_entries_session_id_sequence_idx").on(table.sessionId, table.sequence),
    index("session_entries_session_id_kind_idx").on(table.sessionId, table.kind),
  ],
);
```

**Step 2: Generate migration**

Run: `cd packages/db && npx drizzle-kit generate`
Expected: new migration folder created under `packages/db/migrations/` with a `CREATE INDEX` statement.

**Step 3: Verify migration SQL**

Read the generated migration file. It should contain:

```sql
CREATE INDEX `session_entries_session_id_kind_idx` ON `session_entries` (`session_id`, `kind`);
```

**Step 4: Run tests**

Run: `vp run -r test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/migrations/
git commit -m "perf(db): add index on session_entries(sessionId, kind) for findEntries queries"
```

---

## Phase 2: OM Generation Pruning

### Task 3: Add `pruneHistory` to `ObservationalMemoryStorage` interface

**Files:**

- Modify: `packages/agent/src/observational-memory-storage.ts:187-223`
- Test: `packages/agent/src/__tests__/observational-memory-storage-contract.test.ts` (create if not exists)

**Step 1: Write the failing interface test**

Create or add to a storage contract test that verifies `pruneHistory` exists on the interface:

```ts
// packages/agent/src/__tests__/observational-memory-storage-contract.test.ts
import { describe, it, expect } from "vitest";
import type { ObservationalMemoryStorage } from "../observational-memory-storage.ts";

describe("ObservationalMemoryStorage contract", () => {
  it("includes pruneHistory method", () => {
    const stub: ObservationalMemoryStorage = {
      // ... all existing methods stubbed ...
      pruneHistory: async () => {},
    } as unknown as ObservationalMemoryStorage;
    expect(typeof stub.pruneHistory).toBe("function");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/agent#test'`
Expected: FAIL — `pruneHistory` does not exist on type

**Step 3: Add method to interface**

In `packages/agent/src/observational-memory-storage.ts`, add to the `ObservationalMemoryStorage` interface (after `swapBufferedReflectionToActive` at line 222):

```ts
  /**
   * Delete all OM generations for the given lookup key except the one with
   * `keepId`. Called after reflection to prune superseded observation
   * generations that are no longer accessible (engine always reads latest).
   */
  pruneHistory(threadId: string | null, resourceId: string, keepId: string): Promise<void>;
```

**Step 4: Run test to verify it passes**

Run: `vp run '@sakti-code/agent#test'`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/observational-memory-storage.ts packages/agent/src/__tests__/observational-memory-storage-contract.test.ts
git commit -m "feat(agent): add pruneHistory to ObservationalMemoryStorage interface"
```

---

### Task 4: Implement `pruneHistory` in `SqliteObservationalMemoryStorage`

**Files:**

- Modify: `packages/db/src/observational-memory-store.ts`
- Test: `packages/db/src/__tests__/observational-memory-store-prune.test.ts` (create)

**Step 1: Write the failing test**

```ts
// packages/db/src/__tests__/observational-memory-store-prune.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../init.ts";
import { SqliteObservationalMemoryStorage } from "../observational-memory-store.ts";
import type { ObservationalMemoryRecord } from "@sakti-code/agent";
import { DatabaseSync } from "node:sqlite";
import { observationalMemory } from "../schema.ts";
import { eq } from "drizzle-orm";

function makeRecord(
  id: string,
  generationCount: number,
  threadId: string | null,
  resourceId: string,
  originType: string = "observation",
): ObservationalMemoryRecord {
  return {
    id,
    scope: "thread",
    threadId,
    resourceId,
    createdAt: new Date(),
    updatedAt: new Date(),
    originType: originType as ObservationalMemoryRecord["originType"],
    generationCount,
    activeObservations: "test observations",
    totalTokensObserved: 100,
    observationTokenCount: 100,
    pendingMessageTokens: 0,
    isObserving: false,
    isReflecting: false,
    isBufferingObservation: false,
    isBufferingReflection: false,
    lastBufferedAtTokens: 0,
    config: {},
  };
}

describe("SqliteObservationalMemoryStorage.pruneHistory", () => {
  let db: ReturnType<
    typeof initDatabase extends (db: infer D) => any ? (D extends Promise<infer R> ? R : D) : never
  >;
  let storage: SqliteObservationalMemoryStorage;

  beforeEach(async () => {
    const sqlite = new DatabaseSync(":memory:");
    db = await initDatabase(sqlite);
    storage = new SqliteObservationalMemoryStorage(db);
  });

  it("deletes old generations, keeps the specified one", async () => {
    const threadId = "thread-1";
    const resourceId = "res-1";

    // Insert 3 generations
    await storage.insertObservationalMemoryRecord(
      makeRecord("gen-0", 0, threadId, resourceId, "initial"),
    );
    await storage.insertObservationalMemoryRecord(
      makeRecord("gen-1", 1, threadId, resourceId, "reflection"),
    );
    await storage.insertObservationalMemoryRecord(
      makeRecord("gen-2", 2, threadId, resourceId, "reflection"),
    );

    // Prune, keeping gen-2
    await storage.pruneHistory(threadId, resourceId, "gen-2");

    // Only gen-2 remains
    const remaining = await storage.getObservationalMemoryHistory(threadId, resourceId, 100);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe("gen-2");
  });

  it("does nothing when only one generation exists", async () => {
    const threadId = "thread-2";
    const resourceId = "res-2";

    await storage.insertObservationalMemoryRecord(
      makeRecord("only", 0, threadId, resourceId, "initial"),
    );
    await storage.pruneHistory(threadId, resourceId, "only");

    const remaining = await storage.getObservationalMemoryHistory(threadId, resourceId, 100);
    expect(remaining).toHaveLength(1);
  });

  it("only prunes for the matching lookupKey", async () => {
    const resourceA = "res-a";
    const resourceB = "res-b";

    await storage.insertObservationalMemoryRecord(makeRecord("a-0", 0, "thread-a", resourceA));
    await storage.insertObservationalMemoryRecord(
      makeRecord("a-1", 1, "thread-a", resourceA, "reflection"),
    );
    await storage.insertObservationalMemoryRecord(makeRecord("b-0", 0, "thread-b", resourceB));

    await storage.pruneHistory("thread-a", resourceA, "a-1");

    const aRemaining = await storage.getObservationalMemoryHistory("thread-a", resourceA, 100);
    expect(aRemaining).toHaveLength(1);
    expect(aRemaining[0]!.id).toBe("a-1");

    const bRemaining = await storage.getObservationalMemoryHistory("thread-b", resourceB, 100);
    expect(bRemaining).toHaveLength(1);
    expect(bRemaining[0]!.id).toBe("b-0");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/db#test'`
Expected: FAIL — `pruneHistory` does not exist

**Step 3: Implement `pruneHistory`**

In `packages/db/src/observational-memory-store.ts`, add the import and method:

Add to imports at top:

```ts
import { and, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
```

Add method to `SqliteObservationalMemoryStorage` class (after `clearObservationalMemory`, before `setPendingMessageTokens` or at end of class):

```ts
  async pruneHistory(threadId: string | null, resourceId: string, keepId: string): Promise<void> {
    this.db
      .delete(observationalMemory)
      .where(
        and(
          eq(observationalMemory.lookupKey, omLookupKey(threadId, resourceId)),
          ne(observationalMemory.id, keepId),
        ),
      )
      .run();
  }
```

**Step 4: Run test to verify it passes**

Run: `vp run '@sakti-code/db#test'`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/db/src/observational-memory-store.ts packages/db/src/__tests__/observational-memory-store-prune.test.ts
git commit -m "feat(db): implement pruneHistory in SqliteObservationalMemoryStorage"
```

---

### Task 5: Call `pruneHistory` from engine after reflection

**Files:**

- Modify: `packages/agent/src/memory/observational-memory/engine.ts:723-769` (`runSyncReflect`)
- Test: `packages/agent/src/memory/observational-memory/__tests__/engine-prune.test.ts` (create or extend existing)

**Step 1: Write the failing test**

Create a test that verifies `pruneHistory` is called after `runSyncReflect`:

```ts
// packages/agent/src/memory/observational-memory/__tests__/engine-prune.test.ts
import { describe, it, expect, vi } from "vitest";
// Import test helpers for constructing engine with mock storage
// Adapt imports to match existing engine test patterns

describe("ObservationalMemoryEngine reflection pruning", () => {
  it("calls pruneHistory after runSyncReflect", async () => {
    // Setup mock storage with pruneHistory spy
    const pruneHistorySpy = vi.fn().mockResolvedValue(undefined);
    // ... construct engine with mock deps and storage ...

    // Trigger reflection (either via maybeReflect with high tokens or forceReflect)
    // Assert pruneHistorySpy was called once with correct lookup key
  });
});
```

> **Note:** Adapt the mock setup to match existing engine test patterns in `__tests__/`. The key assertion is that `storage.pruneHistory` is called after a reflection completes.

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/agent#test'`
Expected: FAIL — pruneHistory not called

**Step 3: Add prune call to `runSyncReflect`**

In `packages/agent/src/memory/observational-memory/engine.ts`, in the `runSyncReflect` method (line 723), after `createReflectionGeneration` succeeds (after line 744) and before the `om_end` emit (line 746):

```ts
// Prune superseded generations (old observations are dead weight after reflection).
await this.storage.pruneHistory(
  this.deps.scope === "resource" ? null : this.sessionId,
  this.projectId,
  // The new generation's id — we need to read it back since createReflectionGeneration returns it
  reflectedResult.id,
);
```

Wait — `createReflectionGeneration` returns `ObservationalMemoryRecord`. Let me check... Yes, at line 740: `await this.storage.createReflectionGeneration(...)`. The return value is currently discarded. Capture it:

Change line 740 from:

```ts
await this.storage.createReflectionGeneration({
  currentRecord: record,
  reflection: reflectorResult.reflection,
  tokenCount: reflectorResult.tokenCount,
});
```

To:

```ts
const newRecord = await this.storage.createReflectionGeneration({
  currentRecord: record,
  reflection: reflectorResult.reflection,
  tokenCount: reflectorResult.tokenCount,
});

// Prune superseded generations.
await this.storage.pruneHistory(
  this.deps.scope === "resource" ? null : this.sessionId,
  this.projectId,
  newRecord.id,
);
```

Also apply the same pruning in `maybeActivateBufferedReflection` after `swapBufferedReflectionToActive` (around line 553). Find the call to `swapBufferedReflectionToActive`, capture the return value, and prune:

```ts
const newRecord = await this.storage.swapBufferedReflectionToActive({
  currentRecord: record,
  tokenCount,
});

// Prune superseded generations.
await this.storage.pruneHistory(
  this.deps.scope === "resource" ? null : this.sessionId,
  this.projectId,
  newRecord.id,
);
```

**Step 4: Run test to verify it passes**

Run: `vp run '@sakti-code/agent#test'`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/memory/observational-memory/engine.ts packages/agent/src/memory/observational-memory/__tests__/engine-prune.test.ts
git commit -m "feat(observational-memory): prune old generations after reflection"
```

---

## Phase 3: Engine `forceReflect()` Method

### Task 6: Add public `forceReflect()` to engine

**Files:**

- Modify: `packages/agent/src/memory/observational-memory/engine.ts`
- Test: `packages/agent/src/memory/observational-memory/__tests__/engine-force-reflect.test.ts` (create)

**Step 1: Write failing tests**

```ts
// packages/agent/src/memory/observational-memory/__tests__/engine-force-reflect.test.ts
import { describe, it, expect, vi } from "vitest";
// Adapt mock setup from existing engine tests

describe("ObservationalMemoryEngine.forceReflect", () => {
  it("reflects when observations exist, ignoring threshold", async () => {
    // Setup: record with observationTokenCount well below reflection threshold
    // but with non-empty activeObservations
    // Call forceReflect()
    // Expect: { reflected: true }
    // Expect: runReflector was called
    // Expect: pruneHistory was called
  });

  it("returns nothing-to-reflect when no observations exist", async () => {
    // Setup: record with empty activeObservations
    // Call forceReflect()
    // Expect: { reflected: false, reason: "nothing-to-reflect" }
    // Expect: runReflector was NOT called
  });

  it("activates buffered observations before reflecting", async () => {
    // Setup: record with buffered observation chunks
    // Call forceReflect()
    // Expect: swapBufferedToActive was called
    // Expect: reflector ran on merged observations
  });

  it("emits om_start and om_end events", async () => {
    // Setup: onOmEvent callback spy
    // Call forceReflect()
    // Expect: om_start emitted with operationType "reflection"
    // Expect: om_end emitted
  });
});
```

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/agent#test'`
Expected: FAIL — `forceReflect` does not exist

**Step 3: Implement `forceReflect`**

In `packages/agent/src/memory/observational-memory/engine.ts`, add this public method (after `maybeReflect`, around line 255):

```ts
  /**
   * Force a reflection cycle regardless of the reflection threshold.
   * Activates any buffered observations/reflections first so nothing
   * is stranded. Used by the /compact command when OM is enabled.
   *
   * Returns whether a reflection actually occurred.
   */
  async forceReflect(): Promise<{ reflected: boolean; reason?: string }> {
    let record = await this.getOrCreateRecord();

    // Activate buffered observations so nothing is stranded.
    if (this.bufferingCoordinator.isAsyncObservationEnabled()) {
      record = await this.maybeActivateBufferedObservations(record);
    }

    // Activate buffered reflection if present.
    if (this.bufferingCoordinator.isAsyncReflectionEnabled()) {
      const activated = await this.maybeActivateBufferedReflection(record);
      if (activated.id !== record.id) {
        record = await this.getOrCreateRecord();
      }
    }

    // Nothing to reflect on.
    if (!record.activeObservations?.trim() || record.observationTokenCount === 0) {
      return { reflected: false, reason: "nothing-to-reflect" };
    }

    await this.runSyncReflect(record);
    return { reflected: true };
  }
```

**Step 4: Run test to verify it passes**

Run: `vp run '@sakti-code/agent#test'`
Expected: PASS

**Step 5: Export from index**

Check `packages/agent/src/index.ts` exports the engine class (it should already — verify).

**Step 6: Commit**

```bash
git add packages/agent/src/memory/observational-memory/engine.ts packages/agent/src/memory/observational-memory/__tests__/engine-force-reflect.test.ts
git commit -m "feat(observational-memory): add forceReflect() for manual /compact invocation"
```

---

## Phase 4: Seamless OM Enable/Disable

### Task 7: Extract standalone `buildObservationsBlock` function

**Files:**

- Modify: `packages/agent/src/memory/observational-memory/prompts.ts`
- Test: `packages/agent/src/memory/observational-memory/__tests__/prompts.test.ts` (extend or create)

**Step 1: Write the failing test**

```ts
// In prompts.test.ts (or create)
describe("buildObservationsBlock", () => {
  it("returns formatted block when record has active observations", async () => {
    const record = { activeObservations: "obs-1\nobs-2" } as any;
    const result = await buildObservationsBlock(record);
    expect(result).toBeDefined();
    expect(result).toContain("<observations>");
    expect(result).toContain("obs-1");
  });

  it("returns undefined when record has no active observations", async () => {
    const record = { activeObservations: "" } as any;
    const result = await buildObservationsBlock(record);
    expect(result).toBeUndefined();
  });

  it("returns undefined when record is null", async () => {
    const result = await buildObservationsBlock(null);
    expect(result).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/agent#test'`
Expected: FAIL — `buildObservationsBlock` does not exist

**Step 3: Implement the function**

In `packages/agent/src/memory/observational-memory/prompts.ts`, add at the end:

```ts
import type { ObservationalMemoryRecord } from "../../observational-memory-storage.ts";

/**
 * Read-only: build the <observations> system-message suffix from an
 * existing OM record, or undefined if there are no observations.
 *
 * This is the "read-only" path used when OM is disabled but prior
 * history exists — the observations block must still be injected so
 * the LLM has the accumulated memory, even though no new
 * observe/reflect cycles run.
 */
export async function buildObservationsBlock(
  record: ObservationalMemoryRecord | null,
): Promise<string | undefined> {
  if (!record) return undefined;
  return formatObservationsForContext(record.activeObservations);
}
```

**Step 4: Run test to verify it passes**

Run: `vp run '@sakti-code/agent#test'`
Expected: PASS

**Step 5: Export from index**

Verify `buildObservationsBlock` is exported from the agent package index (`packages/agent/src/index.ts`). Add if missing.

**Step 6: Commit**

```bash
git add packages/agent/src/memory/observational-memory/prompts.ts packages/agent/src/memory/observational-memory/__tests__/prompts.test.ts packages/agent/src/index.ts
git commit -m "feat(observational-memory): extract buildObservationsBlock for read-only injection"
```

---

### Task 8: Wire read-only observation injection in agent loop

**Files:**

- Modify: `packages/agent/src/core/agent-loop.ts:289-307` (first-turn injection)
- Modify: `packages/agent/src/core/agent-loop.ts:408-432` (turn-boundary injection)

The agent loop currently gates ALL OM behavior behind `if (config.observationalMemory)`. When OM is disabled, no observations block is injected — even if prior history exists. We need a new `config.observationalMemoryReadOnly` path.

**Step 1: Write the failing test**

Create a test that verifies the agent loop injects observations when OM is disabled but history exists. This requires simulating an agent run with `observationalMemoryReadOnly` set but `observationalMemory` unset.

```ts
// packages/agent/src/core/__tests__/agent-loop-om-readonly.test.ts
import { describe, it, expect, vi } from "vitest";
// Adapt from existing agent-loop test setup

describe("agent loop read-only OM injection", () => {
  it("injects <observations> when OM disabled but history exists", async () => {
    // Setup: config with observationalMemoryReadOnly = { storage, sessionId, projectId }
    // Mock storage.getObservationalMemory returns record with activeObservations
    // Run one turn
    // Expect: system prompt contains "<observations>"
  });

  it("does not inject when no OM history exists", async () => {
    // Setup: config with observationalMemoryReadOnly, storage returns null
    // Run one turn
    // Expect: system prompt does NOT contain "<observations>"
  });
});
```

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/agent#test'`
Expected: FAIL

**Step 3: Add read-only config type**

In `packages/agent/src/core/agent-loop.ts` (or wherever the loop config type is defined — check the file for the config interface), add:

```ts
  /**
   * Read-only OM: inject <observations> from existing history without
   * running observe/reflect. Set when OM is disabled but prior history exists.
   */
  readonly observationalMemoryReadOnly?: {
    readonly storage: ObservationalMemoryStorage;
    readonly sessionId: string;
    readonly projectId: string;
    readonly scope: "thread" | "resource";
  } | undefined;
```

**Step 4: Wire injection in agent loop**

In `packages/agent/src/core/agent-loop.ts`, modify the first-turn OM injection block (lines 289-307). Currently:

```ts
if (config.observationalMemory) {
  // ... full OM injection ...
}
```

Add an else-if for read-only:

```ts
if (config.observationalMemory) {
  // ... existing full OM injection (unchanged) ...
} else if (config.observationalMemoryReadOnly) {
  const omReadOnlyInitial =
    yield *
    Effect.tryPromise({
      try: async () => {
        const ro = config.observationalMemoryReadOnly!;
        const threadId = ro.scope === "resource" ? null : ro.sessionId;
        const record = await ro.storage.getObservationalMemory(threadId, ro.projectId);
        return buildObservationsBlock(record);
      },
      catch: () => undefined,
    });
  if (omReadOnlyInitial !== undefined) {
    currentContext = {
      ...currentContext,
      systemPrompt: `${currentContext.systemPrompt ?? ""}\n\n${omReadOnlyInitial}`,
    };
  }
}
```

Similarly, modify the turn-boundary injection (lines 408-432). Add after the existing `if (config.observationalMemory)` block:

```ts
        } else if (config.observationalMemoryReadOnly) {
          const omReadOnlyResult = yield* Effect.tryPromise({
            try: async () => {
              const ro = config.observationalMemoryReadOnly!;
              const threadId = ro.scope === "resource" ? null : ro.sessionId;
              const record = await ro.storage.getObservationalMemory(threadId, ro.projectId);
              return buildObservationsBlock(record);
            },
            catch: () => undefined,
          });
          if (omReadOnlyResult !== undefined) {
            currentContext = {
              ...currentContext,
              systemPrompt: `${currentContext.systemPrompt ?? ""}\n\n${omReadOnlyResult}`,
            };
          }
        }
```

Import `buildObservationsBlock` at the top of the file:

```ts
import { buildObservationsBlock } from "../memory/observational-memory/prompts.ts";
```

**Step 5: Run test to verify it passes**

Run: `vp run '@sakti-code/agent#test'`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/agent/src/core/agent-loop.ts packages/agent/src/core/__tests__/agent-loop-om-readonly.test.ts
git commit -m "feat(agent-loop): inject observations read-only when OM disabled but history exists"
```

---

### Task 9: Wire OM storage passthrough in `agent-run.ts` and server `runner.ts`

**Files:**

- Modify: `packages/agent/src/runner/agent-run.ts:39` (add `observationalMemoryReadOnly` to deps)
- Modify: `apps/server/src/agent/runner.ts:552-578` (pass read-only config when OM disabled)

**Step 1: Add read-only deps to `RunAgentDeps`**

In `packages/agent/src/runner/agent-run.ts`, add to the deps interface (near line 39):

```ts
  /** Read-only OM injection (when OM disabled but prior history exists). */
  readonly observationalMemoryReadOnly?: {
    readonly storage: ObservationalMemoryStorage;
    readonly sessionId: string;
    readonly projectId: string;
    readonly scope: "thread" | "resource";
  } | undefined;
```

Pass it through to the agent loop config inside the effect.

**Step 2: In server `runner.ts`, pass read-only config when OM is disabled**

In `apps/server/src/agent/runner.ts`, after the OM config resolution (line 552-578), add:

```ts
// ── Observational Memory: read-only fallback ──────────────────
// When OM is disabled, check for prior history. If it exists, inject
// observations read-only so the LLM retains accumulated memory without
// running new observe/reflect cycles.
let omReadOnly: ObservationalMemoryOptions["readonly"] | undefined;
if (!omConfig) {
  const omStorage = new SqliteObservationalMemoryStorage(ctx.db);
  const session2 = session; // capture for closure
  // Quick check: does history exist?
  // Use session.projectId and sessionId
  // (Don't await here — we'll let the agent loop handle null)
  omReadOnly = {
    storage: omStorage,
    sessionId,
    projectId: session.projectId,
    scope: "thread", // v1: always thread scope
  };
}
```

Then pass it to `runAgentRunEffect`:

```ts
yield *
  runAgentRunEffect({
    // ... existing deps ...
    ...(omOptions ? { observationalMemory: omOptions } : {}),
    ...(omReadOnly ? { observationalMemoryReadOnly: omReadOnly } : {}),
    // ...
  });
```

> **Design note:** We always pass `observationalMemoryReadOnly` when OM is disabled. The agent loop's `buildObservationsBlock(null)` returns `undefined` when no record exists, so the no-history case is a cheap no-op (one SQLite query that returns null).

**Step 3: Run tests**

Run: `vp run -r test`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/agent/src/runner/agent-run.ts apps/server/src/agent/runner.ts
git commit -m "feat(server): wire read-only OM injection when OM disabled but history exists"
```

---

## Phase 5: Widen Compaction Event Reason

### Task 10: Add `"manual"` to compaction event reason union

**Files:**

- Modify: `packages/agent/src/types.ts:294-306`

**Step 1: Write the failing test**

```ts
// packages/agent/src/__tests__/types-compaction-reason.test.ts
import { describe, it, expectTypeOf } from "vitest";

describe("compaction event reason union", () => {
  it("includes 'manual'", () => {
    const reason: "threshold" | "overflow" | "manual" = "manual";
    expectTypeOf(reason).toEqualTypeOf<"threshold" | "overflow" | "manual">();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/agent#test'`
Expected: FAIL — `"manual"` not in union

**Step 3: Widen the union**

In `packages/agent/src/types.ts:294-306`, change:

```ts
  | { type: "compaction_start"; reason: "threshold" | "overflow" }
  | {
      type: "compaction_end";
      reason: "threshold" | "overflow";
```

To:

```ts
  | { type: "compaction_start"; reason: "threshold" | "overflow" | "manual" }
  | {
      type: "compaction_end";
      reason: "threshold" | "overflow" | "manual";
```

**Step 4: Run test to verify it passes**

Run: `vp run '@sakti-code/agent#test'`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/types.ts
git commit -m "feat(agent): add 'manual' reason to compaction events for /compact command"
```

---

## Phase 6: `/compact` WS Command

### Task 11: Add `CommandMessage` type + TypeBox schema

**Files:**

- Modify: `apps/server/src/agent/ws-handler.ts:18-68` (WsIn union) and `131-167` (schema)

**Step 1: Write the failing test**

```ts
// apps/server/src/agent/__tests__/ws-handler-command.test.ts
import { describe, it, expect } from "vitest";
import { wsBodySchema } from "../ws-handler.ts";
import { Value } from "@sinclair/typebox/value";

describe("wsBodySchema command variant", () => {
  it("accepts a compact command", () => {
    const msg = { type: "command", sessionId: "s1", name: "compact" };
    expect(Value.Check(wsBodySchema, msg)).toBe(true);
  });

  it("accepts compact with customInstructions", () => {
    const msg = {
      type: "command",
      sessionId: "s1",
      name: "compact",
      customInstructions: "focus on API changes",
    };
    expect(Value.Check(wsBodySchema, msg)).toBe(true);
  });

  it("rejects command without sessionId", () => {
    const msg = { type: "command", name: "compact" };
    expect(Value.Check(wsBodySchema, msg)).toBe(false);
  });

  it("rejects command with unknown name", () => {
    const msg = { type: "command", sessionId: "s1", name: "fly" };
    expect(Value.Check(wsBodySchema, msg)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/server#test'`
Expected: FAIL

**Step 3: Add CommandMessage interface + schema**

In `apps/server/src/agent/ws-handler.ts`, add the interface (after `PermissionReplyMessage`, before the `WsIn` union):

```ts
export interface CommandMessage {
  /** Command name (currently only "compact"). */
  name: "compact";
  /** Optional custom instructions passed to compaction summarizer. */
  customInstructions?: string;
  sessionId: string;
  type: "command";
}
```

Add to `WsIn` union:

```ts
export type WsIn =
  | PromptMessage
  | AbortMessage
  | SteerMessage
  | FollowUpMessage
  | ReplayMessage
  | SwitchAgentMessage
  | PermissionReplyMessage
  | CommandMessage;
```

Add to `wsBodySchema` TypeBox union:

```ts
  Type.Object({
    type: Type.Literal("command"),
    sessionId: Type.String(),
    name: Type.Literal("compact"),
    customInstructions: Type.Optional(Type.String()),
  }),
```

**Step 4: Run test to verify it passes**

Run: `vp run '@sakti-code/server#test'`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/agent/ws-handler.ts apps/server/src/agent/__tests__/ws-handler-command.test.ts
git commit -m "feat(server): add CommandMessage WS type for /compact command"
```

---

### Task 12: Extract shared compaction helper

**Files:**

- Create: `apps/server/src/agent/commands/compact.ts`
- Modify: `apps/server/src/routes/sessions/compaction.ts` (use shared helper)

**Step 1: Write the failing test**

```ts
// apps/server/src/agent/commands/__tests__/compact.test.ts
import { describe, it, expect } from "vitest";
// Mock ctx, session, etc.

describe("runCompact", () => {
  it("returns skipped when nothing to compact", async () => {
    // Mock prepareCompaction to return { success: false }
    // Call runCompact
    // Expect { skipped: true }
  });

  it("returns summary on success", async () => {
    // Mock prepareCompaction + compact to succeed
    // Call runCompact
    // Expect { tokensBefore, summary, firstKeptEntryId }
  });

  it("throws on model resolution failure", async () => {
    // Mock resolveModel to throw
    // Call runCompact
    // Expect throw
  });
});
```

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/server#test'`
Expected: FAIL — `runCompact` does not exist

**Step 3: Implement the helper**

Create `apps/server/src/agent/commands/compact.ts`:

```ts
import {
  compact,
  DEFAULT_COMPACTION_SETTINGS,
  isFailure,
  PromiseSession,
  prepareCompaction,
} from "@sakti-code/agent";
import { Effect } from "effect";
import type { ServerContext } from "../../context.ts";
import { createSessionStorage } from "../../context.ts";
import { COMPACTION_PROMPTS } from "../config/index.ts";
import { resolveAuth, resolveModel } from "../model-resolver.ts";

export interface CompactResult {
  tokensBefore: number;
  summary: string;
  firstKeptEntryId: string;
}

export async function runCompact(
  ctx: ServerContext,
  sessionId: string,
  customInstructions?: string,
): Promise<CompactResult | { skipped: true } | { error: string }> {
  const session = ctx.repos.sessions.findById(sessionId);
  if (!session) {
    return { error: "Not found" };
  }

  let model: { model: typeof resolveModel extends () => infer R ? R : never };
  try {
    model = resolveModel(ctx, session) as any;
  } catch (e) {
    return { error: `Model resolution failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  const auth = resolveAuth(ctx, session);
  if (!auth) {
    return { error: `No API key for ${model.provider} — add one in Settings > Models` };
  }

  const storage = createSessionStorage(ctx, sessionId);
  const entries = await Effect.runPromise(storage.getEntries());
  const preparation = prepareCompaction(entries, DEFAULT_COMPACTION_SETTINGS);

  if (isFailure(preparation)) {
    return { error: preparation.failure.message };
  }
  if (!preparation.success) {
    return { skipped: true };
  }

  const result = await compact(preparation.success, auth.model, auth.apiKey, {
    prompts: COMPACTION_PROMPTS,
    ...(customInstructions !== undefined ? { customInstructions } : {}),
  });
  if (isFailure(result)) {
    return { error: result.failure.message };
  }

  const sessionInstance = new PromiseSession(storage);
  await sessionInstance.appendCompaction(
    result.success.summary,
    result.success.firstKeptEntryId,
    result.success.tokensBefore,
    result.success.details,
  );

  return {
    tokensBefore: result.success.tokensBefore,
    summary: result.success.summary,
    firstKeptEntryId: result.success.firstKeptEntryId,
  };
}
```

**Step 4: Refactor REST route to use the helper**

In `apps/server/src/routes/sessions/compaction.ts`, replace the inline logic with a call to `runCompact`:

```ts
import { runCompact } from "../../agent/commands/compact.ts";

export const compactionRoutes = new Hono()
  .basePath("/sessions")
  .post("/:id/compact", async (c): Promise<Response> => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const customInstructions = c.req.query("instructions") ?? undefined;

    const result = await runCompact(ctx, id, customInstructions);

    if ("error" in result) {
      return c.json({ error: result.error }, 500);
    }
    if ("skipped" in result) {
      return c.json({ tokensBefore: 0, tokensAfter: 0, skipped: true });
    }
    return c.json(result);
  });
```

**Step 5: Run tests**

Run: `vp run '@sakti-code/server#test'`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/server/src/agent/commands/compact.ts apps/server/src/agent/commands/__tests__/compact.test.ts apps/server/src/routes/sessions/compaction.ts
git commit -m "refactor(server): extract shared runCompact helper for REST + WS reuse"
```

---

### Task 13: Add command dispatch in `handleMessage`

**Files:**

- Modify: `apps/server/src/agent/ws-handler.ts:261-358` (handleMessage)

**Step 1: Write the failing test**

```ts
// apps/server/src/agent/__tests__/ws-handler-compact-dispatch.test.ts
import { describe, it, expect, vi } from "vitest";
import { handleMessage, type WsHandle } from "../ws-handler.ts";
// Mock ctx, storage, etc.

describe("handleMessage command dispatch", () => {
  it("blocks /compact when run is active", () => {
    // Mock isRunActive to return true
    // Send { type: "command", name: "compact", sessionId: "s1" }
    // Expect ws.send called with error frame "busy"
  });

  it("dispatches compact command (OM off path)", async () => {
    // Mock isRunActive false, OM disabled
    // Mock runCompact to return success
    // Expect ws.send called with compaction_start event (reason: "manual")
    // Expect ws.send called with compaction_end event
  });
});
```

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/server#test'`
Expected: FAIL

**Step 3: Add command branch to `handleMessage`**

In `apps/server/src/agent/ws-handler.ts`, add a new branch in `handleMessage` (after the `switchAgent` branch, before the prompt fall-through at line 339):

```ts
if (msg.type === "command") {
  if (msg.name === "compact") {
    handleCompactCommand(ctx, msg.sessionId, msg.customInstructions, ws).catch((err) => {
      log?.warn("compact command failed", { sessionId: msg.sessionId });
      sendError(ws, msg.sessionId, err instanceof Error ? err.message : String(err));
    });
    return;
  }
  sendError(ws, msg.sessionId, `Unknown command: ${msg.name}`);
  return;
}
```

Add the `handleCompactCommand` helper function (before `handleMessage` or in `commands/compact.ts`):

```ts
import { runCompact } from "./commands/compact.ts";
import { resolveOmConfig } from "./config/index.ts";
import { ObservationalMemoryEngine } from "@sakti-code/agent";
import { SqliteObservationalMemoryStorage } from "@sakti-code/db";

async function handleCompactCommand(
  ctx: ServerContext,
  sessionId: string,
  customInstructions: string | undefined,
  ws: WsHandle,
): Promise<void> {
  // Block if busy
  if (isRunActive(sessionId)) {
    sendError(ws, sessionId, busyMessage(sessionId));
    return;
  }

  const session = ctx.repos.sessions.findById(sessionId);
  if (!session) {
    sendError(ws, sessionId, "Session not found");
    return;
  }

  // Check OM enabled
  const omConfig = resolveOmConfig(ctx, {
    id: sessionId,
    kind: session.kind,
    projectId: session.projectId,
    profileId: session.profileId,
  });

  if (omConfig) {
    // OM path: force reflect
    const omStorage = new SqliteObservationalMemoryStorage(ctx.db);
    const storage = createSessionStorage(ctx, sessionId);
    const engine = new ObservationalMemoryEngine({
      deps: {
        ...omConfig,
        storage: omStorage,
        sessionId,
        projectId: session.projectId,
        sessionStorage: storage,
      },
      onOmEvent: (event) => {
        ws.send({ event, sessionId, type: "event" } satisfies EventFrame);
      },
    });

    const result = await engine.forceReflect();
    if (!result.reflected) {
      sendError(ws, sessionId, `Nothing to reflect: ${result.reason ?? "unknown"}`);
    }
    return;
  }

  // Non-OM path: regular compaction
  ws.send({
    event: { type: "compaction_start", reason: "manual" },
    sessionId,
    type: "event",
  } satisfies EventFrame);

  const result = await runCompact(ctx, sessionId, customInstructions);

  if ("error" in result) {
    ws.send({
      event: {
        type: "compaction_end",
        reason: "manual",
        aborted: false,
        willRetry: false,
        errorMessage: result.error,
      },
      sessionId,
      type: "event",
    } satisfies EventFrame);
    return;
  }

  ws.send({
    event: {
      type: "compaction_end",
      reason: "manual",
      result:
        "skipped" in result
          ? undefined
          : {
              summary: result.summary,
              firstKeptEntryId: result.firstKeptEntryId,
              tokensBefore: result.tokensBefore,
            },
      aborted: false,
      willRetry: false,
    },
    sessionId,
    type: "event",
  } satisfies EventFrame);
}
```

**Step 4: Run tests**

Run: `vp run '@sakti-code/server#test'`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/agent/ws-handler.ts apps/server/src/agent/__tests__/ws-handler-compact-dispatch.test.ts
git commit -m "feat(server): dispatch /compact command — compaction or force-reflect based on OM state"
```

---

## Phase 7: Client-Side Parsing

### Task 14: Parse `/compact` in client actions

**Files:**

- Modify: `apps/desktop/src/stores/server/actions.ts:156-176` (sendMessage action)
- Test: `apps/desktop/src/stores/server/__tests__/actions.test.ts`

**Step 1: Write the failing test**

```ts
// In actions.test.ts, add:
describe("sendMessage /compact parsing", () => {
  it("sends command message for /compact", () => {
    const { ws, actions } = setup();
    actions.sendMessage("s1", "/compact");
    expect(ws.send).toHaveBeenCalledWith({
      type: "command",
      sessionId: "s1",
      name: "compact",
    });
  });

  it("sends command with customInstructions for /compact with args", () => {
    const { ws, actions } = setup();
    actions.sendMessage("s1", "/compact focus on API layer");
    expect(ws.send).toHaveBeenCalledWith({
      type: "command",
      sessionId: "s1",
      name: "compact",
      customInstructions: "focus on API layer",
    });
  });

  it("does not add user message to chat for /compact", () => {
    const { actions, session } = setup();
    actions.sendMessage("s1", "/compact");
    // Verify no user message was added to the session
    expect(session.actions.addMessage).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/desktop#test'`
Expected: FAIL

**Step 3: Add /compact parsing to `sendMessage`**

In `apps/desktop/src/stores/server/actions.ts`, modify the `sendMessage` action (around line 156):

```ts
    sendMessage(sessionId, text) {
      // Parse /compact slash command
      if (text === "/compact" || text.startsWith("/compact ")) {
        const customInstructions = text.startsWith("/compact ")
          ? text.slice("/compact ".length).trim()
          : undefined;
        ws.send({
          type: "command",
          sessionId,
          name: "compact",
          ...(customInstructions !== undefined ? { customInstructions } : {}),
        });
        return;
      }

      // ... existing prompt-sending logic unchanged ...
```

**Step 4: Run test to verify it passes**

Run: `vp run '@sakti-code/desktop#test'`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/stores/server/actions.ts apps/desktop/src/stores/server/__tests__/actions.test.ts
git commit -m "feat(desktop): parse /compact slash command into structured WS command message"
```

---

## Final Verification

### Task 15: Full integration check

**Step 1: Run all checks**

```bash
vp check
vp run -r test
```

Expected: 0 errors, 0 warnings, all tests pass.

**Step 2: Manual smoke test** (if possible)

1. Start the app: `vp run desktop#dev`
2. Open a session with some history
3. Type `/compact` — verify compaction or reflection runs
4. Toggle OM in settings — verify observations persist/inject correctly

**Step 3: Commit any final fixes**

---

## Summary of Changes

| Area        | Change                                | Files                             |
| ----------- | ------------------------------------- | --------------------------------- |
| Schema      | Fix originType comment                | `schema.ts`                       |
| Schema      | Add `(sessionId, kind)` index         | `schema.ts` + migration           |
| OM Pruning  | `pruneHistory` on storage interface   | `observational-memory-storage.ts` |
| OM Pruning  | Implement in SQLite storage           | `observational-memory-store.ts`   |
| OM Pruning  | Call after reflection in engine       | `engine.ts`                       |
| Engine      | `forceReflect()` public method        | `engine.ts`                       |
| Seamless OM | `buildObservationsBlock` standalone   | `prompts.ts`                      |
| Seamless OM | Read-only injection in agent loop     | `agent-loop.ts`                   |
| Seamless OM | Wire passthrough in runner            | `agent-run.ts`, `runner.ts`       |
| Events      | Widen compaction reason to `"manual"` | `types.ts`                        |
| WS Command  | `CommandMessage` type + schema        | `ws-handler.ts`                   |
| WS Command  | Shared `runCompact` helper            | `commands/compact.ts`             |
| WS Command  | Dispatch in `handleMessage`           | `ws-handler.ts`                   |
| Client      | `/compact` parsing in actions         | `actions.ts`                      |
