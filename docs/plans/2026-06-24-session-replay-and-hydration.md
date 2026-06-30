# Session Replay & Hydration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable a dev-only "Replay" button that streams a recorded session through the WS event pipeline word-by-word (including thinking), plus fix message hydration so reopening a project shows full history (thinking, tool calls, tool results).

**Architecture:** Server-side replay runner converts JSONL session entries into `AgentHarnessEvent`s emitted via the existing WS `EventFrame` protocol. Frontend changes are minimal: one dev-only button + event-reducer fixes. Hydration fixes ensure `GET /api/sessions/:id/messages` data is properly converted to UIMessages with all part types.

**Tech Stack:** SolidJS (frontend), Hono WS (server), pi-ai `AssistantMessageEvent` protocol (thinking_delta/text_delta), vitest (testing), node:sqlite (session storage).

---

## Key Files Reference

| File                                                                | Role                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------- |
| `apps/desktop/src/stores/session/session-store.ts`                  | UI message state + actions                                    |
| `apps/desktop/src/stores/session/event-reducer.ts`                  | Converts AgentHarnessEvents → store actions                   |
| `apps/desktop/src/stores/types.ts`                                  | `UIMessage`, `MessagePart`, `StreamState`, `agentMessageToUI` |
| `apps/desktop/src/stores/__tests__/helpers.ts`                      | Test factories for events/messages                            |
| `apps/desktop/src/stores/server/actions.ts`                         | `loadMessages`, `sendPrompt`, WS actions                      |
| `apps/desktop/src/stores/server/ws-client.ts`                       | WS client, `handleFrame`                                      |
| `apps/desktop/src/stores/store-context.tsx`                         | Store wiring                                                  |
| `apps/desktop/src/components/chat/task-chat-view.tsx`               | Session chat view (needs loadMessages on mount)               |
| `apps/desktop/src/components/chat/tools/tool-summary-formatters.ts` | Per-tool summary text                                         |
| `apps/desktop/src/components/layout/toolbar/toolbar.tsx`            | Toolbar (add replay button)                                   |
| `apps/server/src/agent/ws-handler.ts`                               | WS message types + `handleMessage`                            |
| `apps/server/src/agent/runner.ts`                                   | Agent run lifecycle, `activeRuns` map                         |
| `apps/server/src/agent/ws.ts`                                       | WS app, connection management                                 |
| `apps/server/src/routes/sessions/sessions.ts`                       | `GET /:id/messages` endpoint                                  |
| `packages/agent/src/harness/session.ts`                             | `buildSessionContext` (entry tree → messages)                 |
| `packages/agent/src/harness/types.ts`                               | `AgentHarnessEvent`, `SessionTreeEntry` types                 |

## Data Profile (from `replay.jsonl`)

- **5,160 messages**: 2,550 assistant, 2,202 toolResult, 408 user
- **10 tools**: bash (959), read (546), edit (540), write (86), vscode_get_diagnostics (30), TaskUpdate (21), TaskCreate (13), webfetch (9), glob (1), BrowserNavigate (1)
- **801 thinking blocks** (max 60k chars) — currently dropped entirely
- **Edit results** carry `{ diff, firstChangedLine }` details — currently dropped
- **Turn structure**: user → assistant(toolCall) → toolResult × N → assistant → ... → assistant(text, stop)

---

## Phase A: Pipeline Fixes (Streaming + Thinking)

These fixes are prerequisites for both replay AND real agent runs. Thinking is silently dropped today; tool result details are lost.

### Task 1: Add `appendThinkingToken` action to session store

**Files:**

- Modify: `apps/desktop/src/stores/session/session-store.ts`
- Test: `apps/desktop/src/stores/session/__tests__/session-store.test.ts`

**Step 1: Write the failing test**

Add to `apps/desktop/src/stores/session/__tests__/session-store.test.ts`:

```typescript
describe("session store — appendThinkingToken", () => {
  it("creates a thinking part if none exists", () => {
    const session = createSessionStore();
    session.actions.addMessage({
      id: "msg-1",
      role: "assistant",
      content: "",
      parts: [],
      isStreaming: true,
      timestamp: Date.now(),
    });

    session.actions.appendThinkingToken("msg-1", "I should ");

    expect(session.store.messages["msg-1"]!.parts).toEqual([
      { type: "thinking", text: "I should " },
    ]);
  });

  it("appends to existing thinking part", () => {
    const session = createSessionStore();
    session.actions.addMessage({
      id: "msg-1",
      role: "assistant",
      content: "",
      parts: [{ type: "thinking", text: "I should " }],
      isStreaming: true,
      timestamp: Date.now(),
    });

    session.actions.appendThinkingToken("msg-1", "consider ");

    expect(session.store.messages["msg-1"]!.parts).toEqual([
      { type: "thinking", text: "I should consider " },
    ]);
  });

  it("creates new thinking part when last part is text", () => {
    const session = createSessionStore();
    session.actions.addMessage({
      id: "msg-1",
      role: "assistant",
      content: "Hello",
      parts: [{ type: "text", text: "Hello" }],
      isStreaming: true,
      timestamp: Date.now(),
    });

    session.actions.appendThinkingToken("msg-1", "Wait ");

    expect(session.store.messages["msg-1"]!.parts).toHaveLength(2);
    expect(session.store.messages["msg-1"]!.parts[1]).toEqual({
      type: "thinking",
      text: "Wait ",
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/stores/session/__tests__/session-store.test.ts -t "appendThinkingToken"`
Expected: FAIL — `appendThinkingToken` is not a function

**Step 3: Write minimal implementation**

In `apps/desktop/src/stores/session/session-store.ts`, add to the `SessionActions` interface (alphabetically after `appendToken`):

```typescript
appendThinkingToken: (msgId: string, delta: string) => void;
```

Add to the `actions` object (after `appendToken`):

```typescript
appendThinkingToken(msgId, delta) {
  setStore("messages", msgId, "parts", (prev) => {
    const last = prev.at(-1);
    if (last !== undefined && last.type === "thinking") {
      return [...prev.slice(0, -1), { ...last, text: last.text + delta }];
    }
    return [...prev, { type: "thinking" as const, text: delta }];
  });
},
```

**Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/stores/session/__tests__/session-store.test.ts -t "appendThinkingToken"`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/stores/session/session-store.ts apps/desktop/src/stores/session/__tests__/session-store.test.ts
git commit -m "feat(desktop): add appendThinkingToken action to session store"
```

---

### Task 2: Add `wasLastUserMessage` action to session store

**Files:**

- Modify: `apps/desktop/src/stores/session/session-store.ts`
- Test: `apps/desktop/src/stores/session/__tests__/session-store.test.ts`

**Step 1: Write the failing test**

Add to `apps/desktop/src/stores/session/__tests__/session-store.test.ts`:

```typescript
describe("session store — wasLastUserMessage", () => {
  it("returns true when last message is user with matching content", () => {
    const session = createSessionStore();
    session.actions.addMessage({
      id: "msg-1",
      role: "user",
      content: "hello world",
      parts: [{ type: "text", text: "hello world" }],
      isStreaming: false,
      timestamp: Date.now(),
    });

    expect(session.actions.wasLastUserMessage("hello world")).toBe(true);
  });

  it("returns false when last message is assistant", () => {
    const session = createSessionStore();
    session.actions.addMessage({
      id: "msg-1",
      role: "assistant",
      content: "hi",
      parts: [{ type: "text", text: "hi" }],
      isStreaming: false,
      timestamp: Date.now(),
    });

    expect(session.actions.wasLastUserMessage("hi")).toBe(false);
  });

  it("returns false when last user message has different content", () => {
    const session = createSessionStore();
    session.actions.addMessage({
      id: "msg-1",
      role: "user",
      content: "hello",
      parts: [{ type: "text", text: "hello" }],
      isStreaming: false,
      timestamp: Date.now(),
    });

    expect(session.actions.wasLastUserMessage("goodbye")).toBe(false);
  });

  it("returns false when store is empty", () => {
    const session = createSessionStore();
    expect(session.actions.wasLastUserMessage("anything")).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/stores/session/__tests__/session-store.test.ts -t "wasLastUserMessage"`
Expected: FAIL — `wasLastUserMessage` is not a function

**Step 3: Write minimal implementation**

In `apps/desktop/src/stores/session/session-store.ts`, add to the `SessionActions` interface:

```typescript
wasLastUserMessage: (text: string) => boolean;
```

Add to the `actions` object:

```typescript
wasLastUserMessage(text) {
  const lastId = store.messageOrder.at(-1);
  if (!lastId) {
    return false;
  }
  const lastMsg = store.messages[lastId];
  return lastMsg?.role === "user" && lastMsg.content === text;
},
```

**Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/stores/session/__tests__/session-store.test.ts -t "wasLastUserMessage"`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/stores/session/session-store.ts apps/desktop/src/stores/session/__tests__/session-store.test.ts
git commit -m "feat(desktop): add wasLastUserMessage guard to session store"
```

---

### Task 3: Handle `thinking_delta` in event-reducer

**Files:**

- Modify: `apps/desktop/src/stores/session/event-reducer.ts:79-84`
- Modify: `apps/desktop/src/stores/__tests__/helpers.ts` (add thinking_delta factory)
- Test: `apps/desktop/src/stores/session/__tests__/event-reducer.test.ts`

**Step 1: Add test helper for thinking_delta events**

In `apps/desktop/src/stores/__tests__/helpers.ts`, add after `makeMessageUpdateTextDeltaEvent`:

```typescript
export function makeMessageUpdateThinkingDeltaEvent(
  message: AgentMessage,
  delta: string,
): AgentHarnessEvent {
  return {
    type: "message_update",
    message,
    assistantMessageEvent: {
      type: "thinking_delta",
      contentIndex: 0,
      delta,
      partial: message,
    },
  } as AgentHarnessEvent;
}
```

**Step 2: Write the failing test**

Add to `apps/desktop/src/stores/session/__tests__/event-reducer.test.ts` (add the import for the new helper):

```typescript
import {
  // ... existing imports ...
  makeMessageUpdateThinkingDeltaEvent,
} from "../../__tests__/helpers.ts";
```

Add the test:

```typescript
it("message_update thinking_delta appends to thinking part", () => {
  const { session, batcher } = setup();
  const msg = makeAssistantMessage("");
  dispatchEvent(session.actions, batcher, makeMessageStartEvent(msg));
  const msgId = session.store.streaming.currentMessageId!;

  dispatchEvent(
    session.actions,
    batcher,
    makeMessageUpdateThinkingDeltaEvent(msg, "Let me think "),
  );
  dispatchEvent(session.actions, batcher, makeMessageUpdateThinkingDeltaEvent(msg, "about this"));

  const parts = session.store.messages[msgId]!.parts;
  expect(parts).toHaveLength(1);
  expect(parts[0]!.type).toBe("thinking");
  expect((parts[0] as { text: string }).text).toBe("Let me think about this");
});
```

**Step 3: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/stores/session/__tests__/event-reducer.test.ts -t "thinking_delta"`
Expected: FAIL — thinking_delta events are ignored; parts array stays empty

**Step 4: Write minimal implementation**

In `apps/desktop/src/stores/session/event-reducer.ts`, modify the `message_update` case (around line 79):

```typescript
case "message_update": {
  const msgId = actions.getCurrentMessageId();
  if (!msgId) {
    break;
  }
  if (event.assistantMessageEvent.type === "text_delta") {
    batcher.append(msgId, event.assistantMessageEvent.delta);
  } else if (event.assistantMessageEvent.type === "thinking_delta") {
    actions.appendThinkingToken(msgId, event.assistantMessageEvent.delta);
  }
  break;
}
```

**Step 5: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/stores/session/__tests__/event-reducer.test.ts -t "thinking_delta"`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/desktop/src/stores/session/event-reducer.ts apps/desktop/src/stores/__tests__/helpers.ts apps/desktop/src/stores/session/__tests__/event-reducer.test.ts
git commit -m "feat(desktop): handle thinking_delta events in event-reducer"
```

---

### Task 4: Handle user `message_start` in event-reducer

**Files:**

- Modify: `apps/desktop/src/stores/session/event-reducer.ts:29-48`
- Test: `apps/desktop/src/stores/session/__tests__/event-reducer.test.ts`

**Step 1: Write the failing test**

Add to `apps/desktop/src/stores/session/__tests__/event-reducer.test.ts`:

```typescript
it("message_start for user adds user message when not duplicate", () => {
  const { session, batcher } = setup();
  const userMsg = {
    role: "user",
    content: "hello world",
    timestamp: Date.now(),
  } as AgentMessage;
  dispatchEvent(session.actions, batcher, makeMessageStartEvent(userMsg));

  expect(session.store.messageOrder).toHaveLength(1);
  const msgId = session.store.messageOrder[0]!;
  expect(session.store.messages[msgId]!.role).toBe("user");
  expect(session.store.messages[msgId]!.content).toBe("hello world");
});

