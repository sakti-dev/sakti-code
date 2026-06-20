# Pi-Alignment Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all divergences between our agent loop, tool execution, compaction, and server streaming implementations and pi's proven reference implementation.

**Architecture:** Each task is an independent fix — no cross-task dependencies within a task group. Tasks are grouped by subsystem (agent loop, tool execution, compaction, server). Every fix follows TDD: write the failing test first, then implement until it passes.

**Tech Stack:** TypeScript, Vitest, bun:test, pi-ai

---

## Task 1: Event-lifecycle — close unmatched `message_start` on error/abort (P0 CRITICAL)

**Problem:** `index.ts:155` emits `message_start` for the assistant *before* calling `streamLLMResponse`. On error (`!streamResult.ok` at line 171) and abort (line 179), the code returns without `message_end`. Pi emits both inside `streamAssistantResponse` (`agent-loop.ts:319,342-355,364-366`), guaranteeing pairing.

**Files:**
- Modify: `packages/agent/src/loop/index.ts:141-182`
- Modify: `packages/agent/src/loop/streaming.ts:100-172`
- Test: `packages/agent/src/__tests__/loop-behavior.test.ts:485-578`

**Step 1: Write the failing test — error path emits paired message_start/message_end**

Add to the existing `"Agent loop error/aborted turn persistence"` describe block in `loop-behavior.test.ts`:

```typescript
it("error path: assistant message_start and message_end are paired", async () => {
  const store = createMockStore();
  const s = new MockEventStream();
  const now = Date.now();
  const errorPiMessage: any = {
    role: "assistant",
    content: [{ type: "text", text: "billing exceeded" }],
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage: "billing exceeded",
    api: "openai-completions",
    provider: "openai",
    model: "test",
    timestamp: now,
  };
  s.push({ type: "start", partial: errorPiMessage });
  s.push({ type: "error", reason: "error", error: errorPiMessage });

  vi.mocked(streamSimple).mockReturnValue(s);
  const loop = createAgentLoop({
    sessionId: "s1", model: testModel, tools: [], store,
  });
  const events = await collectEvents(loop.prompt("hi"));

  const assistantStarts = events.filter(
    (e) => e.type === "message_start" && e.message?.role === "assistant"
  );
  const assistantEnds = events.filter(
    (e) => e.type === "message_end" && e.message?.role === "assistant"
  );
  expect(assistantStarts.length).toBe(1);
  expect(assistantEnds.length).toBe(1);
});
```

**Step 2: Run test to verify it fails**

Run: `bun vitest run packages/agent/src/__tests__/loop-behavior.test.ts`
Expected: FAIL — error path currently emits `message_start` without matching `message_end`.

**Step 3: Write failing test — abort path emits paired message_start/message_end**

```typescript
it("abort path: assistant message_start and message_end are paired", async () => {
  const store = createMockStore();
  const s = new MockEventStream();
  const now = Date.now();
  const abortedPiMessage: any = {
    role: "assistant",
    content: [{ type: "text", text: "" }],
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "aborted",
    errorMessage: "aborted",
    api: "openai-completions",
    provider: "openai",
    model: "test",
    timestamp: now,
  };
  s.push({ type: "start", partial: abortedPiMessage });
  s.push({ type: "error", reason: "aborted", error: abortedPiMessage });

  vi.mocked(streamSimple).mockReturnValue(s);
  const loop = createAgentLoop({
    sessionId: "s1", model: testModel, tools: [], store,
  });
  const events = await collectEvents(loop.prompt("hi"));

  const assistantStarts = events.filter(
    (e) => e.type === "message_start" && e.message?.role === "assistant"
  );
  const assistantEnds = events.filter(
    (e) => e.type === "message_end" && e.message?.role === "assistant"
  );
  expect(assistantStarts.length).toBe(1);
  expect(assistantEnds.length).toBe(1);
});
```

**Step 4: Run to verify failure**

Run: `bun vitest run packages/agent/src/__tests__/loop-behavior.test.ts`
Expected: FAIL — abort path also returns without `message_end`.

**Step 5: Implement — move `message_start` inside `streamLLMResponse`, emit `message_end` on all paths**

