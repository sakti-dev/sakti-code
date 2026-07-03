# Persist Thinking Timing — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make "Thought for 1m 2s" show deterministically on both live streaming AND rehydrated sessions by persisting `startedAt`/`endedAt` on thinking content blocks.

**Architecture:** Three layers touched. (1) Agent-loop tracks `reasoning-delta` → `reasoning-end` timestamps and annotates the `ThinkingContent` block before saving. (2) Client store sets `endedAt` on thinking parts when text arrives during live streaming. (3) Hydration reads persisted timing from content JSON. No DB schema migration — timing rides inside the existing `content` text column as extra JSON fields.

**Tech Stack:** Effect-TS (agent-loop), SolidJS store `produce()` (client), vitest TDD.

---

## Phase 1: Agent Package — Annotate ThinkingContent with Timing

### Task 1: Add optional `startedAt`/`endedAt` to `ThinkingContent`

**Files:**

- Modify: `packages/llm/src/types.ts:164-169`

**Step 1: Write the failing test**

Add to `packages/llm/src/__tests__/types.test.ts`:

```typescript
it("ThinkingContent has optional startedAt and endedAt", () => {
  const block: ThinkingContent = {
    type: "thinking",
    thinking: "reasoning text",
    startedAt: 1000,
    endedAt: 2000,
  };
  expect(block.startedAt).toBe(1000);
  expect(block.endedAt).toBe(2000);
});
```

**Step 2: Run test — verify it fails**

```bash
vp run '@sakti-code/llm#test' -- --reporter=verbose packages/llm/src/__tests__/types.test.ts 2>&1 | tail -10
```

Expected: FAIL — `startedAt` not assignable to `ThinkingContent`.

**Step 3: Implement**

In `packages/llm/src/types.ts`, add optional fields to `ThinkingContent`:

```typescript
export interface ThinkingContent {
  endedAt?: number;
  redacted?: boolean;
  startedAt?: number;
  thinking: string;
  thinkingSignature?: string;
  type: "thinking";
}
```

**Step 4: Run test — verify pass**

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(llm): add optional startedAt/endedAt to ThinkingContent"
```

---

### Task 2: Track thinking timing in agent-loop

**Files:**

- Modify: `packages/agent/src/core/agent-loop.ts:557-566` (accumulator state)
- Modify: `packages/agent/src/core/agent-loop.ts:620-642` (reasoning-delta / reasoning-end handlers)
- Modify: `packages/agent/src/core/agent-loop.ts:696-704` (build final content)
- Test: `packages/agent/src/core/__tests__/agent-loop.test.ts`

**Step 1: Write failing tests**

Add to `packages/agent/src/core/__tests__/agent-loop.test.ts`, near the existing "captures thinkingSignature" test (line ~259):

```typescript
it("annotates thinking content with startedAt and endedAt", async () => {
  const streamFn: StreamFn = () =>
    Promise.resolve({
      fullStream: (async function* () {
        yield { type: "reasoning-delta", id: "r1", text: "thinking…" };
        yield { type: "reasoning-end", id: "r1" };
        yield { type: "text-delta", id: "t1", text: "answer" };
      })(),
      result: Promise.resolve({
        finishReason: "stop" as const,
        usage: createUsage(),
      }),
    });

  const context: AgentContext = {
    systemPrompt: "x",
    messages: [],
    tools: [],
  };
  const config: AgentLoopConfig = {
    model: createModel(),
    convertToLlm: identityConverter,
  };

  const stream = agentLoop([createUserMessage("Hi")], context, config, undefined, streamFn);
  for await (const _event of stream) {
    void _event;
  }
  const messages = await stream.result();
  const assistant = messages[1] as AssistantMessage;
  const thinking = assistant.content.find(
    (c: AssistantMessage["content"][number]) => c.type === "thinking",
  ) as { startedAt?: number; endedAt?: number } | undefined;

  expect(thinking).toBeDefined();
  expect(thinking!.startedAt).toBeTypeOf("number");
  expect(thinking!.endedAt).toBeTypeOf("number");
  expect(thinking!.endedAt!).toBeGreaterThanOrEqual(thinking!.startedAt!);
});

