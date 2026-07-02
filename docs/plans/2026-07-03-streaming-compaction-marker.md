# Streaming Compaction Marker — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stream compaction summary tokens in real-time to a collapsible marker in the chat UI (same UX as thinking-part), for both manual `/compact` and auto-compaction.

**Architecture:** Thread an `onDelta` callback through the compaction call chain (`generateSummaryEffect` → `compactEffect` → `runAutoCompactionEffect` / `runCompact`). The server emits `compaction_delta` events via WS; the client's event reducer appends tokens to a `compaction` part on the last message, mirroring how thinking tokens stream. A new `compaction-part.tsx` component renders it with auto-expand/collapse behavior identical to `thinking-part.tsx`. All messages stay visible — compaction does NOT remove messages from the UI.

**Tech Stack:** TypeScript, Effect, @sakti-code/llm (`stream()` instead of `complete()`), SolidJS, vitest (TDD).

---

## Phase 1: Agent Package — `compaction_delta` Event Type

### Task 1: Add `compaction_delta` to `AgentEvent` union

**Files:**

- Modify: `packages/agent/src/types.ts:306-318`

**Step 1: Add the event type**

In `packages/agent/src/types.ts`, after the `compaction_start` variant and before `compaction_end`, add:

```ts
  | { type: "compaction_delta"; text: string }
```

**Step 2: Export from index**

Verify `AgentEvent` is already exported from `packages/agent/src/index.ts` (it is — line ~215). No change needed.

**Step 3: Run typecheck**

Run: `vp check`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/agent/src/types.ts
git commit -m "feat(agent): add compaction_delta event type for streaming summary"
```

---

## Phase 2: Agent Package — Stream the Summary LLM Call

### Task 2: Add `onDelta` to `generateSummaryEffect`

**Files:**

- Modify: `packages/agent/src/memory/compaction/compaction.ts:431-511`

**Step 1: Add `onDelta` to `GenerateSummaryOptions`**

In `packages/agent/src/memory/compaction/compaction.ts`, update the `GenerateSummaryOptions` interface (around line 432):

```ts
export interface GenerateSummaryOptions {
  readonly customInstructions?: string;
  readonly headers?: Record<string, string>;
  /** Called for each text delta during streaming. */
  readonly onDelta?: (text: string) => void;
  readonly previousSummary?: string;
  readonly prompts: CompactionPrompts;
  readonly signal?: AbortSignal;
  readonly thinkingLevel?: ThinkingLevel;
}
```

**Step 2: Switch from `complete()` to `stream()` when `onDelta` is provided**

In `generateSummaryEffect` (around line 485), replace the `complete()` call with a branch:

```ts
if (opts.onDelta) {
  const streamResult =
    yield *
    Effect.promise(() =>
      stream({
        model,
        messages: summarizationMessages,
        system: opts.prompts.summarizationSystem,
        ...(completionOptions.maxTokens ? { maxOutputTokens: completionOptions.maxTokens } : {}),
        ...(completionOptions.signal ? { abortSignal: completionOptions.signal } : {}),
        apiKey: completionOptions.apiKey,
        ...(completionOptions.headers ? { headers: completionOptions.headers } : {}),
        ...(completionOptions.thinkingLevel
          ? { thinkingLevel: completionOptions.thinkingLevel }
          : {}),
      }),
    );

  let textContent = "";
  for await (const part of streamResult.fullStream) {
    if (part.type === "text-delta" && part.text) {
      textContent += part.text;
      opts.onDelta(part.text);
    }
  }
  const finish = await streamResult.result;
  if (finish.finishReason === "error") {
    return err(
      new CompactionError({
        code: "summarization_failed",
        message: `Summarization failed: ${finish.errorMessage || "Unknown error"}`,
      }),
    );
  }
  return ok(textContent);
}
```

Keep the existing `complete()` path as the `else` branch (no behavior change when `onDelta` is not provided — preserves backward compatibility and test mocking).

Add the import at the top of the file:

```ts
import { complete, stream } from "@sakti-code/llm";
```

**Step 3: Add `onDelta` to `CompactEffectOptions`**

```ts
export interface CompactEffectOptions {
  readonly customInstructions?: string;
  readonly headers?: Record<string, string>;
  /** Streamed delta callback — forwarded to generateSummaryEffect. */
  readonly onDelta?: (text: string) => void;
  readonly prompts: CompactionPrompts;
  readonly signal?: AbortSignal;
  readonly thinkingLevel?: ThinkingLevel;
}
```

**Step 4: Thread `onDelta` through `compactEffect`**

In `compactEffect` (around line 650), pass `onDelta` to each `generateSummaryEffect` call. Add to each options object:

```ts
              ...(opts.onDelta === undefined ? {} : { onDelta: opts.onDelta }),
