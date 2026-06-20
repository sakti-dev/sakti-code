# Agent Runtime & Server — Pi Alignment Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align our agent runtime (`packages/agent/`) and server (`apps/server/src/agent/`) with pi's proven implementation (`openspec/references/pi/packages/agent/` + `coding-agent/src/core/`), fixing every verified correctness bug and adopting the highest-impact missing patterns.

**Architecture:** TDD per fix — write failing test → verify RED → implement → verify GREEN → gate (`bun typecheck && bun x ultracite check`) → commit. Each phase is independently shippable and can be sliced into its own OpenSpec change. All fixes verified against both our code and pi source with exact line citations.

**Tech Stack:** vitest (agent + server-agent layer), bun:test (server routes + db), pi-ai `@earendil-works/pi-ai@0.79.8`

---

## Verified Cross-Reference Evidence

Every divergence below was verified directly against both codebases. Citations: `OUR` = our codebase, `PI` = pi reference.

### Phase 1 — Verified Correctness Bugs (fix now)

| # | Bug | OUR evidence | PI evidence |
|---|-----|-------------|-------------|
| 1 | `thinkingLevel` silently dropped; reasoning never runs | `streaming.ts:169` passes `{ thinkingLevel }` | pi-ai `types.d.ts:147-148` reads `reasoning?`; PI `agent-loop.ts:232` uses `config.reasoning` |
| 2 | Compaction cut-point orphans tool results | `compaction.ts:148-159` walks all messages, no role guard; `:167` slices `recentMessages` | PI `compaction.ts:300-318` `findValidCutPoints` excludes `toolResult` |
| 3 | Same-session concurrency race | `ws-handler.ts:137` fire-and-forget, no busy guard; `runner.ts:14-23` `registerRun` overwrites; `ws.ts:37,40` store keyed by wsId not sessionId | PI `agent-session.ts:1042-1046` throws "already processing"; per-session Agent |
| 4 | `terminate` semantics inverted (OR vs AND) | `tool-execution.ts:86` any-result terminate | PI `agent-loop.ts:544` all-results terminate |
| 5 | Aborted/error usage not skipped in token estimate | `compaction.ts:57-66` takes last assistant usage unconditionally | PI `compaction.ts:128-135` skips `stopReason==="aborted"\|"error"` |
| 6 | Parallel tool exec is dead config | `tool-execution.ts:28` always sequential `for…of` despite `toolExecutionMode:"parallel"` default | PI `agent-loop.ts:382-387` dispatches parallel/sequential |
| 7 | `stopReason` + provider metadata lost on AssistantMessage | `streaming.ts:118-127` keeps only content/usage/timestamp; `types.ts:27-31` no `stopReason` field | PI preserves `stopReason`/`errorMessage`/`api`/`provider` |

### Phase 2 — High-Impact Missing Patterns (adopt now)

| # | Pattern | OUR gap | PI evidence |
|---|---------|---------|-------------|
| 8 | Tool-result truncation in serialization | `compaction.ts messageToText` dumps full output | PI `utils.ts:89,156` caps at ~2000 chars |
| 9 | Error/abort persisted to transcript | `streaming.ts:128` emits bare `error`, persists nothing | PI `agent-loop.ts:196` materializes error AssistantMessage |
| 10 | Abort breaks the tool batch | `tool-execution.ts` no `signal?.aborted` check between tools | PI `agent-loop.ts:440,478,497` checks + emits aborted results |

### Phase 3 — Medium-Impact Missing Patterns (needs design decision)

| # | Pattern | Notes |
|---|---------|-------|
| 11 | Split-turn cuts | PI `findCutPoint isSplitTurn`; ours `cutIndex<=1` short-circuits huge turns. Changes compaction output shape. |
| 12 | Previous-summary chaining | PI `UPDATE_SUMMARIZATION_PROMPT`; ours re-summarizes from scratch. Quality/cost improvement. |
| 13 | Cumulative file-ops tracking | PI `<read-files>`/`<modified-files>` tags. Adds file extraction to summary. |
| 14 | Default steeringMode/followUpMode | Ours `"all"` (loop/index.ts:59); PI `"one-at-a-time"` (agent.ts:212). **Product decision** — may be intentional. |

---

## Phase 1: Verified Correctness Bugs

### Task 1: Fix `thinkingLevel` → `reasoning` field mapping (Bug #1)

**Files:**
- Modify: `packages/agent/src/loop/streaming.ts:157-169`
- Test: `packages/agent/src/__tests__/streaming.test.ts` (or nearest existing)

**Root cause:** pi-ai's `SimpleStreamOptions` has field `reasoning?: ThinkingLevel` (NOT `thinkingLevel`). We pass `{ thinkingLevel }` which pi-ai silently ignores.

**Step 1: Write failing test**

