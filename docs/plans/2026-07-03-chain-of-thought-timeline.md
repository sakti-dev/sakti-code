# Chain-of-Thought Timeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace flat `Turn.messages: UIMessage[]` with typed `intermediates` + `summary` fields at the store level, then build a chain-of-thought timeline UI on top with explore grouping and auto-collapse.

**Architecture:** Store refactors `Turn` to explicitly distinguish intermediate messages from the summary. `addAssistantMessage` demotes the current summary to intermediates when a new message arrives. Timeline components (`TimelineStep`, `CollapsibleStep`, `ExploreStep`) render intermediate parts as a vertical stepper with connector lines. Consecutive explore tools (read, grep, glob, find, ls) are grouped into collapsible "Explored N files" entries with auto-expand/collapse behavior.

**Tech Stack:** SolidJS, TypeScript, Tailwind CSS, Vitest (jsdom), solid-js/store

---

## Reference Files (read before starting)

| File                                                                     | Purpose                                                    |
| ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `apps/desktop/src/stores/types.ts:8-116`                                 | `MessagePart`, `UIMessage`, `Turn` types                   |
| `apps/desktop/src/stores/session/session-store.ts`                       | Session store with all message operations                  |
| `apps/desktop/src/stores/session/hydrate-chat.ts`                        | REST hydration: `hydrateChatTurns`, `hydrateIntermediates` |
| `apps/desktop/src/stores/session/hydrate-messages.ts`                    | Legacy hydration: `hydrateSessionTurns`                    |
| `apps/desktop/src/stores/session/hydrate-helpers.ts`                     | `convertAssistantMessage`, `mergeToolResult`               |
| `apps/desktop/src/stores/session/usage-stats.ts:38-55`                   | `aggregateUsage` iterates `turn.messages`                  |
| `apps/desktop/src/stores/session/handlers/message-events.ts`             | `message_start` → `addAssistantMessage`                    |
| `apps/desktop/src/stores/session/__tests__/turn-store.test.ts`           | Store tests (primary test file)                            |
| `apps/desktop/src/components/chat-area/timeline/session-turn.tsx`        | Main turn renderer                                         |
| `apps/desktop/src/components/chat-area/timeline/thinking-helpers.ts`     | Thinking extraction helpers                                |
| `apps/desktop/src/components/chat-area/parts/thinking-part.tsx`          | Old ThinkingPart (to be replaced)                          |
| `apps/desktop/src/components/chat-area/parts/tool-part.tsx`              | ToolPart component                                         |
| `apps/desktop/src/components/chat-area/tools/tool-summary-row.tsx`       | ToolSummaryRow                                             |
| `apps/desktop/src/components/chat-area/tools/tool-name.ts`               | `normalizeToolName()`                                      |
| `apps/desktop/src/components/chat-area/timeline/estimate-turn-height.ts` | Height estimation for virtualizer                          |
| `apps/desktop/src/lib/format-duration.ts`                                | `formatDuration()`                                         |

## Conventions

- **TDD**: Write failing test → implement → pass → commit
- **Tests**: vitest under jsdom, colocated in `__tests__/`
- **`exactOptionalPropertyTypes: true`**: Use `...(x !== undefined ? { x } : {})` not passing `undefined`
- **SolidJS**: Use `class`/`for` (not `className`/`htmlFor`), fine-grained reactivity
- **Logger is permanent**: Never remove existing log statements
- **No backwards compat**: Clean break, no migration shims
- **Run `vp check --fix`** before committing
- **Test command**: `vp run desktop#test`
- **Check command**: `vp check`
- **Single test**: `vp run desktop#test -- <pattern>`

---

## PHASE 1: Store Type Refactor

### Task 1: Change Turn Type

**Files:**

- Modify: `apps/desktop/src/stores/types.ts:99-116`

**Step 1: Update the Turn interface**

Replace `messages: UIMessage[]` with `intermediates` + `summary`:

```typescript
export interface Turn {
  endedAt: number | null;
  error: string | null;
  id: string;
  /** Intermediate assistant messages (thinking, tool calls, text). */
  intermediates: UIMessage[];
  /** Count of intermediate entries on the server (for the collapse badge). */
  intermediateCount: number;
  /** Whether intermediates have been loaded into `intermediates`. */
  intermediatesLoaded: boolean;
  /** UIMessage ids of loaded intermediates (for eviction). */
  loadedMessageIds: string[];
  /** The final assistant response. Null until first message arrives. */
  summary: UIMessage | null;
  /** Server turn ID — null for live turns, non-null for REST-loaded turns. */
  turnId: string | null;
  startedAt: number | null;
  userMessage: UIMessage | null;
  working: boolean;
}
```

**Step 2: Run typecheck to see breakage**

Run: `vp check 2>&1 | grep "error" | head -20`
Expected: Many errors across session-store.ts, hydrate files, tests — this is expected.

**Step 3: Do NOT commit yet — proceed to Task 2**

---

### Task 2: Refactor session-store.ts

**Files:**

- Modify: `apps/desktop/src/stores/session/session-store.ts`

This is the core change. Update MsgLocation, startTurn, addAssistantMessage (with demotion), all part operations, loadIntermediates, evictIntermediates, getLastAssistantMessageId, reindexAll.

**Step 1: Update MsgLocation and indexing**

```typescript
/** O(1) lookup: msgId → location in the store. */
interface MsgLocation {
  turnIdx: number;
  /** true = message lives in turn.summary, false = in turn.intermediates[msgIdx] */
  inSummary: boolean;
  /** Index into intermediates[]. Ignored when inSummary is true. */
  msgIdx: number;
}
```

Update `indexMessage` and `reindexAll`:

```typescript
function indexMessage(msgId: string, turnIdx: number, msgIdx: number, inSummary: boolean): void {
  msgLocation.set(msgId, { inSummary, msgIdx, turnIdx });
}

function reindexAll(): void {
  msgLocation.clear();
  for (let t = 0; t < store.turns.length; t++) {
    const turn = store.turns[t]!;
    for (let m = 0; m < turn.intermediates.length; m++) {
      indexMessage(turn.intermediates[m]!.id, t, m, false);
    }
    if (turn.summary) {
      indexMessage(turn.summary.id, t, 0, true);
    }
  }
}
```

**Step 2: Add store-path helpers**

Add these private helpers before the `actions` object:

```typescript
function getMsg(loc: MsgLocation): UIMessage | undefined {
  const turn = store.turns[loc.turnIdx];
  if (!turn) return undefined;
  return loc.inSummary ? (turn.summary ?? undefined) : turn.intermediates[loc.msgIdx];
}

/** Mutate a message in-place via produce(). */
function mutateMsg(loc: MsgLocation, fn: (msg: UIMessage) => void): void {
  if (loc.inSummary) {
    setStore("turns", loc.turnIdx, "summary", produce(fn));
  } else {
    setStore("turns", loc.turnIdx, "intermediates", loc.msgIdx, produce(fn));
  }
}

/** Replace the parts array on a message. */
function setMsgParts(loc: MsgLocation, fn: (prev: MessagePart[]) => MessagePart[]): void {
  if (loc.inSummary) {
    setStore("turns", loc.turnIdx, "summary", "parts", fn);
  } else {
    setStore("turns", loc.turnIdx, "intermediates", loc.msgIdx, "parts", fn);
  }
}

/** Set a single field on a message. */
function setMsgField<K extends keyof UIMessage>(
  loc: MsgLocation,
  field: K,
  value: UIMessage[K],
): void {
  if (loc.inSummary) {
    setStore("turns", loc.turnIdx, "summary", field, value);
  } else {
    setStore("turns", loc.turnIdx, "intermediates", loc.msgIdx, field, value);
  }
}
```

**Step 3: Update `startTurn`**

```typescript
startTurn(userMessage, startedAt) {
  const turn: Turn = {
    endedAt: null,
    error: null,
    id: crypto.randomUUID(),
    intermediateCount: 0,
    intermediates: [],
    intermediatesLoaded: false,
    loadedMessageIds: [],
    summary: null,
    startedAt: startedAt ?? Date.now(),
    turnId: null,
    userMessage,
    working: true,
  };
  setStore("turns", (prev) => [...prev, turn]);
},
```

**Step 4: Update `addAssistantMessage` (with demotion logic)**

```typescript
addAssistantMessage(msg) {
  const turnIdx = store.turns.length - 1;
  if (turnIdx < 0) return;
  const turn = store.turns[turnIdx]!;

  // Demote current summary to intermediates
  if (turn.summary) {
    const prevSummary = turn.summary;
    const newIdx = turn.intermediates.length;
    setStore("turns", turnIdx, "intermediates", (prev) => [...prev, prevSummary]);
    indexMessage(prevSummary.id, turnIdx, newIdx, false);
  }

  // New message becomes the summary
  setStore("turns", turnIdx, "summary", msg);
  indexMessage(msg.id, turnIdx, 0, true);
  setStore("streaming", "currentMessageId", msg.id);
  setStore("streaming", "phase", "writing");
},
```