```

There are 3 call sites in `compactEffect`: the split-turn history summary (line ~683), the split-turn turn-prefix summary (line ~694 — this one uses `generateTurnPrefixSummaryEffect` which does NOT support streaming, so skip it), and the non-split summary (line ~709).

Only thread `onDelta` to the `generateSummaryEffect` calls (lines ~683 and ~709), NOT to `generateTurnPrefixSummaryEffect` (line ~694).

**Step 5: Run typecheck**

Run: `vp check`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/agent/src/memory/compaction/compaction.ts
git commit -m "feat(agent): add streaming onDelta callback to generateSummaryEffect"
```

---

## Phase 3: Agent Package — Thread `onDelta` Through Auto-Compaction

### Task 3: Add `onDelta` to `runAutoCompactionEffect`

**Files:**

- Modify: `packages/agent/src/memory/compaction/auto-compaction.ts:228-287`

**Step 1: Add `onDelta` to `RunCompactionDeps`**

In `packages/agent/src/memory/compaction/auto-compaction.ts`, find the `RunCompactionDeps` interface (search for it above line 228). Add:

```ts
  /** Streamed delta callback — forwarded to compactEffect. */
  readonly onDelta?: (text: string) => void;
```

**Step 2: Thread `onDelta` into `compactEffect` call**

In `runAutoCompactionEffect` (around line 266), add `onDelta` to the `compactEffect` options:

```ts
const result =
  yield *
  compactEffect(preparation.success, deps.model, deps.apiKey, {
    prompts: deps.prompts,
    ...(deps.thinkingLevel === undefined ? {} : { thinkingLevel: deps.thinkingLevel }),
    ...(deps.onDelta === undefined ? {} : { onDelta: deps.onDelta }),
  });
```

**Step 3: Run typecheck**

Run: `vp check`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/agent/src/memory/compaction/auto-compaction.ts
git commit -m "feat(agent): thread onDelta through runAutoCompactionEffect"
```

---

### Task 4: Wire `onDelta` in agent-run.ts to emit `compaction_delta`

**Files:**

- Modify: `packages/agent/src/runner/agent-run.ts:266-287`

**Step 1: Pass `onDelta` to `runAutoCompactionEffect`**

In `packages/agent/src/runner/agent-run.ts`, in the `runCompaction` callback (around line 274), add:

```ts
const result =
  yield *
  runAutoCompactionEffect({
    session: sessionShape,
    model,
    apiKey,
    settings: compactionSettings,
    prompts: compactionPrompts,
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
    ...(deps.emit === undefined
      ? {}
      : { onDelta: (text: string) => deps.emit({ type: "compaction_delta", text }) }),
  });
```

**Step 2: Run typecheck**

Run: `vp check`
Expected: PASS

**Step 3: Run agent tests**

Run: `vp run '@sakti-code/agent#test'`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/agent/src/runner/agent-run.ts
git commit -m "feat(agent-run): emit compaction_delta events during auto-compaction"
```

---

## Phase 4: Server — Stream Manual `/compact`

### Task 5: Add `onDelta` to `runCompact` and wire WS emission

**Files:**

- Modify: `apps/server/src/agent/commands/compact.ts`
- Modify: `apps/server/src/agent/ws-handler.ts`

**Step 1: Add `onDelta` parameter to `runCompact`**

In `apps/server/src/agent/commands/compact.ts`, add an `onDelta` parameter:

```ts
export async function runCompact(
  ctx: ServerContext,
  sessionId: string,
  customInstructions?: string,
  onDelta?: (text: string) => void,
): Promise<CompactResult | { skipped: true } | { notFound: true } | { error: string }> {
```

In the `compact()` call (around line 53), add `onDelta`:

```ts
const result = await compact(prep, auth.model, auth.apiKey, {
  prompts: COMPACTION_PROMPTS,
  ...(customInstructions !== undefined ? { customInstructions } : {}),
  ...(onDelta === undefined ? {} : { onDelta }),
});
```

**Step 2: Wire `onDelta` in `handleCompactCommand`**

In `apps/server/src/agent/ws-handler.ts`, in `handleCompactCommand` (around line 341), pass `onDelta` to `runCompact`:

```ts
const result = await runCompact(ctx, sessionId, customInstructions, (text) => {
  ws.send({
    event: { type: "compaction_delta", text },
    sessionId,
    type: "event",
  } satisfies EventFrame);
});
```

**Step 3: Run server tests**

Run: `vp run '@sakti-code/server#test'`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/server/src/agent/commands/compact.ts apps/server/src/agent/ws-handler.ts
git commit -m "feat(server): stream compaction deltas during manual /compact"
```

---

## Phase 5: Desktop — `compaction` Part Type

### Task 6: Add `compaction` to `MessagePart` union

**Files:**

- Modify: `apps/desktop/src/stores/types.ts:8-41`

**Step 1: Add the variant**

In `apps/desktop/src/stores/types.ts`, add to the `MessagePart` union (after `om_marker`):

```ts
  | {
      type: "compaction";
      status: "loading" | "complete" | "failed";
      text: string;
      tokensBefore?: number;
      startedAt?: number;
      endedAt?: number;
      error?: string;
    }
```

**Step 2: Run typecheck**

Run: `vp check`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/desktop/src/stores/types.ts
git commit -m "feat(desktop): add compaction MessagePart type"
```

---

## Phase 6: Desktop — Session Store Actions

### Task 7: Add `addCompactionMarker`, `appendCompactionToken`, `updateCompactionMarker`

**Files:**

- Modify: `apps/desktop/src/stores/session/session-store.ts`

**Step 1: Add to `SessionActions` interface**

In `apps/desktop/src/stores/session/session-store.ts`, add to `SessionActions` (alphabetical, after `addOmMarker`):

```ts
  addCompactionMarker: (msgId: string) => void;
```

And after `appendToken`:

```ts
  appendCompactionToken: (msgId: string, delta: string) => void;
```

And after `updateOmMarker`:

```ts
  updateCompactionMarker: (msgId: string, updates: Partial<Extract<MessagePart, { type: "compaction" }>>) => void;
```

**Step 2: Implement the actions**

After the `addOmMarker` implementation (around line 130):

```ts
    addCompactionMarker(msgId) {
      setStore("messages", msgId, "parts", (prev) => {
        if (prev.some((p) => p.type === "compaction")) {
          return prev;
        }
        return [
          ...prev,
          {
            type: "compaction",
            status: "loading",
            text: "",
            startedAt: Date.now(),
          } as MessagePart,
        ];
      });
    },
```

After `appendToken` implementation:

```ts
    appendCompactionToken(msgId, delta) {
      setStore("messages", msgId, "parts", (prev) => {
        const idx = prev.findIndex((p) => p.type === "compaction");
        if (idx < 0) return prev;
        const existing = prev[idx] as Extract<MessagePart, { type: "compaction" }>;
        return [
          ...prev.slice(0, idx),
          { ...existing, text: existing.text + delta } as MessagePart,
          ...prev.slice(idx + 1),
        ];
      });
    },
```

After `updateOmMarker` implementation (around line 367):

```ts
    updateCompactionMarker(msgId, updates) {
      setStore("messages", msgId, "parts", (prev) => {
        const idx = prev.findIndex((p) => p.type === "compaction");
        if (idx < 0) return prev;
        const existing = prev[idx] as Extract<MessagePart, { type: "compaction" }>;
        return [
          ...prev.slice(0, idx),
          { ...existing, ...updates, type: "compaction" } as MessagePart,
          ...prev.slice(idx + 1),
        ];
      });
    },
```

**Step 3: Run typecheck**

Run: `vp check`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/desktop/src/stores/session/session-store.ts
git commit -m "feat(desktop): add compaction marker actions to session store"
```

---

## Phase 7: Desktop — Event Reducer

### Task 8: Handle `compaction_start`, `compaction_delta`, `compaction_end` in `dispatchEvent`

**Files:**

- Modify: `apps/desktop/src/stores/session/event-reducer.ts`

**Step 1: Add the cases**

In `apps/desktop/src/stores/session/event-reducer.ts`, before the closing `}` of the switch (after the `om_status` case, around line 270), add:

```ts
    case "compaction_start": {
      const msgId = actions.getCurrentMessageId() ?? actions.getLastAssistantMessageId();
      if (msgId) {
        actions.addCompactionMarker(msgId);
      }
      actions.setPhase("thinking");
      break;
    }

    case "compaction_delta": {
      const msgId = actions.getCurrentMessageId() ?? actions.getLastAssistantMessageId();
      if (msgId) {
        actions.appendCompactionToken(msgId, event.text);
      }
      break;
    }

    case "compaction_end": {
      const msgId = actions.getCurrentMessageId() ?? actions.getLastAssistantMessageId();
      if (msgId) {
        if (event.errorMessage !== undefined) {
          actions.updateCompactionMarker(msgId, {
            status: "failed",
            error: event.errorMessage,
            endedAt: Date.now(),
          });
        } else if (event.result) {
          actions.updateCompactionMarker(msgId, {
            status: "complete",
            tokensBefore: event.result.tokensBefore,
            endedAt: Date.now(),
          });
        } else {
          // Skipped (no result, no error) — remove the marker since nothing happened.
          // We can't remove parts, so mark it failed with a helpful message.
          actions.updateCompactionMarker(msgId, {
            status: "failed",
            error: "Nothing to compact",
            endedAt: Date.now(),
          });
        }
      }
      actions.setPhase("idle");
      break;
    }