```typescript
// packages/agent/src/__tests__/streaming.test.ts
it("passes thinkingLevel as 'reasoning' to streamSimple (not 'thinkingLevel')", async () => {
  // ... setup streamSimple mock to capture options ...
  streamSimpleMock.mockReturnValue(textStream("ok"));

  // Run a prompt with thinkingLevel configured
  const loop = createAgentLoop({
    sessionId: "s1",
    model: testModel,
    tools: [],
    store,
    thinkingLevel: "high",
  });
  await collectEvents(loop.prompt("hi"));

  const opts = streamSimpleMock.mock.calls[0][2] as Record<string, unknown>;
  expect(opts.reasoning).toBe("high");
  expect(opts.thinkingLevel).toBeUndefined();
});
```

**Step 2: Run test to verify it fails**

Run: `bun vitest run packages/agent/src/__tests__/streaming.test.ts -t "reasoning"`
Expected: FAIL — `opts.reasoning` is `undefined`, `opts.thinkingLevel` is `"high"`

**Step 3: Fix the mapping**

```typescript
// packages/agent/src/loop/streaming.ts — replace line 169
// BEFORE:
          ...(thinkingLevel ? { thinkingLevel } : {}),
// AFTER:
          ...(thinkingLevel ? { reasoning: thinkingLevel } : {}),
```

**Step 4: Run test to verify it passes**

Run: `bun vitest run packages/agent/src/__tests__/streaming.test.ts`
Expected: PASS

**Step 5: Run full agent suite (no regressions)**

Run: `bun vitest run packages/agent/`

**Step 6: Gate + commit**

```bash
bun typecheck && bun x ultracite check
git add packages/agent/src/loop/streaming.ts packages/agent/src/__tests__/streaming.test.ts
git commit -m "fix(agent-loop): map thinkingLevel to pi-ai 'reasoning' option (pi-alignment #1)"
```

---

### Task 2: Fix compaction cut-point orphaning tool results (Bug #2)

**Files:**
- Modify: `packages/agent/src/compaction.ts:145-170` (the cut-point loop)
- Test: `packages/agent/src/__tests__/compaction-execution.test.ts`

**Root cause:** The walk-back loop includes `tool` messages as valid cut points. If the cut lands on a tool message, `recentMessages` starts with an orphaned tool result (no preceding tool call) → provider rejects.

**Step 1: Write failing test**

```typescript
// packages/agent/src/__tests__/compaction-execution.test.ts
it("never cuts at a tool result — recent messages always start at a user/assistant boundary", async () => {
  // Build a conversation where tool messages are in the keepRecent window
  const messages: AgentMessage[] = [
    ...longConversation(40),  // history to summarize
    { role: "assistant", content: [{ type: "toolCall", id: "tc1", name: "read", arguments: {} }], timestamp: 40, usage: { ... } },
    { role: "tool", content: [{ type: "text", text: "file output" }], isError: false, toolCallId: "tc1", toolName: "read", timestamp: 41 },
    { role: "assistant", content: [{ type: "text", text: "ok" }], timestamp: 42, usage: { ... } },
  ];

  const result = await compactMessages({
    model: testModel, apiKey: "key", messages,
    contextWindow: 200_000, keepRecentTokens: 50, // tiny window forces cut near the tool
  });

  // The first message in recentMessages must NOT be a tool result
  expect(result.messages.some((m, i) => {
    if (i === 0 && m.role === "tool") return true;
    // Also check: a tool result must always have a preceding tool call
    if (m.role === "tool" && i > 0) {
      const prev = result.messages[i - 1];
      if (prev.role === "assistant") {
        // OK — tool call precedes tool result
      } else {
        return true; // orphaned
      }
    }
    return false;
  })).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `bun vitest run packages/agent/src/__tests__/compaction-execution.test.ts -t "never cuts at a tool result"`
Expected: FAIL — recent messages start with a tool result

**Step 3: Add role guard to the cut-point loop**

```typescript
// packages/agent/src/compaction.ts — replace the cut-point loop (lines 148-159)
// BEFORE:
  let cutIndex = messages.length;
  let recentTokens = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    recentTokens += estimateTokens([msg]);
    if (recentTokens >= keepRecentTokens) {
      cutIndex = i;
      break;
    }
  }

// AFTER:
  let cutIndex = messages.length;
  let recentTokens = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    recentTokens += estimateTokens([msg]);
    if (recentTokens >= keepRecentTokens) {
      cutIndex = i;
      break;
    }
  }
  // Advance cutIndex past any tool results at the cut boundary so
  // recentMessages never starts with an orphaned tool result (no
  // preceding tool call). Matches pi's findValidCutPoints which excludes
  // toolResult ("they must follow their tool call").
  while (
    cutIndex < messages.length &&
    messages[cutIndex]?.role === "tool" &&
    cutIndex > 1
  ) {
    cutIndex++;
  }
