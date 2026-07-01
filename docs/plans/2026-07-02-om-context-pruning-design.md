# OM Context Pruning — Design

**Date:** 2026-07-02
**Status:** Approved (Approach B1 + prune entry for persistence)
**Depends on:** OM WS/UI integration (shipped), detached buffering (shipped)

## Goal

Port Mastra's observed-message pruning to sakti. After observation, observed messages leave the LLM context — replaced by the compressed observation summary. This makes OM a viable replacement for compaction: the context stays bounded without summarizing raw messages.

## Architecture: Approach B — Prune at source + persist as session entry

### Core idea

When the OM engine observes messages, it appends an `ObservationPruneEntry` to the session tree. This entry carries the cumulative set of observed entry IDs. The context builder honors it — skipping observed messages when constructing `currentContext.messages`. This mirrors how `CompactionEntry` works today.

**Key difference from compaction:** Compaction uses a single boundary (`firstKeptEntryId` — everything before it is dropped). OM pruning uses a **set** of specific entry IDs — only observed messages are dropped, unobserved ones stay. The observation summary replaces them via the system prompt.

---

## 1. New Session Entry Type

### `ObservationPruneEntry`

**File:** `packages/agent/src/session/entries.ts`

```ts
export interface ObservationPruneEntry extends SessionTreeEntryBase {
  type: "observation_prune";
  /** Cumulative set of session entry IDs whose messages have been observed.
   * The context builder skips these — their content is available as
   * compressed observations in the system prompt. */
  observedEntryIds: string[];
  /** Link to the OM record for cross-referencing. */
  observationRecordId: string;
}
```

Add to the `SessionTreeEntry` union:

```ts
export type SessionTreeEntry =
  | MessageEntry
  | CompactionEntry
  | LabelEntry
  | LeafEntry
  | CustomEntry
  | CustomMessageEntry
  | ObservationPruneEntry; // ← new
```

**No DB migration needed.** The `session_entries` table stores entries as JSON in `content` with `kind` as a free-text column. A new `kind: "observation_prune"` is just a new string value. No schema change, no migration.

---

## 2. Builder Change — `buildSessionContextFromEntries`

**File:** `packages/agent/src/session/session.ts`

The builder finds the latest `observation_prune` entry in the path and filters its `observedEntryIds`:

```ts
export function buildSessionContextFromEntries(pathEntries: SessionTreeEntry[]): SessionContext {
  // ... existing metadata scan (thinkingLevel, model, tools, compaction) ...

  // Find the latest observation_prune entry (cumulative observed set)
  const omPrune =
    pathEntries.findLast?.((e) => e.type === "observation_prune") ??
    [...pathEntries].reverse().find((e) => e.type === "observation_prune");
  const observedEntryIds =
    omPrune?.type === "observation_prune" ? new Set(omPrune.observedEntryIds) : undefined;

  // ... existing compaction logic ...

  const appendMessage = (entry: SessionTreeEntry) => {
    if (
      entry.type !== "message" &&
      entry.type !== "custom_message" &&
      entry.type !== "branch_summary"
    )
      return;
    // OM pruning: skip observed messages
    if (observedEntryIds?.has(entry.id)) return;
    // ... existing append logic ...
  };

  // ... rest of builder unchanged ...
}
```

**The builder stays pure** — it reads only from its inputs (the path entries). No external state, no OM record access, no side effects.

**REST endpoint:** The UI message hydration path (`getBranch()` → extract `MessageEntry`s → `AgentMessage[]`) does NOT call `buildSessionContextFromEntries`. It reads raw entries directly. So the UI always sees the full transcript.

---

## 3. Cleanup Algorithm — Port of Mastra's `getObservedMessageIdsForCleanup`

**File:** `packages/agent/src/memory/observational-memory/cleanup.ts` (NEW)

### `resolveRetentionFloor`

Port of Mastra's `thresholds.ts:89-97`:

```ts
export function resolveRetentionFloor(
  bufferActivation: number,
  messageTokensThreshold: number,
): number {
  if (bufferActivation >= 1000) return bufferActivation; // absolute mode
  const ratio = Math.max(0, Math.min(1, bufferActivation));
  return messageTokensThreshold * (1 - ratio); // ratio mode
}
```

