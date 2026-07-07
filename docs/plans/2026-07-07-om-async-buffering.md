# OM Async Buffering — Default ON + Thread-Scope Stream Entries

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable async buffering by default (matching Mastra), and fix the 4 buffering code paths so they work with thread-scope tree entries (ObservationEntry/ReflectionEntry) instead of assuming `activeObservations` is the source of truth. With this, the agent never pauses at observation/reflection thresholds — background-buffered chunks activate instantly as stream entries.

**Architecture:** Part A flips the default: `resolveOmConfig` always provides buffering defaults (0.2/0.8/0.5 matching Mastra's `OBSERVATIONAL_MEMORY_DEFAULTS`). Parts B–D add `if (this.deps.scope === "thread")` branches to the 4 buffering paths, following the exact pattern established in `runSyncObserve`/`runSyncReflect`: thread-scope turns staged chunks/reflections into tree entries + updates the prune set; resource-scope keeps the record-based `activeObservations` path unchanged. Part E adds a storage method to clear staged chunks after thread-scope activation (the existing `swapBufferedToActive` clears chunks but writes to `activeObservations` — wrong for thread-scope).

**Tech Stack:** TypeScript, Effect, vitest, node:sqlite, Drizzle ORM.

---

## Reference evidence

- **Mastra defaults ON**: `openspec/references/mastra/packages/memory/src/processors/observational-memory/constants.ts:20-39` — `bufferTokens: 0.2`, `bufferActivation: 0.8`, `reflection.bufferActivation: 0.5`.
- **Our port defaults OFF**: `resolve-observational-memory.ts:128` — `omSettings.buffering ? {...} : undefined`. `config.ts:29` — "Omit/zero => sync-only."
- **Established thread-scope pattern**: `runSyncObserve` (engine.ts:780-800) appends `ObservationEntry`; `runSyncReflect` (engine.ts:860-895) reads `loadActiveObservationEntries` + appends `ReflectionEntry` + `pruneObservationEntries`.
- **The "no pause" mechanism**: `maybeObserve` (engine.ts:174-185) — when `pendingTokens >= threshold`, activation runs first; if it drops `afterPending < threshold`, no sync observe → no pause. Activation must prune observed messages (via the skip set) for this to work.
- **Staged chunk shape**: `BufferedObservationChunk` (observational-memory-storage.ts:25-48) — has `observations` (text), `messageIds` (for pruning), `tokenCount`.
- **Buffering test fixture**: `buffering.test.ts` — `FakeObservationalMemoryStorage` + `FakeSessionStorage`, `createDeps` with `observationBufferTokens`.

---

## Part A: Default buffering ON

### Task A.1: `resolveOmConfig` always provides buffering defaults

**Files:**

- Modify: `apps/server/src/agent/config/resolve-observational-memory.ts:128-136`

**Step 1: Write the failing test**

Create `apps/server/src/agent/config/__tests__/resolve-om-buffering-default.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { parseOmSettings } from "../observational-memory-settings.ts";

describe("resolveOmConfig buffering default", () => {
  it("parseOmSettings returns empty when no settings (buffering resolved later)", () => {
    const parsed = parseOmSettings({});
    expect(parsed.buffering).toBeUndefined();
  });

  it("parseOmSettings passes through explicit buffering", () => {
    const parsed = parseOmSettings({
      observationalMemory: {
        buffering: { observationBufferTokens: 0.1 },
      },
    });
    expect(parsed.buffering?.observationBufferTokens).toBe(0.1);
  });
});
```

> **Note:** The decisive test is on `resolveOmConfig` itself — it must produce `buffering` even when `omSettings.buffering` is absent. Model on existing `resolve-observational-memory` tests if they exist; otherwise test the output shape of `resolveOmConfig` with a minimal ctx mock. If `resolveOmConfig` is hard to unit-test (needs full ctx), verify via the integration that the engine receives `deps.buffering !== undefined`.

**Step 2: Run test to verify the current behavior**

```bash
vp run '@sakti-code/server#test' -- resolve-om-buffering-default
```

**Step 3: Implement the default**

In `apps/server/src/agent/config/resolve-observational-memory.ts`, replace the buffering block (line ~128-136):

Old:

```ts
const buffering: ObservationalMemoryBuffering | undefined = omSettings.buffering
  ? {
      observationBufferTokens: omSettings.buffering.observationBufferTokens,
      observationBufferActivation:
        omSettings.buffering.observationBufferActivation ?? DEFAULT_OBSERVATION_BUFFER_ACTIVATION,
      reflectionBufferActivation:
        omSettings.buffering.reflectionBufferActivation ?? DEFAULT_REFLECTION_BUFFER_ACTIVATION,
    }
  : undefined;
```

New (always provide defaults, matching Mastra's `OBSERVATIONAL_MEMORY_DEFAULTS`):

```ts
// Buffering defaults ON (matching Mastra). Explicit settings override.
const buffering: ObservationalMemoryBuffering = {
  observationBufferTokens: omSettings.buffering?.observationBufferTokens ?? 0.2,
  observationBufferActivation:
    omSettings.buffering?.observationBufferActivation ?? DEFAULT_OBSERVATION_BUFFER_ACTIVATION,
  reflectionBufferActivation:
    omSettings.buffering?.reflectionBufferActivation ?? DEFAULT_REFLECTION_BUFFER_ACTIVATION,
};
```

Then the conditional spread at line ~154 becomes unconditional (buffering is always defined):

```ts
    buffering,
```

Also update the schema (`observational-memory-settings.ts`) so `observationBufferTokens` is optional (it now has a default):

```ts
const omBufferingSchema = Type.Object({
  observationBufferTokens: Type.Optional(Type.Number()),
  observationBufferActivation: Type.Optional(Type.Number()),
  reflectionBufferActivation: Type.Optional(Type.Number()),
});
```

And the `ParsedOmSettings.buffering` interface — make `observationBufferTokens` optional.

**Step 4: Run test + check**

```bash
vp run '@sakti-code/server#test' -- resolve-om-buffering-default
vp check --fix
```

Expected: PASS, 0 errors.

**Step 5: Commit**

```bash
git add apps/server/src/agent/config/resolve-observational-memory.ts apps/server/src/agent/config/observational-memory-settings.ts apps/server/src/agent/config/__tests__/resolve-om-buffering-default.test.ts
git commit -m "feat(server): default async buffering ON (matching Mastra)

Buffering defaults to 0.2/0.8/0.5 (Mastra's OBSERVATIONAL_MEMORY_DEFAULTS)
when not explicitly configured. The agent no longer pauses at observation/
reflection thresholds — background-buffered chunks activate instantly."
```

---

## Part B: Storage method to clear staged chunks

Thread-scope activation needs to clear `bufferedObservationChunks` after turning them into tree entries (the existing `swapBufferedToActive` clears chunks but writes to `activeObservations`).

### Task B.1: Add `clearBufferedObservations` to the storage interface + implementations

**Files:**

- Modify: `packages/agent/src/observational-memory-storage.ts` (interface)
- Modify: `packages/db/src/observational-memory-store.ts` (SqliteObservationalMemoryStorage)
- Modify: `packages/agent/src/observational-memory/__tests__/engine.test.ts` (SyncOmStorage fake)
- Modify: `packages/agent/src/observational-memory/__tests__/buffering.test.ts` (FakeObservationalMemoryStorage)

**Step 1: Add to the interface**

In `packages/agent/src/observational-memory-storage.ts`, add to `ObservationalMemoryStorage` (after `swapBufferedToActive`):

```ts
  /** Clear all buffered observation chunks for a record (after thread-scope
   * activation turned them into ObservationEntry tree entries). */
  clearBufferedObservations(id: string): Promise<void>;
```

**Step 2: Implement in the DB store**

In `packages/db/src/observational-memory-store.ts`, add the method to `SqliteObservationalMemoryStorage`:

```ts
  async clearBufferedObservations(id: string): Promise<void> {
    this.db.update(observationalMemory)
      .set({
        bufferedObservationChunks: null,
        updatedAt: Date.now(),
      })
      .where(eq(observationalMemory.id, id))
      .run();
  }
```

**Step 3: Add to the test fakes**

In `engine.test.ts` `SyncOmStorage` and `buffering.test.ts` `FakeObservationalMemoryStorage`:

```ts
  async clearBufferedObservations(id: string): Promise<void> {
    const r = this.records.get(id);
    if (r) r.bufferedObservationChunks = null;
  }
```

(Adjust to match each fake's internal record representation.)

**Step 4: Run check**

```bash
vp check --fix
```

Expected: 0 errors (all storage implementors now have the method).

**Step 5: Commit**

```bash
git add packages/agent/src/observational-memory-storage.ts packages/db/src/observational-memory-store.ts packages/agent/src/observational-memory/__tests__/engine.test.ts packages/agent/src/observational-memory/__tests__/buffering.test.ts
git commit -m "feat(db): add clearBufferedObservations storage method

Used by thread-scope buffered-observation activation to clear staged chunks
after turning them into ObservationEntry tree entries."
```

---

## Part C: Thread-scope `maybeActivateBufferedObservations`

### Task C.1: Turn staged chunks → ObservationEntry for thread-scope

**Files:**

- Modify: `packages/agent/src/observational-memory/engine.ts:450-488` (`maybeActivateBufferedObservations`)

**Step 1: Write the failing test**

Append to `packages/agent/src/observational-memory/__tests__/buffering.test.ts`:

```ts
it("thread scope: activation turns buffered chunks into ObservationEntry tree entries", async () => {
  // Set up: buffer an observation (stages a chunk), then activate.
  // Assert: ObservationEntry rows in the session tree; chunks cleared on the record.
  // Model on the existing "buffered observations" tests (line ~466) but use
  // thread scope (default) and assert on session.findEntries("observation").
  // ...
  const obsEntries = await Effect.runPromise(session.findEntries("observation"));
  expect(obsEntries.length).toBeGreaterThanOrEqual(1);
  expect(obsEntries[0]!.summary).toContain("obs");
  // Chunks cleared.
  const record = await engine.getOrCreateRecord();
  expect(record.bufferedObservationChunks ?? []).toHaveLength(0);
});
```

> **Note for implementer:** Model on the existing buffering tests. Seed messages, set observer completion, run `maybeObserve` to trigger buffering (below threshold + buffer interval), then run `maybeActivateBufferedObservations` (or `maybeObserve` again with pending >= threshold). Assert ObservationEntry rows in the tree + chunks cleared.

**Step 2: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- buffering.test
```

Expected: FAIL — activation currently writes to `activeObservations` (no tree entries).

**Step 3: Implement the thread-scope branch**

In `packages/agent/src/observational-memory/engine.ts`, in `maybeActivateBufferedObservations` (line ~450), after the early-return for no chunks, add a thread-scope branch BEFORE the `swapBufferedToActive` call:

```ts
  async maybeActivateBufferedObservations(
    record: ObservationalMemoryRecord,
  ): Promise<ObservationalMemoryRecord> {
    const chunks = record.bufferedObservationChunks;
    if (!chunks || chunks.length === 0) return record;

    if (this.deps.scope === "thread") {
      // Turn each staged chunk into a persisted ObservationEntry in the tree.
      const leafId = await Effect.runPromise(this.sessionStorage.getLeafId());
      let parent = leafId;
      const allMessageIds: string[] = [];
      let totalObsTokens = 0;
      for (const chunk of chunks) {
        const entryId = await Effect.runPromise(this.sessionStorage.createEntryId());
        const observationEntry: ObservationEntry = {
          id: entryId,
          parentId: parent,
          timestamp: new Date().toISOString(),
          type: "observation",
          summary: chunk.observations,
          observationRecordId: record.id,
        };
        await Effect.runPromise(this.sessionStorage.appendEntry(observationEntry));
        parent = entryId;
        allMessageIds.push(...chunk.messageIds);
        totalObsTokens += chunk.tokenCount;
      }
      // Clear staged chunks + update cursors/tokens on the record.
      await this.storage.clearBufferedObservations(record.id);
      await this.storage.updateActiveObservations({
        id: record.id,
        observations: record.activeObservations ?? "",
        lastObservedAt: chunks[chunks.length - 1]!.lastObservedAt,
        tokenCount: record.observationTokenCount + totalObsTokens,
        ...(allMessageIds.length > 0 ? { observedMessageIds: allMessageIds } : {}),
      });
      this.emitOmEvent({
        type: "om_activation",
        cycleId: `activation-obs-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        operationType: "observation",
        chunksActivated: chunks.length,
        tokensActivated: chunks.reduce((s, c) => s + (c.messageTokens ?? 0), 0),
        observationTokens: 0,
      });
      await this.storage.setBufferingObservationFlag(record.id, false).catch(() => {});
      return this.getOrCreateRecord();
    }

    // Resource scope: existing path (swapBufferedToActive → activeObservations).
    // ... (existing code unchanged) ...
  }
```

Import `ObservationEntry` (already imported from the earlier work).

**Step 4: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- buffering.test
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent/src/observational-memory/engine.ts packages/agent/src/observational-memory/__tests__/buffering.test.ts
git commit -m "feat(agent): thread-scope buffered-observation activation → ObservationEntry

Thread-scope activation turns staged chunks into ObservationEntry tree
entries + adds their messageIds to the prune set (so pending tokens drop
below threshold → no sync observe → no pause). Resource scope unchanged."
```

---

## Part D: Thread-scope reflection buffering

### Task D.1: `maybeBufferReflection` reads from the tree (thread-scope)

**Files:**

- Modify: `packages/agent/src/observational-memory/engine.ts:494-585` (`maybeBufferReflection`)

**Step 1: Write the failing test**

Append to `buffering.test.ts`:

```ts
it("thread scope: buffer reflection reads ObservationEntry rows from the tree", async () => {
  // Seed: observe (creates ObservationEntry), then trigger buffer reflection.
  // Assert: the reflector received the observation content (from the tree, not
  // activeObservations which is empty for thread scope).
  // ...
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — reflector reads `record.activeObservations` (empty for thread-scope).

**Step 3: Implement**

In `maybeBufferReflection` (line ~528), replace:

```ts
const fullObservations = record.activeObservations ?? "";
```

with a scope-aware read:

```ts
const fullObservations =
  this.deps.scope === "thread"
    ? (await this.loadActiveObservationEntries()).map((e) => e.summary).join("\n")
    : (record.activeObservations ?? "");
```

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent/src/observational-memory/engine.ts packages/agent/src/observational-memory/__tests__/buffering.test.ts
git commit -m "fix(agent): thread-scope buffer reflection reads ObservationEntry rows"
```

---

### Task D.2: `maybeActivateBufferedReflection` appends ReflectionEntry (thread-scope)

**Files:**

- Modify: `packages/agent/src/observational-memory/engine.ts:591-626` (`maybeActivateBufferedReflection`)

**Step 1: Write the failing test**

Append to `buffering.test.ts`:

```ts
it("thread scope: activate buffered reflection → ReflectionEntry in tree + observations pruned", async () => {
  // Seed: observe (ObservationEntry), buffer reflection, activate.
  // Assert: ReflectionEntry in the tree; observation entries in the prune set.
  // ...
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — activation writes to `activeObservations` (no ReflectionEntry).

**Step 3: Implement**

In `maybeActivateBufferedReflection` (line ~591), add a thread-scope branch BEFORE `swapBufferedReflectionToActive`:

```ts
if (this.deps.scope === "thread") {
  // Append the buffered reflection as a ReflectionEntry; prune observation entries.
  const observationEntries = await this.loadActiveObservationEntries();
  const leafId = await Effect.runPromise(this.sessionStorage.getLeafId());
  const refEntryId = await Effect.runPromise(this.sessionStorage.createEntryId());
  const reflectionEntry: ReflectionEntry = {
    id: refEntryId,
    parentId: leafId,
    timestamp: new Date().toISOString(),
    type: "reflection",
    summary: record.bufferedReflection,
    observationRecordId: record.id,
  };
  await Effect.runPromise(this.sessionStorage.appendEntry(reflectionEntry));
  await this.pruneObservationEntries(
    observationEntries.map((e) => e.id),
    record.id,
  );
  // Clear the staged reflection + reset token count.
  const newRecord = await this.storage.createReflectionGeneration({
    currentRecord: record,
    reflection: record.bufferedReflection,
    tokenCount: this.tokenCounter.countObservations(record.bufferedReflection),
  });
  const ids = this.getStorageIds();
  await this.storage.pruneHistory(ids.threadId, ids.resourceId, newRecord.id);
  this.bufferingCoordinator.clearBoundary("reflection");
  return newRecord;
}
```

**Step 4: Run test to verify it passes**

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent/src/observational-memory/engine.ts packages/agent/src/observational-memory/__tests__/buffering.test.ts
git commit -m "feat(agent): thread-scope activate buffered reflection → ReflectionEntry"
```

---

## Part E: `maybeBufferObservation` dedup context (minor)

### Task E.1: Pass tree-derived observations as observer context (thread-scope)

**Files:**

- Modify: `packages/agent/src/observational-memory/engine.ts:386`

**Step 1:** In `maybeBufferObservation`, the observer call passes `existingObservations: record.activeObservations` (line 386). For thread-scope, this is empty. Optionally pass tree-derived observations for dedup:

```ts
        existingObservations: this.deps.scope === "thread"
          ? (await this.loadActiveObservationEntries()).map((e) => e.summary).join("\n\n")
          : record.activeObservations,
```

> **Note:** This is a minor enhancement (the observer loses dedup context without it, but still functions). If `loadActiveObservationEntries` is async and the call site can't await easily, defer this task — it's non-blocking.

**Step 2: Run full buffering suite**

```bash
vp run '@sakti-code/agent#test' -- buffering.test
```

Expected: PASS.

**Step 3: Commit** (if changed)

```bash
git add packages/agent/src/observational-memory/engine.ts
git commit -m "feat(agent): thread-scope buffer observation uses tree observations as dedup context"
```

---

## Part F: Full verification

### Task F.1: Full suite + check

**Step 1: Run all tests**

```bash
vp run -r test
```

Expected: ALL PASS (excluding pre-existing `packages/sakti` CLI failures).

**Step 2: Run full check**

```bash
vp check --fix
```

Expected: 0 warnings, 0 errors.

**Step 3: Verify buffering is active**

Check the engine log output includes `obsAsyncEnabled=true` (or verify via a test that `deps.buffering` is defined when no explicit settings are provided):

```bash
grep -rn "buffering" apps/server/src/agent/config/resolve-observational-memory.ts | grep -v "//"
```

Expected: `buffering` is always defined (no longer conditional on `omSettings.buffering`).

---

## Verification Checklist

- [ ] Buffering defaults ON (0.2/0.8/0.5) even when settings.json has no `observationalMemory.buffering`
- [ ] `observationBufferTokens` is optional in the schema (has a default)
- [ ] `clearBufferedObservations` storage method exists + implemented in DB + fakes
- [ ] Thread-scope `maybeActivateBufferedObservations`: chunks → ObservationEntry + prune + clear
- [ ] Thread-scope `maybeBufferReflection`: reads ObservationEntry rows from tree
- [ ] Thread-scope `maybeActivateBufferedReflection`: ReflectionEntry + prune observations
- [ ] Resource-scope buffering paths unchanged
- [ ] `vp run -r test` passes
- [ ] `vp check` clean

---

## Notes for the Implementer

- **TDD is mandatory.** Every task follows RED → GREEN → COMMIT.
- **The thread-scope branch pattern** is established: `if (this.deps.scope === "thread") { /* tree */ } else { /* activeObservations */ }`. Follow it exactly.
- **`clearBufferedObservations`** is needed because `swapBufferedToActive` (the resource-scope method) both moves chunks to `activeObservations` AND clears them. Thread-scope needs to clear without the move.
- **The "no pause" benefit** only materializes if activation prunes the observed messages (adds their IDs to the skip set) so `afterPending < threshold`. The thread-scope activation must call `updateActiveObservations` with the chunk `messageIds` (so `pruneObservedMessages` includes them in the prune entry).
- **Buffering test fixtures** (`buffering.test.ts`) use `FakeObservationalMemoryStorage` + `FakeSessionStorage` with `observationBufferTokens`. The `FakeSessionStorage` needs `findEntries` (already exists in the engine test's `TreeSessionStorage` — copy it if the buffering fake doesn't have it).
- **`maybeBufferReflection` is async (detached)** — the `loadActiveObservationEntries` call inside it must be awaited. The method is already async, so this is fine.