```

**Step 2: Run typecheck**

Run: `vp check`
Expected: PASS

**Step 3: Run desktop tests**

Run: `vp run 'desktop#test'`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/desktop/src/stores/session/event-reducer.ts
git commit -m "feat(desktop): handle compaction_start/delta/end in event reducer"
```

---

## Phase 8: Desktop — `compaction-part.tsx` Component

### Task 9: Create the component

**Files:**

- Create: `apps/desktop/src/components/chat-area/parts/compaction-part.tsx`

**Step 1: Create the component**

Model it on `thinking-part.tsx`. Key differences:

- Icon: archive/compress (use `TbOutlineArrowsMinimize` from `solid-icons/tb`)
- Loading label: `"Compressing..."` (animated pulse)
- Complete label: `"Context compressed"` (or `"Context compressed (N tokens)"` if tokensBefore available)
- Failed label: `"Compression failed"`
- Auto-expand on start (like thinking), auto-collapse when done (deferred via RAF)
- Content: the streamed summary text rendered as Markdown
- The `text` field accumulates from `compaction_delta` events

```tsx
import { TbOutlineArrowsMinimize } from "solid-icons/tb";
import { type Component, createEffect, createMemo, createSignal, on, Show } from "solid-js";
import { Markdown } from "~/components/ui/markdown";
import type { PartProps } from "./part-registry.ts";

export const CompactionPart: Component<PartProps> = (props) => {
  const text = () => (props.part.type === "compaction" ? props.part.text : "");
  const status = () => (props.part.type === "compaction" ? props.part.status : "complete");
  const tokensBefore = () =>
    props.part.type === "compaction" ? props.part.tokensBefore : undefined;
  const error = () => (props.part.type === "compaction" ? props.part.error : undefined);

  const isActive = createMemo(() => status() === "loading");

  const headerLabel = createMemo(() => {
    if (isActive()) return "Compressing...";
    if (status() === "failed") return "Compression failed";
    const t = tokensBefore();
    return t !== undefined
      ? `Context compressed (${t.toLocaleString()} tokens)`
      : "Context compressed";
  });

  const [expanded, setExpanded] = createSignal(false);

  createEffect(
    on(isActive, (active, prev) => {
      if (active) {
        setExpanded(true);
      } else if (prev === true) {
        requestAnimationFrame(() => setExpanded(false));
      }
    }),
  );

  const toggle = () => setExpanded((e) => !e);

  return (
    <div class="rounded-lg bg-muted/30 text-muted-foreground" data-component="compaction-part">
      <button
        class="flex w-full cursor-pointer items-center gap-2 py-2 pr-3 pl-4 text-left font-medium text-sm"
        data-slot="compaction-header"
        onClick={toggle}
        type="button"
      >
        <TbOutlineArrowsMinimize
          class="h-4 w-4 shrink-0"
          classList={{ "animate-pulse": isActive() }}
        />
        <span classList={{ "animate-shimmer text-shimmer": isActive() }}>{headerLabel()}</span>
      </button>
      <Show when={status() === "failed" && error()}>
        <div class="px-4 pb-2 text-sm text-destructive">{error()}</div>
      </Show>
      <div
        class="grid transition-[grid-template-rows] duration-200 ease-in-out"
        data-slot="compaction-content"
        style={{ "grid-template-rows": expanded() ? "1fr" : "0fr" }}
      >
        <div class="min-h-0 overflow-hidden">
          <Show when={text().trim().length > 0}>
            <div
              class="max-h-[200px] overflow-y-auto border-border/50 border-t px-4 py-2.5 italic leading-relaxed"
              style={{ "--foreground": "var(--muted-foreground)" }}
            >
              <Markdown class="prose-p:m-0 text-sm" isStreaming={isActive()} text={text()} />
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
};
```