```

**Step 4: Run test to verify it passes**

Run: `bun vitest run packages/agent/src/__tests__/compaction-execution.test.ts`
Expected: PASS

**Step 5: Run full agent suite**

Run: `bun vitest run packages/agent/`

**Step 6: Gate + commit**

```bash
bun typecheck && bun x ultracite check
git add packages/agent/src/compaction.ts packages/agent/src/__tests__/compaction-execution.test.ts
git commit -m "fix(compaction): advance cut past tool results to avoid orphaning (pi-alignment #2)"
```

---

### Task 3: Fix `terminate` semantics — AND not OR (Bug #4)

**Files:**
- Modify: `packages/agent/src/loop/tool-execution.ts:26,86-88`
- Test: `packages/agent/src/__tests__/loop-behavior.test.ts`

**Root cause:** Our code sets `shouldTerminate = true` if ANY tool result has `terminate: true`. pi requires ALL results in a batch to terminate. A single terminate-flagged tool in a multi-tool batch stops the whole turn early.

**Step 1: Write failing test**

```typescript
// packages/agent/src/__tests__/loop-behavior.test.ts
it("does NOT terminate when one of multiple tools sets terminate:true (AND semantics)", async () => {
  const store = createMockStore();
  const toolA: AgentTool = {
    name: "toolA", description: "A",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: "a", terminate: true }),
  };
  const toolB: AgentTool = {
    name: "toolB", description: "B",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: "b", terminate: false }),
  };

  // Stream returns two tool calls
  vi.mocked(streamSimple).mockReturnValue(multiToolCallStream([
    { name: "toolA", args: {}, id: "tc1" },
    { name: "toolB", args: {}, id: "tc2" },
  ]));

  const loop = createAgentLoop({ sessionId: "s1", model: testModel, tools: [toolA, toolB], store });
  const events = await collectEvents(loop.prompt("run both"));

  // With AND semantics: toolA terminates but toolB does not → loop continues
  const turnEnds = events.filter((e) => e.type === "turn_end");
  expect(turnEnds.length).toBeGreaterThan(1); // didn't stop after first turn
});
```

**Step 2: Run test to verify it fails**

Run: `bun vitest run packages/agent/src/__tests__/loop-behavior.test.ts -t "AND semantics"`
Expected: FAIL — loop stops after first turn (OR semantics)

**Step 3: Fix to AND semantics**

```typescript
// packages/agent/src/loop/tool-execution.ts — replace lines 26 + 86-88

// BEFORE (line 26):
  let shouldTerminate = false;
// BEFORE (lines 86-88):
    if (result.terminate) {
      shouldTerminate = true;
    }

// AFTER (line 26):
  const terminates: boolean[] = [];
// AFTER (lines 86-88):
    terminates.push(result.terminate ?? false);
// And change the return (line 91):
  return { toolResultMessages, shouldTerminate: terminates.length > 0 && terminates.every(Boolean) };
```

**Step 4: Run test to verify it passes**

Run: `bun vitest run packages/agent/src/__tests__/loop-behavior.test.ts`
Expected: PASS

**Step 5: Run full agent suite**

Run: `bun vitest run packages/agent/`

**Step 6: Gate + commit**

```bash
bun typecheck && bun x ultracite check
git add packages/agent/src/loop/tool-execution.ts packages/agent/src/__tests__/loop-behavior.test.ts
git commit -m "fix(agent-loop): terminate requires ALL tools to request it (AND, pi-alignment #4)"
```

---

### Task 4: Skip aborted/error usage in `estimateContextTokens` (Bug #5)

**Files:**
- Modify: `packages/agent/src/compaction.ts:57-66` (`estimateContextTokens`)
- Test: `packages/agent/src/__tests__/compaction.test.ts`

**Root cause:** `estimateContextTokens` uses the last assistant message's usage unconditionally. If that assistant message has `stopReason: "error"` or `"aborted"`, its usage is stale/garbage. pi skips those.

**Note:** Our `AssistantMessage` type currently has no `stopReason` field. Bug #7 (Task 8) adds it. For now, this fix checks `usage.totalTokens > 0` as a proxy (an aborted/error message often has zero/garbage usage). After Task 8 adds `stopReason`, revisit to check `stopReason` explicitly.

**Step 1: Write failing test**

```typescript
// packages/agent/src/__tests__/compaction.test.ts (in the estimateContextTokens describe block)
it("ignores an assistant message with zero usage and keeps scanning back", () => {
  const messages: AgentMessage[] = [
    // Old assistant with real usage
    { role: "assistant", content: [{ type: "text", text: "ok" }], timestamp: 1,
      usage: usage(500) },
    // Recent assistant with garbage/zero usage (simulating error/abort)
    { role: "assistant", content: [{ type: "text", text: "" }], timestamp: 2,
      usage: usage(0) },
  ];
  // Should use the 500 from the older message, not the 0 from the recent one
  expect(estimateContextTokens(messages)).toBe(500);
});
```

**Step 2: Run test to verify it fails**

Run: `bun vitest run packages/agent/src/__tests__/compaction.test.ts -t "ignores an assistant message with zero usage"`
Expected: FAIL — returns 0 (takes the recent message's usage)

**Step 3: Fix — skip zero-usage assistants**

```typescript
// packages/agent/src/compaction.ts — replace estimateContextTokens (lines 57-66)
// BEFORE:
export function estimateContextTokens(messages: AgentMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "assistant") {
      const u = m.usage;
      const usageTokens =
        u?.totalTokens ||
        (u ? u.input + u.output + u.cacheRead + u.cacheWrite : 0);
      if (usageTokens > 0) {
        return usageTokens + estimateTokens(messages.slice(i + 1));
      }
    }
  }
  return estimateTokens(messages);
}