**Step 5: Update `appendTextToken`**

```typescript
appendTextToken(msgId, delta) {
  const loc = findMsg(msgId);
  if (!loc) return;
  mutateMsg(loc, (m) => {
    m.content += delta;
    const parts = m.parts;
    const last = parts[parts.length - 1];
    if (last !== undefined && last.type === "text") {
      last.text += delta;
    } else if (last !== undefined) {
      if (last.type === "thinking" && last.endedAt === undefined) {
        last.endedAt = Date.now();
      }
      last.isStreaming = false;
      parts.push({ type: "text", text: delta, isStreaming: true });
    } else {
      parts.push({ type: "text", text: delta, isStreaming: true });
    }
  });
  setStore("streaming", "tokenCount", (n: number) => n + 1);
},
```

**Step 6: Update `appendThinkingToken`**

```typescript
appendThinkingToken(msgId, delta) {
  const loc = findMsg(msgId);
  if (!loc) return;
  setMsgParts(loc, (prev) => {
    const last = prev.at(-1);
    if (last !== undefined && last.type === "thinking") {
      return [...prev.slice(0, -1), { ...last, text: last.text + delta }];
    }
    const newPart: MessagePart = {
      type: "thinking",
      text: delta,
      startedAt: Date.now(),
      isStreaming: true,
    };
    if (last !== undefined) {
      return [...prev.slice(0, -1), { ...last, isStreaming: false }, newPart];
    }
    return [newPart];
  });
},
```

**Step 7: Update `addToolCall`**

```typescript
addToolCall(msgId, toolCallId, toolName, input) {
  const loc = findMsg(msgId);
  if (!loc) return;
  const part: MessagePart = {
    type: "tool_call",
    input,
    isStreaming: true,
    status: "running",
    toolCallId,
    toolName,
  };
  setMsgParts(loc, (prev) => {
    const last = prev.at(-1);
    if (last === undefined) return [part];
    if (last.type === "thinking" && last.endedAt === undefined) {
      return [...prev.slice(0, -1), { ...last, endedAt: Date.now(), isStreaming: false }, part];
    }
    return [...prev.slice(0, -1), { ...last, isStreaming: false }, part];
  });
  setStore("streaming", "currentToolName", toolName);
  setStore("streaming", "phase", "tool_running");
},
```

**Step 8: Update `completeToolCall`**

```typescript
completeToolCall(msgId, toolCallId, result, isError, details) {
  const loc = findMsg(msgId);
  if (!loc) return;
  const isErr = isError ?? false;
  setMsgParts(loc, (prev) =>
    prev.map((p) =>
      p.type === "tool_call" && p.toolCallId === toolCallId
        ? {
            ...p,
            status: isErr ? ("error" as const) : ("done" as const),
            result,
            isStreaming: false,
            ...(details === undefined ? {} : { details }),
          }
        : p,
    ),
  );
  setStore("streaming", "currentToolName", null);
},
```

**Step 9: Update compaction operations** (`addCompactionMarker`, `appendCompactionToken`, `updateCompactionMarker`)

Each uses `setMsgParts(loc, ...)` instead of the flat path. The logic inside stays the same.

**Step 10: Update OM marker operations** (`addOmMarker`, `updateOmMarker`)

Same pattern — replace flat path with `setMsgParts(loc, ...)`.

**Step 11: Update `finalizeMessage`**

```typescript
finalizeMessage(msgId, usage) {
  const loc = findMsg(msgId);
  if (!loc) return;
  setMsgParts(loc, (prev) => {
    const last = prev.at(-1);
    if (last === undefined) return prev;
    if (last.type === "thinking" && last.endedAt === undefined) {
      return [...prev.slice(0, -1), { ...last, endedAt: Date.now(), isStreaming: false }];
    }
    return [...prev.slice(0, -1), { ...last, isStreaming: false }];
  });
  setMsgField(loc, "isStreaming", false);
  if (usage !== undefined) {
    setMsgField(loc, "usage", usage);
  }
},
```

**Step 12: Update `setError`**

```typescript
setError(msgId, error) {
  const loc = findMsg(msgId);
  if (loc) {
    setMsgField(loc, "error", error);
  }
  setStore("streaming", "phase", "error");
},
```

**Step 13: Update `setContent`**

```typescript
setContent(msgId, content) {
  const loc = findMsg(msgId);
  if (!loc) return;
  setMsgField(loc, "content", content);
},
```

**Step 14: Update `getLastAssistantMessageId`**

```typescript
getLastAssistantMessageId() {
  for (let t = store.turns.length - 1; t >= 0; t--) {
    const turn = store.turns[t]!;
    if (turn.summary) {
      return turn.summary.id;
    }
    const lastIntermediate = turn.intermediates.at(-1);
    if (lastIntermediate) {
      return lastIntermediate.id;
    }
  }
  return null;
},
```

**Step 15: Update `loadIntermediates`**

```typescript
loadIntermediates(turnId, messages) {
  const turnIdx = store.turns.findIndex((t) => t.turnId === turnId);
  if (turnIdx < 0) return;

  const ids = messages.map((m) => m.id);
  setStore("turns", turnIdx, "intermediates", messages);

  // Re-index this turn
  const turn = store.turns[turnIdx]!;
  for (let m = 0; m < turn.intermediates.length; m++) {
    indexMessage(turn.intermediates[m]!.id, turnIdx, m, false);
  }
  if (turn.summary) {
    indexMessage(turn.summary.id, turnIdx, 0, true);
  }

  setStore("turns", turnIdx, "intermediatesLoaded", true);
  setStore("turns", turnIdx, "loadedMessageIds", ids);
},
```

**Step 16: Update `evictIntermediates`**

```typescript
evictIntermediates(turnId) {
  const turnIdx = store.turns.findIndex((t) => t.turnId === turnId);
  if (turnIdx < 0) return;
  const turn = store.turns[turnIdx]!;
  if (turn.loadedMessageIds.length === 0) return;

  // Clean up evicted ids from location map
  for (const id of turn.loadedMessageIds) {
    msgLocation.delete(id);
  }

  setStore("turns", turnIdx, "intermediates", []);

  setStore("turns", turnIdx, "intermediatesLoaded", false);
  setStore("turns", turnIdx, "loadedMessageIds", []);
},
```

**Step 17: Run typecheck (expect errors in tests and hydration — those are next)**

Run: `vp check 2>&1 | grep "error" | wc -l`
Expected: Errors remaining in hydrate files, tests, session-turn — Tasks 3-5 fix those.

**Step 18: Commit**

```bash
git add apps/desktop/src/stores/types.ts apps/desktop/src/stores/session/session-store.ts
git commit -m "refactor: replace Turn.messages with intermediates + summary

Turn now explicitly distinguishes intermediate assistant messages
from the final summary. addAssistantMessage demotes the current
summary to intermediates when a new message arrives."
```

---

### Task 3: Update Hydration

**Files:**

- Modify: `apps/desktop/src/stores/session/hydrate-chat.ts`
- Modify: `apps/desktop/src/stores/session/hydrate-messages.ts`

**Step 1: Update `hydrateChatTurns` in hydrate-chat.ts**

Replace `messages` array with `summary` + `intermediates`:

```typescript
export function hydrateChatTurns(chatTurns: ChatTurnDTO[]): Turn[] {
  const turns: Turn[] = [];

  for (const ct of chatTurns) {
    const userEntry = asEntry(ct.userMessage);
    const summaryEntry = asEntry(ct.summaryMessage);

    let userMessage: UIMessage | null = null;
    if (userEntry) {
      userMessage = convertUserMessage(userEntry.id, userEntry.message);
    }

    const summary = summaryEntry
      ? convertAssistantMessage(summaryEntry.id, summaryEntry.message)
      : null;

    turns.push({
      endedAt: ct.endedAt,
      error: null,
      id: ct.id,
      intermediateCount: ct.intermediateIds.length,
      intermediates: [],
      intermediatesLoaded: false,
      loadedMessageIds: [],
      summary,
      startedAt: ct.startedAt,
      turnId: ct.id,
      userMessage,
      working: false,
    });
  }

  return turns;
}
```

**Step 2: Update `hydrateSessionTurns` in hydrate-messages.ts**

This legacy hydration converts flat AgentMessage[] into Turn[]. Replace `messages: []` with `intermediates: [], summary: null`. Replace `current.messages.push(...)` with summary/intermediates logic:

For the assistant message case, the last message is the summary, earlier ones are intermediates. Replace the push logic:

