# OM Stream Entries — Observations as Persisted Message-Stream Entries

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move observational-memory observations out of the system prompt and into the message stream as persisted `ObservationEntry`/`ReflectionEntry` session-tree entries, positioned after the skill-pair. This keeps the base system prompt immutable AND caches the skill (observations come after it in the cache prefix). Observations accumulate discretely (obs1, obs2, …) and reflection replaces them with one reflection entry.

**Architecture:** New session-entry types (`ObservationEntry`, `ReflectionEntry`) are appended at the leaf at observe/reflect time. The context builder renders them as `user`-role XML-wrapped messages (following the `BranchSummaryEntry` pattern). Pruning uses the existing cumulative `observation_prune` skip-set — the batch messages before an observation are skipped, so the observation entry naturally appears at the batch's position. No tree reparenting (append-only + skip-set gives correct ordering). Thread-scope observations become tree entries; resource-scope (read-only, cross-session) observations stay in the OM record, rendered as a single stream message after the skill-pair. The `systemMessages`/system-block injection built previously is reverted — observations now live in `messages`, not `system`.

**Tech Stack:** TypeScript, Effect, vitest, node:sqlite, Drizzle ORM.

**Supersedes:** `docs/plans/2026-07-07-om-system-prompt-injection-fix.md` (which put observations in `system`). The chunked formatter, skill filter, plural engine method, and immutable base prompt carry over; the system-injection parts are reverted.

---

## Reference evidence

- **BranchSummaryEntry pattern** (follow for new entries): `packages/agent/src/session/entries.ts:35-41`, rendered by `buildSessionContextFromEntries` (session.ts:67-69) via `createBranchSummaryMessage` (messages.ts:36-47).
- **Prune mechanism**: `ObservationPruneEntry` (entries.ts:73-81); context builder finds the LATEST prune entry and skips its cumulative `observedEntryIds` (session.ts:47-54).
- **DB is type-agnostic**: `parseEntry` = `JSON.parse(content)` (session-entry-store.ts:353); `appendEntry` stores `kind: entry.type`. New kinds need NO migration.
- **UI reads all entries**: chat route (`apps/server/src/routes/sessions/chat.ts:21`) calls `getEntriesWithMeta()` — does NOT apply the prune filter. Pruned messages stay visible. Currently filters to `type === "message"` (line 33) — new types need surfacing.
- **Engine scoping**: `getStorageIds` (engine.ts:85-88) — `resource` scope uses `threadId=null`; `thread` scope uses `threadId=sessionId`.
- **Skill filter (unchanged)**: `filterSkillContentEntries` (engine.ts:149) drops the skill pair before the observer sees it. `observedMessageIds` excludes the skill (engine.ts:872) → skill never pruned.

---

## Part 1: Foundation — new entry types + AgentMessage roles

### Task 1.1: `ObservationEntry` + `ReflectionEntry` types

**Files:**

- Modify: `packages/agent/src/session/entries.ts` (add to the union, after `ObservationPruneEntry` line 81)

**Step 1: Write the failing test**

Create `packages/agent/src/session/__tests__/entries.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import type { ObservationEntry, ReflectionEntry, SessionTreeEntry } from "../entries";

describe("ObservationEntry / ReflectionEntry", () => {
  it("ObservationEntry has type 'observation' with summary content", () => {
    const e: ObservationEntry = {
      id: "e1",
      parentId: null,
      timestamp: new Date().toISOString(),
      type: "observation",
      summary: "* User prefers TypeScript",
      observationRecordId: "om-1",
    };
    expect(e.type).toBe("observation");
    expect(e.summary).toContain("TypeScript");
  });

  it("ReflectionEntry has type 'reflection' with summary content", () => {
    const e: ReflectionEntry = {
      id: "e2",
      parentId: "e1",
      timestamp: new Date().toISOString(),
      type: "reflection",
      summary: "User is building a SolidJS port of fumadocs.",
      observationRecordId: "om-1",
    };
    expect(e.type).toBe("reflection");
  });

  it("both are members of the SessionTreeEntry union", () => {
    const obs: SessionTreeEntry = {
      id: "e1",
      parentId: null,
      timestamp: new Date().toISOString(),
      type: "observation",
      summary: "x",
      observationRecordId: "om-1",
    };
    const ref: SessionTreeEntry = {
      id: "e2",
      parentId: "e1",
      timestamp: new Date().toISOString(),
      type: "reflection",
      summary: "y",
      observationRecordId: "om-1",
    };
    expect(obs.type).toBe("observation");
    expect(ref.type).toBe("reflection");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- entries.test
```

Expected: FAIL — `Module '"../entries"' has no exported member 'ObservationEntry'`.

**Step 3: Add the types**

In `packages/agent/src/session/entries.ts`, after `ObservationPruneEntry` (line 81), add:

```ts
export interface ObservationEntry extends SessionTreeEntryBase {
  /** The observation text produced by the Observer LLM for this batch. */
  summary: string;
  /** Link to the OM record this observation belongs to. */
  observationRecordId: string;
  type: "observation";
}

export interface ReflectionEntry extends SessionTreeEntryBase {
  /** The reflection text produced by the Reflector (condensed observations). */
  summary: string;
  /** Link to the OM record this reflection belongs to. */
  observationRecordId: string;
  type: "reflection";
}
```

And add them to the `SessionTreeEntry` union (line 83-94):