In `streaming.ts`, modify `consumeStream` to emit `message_start` on the stream's `start` event and `message_end` on all return paths:

```typescript
// In consumeStream, after line 110 (for await (const event of stream)):
// Add handling for "start" event type:

case "start":
  if (event.partial) {
    finalAssistant = mapPiAssistantMessage(event.partial);
    yield evt("message_start", { message: finalAssistant });
  }
  break;
```

And before each `return` in `consumeStream`, emit `message_end`:

```typescript
// Before: return { status: "aborted", finalAssistant: null };
// Replace with:
yield evt("message_end", { message: finalAssistant });
return { status: "aborted", finalAssistant };

// Before: return { status: "error", finalAssistant };  (line 167)
// Add before it:
yield evt("message_end", { message: finalAssistant });
return { status: "error", finalAssistant };

// Before: return { status: "done", finalAssistant };  (line 171)
// Add before it:
yield evt("message_end", { message: finalAssistant });
return { status: "done", finalAssistant };
```

In `index.ts`, **remove** the synthetic `initialAssistant` construction and the `yield evt("message_start", ...)` at line 142-155. Also remove the `yield evt("message_end", ...)` at lines 184-186 since `streamLLMResponse` now handles both.

The error/abort early-return paths (lines 171-177, 179-182) need to yield `turn_end` and `agent_end` before returning (pi pattern at `agent-loop.ts:196-199`). The `!streamResult.ok` path should become:

```typescript
if (!streamResult.ok) {
  if (streamResult.finalAssistant) {
    messages.push(streamResult.finalAssistant);
    await store.appendMessage(sessionId, streamResult.finalAssistant);
  }
  yield evt("turn_end", { turnIndex, message: streamResult.finalAssistant, toolResults: [] });
  yield evt("agent_end", { sessionId });
  return;
}
```

And the abort path:

```typescript
if (signal?.aborted) {
  yield evt("turn_end", { turnIndex, message: streamResult.finalAssistant, toolResults: [] });
  yield evt("agent_end", { sessionId });
  return;
}
```

**Step 6: Run tests to verify they pass**

Run: `bun vitest run packages/agent/src/__tests__/loop-behavior.test.ts`
Expected: PASS

**Step 7: Run full agent suite**

Run: `bun vitest run packages/agent/`
Expected: All pass

**Step 8: Gate check**

Run: `bun typecheck && bun x ultracite check`
Expected: 0 errors, 0 diagnostics

**Step 9: Commit**

```
git add packages/agent/src/loop/index.ts packages/agent/src/loop/streaming.ts packages/agent/src/__tests__/loop-behavior.test.ts
git commit -m "fix(agent-loop): pair message_start/message_end on error/abort paths (pi alignment)

Move message_start emission inside consumeStream (on stream 'start' event)
so message_end can be emitted on every return path (done/error/aborted).
Add turn_end + agent_end to error/abort early-return paths matching pi
agent-loop.ts:196-199. All 104 agent tests pass."
```

---

## Task 2: Event-lifecycle — emit lifecycle events for `followUp` messages (P0)

**Problem:** `injectMessage` at `index.ts:216` and `:261` silently injects follow-up messages without `message_start`/`message_end`. Pi's `runLoop` processes follow-ups via `pendingMessages` with full lifecycle at `agent-loop.ts:182-189`.

**Files:**
- Modify: `packages/agent/src/loop/index.ts:214-222, 259-265`
- Test: `packages/agent/src/__tests__/loop-behavior.test.ts`

**Step 1: Write the failing test**

```typescript
it("wraps each followUp message in message_start/message_end with payload", async () => {
  const store = createMockStore();
  let callCount = 0;
  vi.mocked(streamSimple).mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return textStream("First response");
    }
    return textStream("Second response after followUp");
  });

  const loop = createAgentLoop({
    sessionId: "s1", model: testModel, tools: [], store,
  });

  loop.followUp("follow up message");
  const events = await collectEvents(loop.prompt("initial"));

  const followUpStarts = events.filter(
    (e) =>
      e.type === "message_start" &&
      e.message?.role === "user" &&
      (e.message as any).content === "follow up message"
  );
  const followUpEnds = events.filter(
    (e) =>
      e.type === "message_end" &&
      e.message?.role === "user" &&
      (e.message as any).content === "follow up message"
  );
  expect(followUpStarts.length).toBe(1);
  expect(followUpEnds.length).toBe(1);
});
```