```typescript
} else if (msg.role === "assistant") {
  if (!current) {
    // ... same null-current creation but with new fields
    current = {
      endedAt: null,
      error: null,
      id: crypto.randomUUID(),
      intermediateCount: 0,
      intermediates: [],
      intermediatesLoaded: false,
      loadedMessageIds: [],
      summary: null,
      startedAt: null,
      turnId: null,
      userMessage: null,
      working: false,
    };
  }
  // Demote current summary to intermediates, set new summary
  if (current.summary) {
    current.intermediates.push(current.summary);
  }
  current.summary = convertAssistantMessage(crypto.randomUUID(), msg);
}
```

Also update the turn creation objects (two places: user-message branch and null-current branch) to use `intermediates: [], summary: null` instead of `messages: []`.

Update the `toolResult` branch:

```typescript
} else if (msg.role === "toolResult") {
  if (current && current.summary) {
    mergeToolResultIntoMessage(current.summary, msg);
  }
}
```

Where `mergeToolResultIntoMessage` is applied to the summary message (same logic as `mergeToolResult` but on a single message, not an array). Actually, looking at the existing `mergeToolResult`, it searches backward through a `UIMessage[]`. With the new model, we search the summary and then intermediates in reverse. Simplest: create a helper:

```typescript
function mergeToolResultCurrent(current: Turn, msg: AgentMessage): void {
  // Try summary first, then intermediates in reverse
  const candidates = [
    ...(current.summary ? [current.summary] : []),
    ...[...current.intermediates].reverse(),
  ];
  mergeToolResult(candidates, msg);
}
```

Since `mergeToolResult` searches backward through the array, passing `[summary, ...intermediates.reverse()]` will find the right message.

Update the OM marker branch: replace `current.messages.at(-1)` with `current.summary`:

```typescript
const lastAssistant = current.summary;
if (!lastAssistant) continue;
```

**Step 3: Commit**

```bash
git add apps/desktop/src/stores/session/hydrate-chat.ts \
  apps/desktop/src/stores/session/hydrate-messages.ts
git commit -m "refactor: update hydration for intermediates + summary Turn model"
```

---

### Task 4: Update usage-stats.ts

**Files:**

- Modify: `apps/desktop/src/stores/session/usage-stats.ts:38-55`

**Step 1: Update `aggregateUsage`**

Replace `turn.messages` iteration with `[...intermediates, summary]`:

```typescript
export function aggregateUsage(turns: Turn[]): SessionUsageStats {
  let cost = 0;
  let input = 0;
  let output = 0;
  let reasoningTokens = 0;
  for (const turn of turns) {
    const allMessages = [...turn.intermediates, ...(turn.summary ? [turn.summary] : [])];
    for (const msg of allMessages) {
      if (msg.role !== "assistant" || !msg.usage) {
        continue;
      }
      cost += msg.usage.cost;
      input += msg.usage.input;
      output += msg.usage.output;
      reasoningTokens += msg.usage.reasoningTokens ?? 0;
    }
  }
  return { cost, input, output, reasoningTokens };
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/stores/session/usage-stats.ts
git commit -m "refactor: update aggregateUsage for intermediates + summary"
```

---

### Task 5: Update All Store Tests

**Files:**

- Modify: `apps/desktop/src/stores/session/__tests__/turn-store.test.ts`
- Modify: `apps/desktop/src/stores/session/__tests__/message-handlers.test.ts`
- Modify: `apps/desktop/src/stores/session/__tests__/compaction-handlers.test.ts`
- Modify: `apps/desktop/src/stores/session/__tests__/om-handlers.test.ts`
- Modify: `apps/desktop/src/stores/session/__tests__/tool-handlers.test.ts`
- Modify: `apps/desktop/src/stores/session/__tests__/hydrate-chat.test.ts`
- Modify: `apps/desktop/src/stores/session/__tests__/hydrate-messages.test.ts`
- Modify: `apps/desktop/src/stores/server/__tests__/ws-client.test.ts`
- Modify: `apps/desktop/src/stores/server/__tests__/actions.test.ts`

**Mechanical change pattern:** Every `turn.messages[N]` becomes either `turn.summary` or `turn.intermediates[N]`.

**Rules:**

- `turn.messages[0]` when there's only one message → `turn.summary`
- `turn.messages[0]` when there are multiple → `turn.intermediates[0]`
- `turn.messages.at(-1)` → `turn.summary`
- `turn.messages.length` → `turn.intermediates.length + (turn.summary ? 1 : 0)`
- `turn.messages = [summary]` in test data → `intermediates: [], summary`
- `turn.messages = [int1, int2, summary]` → `intermediates: [int1, int2], summary`
- `turn.messages = []` → `intermediates: [], summary: null`

**Step 1: Update turn-store.test.ts**

Key test changes:

`startTurn` test: `messages` → `intermediates: [], summary: null`:

```typescript
expect(store.turns[0]!.intermediates).toEqual([]);
expect(store.turns[0]!.summary).toBeNull();
```

`addAssistantMessage` test: first message goes to summary:

```typescript
actions.addAssistantMessage(makeAssistantMsg("a1"));
expect(store.turns[0]!.summary!.id).toBe("a1");
expect(store.turns[0]!.summary!.isStreaming).toBe(true);
expect(store.turns[0]!.intermediates).toEqual([]);
```

Add a new test for demotion:

```typescript
it("demotes previous summary to intermediates when new message arrives", () => {
  const { store, actions } = createSessionStore();
  actions.startTurn(makeUserMsg("hi"));
  actions.addAssistantMessage(makeAssistantMsg("a1"));
  actions.finalizeMessage("a1");
  actions.addAssistantMessage(makeAssistantMsg("a2"));

  expect(store.turns[0]!.intermediates).toHaveLength(1);
  expect(store.turns[0]!.intermediates[0]!.id).toBe("a1");
  expect(store.turns[0]!.summary!.id).toBe("a2");
});
```

All `store.turns[0]!.messages[0]!.parts` → `store.turns[0]!.summary!.parts` (when single message).

`loadIntermediates` test:

```typescript
actions.loadIntermediates("t1", [makeAssistantMsg("int1"), makeAssistantMsg("int2")]);
expect(store.turns[0]!.intermediates).toHaveLength(2);
expect(store.turns[0]!.intermediates[0]!.id).toBe("int1");
expect(store.turns[0]!.summary!.id).toBe("sum");
```

`evictIntermediates` test:

```typescript
// Turn data: intermediates: [int1, int2], summary
actions.evictIntermediates("t1");
expect(store.turns[0]!.intermediates).toEqual([]);
expect(store.turns[0]!.summary!.id).toBe("sum");
```

`loadTurns` test: update Turn literal to use new fields.

**Step 2: Update remaining test files mechanically**

Apply the same pattern to every file listed above.

**Step 3: Run all store tests**

Run: `vp run desktop#test -- turn-store && vp run desktop#test -- message-handlers && vp run desktop#test -- compaction-handlers && vp run desktop#test -- om-handlers && vp run desktop#test -- tool-handlers && vp run desktop#test -- hydrate && vp run desktop#test -- ws-client && vp run desktop#test -- actions.test`
Expected: All pass

**Step 4: Run full test suite**

Run: `vp run desktop#test`
Expected: Only view-layer failures remain (session-turn.tsx) — fixed in Task 6.

**Step 5: Commit**

```bash
git add -A
git commit -m "test: update all store tests for intermediates + summary model"
```

---

## PHASE 2: View Layer Adaptation

### Task 6: Update session-turn.tsx + estimate-turn-height.ts

**Files:**

- Modify: `apps/desktop/src/components/chat-area/timeline/session-turn.tsx`
- Modify: `apps/desktop/src/components/chat-area/timeline/estimate-turn-height.ts`

**Step 1: Update session-turn.tsx**

Replace all `turn().messages` references:

- `turn().messages.length` → `turn().intermediates.length + (turn().summary ? 1 : 0)` (or compute once)
- `intermediateMessages()` memo → `() => turn().intermediates`
- `summaryMessage()` memo → `() => turn().summary`
- `canCollapse` → `t.intermediates.length > 0 || t.intermediateCount > 0`
- Remove `thinkingParts()` memo and its uses (timeline handles thinking)
- Remove `MessageContent()` function — timeline replaces it

For now (before timeline is wired), keep the rendering working with a minimal adaptation:

```typescript
// Replace MessageContent with direct rendering of summary/intermediates
const allMessages = createMemo(() => {
  const t = turn();
  return [...t.intermediates, ...(t.summary ? [t.summary] : [])];
});

const canCollapse = createMemo(() => {
  const t = turn();
  if (t.endedAt === null || t.error) return false;
  return t.intermediates.length > 0 || t.intermediateCount > 0;
});
```

The streaming branch:

```tsx
<Show when={!canCollapse() && (turn().summary || turn().intermediates.length > 0)}>
  <div class="flex flex-col gap-3 px-3 [overflow-anchor:none]" data-slot="session-turn-stream">
    <Show when={turn().error && !turn().working}>
      <div class="rounded-lg bg-destructive/10 p-3 text-destructive text-sm">{turn().error}</div>
    </Show>
    <For each={allMessages()}>{(msg) => MessageContent(msg)}</For>
  </div>
</Show>
```