// AFTER (skip assistants with zero usage — proxies for error/abort until
// stopReason is added in Task 8, then check stopReason explicitly):
export function estimateContextTokens(messages: AgentMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "assistant") {
      const u = m.usage;
      const usageTokens =
        u?.totalTokens ||
        (u ? u.input + u.output + u.cacheRead + u.cacheWrite : 0);
      // Skip assistant messages with no usable usage (error/abort/garbage).
      // pi's getAssistantUsage skips stopReason==="aborted"|"error" explicitly;
      // we proxy via usageTokens===0 until stopReason lands on AssistantMessage.
      if (usageTokens > 0) {
        return usageTokens + estimateTokens(messages.slice(i + 1));
      }
    }
  }
  return estimateTokens(messages);
}
```

**Note:** The current code already has `if (usageTokens > 0)` — verify the test actually fails before "fixing." If it already passes, the test is testing existing behavior (no fix needed, just documentation). In that case, the real fix is in Task 8: add `stopReason` to AssistantMessage, then make `estimateContextTokens` check `stopReason !== "error" && stopReason !== "aborted"` explicitly.

**Step 4: Run test**

Run: `bun vitest run packages/agent/src/__tests__/compaction.test.ts`

**Step 5: Run full agent suite**

Run: `bun vitest run packages/agent/`

**Step 6: Gate + commit**

```bash
bun typecheck && bun x ultracite check
git add packages/agent/src/compaction.ts packages/agent/src/__tests__/compaction.test.ts
git commit -m "fix(compaction): skip error/abort usage in estimateContextTokens (pi-alignment #5)"
```

---

### Task 5: Fix same-session concurrency race (Bug #3)

**Files:**
- Modify: `apps/server/src/agent/runner.ts:14-23` (add busy guard to `registerRun`)
- Modify: `apps/server/src/agent/ws-handler.ts:136-137` (check busy before firing)
- Test: `apps/server/src/agent/__tests__/ws.test.ts`

**Root cause:** `ws-handler.ts:137` fires `runAgentStream` fire-and-forget with no guard. `registerRun` (`runner.ts:20`) overwrites the existing entry. The first run's `finally { unregisterRun }` deletes the second run's entry. A second prompt on the same session makes that run invisible to `abortRun`/`getActiveLoop`. Additionally, `getOrCreateStore` keys the store by `wsId` not `sessionId` (`ws.ts:37,40`) — two connections on the same session race on the same message rows.

**Step 1: Write failing test**

```typescript
// apps/server/src/agent/__tests__/ws.test.ts
it("rejects a second prompt on the same session while one is active (busy guard)", async () => {
  // Start a prompt that hangs (long-running stream)
  streamSimpleMock.mockReturnValue(hangStream);
  ws.emit("message", JSON.stringify({ type: "prompt", sessionId: "s1", message: "long" }));

  await waitForRun("s1"); // helper: wait until registerRun called

  // Second prompt on same session
  ws.emit("message", JSON.stringify({ type: "prompt", sessionId: "s1", message: "second" }));

  await waitForFrame();
  const frames = sentFrames();
  // Should get an error frame for the second prompt
  const errorFrame = frames.find(f => f.type === "error");
  expect(errorFrame).toBeDefined();
  expect(errorFrame.message).toMatch(/already.*running|busy|active/i);
});
```

**Step 2: Run test to verify it fails**

Run: `bun vitest run apps/server/src/agent/__tests__/ws.test.ts -t "busy guard"`
Expected: FAIL — second prompt silently overwrites

**Step 3: Add busy guard to runner**

```typescript
// apps/server/src/agent/runner.ts — modify registerRun to return whether it succeeded

export function registerRun(
  sessionId: string,
  controller: AbortController,
  loop: AgentLoop
): boolean {
  if (activeRuns.has(sessionId)) {
    return false; // a run is already active for this session
  }
  activeRuns.set(sessionId, { controller, loop });
  return true;
}