**Step 2: Run to verify failure**

Run: `bun vitest run packages/agent/src/__tests__/loop-behavior.test.ts -t "followUp"`
Expected: FAIL — followUp has no lifecycle events

**Step 3: Implement — yield `message_start`/`message_end` around each followUp injection**

In `index.ts`, replace both followUp injection sites. The first (line 214-222):

```typescript
const followUpMsg = followUpQueue.shift();
if (followUpMsg && !followUpDone) {
  const msg = await injectMessage(messages, followUpMsg);
  yield evt("message_start", { message: msg });
  yield evt("message_end", { message: msg });
  if (resolved.followUpMode === "one-at-a-time") {
    followUpDone = true;
  }
  turnIndex++;
  continue;
}
```

The second (line 259-265):

```typescript
const followUpMsg = followUpQueue.shift();
if (followUpMsg && !followUpDone) {
  const msg = await injectMessage(messages, followUpMsg);
  yield evt("message_start", { message: msg });
  yield evt("message_end", { message: msg });
  if (resolved.followUpMode === "one-at-a-time") {
    followUpDone = true;
  }
}
```

**Step 4: Run to verify pass**

Run: `bun vitest run packages/agent/`
Expected: All pass

**Step 5: Gate check**

Run: `bun typecheck && bun x ultracite check`

**Step 6: Commit**

```
git add packages/agent/src/loop/index.ts packages/agent/src/__tests__/loop-behavior.test.ts
git commit -m "fix(agent-loop): emit message_start/message_end for followUp messages (pi alignment)

Pi processes followUps via pendingMessages with lifecycle events
(agent-loop.ts:182-189). Our injectMessage was silent. Wrap both
injection sites with bracket events."
```

---

## Task 3: Event-lifecycle — emit `turn_end` on error/abort paths (P2)

This is already handled by Task 1 (Step 5 adds `turn_end` to both early-return paths). Verify:

**Step 1: Run full suite**

Run: `bun vitest run packages/agent/`
Expected: All pass (Task 1 implementation covers this)

No separate commit needed — this is part of Task 1.

---

## Task 4: Event-lifecycle — update misleading comment (SUGGESTION)

**Files:**
- Modify: `packages/agent/src/__tests__/loop-behavior.test.ts:237`

**Step 1: Fix comment**

Replace line 237:
```typescript
// Tool execution events occur after the assistant message_end and before the tool-result message_start
```

**Step 2: Commit**

```
git add packages/agent/src/__tests__/loop-behavior.test.ts
git commit -m "fix(tests): clarify comment about tool execution event ordering"
```

---

## Task 5: Tool-batch — emit `tool_execution_update` on error path (P1)

**Problem:** `executeOneTool` only emits `tool_execution_update` in the success path (line 40-46). If the tool throws after accumulating partial output, the accumulated content is used for the error result (line 49-50) but no update event is emitted. Pi flushes queued updates on error (`agent-loop.ts:659`).

**Files:**
- Modify: `packages/agent/src/loop/tool-execution.ts:36-61`
- Test: `packages/agent/src/__tests__/loop-behavior.test.ts`

**Step 1: Write the failing test**

```typescript
it("tool with partial output then error emits tool_execution_update with accumulated content", async () => {
  const store = createMockStore();
  const tool: AgentTool = {
    name: "flaky",
    description: "Flaky tool",
    parameters: { type: "object", properties: {} },
    execute: async (_id, _args, _signal, onUpdate) => {
      onUpdate("partial one");
      onUpdate(" partial two");
      throw new Error("tool exploded");
    },
  };

  vi.mocked(streamSimple).mockImplementation(() => {
    return toolCallStream("flaky", {});
  });

  const loop = createAgentLoop({
    sessionId: "s1", model: testModel, tools: [tool], store,
  });
  const events = await collectEvents(loop.prompt("use flaky"));

  const updateEvents = events.filter(
    (e) => e.type === "tool_execution_update" && (e as any).toolCallId
  );
  expect(updateEvents.length).toBe(1);
  expect((updateEvents[0] as any).accumulated).toBe("partial one partial two");

  const errorEnds = events.filter(
    (e) => e.type === "tool_execution_end" && (e as any).toolName === "flaky"
  );
  expect(errorEnds.length).toBe(1);
  expect((errorEnds[0] as any).result.content).toBe("partial one partial two");
  expect((errorEnds[0] as any).result.isError).toBe(true);
});
```