it("thinking endedAt falls back when reasoning-end is absent", async () => {
  const streamFn: StreamFn = () =>
    Promise.resolve({
      fullStream: (async function* () {
        yield { type: "reasoning-delta", id: "r1", text: "thinking…" };
        // No reasoning-end — some providers omit it
        yield { type: "text-delta", id: "t1", text: "answer" };
      })(),
      result: Promise.resolve({
        finishReason: "stop" as const,
        usage: createUsage(),
      }),
    });

  const context: AgentContext = { systemPrompt: "x", messages: [], tools: [] };
  const config: AgentLoopConfig = {
    model: createModel(),
    convertToLlm: identityConverter,
  };

  const stream = agentLoop([createUserMessage("Hi")], context, config, undefined, streamFn);
  for await (const _event of stream) {
    void _event;
  }
  const messages = await stream.result();
  const assistant = messages[1] as AssistantMessage;
  const thinking = assistant.content.find(
    (c: AssistantMessage["content"][number]) => c.type === "thinking",
  ) as { startedAt?: number; endedAt?: number } | undefined;

  expect(thinking).toBeDefined();
  expect(thinking!.startedAt).toBeTypeOf("number");
  expect(thinking!.endedAt).toBeTypeOf("number");
});
```

**Step 2: Run tests — verify they fail**

```bash
vp run '@sakti-code/agent#test' -- --reporter=verbose -t "annotates thinking content" packages/agent/src/core/__tests__/agent-loop.test.ts 2>&1 | tail -15
```

Expected: FAIL — `startedAt` and `endedAt` are `undefined`.

**Step 3: Implement**

In `agent-loop.ts`, add timing accumulators alongside `thinkingBuffer`:

```typescript
// ── Accumulator state ──────────────────────────────────────────────
let textBuffer = "";
let thinkingBuffer = "";
let thinkingStartedAt: number | undefined;
let thinkingEndedAt: number | undefined;
let thinkingSignature: string | undefined;
const toolCallBlocks: ToolCall[] = [];
let messageStarted = false;
```

In the `reasoning-delta` case (line ~620), set `startedAt` on first delta:

```typescript
case "reasoning-delta": {
  yield* ensureMessageStarted();
  if (thinkingStartedAt === undefined) {
    thinkingStartedAt = Date.now();
  }
  const delta = part.text as string;
  thinkingBuffer += delta;
  yield* emitEffect(emit, {
    type: "message_update",
    delta: { kind: "thinking", text: delta },
  });
  break;
}
```

In the `reasoning-end` case (line ~630), set `endedAt`:

```typescript
case "reasoning-end": {
  thinkingEndedAt = Date.now();
  const signature = (
    part as {
      providerMetadata?: { anthropic?: { signature?: string } };
    }
  ).providerMetadata?.anthropic?.signature;
  if (signature) {
    thinkingSignature = signature;
  }
  break;
}
```

In the `text-delta` case (line ~610), set `thinkingEndedAt` as fallback if not already set (covers providers that omit `reasoning-end`):

```typescript
case "text-delta": {
  yield* ensureMessageStarted();
  if (thinkingBuffer && thinkingEndedAt === undefined) {
    thinkingEndedAt = Date.now();
  }
  const delta = part.text as string;
  textBuffer += delta;
  yield* emitEffect(emit, {
    type: "message_update",
    delta: { kind: "text", text: delta },
  });
  break;
}
```

In the final content build (line ~698), spread the timing fields:

```typescript
if (thinkingBuffer) {
  content.push({
    type: "thinking",
    thinking: thinkingBuffer,
    ...(thinkingSignature ? { thinkingSignature } : {}),
    ...(thinkingStartedAt !== undefined ? { startedAt: thinkingStartedAt } : {}),
    ...(thinkingEndedAt !== undefined ? { endedAt: thinkingEndedAt } : {}),
  });
}
```

**Step 4: Run tests — verify pass**

```bash
vp run '@sakti-code/agent#test' -- packages/agent/src/core/__tests__/agent-loop.test.ts 2>&1 | tail -10
```

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(agent): persist thinking startedAt/endedAt in content blocks"
```

---

## Phase 2: Client Store — Fix Live Streaming `endedAt`

### Task 3: Set `endedAt` on thinking when text arrives

**Files:**

- Modify: `apps/desktop/src/stores/session/session-store.ts:176-204` (`appendTextToken`)
- Test: `apps/desktop/src/stores/session/__tests__/turn-store.test.ts`

**Step 1: Write failing tests**

Add to `turn-store.test.ts`, after the existing `appendThinkingToken` tests:

```typescript
describe("turn store — thinking endedAt on text transition", () => {
  it("sets endedAt on thinking part when text arrives", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.appendThinkingToken("a1", "hmm");
    // Text arrives — thinking should be finalized
    actions.appendTextToken("a1", "answer");

    const parts = store.turns[0]!.messages[0]!.parts;
    expect(parts[0]).toMatchObject({ type: "thinking", text: "hmm" });
    expect(parts[0]).toHaveProperty("endedAt");
    expect((parts[0] as { endedAt?: number }).endedAt).toBeTypeOf("number");
    expect(parts[1]).toMatchObject({ type: "text", text: "answer" });
  });
});
```

Also add a test in `message-handlers.test.ts` verifying the full event flow:

```typescript
it("text after thinking sets endedAt on thinking part", () => {
  const { session, dispatch } = setupHandlers();
  dispatch({ message: userMsg("hi"), type: "message_start" });
  dispatch({ message: assistantMsg(), type: "message_start" });
  dispatch({ delta: { kind: "thinking", text: "hmm" }, type: "message_update" });
  dispatch({ delta: { kind: "text", text: "answer" }, type: "message_update" });

  const parts = session.store.turns[0]!.messages[0]!.parts;
  expect(parts[0]).toHaveProperty("endedAt");
});
```

**Step 2: Run tests — verify they fail**

```bash
vp run desktop#test -- --reporter=verbose -t "thinking endedAt" apps/desktop/src/stores/session/__tests__/turn-store.test.ts 2>&1 | tail -15
```

Expected: FAIL — `endedAt` is `undefined`.

**Step 3: Implement**

In `session-store.ts`, in `appendTextToken`'s `produce` callback, the `else if (last !== undefined)` branch (transition from non-text to text), add `endedAt`:

```typescript
setStore(
  "turns",
  loc.turnIdx,
  "messages",
  loc.msgIdx,
  produce((m: UIMessage) => {
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
  }),
);
```

**Step 4: Run tests — verify pass**

**Step 5: Commit**

```bash
git add -A && git commit -m "fix(store): set endedAt on thinking part when text arrives"
```

---

## Phase 3: Hydration — Read Persisted Timing

### Task 4: Read `startedAt`/`endedAt` in `convertAssistantMessage`

**Files:**

- Modify: `apps/desktop/src/stores/session/hydrate-helpers.ts:55-59`
- Test: `apps/desktop/src/stores/session/__tests__/hydrate-messages.test.ts`

**Step 1: Write failing test**

Add to `hydrate-messages.test.ts`:

```typescript
describe("hydrateSessionTurns — thinking timing", () => {
  it("preserves startedAt/endedAt from thinking content blocks", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "reasoning", startedAt: 1000, endedAt: 2000 },
          { type: "text", text: "answer" },
        ],
        timestamp: 1500,
      },
    ] as AgentMessage[];

    const turns = hydrateSessionTurns(messages);
    const thinking = turns[0]!.messages[0]!.parts.find((p) => p.type === "thinking");
    expect(thinking).toMatchObject({
      type: "thinking",
      text: "reasoning",
      startedAt: 1000,
      endedAt: 2000,
    });
  });
});
```

**Step 2: Run test — verify it fails**

```bash
vp run desktop#test -- --reporter=verbose -t "thinking timing" apps/desktop/src/stores/session/__tests__/hydrate-messages.test.ts 2>&1 | tail -15
```

Expected: FAIL — `startedAt`/`endedAt` not present on the hydrated part.

**Step 3: Implement**

In `hydrate-helpers.ts`, update the thinking branch of `convertAssistantMessage` (line 55-59) to read the optional fields:

```typescript
if (part !== null && typeof part === "object" && "type" in part && part.type === "thinking") {
  const raw = part as {
    thinking?: string;
    startedAt?: number;
    endedAt?: number;
  };
  if (raw.thinking) {
    parts.push({
      type: "thinking",
      text: raw.thinking,
      ...(raw.startedAt !== undefined ? { startedAt: raw.startedAt } : {}),
      ...(raw.endedAt !== undefined ? { endedAt: raw.endedAt } : {}),
    });
  }
}
```