**Step 2: Register in `register-parts.ts`**

In `apps/desktop/src/components/chat-area/parts/register-parts.ts`, add:

```ts
import { CompactionPart } from "./compaction-part.tsx";
```

And in `registerDefaultPartComponents`:

```ts
registerPartComponent("compaction", CompactionPart);
```

**Step 3: Run typecheck**

Run: `vp check`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/desktop/src/components/chat-area/parts/compaction-part.tsx apps/desktop/src/components/chat-area/parts/register-parts.ts
git commit -m "feat(desktop): add compaction-part component with streaming summary"
```

---

## Phase 9: Tests

### Task 10: Test event reducer compaction handling

**Files:**

- Modify: `apps/desktop/src/stores/session/__tests__/event-reducer.test.ts`

**Step 1: Add tests**

```ts
describe("compaction events", () => {
  it("compaction_start adds a loading compaction marker", () => {
    const { session, dispatch } = setup();
    const msgId = "msg-1";
    session.actions.addMessage({
      id: msgId,
      role: "assistant",
      content: "response",
      parts: [{ type: "text", text: "response" }],
      isStreaming: false,
      timestamp: Date.now(),
    });
    session.actions.setCurrentMessage(msgId);

    dispatch({ type: "compaction_start", reason: "manual" });

    const marker = session.store.messages[msgId]!.parts.find((p) => p.type === "compaction");
    expect(marker).toBeDefined();
    expect((marker as { status: string }).status).toBe("loading");
    expect(session.store.streaming.phase).toBe("thinking");
  });

  it("compaction_delta appends text to the marker", () => {
    const { session, dispatch } = setup();
    // ... setup message + compaction_start ...
    dispatch({ type: "compaction_delta", text: "Hello " });
    dispatch({ type: "compaction_delta", text: "world" });

    const marker = session.store.messages[msgId]!.parts.find((p) => p.type === "compaction");
    expect((marker as { text: string }).text).toBe("Hello world");
  });

  it("compaction_end with result marks marker complete and sets phase idle", () => {
    const { session, dispatch } = setup();
    // ... setup message + compaction_start ...
    dispatch({
      type: "compaction_end",
      reason: "manual",
      result: { summary: "...", firstKeptEntryId: "x", tokensBefore: 5000 },
      aborted: false,
      willRetry: false,
    });

    const marker = session.store.messages[msgId]!.parts.find((p) => p.type === "compaction");
    expect((marker as { status: string }).status).toBe("complete");
    expect((marker as { tokensBefore: number }).tokensBefore).toBe(5000);
    expect(session.store.streaming.phase).toBe("idle");
  });
});
```

Adapt the `setup()` helper to match the existing test patterns in the file.

**Step 2: Run tests**

Run: `vp run 'desktop#test'`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/desktop/src/stores/session/__tests__/event-reducer.test.ts
git commit -m "test(desktop): compaction event reducer handling"
```

---

## Final Verification

### Task 11: Full integration check

**Step 1: Run all checks**

```bash
vp check
vp run -r test
```

Expected: 0 errors, 0 warnings, all tests pass.

**Step 2: Manual smoke test**

1. Start the app: `vp run desktop#dev`
2. Have a long conversation (enough to compact)
3. Type `/compact` — verify "Compressing..." appears with streaming text
4. Verify it collapses to "Context compressed (N tokens)" when done
5. Trigger auto-compaction (overflow context) — verify same behavior

---

## Summary of Changes

| Area           | Change                                        | Files                                      |
| -------------- | --------------------------------------------- | ------------------------------------------ |
| Event type     | `compaction_delta`                            | `types.ts`                                 |
| Agent          | `onDelta` callback in `generateSummaryEffect` | `compaction.ts`                            |
| Agent          | Thread `onDelta` through auto-compaction      | `auto-compaction.ts`, `agent-run.ts`       |
| Server         | Stream deltas in manual `/compact`            | `compact.ts`, `ws-handler.ts`              |
| Desktop types  | `compaction` MessagePart                      | `types.ts`                                 |
| Desktop store  | Marker actions                                | `session-store.ts`                         |
| Desktop events | `compaction_start/delta/end` handling         | `event-reducer.ts`                         |
| Desktop UI     | `compaction-part.tsx` component               | `compaction-part.tsx`, `register-parts.ts` |
| Tests          | Event reducer tests                           | `event-reducer.test.ts`                    |