**Step 2: Run to verify failure**

Run: `bun vitest run packages/agent/src/__tests__/loop-behavior.test.ts -t "flaky"`
Expected: FAIL — no `tool_execution_update` on error path

**Step 3: Implement — emit update in catch block**

In `tool-execution.ts`, add the update emission in the catch block before constructing the error result:

```typescript
catch (err: unknown) {
  let content: string;
  if (accumulated.length > 0) {
    content = accumulated;
  } else if (err instanceof Error) {
    content = err.message;
  } else {
    content = "Tool execution error";
  }
  events.push(
    evt("tool_execution_update", {
      toolCallId: tc.id,
      toolName: tc.name,
      accumulated,
    })
  );
  result = {
    content,
    terminate: false,
    isError: true,
  };
}
```

Note: the update is emitted before the `tool_execution_end`, maintaining order. The `accumulated` string is the same as `content` when `accumulated.length > 0`.

**Step 4: Run to verify pass**

Run: `bun vitest run packages/agent/`

**Step 5: Gate check**

Run: `bun typecheck && bun x ultracite check`

**Step 6: Commit**

```
git add packages/agent/src/loop/tool-execution.ts packages/agent/src/__tests__/loop-behavior.test.ts
git commit -m "fix(tool-execution): emit tool_execution_update on error path (pi alignment)

Pi flushes queued partial updates on tool error (agent-loop.ts:659).
We suppressed them. Emit the update event with accumulated content
in the catch block before the error tool_execution_end."
```

---

## Task 6: Tool-batch — add sequential ordering test with timing (P1)

**Problem:** No test verifies sequential mode runs tools one-at-a-time with ordering guarantees. Pi has explicit slow-tool gate tests (`agent-loop.test.ts:653-734`).

**Files:**
- Test: `packages/agent/src/__tests__/loop-behavior.test.ts`

**Step 1: Write the failing test**

```typescript
it("sequential mode: tools run one at a time in call order", async () => {
  const store = createMockStore();
  const startTimes: number[] = [];

  const toolA: AgentTool = {
    name: "slow",
    description: "Slow tool A",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      startTimes.push(Date.now());
      await new Promise((r) => setTimeout(r, 30));
      return { content: "A done", terminate: false };
    },
  };
  const toolB: AgentTool = {
    name: "fast",
    description: "Fast tool B",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      startTimes.push(Date.now());
      return { content: "B done", terminate: false };
    },
  };

  let callCount = 0;
  vi.mocked(streamSimple).mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return multiToolCallStream([
        { name: "slow", args: {}, id: "tc_1" },
        { name: "fast", args: {}, id: "tc_2" },
      ]);
    }
    return textStream("all done");
  });

  const loop = createAgentLoop({
    sessionId: "s1", model: testModel, tools: [toolA, toolB], store,
    toolExecutionMode: "sequential",
  });
  const events = await collectEvents(loop.prompt("run sequential"));

  expect(startTimes.length).toBe(2);
  // Tool B should start AFTER tool A finishes (30ms sleep + margin)
  expect(startTimes[1]!).toBeGreaterThan(startTimes[0]! + 20);

  // Verify call order in persisted messages
  const toolMsgs = events.filter(
    (e) => e.type === "message_start" && e.message?.role === "tool"
  );
  expect(toolMsgs.length).toBe(2);
  expect((toolMsgs[0]!.message as any).toolCallId).toBe("tc_1");
  expect((toolMsgs[1]!.message as any).toolCallId).toBe("tc_2");
}, 10_000);
```

**Step 2: Run to verify it passes (regression guard)**