```ts
export type SessionTreeEntry =
  | MessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | ActiveToolsChangeEntry
  | BranchSummaryEntry
  | CustomEntry
  | CustomMessageEntry
  | LabelEntry
  | SessionInfoEntry
  | LeafEntry
  | ObservationPruneEntry
  | ObservationEntry
  | ReflectionEntry;
```

**Step 4: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- entries.test
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent/src/session/entries.ts packages/agent/src/session/__tests__/entries.test.ts
git commit -m "feat(agent): add ObservationEntry + ReflectionEntry session-tree types"
```

---

### Task 1.2: `ObservationMessage` + `ReflectionMessage` AgentMessage roles + helpers

Follow the `BranchSummaryMessage` pattern: a distinct `role` that `convertToLlm` renders as a `user`-role XML-wrapped message.

**Files:**

- Modify: `packages/agent/src/types.ts` (the `AgentMessage` union)
- Modify: `packages/agent/src/session/messages.ts` (create helpers, after `createBranchSummaryMessage` line 47)

**Step 1: Read the current AgentMessage union**

```
packages/agent/src/types.ts — AgentMessage union (find BranchSummaryMessage)
```

**Step 2: Write the failing test**

Create `packages/agent/src/session/__tests__/messages-om.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { createObservationMessage, createReflectionMessage } from "../messages";

describe("createObservationMessage / createReflectionMessage", () => {
  it("createObservationMessage returns role 'observation' with summary + timestamp", () => {
    const msg = createObservationMessage(
      "* User likes TS",
      new Date("2026-07-07T00:00:00Z").toISOString(),
    );
    expect(msg.role).toBe("observation");
    expect(msg.summary).toBe("* User likes TS");
    expect(msg.timestamp).toBe(Date.parse("2026-07-07T00:00:00Z"));
  });

  it("createReflectionMessage returns role 'reflection' with summary + timestamp", () => {
    const msg = createReflectionMessage(
      "condensed memory",
      new Date("2026-07-07T00:00:00Z").toISOString(),
    );
    expect(msg.role).toBe("reflection");
    expect(msg.summary).toBe("condensed memory");
  });
});
```

**Step 3: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- messages-om.test
```

Expected: FAIL — `createObservationMessage is not exported`.

**Step 4: Add the AgentMessage roles**

In `packages/agent/src/types.ts`, find the `BranchSummaryMessage` interface and add siblings:

```ts
export interface ObservationMessage {
  role: "observation";
  summary: string;
  timestamp: number;
}

export interface ReflectionMessage {
  role: "reflection";
  summary: string;
  timestamp: number;
}
```

Add `ObservationMessage` and `ReflectionMessage` to the `AgentMessage` union (wherever `BranchSummaryMessage` is listed).

**Step 5: Add the create helpers**

In `packages/agent/src/session/messages.ts`, after `createBranchSummaryMessage` (line 47), add:

```ts
export function createObservationMessage(summary: string, timestamp: string): ObservationMessage {
  return {
    role: "observation",
    summary,
    timestamp: new Date(timestamp).getTime(),
  };
}

export function createReflectionMessage(summary: string, timestamp: string): ReflectionMessage {
  return {
    role: "reflection",
    summary,
    timestamp: new Date(timestamp).getTime(),
  };
}
```

Update the imports in messages.ts to include `ObservationMessage` and `ReflectionMessage` from `../types`.

**Step 6: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- messages-om.test
```

Expected: PASS.

**Step 7: Commit**

```bash
git add packages/agent/src/types.ts packages/agent/src/session/messages.ts packages/agent/src/session/__tests__/messages-om.test.ts
git commit -m "feat(agent): add ObservationMessage + ReflectionMessage roles + helpers"
```

---

### Task 1.3: `convertToLlm` renders observation/reflection as user-role XML

Follow the `branchSummary` case (messages.ts:90-100): render as `{ role: "user", content: [{type:"text", text: ...}] }`.

**Files:**

- Modify: `packages/agent/src/session/messages.ts` (`convertToLlm` switch, after the `branchSummary` case ~line 100)

**Step 1: Write the failing test**

Append to `packages/agent/src/session/__tests__/messages-om.test.ts`:

```ts
import { convertToLlm } from "../messages";
import type { AgentMessage } from "../../types";