it("message_start for user skips when sendPrompt already added it", () => {
  const { session, batcher } = setup();
  // Simulate sendPrompt adding the user message optimistically
  session.actions.addMessage({
    id: "pre-added",
    role: "user",
    content: "hello world",
    parts: [{ type: "text", text: "hello world" }],
    isStreaming: false,
    timestamp: Date.now(),
  });

  const userMsg = {
    role: "user",
    content: "hello world",
    timestamp: Date.now(),
  } as AgentMessage;
  dispatchEvent(session.actions, batcher, makeMessageStartEvent(userMsg));

  // Should NOT add a duplicate
  expect(session.store.messageOrder).toHaveLength(1);
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/stores/session/__tests__/event-reducer.test.ts -t "message_start for user"`
Expected: FAIL — user messages are still skipped

**Step 3: Write minimal implementation**

In `apps/desktop/src/stores/session/event-reducer.ts`, modify `handleMessageStart` (line 29):

```typescript
function handleMessageStart(actions: SessionActions, message: AgentMessage): void {
  if (message.role === "user") {
    const text = extractTextContent(message);
    if (actions.wasLastUserMessage(text)) {
      return;
    }
    actions.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      parts: [{ type: "text", text }],
      isStreaming: false,
      timestamp: typeof message.timestamp === "number" ? message.timestamp : Date.now(),
    });
    return;
  }

  if (message.role !== "assistant") {
    return;
  }
  const msgId = crypto.randomUUID();
  const text = extractTextContent(message);
  actions.addMessage({
    id: msgId,
    role: "assistant",
    content: text,
    parts: text ? [{ type: "text", text }] : [],
    isStreaming: true,
    timestamp: Date.now(),
  });
  actions.setCurrentMessage(msgId);
  actions.setPhase("writing");
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/stores/session/__tests__/event-reducer.test.ts -t "message_start for user"`
Expected: PASS

**Step 5: Run full test suite to check for regressions**

Run: `cd apps/desktop && nub run test`
Expected: ALL PASS (existing "message_start for user is skipped" test needs updating — it now ADDS the message instead of skipping. Update the test to reflect the new behavior.)

**Step 6: Fix the existing test that expected skip behavior**

In `apps/desktop/src/stores/session/__tests__/event-reducer.test.ts`, update the existing test:

```typescript
it("message_start for user adds user message from event stream", () => {
  const { session, batcher } = setup();
  const userMsg = {
    role: "user",
    content: "hello",
    timestamp: Date.now(),
  } as AgentMessage;
  dispatchEvent(session.actions, batcher, makeMessageStartEvent(userMsg));
  expect(session.store.messageOrder).toHaveLength(1);
  expect(session.store.messages[session.store.messageOrder[0]!]!.role).toBe("user");
});
```

**Step 7: Run full suite again**

Run: `cd apps/desktop && nub run test`
Expected: ALL PASS

**Step 8: Commit**

```bash
git add apps/desktop/src/stores/session/event-reducer.ts apps/desktop/src/stores/session/__tests__/event-reducer.test.ts
git commit -m "feat(desktop): handle user message_start in event-reducer with duplicate guard"
```

---

### Task 5: Add `details` to tool_call MessagePart + `completeToolCall`

**Files:**

- Modify: `apps/desktop/src/stores/types.ts:8-17` (MessagePart type)
- Modify: `apps/desktop/src/stores/session/session-store.ts:33-38,143-156`
- Test: `apps/desktop/src/stores/session/__tests__/session-store.test.ts`

**Step 1: Write the failing test**

Add to `apps/desktop/src/stores/session/__tests__/session-store.test.ts`:

```typescript
describe("session store — completeToolCall with details", () => {
  it("stores details when provided", () => {
    const session = createSessionStore();
    session.actions.addMessage({
      id: "msg-1",
      role: "assistant",
      content: "",
      parts: [
        {
          type: "tool_call",
          toolCallId: "call-1",
          toolName: "edit",
          input: { path: "/test.ts" },
          status: "running",
        },
      ],
      isStreaming: true,
      timestamp: Date.now(),
    });

    const diff = "--- old\n+++ new";
    session.actions.completeToolCall("msg-1", "call-1", "Edited /test.ts", false, diff);

    const part = session.store.messages["msg-1"]!.parts[0]!;
    expect(part.type).toBe("tool_call");
    expect((part as { details?: unknown }).details).toBe(diff);
  });

  it("works without details (backward compatible)", () => {
    const session = createSessionStore();
    session.actions.addMessage({
      id: "msg-1",
      role: "assistant",
      content: "",
      parts: [
        {
          type: "tool_call",
          toolCallId: "call-1",
          toolName: "bash",
          input: { command: "ls" },
          status: "running",
        },
      ],
      isStreaming: true,
      timestamp: Date.now(),
    });

    session.actions.completeToolCall("msg-1", "call-1", "output", false);

    const part = session.store.messages["msg-1"]!.parts[0]!;
    expect(part.type).toBe("tool_call");
    expect((part as { details?: unknown }).details).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/stores/session/__tests__/session-store.test.ts -t "completeToolCall with details"`
Expected: FAIL — `completeToolCall` doesn't accept a 5th param

**Step 3: Write minimal implementation**

In `apps/desktop/src/stores/types.ts`, update the tool_call MessagePart (line 10-17):

```typescript
export type MessagePart =
  | { type: "text"; text: string }
  | {
      details?: unknown;
      type: "tool_call";
      toolCallId: string;
      toolName: string;
      input: unknown;
      status: "running" | "done" | "error";
      result?: string;
    }
  | { type: "thinking"; text: string };
```

In `apps/desktop/src/stores/session/session-store.ts`, update the `SessionActions` interface (line 33-38):

```typescript
completeToolCall: (
  msgId: string,
  toolCallId: string,
  result: string,
  isError?: boolean,
  details?: unknown
) => void;
```

Update the implementation (around line 143):

```typescript
completeToolCall(msgId, toolCallId, result, isError = false, details) {
  setStore("messages", msgId, "parts", (prev) =>
    prev.map((p) =>
      p.type === "tool_call" && p.toolCallId === toolCallId
        ? {
            ...p,
            status: isError ? ("error" as const) : ("done" as const),
            result,
            ...(details !== undefined ? { details } : {}),
          }
        : p
    )
  );
  setStore("streaming", "currentToolName", null);
},
```

**Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/stores/session/__tests__/session-store.test.ts -t "completeToolCall with details"`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/stores/types.ts apps/desktop/src/stores/session/session-store.ts apps/desktop/src/stores/session/__tests__/session-store.test.ts
git commit -m "feat(desktop): add details field to tool_call MessagePart"
```

---

### Task 6: Extract details in `handleToolExecutionEnd`

**Files:**

- Modify: `apps/desktop/src/stores/session/event-reducer.ts:50-63`
- Test: `apps/desktop/src/stores/session/__tests__/event-reducer.test.ts`

**Step 1: Write the failing test**

Add to `apps/desktop/src/stores/session/__tests__/event-reducer.test.ts`:

```typescript
it("tool_execution_end extracts content text from structured result", () => {
  const { session, batcher } = setup();
  const msg = makeAssistantMessageWithToolCall("", {
    id: "call-1",
    name: "bash",
    args: { command: "echo hello" },
  });
  dispatchEvent(session.actions, batcher, makeMessageStartEvent(msg));
  dispatchEvent(
    session.actions,
    batcher,
    makeToolExecutionStartEvent("call-1", "bash", { command: "echo hello" }),
  );

  dispatchEvent(
    session.actions,
    batcher,
    makeToolExecutionEndEvent("call-1", "bash", {
      content: [{ type: "text", text: "hello\n" }],
      details: { truncation: false },
    }),
  );

  const part = session.store.messages[session.store.messageOrder[0]!]!.parts[0]!;
  expect(part.type).toBe("tool_call");
  expect((part as { result?: string }).result).toBe("hello\n");
  expect((part as { details?: unknown }).details).toEqual({
    truncation: false,
  });
});

it("tool_execution_end falls back to stringify for primitive result", () => {
  const { session, batcher } = setup();
  const msg = makeAssistantMessageWithToolCall("", {
    id: "call-1",
    name: "bash",
    args: { command: "echo" },
  });
  dispatchEvent(session.actions, batcher, makeMessageStartEvent(msg));
  dispatchEvent(
    session.actions,
    batcher,
    makeToolExecutionStartEvent("call-1", "bash", { command: "echo" }),
  );

  dispatchEvent(
    session.actions,
    batcher,
    makeToolExecutionEndEvent("call-1", "bash", "plain string result"),
  );

  const part = session.store.messages[session.store.messageOrder[0]!]!.parts[0]!;
  expect((part as { result?: string }).result).toBe("plain string result");
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/stores/session/__tests__/event-reducer.test.ts -t "extracts content text"`
Expected: FAIL — result is JSON.stringify'd, not extracted from content array

**Step 3: Write minimal implementation**

In `apps/desktop/src/stores/session/event-reducer.ts`, replace `handleToolExecutionEnd` (line 50-63):

```typescript
function handleToolExecutionEnd(
  actions: SessionActions,
  event: Extract<AgentHarnessEvent, { type: "tool_execution_end" }>,
): void {
  const msgId = actions.getCurrentMessageId();
  if (!msgId) {
    return;
  }

  const result = event.result;
  let resultText: string;
  let details: unknown;

  if (
    result !== null &&
    typeof result === "object" &&
    "content" in result &&
    Array.isArray((result as { content: unknown }).content)
  ) {
    const content = (result as { content: unknown[] }).content;
    resultText = content
      .filter(
        (c): c is { type: "text"; text: string } =>
          c !== null && typeof c === "object" && "type" in c && c.type === "text",
      )
      .map((c) => c.text)
      .join("");
    details = (result as { details?: unknown }).details;
  } else if (typeof result === "object" && result !== null) {
    resultText = JSON.stringify(result);
  } else {
    resultText = String(result);
  }

  actions.completeToolCall(msgId, event.toolCallId, resultText, event.isError, details);
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/stores/session/__tests__/event-reducer.test.ts -t "tool_execution_end extracts"`
Expected: PASS

**Step 5: Run full suite for regressions**

Run: `cd apps/desktop && nub run test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add apps/desktop/src/stores/session/event-reducer.ts apps/desktop/src/stores/session/__tests__/event-reducer.test.ts
git commit -m "feat(desktop): extract content + details from tool_execution_end results"
```

---

## Phase B: REST Hydration (Re-open Project)

Fix the hydration path so reopening a project shows full message history with thinking, tool calls, and tool results.

### Task 7: Create `hydrateSessionMessages` function

**Files:**

- Create: `apps/desktop/src/stores/session/hydrate-messages.ts`
- Test: `apps/desktop/src/stores/session/__tests__/hydrate-messages.test.ts`

**Step 1: Write the failing test**

Create `apps/desktop/src/stores/session/__tests__/hydrate-messages.test.ts`:

```typescript
import type { AgentMessage } from "@sakti-code/agent";
import { describe, expect, it } from "vitest";
import { hydrateSessionMessages } from "../hydrate-messages.ts";

describe("hydrateSessionMessages", () => {
  it("converts user message to UIMessage", () => {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: "hello world",
        timestamp: 1700000000000,
      } as AgentMessage,
    ];

    const result = hydrateSessionMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("user");
    expect(result[0]!.content).toBe("hello world");
    expect(result[0]!.parts).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("converts assistant message with thinking + text + toolCall", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me think" },
          { type: "text", text: "Running bash" },
          {
            type: "toolCall",
            id: "call-1",
            name: "bash",
            arguments: { command: "ls" },
          },
        ],
        timestamp: 1700000000000,
      } as AgentMessage,
    ];

    const result = hydrateSessionMessages(messages);
    expect(result).toHaveLength(1);
    const msg = result[0]!;
    expect(msg.role).toBe("assistant");
    expect(msg.parts).toHaveLength(3);
    expect(msg.parts[0]!).toEqual({ type: "thinking", text: "Let me think" });
    expect(msg.parts[1]!).toEqual({ type: "text", text: "Running bash" });
    expect(msg.parts[2]!.type).toBe("tool_call");
    expect((msg.parts[2] as { status: string }).status).toBe("running");
  });

  it("merges toolResult into preceding assistant tool_call part", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-1",
            name: "edit",
            arguments: { path: "/test.ts" },
          },
        ],
        timestamp: 1700000000000,
      } as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "edit",
        content: [{ type: "text", text: "Edited /test.ts" }],
        details: { diff: "--- old\n+++ new", firstChangedLine: 5 },
        isError: false,
        timestamp: 1700000001000,
      } as AgentMessage,
    ];

    const result = hydrateSessionMessages(messages);
    expect(result).toHaveLength(1);
    const part = result[0]!.parts[0]!;
    expect(part.type).toBe("tool_call");
    expect((part as { status: string }).status).toBe("done");
    expect((part as { result?: string }).result).toBe("Edited /test.ts");
    expect((part as { details?: unknown }).details).toEqual({
      diff: "--- old\n+++ new",
      firstChangedLine: 5,
    });
  });

  it("marks tool_call as error when toolResult has isError", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-1",
            name: "edit",
            arguments: { path: "/test.ts" },
          },
        ],
        timestamp: 1700000000000,
      } as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "edit",
        content: [{ type: "text", text: "Could not find text" }],
        isError: true,
        timestamp: 1700000001000,
      } as AgentMessage,
    ];

    const result = hydrateSessionMessages(messages);
    const part = result[0]!.parts[0]!;
    expect((part as { status: string }).status).toBe("error");
  });

  it("preserves full conversation: user → assistant(toolCall) → toolResult → assistant(text)", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "list files", timestamp: 1 } as AgentMessage,
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check" },
          {
            type: "toolCall",
            id: "c1",
            name: "bash",
            arguments: { command: "ls" },
          },
        ],
        timestamp: 2,
      } as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "bash",
        content: [{ type: "text", text: "file1\nfile2" }],
        isError: false,
        timestamp: 3,
      } as AgentMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "Found 2 files" }],
        timestamp: 4,
      } as AgentMessage,
    ];

    const result = hydrateSessionMessages(messages);
    expect(result).toHaveLength(3); // user, assistant(with tool), assistant(text)
    expect(result[0]!.role).toBe("user");
    expect(result[1]!.role).toBe("assistant");
    expect(result[1]!.parts).toHaveLength(2); // text + tool_call(done)
    expect(result[2]!.role).toBe("assistant");
    expect(result[2]!.parts).toHaveLength(1); // text only
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/stores/session/__tests__/hydrate-messages.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `apps/desktop/src/stores/session/hydrate-messages.ts`:

```typescript
import type { AgentMessage } from "@sakti-code/agent";
import type { MessagePart, UIMessage } from "../types.ts";

function extractText(msg: AgentMessage): string {
  const { content } = msg;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(
        (c): c is { type: "text"; text: string } =>
          c !== null && typeof c === "object" && "type" in c && c.type === "text",
      )
      .map((c) => c.text)
      .join("");
  }
  return "";
}

function getTimestamp(msg: AgentMessage): number {
  return typeof msg.timestamp === "number" ? msg.timestamp : Date.now();
}

function convertAssistantMessage(msg: AgentMessage): UIMessage {
  const parts: MessagePart[] = [];
  let textContent = "";

  const content = Array.isArray(msg.content) ? msg.content : [];
  for (const part of content) {
    if (part !== null && typeof part === "object" && "type" in part && part.type === "thinking") {
      const thinking = (part as { thinking?: string }).thinking;
      if (thinking) {
        parts.push({ type: "thinking", text: thinking });
      }
    } else if (
      part !== null &&
      typeof part === "object" &&
      "type" in part &&
      part.type === "text"
    ) {
      const text = (part as { text?: string }).text ?? "";
      parts.push({ type: "text", text });
      textContent += text;
    } else if (
      part !== null &&
      typeof part === "object" &&
      "type" in part &&
      part.type === "toolCall"
    ) {
      const tc = part as {
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      };
      parts.push({
        type: "tool_call",
        toolCallId: tc.id,
        toolName: tc.name,
        input: tc.arguments,
        status: "running",
      });
    }
  }

  if (typeof msg.content === "string") {
    textContent = msg.content;
    parts.unshift({ type: "text", text: msg.content });
  }

  const usage =
    "usage" in msg && msg.usage
      ? {
          input: (msg.usage as { input: number }).input,
          output: (msg.usage as { output: number }).output,
          cost: (msg.usage as { cost: { total: number } }).cost.total,
        }
      : undefined;

  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content: textContent,
    parts,
    isStreaming: false,
    timestamp: getTimestamp(msg),
    ...(usage === undefined ? {} : { usage }),
  };
}

export function hydrateSessionMessages(messages: AgentMessage[]): UIMessage[] {
  const result: UIMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const text = extractText(msg);
      result.push({
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        parts: [{ type: "text", text }],
        isStreaming: false,
        timestamp: getTimestamp(msg),
      });
    } else if (msg.role === "assistant") {
      result.push(convertAssistantMessage(msg));
    } else if (msg.role === "toolResult") {
      const toolCallId = (msg as { toolCallId?: string }).toolCallId;
      const toolName = (msg as { toolName?: string }).toolName;
      const isError = (msg as { isError?: boolean }).isError ?? false;
      const details = (msg as { details?: unknown }).details;

      const resultText = extractText(msg);

      let merged = false;
      for (let i = result.length - 1; i >= 0; i--) {
        const uiMsg = result[i]!;
        if (uiMsg.role !== "assistant") {
          break;
        }
        const part = uiMsg.parts.find((p) => p.type === "tool_call" && p.toolCallId === toolCallId);
        if (part && part.type === "tool_call") {
          part.status = isError ? "error" : "done";
          part.result = resultText;
          if (details !== undefined) {
            part.details = details;
          }
          merged = true;
          break;
        }
      }
      if (!merged) {
        // Orphan toolResult — create a standalone system message
        // (shouldn't happen in valid data, but handle gracefully)
      }
    }
  }

  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/stores/session/__tests__/hydrate-messages.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/stores/session/hydrate-messages.ts apps/desktop/src/stores/session/__tests__/hydrate-messages.test.ts
git commit -m "feat(desktop): add hydrateSessionMessages for full message hydration"
```

---

### Task 8: Wire `hydrateSessionMessages` into `loadMessages` + call on session open

**Files:**

- Modify: `apps/desktop/src/stores/server/actions.ts:138-155`
- Modify: `apps/desktop/src/components/chat/task-chat-view.tsx`
- Test: `apps/desktop/src/stores/server/__tests__/actions.test.ts`

**Step 1: Write the failing test for loadMessages using hydrateSessionMessages**

Add to `apps/desktop/src/stores/server/__tests__/actions.test.ts`:

```typescript
it("loadMessages hydrates thinking + tool calls + tool results", async () => {
  const { actions, sessionRegistry, mocks } = setupActions();

  mocks.fetch.mockResolvedValue(
    new Response(
      JSON.stringify([
        { role: "user", content: "test", timestamp: 1 },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hmm" },
            { type: "text", text: "ok" },
            {
              type: "toolCall",
              id: "c1",
              name: "bash",
              arguments: { command: "ls" },
            },
          ],
          timestamp: 2,
        },
        {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "bash",
          content: [{ type: "text", text: "file1" }],
          isError: false,
          timestamp: 3,
        },
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );

  await actions.loadMessages("sess-1");

  const store = sessionRegistry.get("sess-1").store;
  expect(store.messageOrder).toHaveLength(2); // user + assistant (toolResult merged)

  const assistantMsg = store.messages[store.messageOrder[1]!]!;
  expect(assistantMsg.parts).toHaveLength(3); // thinking + text + tool_call(done)
  const toolPart = assistantMsg.parts[2]!;
  expect(toolPart.type).toBe("tool_call");
  expect((toolPart as { status: string }).status).toBe("done");
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/stores/server/__tests__/actions.test.ts -t "hydrates thinking"`
Expected: FAIL — old `agentMessageToUI` drops thinking/toolCalls

**Step 3: Write minimal implementation**

In `apps/desktop/src/stores/server/actions.ts`, update imports:

```typescript
import { hydrateSessionMessages } from "../session/hydrate-messages.ts";
```

Replace the `loadMessages` method body (around line 138):

```typescript
async loadMessages(sessionId) {
  try {
    const res = await api.api.sessions[":id"].messages.$get({
      param: { id: sessionId },
    });
    if (!res.ok) {
      return;
    }
    const messages = (await res.json()) as AgentMessage[];
    const uiMessages = hydrateSessionMessages(messages);
    const session = sessionRegistry.get(sessionId);
    session.actions.loadMessages(uiMessages);
  } catch (error) {
    setLastError(
      error instanceof Error ? error.message : "Failed to load messages"
    );
  }
},
```

**Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/stores/server/__tests__/actions.test.ts -t "hydrates thinking"`
Expected: PASS

**Step 5: Wire loadMessages on session open in TaskChatView**

In `apps/desktop/src/components/chat/task-chat-view.tsx`, add `onMount` to load messages:

```typescript
import { createMemo, type JSX, onMount } from "solid-js";
import { MessageTimeline } from "~/components/chat/timeline/message-timeline";
import { ChatInput } from "~/components/chat-input/chat-input";
import { buildChatTurns } from "~/stores/session/turn-projection";
import { useStore } from "~/stores/store-context";

interface TaskChatViewProps {
  sessionId: string;
}