Run: `bun vitest run packages/agent/src/__tests__/loop-behavior.test.ts -t "sequential mode: tools run one at a time"`
Expected: PASS — sequential execution already works correctly, we're adding a regression guard

**Step 3: Commit**

```
git add packages/agent/src/__tests__/loop-behavior.test.ts
git commit -m "test(tool-execution): sequential ordering with timing assertion (pi alignment)

Matches pi's slow-tool gate pattern (agent-loop.test.ts:653-734).
Verifies tool B starts after tool A completes when mode is sequential."
```

---

## Task 7: Tool-batch — add all-false-terminate regression test (P1)

**Files:**
- Test: `packages/agent/src/__tests__/loop-behavior.test.ts`

**Step 1: Write the test**

```typescript
it("all-false terminate batch continues the loop to a second turn", async () => {
  const store = createMockStore();
  const tool: AgentTool = {
    name: "go",
    description: "Continues",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: "go", terminate: false }),
  };

  let callCount = 0;
  vi.mocked(streamSimple).mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return multiToolCallStream([
        { name: "go", args: {}, id: "tc_1" },
        { name: "go", args: {}, id: "tc_2" },
      ]);
    }
    return textStream("Continuing after all-false batch");
  });

  const loop = createAgentLoop({
    sessionId: "s1", model: testModel, tools: [tool], store,
  });
  const events = await collectEvents(loop.prompt("all go"));

  // Should have two turns (batch turn + continuation turn)
  const turnEnds = events.filter((e) => e.type === "turn_end");
  expect(turnEnds.length).toBe(2);
  expect(events.some((e) => e.type === "agent_end")).toBe(true);
});
```

**Step 2: Run to verify pass**

Run: `bun vitest run packages/agent/src/__tests__/loop-behavior.test.ts -t "all-false"`

**Step 3: Commit**

```
git add packages/agent/src/__tests__/loop-behavior.test.ts
git commit -m "test(tool-execution): all-false terminate batch continues loop"
```

---

## Task 8: Tool-batch — mark task 1.6 complete in tasks.md

**Files:**
- Modify: `openspec/changes/agent-tool-batch-semantics/tasks.md`

**Step 1: Check and mark**

The gate (`bun typecheck && bun x ultracite check`) passes. Mark task 1.6 as `[x]`.

---

## Task 9: Compaction — add `.filter(Boolean)` before join (P2)

**Problem:** `messageToText` returns `""` for empty messages, causing spurious `\n\n` in the join. Pi uses conditional push in a `parts[]` array (`utils.ts:110-162`).

**Files:**
- Modify: `packages/agent/src/compaction.ts:230`
- Test: `packages/agent/src/__tests__/compaction.test.ts`

**Step 1: Write the failing test for `messageToText` with empty messages**

```typescript
import { describe, expect, it } from "vitest";
import { messageToText } from "../compaction";
import type { AgentMessage } from "../types";

describe("messageToText", () => {
  it("returns empty string for user message with no content", () => {
    const msg: AgentMessage = { role: "user", content: "", timestamp: 1 };
    expect(messageToText(msg)).toBe("");
  });

  it("returns empty string for tool message with empty text", () => {
    const msg: AgentMessage = {
      role: "tool", content: [{ type: "text", text: "" }],
      toolCallId: "tc_1", toolName: "read", isError: false, timestamp: 1,
    };
    expect(messageToText(msg)).toBe("");
  });

  it("join with empty messages should not produce double separators", () => {
    const msgs: AgentMessage[] = [
      { role: "user", content: "hello", timestamp: 1 },
      { role: "tool", content: [{ type: "text", text: "" }],
        toolCallId: "tc_1", toolName: "read", isError: false, timestamp: 2 },
      { role: "user", content: "world", timestamp: 3 },
    ];
    const text = msgs.map(messageToText).filter(Boolean).join("\n\n");
    // Empty tool message filtered out → no double separator
    expect(text).toBe("[User]: hello\n\n[User]: world");
    expect(text).not.toContain("\n\n\n\n");
  });
});
```

**Step 2: Run to verify — test should already PASS with `.filter(Boolean)` in test**

The test itself uses `.filter(Boolean)`. Now implement the same fix in production code.