export function isRunActive(sessionId: string): boolean {
  return activeRuns.has(sessionId);
}
```

**Step 4: Wire busy check into ws-handler**

```typescript
// apps/server/src/agent/ws-handler.ts — before the fire-and-forget call (line 136)
if (isRunActive(msg.sessionId)) {
  ws.send(JSON.stringify({
    type: "error",
    sessionId: msg.sessionId,
    message: "A run is already active for this session. Send 'abort' first.",
  }));
  return;
}
// Fire-and-forget — does NOT await the stream
runAgentStream(ctx, msg.sessionId, msg.message, store, ws);
```

**Step 5: Key the session store by sessionId not wsId**

```typescript
// apps/server/src/agent/ws.ts — change getOrCreateStore to key by sessionId
// This is a larger change; for now, document the risk and fix the busy guard.
// The store re-keying requires threading sessionId through the WS handler
// and is best done as part of a dedicated session-islation change.
// TODO: re-key sessionStores by sessionId (see OpenSpec slice)
```

**Step 6: Run test to verify it passes**

Run: `bun vitest run apps/server/src/agent/__tests__/ws.test.ts`
Expected: PASS

**Step 7: Run full server agent layer**

Run: `bun vitest run apps/server/src/agent/__tests__/`

**Step 8: Gate + commit**

```bash
bun typecheck && bun x ultracite check
git add apps/server/src/agent/runner.ts apps/server/src/agent/ws-handler.ts apps/server/src/agent/__tests__/ws.test.ts
git commit -m "fix(server): reject concurrent prompts on same session with busy guard (pi-alignment #3)"
```

---

### Task 6: Add `stopReason` + provider metadata to AssistantMessage (Bug #7)

**Files:**
- Modify: `packages/agent/src/types.ts:27-31` (AssistantMessage interface)
- Modify: `packages/agent/src/loop/streaming.ts:118-127` (done handler)
- Test: `packages/agent/src/__tests__/loop-behavior.test.ts`

**Root cause:** Our `AssistantMessage` drops `stopReason`, `errorMessage`, `api`, `provider`, `model` from the stream's `done` event. These are needed for cost attribution, retry decisions, and error diagnostics.

**Step 1: Write failing test**

```typescript
// packages/agent/src/__tests__/loop-behavior.test.ts
it("AssistantMessage carries stopReason from the stream", async () => {
  const store = createMockStore();
  vi.mocked(streamSimple).mockReturnValue(textStream("Hello!"));

  const loop = createAgentLoop({ sessionId: "s1", model: testModel, tools: [], store });
  const events = await collectEvents(loop.prompt("hi"));

  const turnEnd = events.find(e => e.type === "turn_end") as any;
  expect(turnEnd.message.stopReason).toBe("stop");
});
```

**Step 2: Run test to verify it fails**

Run: `bun vitest run packages/agent/src/__tests__/loop-behavior.test.ts -t "stopReason"`
Expected: FAIL — `stopReason` is `undefined`

**Step 3: Add `stopReason` to AssistantMessage**

```typescript
// packages/agent/src/types.ts — modify AssistantMessage (line 27)
export interface AssistantMessage {
  content: (TextContent | ThinkingContent | ToolCall)[];
  role: "assistant";
  stopReason?: string;
  timestamp: number;
  usage: Usage;
}
```

**Step 4: Capture `stopReason` in the done handler**

```typescript
// packages/agent/src/loop/streaming.ts — modify the done case (lines 118-127)
      case "done":
        if (event.message) {
          finalAssistant = {
            role: "assistant",
            content: event.message.content,
            stopReason: event.message.stopReason,
            timestamp: event.message.timestamp,
            usage: event.message.usage,
          };
        }
        break;