Default: `bufferActivation = 0.8`, `threshold = 30_000` → floor = `6_000` tokens.

### `getObservedEntryIdsForCleanup`

Port of Mastra's two-pass retention-aware algorithm (`observational-memory.ts:2240-2314`):

```ts
export function getObservedEntryIdsForCleanup(params: {
  entries: MessageEntry[]; // current path-to-root message entries
  observedEntryIds: string[]; // cumulative observed set from OM record
  retentionFloor: number; // min tokens that must remain
  tokenCounter: TokenCounter;
}): string[] {
  const { entries, observedEntryIds, retentionFloor, tokenCounter } = params;
  if (observedEntryIds.length === 0) return [];

  const observedSet = new Set(observedEntryIds);
  const idsToRemove = new Set<string>();
  const removalOrder: string[] = [];

  // Collect messages from entries for token counting
  const allMessages = entries.map((e) => e.message);
  const entryIdFor = (idx: number) => entries[idx]!.id;

  // Pass 1: queue observed entries for removal, per-message floor check
  for (let i = 0; i < entries.length; i++) {
    const entryId = entryIdFor(i);
    if (!observedSet.has(entryId)) continue;

    // Would removing this entry drop us below the floor?
    const remainingAfter = entries
      .filter((e, idx) => idx !== i && !idsToRemove.has(e.id))
      .map((e) => e.message);
    if (retentionFloor > 0 && tokenCounter.countMessages(remainingAfter) < retentionFloor) {
      break; // stop removing — floor would be violated
    }

    idsToRemove.add(entryId);
    removalOrder.push(entryId);
  }

  // Pass 2: LIFO restore if aggregate total is still below floor
  if (idsToRemove.size > 0 && retentionFloor > 0) {
    let remaining = entries.filter((e) => !idsToRemove.has(e.id)).map((e) => e.message);
    let remainingTokens = tokenCounter.countMessages(remaining);

    while (remainingTokens < retentionFloor && removalOrder.length > 0) {
      idsToRemove.delete(removalOrder.pop()!);
      remaining = entries.filter((e) => !idsToRemove.has(e.id)).map((e) => e.message);
      remainingTokens = tokenCounter.countMessages(remaining);
    }
  }

  return [...idsToRemove];
}
```

**Faithfulness notes:**

- Two-pass: per-message early break (pass 1) + aggregate LIFO restore (pass 2) — both required for correctness under edge cases.
- `removalOrder` preserves insertion order so the last-queued (newest) observed messages are restored first.
- When `retentionFloor = 0` (bufferActivation = 1.0, no async buffering), all observed messages are removed unconditionally.

---

## 4. Engine Integration

**File:** `packages/agent/src/memory/observational-memory/engine.ts`

### New method: `pruneObservedMessages`

Called after `maybeObserve` or `maybeActivateBufferedObservations` succeeds:

```ts
async pruneObservedMessages(record: ObservationalMemoryRecord): Promise<void> {
  const observedIds = record.observedMessageIds ?? [];
  if (observedIds.length === 0) return;

  // Load current session path for token counting
  const leafId = await Effect.runPromise(this.sessionStorage.getLeafId());
  const pathEntries = await Effect.runPromise(this.sessionStorage.getPathToRoot(leafId));
  const messageEntries = pathEntries.filter(
    (e): e is MessageEntry => e.type === "message",
  );

  // Calculate retention floor
  const bufferActivation = this.deps.buffering?.observationBufferActivation ?? 1;
  const threshold = this.deps.thresholds.observation;
  const floor = resolveRetentionFloor(bufferActivation, threshold);

  // Determine which IDs are safe to remove
  const toRemove = getObservedEntryIdsForCleanup({
    entries: messageEntries,
    observedEntryIds: observedIds,
    retentionFloor: floor,
    tokenCounter: this.tokenCounter,
  });

  if (toRemove.length === 0) return;

  // Append prune entry to the session tree (persists for future turns)
  const id = await Effect.runPromise(this.sessionStorage.createEntryId());
  const parentId = leafId;
  const pruneEntry: ObservationPruneEntry = {
    type: "observation_prune",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    observedEntryIds: toRemove,
    observationRecordId: record.id,
  };
  await Effect.runPromise(this.sessionStorage.appendEntry(pruneEntry));
}
```

