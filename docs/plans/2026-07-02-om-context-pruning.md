# OM Context Pruning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port Mastra's observed-message pruning — after observation, observed messages leave the LLM context, replaced by compressed observations. Makes OM a viable compaction replacement.

**Architecture:** New `ObservationPruneEntry` in the session tree carries the cumulative observed entry IDs. The context builder honors it (skips observed messages), mirroring `CompactionEntry`. Two-pass retention-aware cleanup algorithm decides which IDs are safe to prune.

**Tech Stack:** TypeScript, Effect, node:sqlite, Vitest

**Design doc:** `docs/plans/2026-07-02-om-context-pruning-design.md`

---

### Task 1: Add `ObservationPruneEntry` + builder filter

**Files:**

- Modify: `packages/agent/src/session/entries.ts:82-93` (SessionTreeEntry union)
- Modify: `packages/agent/src/session/session.ts:28-101` (buildSessionContextFromEntries)
- Test: `packages/agent/src/session/__tests__/session.service.test.ts`

**Step 1: Write failing test**

```ts
it("buildSessionContextFromEntries filters observed messages when observation_prune entry exists", () => {
  const entries: SessionTreeEntry[] = [
    {
      type: "message",
      id: "m1",
      parentId: null,
      timestamp: "t1",
      message: { role: "user", content: "old observed", timestamp: 1 },
    },
    {
      type: "message",
      id: "m2",
      parentId: "m1",
      timestamp: "t2",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "observed" }],
        timestamp: 2,
        usage: mockUsage(),
      },
    },
    {
      type: "observation_prune",
      id: "prune1",
      parentId: "m2",
      timestamp: "t3",
      observedEntryIds: ["m1", "m2"],
      observationRecordId: "rec1",
    },
    {
      type: "message",
      id: "m3",
      parentId: "prune1",
      timestamp: "t4",
      message: { role: "user", content: "new unobserved", timestamp: 4 },
    },
  ];

  const ctx = buildSessionContextFromEntries(entries);
  expect(ctx.messages).toHaveLength(1);
  expect(ctx.messages[0]).toMatchObject({ role: "user", content: "new unobserved" });
});

it("buildSessionContextFromEntries passes through when no observation_prune entry", () => {
  // Existing behavior — all messages included
  const entries: SessionTreeEntry[] = [
    {
      type: "message",
      id: "m1",
      parentId: null,
      timestamp: "t1",
      message: { role: "user", content: "hello", timestamp: 1 },
    },
  ];
  const ctx = buildSessionContextFromEntries(entries);
  expect(ctx.messages).toHaveLength(1);
});
```

**Step 2: Add the entry type**

In `entries.ts`, add after `LeafEntry`:

```ts
export interface ObservationPruneEntry extends SessionTreeEntryBase {
  observedEntryIds: string[];
  observationRecordId: string;
  type: "observation_prune";
}
```

Add to `SessionTreeEntry` union:

```ts
export type SessionTreeEntry =
  | MessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | ActiveToolsChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomEntry
  | CustomMessageEntry
  | LabelEntry
  | SessionInfoEntry
  | LeafEntry
  | ObservationPruneEntry;
```

**Step 3: Add builder filter**

In `session.ts` `buildSessionContextFromEntries`, after the metadata scan loop, add:

```ts
// Find the latest observation_prune entry (cumulative observed set)
let observedEntryIds: Set<string> | undefined;
for (let i = pathEntries.length - 1; i >= 0; i--) {
  if (pathEntries[i]!.type === "observation_prune") {
    observedEntryIds = new Set((pathEntries[i] as ObservationPruneEntry).observedEntryIds);
    break;
  }
}
```

In `appendMessage`, add at the top:

```ts
const appendMessage = (entry: SessionTreeEntry) => {
  if (observedEntryIds?.has(entry.id)) return;
  // ... existing logic ...
};
```

**Step 4: Run tests, commit**

---

### Task 2: Cleanup algorithm — `resolveRetentionFloor` + `getObservedEntryIdsForCleanup`

**Files:**

- Create: `packages/agent/src/memory/observational-memory/cleanup.ts`
- Test: `packages/agent/src/memory/observational-memory/__tests__/cleanup.test.ts`

**Step 1: Write failing tests**