```

**Step 5: Now update `estimateContextTokens` to check `stopReason` explicitly (completes Bug #5)**

```typescript
// packages/agent/src/compaction.ts — update estimateContextTokens
export function estimateContextTokens(messages: AgentMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "assistant") {
      // Skip error/aborted assistants — their usage is stale (pi pattern)
      if (m.stopReason === "error" || m.stopReason === "aborted") {
        continue;
      }
      const u = m.usage;
      const usageTokens =
        u?.totalTokens ||
        (u ? u.input + u.output + u.cacheRead + u.cacheWrite : 0);
      if (usageTokens > 0) {
        return usageTokens + estimateTokens(messages.slice(i + 1));
      }
    }
  }
  return estimateTokens(messages);
}
```

**Step 6: Run tests**

Run: `bun vitest run packages/agent/`
Expected: PASS

**Step 7: Gate + commit**

```bash
bun typecheck && bun x ultracite check
git add packages/agent/src/types.ts packages/agent/src/loop/streaming.ts packages/agent/src/compaction.ts packages/agent/src/__tests__/
git commit -m "fix(agent-loop): preserve stopReason on AssistantMessage (pi-alignment #7, completes #5)"
```

---

### Task 7: Implement parallel tool execution (Bug #6)

**Files:**
- Modify: `packages/agent/src/loop/tool-execution.ts` (full rewrite of the dispatch loop)
- Test: `packages/agent/src/__tests__/loop-behavior.test.ts`

**Root cause:** `toolExecutionMode: "parallel"` is the default config, but `tool-execution.ts:28` is always a sequential `for…of`. Parallel tool calls should run concurrently.

**Design constraint:** Our steer-abort mechanism (`combineSignals`) aborts ALL tools via a shared signal. In parallel mode, a steer aborts the entire batch (acceptable — pi also aborts the batch). The `tool_execution_start/update/end` events can't be perfectly ordered in parallel mode, but each tool's events must be internally ordered.

**Step 1: Write failing test**

```typescript
// packages/agent/src/__tests__/loop-behavior.test.ts
it("executes tools in parallel when toolExecutionMode is 'parallel'", async () => {
  const store = createMockStore();
  let aStart = 0, bStart = 0;
  const toolA: AgentTool = {
    name: "toolA", description: "A",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      aStart = Date.now();
      await sleep(50);
      return { content: "a", terminate: false };
    },
  };
  const toolB: AgentTool = {
    name: "toolB", description: "B",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      bStart = Date.now();
      await sleep(50);
      return { content: "b", terminate: false };
    },
  };

  vi.mocked(streamSimple).mockReturnValue(multiToolCallStream([...]));

  const loop = createAgentLoop({
    sessionId: "s1", model: testModel,
    tools: [toolA, toolB], store,
    toolExecutionMode: "parallel",
  });
  await collectEvents(loop.prompt("run both"));

  // In parallel, both tools start within a few ms of each other
  expect(Math.abs(aStart - bStart)).toBeLessThan(30);
});
```

**Step 2: Run test to verify it fails**

Run: `bun vitest run packages/agent/src/__tests__/loop-behavior.test.ts -t "parallel"`
Expected: FAIL — tools run sequentially, `|aStart - bStart|` > 50ms

**Step 3: Implement parallel dispatch**

```typescript
// packages/agent/src/loop/tool-execution.ts — rewrite the dispatch section

export async function* executeToolCalls(
  toolCalls: ToolCallInfo[],
  tools: AgentTool[],
  signal: AbortSignal | undefined,
  store: SessionStore,
  sessionId: string,
  messages: AgentMessage[],
  toolExecutionMode: "sequential" | "parallel" = "parallel"
): AsyncGenerator<AgentEvent, ToolExecResult> {
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const toolResultMessages: Extract<AgentMessage, { role: "tool" }>[] = [];
  const terminates: boolean[] = [];

  if (toolExecutionMode === "parallel" && toolCalls.length > 1) {
    // Parallel: all tools run concurrently
    const results = await Promise.all(
      toolCalls.map(async (tc) => {
        const events: AgentEvent[] = [];
        const result = await executeSingleTool(tc, toolMap, signal, events);
        return { tc, result, events };
      })
    );

    // Yield events in tool-call order (each tool's events grouped)
    for (const { tc, result, } of results) {
      yield evt("tool_execution_start", { toolCallId: tc.id, toolName: tc.name });
      // ... yield updates/end ...
      // Build + persist tool message
      // Push to toolResultMessages + terminates
    }
  } else {
    // Sequential: existing for-loop (unchanged)
    for (const tc of toolCalls) { ... }
  }

  return {
    toolResultMessages,
    shouldTerminate: terminates.length > 0 && terminates.every(Boolean),
  };
}
```

**Note:** The parallel path needs careful event ordering. Each tool's `tool_execution_start` → `tool_execution_update` → `tool_execution_end` must be grouped. The `onUpdate` callback can't yield mid-Promise.all, so updates are buffered per-tool and flushed after completion. This is the hardest change — see pi's `agent-loop.ts:382-490` for the proven structure.

**Step 4: Thread `toolExecutionMode` from the loop into `executeToolCalls`**

```typescript
// packages/agent/src/loop/index.ts — modify the executeToolCalls call
      const toolExec = yield* executeToolCalls(
        streamResult.toolCalls,
        tools,
        toolSignal,
        store,
        sessionId,
        messages,
        resolved.toolExecutionMode  // ADD THIS
      );