Keep `MessageContent` as-is for now — it still renders parts via the registry. This is a temporary state; Task 13 replaces it with the timeline.

The collapsed branch:

```tsx
<Show when={canCollapse()}>
  <div class="grid ..." style={{...}}>
    <div class="min-h-0 overflow-hidden">
      <div class="flex flex-col gap-3 px-3 py-2 opacity-50 [overflow-anchor:none]">
        <For each={turn().intermediates}>{(msg) => MessageContent(msg, false)}</For>
      </div>
    </div>
  </div>

  <Show when={turn().summary}>
    {(summary) => (
      <div class="flex flex-col gap-3 px-3 [overflow-anchor:none]" data-slot="session-turn-stream">
        {MessageContent(summary(), true)}
      </div>
    )}
  </Show>
</Show>
```

Also update the log statements that reference `turn().messages.length`:

```typescript
msgCount: turn().intermediates.length + (turn().summary ? 1 : 0),
```

And the height-change effect:

```typescript
createEffect(
  on(
    () => [turn().intermediates.length, turn().summary?.id] as const,
    () => props.onHeightChanged?.(),
  ),
);
```

**Step 2: Update estimate-turn-height.ts**

Replace `turn.messages` with combined list:

```typescript
function estimateAssistantBlockHeight(turn: Turn, contentWidth: number): number {
  const allMessages = [...turn.intermediates, ...(turn.summary ? [turn.summary] : [])];
  if (allMessages.length === 0) {
    return turn.working ? WAITING_HEIGHT : 0;
  }
  // ... rest unchanged, iterate allMessages instead of turn.messages
}
```

**Step 3: Run tests**

Run: `vp run desktop#test`
Expected: All pass (or only pre-existing failures)

**Step 4: Commit**

```bash
git add apps/desktop/src/components/chat-area/timeline/session-turn.tsx \
  apps/desktop/src/components/chat-area/timeline/estimate-turn-height.ts
git commit -m "refactor: adapt session-turn + estimate-height for intermediates + summary"
```

---

### Task 7: Add flatten helper to thinking-helpers.ts

**Files:**

- Modify: `apps/desktop/src/components/chat-area/timeline/thinking-helpers.ts`
- Modify: `apps/desktop/src/components/chat-area/timeline/__tests__/thinking-helpers.test.ts`

**Step 1: Write the failing test**

```typescript
describe("flattenParts", () => {
  it("flattens all parts from multiple messages in order", () => {
    const msgs = [msg([thinking("a"), text("b")]), msg([toolCall()])];
    const result = flattenParts(msgs);
    expect(result).toHaveLength(3);
    expect(result.map((p) => p.type)).toEqual(["thinking", "text", "tool_call"]);
  });

  it("returns empty for empty input", () => {
    expect(flattenParts([])).toEqual([]);
  });
});
```

**Step 2: Implement**

```typescript
/** Flatten all parts from all messages into a single ordered array. */
export function flattenParts(messages: UIMessage[]): MessagePart[] {
  return messages.flatMap((msg) => msg.parts);
}
```

**Step 3: Run test, commit**

```bash
vp run desktop#test -- thinking-helpers
git add apps/desktop/src/components/chat-area/timeline/thinking-helpers.ts \
  apps/desktop/src/components/chat-area/timeline/__tests__/thinking-helpers.test.ts
git commit -m "feat: add flattenParts helper"
```

---

## PHASE 3: Timeline Components

### Task 8: Timeline Grouping Logic

**Files:**

- Create: `apps/desktop/src/components/chat-area/timeline/timeline-grouping.ts`
- Test: `apps/desktop/src/components/chat-area/timeline/__tests__/timeline-grouping.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vite-plus/test";
import type { MessagePart } from "~/stores/types.ts";
import { groupTimelineParts } from "../timeline-grouping.ts";

const read = (id: string, file: string): MessagePart => ({
  input: { file_path: file },
  status: "done",
  toolCallId: id,
  toolName: "read",
  type: "tool_call",
});
const grep = (id: string): MessagePart => ({
  input: { pattern: "foo" },
  status: "done",
  toolCallId: id,
  toolName: "grep",
  type: "tool_call",
});
const edit = (id: string): MessagePart => ({
  input: { file_path: "a.ts" },
  status: "done",
  toolCallId: id,
  toolName: "edit",
  type: "tool_call",
});
const bash = (id: string): MessagePart => ({
  input: { command: "npm test" },
  status: "done",
  toolCallId: id,
  toolName: "bash",
  type: "tool_call",
});
const text = (t: string): MessagePart => ({ type: "text", text: t });
const thinking = (t: string): MessagePart => ({ type: "thinking", text: t });

describe("groupTimelineParts", () => {
  it("returns single items for non-explore parts", () => {
    const result = groupTimelineParts([text("hello"), bash("b1"), thinking("hmm")]);
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.kind === "single")).toBe(true);
  });

  it("groups 2+ consecutive explore tools", () => {
    const result = groupTimelineParts([read("r1", "a.ts"), read("r2", "b.ts"), read("r3", "c.ts")]);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("explore");
  });

  it("single explore tool stays as single item", () => {
    const result = groupTimelineParts([read("r1", "a.ts")]);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("single");
  });

  it("non-explore tool breaks the group", () => {
    const result = groupTimelineParts([
      read("r1", "a.ts"),
      read("r2", "b.ts"),
      edit("e1"),
      read("r3", "c.ts"),
      read("r4", "d.ts"),
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]?.kind).toBe("explore");
    expect(result[1]?.kind).toBe("single");
    expect(result[2]?.kind).toBe("explore");
  });

  it("groups mixed explore tools (read + grep + glob)", () => {
    const result = groupTimelineParts([
      read("r1", "a.ts"),
      grep("g1"),
      {
        input: { pattern: "*.ts" },
        status: "done" as const,
        toolCallId: "gl1",
        toolName: "glob",
        type: "tool_call" as const,
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("explore");
  });

  it("text between explore tools breaks the group", () => {
    const result = groupTimelineParts([
      read("r1", "a.ts"),
      read("r2", "b.ts"),
      text("check"),
      read("r3", "c.ts"),
    ]);
    expect(result).toHaveLength(3);
  });

  it("handles empty input", () => {
    expect(groupTimelineParts([])).toEqual([]);
  });

  it("handles aliased tool names (file_read → read)", () => {
    const result = groupTimelineParts([
      {
        input: {},
        status: "done" as const,
        toolCallId: "1",
        toolName: "file_read",
        type: "tool_call" as const,
      },
      {
        input: {},
        status: "done" as const,
        toolCallId: "2",
        toolName: "view_file",
        type: "tool_call" as const,
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("explore");
  });
});
```

**Step 2: Implement**

```typescript
// apps/desktop/src/components/chat-area/timeline/timeline-grouping.ts
import type { MessagePart } from "~/stores/types.ts";
import { normalizeToolName } from "../tools/tool-name.ts";

export type ToolCallPart = Extract<MessagePart, { type: "tool_call" }>;

const EXPLORE_TOOLS = new Set(["read", "grep", "glob", "find", "ls"]);

function isExploreTool(part: MessagePart): boolean {
  if (part.type !== "tool_call") return false;
  return EXPLORE_TOOLS.has(normalizeToolName(part.toolName));
}

export type TimelineItem =
  | { kind: "single"; part: MessagePart }
  | { kind: "explore"; parts: ToolCallPart[] };

export function groupTimelineParts(parts: MessagePart[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let i = 0;

  while (i < parts.length) {
    if (isExploreTool(parts[i]!)) {
      const group: ToolCallPart[] = [];
      while (i < parts.length && isExploreTool(parts[i]!)) {
        group.push(parts[i] as ToolCallPart);
        i++;
      }
      if (group.length >= 2) {
        items.push({ kind: "explore", parts: group });
      } else {
        items.push({ kind: "single", part: group[0]! });
      }
    } else {
      items.push({ kind: "single", part: parts[i]! });
      i++;
    }
  }

  return items;
}
```

**Step 3: Run test, commit**

```bash
vp run desktop#test -- timeline-grouping
git add apps/desktop/src/components/chat-area/timeline/timeline-grouping.ts \
  apps/desktop/src/components/chat-area/timeline/__tests__/timeline-grouping.test.ts
git commit -m "feat: add timeline grouping logic for explore tools"
```

---

### Task 9: TimelineStep Component

**Files:**

- Create: `apps/desktop/src/components/chat-area/timeline/timeline-step.tsx`
- Test: `apps/desktop/src/components/chat-area/timeline/__tests__/timeline-step.test.tsx`

**Step 1: Write failing test**