export function TaskChatView(props: TaskChatViewProps): JSX.Element {
  const { sessions, actions } = useStore();

  const sessionStore = createMemo(() => sessions.get(props.sessionId));

  onMount(() => {
    actions.loadMessages(props.sessionId);
  });

  const turns = createMemo(() => {
    const session = sessionStore();
    if (!session) {
      return [];
    }
    return buildChatTurns(
      session.store.messageOrder,
      session.store.messages,
      session.store.streaming.phase
    );
  });

  const isGenerating = () => sessionStore()?.store.streaming.phase !== "idle";

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <MessageTimeline isStreaming={isGenerating} turns={turns} />
      <ChatInput placeholder="Continue working…" sessionId={props.sessionId} />
    </div>
  );
}
```

**Step 6: Run full test suite**

Run: `cd apps/desktop && nub run typecheck && nub run test`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add apps/desktop/src/stores/server/actions.ts apps/desktop/src/stores/server/__tests__/actions.test.ts apps/desktop/src/components/chat/task-chat-view.tsx
git commit -m "feat(desktop): hydrate full message history on session open

Replace agentMessageToUI with hydrateSessionMessages in loadMessages.
Call loadMessages on TaskChatView mount so reopening a project
shows thinking, tool calls, and tool results."
```

---

## Phase C: Replay Server

### Task 9: Move `replay.jsonl` to server fixtures

**Files:**

- Move: `apps/desktop/src/stores/replay.jsonl` → `apps/server/fixtures/replay.jsonl`

**Step 1: Move the file**

```bash
mkdir -p apps/server/fixtures
git mv apps/desktop/src/stores/replay.jsonl apps/server/fixtures/replay.jsonl
```

**Step 2: Commit**

```bash
git add apps/server/fixtures/replay.jsonl
git commit -m "refactor: move replay.jsonl to server fixtures"
```

---

### Task 10: Create `ReplayRunner` class

**Files:**

- Create: `apps/server/src/agent/replay-runner.ts`
- Test: `apps/server/src/agent/__tests__/replay-runner.test.ts`

**Step 1: Write the failing test**

Create `apps/server/src/agent/__tests__/replay-runner.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { ReplayRunner, type ReplayEntry } from "../replay-runner.ts";

interface FakeWs {
  sent: unknown[];
  send: (d: unknown) => void;
}

function makeFakeWs(): FakeWs {
  const sent: unknown[] = [];
  return { sent, send: (d: unknown) => sent.push(d) };
}

const minimalEntries: ReplayEntry[] = [
  {
    type: "message",
    id: "e1",
    parentId: null,
    timestamp: "2024-01-01T00:00:00Z",
    message: {
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: 1000,
    },
  },
  {
    type: "message",
    id: "e2",
    parentId: "e1",
    timestamp: "2024-01-01T00:00:01Z",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Let me think" },
        { type: "text", text: "Hi there" },
      ],
      provider: "faux",
      model: "faux-1",
      api: "faux",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 1001,
    },
  },
];

const entriesWithTools: ReplayEntry[] = [
  {
    type: "message",
    id: "e1",
    parentId: null,
    timestamp: "2024-01-01T00:00:00Z",
    message: {
      role: "user",
      content: [{ type: "text", text: "list files" }],
      timestamp: 1000,
    },
  },
  {
    type: "message",
    id: "e2",
    parentId: "e1",
    timestamp: "2024-01-01T00:00:01Z",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Running ls" },
        {
          type: "toolCall",
          id: "call-1",
          name: "bash",
          arguments: { command: "ls" },
        },
      ],
      provider: "faux",
      model: "faux-1",
      api: "faux",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: 1001,
    },
  },
  {
    type: "message",
    id: "e3",
    parentId: "e2",
    timestamp: "2024-01-01T00:00:02Z",
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "bash",
      content: [{ type: "text", text: "file1\nfile2" }],
      details: {},
      isError: false,
      timestamp: 1002,
    },
  },
  {
    type: "message",
    id: "e4",
    parentId: "e3",
    timestamp: "2024-01-01T00:00:03Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Done" }],
      provider: "faux",
      model: "faux-1",
      api: "faux",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 1003,
    },
  },
];

function eventTypes(ws: FakeWs): string[] {
  return ws.sent
    .filter((f) => (f as { type?: string }).type === "event")
    .map((f) => (f as { event?: { type?: string } }).event?.type)
    .filter((t): t is string => t !== undefined);
}

describe("ReplayRunner", () => {
  it("emits agent_start first and agent_end last", async () => {
    const ws = makeFakeWs();
    const runner = new ReplayRunner(minimalEntries, ws, "sess-1", {
      wordDelayMs: 0,
      toolDelayMs: 0,
    });
    await runner.run();

    const types = eventTypes(ws);
    expect(types[0]).toBe("agent_start");
    expect(types.at(-1)).toBe("agent_end");
  });

  it("emits message_start for user messages", async () => {
    const ws = makeFakeWs();
    const runner = new ReplayRunner(minimalEntries, ws, "sess-1", {
      wordDelayMs: 0,
      toolDelayMs: 0,
    });
    await runner.run();

    const userStarts = ws.sent.filter(
      (f) =>
        (f as { type?: string }).type === "event" &&
        (f as { event?: { type?: string; message?: { role?: string } } }).event?.message?.role ===
          "user",
    );
    expect(userStarts.length).toBeGreaterThan(0);
  });

  it("streams thinking_delta then text_delta for assistant messages", async () => {
    const ws = makeFakeWs();
    const runner = new ReplayRunner(minimalEntries, ws, "sess-1", {
      wordDelayMs: 0,
      toolDelayMs: 0,
    });
    await runner.run();

    const deltas = ws.sent
      .filter((f) => (f as { event?: { type?: string } }).event?.type === "message_update")
      .map(
        (f) =>
          (f as { event?: { assistantMessageEvent?: { type?: string } } }).event
            ?.assistantMessageEvent?.type,
      );

    const firstDelta = deltas[0];
    const lastDelta = deltas.at(-1);
    expect(firstDelta).toBe("thinking_delta");
    expect(lastDelta).toBe("text_delta");
  });

  it("emits tool_execution_start and tool_execution_end", async () => {
    const ws = makeFakeWs();
    const runner = new ReplayRunner(entriesWithTools, ws, "sess-1", {
      wordDelayMs: 0,
      toolDelayMs: 0,
    });
    await runner.run();

    const types = eventTypes(ws);
    expect(types).toContain("tool_execution_start");
    expect(types).toContain("tool_execution_end");
  });

  it("passes details through tool_execution_end", async () => {
    const ws = makeFakeWs();
    const runner = new ReplayRunner(entriesWithTools, ws, "sess-1", {
      wordDelayMs: 0,
      toolDelayMs: 0,
    });
    await runner.run();

    const endEvent = ws.sent.find(
      (f) => (f as { event?: { type?: string } }).event?.type === "tool_execution_end",
    ) as { event?: { result?: { details?: unknown } } } | undefined;
    expect(endEvent?.event?.result).toBeDefined();
    expect((endEvent!.event!.result as { details?: unknown }).details).toBeDefined();
  });

  it("can be aborted mid-run", async () => {
    const ws = makeFakeWs();
    const runner = new ReplayRunner(entriesWithTools, ws, "sess-1", {
      wordDelayMs: 10,
      toolDelayMs: 10,
    });

    const runPromise = runner.run();
    runner.abort();
    await runPromise;

    // Should have emitted some events but not all
    const types = eventTypes(ws);
    expect(types).toContain("agent_start");
    expect(types.at(-1)).toBe("agent_end");
  });

  it("can pause and resume", async () => {
    const ws = makeFakeWs();
    const runner = new ReplayRunner(minimalEntries, ws, "sess-1", {
      wordDelayMs: 5,
      toolDelayMs: 0,
    });

    const runPromise = runner.run();
    runner.pause();

    await new Promise((r) => setTimeout(r, 50));

    const typesBeforeResume = eventTypes(ws).length;

    runner.resume();
    await runPromise;

    const typesAfterResume = eventTypes(ws).length;
    expect(typesAfterResume).toBeGreaterThan(typesBeforeResume);
  });

  it("emits turn_start and turn_end", async () => {
    const ws = makeFakeWs();
    const runner = new ReplayRunner(entriesWithTools, ws, "sess-1", {
      wordDelayMs: 0,
      toolDelayMs: 0,
    });
    await runner.run();

    const types = eventTypes(ws);
    expect(types).toContain("turn_start");
    expect(types).toContain("turn_end");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/agent/__tests__/replay-runner.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `apps/server/src/agent/replay-runner.ts`:

```typescript
import type { AgentHarnessEvent, AgentMessage } from "@sakti-code/agent";
import type { WsHandle } from "./ws-handler.ts";

export interface ReplayEntry {
  id: string;
  message?: AgentMessage;
  parentId: string | null;
  timestamp: string;
  type: string;
}