### When it fires

In `maybeObserve`, after a successful sync observation or activation:

```ts
// After runSyncObserve or maybeActivateBufferedObservations returns:
await this.pruneObservedMessages(result);
```

**Does NOT fire after buffered observation** — buffered chunks are pre-computation, not yet activated. Pruning happens when buffered content moves to active (activation), replacing the raw messages.

---

## 5. Agent-Loop Integration

**File:** `packages/agent/src/core/agent-loop.ts` — §OM-2 block (turn boundary)

After `maybeObserve` → `maybeReflect` → `buildContextSystemMessage`, the context is rebuilt next turn via `buildContext()`. The `ObservationPruneEntry` in the tree causes the builder to automatically filter observed messages. No additional code needed in the loop.

However, for the **current turn** (immediate effect), the prune entry was just appended, so the next `buildContext()` call within the same run will see it. If the loop calls `buildContext()` at turn boundaries (it does via `prepareNextTurn`), the filter takes effect immediately.

---

## 6. Compaction Interaction

When OM pruning is active, compaction sees a smaller context (observed messages already filtered). This means:

- Compaction triggers less often (fewer tokens in context)
- If compaction does trigger, it summarizes only the unobserved recent messages
- Both filters compose cleanly: compaction entry + observation prune entry in the same path

**Toggle behavior:** If OM is disabled (no observation_prune entries in tree), the builder behaves exactly as today. Compaction remains the sole context management mechanism. No regression.

---

## 7. Data Flow Summary

```
Turn boundary:
  engine.maybeObserve(record)
    → observe LLM call
    → updateActiveObservations (observedMessageIds += new IDs)
    → engine.pruneObservedMessages(record)
      → getObservedEntryIdsForCleanup (retention-aware)
      → append ObservationPruneEntry to session tree
    → emit om_end event (WS → UI badge)

Next turn:
  buildContext()
    → getPathToRoot(leafId)
    → buildSessionContextFromEntries(pathEntries)
      → finds ObservationPruneEntry
      → skips observedEntryIds when building messages array
      → messages = [recent unobserved messages only]
    → system prompt includes <observations> summary
    → LLM sees: compressed observations + recent context

On reload (UI):
  REST GET /messages
    → session.getBranch()
    → extract all MessageEntry messages (NO filtering)
    → UI shows full transcript
```

---

## 8. Implementation Tasks

### Phase 1: Entry type + builder (agent package)

1. Add `ObservationPruneEntry` to `SessionTreeEntry` union
2. Add observation_prune handling to `buildSessionContextFromEntries`
3. Tests: builder correctly filters when prune entry present, passes through when absent

### Phase 2: Cleanup algorithm (agent package)

4. Create `cleanup.ts` with `resolveRetentionFloor` + `getObservedEntryIdsForCleanup`
5. Tests: two-pass retention logic, floor enforcement, LIFO restore, empty input

### Phase 3: Engine integration (agent package)

6. Add `pruneObservedMessages` method to engine
7. Wire into `maybeObserve` after sync observe / activation
8. Tests: prune entry appended with correct IDs, floor respected

### Phase 4: Verification

9. `vp check` 0/0/0
10. `vp run -r test` all green
11. Verify REST endpoint returns full history (unfiltered)

---

## Reference Files

- Mastra cleanup: `openspec/references/mastra/packages/memory/src/processors/observational-memory/observational-memory.ts:2240-2314`
- Mastra filterObserved: `openspec/references/mastra/packages/memory/src/processors/observational-memory/message-utils.ts:96-174`
- Mastra thresholds: `openspec/references/mastra/packages/memory/src/processors/observational-memory/thresholds.ts:89-97`
- Sakti builder: `packages/agent/src/session/session.ts:28-101`
- Sakti entries: `packages/agent/src/session/entries.ts`
- Sakti compaction entry: `packages/agent/src/session/entries.ts:35-42`
- Sakti engine: `packages/agent/src/memory/observational-memory/engine.ts`
- Sakti agent-loop §OM: `packages/agent/src/core/agent-loop.ts:405-432`