```tsx
import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vite-plus/test";
import { TimelineStep } from "../timeline-step.tsx";

describe("TimelineStep", () => {
  it("renders icon and children", () => {
    const { getByText, container } = render(() => (
      <TimelineStep icon={<span data-testid="icon" />} isLast={false}>
        <span>Content</span>
      </TimelineStep>
    ));
    expect(getByText("Content")).toBeTruthy();
    expect(container.querySelector("[data-testid='icon']")).toBeTruthy();
  });

  it("renders connector line when not last", () => {
    const { container } = render(() => (
      <TimelineStep icon={<span />} isLast={false}>
        <span>X</span>
      </TimelineStep>
    ));
    expect(container.querySelector("[data-slot='timeline-connector']")).not.toBeNull();
  });

  it("does NOT render connector line when last", () => {
    const { container } = render(() => (
      <TimelineStep icon={<span />} isLast={true}>
        <span>X</span>
      </TimelineStep>
    ));
    expect(container.querySelector("[data-slot='timeline-connector']")).toBeNull();
  });
});
```

**Step 2: Implement**

```tsx
// apps/desktop/src/components/chat-area/timeline/timeline-step.tsx
import { type Component, type JSX, Show } from "solid-js";
import { cn } from "~/lib/utils";

export interface TimelineStepProps {
  class?: string;
  icon: JSX.Element;
  isLast: boolean;
  children: JSX.Element;
}

export const TimelineStep: Component<TimelineStepProps> = (props) => {
  return (
    <div class={cn("flex gap-2 text-sm", props.class)} data-component="timeline-step">
      <div class="relative flex flex-col items-center">
        <div class="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
          {props.icon}
        </div>
        <Show when={!props.isLast}>
          <div class="w-px flex-1 bg-border" data-slot="timeline-connector" />
        </Show>
      </div>
      <div class="min-w-0 flex-1 pb-3">{props.children}</div>
    </div>
  );
};
```

**Step 3: Run test, commit**

```bash
vp run desktop#test -- timeline-step
git add apps/desktop/src/components/chat-area/timeline/timeline-step.tsx \
  apps/desktop/src/components/chat-area/timeline/__tests__/timeline-step.test.tsx
git commit -m "feat: add TimelineStep component"
```

---

### Task 10: CollapsibleStep Component

**Files:**

- Create: `apps/desktop/src/components/chat-area/timeline/collapsible-step.tsx`
- Test: `apps/desktop/src/components/chat-area/timeline/__tests__/collapsible-step.test.tsx`

**Step 1: Write failing test**

```tsx
import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vite-plus/test";
import { CollapsibleStep } from "../collapsible-step.tsx";

describe("CollapsibleStep", () => {
  it("renders label text", () => {
    render(() => (
      <CollapsibleStep expanded={false} label="Thought for 3s" onToggle={() => {}}>
        <span>C</span>
      </CollapsibleStep>
    ));
    expect(document.body.textContent).toContain("Thought for 3s");
  });

  it("content collapsed (0fr) when expanded=false", () => {
    const { container } = render(() => (
      <CollapsibleStep expanded={false} label="T" onToggle={() => {}}>
        <span>C</span>
      </CollapsibleStep>
    ));
    const content = container.querySelector("[data-slot='collapsible-content']") as HTMLElement;
    expect(content.style.getPropertyValue("grid-template-rows")).toBe("0fr");
  });

  it("content expanded (1fr) when expanded=true", () => {
    const { container } = render(() => (
      <CollapsibleStep expanded={true} label="T" onToggle={() => {}}>
        <span>C</span>
      </CollapsibleStep>
    ));
    const content = container.querySelector("[data-slot='collapsible-content']") as HTMLElement;
    expect(content.style.getPropertyValue("grid-template-rows")).toBe("1fr");
  });

  it("calls onToggle on click", () => {
    let toggled = false;
    const { container } = render(() => (
      <CollapsibleStep
        expanded={false}
        label="T"
        onToggle={() => {
          toggled = true;
        }}
      >
        <span>C</span>
      </CollapsibleStep>
    ));
    (container.querySelector("[data-slot='collapsible-trigger']") as HTMLElement).click();
    expect(toggled).toBe(true);
  });

  it("chevron rotates when expanded", () => {
    const { container } = render(() => (
      <CollapsibleStep expanded={true} label="T" onToggle={() => {}}>
        <span>C</span>
      </CollapsibleStep>
    ));
    const chevron = container.querySelector("[data-slot='collapsible-chevron']") as HTMLElement;
    expect(chevron.classList.contains("rotate-90")).toBe(true);
  });
});
```

**Step 2: Implement**

```tsx
// apps/desktop/src/components/chat-area/timeline/collapsible-step.tsx
import { TbOutlineChevronRight } from "solid-icons/tb";
import { type Component, type JSX, Show } from "solid-js";

export interface CollapsibleStepProps {
  expanded: boolean;
  label: JSX.Element;
  onToggle: () => void;
  children: JSX.Element;
}

export const CollapsibleStep: Component<CollapsibleStepProps> = (props) => {
  return (
    <div data-component="collapsible-step">
      <button
        class="flex cursor-pointer items-center gap-1 py-1 text-left text-muted-foreground"
        data-slot="collapsible-trigger"
        onClick={props.onToggle}
        type="button"
      >
        <span class="flex-1">{props.label}</span>
        <TbOutlineChevronRight
          class="h-3 w-3 shrink-0 transition-transform duration-200"
          classList={{ "rotate-90": props.expanded, "rotate-0": !props.expanded }}
          data-slot="collapsible-chevron"
        />
      </button>
      <div
        class="grid transition-[grid-template-rows] duration-200 ease-in-out"
        data-slot="collapsible-content"
        style={{ "grid-template-rows": props.expanded ? "1fr" : "0fr" }}
      >
        <div class="min-h-0 overflow-hidden">
          <Show when={props.expanded}>{props.children}</Show>
        </div>
      </div>
    </div>
  );
};
```

**Step 3: Run test, commit**

```bash
vp run desktop#test -- collapsible-step
git add apps/desktop/src/components/chat-area/timeline/collapsible-step.tsx \
  apps/desktop/src/components/chat-area/timeline/__tests__/collapsible-step.test.tsx
git commit -m "feat: add CollapsibleStep component"
```

---

### Task 11: ThinkingStep Component

**Files:**

- Create: `apps/desktop/src/components/chat-area/timeline/thinking-step.tsx`
- Test: `apps/desktop/src/components/chat-area/timeline/__tests__/thinking-step.test.tsx`

**Step 1: Write failing test**

```tsx
import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vite-plus/test";
import type { ThinkingMessagePart } from "../thinking-helpers.ts";
import { ThinkingStep } from "../thinking-step.tsx";

const thoughtForRegex = /Thought for \d+s/;

function renderThinking(
  part: ThinkingMessagePart,
  opts: { isStreaming?: boolean; isLast?: boolean } = {},
) {
  return render(() => (
    <ThinkingStep
      isLast={opts.isLast ?? false}
      isStreaming={opts.isStreaming ?? false}
      part={part}
    />
  ));
}

describe("ThinkingStep", () => {
  it("renders 'Thinking...' while streaming and last item", () => {
    renderThinking(
      { type: "thinking", text: "Let me think", startedAt: Date.now() },
      { isStreaming: true, isLast: true },
    );
    expect(screen.getByText("Thinking...")).toBeTruthy();
  });

  it("renders 'Thought for Xs' when endedAt set", () => {
    renderThinking({
      type: "thinking",
      text: "hmm",
      startedAt: Date.now() - 5000,
      endedAt: Date.now(),
    });
    expect(screen.getByText(thoughtForRegex)).toBeTruthy();
  });

  it("expanded when streaming + last item", () => {
    const { container } = renderThinking(
      { type: "thinking", text: "thinking", startedAt: Date.now() },
      { isStreaming: true, isLast: true },
    );
    const content = container.querySelector("[data-slot='collapsible-content']") as HTMLElement;
    expect(content.style.getPropertyValue("grid-template-rows")).toBe("1fr");
  });

  it("collapsed when not streaming", () => {
    const { container } = renderThinking({
      type: "thinking",
      text: "hmm",
      startedAt: 1,
      endedAt: 2,
    });
    const content = container.querySelector("[data-slot='collapsible-content']") as HTMLElement;
    expect(content.style.getPropertyValue("grid-template-rows")).toBe("0fr");
  });

  it("collapsed when streaming but NOT last item", () => {
    const { container } = renderThinking(
      { type: "thinking", text: "hmm", startedAt: Date.now() },
      { isStreaming: true, isLast: false },
    );
    const content = container.querySelector("[data-slot='collapsible-content']") as HTMLElement;
    expect(content.style.getPropertyValue("grid-template-rows")).toBe("0fr");
  });

  it("toggles on click", () => {
    const { container } = renderThinking({ type: "thinking", text: "deep" });
    const trigger = container.querySelector("[data-slot='collapsible-trigger']") as HTMLElement;
    const content = () =>
      container.querySelector("[data-slot='collapsible-content']") as HTMLElement;
    expect(content().style.getPropertyValue("grid-template-rows")).toBe("0fr");
    trigger.click();
    expect(content().style.getPropertyValue("grid-template-rows")).toBe("1fr");
  });
});
```