export interface ReplayOptions {
  toolDelayMs?: number;
  wordDelayMs?: number;
}

function splitIntoChunks(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

function isMessageEntry(entry: ReplayEntry): entry is ReplayEntry & { message: AgentMessage } {
  return entry.type === "message" && entry.message !== undefined;
}

export class ReplayRunner {
  private paused = false;
  private aborted = false;
  private pauseResolve: (() => void) | null = null;

  constructor(
    private readonly entries: ReplayEntry[],
    private readonly ws: WsHandle,
    private readonly sessionId: string,
    private readonly options: ReplayOptions = {},
  ) {}

  async run(): Promise<void> {
    this.emit({ type: "agent_start" });

    const messageEntries = this.entries.filter(isMessageEntry);
    let i = 0;

    while (i < messageEntries.length) {
      if (this.aborted) {
        break;
      }
      await this.checkPause();

      const entry = messageEntries[i]!;

      if (entry.message.role === "user") {
        await this.emitUserMessage(entry.message);
        i++;
      } else if (entry.message.role === "assistant") {
        i = await this.emitAssistantTurn(messageEntries, i);
      } else {
        i++;
      }
    }

    this.emit({ type: "agent_end", messages: [] });
  }

  private async emitUserMessage(message: AgentMessage): Promise<void> {
    this.emit({ type: "message_start", message });
    this.emit({ type: "message_end", message });
  }

  private async emitAssistantTurn(
    entries: Array<ReplayEntry & { message: AgentMessage }>,
    startIndex: number,
  ): Promise<number> {
    const entry = entries[startIndex]!;
    const message = entry.message;

    this.emit({ type: "turn_start" });

    // message_start with empty content (text comes via deltas)
    const emptyMsg: AgentMessage = {
      ...message,
      content: [],
    } as AgentMessage;
    this.emit({ type: "message_start", message: emptyMsg });

    // Stream thinking deltas first
    const content = Array.isArray(message.content) ? message.content : [];
    for (const part of content) {
      if (part !== null && typeof part === "object" && "type" in part && part.type === "thinking") {
        const thinking = (part as { thinking?: string }).thinking ?? "";
        await this.streamDeltas(message, "thinking_delta", thinking);
      }
    }

    // Stream text deltas
    for (const part of content) {
      if (part !== null && typeof part === "object" && "type" in part && part.type === "text") {
        const text = (part as { text?: string }).text ?? "";
        await this.streamDeltas(message, "text_delta", text);
      }
    }

    // message_end
    this.emit({ type: "message_end", message });

    // tool_execution_start for each toolCall
    for (const part of content) {
      if (part !== null && typeof part === "object" && "type" in part && part.type === "toolCall") {
        const tc = part as {
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        };
        this.emit({
          type: "tool_execution_start",
          toolCallId: tc.id,
          toolName: tc.name,
          args: tc.arguments,
        });
      }
    }

    // Collect following toolResult entries and emit tool_execution_end
    let i = startIndex + 1;
    while (i < entries.length && entries[i]!.message.role === "toolResult") {
      await this.checkPause();
      if (this.aborted) {
        break;
      }

      const toolResult = entries[i]!.message as AgentMessage & {
        toolCallId: string;
        toolName: string;
        isError?: boolean;
        details?: unknown;
      };

      this.emit({
        type: "tool_execution_end",
        toolCallId: toolResult.toolCallId,
        toolName: toolResult.toolName,
        result: {
          content: Array.isArray(toolResult.content)
            ? toolResult.content
            : [{ type: "text" as const, text: String(toolResult.content) }],
          ...(toolResult.details !== undefined ? { details: toolResult.details } : {}),
        },
        isError: toolResult.isError ?? false,
      });

      const delay = this.options.toolDelayMs ?? 300;
      if (delay > 0) {
        await this.delay(delay);
      }
      i++;
    }

    this.emit({ type: "turn_end", message, toolResults: [] });
    return i;
  }

  private async streamDeltas(
    message: AgentMessage,
    deltaType: "thinking_delta" | "text_delta",
    text: string,
  ): Promise<void> {
    const chunks = splitIntoChunks(text);
    const delay = this.options.wordDelayMs ?? 15;

    for (const chunk of chunks) {
      if (this.aborted) {
        return;
      }
      await this.checkPause();

      this.emit({
        type: "message_update",
        message,
        assistantMessageEvent: {
          type: deltaType,
          contentIndex: 0,
          delta: chunk,
          partial: message,
        },
      });

      if (delay > 0) {
        await this.delay(delay);
      }
    }
  }

  private emit(event: AgentHarnessEvent): void {
    this.ws.send({ type: "event", sessionId: this.sessionId, event });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async checkPause(): Promise<void> {
    while (this.paused && !this.aborted) {
      await new Promise<void>((resolve) => {
        this.pauseResolve = resolve;
      });
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.pauseResolve?.();
    this.pauseResolve = null;
  }

  abort(): void {
    this.aborted = true;
    this.resume();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/agent/__tests__/replay-runner.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/agent/replay-runner.ts apps/server/src/agent/__tests__/replay-runner.test.ts
git commit -m "feat(server): add ReplayRunner for JSONL session replay"
```

---

### Task 11: Add WS replay message types + handler

**Files:**

- Modify: `apps/server/src/agent/ws-handler.ts:35-39,77-97,163-220`
- Modify: `apps/server/src/agent/runner.ts` (add replay registration)
- Test: `apps/server/src/agent/__tests__/ws.test.ts`

**Step 1: Write the failing test**

Add to `apps/server/src/agent/__tests__/ws.test.ts`:

```typescript
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPLAY_FIXTURE = resolve(import.meta.dirname, "../../../fixtures/replay.jsonl");

function parseFixture(): ReplayEntry[] {
  const data = readFileSync(REPLAY_FIXTURE, "utf-8");
  return data
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

describe("WS replay handler", () => {
  it("replay start emits event frames", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();
    const { sent, ws } = makeFakeWs();

    handleMessage(ctx, storage, ws, {
      type: "replay",
      sessionId: "sess-1",
      action: "start",
    });

    await new Promise((r) => setTimeout(r, 200));

    const eventFrames = asEventFrames(sent);
    expect(eventFrames.length).toBeGreaterThan(0);

    const startFrame = eventFrames.find((f) => f.event?.type === "agent_start");
    expect(startFrame).toBeDefined();
  });

  it("replay pause/resume controls emission", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();
    const { sent, ws } = makeFakeWs();

    handleMessage(ctx, storage, ws, {
      type: "replay",
      sessionId: "sess-pause",
      action: "start",
    });

    await new Promise((r) => setTimeout(r, 50));

    handleMessage(ctx, storage, ws, {
      type: "replay",
      sessionId: "sess-pause",
      action: "pause",
    });

    await new Promise((r) => setTimeout(r, 100));
    const countAfterPause = asEventFrames(sent).length;

    handleMessage(ctx, storage, ws, {
      type: "replay",
      sessionId: "sess-pause",
      action: "resume",
    });

    await new Promise((r) => setTimeout(r, 200));
    const countAfterResume = asEventFrames(sent).length;

    expect(countAfterResume).toBeGreaterThan(countAfterPause);
  });

  it("abort stops replay", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();
    const { sent, ws } = makeFakeWs();

    handleMessage(ctx, storage, ws, {
      type: "replay",
      sessionId: "sess-abort",
      action: "start",
    });

    await new Promise((r) => setTimeout(r, 50));

    handleMessage(ctx, storage, ws, {
      type: "abort",
      sessionId: "sess-abort",
    });

    await new Promise((r) => setTimeout(r, 200));

    const eventTypes = asEventFrames(sent).map((f) => f.event?.type);
    expect(eventTypes.at(-1)).toBe("agent_end");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/agent/__tests__/ws.test.ts -t "replay"`
Expected: FAIL — `replay` message type not recognized

**Step 3: Write the implementation**

In `apps/server/src/agent/ws-handler.ts`, add the `ReplayMessage` type and update `WsIn`:

```typescript
export interface ReplayMessage {
  action: "start" | "pause" | "resume";
  sessionId: string;
  type: "replay";
}

export type WsIn = PromptMessage | AbortMessage | SteerMessage | FollowUpMessage | ReplayMessage;
```

Add replay handling to the `wsBodySchema` TypeBox union:

```typescript
Type.Object({
  type: Type.Literal("replay"),
  sessionId: Type.String(),
  action: Type.Union([
    Type.Literal("start"),
    Type.Literal("pause"),
    Type.Literal("resume"),
  ]),
}),
```

In `apps/server/src/agent/runner.ts`, add replay registration:

```typescript
import { ReplayRunner, type ReplayEntry } from "./replay-runner.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPLAY_PATH =
  process.env.SAKTI_REPLAY_PATH ?? resolve(import.meta.dirname, "../../fixtures/replay.jsonl");

const activeReplays = new Map<string, ReplayRunner>();

export function clearReplaysForTesting(): void {
  for (const runner of activeReplays.values()) {
    runner.abort();
  }
  activeReplays.clear();
}

export async function startReplay(sessionId: string, ws: WsHandle): Promise<void> {
  if (activeReplays.has(sessionId)) {
    return;
  }
  if (activeRuns.has(sessionId)) {
    throw new Error(busyMessage(sessionId));
  }

  const data = readFileSync(REPLAY_PATH, "utf-8");
  const entries: ReplayEntry[] = data
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as ReplayEntry);

  const runner = new ReplayRunner(entries, ws, sessionId, {
    wordDelayMs: 15,
    toolDelayMs: 300,
  });
  activeReplays.set(sessionId, runner);

  try {
    await runner.run();
  } finally {
    activeReplays.delete(sessionId);
  }
}

export function pauseReplay(sessionId: string): boolean {
  const runner = activeReplays.get(sessionId);
  if (runner) {
    runner.pause();
    return true;
  }
  return false;
}

export function resumeReplay(sessionId: string): boolean {
  const runner = activeReplays.get(sessionId);
  if (runner) {
    runner.resume();
    return true;
  }
  return false;
}

export function stopReplay(sessionId: string): boolean {
  const runner = activeReplays.get(sessionId);
  if (runner) {
    runner.abort();
    return true;
  }
  return false;
}
```

In `apps/server/src/agent/ws-handler.ts`, update `handleMessage`:

```typescript
export function handleMessage(
  ctx: ServerContext,
  storage: SessionStorage,
  ws: WsHandle,
  msg: WsIn
) {
  if (msg.type === "replay") {
    if (msg.action === "start") {
      startReplay(msg.sessionId, ws).catch((err) => {
        sendError(
          ws,
          msg.sessionId,
          err instanceof Error ? err.message : String(err)
        );
      });
    } else if (msg.action === "pause") {
      pauseReplay(msg.sessionId);
    } else if (msg.action === "resume") {
      resumeReplay(msg.sessionId);
    }
    return;
  }

  if (msg.type === "abort") {
    // Try stopping replay first, then real run
    if (stopReplay(msg.sessionId)) {
      return;
    }
    abortRun(msg.sessionId).catch((err) => {
      sendError(
        ws,
        msg.sessionId,
        err instanceof Error ? err.message : String(err)
      );
    });
    return;
  }

  // ... existing prompt/steer/followUp handling stays the same
```

**Step 4: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/agent/__tests__/ws.test.ts -t "replay"`
Expected: PASS

**Step 5: Run full server test suite**

Run: `cd apps/server && nub run typecheck && nub run test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add apps/server/src/agent/ws-handler.ts apps/server/src/agent/runner.ts apps/server/src/agent/__tests__/ws.test.ts
git commit -m "feat(server): add WS replay message types and handler"
```

---

## Phase D: Frontend

### Task 12: Add replay actions to frontend

**Files:**

- Modify: `apps/desktop/src/stores/server/actions.ts`
- Modify: `apps/desktop/src/stores/workspace/ui-signals.ts` (add replay state signal)
- Test: `apps/desktop/src/stores/server/__tests__/actions.test.ts`

**Step 1: Write the failing test**

Add to `apps/desktop/src/stores/server/__tests__/actions.test.ts`:

```typescript
describe("replay actions", () => {
  it("replayStart sends WS replay start message", () => {
    const { actions, mocks } = setupActions();
    actions.replayStart("sess-1");
    expect(mocks.wsSend).toHaveBeenCalledWith({
      type: "replay",
      sessionId: "sess-1",
      action: "start",
    });
  });

  it("replayPause sends WS replay pause message", () => {
    const { actions, mocks } = setupActions();
    actions.replayPause("sess-1");
    expect(mocks.wsSend).toHaveBeenCalledWith({
      type: "replay",
      sessionId: "sess-1",
      action: "pause",
    });
  });

  it("replayResume sends WS replay resume message", () => {
    const { actions, mocks } = setupActions();
    actions.replayResume("sess-1");
    expect(mocks.wsSend).toHaveBeenCalledWith({
      type: "replay",
      sessionId: "sess-1",
      action: "resume",
    });
  });

  it("replayReset aborts and clears session store", () => {
    const { actions, sessionRegistry, mocks } = setupActions();
    const session = sessionRegistry.get("sess-1");
    session.actions.addMessage({
      id: "m1",
      role: "user",
      content: "old",
      parts: [{ type: "text", text: "old" }],
      isStreaming: false,
      timestamp: 0,
    });

    actions.replayReset("sess-1");

    expect(mocks.wsSend).toHaveBeenCalledWith({
      type: "abort",
      sessionId: "sess-1",
    });
    expect(session.store.messageOrder).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/stores/server/__tests__/actions.test.ts -t "replay"`
Expected: FAIL — replay actions don't exist

**Step 3: Write minimal implementation**

In `apps/desktop/src/stores/workspace/ui-signals.ts`, add replay state:

```typescript
// ── Replay (dev-only) ─────────────────────────────────────────────
export type ReplayState = "idle" | "playing" | "paused";
export const [replayState, setReplayState] = createSignal<ReplayState>("idle");
```

In `apps/desktop/src/stores/server/actions.ts`, add to the `Actions` interface:

```typescript
replayPause: (sessionId: string) => void;
replayReset: (sessionId: string) => void;
replayResume: (sessionId: string) => void;
replayStart: (sessionId: string) => void;
```

Add implementations:

```typescript
replayStart(sessionId) {
  const session = sessionRegistry.get(sessionId);
  session.actions.reset();
  setReplayState("playing");
  ws.send({ type: "replay", sessionId, action: "start" });
},

replayPause(sessionId) {
  setReplayState("paused");
  ws.send({ type: "replay", sessionId, action: "pause" });
},

replayResume(sessionId) {
  setReplayState("playing");
  ws.send({ type: "replay", sessionId, action: "resume" });
},

replayReset(sessionId) {
  ws.send({ type: "abort", sessionId });
  const session = sessionRegistry.get(sessionId);
  session.actions.reset();
  setReplayState("idle");
},
```

Add the import:

```typescript
import { setReplayState } from "../workspace/ui-signals.ts";
```

**Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/stores/server/__tests__/actions.test.ts -t "replay"`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/stores/server/actions.ts apps/desktop/src/stores/server/__tests__/actions.test.ts apps/desktop/src/stores/workspace/ui-signals.ts
git commit -m "feat(desktop): add replay start/pause/resume/reset actions"
```

---

### Task 13: Also reset replayState on agent_end

**Files:**

- Modify: `apps/desktop/src/stores/server/ws-client.ts:59-65`

**Step 1: Write the test (or verify manually)**

The `updateStreamingState` function in `ws-client.ts` sets `isStreaming` on `agent_start`/`agent_end`. We need it to also reset `replayState` when `agent_end` arrives (replay finished).

**Step 2: Implement**

In `apps/desktop/src/stores/server/ws-client.ts`, update imports:

```typescript
import { setIsStreaming, setLastError, setReplayState } from "../workspace/ui-signals.ts";
```

Update `updateStreamingState`:

```typescript
function updateStreamingState(evt: AgentHarnessEvent): void {
  if (evt.type === "agent_start") {
    setIsStreaming(true);
  } else if (evt.type === "agent_end" || evt.type === "abort") {
    setIsStreaming(false);
    setReplayState("idle");
  }
}
```

**Step 3: Run full test suite**

Run: `cd apps/desktop && nub run typecheck && nub run test`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add apps/desktop/src/stores/server/ws-client.ts
git commit -m "feat(desktop): reset replayState on agent_end/abort"
```

---

### Task 14: Create replay button component

**Files:**

- Create: `apps/desktop/src/components/layout/toolbar/replay-button.tsx`
- Modify: `apps/desktop/src/components/layout/toolbar/toolbar.tsx`
- Test: `apps/desktop/src/components/__tests__/replay-button.test.tsx`

**Step 1: Write the failing test**

Create `apps/desktop/src/components/__tests__/replay-button.test.tsx`:

```typescript
import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { StoreProvider } from "~/stores/store-context";
import { replayState, setReplayState } from "~/stores/workspace/ui-signals";

// Mock the store provider to avoid full app setup
vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    server: { store: { activeSessionId: "sess-1" } },
    actions: {
      replayStart: vi.fn(),
      replayPause: vi.fn(),
      replayResume: vi.fn(),
      replayReset: vi.fn(),
    },
  }),
}));

// Import after mock
import { ReplayButton } from "~/components/layout/toolbar/replay-button";

describe("ReplayButton", () => {
  beforeEach(() => {
    setReplayState("idle");
  });

  it("renders Replay text when idle", () => {
    const { getByText } = render(() => <ReplayButton />);
    expect(getByText("Replay")).toBeTruthy();
  });

  it("renders Pause text when playing", () => {
    setReplayState("playing");
    const { getByText } = render(() => <ReplayButton />);
    expect(getByText("Pause")).toBeTruthy();
  });

  it("renders Resume text when paused", () => {
    setReplayState("paused");
    const { getByText } = render(() => <ReplayButton />);
    expect(getByText("Resume")).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/components/__tests__/replay-button.test.tsx`
Expected: FAIL — component not found

**Step 3: Write minimal implementation**

Create `apps/desktop/src/components/layout/toolbar/replay-button.tsx`:

```typescript
import { Show } from "solid-js";
import { useStore } from "~/stores/store-context";
import { replayState } from "~/stores/workspace/ui-signals";

export function ReplayButton() {
  const { server, actions } = useStore();

  const sessionId = () => server.store.activeSessionId;

  const handleClick = () => {
    const id = sessionId();
    if (!id) {
      return;
    }
    const state = replayState();
    if (state === "idle") {
      actions.replayStart(id);
    } else if (state === "playing") {
      actions.replayPause(id);
    } else if (state === "paused") {
      actions.replayResume(id);
    }
  };

  const handleReset = () => {
    const id = sessionId();
    if (!id) {
      return;
    }
    actions.replayReset(id);
  };

  const label = () => {
    const state = replayState();
    if (state === "idle") {
      return "Replay";
    }
    if (state === "playing") {
      return "Pause";
    }
    return "Resume";
  };

  return (
    <div class="flex items-center gap-1">
      <button
        class="flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        disabled={sessionId() === null}
        onClick={handleClick}
        title="Replay recorded session"
        type="button"
      >
        {label()}
      </button>
      <Show when={replayState() !== "idle"}>
        <button
          class="flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          onClick={handleReset}
          title="Stop and reset replay"
          type="button"
        >
          Reset
        </button>
      </Show>
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/components/__tests__/replay-button.test.tsx`
Expected: PASS

**Step 5: Wire into toolbar (dev-only)**

In `apps/desktop/src/components/layout/toolbar/toolbar.tsx`, add:

```typescript
import { Show } from "solid-js";
import { ReplayButton } from "./replay-button";
```

Add before the `<ExportButton />` in the right-side button group:

```tsx
<Show when={import.meta.env.DEV}>
  <ReplayButton />
  <div class="h-5 w-px bg-border" />
</Show>
```

**Step 6: Run typecheck**

Run: `cd apps/desktop && nub run typecheck`
Expected: PASS

**Step 7: Commit**

```bash
git add apps/desktop/src/components/layout/toolbar/replay-button.tsx apps/desktop/src/components/layout/toolbar/toolbar.tsx apps/desktop/src/components/__tests__/replay-button.test.tsx
git commit -m "feat(desktop): add dev-only replay button with start/pause/reset"
```

---

### Task 15: Add missing tool formatters

**Files:**

- Modify: `apps/desktop/src/components/chat/tools/tool-summary-formatters.ts`
- Modify: `apps/desktop/src/components/chat/parts/tool-part.tsx:85-99`
- Test: `apps/desktop/src/components/chat/tools/__tests__/tool-summary-formatters.test.ts`

**Step 1: Write the failing test**

Create `apps/desktop/src/components/chat/tools/__tests__/tool-summary-formatters.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  formatGenericToolSummary,
  formatTaskCreateSummary,
  formatTaskUpdateSummary,
  formatWebfetchSummary,
  formatVscodeDiagnosticsSummary,
} from "../tool-summary-formatters";

describe("tool summary formatters — new tools", () => {
  it("formatTaskCreateSummary shows subject", () => {
    const result = formatTaskCreateSummary({
      tool: "TaskCreate",
      args: { subject: "Fix typo", description: "long..." },
    });
    expect(result).toBe("Created task: Fix typo");
  });

  it("formatTaskUpdateSummary shows status", () => {
    const result = formatTaskUpdateSummary({
      tool: "TaskUpdate",
      args: { taskId: "1", status: "in_progress" },
    });
    expect(result).toBe("Task 1 → in_progress");
  });

  it("formatWebfetchSummary shows domain", () => {
    const result = formatWebfetchSummary({
      tool: "webfetch",
      args: {
        url: "https://example.com/page",
        prompt: "extract info",
      },
    });
    expect(result).toBe("Fetched example.com");
  });

  it("formatVscodeDiagnosticsSummary shows count", () => {
    const result = formatVscodeDiagnosticsSummary({
      tool: "vscode_get_diagnostics",
      args: {},
      output: "3 issues found",
    });
    expect(result).toContain("Diagnostics");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/components/chat/tools/__tests__/tool-summary-formatters.test.ts`
Expected: FAIL — functions not exported

**Step 3: Write minimal implementation**

In `apps/desktop/src/components/chat/tools/tool-summary-formatters.ts`, add:

```typescript
export function formatTaskCreateSummary(part: ToolPartData): string {
  const args = getArgs(part);
  const subject = typeof args.subject === "string" ? args.subject : "untitled";
  return `Created task: ${subject}`;
}

export function formatTaskUpdateSummary(part: ToolPartData): string {
  const args = getArgs(part);
  const taskId = typeof args.taskId === "string" ? args.taskId : "?";
  const status = typeof args.status === "string" ? args.status : "updated";
  return `Task ${taskId} → ${status}`;
}

export function formatWebfetchSummary(part: ToolPartData): string {
  const args = getArgs(part);
  const url = typeof args.url === "string" ? args.url : "";
  try {
    const domain = new URL(url).hostname;
    return `Fetched ${domain}`;
  } catch {
    return "Fetched URL";
  }
}

export function formatVscodeDiagnosticsSummary(part: ToolPartData): string {
  const output = typeof part.output === "string" ? part.output : "";
  const hasIssues = output.length > 0 && !output.includes("No problems");
  return hasIssues ? `Diagnostics: issues found` : "Diagnostics: clean";
}
```

In `apps/desktop/src/components/chat/parts/tool-part.tsx`, add to the imports:

```typescript
import {
  formatBashSummary,
  formatEditSummary,
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
```

Update the `switch` in the `summary()` function:

```typescript
switch (name) {
  case "ls":
    return formatLsSummary(part);
  case "read":
    return formatReadSummary(part);
  case "write":
    return formatWriteSummary(part);
  case "edit":
    return formatEditSummary(part);
  case "bash":
    return formatBashSummary(part);
  case "glob":
    return formatGlobSummary(part);
  case "grep":
    return formatGrepSummary(part);
  case "TaskCreate":
    return formatTaskCreateSummary(part);
  case "TaskUpdate":
    return formatTaskUpdateSummary(part);
  case "webfetch":
    return formatWebfetchSummary(part);
  case "vscode_get_diagnostics":
    return formatVscodeDiagnosticsSummary(part);
  default:
    return formatGenericToolSummary(part);
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/components/chat/tools/__tests__/tool-summary-formatters.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/components/chat/tools/tool-summary-formatters.ts apps/desktop/src/components/chat/parts/tool-part.tsx apps/desktop/src/components/chat/tools/__tests__/tool-summary-formatters.test.ts
git commit -m "feat(desktop): add tool formatters for TaskCreate, TaskUpdate, webfetch, diagnostics"
```

---

## Final Verification

**Step 1: Run all tests across all packages**

```bash
nub run typecheck
cd packages/agent && nub run test
cd packages/db && nub run test
cd packages/tools && nub run test
cd apps/server && nub run test
cd apps/desktop && nub run test
```

Expected: ALL PASS

**Step 2: Run linting**

```bash
nubx ultracite fix
```

Expected: No errors

**Step 3: Manual test — replay**

1. Start the app: `cd apps/desktop && nub run dev`
2. Select a project and session
3. Click "Replay" in the toolbar
4. Verify: user messages appear, assistant text streams word-by-word, thinking blocks render in italic, tool calls show with status transitions
5. Click "Pause" — streaming stops
6. Click "Resume" — streaming continues
7. Click "Reset" — store clears, returns to idle

**Step 4: Manual test — hydration**

1. Send a few messages in a session (with tool calls)
2. Close the project tab
3. Reopen the project, select the same session
4. Verify: all messages appear with thinking, tool calls (done status), and tool results

**Step 5: Final commit (if any lint fixes)**

```bash
git add -A
git commit -m "chore: lint fixes from replay + hydration implementation"
```