**Step 3: Implement — add `.filter(Boolean)` to `compaction.ts:230`**

```typescript
const conversationText = historyMessages.map(messageToText).filter(Boolean).join("\n\n");
```

**Step 4: Run full suite**

Run: `bun vitest run packages/agent/`
Expected: All pass

**Step 5: Commit**

```
git add packages/agent/src/compaction.ts packages/agent/src/__tests__/compaction.test.ts
git commit -m "fix(compaction): filter empty messages before join (pi alignment)

Pi's serializeConversation uses conditional push (utils.ts:121).
Our messageToText returns '' for empty content, producing spurious
\\n\\n separators. Add .filter(Boolean) before join."
```

---

## Task 10: Server — update spec to match implementation `error` field (P1)

**Problem:** Spec says error frames use `message` field, implementation uses `error`. Pi has no WS server so this is a self-consistency fix.

**Files:**
- Modify: `openspec/specs/agent-streaming/spec.md:62,85`

**Step 1: Update spec line 62**

Change:
```
or `{type:"error", sessionId, message}`.
```
To:
```
or `{type:"error", sessionId, error}`.
```

**Step 2: Update spec line 85**

Change:
```
{ type: "error", sessionId, message: "No active run" }` frame.
```
To:
```
{ type: "error", sessionId, error: "No active run" }` frame.
```

**Step 3: Commit**

```
git add openspec/specs/agent-streaming/spec.md
git commit -m "docs(spec): align error frame field name with implementation ('error' not 'message')"
```

---

## Task 11: Server — eliminate redundant `getForProject` re-query (P1)

**Problem:** `runner.ts:104` calls `ctx.repos.models.getForProject(session.projectId)` again to get the provider for `getEnvApiKey`, even though `resolveModel` already called it. If repo behavior changes, the provider string could be wrong.

**Files:**
- Modify: `apps/server/src/agent/model-resolver.ts:8-23`
- Modify: `apps/server/src/agent/runner.ts:98-106`

**Step 1: Write the failing test**

In `runner.test.ts`, add a test that verifies `getForProject` is called exactly once:

```typescript
it("resolveModel is called once — no redundant getForProject re-query", async () => {
  const ctx = createMockCtx();
  getEnvApiKeyMock.mockReturnValue("key");

  const store = createMockStore();
  getModelMock.mockReturnValue(createTestModel());
  streamSimpleMock.mockReturnValue(createTextStream("ok"));
  (ctx.repos.models.getForProject as ReturnType<typeof vi.fn>).mockClear();

  for await (const _event of runPrompt(ctx, "sess-1", "hi", store)) {
    // consume
  }

  // getForProject should be called exactly once (inside resolveModel)
  expect(ctx.repos.models.getForProject).toHaveBeenCalledTimes(1);
});
```

**Step 2: Run to verify failure**

Run: `bun vitest run apps/server/src/agent/__tests__/runner.test.ts -t "resolveModel"`
Expected: FAIL — currently called twice (once in resolveModel, once in runner line 104)

**Step 3: Implement — have `resolveModel` return the provider string**

Modify `model-resolver.ts` to return both the model and the provider:

```typescript
export interface ResolvedModel {
  model: AnyModel;
  provider: string;
}

export function resolveModel(
  ctx: ServerContext,
  session: { projectId: string }
): ResolvedModel {
  const config = ctx.repos.models.getForProject(session.projectId);
  if (config) {
    return {
      model: getModelAny(config.provider, config.modelId) as AnyModel,
      provider: config.provider,
    };
  }
  const global = ctx.repos.models.getGlobalDefault();
  if (global) {
    return {
      model: getModelAny(global.provider, global.modelId) as AnyModel,
      provider: global.provider,
    };
  }
  throw new Error(
    `No model config found for project ${session.projectId} and no global default`
  );
}
```

Modify `runner.ts:98-106`:

```typescript
const { model, provider } = resolveModel(ctx, session);
const tools = buildTools(project.cwd);

const apiKey = getEnvApiKey(provider) ?? undefined;
```

**Step 4: Run to verify pass**

Run: `cd apps/server && bun run test src/__tests__/runner.test.ts`