**Step 2: Implement**

```tsx
// apps/desktop/src/components/chat-area/timeline/thinking-step.tsx
import { TbOutlineBrain } from "solid-icons/tb";
import { type Component, createMemo, createSignal } from "solid-js";
import { formatDuration } from "~/lib/format-duration";
import { Markdown } from "~/components/ui/markdown";
import { CollapsibleStep } from "./collapsible-step.tsx";
import type { ThinkingMessagePart } from "./thinking-helpers.ts";
import { TimelineStep } from "./timeline-step.tsx";

export interface ThinkingStepProps {
  isLast: boolean;
  isStreaming: boolean;
  part: ThinkingMessagePart;
}

export const ThinkingStep: Component<ThinkingStepProps> = (props) => {
  const isActive = createMemo(
    () =>
      props.part.startedAt !== undefined &&
      props.part.endedAt === undefined &&
      props.isStreaming === true,
  );

  const label = createMemo(() => {
    if (isActive()) return "Thinking...";
    const { startedAt, endedAt } = props.part;
    if (startedAt !== undefined && endedAt !== undefined) {
      return `Thought for ${formatDuration(endedAt - startedAt)}`;
    }
    return "Thought";
  });

  const [userToggled, setUserToggled] = createSignal<boolean | null>(null);
  const expanded = createMemo(() => {
    if (userToggled() !== null) return userToggled()!;
    return props.isStreaming && props.isLast;
  });

  return (
    <TimelineStep
      icon={<TbOutlineBrain class="h-4 w-4" classList={{ "animate-pulse": isActive() }} />}
      isLast={props.isLast}
    >
      <CollapsibleStep
        expanded={expanded()}
        label={<span classList={{ "animate-shimmer text-shimmer": isActive() }}>{label()}</span>}
        onToggle={() => setUserToggled(!expanded())}
      >
        <div class="max-h-[200px] overflow-y-auto py-1 italic leading-relaxed text-muted-foreground">
          <Markdown class="prose-p:m-0 text-sm" isStreaming={isActive()} text={props.part.text} />
        </div>
      </CollapsibleStep>
    </TimelineStep>
  );
};
```

**Step 3: Run test, commit**

```bash
vp run desktop#test -- thinking-step
git add apps/desktop/src/components/chat-area/timeline/thinking-step.tsx \
  apps/desktop/src/components/chat-area/timeline/__tests__/thinking-step.test.tsx
git commit -m "feat: add ThinkingStep component"
```

---

### Task 12: ToolSummaryRow `showIcon` Prop

**Files:**

- Modify: `apps/desktop/src/components/chat-area/tools/tool-summary-row.tsx`
- Create: `apps/desktop/src/components/chat-area/tools/__tests__/tool-summary-row.test.tsx`

**Step 1: Write failing test**

```tsx
import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vite-plus/test";
import { ToolSummaryRow } from "../tool-summary-row.tsx";

describe("ToolSummaryRow showIcon", () => {
  it("renders icon by default", () => {
    const { container } = render(() => (
      <ToolSummaryRow icon="file" status="completed" summary="Read file.ts" />
    ));
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("hides icon when showIcon=false", () => {
    const { container } = render(() => (
      <ToolSummaryRow icon="file" showIcon={false} status="completed" summary="Read file.ts" />
    ));
    expect(container.querySelector("svg")).toBeNull();
  });
});
```

**Step 2: Add `showIcon` prop**

In `ToolSummaryRowProps`, add `showIcon?: boolean`. In the component, wrap icon:

```tsx
<Show when={props.showIcon !== false}>
  <ToolIcon_ icon={props.icon} />
</Show>
```

Add `Show` to imports from `solid-js` if not already there.

**Step 3: Run test, commit**

```bash
vp run desktop#test -- tool-summary-row
git add apps/desktop/src/components/chat-area/tools/tool-summary-row.tsx \
  apps/desktop/src/components/chat-area/tools/__tests__/tool-summary-row.test.tsx
git commit -m "feat: add showIcon prop to ToolSummaryRow"
```

---

### Task 13: ExploreStep Component

**Files:**

- Create: `apps/desktop/src/components/chat-area/timeline/explore-step.tsx`
- Test: `apps/desktop/src/components/chat-area/timeline/__tests__/explore-step.test.tsx`

**Step 1: Write failing test**

```tsx
import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vite-plus/test";
import type { ToolCallPart } from "../timeline-grouping.ts";
import { ExploreStep } from "../explore-step.tsx";

const makeRead = (id: string, file: string): ToolCallPart => ({
  input: { file_path: file },
  status: "done",
  toolCallId: id,
  toolName: "read",
  type: "tool_call",
});

describe("ExploreStep", () => {
  it("renders 'Explored N files' label", () => {
    render(() => (
      <ExploreStep
        isLast={false}
        isStreaming={false}
        parts={[makeRead("r1", "a.ts"), makeRead("r2", "b.ts"), makeRead("r3", "c.ts")]}
      />
    ));
    expect(screen.getByText(/Explored 3 files/)).toBeTruthy();
  });

  it("expanded when streaming + last item", () => {
    const { container } = render(() => (
      <ExploreStep
        isLast={true}
        isStreaming={true}
        parts={[makeRead("r1", "a"), makeRead("r2", "b")]}
      />
    ));
    const content = container.querySelector("[data-slot='collapsible-content']") as HTMLElement;
    expect(content.style.getPropertyValue("grid-template-rows")).toBe("1fr");
  });

  it("collapsed when not streaming", () => {
    const { container } = render(() => (
      <ExploreStep
        isLast={true}
        isStreaming={false}
        parts={[makeRead("r1", "a"), makeRead("r2", "b")]}
      />
    ));
    const content = container.querySelector("[data-slot='collapsible-content']") as HTMLElement;
    expect(content.style.getPropertyValue("grid-template-rows")).toBe("0fr");
  });

  it("collapsed when streaming but NOT last", () => {
    const { container } = render(() => (
      <ExploreStep
        isLast={false}
        isStreaming={true}
        parts={[makeRead("r1", "a"), makeRead("r2", "b")]}
      />
    ));
    const content = container.querySelector("[data-slot='collapsible-content']") as HTMLElement;
    expect(content.style.getPropertyValue("grid-template-rows")).toBe("0fr");
  });

  it("toggles on click", () => {
    const { container } = render(() => (
      <ExploreStep
        isLast={false}
        isStreaming={false}
        parts={[makeRead("r1", "a"), makeRead("r2", "b")]}
      />
    ));
    const trigger = container.querySelector("[data-slot='collapsible-trigger']") as HTMLElement;
    const content = () =>
      container.querySelector("[data-slot='collapsible-content']") as HTMLElement;
    expect(content().style.getPropertyValue("grid-template-rows")).toBe("0fr");
    trigger.click();
    expect(content().style.getPropertyValue("grid-template-rows")).toBe("1fr");
  });

  it("renders sub-item summaries when expanded", () => {
    const { container } = render(() => (
      <ExploreStep
        isLast={false}
        isStreaming={false}
        parts={[makeRead("r1", "button.tsx"), makeRead("r2", "card.tsx")]}
      />
    ));
    (container.querySelector("[data-slot='collapsible-trigger']") as HTMLElement).click();
    expect(container.querySelectorAll("[data-component='tool-summary-row']").length).toBe(2);
  });
});
```

**Step 2: Implement**