```ts
describe("resolveRetentionFloor", () => {
  it("ratio mode: threshold * (1 - ratio)", () => {
    expect(resolveRetentionFloor(0.8, 30_000)).toBe(6_000);
    expect(resolveRetentionFloor(0.5, 10_000)).toBe(5_000);
  });
  it("absolute mode when >= 1000", () => {
    expect(resolveRetentionFloor(5_000, 30_000)).toBe(5_000);
  });
  it("zero floor when ratio = 1.0", () => {
    expect(resolveRetentionFloor(1.0, 30_000)).toBe(0);
  });
});

describe("getObservedEntryIdsForCleanup", () => {
  it("returns all observed IDs when floor is 0", () => {
    const entries = makeMessageEntries(3); // m1, m2, m3
    const result = getObservedEntryIdsForCleanup({
      entries,
      observedEntryIds: ["m1", "m2"],
      retentionFloor: 0,
      tokenCounter,
    });
    expect(result).toEqual(expect.arrayContaining(["m1", "m2"]));
  });

  it("stops removing when floor would be violated", () => {
    // m1=500 tokens, m2=500 tokens, m3=500 tokens
    // observed: m1, m2. floor: 600 tokens.
    // Removing m1 (500) leaves m2+m3=1000 ≥ 600 ✓
    // Removing m1+m2 leaves m3=500 < 600 ✗ → restore m2
    const entries = makeMessageEntriesWithTokens(3, 500);
    const result = getObservedEntryIdsForCleanup({
      entries,
      observedEntryIds: ["m1", "m2"],
      retentionFloor: 600,
      tokenCounter,
    });
    expect(result).toEqual(["m1"]); // m2 restored by LIFO
  });

  it("returns empty for empty observed IDs", () => {
    expect(
      getObservedEntryIdsForCleanup({
        entries: [],
        observedEntryIds: [],
        retentionFloor: 1000,
        tokenCounter,
      }),
    ).toEqual([]);
  });
});
```

**Step 2: Implement `cleanup.ts`**

Port of Mastra's `thresholds.ts:89-97` and `observational-memory.ts:2240-2314`.

**Step 3: Run tests, commit**

---

### Task 3: Engine `pruneObservedMessages` + wire into `maybeObserve`

**Files:**

- Modify: `packages/agent/src/memory/observational-memory/engine.ts`
- Test: `packages/agent/src/memory/observational-memory/__tests__/buffering.test.ts`

**Step 1: Write failing test**

```ts
it("appends ObservationPruneEntry after sync observe", async () => {
  const deps = createDeps(storage, sessionStorage);
  const engine = new ObservationalMemoryEngine({ deps });
  // ... setup messages over threshold, mock LLM response ...
  await engine.maybeObserve(record);

  // Verify a prune entry was appended to the session tree
  const entries = await Effect.runPromise(sessionStorage.getPathToRoot(null));
  const pruneEntry = entries.find((e) => e.type === "observation_prune");
  expect(pruneEntry).toBeDefined();
  expect(pruneEntry.observedEntryIds).toContain(/* the observed entry IDs */);
});
```

**Step 2: Implement `pruneObservedMessages`**

```ts
async pruneObservedMessages(record: ObservationalMemoryRecord): Promise<void> {
  const observedIds = record.observedMessageIds ?? [];
  if (observedIds.length === 0) return;

  const leafId = await Effect.runPromise(this.sessionStorage.getLeafId());
  const pathEntries = await Effect.runPromise(this.sessionStorage.getPathToRoot(leafId));
  const messageEntries = pathEntries.filter((e): e is MessageEntry => e.type === "message");

  const floor = resolveRetentionFloor(
    this.deps.buffering?.observationBufferActivation ?? 1,
    this.deps.thresholds.observation,
  );

  const toRemove = getObservedEntryIdsForCleanup({
    entries: messageEntries, observedEntryIds: observedIds,
    retentionFloor: floor, tokenCounter: this.tokenCounter,
  });

  if (toRemove.length === 0) return;

  const id = await Effect.runPromise(this.sessionStorage.createEntryId());
  await Effect.runPromise(this.sessionStorage.appendEntry({
    type: "observation_prune", id, parentId: leafId,
    timestamp: new Date().toISOString(),
    observedEntryIds: toRemove, observationRecordId: record.id,
  }));
}
```

**Step 3: Wire into `maybeObserve`**

After `runSyncObserve` or `maybeActivateBufferedObservations` returns, call `await this.pruneObservedMessages(result)`.

**Step 4: Run tests, commit**

---

### Task 4: Verification

**Step 1:** `vp check --fix`
**Step 2:** `vp run -r test`
**Step 3:** Verify REST endpoint returns full history (unfiltered)
**Step 4:** Commit