**Step 5: Run full server suite**

Run: `cd apps/server && bun test src/__tests__/`
Expected: All pass

**Step 6: Gate check**

Run: `bun typecheck && bun x ultracite check`

**Step 7: Commit**

```
git add apps/server/src/agent/model-resolver.ts apps/server/src/agent/runner.ts apps/server/src/agent/__tests__/runner.test.ts
git commit -m "fix(server): eliminate redundant getForProject re-query in runner

resolveModel now returns { model, provider } so runner doesn't need
a second getForProject call for the API key resolution. Prevents
fragility if repo fallback behavior changes."
```

---

## Task 12: Server — add unhandled rejection guard on fire-and-forget (P1)

**Problem:** `ws-handler.ts:147` fires `runAgentStream(...)` without awaiting. If the catch block inside somehow fails (e.g., `ws.send` throws after WS close), the promise becomes unhandled.

**Files:**
- Modify: `apps/server/src/agent/ws-handler.ts:147`

**Step 1: Implement — add `.catch()`**

```typescript
runAgentStream(ctx, msg.sessionId, msg.message, store, ws).catch(() => {
  // Fire-and-forget: errors are already sent as error frames
  // inside runAgentStream's catch. This guards against send failures
  // (e.g., WS already closed) causing unhandled promise rejections.
});
```

**Step 2: Run server tests**

Run: `cd apps/server && bun test src/__tests__/`
Expected: All pass

**Step 3: Commit**

```
git add apps/server/src/agent/ws-handler.ts
git commit -m "fix(server): add unhandled rejection guard on fire-and-forget runAgentStream"
```

---

## Task 13: Server — add "unknown project" test (P1)

**Files:**
- Test: `apps/server/src/agent/__tests__/runner.test.ts`

**Step 1: Write the test**

```typescript
it("unknown project throws Project not found", async () => {
  const ctx = createMockCtx();
  // Override project to return null for the session's projectId
  (ctx.repos.projects.findById as ReturnType<typeof vi.fn>).mockImplementation(
    async (id: string) => {
      if (id === "proj-1") return null; // the session's project
      return createMockCtx().repos.projects.findById(id);
    }
  );
  const store = createMockStore();
  getModelMock.mockReturnValue(createTestModel());

  await expect(
    (async () => {
      for await (const _event of runPrompt(ctx, "sess-1", "test", store)) {
        // consume
      }
    })()
  ).rejects.toThrow(/Project not found/);
});
```

**Step 2: Run to verify pass (code already handles this)**

Run: `cd apps/server && bun run test src/__tests__/runner.test.ts -t "unknown project"`

**Step 3: Commit**

```
git add apps/server/src/agent/__tests__/runner.test.ts
git commit -m "test(server): unknown project throws Project not found"
```

---

## Task 14: Final gate — all packages

**Step 1: Typecheck**

Run: `bun typecheck`

**Step 2: Lint**

Run: `bun x ultracite check`

**Step 3: Agent tests**

Run: `bun vitest run packages/agent/`

**Step 4: DB tests**

Run: `cd packages/db && bun test`

**Step 5: Server tests**

Run: `cd apps/server && bun test src/__tests__/`

**Step 6: If all green, commit any remaining file changes (tasks.md, etc.)**

---

## Execution Checklist

| # | Task | Status |
|---|------|--------|
| 1 | Close unmatched `message_start` on error/abort | pending |
| 2 | Emit lifecycle events for followUp | pending |
| 3 | Emit `turn_end` on error/abort (part of Task 1) | pending |
| 4 | Fix misleading comment | pending |
| 5 | Emit `tool_execution_update` on error path | pending |
| 6 | Sequential ordering test with timing | pending |
| 7 | All-false terminate regression test | pending |
| 8 | Mark task 1.6 complete | pending |
| 9 | `.filter(Boolean)` before compaction join | pending |
| 10 | Update spec `error` field name | pending |
| 11 | Eliminate redundant `getForProject` re-query | pending |
| 12 | Unhandled rejection guard on fire-and-forget | pending |
| 13 | Unknown project test | pending |
| 14 | Final gate — all packages | pending |