```tsx
// apps/desktop/src/components/chat-area/timeline/explore-step.tsx
import { TbOutlineSearch } from "solid-icons/tb";
import { type Component, createMemo, createSignal, For } from "solid-js";
import { normalizeToolName } from "../tools/tool-name.ts";
import {
  formatReadSummary,
  formatGrepSummary,
  formatGlobSummary,
  formatFindSummary,
  formatLsSummary,
  formatGenericToolSummary,
} from "../tools/tool-summary-formatters.ts";
import { ToolSummaryRow } from "../tools/tool-summary-row.tsx";
import type { ToolCallPart } from "./timeline-grouping.ts";
import { CollapsibleStep } from "./collapsible-step.tsx";
import { TimelineStep } from "./timeline-step.tsx";

export interface ExploreStepProps {
  isLast: boolean;
  isStreaming: boolean;
  parts: ToolCallPart[];
}

const TOOL_ICON_MAP = {
  read: "file" as const,
  grep: "search" as const,
  glob: "folder" as const,
  find: "folder" as const,
  ls: "folder" as const,
};

function formatExploreSummary(part: ToolCallPart): string {
  const name = normalizeToolName(part.toolName);
  const input =
    part.input && typeof part.input === "object" ? (part.input as Record<string, unknown>) : {};
  const toolPart = { tool: name, args: input, output: part.result };
  switch (name) {
    case "read":
      return formatReadSummary(toolPart);
    case "grep":
      return formatGrepSummary(toolPart);
    case "glob":
      return formatGlobSummary(toolPart);
    case "find":
      return formatFindSummary(toolPart);
    case "ls":
      return formatLsSummary(toolPart);
    default:
      return formatGenericToolSummary(toolPart);
  }
}

export const ExploreStep: Component<ExploreStepProps> = (props) => {
  const label = createMemo(() => `Explored ${props.parts.length} files`);

  const [userToggled, setUserToggled] = createSignal<boolean | null>(null);
  const expanded = createMemo(() => {
    if (userToggled() !== null) return userToggled()!;
    return props.isStreaming && props.isLast;
  });

  return (
    <TimelineStep icon={<TbOutlineSearch class="h-4 w-4" />} isLast={props.isLast}>
      <CollapsibleStep
        expanded={expanded()}
        label={label()}
        onToggle={() => setUserToggled(!expanded())}
      >
        <div class="flex flex-col">
          <For each={props.parts}>
            {(part) => {
              const name = normalizeToolName(part.toolName);
              const icon = TOOL_ICON_MAP[name as keyof typeof TOOL_ICON_MAP] ?? "file";
              return (
                <ToolSummaryRow
                  icon={icon}
                  status={part.status === "running" ? "running" : "completed"}
                  summary={formatExploreSummary(part)}
                />
              );
            }}
          </For>
        </div>
      </CollapsibleStep>
    </TimelineStep>
  );
};
```

**Step 3: Run test, commit**

```bash
vp run desktop#test -- explore-step
git add apps/desktop/src/components/chat-area/timeline/explore-step.tsx \
  apps/desktop/src/components/chat-area/timeline/__tests__/explore-step.test.tsx
git commit -m "feat: add ExploreStep component with auto-collapse"
```

---

### Task 14: TimelineRenderer Component

**Files:**

- Create: `apps/desktop/src/components/chat-area/timeline/timeline-renderer.tsx`
- Test: `apps/desktop/src/components/chat-area/timeline/__tests__/timeline-renderer.test.tsx`

**Step 1: Write failing test**

```tsx
import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vite-plus/test";
import type { MessagePart } from "~/stores/types.ts";
import { TimelineRenderer } from "../timeline-renderer.tsx";

const thinking = (text: string): MessagePart => ({ type: "thinking", text });
const read = (id: string, file: string): MessagePart => ({
  input: { file_path: file },
  status: "done",
  toolCallId: id,
  toolName: "read",
  type: "tool_call",
});
const edit = (id: string): MessagePart => ({
  input: { file_path: "a.ts" },
  status: "done",
  toolCallId: id,
  toolName: "edit",
  type: "tool_call",
});
const text = (t: string): MessagePart => ({ type: "text", text: t });

describe("TimelineRenderer", () => {
  it("renders thinking steps", () => {
    const { container } = render(() => (
      <TimelineRenderer isStreaming={false} parts={[thinking("hmm")]} />
    ));
    expect(container.querySelector("[data-component='timeline-step']")).not.toBeNull();
  });

  it("renders explore group for consecutive reads", () => {
    const { container } = render(() => (
      <TimelineRenderer isStreaming={false} parts={[read("r1", "a.ts"), read("r2", "b.ts")]} />
    ));
    expect(container.querySelector("[data-component='collapsible-step']")).not.toBeNull();
    expect(container.textContent).toContain("Explored 2 files");
  });

  it("renders tool steps for non-explore tools", () => {
    const { container } = render(() => (
      <TimelineRenderer isStreaming={false} parts={[edit("e1")]} />
    ));
    expect(container.querySelector("[data-component='tool-summary-row']")).not.toBeNull();
  });

  it("renders connector lines on all but last step", () => {
    const { container } = render(() => (
      <TimelineRenderer isStreaming={false} parts={[thinking("a"), thinking("b"), thinking("c")]} />
    ));
    expect(container.querySelectorAll("[data-slot='timeline-connector']")).toHaveLength(2);
  });

  it("renders nothing for empty parts", () => {
    const { container } = render(() => <TimelineRenderer isStreaming={false} parts={[]} />);
    expect(container.querySelector("[data-component='timeline-step']")).toBeNull();
  });

  it("skips empty text/thinking parts", () => {
    const { container } = render(() => (
      <TimelineRenderer isStreaming={false} parts={[text("   "), thinking("  ")]} />
    ));
    expect(container.querySelector("[data-component='timeline-step']")).toBeNull();
  });
});
```

**Step 2: Implement**

```tsx
// apps/desktop/src/components/chat-area/timeline/timeline-renderer.tsx
import { FiCircle, FiFileText, FiFolder, FiSearch, FiTerminal } from "solid-icons/fi";
import { type Component, For, Match, Switch } from "solid-js";
import { cn } from "~/lib/utils";
import type { MessagePart } from "~/stores/types.ts";
import { Markdown } from "~/components/ui/markdown";
import { normalizeToolName } from "../tools/tool-name.ts";
import {
  formatBashSummary,
  formatEditSummary,
  formatFindSummary,
  formatGenericToolSummary,
  formatGlobSummary,
  formatGrepSummary,
  formatLsSummary,
  formatReadSummary,
  formatTaskCreateSummary,
  formatTaskUpdateSummary,
  formatVscodeDiagnosticsSummary,
  formatWebfetchSummary,
  formatWriteSummary,
} from "../tools/tool-summary-formatters.ts";
import { ToolSummaryRow } from "../tools/tool-summary-row.tsx";
import { ExploreStep } from "./explore-step.tsx";
import type { ThinkingMessagePart } from "./thinking-helpers.ts";
import { ThinkingStep } from "./thinking-step.tsx";
import { groupTimelineParts, type TimelineItem, type ToolCallPart } from "./timeline-grouping.ts";
import { TimelineStep } from "./timeline-step.tsx";

export interface TimelineRendererProps {
  class?: string;
  isStreaming: boolean;
  parts: MessagePart[];
}

type ToolIcon = "file" | "folder" | "terminal" | "search";
const TOOL_ICON_MAP: Record<string, ToolIcon> = {
  bash: "terminal",
  edit: "file",
  find: "folder",
  glob: "folder",
  grep: "search",
  ls: "folder",
  read: "file",
  write: "file",
};

function ToolIconCmp({ icon }: { icon: ToolIcon }) {
  switch (icon) {
    case "file":
      return <FiFileText class="h-4 w-4" />;
    case "folder":
      return <FiFolder class="h-4 w-4" />;
    case "terminal":
      return <FiTerminal class="h-4 w-4" />;
    case "search":
      return <FiSearch class="h-4 w-4" />;
  }
}

function formatToolSummary(part: ToolCallPart): string {
  const name = normalizeToolName(part.toolName);
  const input =
    part.input && typeof part.input === "object" ? (part.input as Record<string, unknown>) : {};
  const toolPart = { tool: name, args: input, output: part.result };
  switch (name) {
    case "read":
      return formatReadSummary(toolPart);
    case "write":
      return formatWriteSummary(toolPart);
    case "edit":
      return formatEditSummary(toolPart);
    case "bash":
      return formatBashSummary(toolPart);
    case "find":
      return formatFindSummary(toolPart);
    case "glob":
      return formatGlobSummary(toolPart);
    case "grep":
      return formatGrepSummary(toolPart);
    case "TaskCreate":
      return formatTaskCreateSummary(toolPart);
    case "TaskUpdate":
      return formatTaskUpdateSummary(toolPart);
    case "webfetch":
      return formatWebfetchSummary(toolPart);
    case "vscode_get_diagnostics":
      return formatVscodeDiagnosticsSummary(toolPart);
    default:
      return formatGenericToolSummary(toolPart);
  }
}

function TimelineItemView(props: { item: TimelineItem; isLast: boolean; isStreaming: boolean }) {
  return (
    <Switch>
      <Match when={props.item.kind === "explore"}>
        <ExploreStep
          isLast={props.isLast}
          isStreaming={props.isStreaming}
          parts={props.item.parts}
        />
      </Match>
      <Match
        when={
          props.item.kind === "single" &&
          props.item.part.type === "thinking" &&
          props.item.part.text.trim() !== ""
        }
      >
        <ThinkingStep
          isLast={props.isLast}
          isStreaming={props.isStreaming}
          part={props.item.part as ThinkingMessagePart}
        />
      </Match>
      <Match when={props.item.kind === "single" && props.item.part.type === "tool_call"}>
        {(() => {
          const part = props.item.part as ToolCallPart;
          const name = normalizeToolName(part.toolName);
          const icon = TOOL_ICON_MAP[name] ?? "file";
          const status =
            part.status === "running" ? "running" : part.status === "error" ? "error" : "completed";
          return (
            <TimelineStep icon={<ToolIconCmp icon={icon} />} isLast={props.isLast}>
              <ToolSummaryRow
                icon={icon}
                showIcon={false}
                status={status}
                summary={formatToolSummary(part)}
              />
            </TimelineStep>
          );
        })()}
      </Match>
      <Match
        when={
          props.item.kind === "single" &&
          props.item.part.type === "text" &&
          props.item.part.text.trim() !== ""
        }
      >
        <TimelineStep
          icon={<FiCircle class="h-2 w-2 text-muted-foreground/40" />}
          isLast={props.isLast}
        >
          <div class="py-1 text-muted-foreground">
            <Markdown isStreaming={false} text={(props.item.part as { text: string }).text} />
          </div>
        </TimelineStep>
      </Match>
    </Switch>
  );
}

export const TimelineRenderer: Component<TimelineRendererProps> = (props) => {
  const items = () => groupTimelineParts(props.parts);
  const isLast = (i: number) => i === items().length - 1;

  return (
    <div class={cn("flex flex-col", props.class)} data-component="timeline-renderer">
      <For each={items()}>
        {(item, index) => (
          <TimelineItemView item={item} isLast={isLast(index())} isStreaming={props.isStreaming} />
        )}
      </For>
    </div>
  );
};
```