describe("convertToLlm for observation/reflection", () => {
  it("renders observation as user-role with <observation> XML wrapping", () => {
    const msgs: AgentMessage[] = [
      { role: "observation", summary: "* User likes TS", timestamp: 1 },
    ];
    const out = convertToLlm(msgs);
    expect(out[0]!.role).toBe("user");
    const text = (out[0]!.content[0] as { text: string }).text;
    expect(text).toContain("<observation>");
    expect(text).toContain("User likes TS");
    expect(text).toContain("</observation>");
  });

  it("renders reflection as user-role with <reflection> XML wrapping", () => {
    const msgs: AgentMessage[] = [{ role: "reflection", summary: "condensed", timestamp: 1 }];
    const out = convertToLlm(msgs);
    expect(out[0]!.role).toBe("user");
    const text = (out[0]!.content[0] as { text: string }).text;
    expect(text).toContain("<reflection>");
    expect(text).toContain("condensed");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- messages-om.test
```

Expected: FAIL — `observation`/`reflection` roles fall through the switch (no case) → undefined → filtered out.

**Step 3: Add the cases**

In `packages/agent/src/session/messages.ts`, in the `convertToLlm` switch (after the `branchSummary` case ~line 100), add:

```ts
        case "observation":
          return {
            role: "user",
            content: [
              {
                type: "text" as const,
                text: `<observation>\n${m.summary}\n</observation>`,
              },
            ],
            timestamp: m.timestamp,
          };
        case "reflection":
          return {
            role: "user",
            content: [
              {
                type: "text" as const,
                text: `<reflection>\n${m.summary}\n</reflection>`,
              },
            ],
            timestamp: m.timestamp,
          };
```

**Step 4: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- messages-om.test
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent/src/session/messages.ts packages/agent/src/session/__tests__/messages-om.test.ts
git commit -m "feat(agent): convertToLlm renders observation/reflection as user-role XML"
```

---

## Part 2: Context builder renders new entries

### Task 2.1: `buildSessionContextFromEntries` renders `ObservationEntry`/`ReflectionEntry`

**Files:**

- Modify: `packages/agent/src/session/session.ts` (the `appendMessage` function inside `buildSessionContextFromEntries`, ~line 60-69)

**Step 1: Write the failing test**

Create `packages/agent/src/session/__tests__/build-context-om-entries.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { buildSessionContextFromEntries } from "../session";
import type { SessionTreeEntry } from "../entries";

describe("buildSessionContextFromEntries — observation/reflection entries", () => {
  it("renders ObservationEntry as an observation message in the stream", () => {
    const entries: SessionTreeEntry[] = [
      {
        id: "u1",
        parentId: null,
        timestamp: "2026-07-07T00:00:00Z",
        type: "message",
        message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
      },
      {
        id: "o1",
        parentId: "u1",
        timestamp: "2026-07-07T00:00:01Z",
        type: "observation",
        summary: "* User likes TS",
        observationRecordId: "om-1",
      },
    ];
    const ctx = buildSessionContextFromEntries(entries);
    expect(ctx.messages).toHaveLength(2);
    expect(ctx.messages[1]!.role).toBe("observation");
    expect((ctx.messages[1] as { summary: string }).summary).toContain("User likes TS");
  });

  it("renders ReflectionEntry as a reflection message", () => {
    const entries: SessionTreeEntry[] = [
      {
        id: "u1",
        parentId: null,
        timestamp: "2026-07-07T00:00:00Z",
        type: "message",
        message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
      },
      {
        id: "r1",
        parentId: "u1",
        timestamp: "2026-07-07T00:00:02Z",
        type: "reflection",
        summary: "condensed",
        observationRecordId: "om-1",
      },
    ];
    const ctx = buildSessionContextFromEntries(entries);
    expect(ctx.messages[1]!.role).toBe("reflection");
  });

  it("observation_prune still skips observed message entries", () => {
    const entries: SessionTreeEntry[] = [
      {
        id: "u1",
        parentId: null,
        timestamp: "2026-07-07T00:00:00Z",
        type: "message",
        message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
      },
      {
        id: "m1",
        parentId: "u1",
        timestamp: "2026-07-07T00:00:01Z",
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "resp" }], timestamp: 2 },
      },
      {
        id: "o1",
        parentId: "m1",
        timestamp: "2026-07-07T00:00:02Z",
        type: "observation",
        summary: "obs",
        observationRecordId: "om-1",
      },
      {
        id: "p1",
        parentId: "o1",
        timestamp: "2026-07-07T00:00:03Z",
        type: "observation_prune",
        observedEntryIds: ["m1"],
        observationRecordId: "om-1",
      },
    ];
    const ctx = buildSessionContextFromEntries(entries);
    // u1 kept, m1 skipped (pruned), o1 rendered, p1 not rendered (not a message type).
    expect(ctx.messages).toHaveLength(2);
    expect(ctx.messages[0]!.role).toBe("user");
    expect(ctx.messages[1]!.role).toBe("observation");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- build-context-om-entries
```

Expected: FAIL — `appendMessage` has no case for `observation`/`reflection` → entries not rendered.

**Step 3: Implement**

In `packages/agent/src/session/session.ts`, in the `appendMessage` function inside `buildSessionContextFromEntries` (~line 60-69), add cases. The current `appendMessage`:

```ts
  const appendMessage = (entry: SessionTreeEntry) => {
    if (observedEntryIds?.has(entry.id)) return;
    if (entry.type === "message") {
      messages.push(entry.message as AgentMessage);
    } else if (entry.type === "custom_message") {
      messages.push(createCustomMessage(...));
    } else if (entry.type === "branch_summary" && entry.summary) {
      messages.push(createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp));
    }
  };
```

Add observation/reflection cases:

```ts
    } else if (entry.type === "observation") {
      messages.push(createObservationMessage(entry.summary, entry.timestamp));
    } else if (entry.type === "reflection") {
      messages.push(createReflectionMessage(entry.summary, entry.timestamp));
    }
```

Import `createObservationMessage` and `createReflectionMessage` from `./messages.ts`.

**Step 4: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- build-context-om-entries
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent/src/session/session.ts packages/agent/src/session/__tests__/build-context-om-entries.test.ts
git commit -m "feat(agent): context builder renders ObservationEntry/ReflectionEntry"
```

---

## Part 3: Observer appends `ObservationEntry` (instead of `activeObservations`)

### Task 3.1: `loadUnobservedMessageEntries` excludes observation/reflection/prune entries

The observer must only see real conversation messages — not prior observations, reflections, or prune markers.

**Files:**

- Modify: `packages/agent/src/observational-memory/engine.ts:136-138` (the `messageEntries` filter)

**Step 1: Write the failing test**

Append to `packages/agent/src/observational-memory/__tests__/engine.test.ts`:

```ts
it("loadUnobservedMessageEntries excludes observation/reflection/prune entries", async () => {
  // Seed a session with a message, an observation entry, a reflection entry, a prune entry, and another message.
  // Verify the observer only sees the two real messages.
  // (Use the existing SyncOmStorage / TreeSessionStorage test fixtures.)
});
```

> **Note for implementer:** Model this on the existing `buildContextSystemMessage` test (engine.test.ts:448-460) which uses `session.appendChild`. Append a message, then manually append `ObservationEntry`/`ReflectionEntry`/`ObservationPruneEntry` via `sessionStorage.appendEntry`, then call `engine.loadUnobservedMessageEntries(record)` (expose it or test via `maybeObserve`'s observer input). Assert the observer LLM receives only the real messages. If `loadUnobservedMessageEntries` is private, test indirectly via a fake observer that captures `messagesToObserve`.

**Step 2: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- engine.test
```

Expected: FAIL — observation/reflection entries are type `"observation"`/`"reflection"`, not `"message"`, so the current filter `entry.type === "message"` already excludes them. **Verify the test actually passes** — if it passes, the filter is already correct (since only `type === "message"` passes). If so, this task is a no-op confirmation; mark it done and move on. The key risk is if observation entries were ever typed as `"message"` — they are not.

**Step 3: Confirm/adjust the filter**

The current filter (engine.ts:136-138):

```ts
const messageEntries = pathEntries.filter(
  (entry): entry is MessageEntry => entry.type === "message",
);
```

This already excludes `observation`/`reflection`/`observation_prune` (they're different types). **No change needed** — confirm via the test, then commit the test as documentation.

**Step 4: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- engine.test
```

Expected: PASS (the filter already excludes non-message types).

**Step 5: Commit**

```bash
git add packages/agent/src/observational-memory/__tests__/engine.test.ts
git commit -m "test(agent): document that observer excludes observation/reflection/prune entries"
```

---

### Task 3.2: `runSyncObserve` appends `ObservationEntry` at the leaf

After the observer LLM produces observations, append an `ObservationEntry` to the session tree (at the leaf) carrying the observation text. The `activeObservations` field is no longer updated for thread-scope (observations live in the tree).

**Files:**

- Modify: `packages/agent/src/observational-memory/engine.ts` (`runSyncObserve`, ~line 730-770)

**Step 1: Read the current `runSyncObserve`**

```
packages/agent/src/observational-memory/engine.ts:730-770 — runSyncObserve(record, entries)
```

Currently: calls `runObserver`, updates `record.activeObservations` (merged), sets `observedMessageIds`, emits events, persists the record.

**Step 2: Write the failing test**

Append to `packages/agent/src/observational-memory/__tests__/engine.test.ts`:

```ts
it("runSyncObserve appends an ObservationEntry to the session tree", async () => {
  const engine = new ObservationalMemoryEngine({ deps: createDeps(storage, session) });
  session.appendChild({ role: "user", content: "x".repeat(800), timestamp: 1 }, 1);
  setComplete("<observations>\n* 🔴 obs\n</observations>");
  let record = await engine.getOrCreateRecord();
  record = await engine.maybeObserve(record);

  // An ObservationEntry was appended to the session tree.
  const leafId = await Effect.runPromise(session.getLeafId());
  const path = await Effect.runPromise(session.getPathToRoot(leafId));
  const obsEntry = path.find((e) => e.type === "observation");
  expect(obsEntry).toBeDefined();
  expect((obsEntry as { summary: string }).summary).toContain("obs");
});
```

**Step 3: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- engine.test
```

Expected: FAIL — no `observation` entry in the tree (current code writes to `activeObservations` only).

**Step 4: Implement**

In `packages/agent/src/observational-memory/engine.ts`, in `runSyncObserve` (~line 730), after the observer produces `observerResult.observations` and before/after updating the record, append an `ObservationEntry`:

```ts
// Append the observation as a persisted stream entry at the leaf.
// Positioned after the observed batch; pruning skips the batch so this
// entry appears at the batch's position in the rendered stream.
const leafId = await Effect.runPromise(this.sessionStorage.getLeafId());
const obsEntryId = await Effect.runPromise(this.sessionStorage.createEntryId());
const observationEntry: ObservationEntry = {
  id: obsEntryId,
  parentId: leafId,
  timestamp: new Date().toISOString(),
  type: "observation",
  summary: observerResult.observations,
  observationRecordId: record.id,
};
await Effect.runPromise(this.sessionStorage.appendEntry(observationEntry));
```

Import `ObservationEntry` from `../session/entries.ts`.

**Do NOT update `record.activeObservations`** for thread-scope (the tree is the source of truth). Leave the field empty or unchanged. The `observedMessageIds` and token counts are still updated on the record (used for pruning + thresholds).

> **Note for implementer:** The `record.activeObservations` update logic (engine.ts ~754-756) currently merges observations. For thread-scope, skip this merge (or gate it on `this.deps.scope === "resource"`). Resource-scope keeps using `activeObservations` (cross-session record).

**Step 5: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- engine.test
```

Expected: PASS.

**Step 6: Run full agent test suite**

```bash
vp run '@sakti-code/agent#test'
```

Expected: Some tests in `engine.test.ts` that assert on `activeObservations` may fail — update them to assert on the tree entry instead (or gate on resource-scope). Fix in Task 7.1.

**Step 7: Commit**

```bash
git add packages/agent/src/observational-memory/engine.ts packages/agent/src/observational-memory/__tests__/engine.test.ts
git commit -m "feat(agent): observer appends ObservationEntry to the session tree

Observations are now persisted as stream entries at the leaf, positioned
after the observed batch. Pruning skips the batch so the entry appears at
the batch's position. activeObservations is no longer updated for
thread-scope (the tree is the source of truth)."
```

---

## Part 4: Reflector appends `ReflectionEntry`

### Task 4.1: Reflector reads `ObservationEntry` rows from the tree

**Files:**

- Modify: `packages/agent/src/observational-memory/engine.ts` (`runSyncReflect`, ~line 540)

**Step 1: Read the current `runSyncReflect`**

```
packages/agent/src/observational-memory/engine.ts — runSyncReflect(record)
```

Currently: reads `record.activeObservations`, calls `runReflector`, replaces `activeObservations` with the reflection.

**Step 2: Write the failing test**

Append to `packages/agent/src/observational-memory/__tests__/engine.test.ts`:

```ts
it("runSyncReflect appends a ReflectionEntry and prunes observation entries", async () => {
  // Seed: observe twice (two ObservationEntry rows), then reflect.
  // Assert: a ReflectionEntry is in the tree; the ObservationEntry IDs are
  // in the latest observation_prune's observedEntryIds (skipped by the builder).
  const engine = new ObservationalMemoryEngine({ deps: createDeps(storage, session) });
  // ... seed messages, set observer + reflector completions, observe + reflect ...
  const leafId = await Effect.runPromise(session.getLeafId());
  const path = await Effect.runPromise(session.getPathToRoot(leafId));
  const reflectionEntry = path.find((e) => e.type === "reflection");
  expect(reflectionEntry).toBeDefined();
  // Observation entries are in the prune set (skipped by the builder).
  const pruneEntry = path.find((e) => e.type === "observation_prune");
  const observedIds =
    (pruneEntry as { observedEntryIds: string[] } | undefined)?.observedEntryIds ?? [];
  const observationEntries = path.filter((e) => e.type === "observation");
  for (const oe of observationEntries) {
    expect(observedIds).toContain(oe.id);
  }
});
```

**Step 3: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- engine.test
```

Expected: FAIL — reflector currently writes to `activeObservations`, no `ReflectionEntry` in the tree.

**Step 4: Implement**

In `packages/agent/src/observational-memory/engine.ts`, in `runSyncReflect`:

1. **Read observations from the tree** (not `activeObservations`):

```ts
const leafId = await Effect.runPromise(this.sessionStorage.getLeafId());
const pathEntries = await Effect.runPromise(this.sessionStorage.getPathToRoot(leafId));
const observationEntries = pathEntries.filter(
  (e): e is ObservationEntry => e.type === "observation",
);
// Filter out already-pruned observations (in the latest prune set).
// ... (use the same observedEntryIds logic as the context builder)
const activeObservations = observationEntries
  .filter((e) => !observedSkipSet.has(e.id))
  .map((e) => e.summary)
  .join("\n\n");
```

2. **Feed `activeObservations` to the reflector** (as before).

3. **After reflection, append a `ReflectionEntry`** at the leaf:

```ts
      const reflectionEntry: ReflectionEntry = {
        id: /* createEntryId */,
        parentId: leafId,
        timestamp: new Date().toISOString(),
        type: "reflection",
        summary: reflectorResult.reflection,
        observationRecordId: record.id,
      };
      await Effect.runPromise(this.sessionStorage.appendEntry(reflectionEntry));
```

4. **Prune the observation entries**: add their IDs to the cumulative prune set (via `pruneObservedMessages` or a direct prune entry append). The observation entries are now skipped by the context builder; the ReflectionEntry is rendered.

Import `ReflectionEntry` and `ObservationEntry` from `../session/entries.ts`.

> **Note for implementer:** The reflector's `observationTokenCount` (threshold) must be computed from the ObservationEntry rows (sum of their token counts), not from `record.activeObservations`. Update the token accounting accordingly. The `record.observationTokenCount` can still be tracked on the record (updated by the observer when it appends entries; reset by the reflector when it prunes them).

**Step 5: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- engine.test
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/agent/src/observational-memory/engine.ts packages/agent/src/observational-memory/__tests__/engine.test.ts
git commit -m "feat(agent): reflector appends ReflectionEntry + prunes observation entries

Reflector reads ObservationEntry rows from the tree (not activeObservations),
reflects, appends a ReflectionEntry at the leaf, and adds observation IDs to
the prune set so the context builder skips them. One reflection message
replaces the accumulated observation messages."
```

---

## Part 5: Remove system injection; resource-scope as stream message

### Task 5.1: Remove OM `systemMessages` injection from agent-loop

Revert the system-injection we built in the previous plan. Observations now live in the message stream (via tree entries rendered by the context builder), NOT in `systemMessages`.

**Files:**

- Modify: `packages/agent/src/core/agent-loop.ts` (the three OM injection sites: initial-turn ~285-309, turn-boundary ~422-464)
- Modify: `packages/agent/src/types.ts` — remove `systemMessages` from `AgentLoopConfig.observationalMemory.engine.buildContextSystemMessages` usage (the loop no longer calls it for thread-scope)

**Step 1: Write the failing test**

Update `packages/agent/src/core/__tests__/agent-loop-om-readonly.test.ts` — the own-OM test should assert observations appear in `req.messages` (as observation-role messages rendered from tree entries), NOT in `req.systemMessages`:

```ts
it("own-OM: observations appear in messages stream, not systemMessages", async () => {
  // ... configure own-OM with an engine that appends ObservationEntry ...
  // ... run a turn ...
  // Assert: req.system is the immutable base (no observations).
  // Assert: req.messages contains an observation-role message.
  // Assert: req.systemMessages is undefined.
});
```

> **Note for implementer:** This requires the test's fake engine to actually append an `ObservationEntry` to a session storage (so the context builder renders it). Model on the existing `makeOwnOm` but have `buildContextSystemMessages` return `undefined` (no system injection) and `maybeObserve` append an `ObservationEntry`. Alternatively, seed the session with an `ObservationEntry` directly and verify the builder renders it into `messages`.

**Step 2: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- agent-loop-om-readonly
```

Expected: FAIL — current code injects via `systemMessages`.

**Step 3: Remove the systemMessages injection**

In `packages/agent/src/core/agent-loop.ts`:

- **Initial-turn OM block (~285-309)**: Remove the `systemMessages` write. The own-OM observations are now tree entries (appended by the observer, rendered by the context builder). The loop no longer needs to inject them. Keep the `maybeObserve`/`maybeReflect` calls at the turn boundary (they append entries), but remove the `buildContextSystemMessages` → `systemMessages` write.

- **Turn-boundary OM block (~422-449)**: Same — keep `maybeObserve`/`maybeReflect` (they append `ObservationEntry`/`ReflectionEntry`), remove the `systemMessages` write.

- **Read-only OM block (~450-464)**: Change to inject into `context.messages` (see Task 5.2), not `systemMessages`.

- **Stream call (~554-557)**: Remove the `systemMessages` pass-through.

**Step 4: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- agent-loop-om-readonly
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent/src/core/agent-loop.ts packages/agent/src/core/__tests__/agent-loop-om-readonly.test.ts
git commit -m "refactor(agent): remove OM systemMessages injection — observations are tree entries"
```

---

### Task 5.2: Resource-scope read-only OM as a stream message (after skill-pair)

The resource-scope (cross-session) observations stay in the OM record (`activeObservations`), but are now delivered as a stream message in `context.messages` (after the skill-pair), not in `system`.

**Files:**

- Modify: `packages/agent/src/core/agent-loop.ts` (read-only OM block, ~450-464)
- Modify: `packages/agent/src/types.ts` — `observationalMemoryReadOnly.getObservationsBlocks` returns `string[]` (kept from previous plan)

**Step 1: Write the failing test**

The read-only test in `agent-loop-om-readonly.test.ts` should assert the block appears in `req.messages` (as a user message), not `req.system`:

```ts
it("read-only: observations appear in messages after skill-pair, not system", async () => {
  // ... configure read-only OM returning [OBS_BLOCK] ...
  // ... run a turn with a skill-pair in context.messages ...
  // Assert: req.system is the immutable base.
  // Assert: req.messages contains the OBS_BLOCK text (as a user message)
  //         positioned AFTER the skill-pair.
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — read-only currently writes to `systemMessages` (or was removed in 5.1).

**Step 3: Implement**

In `packages/agent/src/core/agent-loop.ts`, the read-only OM block: instead of writing to `systemMessages`, inject the observation blocks as user messages into `context.messages` after the skill-pair.

Add a helper to find the insertion index (after the skill-pair's toolResult):

```ts
/** Find the index after the skill-injection pair (the skill-read toolResult),
 * or 0 if no skill pair is present. Observations are inserted here so the
 * skill-pair stays cached (before observations in the cache prefix). */
function findObservationInsertionIndex(messages: AgentMessage[]): number {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.role === "toolResult") {
      // The skill-read toolResult is the synthetic pair's tail.
      // (Identify by the skill-read toolCallId pattern on the preceding assistant.)
      if (i > 0 && messages[i - 1]!.role === "assistant") {
        const prev = messages[i - 1]!;
        if (prev.role === "assistant" && Array.isArray(prev.content)) {
          const hasSkillCall = prev.content.some(
            (b) =>
              b.type === "toolCall" && typeof b.id === "string" && b.id.startsWith("skill-read"),
          );
          if (hasSkillCall) return i + 1;
        }
      }
    }
  }
  return 0;
}
```

In the read-only OM block:

```ts
if (config.observationalMemoryReadOnly) {
  const omReadOnlyBlocks =
    yield *
    Effect.tryPromise({
      try: () => config.observationalMemoryReadOnly!.getObservationsBlocks(),
      catch: () => undefined,
    });
  if (omReadOnlyBlocks !== undefined && omReadOnlyBlocks.length > 0) {
    const insertAt = findObservationInsertionIndex(currentContext.messages);
    const obsMessages: AgentMessage[] = omReadOnlyBlocks.map((text) => ({
      role: "user" as const,
      content: [{ type: "text" as const, text }],
      timestamp: Date.now(),
    }));
    currentContext = {
      ...currentContext,
      messages: [
        ...currentContext.messages.slice(0, insertAt),
        ...obsMessages,
        ...currentContext.messages.slice(insertAt),
      ],
    };
  }
}
```

**Step 4: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- agent-loop-om-readonly
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent/src/core/agent-loop.ts packages/agent/src/core/__tests__/agent-loop-om-readonly.test.ts
git commit -m "feat(agent): resource-scope read-only OM as stream message after skill-pair"
```

---

### Task 5.3: Revert unused `systemMessages` plumbing (YAGNI cleanup)

With observations now in the message stream, `AgentContext.systemMessages` and `StreamRequest.systemMessages`/`buildSystemParam` are unused. Remove them.

**Files:**

- Modify: `packages/agent/src/types.ts` — remove `systemMessages` from `AgentContext`
- Modify: `packages/llm/src/stream.ts` — remove `systemMessages` field + `buildSystemParam` + revert to `instructions: req.system`
- Modify: `packages/agent/src/core/agent-loop.ts` — remove any remaining `systemMessages` references

**Step 1:** Run `vp check` to find all references to `systemMessages` and `buildSystemParam`.

```bash
grep -rn "systemMessages\|buildSystemParam" packages/ apps/ --include="*.ts" | grep -v "__tests__\|\.test\."
```

**Step 2:** Remove each reference:

- `AgentContext.systemMessages` field (types.ts) — remove.
- `StreamRequest.systemMessages` field (stream.ts) — remove.
- `buildSystemParam` function (stream.ts) — remove; restore `...(req.system ? { instructions: req.system } : {})`.
- agent-loop stream call — remove the `systemMessages` pass-through (already done in 5.1, verify).
- Tests that assert on `systemMessages` — remove/update.

**Step 3: Run full suite + check**

```bash
vp run -r test
vp check --fix
```

Expected: PASS, 0 errors.

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove unused systemMessages plumbing (observations are stream entries)"
```

---

## Part 6: UI surfaces observation/reflection entries

### Task 6.1: Chat route includes observation/reflection as markers

**Files:**

- Modify: `apps/server/src/routes/sessions/chat.ts:32-54` (the entry loop)

**Step 1: Read the current chat route**

```
apps/server/src/routes/sessions/chat.ts:32-54 — iterates entries, filters type === "message"
```

Currently only `type === "message"` entries are included in turns. Observation/reflection entries are skipped.

**Step 2: Write the failing test**

Create `apps/server/src/routes/sessions/__tests__/chat-om-entries.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
// Test that the chat route returns observation/reflection entries as part of
// the turns (so the UI can render "observer ran here" / "reflection ran here" markers).
// Seed a session with a message + ObservationEntry, call the route, assert the
// observation entry appears in the response.
```

> **Note for implementer:** Model on existing server route tests. The exact DTO shape for observation/reflection markers is a design choice — either add them to `intermediateIds` or a new `markers` field on `ChatTurnDTO`. Recommend: a new `markers: { type: "observation" | "reflection"; id: string; summary: string }[]` field on `ChatTurnDTO`, populated from observation/reflection entries.

**Step 3: Run test to verify it fails**

```bash
vp run '@sakti-code/server#test' -- chat-om-entries
```

Expected: FAIL — observation entries not included.

**Step 4: Implement**

In `apps/server/src/routes/sessions/chat.ts`:

1. Add a `markers` field to `ChatTurnDTO`:

```ts
export interface ChatTurnDTO {
  endedAt: number | null;
  id: string;
  intermediateIds: string[];
  markers: Array<{ id: string; summary: string; type: "observation" | "reflection" }>;
  sequence: number;
  startedAt: number;
  summaryMessage: Record<string, unknown> | null;
  userMessage: Record<string, unknown> | null;
}
```

2. In the entry loop (line 32-54), handle observation/reflection entries:

```ts
if (e.entry.type === "observation" || e.entry.type === "reflection") {
  const slot = byTurn.get(e.turnId ?? "") ?? {
    intermediateIds: [],
    summary: null,
    user: null,
    markers: [],
  };
  slot.markers.push({
    id: e.entry.id,
    summary: e.entry.summary,
    type: e.entry.type,
  });
  byTurn.set(e.turnId ?? "", slot);
  continue;
}
```

(Note: observation/reflection entries may not have a `turnId` if appended at the leaf between turns. If `turnId` is null, attach them to the most recent turn or a synthetic "between turns" slot. Decide based on how the UI wants to render them.)

**Step 5: Run test to verify it passes**

```bash
vp run '@sakti-code/server#test' -- chat-om-entries
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/server/src/routes/sessions/chat.ts apps/server/src/routes/sessions/__tests__/chat-om-entries.test.ts
git commit -m "feat(server): surface observation/reflection entries in chat route as markers"
```

---

## Part 7: Update existing tests + full verification

### Task 7.1: Update engine tests for tree-entry observations

**Files:**

- Modify: `packages/agent/src/observational-memory/__tests__/engine.test.ts`

**Step 1:** Find all tests that assert on `record.activeObservations` (the merged string). For thread-scope, these now fail (observations are in the tree). Update them to assert on `ObservationEntry` rows in the session tree instead.

**Step 2:** Find tests that assert on `buildContextSystemMessage` (singular) / `buildContextSystemMessages` (plural) returning observation content. For thread-scope, these now return `undefined` (observations aren't in the record). Update or remove.

> **Note:** `buildContextSystemMessages` is still used for **resource-scope** (the read-only path reads the record). Keep the method; just don't use it for thread-scope injection. Tests for resource-scope still assert on it.

**Step 3:** Run:

```bash
vp run '@sakti-code/agent#test' -- engine.test
```

Expected: PASS.

**Step 4: Commit**

```bash
git add packages/agent/src/observational-memory/__tests__/engine.test.ts
git commit -m "test(agent): update engine tests for tree-entry observations"
```

---

### Task 7.2: Update loop-integration + agent-loop tests

**Files:**

- Modify: `packages/agent/src/observational-memory/__tests__/loop-integration.test.ts`
- Modify: `packages/agent/src/core/__tests__/agent-loop.test.ts`

**Step 1:** `loop-integration.test.ts` — the fake engine's `buildContextSystemMessages` is no longer called for injection. Update: the fake engine's `maybeObserve` should append an `ObservationEntry` to the session storage. Assert observations appear in `req.messages` (observation-role), not `req.system`/`req.systemMessages`.

**Step 2:** `agent-loop.test.ts` — remove any `systemMessages` assertions.

**Step 3:** Run:

```bash
vp run '@sakti-code/agent#test' -- loop-integration agent-loop
```

Expected: PASS.

**Step 4: Commit**

```bash
git add packages/agent/src/observational-memory/__tests__/loop-integration.test.ts packages/agent/src/core/__tests__/agent-loop.test.ts
git commit -m "test(agent): update loop tests for stream-entry observations"
```

---

### Task 7.3: Full workspace test suite + check

**Step 1: Run all tests**

```bash
vp run -r test
```

Expected: ALL PASS (pre-existing `packages/sakti` CLI test failures are unrelated — inquirer-removal commit `372278c57`).

**Step 2: Run full check**

```bash
vp check --fix
```

Expected: 0 warnings, 0 errors.

**Step 3: Verify the cache prefix**

Confirm the message stream the agent LLM receives is now:

```
system:  [base]                      ← immutable, cached
tools:   [tools]                     ← cached ✓
messages:[user1][skill-pair][OBS1][OBS2]...[reflection1]...[ongoing]
```

Observations are AFTER the skill-pair → skill is byte-for-byte cached across observation cycles. Only new observation/reflection entries (appended at the tail) cause cache misses, and only from their position forward.

**Step 4: Verify no stale references**

```bash
grep -rn "systemMessages" packages/ apps/ --include="*.ts" | grep -v "__tests__\|\.test\."
```

Expected: no matches (fully removed).

```bash
grep -rn "activeObservations" packages/agent/src/observational-memory/engine.ts | grep -v "resource\|//"
```

Expected: only resource-scope references (thread-scope no longer reads/writes `activeObservations`).

---

## Verification Checklist

After all tasks complete:

- [ ] `ObservationEntry` + `ReflectionEntry` types exist in the session-tree union
- [ ] `ObservationMessage` + `ReflectionMessage` AgentMessage roles exist; `convertToLlm` renders them as user-role XML
- [ ] Context builder renders `ObservationEntry`/`ReflectionEntry` as stream messages
- [ ] Observer appends `ObservationEntry` at the leaf (not `activeObservations` for thread-scope)
- [ ] Reflector reads `ObservationEntry` rows from the tree, appends `ReflectionEntry`, prunes observations
- [ ] `observation_prune` skip-set is cumulative (batch IDs + observation IDs when reflected)
- [ ] Skill pair is NEVER observed (filter unchanged), NEVER pruned (not in skip-set)
- [ ] Observations appear in `messages` (after skill-pair), NOT in `system`/`systemMessages`
- [ ] Resource-scope read-only OM rendered as a stream message after skill-pair
- [ ] `systemMessages`/`buildSystemParam` fully removed (YAGNI)
- [ ] Chat route surfaces observation/reflection as UI markers
- [ ] `vp run -r test` passes (excluding pre-existing sakti CLI failures)
- [ ] `vp check` clean (0 warnings, 0 errors)

---

## Cache Stability Analysis (post-fix)

```
Turn N (observations accumulated, no new observe):
  system:  [base]                        ← cache HIT (immutable)
  tools:   [tools]                       ← cache HIT ✓
  messages:[user1][skill][obs1][obs2][resp…][userN]
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ← ALL cached (prefix unchanged)

Observation fires → OBS3 appended at leaf, batch pruned:
  system:  [base]                        ← cache HIT (immutable)
  tools:   [tools]                       ← cache HIT ✓
  messages:[user1][skill][obs1][obs2][obs3][userN+1]
                              ^^^^^^^^^^^ ← only obs3+ misses (appended at tail)
  (skill + prior observations stay cached ✓)

Reflection fires → obs1,obs2,obs3 pruned, reflection1 appended:
  system:  [base]                        ← cache HIT
  tools:   [tools]                       ← cache HIT
  messages:[user1][skill][reflection1][userN+1]
                       ^^^^^^^^^^^^^^^^^^ ← breaks at reflection1 (expected —
                                            observations compressed into one message)
```

The skill-pair is byte-for-byte cached across ALL observation cycles. Only new observation/reflection entries (at the tail) cause cache misses, and only from their position forward. This is the "best of both worlds": OM pruning keeps context bounded, and the skill stays cached.

---

## Notes for the Implementer

- **TDD is mandatory.** Every task follows RED → GREEN → COMMIT.
- **`exactOptionalPropertyTypes: true`** — use conditional spread for optional fields.
- **The `observation_prune` entry is the skip-set mechanism** — keep it. `ObservationEntry`/`ReflectionEntry` are content entries. Two separate concerns.
- **No tree reparenting** — entries are appended at the leaf. Pruning skips earlier entries via the cumulative skip-set. Position works out naturally.
- **Thread-scope vs resource-scope** — thread-scope observations are tree entries (source of truth = the tree); resource-scope observations stay in `activeObservations` (source of truth = the OM record, cross-session). The engine's `deps.scope` determines which path.
- **`buildContextSystemMessages` stays** — used by resource-scope (read-only). Thread-scope no longer calls it.
- **The reflector's token threshold** (`observationTokenCount`) must be computed from `ObservationEntry` rows (thread-scope), not `activeObservations`. Track it on the record (updated by observer, reset by reflector).
- **UI markers** — observation/reflection entries may not have a `turnId` (appended between turns). Decide whether to attach to the nearest turn or render as between-turn markers. The DTO shape (`markers` field) is a design choice; the test documents the contract.