**Step 4: Run test — verify pass**

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(hydrate): preserve thinking startedAt/endedAt from content JSON"
```

---

## Phase 4: Use dayjs for Duration Formatting

### Task 5: Replace custom `formatDuration` with `dayjs.duration()`

**Files:**

- Modify: `apps/desktop/src/components/chat-area/parts/thinking-part.tsx:14-25` (`formatDuration`)
- Modify: `apps/desktop/src/components/chat-area/timeline/session-turn.tsx:48-60` (`formatWorkDuration`)
- Create: shared util in `apps/desktop/src/lib/format-duration.ts`

**Step 1: Write failing test**

Create `apps/desktop/src/lib/__tests__/format-duration.test.ts`:

```typescript
import { describe, expect, it } from "vite-plus/test";
import { formatDuration } from "../format-duration.ts";

describe("formatDuration", () => {
  it("formats sub-second as <1s", () => {
    expect(formatDuration(500)).toBe("<1s");
  });

  it("formats seconds", () => {
    expect(formatDuration(45000)).toBe("45s");
  });

  it("formats minutes with seconds", () => {
    expect(formatDuration(906000)).toBe("15m 6s");
  });

  it("formats round minutes without seconds", () => {
    expect(formatDuration(120000)).toBe("2m");
  });

  it("formats hours with minutes", () => {
    expect(formatDuration(3_906_000)).toBe("1h 5m");
  });

  it("formats hours with minutes and seconds", () => {
    expect(formatDuration(3_930_000)).toBe("1h 5m 30s");
  });
});
```

**Step 2: Run test — verify it fails**

```bash
vp run desktop#test -- --reporter=verbose apps/desktop/src/lib/__tests__/format-duration.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

**Step 3: Implement**

Create `apps/desktop/src/lib/format-duration.ts`:

```typescript
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";

dayjs.extend(duration);

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return "<1s";
  }
  const d = dayjs.duration(ms);
  const hours = d.hours();
  const minutes = d.minutes();
  const seconds = d.seconds();

  if (hours > 0) {
    return seconds > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}
```

**Step 4: Run test — verify pass**

**Step 5: Update consumers**

In `thinking-part.tsx`:

- Remove the local `formatDuration` function (lines 14-25)
- Add import: `import { formatDuration } from "~/lib/format-duration";`

In `session-turn.tsx`:

- Remove the local `formatWorkDuration` function (lines 48-60)
- Add import: `import { formatDuration } from "~/lib/format-duration";`
- Replace `formatWorkDuration(...)` calls with `formatDuration(...)`

**Step 6: Run full test suite**

```bash
vp run desktop#test
```

**Step 7: Commit**

```bash
git add -A && git commit -m "refactor: use dayjs.duration for all duration formatting"
```

---

## Phase 5: Verify End-to-End

### Task 6: Full test run + type check

**Step 1: Run all tests**

```bash
vp run -r test
```

**Step 2: Run check**

```bash
vp check
```

Fix any remaining type errors or test failures.

**Step 3: Final commit**

```bash
git add -A && git commit -m "feat: persist thinking timing — all tests pass"
```

---

## Migration Notes

### No DB Schema Migration

The `session_entries.content` column is a JSON text blob. Adding `startedAt`/`endedAt` fields to `ThinkingContent` just adds extra keys to the JSON object — existing rows without these fields hydrate as `undefined`, and the component falls back to "Thought" (no duration). Forward and backward compatible.

### Existing Messages

Old persisted messages won't have thinking timing. They'll show "Thought" instead of "Thought for Xm Ys" until the session is re-run. This is expected — there's no way to backfill timing for messages where it was never tracked.

### Data Flow (Complete)

```
Agent stream:
  reasoning-delta → thinkingStartedAt = Date.now()
  reasoning-end   → thinkingEndedAt = Date.now()
                   (text-delta fallback if reasoning-end absent)
  ──────────────────────────────────────────────
  Final content: { type: "thinking", thinking: "...", startedAt, endedAt }
                                                        ↓
DB: session_entries.content (JSON text blob)
                                                        ↓
REST /chat or /messages → AgentMessage → content blocks carry timing
                                                        ↓
convertAssistantMessage() reads startedAt/endedAt → UIMessage part
                                                        ↓
ThinkingPart component: "Thought for 1m 2s"
```

### Live Streaming (Independent Path)

Live streaming sets timing client-side via the store:

- `appendThinkingToken` → `startedAt: Date.now()`
- `appendTextToken` → `endedAt: Date.now()` (when transitioning thinking → text)

These client-side values are overwritten on next reload by the persisted agent timing, ensuring determinism.