**Step 3: Run test, commit**

```bash
vp run desktop#test -- timeline-renderer
git add apps/desktop/src/components/chat-area/timeline/timeline-renderer.tsx \
  apps/desktop/src/components/chat-area/timeline/__tests__/timeline-renderer.test.tsx
git commit -m "feat: add TimelineRenderer component"
```

---

## PHASE 4: Integration

### Task 15: Wire TimelineRenderer into session-turn.tsx

**Files:**

- Modify: `apps/desktop/src/components/chat-area/timeline/session-turn.tsx`

**Step 1: Replace intermediate rendering with TimelineRenderer**

Add imports:

```tsx
import { TimelineRenderer } from "./timeline-renderer.tsx";
import { flattenParts } from "./thinking-helpers.ts";
```

Remove imports for: `ThinkingPart`, `getThinkingParts`, `getNonThinkingParts`, `MessageContent` (if no longer used).

Replace the streaming branch:

```tsx
<Show when={!canCollapse() && (turn().summary || turn().intermediates.length > 0)}>
  <div class="px-3 [overflow-anchor:none]" data-slot="session-turn-stream">
    <Show when={turn().error && !turn().working}>
      <div class="rounded-lg bg-destructive/10 p-3 text-destructive text-sm">{turn().error}</div>
    </Show>
    <TimelineRenderer
      isStreaming={turn().endedAt === null}
      parts={flattenParts([...turn().intermediates, ...(turn().summary ? [turn().summary] : [])])}
    />
  </div>
</Show>
```

Replace the collapsed intermediate area:

```tsx
<div class="min-h-0 overflow-hidden">
  <div class="px-3 py-2 opacity-50 [overflow-anchor:none]">
    <TimelineRenderer isStreaming={false} parts={flattenParts(turn().intermediates)} />
  </div>
</div>
```

Summary stays as a simple `MessageContent` (keep the function for this one use case):

```tsx
<Show when={turn().summary}>
  {(summary) => (
    <div class="flex flex-col gap-3 px-3 [overflow-anchor:none]" data-slot="session-turn-stream">
      {MessageContent(summary(), true)}
    </div>
  )}
</Show>
```

**Step 2: Run all tests**

Run: `vp run desktop#test`
Expected: All pass

**Step 3: Run check**

Run: `vp check --fix`

**Step 4: Commit**

```bash
git add apps/desktop/src/components/chat-area/timeline/session-turn.tsx
git commit -m "feat: wire TimelineRenderer into session-turn for both views"
```

---

### Task 16: Cleanup Old Components

**Files:**

- Delete: `apps/desktop/src/components/chat-area/parts/thinking-part.tsx`
- Delete: `apps/desktop/src/components/chat-area/parts/__tests__/thinking-part.test.tsx`

**Step 1: Verify no remaining imports**

Run: `rg "ThinkingPart" apps/desktop/src/ --glob '!*.test.*'`
Expected: No matches outside `thinking-step.tsx`

**Step 2: Delete files**

```bash
rm apps/desktop/src/components/chat-area/parts/thinking-part.tsx
rm apps/desktop/src/components/chat-area/parts/__tests__/thinking-part.test.tsx
```

**Step 3: Run tests + check**

Run: `vp run desktop#test && vp check --fix`
Expected: All pass

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove old ThinkingPart, replaced by ThinkingStep"
```

---

### Task 17: Final Verification

**Step 1: Full test suite**

Run: `vp run desktop#test`
Expected: All pass

**Step 2: Full check**

Run: `vp check --fix`
Expected: No errors

**Step 3: Manual verification checklist**

Launch the app (`vp run desktop#dev`) and verify:

- [ ] Single message turn (no intermediates): renders normally
- [ ] Turn with thinking: shows "Thought for Xs" with chevron in timeline
- [ ] Multiple reads: shows "Explored N files" collapsed
- [ ] Click "Explored N files": expands to show individual reads
- [ ] During streaming: thinking + explore auto-expanded
- [ ] After edit/bash: previous explore group auto-collapses
- [ ] After turn ends: "Worked for" collapses, all groups collapsed
- [ ] Expand "Worked for": timeline shows with connector lines
- [ ] Summary message visible with footer timestamp
- [ ] No footer timestamps on intermediate messages
- [ ] Multiple agent loop iterations: previous summary demoted to intermediate

---

## Summary

### Files Created (13)

| File                                            | Purpose                                 |
| ----------------------------------------------- | --------------------------------------- |
| `timeline/timeline-grouping.ts`                 | Pure grouping logic                     |
| `timeline/__tests__/timeline-grouping.test.ts`  | Grouping tests                          |
| `timeline/timeline-step.tsx`                    | Icon + connector line wrapper           |
| `timeline/__tests__/timeline-step.test.tsx`     | Step tests                              |
| `timeline/collapsible-step.tsx`                 | Label + chevron + grid-animated content |
| `timeline/__tests__/collapsible-step.test.tsx`  | Collapsible tests                       |
| `timeline/thinking-step.tsx`                    | Thinking rendered in timeline           |
| `timeline/__tests__/thinking-step.test.tsx`     | Thinking step tests                     |
| `timeline/explore-step.tsx`                     | Explore group with auto-collapse        |
| `timeline/__tests__/explore-step.test.tsx`      | Explore step tests                      |
| `timeline/timeline-renderer.tsx`                | Maps TimelineItem[] → step components   |
| `timeline/__tests__/timeline-renderer.test.tsx` | Renderer tests                          |
| `tools/__tests__/tool-summary-row.test.tsx`     | showIcon tests                          |

### Files Modified (15)

| File                                        | Change                                            |
| ------------------------------------------- | ------------------------------------------------- |
| `stores/types.ts`                           | `messages` → `intermediates` + `summary`          |
| `stores/session/session-store.ts`           | MsgLocation, all operations, demotion logic       |
| `stores/session/hydrate-chat.ts`            | Summary field instead of messages array           |
| `stores/session/hydrate-messages.ts`        | Summary/intermediates split                       |
| `stores/session/usage-stats.ts`             | Iterate intermediates + summary                   |
| `stores/session/__tests__/*.test.ts`        | All test files (mechanical access pattern change) |
| `stores/server/__tests__/ws-client.test.ts` | Access pattern change                             |
| `stores/server/__tests__/actions.test.ts`   | Access pattern change                             |
| `timeline/session-turn.tsx`                 | Use intermediates + summary + TimelineRenderer    |
| `timeline/estimate-turn-height.ts`          | Combined intermediates + summary                  |
| `timeline/thinking-helpers.ts`              | Add `flattenParts`                                |
| `tools/tool-summary-row.tsx`                | Add `showIcon` prop                               |

### Files Deleted (2)

| File                                     | Reason                                                  |
| ---------------------------------------- | ------------------------------------------------------- |
| `parts/thinking-part.tsx`                | Replaced by `timeline/thinking-step.tsx`                |
| `parts/__tests__/thinking-part.test.tsx` | Replaced by `timeline/__tests__/thinking-step.test.tsx` |

## Auto-Collapse Logic

Both ThinkingStep and ExploreStep share the same formula:

```typescript
expanded = userToggled ?? (isStreaming && isLastItem);
```

| State                     | Thinking        | Explore         |
| ------------------------- | --------------- | --------------- |
| Streaming + last item     | Expanded        | Expanded        |
| Streaming + NOT last item | Collapsed       | Collapsed       |
| Turn ended                | Collapsed       | Collapsed       |
| User manually toggled     | Respects choice | Respects choice |