```

**Step 5: Run test to verify it passes**

Run: `bun vitest run packages/agent/src/__tests__/loop-behavior.test.ts`
Expected: PASS

**Step 6: Run full agent suite (watch for steer-abort test regressions)**

Run: `bun vitest run packages/agent/`

**Step 7: Gate + commit**

```bash
bun typecheck && bun x ultracite check
git add packages/agent/src/loop/tool-execution.ts packages/agent/src/loop/index.ts packages/agent/src/__tests__/
git commit -m "feat(agent-loop): implement parallel tool execution (pi-alignment #6)"
```

---

## Phase 2: High-Impact Missing Patterns

### Task 8: Truncate tool results in compaction serialization (Pattern #8)

**Files:**
- Modify: `packages/agent/src/compaction.ts` (`messageToText` function)
- Test: `packages/agent/src/__tests__/compaction-execution.test.ts`

**Step 1: Write failing test**

```typescript
it("truncates tool results to ~2000 chars in summarization text", async () => {
  const messages: AgentMessage[] = [
    ...longConversation(20),
    { role: "tool", content: [{ type: "text", text: "x".repeat(5000) }],
      isError: false, toolCallId: "tc1", toolName: "bash", timestamp: 20 },
  ];
  await compactMessages({ model: testModel, apiKey: "key", messages, contextWindow: 200_000 });
  const callArgs = vi.mocked(completeSimple).mock.calls[0];
  const promptText = callArgs[1].messages[0].content;
  // The 5000-char tool output should be truncated
  expect(promptText.length).toBeLessThan(5000);
  expect(promptText).toContain("truncat"); // truncation marker
});
```

**Step 2: Run test → FAIL**

**Step 3: Add truncation to `messageToText`**

```typescript
// packages/agent/src/compaction.ts — modify messageToText
const TOOL_RESULT_MAX_CHARS = 2000;

function messageToText(msg: AgentMessage): string {
  // ... existing user/assistant handling ...
  if (msg.role === "tool") {
    let text = (msg.content as Array<{ text: string }>).map((c) => c.text).join("");
    if (text.length > TOOL_RESULT_MAX_CHARS) {
      const truncated = text.length - TOOL_RESULT_MAX_CHARS;
      text = `${text.slice(0, TOOL_RESULT_MAX_CHARS)}\n[... ${truncated} chars truncated]`;
    }
    return `Tool (${msg.toolName}): ${text}`;
  }
  // ...
}
```

**Step 4: Run test → PASS. Gate + commit.**

```bash
bun vitest run packages/agent/
bun typecheck && bun x ultracite check
git commit -m "feat(compaction): truncate tool results in summarization text (pi-alignment #8)"
```

---

### Task 9: Persist error/abort as AssistantMessage in transcript (Pattern #9)

**Files:**
- Modify: `packages/agent/src/loop/streaming.ts` (error handler — build an error AssistantMessage)
- Modify: `packages/agent/src/loop/index.ts` (persist the error message on stream failure)
- Test: `packages/agent/src/__tests__/loop-behavior.test.ts`

**Step 1: Write failing test**

```typescript
it("persists an error AssistantMessage when the LLM stream errors", async () => {
  const store = createMockStore();
  // Stream that yields an error event
  vi.mocked(streamSimple).mockReturnValue(errorStream("billing limit"));

  const loop = createAgentLoop({ sessionId: "s1", model: testModel, tools: [], store });
  await collectEvents(loop.prompt("hi"));

  const messages = await store.loadMessages("s1");
  const errorMessages = messages.filter(
    m => m.role === "assistant" && m.stopReason === "error"
  );
  expect(errorMessages.length).toBe(1);
});
```

**Step 2: Run test → FAIL**

**Step 3: Build error AssistantMessage in streaming + persist in loop**

```typescript
// packages/agent/src/loop/streaming.ts — error case: build finalAssistant with stopReason
      case "error":
        finalAssistant = {
          role: "assistant",
          content: [{ type: "text", text: event.error?.errorMessage ?? "LLM error" }],
          stopReason: "error",
          timestamp: Date.now(),
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
                   cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        };
        yield evt("error", { message: event.error?.errorMessage ?? "LLM error" });
        break;
```

```typescript
// packages/agent/src/loop/index.ts — after streamResult, if finalAssistant exists with stopReason error, persist it
      if (streamResult.finalAssistant?.stopReason === "error" ||
          streamResult.finalAssistant?.stopReason === "aborted") {
        messages.push(streamResult.finalAssistant);
        await store.appendMessage(sessionId, streamResult.finalAssistant);
      }
```

**Step 4: Run test → PASS. Gate + commit.**

---

### Task 10: Abort breaks the tool batch (Pattern #10)

**Files:**
- Modify: `packages/agent/src/loop/tool-execution.ts` (check `signal?.aborted` between tools)
- Test: `packages/agent/src/__tests__/loop-behavior.test.ts`

**Step 1: Write failing test**

```typescript
it("stops executing remaining tools when abort signal fires mid-batch", async () => {
  const store = createMockStore();
  let bExecuted = false;
  const toolA: AgentTool = {
    name: "toolA", description: "A",
    parameters: { type: "object", properties: {} },
    execute: async (_, __, signal) => {
      await sleep(50);
      return { content: "a", terminate: false };
    },
  };
  const toolB: AgentTool = {
    name: "toolB", description: "B",
    parameters: { type: "object", properties: {} },
    execute: async () => { bExecuted = true; return { content: "b", terminate: false }; },
  };

  const controller = new AbortController();
  vi.mocked(streamSimple).mockReturnValue(multiToolCallStream([...]));

  const loop = createAgentLoop({ sessionId: "s1", model: testModel, tools: [toolA, toolB], store });
  const gen = loop.prompt("both", controller.signal);

  // Abort after first tool starts
  setTimeout(() => controller.abort(), 20);
  await collectEvents(gen);

  expect(bExecuted).toBe(false); // toolB never ran
});
```

**Step 2: Run test → FAIL**

**Step 3: Add abort check between tools**

```typescript
// packages/agent/src/loop/tool-execution.ts — inside the sequential for-loop, before each tool
  for (const tc of toolCalls) {
    if (signal?.aborted) break;  // ADD: stop executing remaining tools
    // ... existing tool execution ...
  }
```

**Step 4: Run test → PASS. Gate + commit.**

---

## Phase 3: Medium-Impact Missing Patterns (Needs Design Decision)

These are documented for future OpenSpec changes. Each changes behavior in ways that need product input.

### Task 11 (DEFERRED): Split-turn cuts in compaction

**Status:** Needs design decision. pi's `findCutPoint` detects when a single turn exceeds `keepRecentTokens` and produces a "turn prefix" summary in addition to the history summary. Our `cutIndex <= 1` short-circuit means huge turns either no-op or wipe everything. **Open as a separate OpenSpec change** — the change touches `compactMessages` output shape and the manual `/compact` route.

### Task 12 (DEFERRED): Previous-summary chaining

**Status:** Needs design decision. pi reads the prior `CompactionEntry.summary` and uses `UPDATE_SUMMARIZATION_PROMPT` to merge rather than re-summarize from scratch. Improves quality and reduces tokens. **Open as a separate OpenSpec change** — requires a "previous summary" field on the message list or store.

### Task 13 (DEFERRED): Cumulative file-ops tracking

**Status:** Needs design decision. pi extracts read/modified files from tool calls and includes `<read-files>`/`<modified-files>` tags in the summary, accumulating across compactions. **Open as a separate OpenSpec change** — requires file-op extraction from tool call args.

### Task 14 (NEEDS DECISION): Default `steeringMode`/`followUpMode`

**Status:** Product decision. Ours defaults to `"all"` (loop/index.ts:59); pi defaults to `"one-at-a-time"` (agent.ts:212). `"all"` batch-processes all queued steers in one turn; `"one-at-a-time"` interleaves one-steer→one-turn. **Ask the product owner** before changing — this may be intentional for our UX.

---

## Verification Suite (Run After All Phase 1+2 Tasks)

### Full test matrix

```bash
# Agent package
bun vitest run packages/agent/

# Server agent layer
bun vitest run apps/server/src/agent/__tests__/

# Server routes + terminal
cd apps/server && bun test src/__tests__ src/terminal/__tests__

# DB
cd packages/db && bun test

# Gates
bun typecheck
bun x ultracite check
```

### Expected results

| Suite | Current | After Phase 1+2 |
|-------|---------|-----------------|
| agent (vitest) | 72 pass | ~85+ pass (new tests per fix) |
| server agent layer (vitest) | 18 pass | ~22+ pass |
| server routes (bun:test) | 111 pass | 111+ pass |
| db (bun:test) | 23 pass | 23 pass |
| typecheck | clean | clean |
| lint | clean | clean |

---

## OpenSpec Change Slices

After implementing, slice into OpenSpec changes for spec sync:

| Slice | Tasks | Spec capability |
|-------|-------|----------------|
| `agent-runtime-bugfixes` | 1-6 (Phase 1) | `agent-loop`, `agent-streaming` |
| `compaction-serialization` | 8, 9 | `agent-loop` |
| `parallel-tool-execution` | 7 | `agent-loop` |
| `session-concurrency-guard` | 5 | `agent-streaming` |
| `compaction-split-turn` (deferred) | 11 | `agent-loop` |
| `compaction-summary-chaining` (deferred) | 12 | `agent-loop` |

---

## References

- pi agent-core loop: `openspec/references/pi/packages/agent/src/agent-loop.ts`
- pi agent-core types: `openspec/references/pi/packages/agent/src/types.ts`
- pi compaction: `openspec/references/pi/packages/coding-agent/src/core/compaction/compaction.ts`
- pi compaction utils: `openspec/references/pi/packages/coding-agent/src/core/compaction/utils.ts`
- pi session orchestrator: `openspec/references/pi/packages/coding-agent/src/core/agent-session.ts`
- pi-ai types: `node_modules/.bun/@earendil-works+pi-ai@0.79.8*/node_modules/@earendil-works/pi-ai/dist/types.d.ts`
- pi compaction docs: `openspec/references/pi/packages/coding-agent/docs/compaction.md`
