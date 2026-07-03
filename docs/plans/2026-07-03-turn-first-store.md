# Turn-First Store Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate `buildChatTurns` and the `splitCache` bug by making turns a first-class concept in the store.

**Architecture:** See `docs/plans/2026-07-03-turn-first-store-design.md` for the full design doc.

**Tech Stack:** SolidJS `createStore`, path-based `setStore`, vitest TDD.

---

## Phase 1: Types & Store Foundation

### Task 1: Define new types (`types.ts`)

**Files:**

- Modify: `apps/desktop/src/stores/types.ts`

**Step 1: Write the failing type test**

Create `apps/desktop/src/stores/__tests__/types-new.test.ts`:

```typescript
import { describe, expect, it } from "vite-plus/test";
import type { Turn, UIMessage, MessagePart, SessionStoreData } from "../types.ts";

describe("Turn type", () => {
  it("has required fields", () => {
    const turn: Turn = {
      id: "t1",
      userMessage: null,
      messages: [],
      startedAt: null,
      endedAt: null,
      working: false,
      error: null,
      turnId: null,
      intermediateCount: 0,
      intermediatesLoaded: false,
      loadedMessageIds: [],
    };
    expect(turn.id).toBe("t1");
  });

  it("SessionStoreData uses turns array", () => {
    const data: SessionStoreData = {
      turns: [],
      streaming: {
        phase: "idle",
        startedAt: 0,
        tokenCount: 0,
        currentMessageId: null,
        currentToolName: null,
      },
      permission: null,
      proposedSession: null,
      retry: null,
      omStatus: null,
    };
    expect(data.turns).toEqual([]);
  });
});
```

**Step 2: Run test — verify it fails (Turn type doesn't exist)**

```bash
vp run desktop#test -- --reporter=verbose apps/desktop/src/stores/__tests__/types-new.test.ts 2>&1 | head -20
```

**Step 3: Implement — add `Turn` type, update `SessionStoreData`, keep `UIMessage`/`MessagePart`**

Add to `types.ts`:

```typescript
export interface Turn {
  id: string;
  userMessage: UIMessage | null;
  messages: UIMessage[];
  startedAt: number | null;
  endedAt: number | null;
  working: boolean;
  error: string | null;
  turnId: string | null;
  intermediateCount: number;
  intermediatesLoaded: boolean;
  loadedMessageIds: string[];
}
```

Remove from types: nothing yet (keep old types for backward compat during migration — remove in Phase 6).

**Step 4: Run test — verify pass**

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(store): add Turn type for first-class turn structure"
```

---

### Task 2: Rewrite `session-store.ts` — turn-first structure

**Files:**

- Rewrite: `apps/desktop/src/stores/session/session-store.ts`
- Create test: `apps/desktop/src/stores/session/__tests__/turn-store.test.ts`

**Step 1: Write failing tests for the core store**

Create `apps/desktop/src/stores/session/__tests__/turn-store.test.ts`. Test the key operations:

```typescript
import { describe, expect, it } from "vite-plus/test";
import { createSessionStore } from "../session-store.ts";
import type { UIMessage } from "../../types.ts";

function makeUserMsg(text: string): UIMessage {
  return {
    id: "u1",
    role: "user",
    content: text,
    parts: [{ type: "text", text }],
    isStreaming: false,
    timestamp: Date.now(),
  };
}
function makeAssistantMsg(id: string): UIMessage {
  return {
    id,
    role: "assistant",
    content: "",
    parts: [],
    isStreaming: true,
    timestamp: Date.now(),
  };
}

describe("turn store — startTurn", () => {
  it("creates a new turn with user message", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hello"));
    expect(store.turns).toHaveLength(1);
    expect(store.turns[0]!.userMessage?.content).toBe("hello");
    expect(store.turns[0]!.messages).toEqual([]);
    expect(store.turns[0]!.working).toBe(true);
  });
});

describe("turn store — addAssistantMessage", () => {
  it("appends assistant message to the last turn", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    expect(store.turns[0]!.messages).toHaveLength(1);
    expect(store.turns[0]!.messages[0]!.id).toBe("a1");
  });
});

describe("turn store — appendTextToken", () => {
  it("appends delta to last message's last text part (path-based)", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    // Seed a text part
    actions.appendTextToken("a1", "Hello");
    expect(store.turns[0]!.messages[0]!.parts[0]!.type).toBe("text");
    expect(store.turns[0]!.messages[0]!.parts[0]).toMatchObject({ type: "text", text: "Hello" });
    // Append more
    actions.appendTextToken("a1", " World");
    expect(store.turns[0]!.messages[0]!.parts[0]).toMatchObject({
      type: "text",
      text: "Hello World",
    });
    expect(store.turns[0]!.messages[0]!.content).toBe("Hello World");
  });
});

describe("turn store — appendThinkingToken", () => {
  it("creates thinking part and appends to it", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.appendThinkingToken("a1", "hmm");
    actions.appendThinkingToken("a1", " more");
    expect(store.turns[0]!.messages[0]!.parts[0]).toMatchObject({
      type: "thinking",
      text: "hmm more",
    });
  });
});

describe("turn store — addToolCall", () => {
  it("adds tool_call part to current message", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.appendTextToken("a1", "thinking...");
    actions.addToolCall("a1", "tc1", "read", { path: "/foo" });
    const parts = store.turns[0]!.messages[0]!.parts;
    expect(parts.at(-1)).toMatchObject({ type: "tool_call", toolName: "read", status: "running" });
  });
});

describe("turn store — finalizeMessage", () => {
  it("sets isStreaming=false on last message", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.finalizeMessage("a1");
    expect(store.turns[0]!.messages[0]!.isStreaming).toBe(false);
  });
});

describe("turn store — finalizeTurn", () => {
  it("sets endedAt and working=false", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.finalizeTurn(12345);
    expect(store.turns[0]!.endedAt).toBe(12345);
    expect(store.turns[0]!.working).toBe(false);
  });
});

describe("turn store — addCompactionMarker", () => {
  it("adds compaction part to the last assistant message in last turn", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.appendTextToken("a1", "answer");
    actions.finalizeMessage("a1");
    actions.finalizeTurn(9999);

    // Compaction arrives after turn ended
    actions.addCompactionMarker("a1");
    const parts = store.turns[0]!.messages[0]!.parts;
    expect(parts.at(-1)).toMatchObject({ type: "compaction", status: "loading", text: "" });
  });
});

describe("turn store — appendCompactionToken", () => {
  it("appends delta to compaction part", () => {
    const { store, actions } = createSessionStore();
    actions.startTurn(makeUserMsg("hi"));
    actions.addAssistantMessage(makeAssistantMsg("a1"));
    actions.finalizeMessage("a1");

    actions.addCompactionMarker("a1");
    actions.appendCompactionToken("a1", "Sum");
    actions.appendCompactionToken("a1", "mary");
    const compactionPart = store.turns[0]!.messages[0]!.parts.find((p) => p.type === "compaction");
    expect(compactionPart).toMatchObject({ type: "compaction", text: "Summary" });
  });
});

describe("turn store — loadTurns", () => {
  it("replaces all turns from REST hydration", () => {
    const { store, actions } = createSessionStore();
    const turns: Turn[] = [
      {
        id: "t1",
        userMessage: makeUserMsg("q1"),
        messages: [makeAssistantMsg("a1")],
        startedAt: 1,
        endedAt: 2,
        working: false,
        error: null,
        turnId: "t1",
        intermediateCount: 3,
        intermediatesLoaded: false,
        loadedMessageIds: [],
      },
    ];
    actions.loadTurns(turns);
    expect(store.turns).toHaveLength(1);
    expect(store.turns[0]!.id).toBe("t1");
  });
});

describe("turn store — loadIntermediates", () => {
  it("inserts intermediate messages before summary in the right turn", () => {
    const { store, actions } = createSessionStore();
    const summary = {
      ...makeAssistantMsg("sum"),
      content: "final answer",
      parts: [{ type: "text" as const, text: "final answer" }],
    };
    actions.loadTurns([
      {
        id: "t1",
        userMessage: makeUserMsg("q1"),
        messages: [summary],
        startedAt: 1,
        endedAt: 2,
        working: false,
        error: null,
        turnId: "t1",
        intermediateCount: 2,
        intermediatesLoaded: false,
        loadedMessageIds: [],
      },
    ]);
    const intermediates = [makeAssistantMsg("int1"), makeAssistantMsg("int2")];
    actions.loadIntermediates("t1", intermediates);
    expect(store.turns[0]!.messages).toHaveLength(3);
    expect(store.turns[0]!.messages[0]!.id).toBe("int1");
    expect(store.turns[0]!.messages[2]!.id).toBe("sum");
    expect(store.turns[0]!.intermediatesLoaded).toBe(true);
  });
});

describe("turn store — evictIntermediates", () => {
  it("removes intermediate messages, keeps summary", () => {
    const { store, actions } = createSessionStore();
    const summary = { ...makeAssistantMsg("sum"), content: "final" };
    actions.loadTurns([
      {
        id: "t1",
        userMessage: makeUserMsg("q1"),
        messages: [makeAssistantMsg("int1"), makeAssistantMsg("int2"), summary],
        startedAt: 1,
        endedAt: 2,
        working: false,
        error: null,
        turnId: "t1",
        intermediateCount: 2,
        intermediatesLoaded: true,
        loadedMessageIds: ["int1", "int2"],
      },
    ]);
    actions.evictIntermediates("t1");
    expect(store.turns[0]!.messages).toHaveLength(1);
    expect(store.turns[0]!.messages[0]!.id).toBe("sum");
    expect(store.turns[0]!.intermediatesLoaded).toBe(false);
    expect(store.turns[0]!.loadedMessageIds).toEqual([]);
  });
});
```

**Step 2: Run tests — verify they fail**

```bash
vp run desktop#test -- --reporter=verbose apps/desktop/src/stores/session/__tests__/turn-store.test.ts 2>&1 | tail -20
```

Expected: All fail — `createSessionStore` doesn't have these actions yet.

**Step 3: Implement — rewrite `session-store.ts`**

Key implementation details:

```typescript
export interface SessionStoreData {
  turns: Turn[];
  streaming: StreamState;
  permission: PermissionPending | null;
  proposedSession: ProposedSession | null;
  retry: RetryState | null;
  omStatus: OmWindowState | null;
}

export interface SessionActions {
  // Turn lifecycle
  startTurn: (userMessage: UIMessage | null, startedAt?: number) => void;
  finalizeTurn: (endedAt: number) => void;

  // Message lifecycle
  addAssistantMessage: (msg: UIMessage) => void;
  finalizeMessage: (msgId: string, usage?: UIMessage["usage"]) => void;

  // Part mutations
  appendTextToken: (msgId: string, delta: string) => void;
  appendThinkingToken: (msgId: string, delta: string) => void;
  addToolCall: (msgId: string, toolCallId: string, toolName: string, input: unknown) => void;
  completeToolCall: (
    msgId: string,
    toolCallId: string,
    result: string,
    isError?: boolean,
    details?: unknown,
  ) => void;
  addCompactionMarker: (msgId: string) => void;
  appendCompactionToken: (msgId: string, delta: string) => void;
  updateCompactionMarker: (
    msgId: string,
    updates: Partial<Extract<MessagePart, { type: "compaction" }>>,
  ) => void;
  addOmMarker: (msgId: string, marker: OmMarkerInput) => void;
  updateOmMarker: (msgId: string, cycleId: string, updates: Partial<OmMarkerInput>) => void;

  // State
  setPhase: (phase: StreamState["phase"]) => void;
  setError: (msgId: string, error: string) => void;
  setCurrentMessage: (msgId: string) => void;
  clearCurrentMessage: () => void;
  getCurrentMessageId: () => string | null;
  getLastAssistantMessageId: () => string | null;
  setCurrentTool: (toolName: string) => void;
  clearCurrentTool: () => void;
  setPermission: (permission: PermissionPending | null) => void;
  setProposedSession: (proposal: ProposedSession) => void;
  clearProposedSession: () => void;
  setRetry: (retry: RetryState | null) => void;
  updateOmStatus: (status: OmWindowState) => void;
  wasLastUserMessage: (text: string) => boolean;

  // REST hydration
  loadTurns: (turns: Turn[]) => void;
  loadIntermediates: (turnId: string, messages: UIMessage[]) => void;
  evictIntermediates: (turnId: string) => void;
  loadTurnTimings: (timings: TurnTiming[]) => void;
  reset: () => void;
}
```

**Message-location index** for O(1) lookup by msgId:

```typescript
// Private to session-store — maps msgId → {turnIdx, msgIdx}
const msgLocation = new Map<string, { turnIdx: number; msgIdx: number }>();
```

Updated whenever `addAssistantMessage` or `loadTurns` is called. Used by `appendTextToken`, `appendThinkingToken`, `addToolCall`, etc. for fast path-based `setStore` calls.

**Path-based token append (the hot path):**

```typescript
appendTextToken(msgId, delta) {
  const loc = msgLocation.get(msgId);
  if (!loc) return;
  const msg = store.turns[loc.turnIdx]?.messages[loc.msgIdx];
  if (!msg) return;
  setStore("turns", loc.turnIdx, "messages", loc.msgIdx, "content", (prev) => prev + delta);
  const pIdx = msg.parts.length - 1;
  const last = msg.parts[pIdx];
  if (last?.type === "text") {
    setStore("turns", loc.turnIdx, "messages", loc.msgIdx, "parts", pIdx, "text", (prev) => prev + delta);
  } else {
    // Transition: finalize previous part, add new text part
    setStore("turns", loc.turnIdx, "messages", loc.msgIdx, "parts", (prev) => [
      ...prev.slice(0, -1),
      { ...prev.at(-1)!, isStreaming: false },
      { type: "text", text: delta, isStreaming: true },
    ]);
  }
  setStore("streaming", "tokenCount", (n) => n + 1);
}
```

**Step 4: Run tests — verify pass**

**Step 5: Commit**

```bash
git add -A && git commit -m "feat(store): rewrite session-store with turn-first structure

Turns are now first-class in the store. Messages live inside turns.
Path-based setStore for token streaming (zero array churn).
Message-location index for O(1) lookups by msgId."
```

---

## Phase 2: Event Handler Registry

### Task 3: Create event-handler registry (`event-handler.ts`)

**Files:**

- Create: `apps/desktop/src/stores/session/event-handler.ts`

**Step 1: Write failing test**

Create `apps/desktop/src/stores/session/__tests__/event-handler.test.ts`:

```typescript
import { describe, expect, it } from "vite-plus/test";
import { createRegistry, type HandlerContext } from "../event-handler.ts";
import { createSessionStore } from "../session-store.ts";
import { createTokenBatcher } from "../token-batcher.ts";

function setup() {
  const session = createSessionStore();
  const batcher = createTokenBatcher((msgId, text) => session.actions.appendTextToken(msgId, text));
  const ctx: HandlerContext = {
    store: session.store,
    setStore: session.setStore, // need to expose setStore
    batcher,
  };
  return { session, ctx };
}

describe("event handler registry", () => {
  it("dispatches registered handler", () => {
    const { registry } = createRegistry();
    let called = false;
    registry.register("test_event", () => {
      called = true;
    });
    registry.dispatch({ type: "test_event" } as any, {} as any);
    expect(called).toBe(true);
  });

  it("unknown event type is silently ignored", () => {
    const { registry } = createRegistry();
    expect(() => registry.dispatch({ type: "unknown" } as any, {} as any)).not.toThrow();
  });
});
```

**Step 2: Run — verify fails (file doesn't exist)**

**Step 3: Implement**

```typescript
// event-handler.ts
import type { AgentHarnessEvent } from "@sakti-code/agent";
import type { SessionStoreData } from "../types.ts";
import type { TokenBatcher } from "./token-batcher.ts";

export interface HandlerContext {
  store: SessionStoreData;
  setStore: SetStoreFunction<SessionStoreData>;
  batcher: TokenBatcher;
}

export type EventHandler<E> = (event: E, ctx: HandlerContext) => void;

export interface EventHandlerRegistry {
  register: <E extends AgentHarnessEvent>(type: E["type"], handler: EventHandler<E>) => void;
  dispatch: (event: AgentHarnessEvent, ctx: HandlerContext) => void;
  registerAll: () => void;
}

export function createRegistry(): EventHandlerRegistry {
  const handlers = new Map<string, EventHandler<any>>();

  return {
    register(type, handler) {
      handlers.set(type, handler);
    },
    dispatch(event, ctx) {
      const h = handlers.get(event.type);
      if (h) h(event, ctx);
    },
    registerAll() {
      // Domain handlers register themselves
      registerLifecycleHandlers(this);
      registerMessageHandlers(this);
      registerToolHandlers(this);
      registerCompactionHandlers(this);
      registerOmHandlers(this);
      registerRetryHandlers(this);
    },
  };
}
```

Note: `createSessionStore()` must expose `setStore` (currently private). Add it to the return value.

**Step 4: Run — verify pass**

**Step 5: Commit**

---

### Task 4: Implement lifecycle handlers

**Files:**

- Create: `apps/desktop/src/stores/session/handlers/lifecycle-events.ts`
- Create test: `apps/desktop/src/stores/session/__tests__/handlers/lifecycle-events.test.ts`

**Step 1: Write failing tests**

```typescript
describe("lifecycle handlers", () => {
  it("agent_start sets phase to thinking and starts a turn timing", () => {
    // dispatch agent_start → store.streaming.phase === "thinking"
    //                    → store.turns grows by 1 OR timing tracked
  });

  it("turn_end finalizes the last turn", () => {
    // setup: startTurn + addAssistantMessage
    // dispatch turn_end → turns[last].endedAt !== null, working === false
  });

  it("agent_end clears streaming state", () => {
    // dispatch agent_end → phase === "idle", retry === null
  });

  it("abort clears streaming state", () => {
    // dispatch abort → phase === "idle"
  });
});
```

**Step 2: Run — verify fails**

**Step 3: Implement handlers**

```typescript
// handlers/lifecycle-events.ts
import type { EventHandlerRegistry } from "../event-handler.ts";

export function registerLifecycleHandlers(registry: EventHandlerRegistry): void {
  registry.register("agent_start", (_, ctx) => {
    ctx.setStore("streaming", "phase", "thinking");
    // Note: turn timing is handled by the timing wrapper, not here
  });

  registry.register("turn_start", (_, ctx) => {
    ctx.setStore("streaming", "phase", "thinking");
  });

  registry.register("turn_end", (_, ctx) => {
    ctx.setStore("streaming", "phase", "idle");
    ctx.setStore("streaming", "currentMessageId", null);
  });

  registry.register("agent_end", (_, ctx) => {
    ctx.setStore("streaming", "phase", "idle");
    ctx.setStore("streaming", "currentMessageId", null);
    ctx.setStore("streaming", "currentToolName", null);
    ctx.setStore("retry", null);
  });

  registry.register("abort", (_, ctx) => {
    ctx.setStore("streaming", "phase", "idle");
    ctx.setStore("streaming", "currentMessageId", null);
    ctx.setStore("streaming", "currentToolName", null);
    ctx.setStore("retry", null);
  });
}
```

**Step 4: Run — verify pass**

**Step 5: Commit**

---

### Task 5: Implement message handlers

**Files:**

- Create: `apps/desktop/src/stores/session/handlers/message-events.ts`
- Create test: `apps/desktop/src/stores/session/__tests__/handlers/message-events.test.ts`

**Step 1: Write failing tests**

Key behaviors to test:

- `message_start (user)` → creates new turn with userMessage
- `message_start (assistant)` → creates assistant message in current turn, sets currentMessageId
- `message_update (text)` → batcher appends text token
- `message_update (thinking)` → appends thinking token
- `message_end` → finalizes message (isStreaming=false), stores usage

```typescript
describe("message handlers", () => {
  it("message_start for user creates a new turn", () => {
    // dispatch message_start(userMsg) → turns grows by 1
    // turns[last].userMessage.content === "hello"
  });

  it("message_start for assistant creates streaming message", () => {
    // pre: startTurn(user)
    // dispatch message_start(assistant) → turns[last].messages grows by 1
    // turns[last].messages[last].isStreaming === true
    // streaming.currentMessageId set
  });

  it("message_update text delta appends via batcher", () => {
    // pre: message_start(assistant)
    // dispatch message_update(text "Hel")
    // dispatch message_update(text "lo")
    // after batcher flush → turns[0].messages[0].parts[last].text === "Hello"
  });

  it("message_end finalizes message and stores usage", () => {
    // pre: message_start + deltas
    // dispatch message_end(msg with usage)
    // turns[last].messages[last].isStreaming === false
    // turns[last].messages[last].usage populated
  });

  it("duplicate user message (already in store) is ignored", () => {
    // wasLastUserMessage dedup
  });
});
```

**Step 2: Run — verify fails**

**Step 3: Implement**

Extract text content from AgentMessage (reuse existing `extractTextContent` helper). The user-message dedup uses `wasLastUserMessage`.

```typescript
// handlers/message-events.ts
export function registerMessageHandlers(registry: EventHandlerRegistry): void {
  registry.register("message_start", (event, ctx) => {
    const msg = event.message;
    if (msg.role === "user") {
      const text = extractTextContent(msg);
      if (ctx.store.actions.wasLastUserMessage(text)) return; // dedup
      ctx.store.actions.startTurn(userMsg);
    } else if (msg.role === "assistant") {
      ctx.store.actions.addAssistantMessage(assistantMsg);
    }
  });

  registry.register("message_update", (event, ctx) => {
    const msgId = ctx.store.streaming.currentMessageId;
    if (!msgId) return;
    if (event.delta.kind === "text") {
      ctx.batcher.append(msgId, event.delta.text);
    } else if (event.delta.kind === "thinking") {
      ctx.store.actions.appendThinkingToken(msgId, event.delta.text);
    }
  });

  registry.register("message_end", (event, ctx) => {
    const msgId = ctx.store.streaming.currentMessageId;
    if (msgId) {
      ctx.store.actions.finalizeMessage(msgId, extractUsage(event.message));
    }
  });
}
```

Note: The `HandlerContext` needs access to `actions`. Either pass `SessionStore` (store + actions) in the context, or pass actions separately. Decision: **extend `HandlerContext` to include `actions: SessionActions`** — cleaner than accessing through store.

**Step 4: Run — verify pass**

**Step 5: Commit**

---

### Task 6: Implement tool handlers

**Files:**

- Create: `apps/desktop/src/stores/session/handlers/tool-events.ts`
- Create test: `apps/desktop/src/stores/session/__tests__/handlers/tool-events.test.ts`

**Step 1: Write failing tests**

```typescript
describe("tool handlers", () => {
  it("tool_execution_start adds tool_call part and sets phase", () => {
    // pre: turn + assistant message
    // dispatch tool_execution_start("tc1", "read", {path: "/foo"})
    // → parts includes {type: "tool_call", toolName: "read", status: "running"}
    // → streaming.phase === "tool_running"
    // → streaming.currentToolName === "read"
  });

  it("tool_execution_end completes the tool_call part with result", () => {
    // pre: tool_execution_start
    // dispatch tool_execution_end("tc1", result, false)
    // → part.status === "done", part.result set
  });

  it("propose_session tool sets proposedSession", () => {
    // dispatch tool_execution_start with toolName "propose_session"
    // → store.proposedSession set
  });
});
```

**Step 2: Run — verify fails**

**Step 3: Implement** — port from existing `event-reducer.ts` tool handling.

**Step 4: Run — verify pass**

**Step 5: Commit**

---

### Task 7: Implement compaction handlers (THE BUG FIX)

**Files:**

- Create: `apps/desktop/src/stores/session/handlers/compaction-events.ts`
- Create test: `apps/desktop/src/stores/session/__tests__/handlers/compaction-events.test.ts`

**Step 1: Write failing tests — these are the regression tests for the splitCache bug**

```typescript
describe("compaction handlers — the bug fix", () => {
  it("compaction_start adds marker to last assistant message after turn ended", () => {
    // Setup: complete a full turn (user → assistant → finalize)
    const { ctx, session } = setupWithCompletedTurn();

    // Dispatch compaction_start AFTER the turn is done
    dispatch({ type: "compaction_start", reason: "manual" }, ctx);

    const parts = session.store.turns[0]!.messages[0]!.parts;
    expect(parts.some((p) => p.type === "compaction")).toBe(true);
  });

  it("compaction_delta appends text to the compaction part", () => {
    const { ctx, session } = setupWithCompletedTurn();
    dispatch({ type: "compaction_start", reason: "manual" }, ctx);
    dispatch({ type: "compaction_delta", text: "Sum" }, ctx);
    dispatch({ type: "compaction_delta", text: "mary" }, ctx);

    const compactionPart = session.store.turns[0]!.messages[0]!.parts.find(
      (p) => p.type === "compaction",
    );
    expect(compactionPart).toMatchObject({ type: "compaction", text: "Summary" });
  });

  it("compaction_end with result marks marker complete with tokensBefore", () => {
    const { ctx, session } = setupWithCompletedTurn();
    dispatch({ type: "compaction_start", reason: "manual" }, ctx);
    dispatch(
      {
        type: "compaction_end",
        reason: "manual",
        result: { summary: "...", firstKeptEntryId: "x", tokensBefore: 50000 },
        aborted: false,
        willRetry: false,
      },
      ctx,
    );

    const compactionPart = session.store.turns[0]!.messages[0]!.parts.find(
      (p) => p.type === "compaction",
    );
    expect(compactionPart).toMatchObject({
      type: "compaction",
      status: "complete",
      tokensBefore: 50000,
    });
  });

  it("compaction_end with errorMessage marks marker failed", () => {
    // dispatch compaction_end with errorMessage → status "failed", error set
  });

  it("compaction_end without result or error marks as skipped", () => {
    // dispatch compaction_end without result or errorMessage → status "failed", error "Nothing to compact"
  });
});
```

**Step 2: Run — verify fails**

**Step 3: Implement**

```typescript
// handlers/compaction-events.ts
export function registerCompactionHandlers(registry: EventHandlerRegistry): void {
  registry.register("compaction_start", (_, ctx) => {
    const msgId = ctx.actions.getCurrentMessageId() ?? ctx.actions.getLastAssistantMessageId();
    if (msgId) ctx.actions.addCompactionMarker(msgId);
    ctx.actions.setPhase("thinking");
  });

  registry.register("compaction_delta", (event, ctx) => {
    const msgId = ctx.actions.getCurrentMessageId() ?? ctx.actions.getLastAssistantMessageId();
    if (msgId) ctx.actions.appendCompactionToken(msgId, event.text);
  });

  registry.register("compaction_end", (event, ctx) => {
    const msgId = ctx.actions.getCurrentMessageId() ?? ctx.actions.getLastAssistantMessageId();
    if (msgId) {
      if (event.errorMessage !== undefined) {
        ctx.actions.updateCompactionMarker(msgId, {
          status: "failed",
          error: event.errorMessage,
          endedAt: Date.now(),
        });
      } else if (event.result) {
        ctx.actions.updateCompactionMarker(msgId, {
          status: "complete",
          tokensBefore: event.result.tokensBefore,
          endedAt: Date.now(),
        });
      } else {
        ctx.actions.updateCompactionMarker(msgId, {
          status: "failed",
          error: "Nothing to compact",
          endedAt: Date.now(),
        });
      }
    }
    ctx.actions.setPhase("idle");
  });
}
```

**Step 4: Run — verify pass**

**Step 5: Commit**

---

### Task 8: Implement OM handlers

**Files:**

- Create: `apps/desktop/src/stores/session/handlers/om-events.ts`
- Create test: `apps/desktop/src/stores/session/__tests__/handlers/om-events.test.ts`

Same TDD pattern. Port from existing `event-reducer.ts` om_start/end/failed/activation/status handlers.

**Commit after completion.**

---

### Task 9: Implement retry handlers

**Files:**

- Create: `apps/desktop/src/stores/session/handlers/retry-events.ts`
- Create test: `apps/desktop/src/stores/session/__tests__/handlers/retry-events.test.ts`

Same TDD pattern. Port auto_retry_start/end handlers.

**Commit after completion.**

---

### Task 10: Wire up timing wrapper + full registry

**Files:**

- Modify: `apps/desktop/src/stores/session/event-handler.ts`

The timing wrapper handles `startTurn`/`finalizeTurn` calls based on `agent_start`/`agent_end` events (same as existing `handleTurnTiming`).

```typescript
function withTiming(dispatch: typeof registry.dispatch): typeof registry.dispatch {
  return (event, ctx) => {
    if (event.type === "agent_start") ctx.actions.startTiming();
    if (event.type === "agent_end" || event.type === "abort")
      ctx.actions.finalizeTiming(Date.now());
    dispatch(event, ctx);
  };
}
```

**Commit after completion.**

---

## Phase 3: REST Hydration

### Task 11: Update `hydrate-chat.ts` — produce `Turn[]`

**Files:**

- Modify: `apps/desktop/src/stores/session/hydrate-chat.ts`
- Update test: `apps/desktop/src/stores/session/__tests__/hydrate-chat.test.ts`

**Step 1: Write failing tests**

```typescript
describe("hydrateChatTurns", () => {
  it("maps ChatTurnDTO[] to Turn[]", () => {
    const dtos: ChatTurnDTO[] = [
      {
        id: "t1",
        sequence: 0,
        startedAt: 1000,
        endedAt: 2000,
        userMessage: { id: "u1", message: userMsg },
        summaryMessage: { id: "s1", message: assistantMsg },
        intermediateIds: ["m1", "m2"],
      },
    ];
    const turns = hydrateChatTurns(dtos);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.id).toBe("t1");
    expect(turns[0]!.userMessage?.content).toBe("hello");
    expect(turns[0]!.messages).toHaveLength(1); // summary only
    expect(turns[0]!.messages[0]!.id).toBe("s1");
    expect(turns[0]!.intermediateCount).toBe(2);
    expect(turns[0]!.intermediatesLoaded).toBe(false);
  });
});
```

**Step 2: Run — verify fails**

**Step 3: Implement** — map ChatTurnDTO → Turn using existing convert helpers.

**Step 4: Run — verify pass**

**Step 5: Commit**

---

### Task 12: Update `hydrate-messages.ts` — legacy path produces `Turn[]`

For sessions loaded via `/messages` (no turn structure), group messages into turns by detecting user messages.

**Step 1: Write failing test** — `hydrateSessionTurns(messages: AgentMessage[]): Turn[]`

**Step 2: Run — verify fails**

**Step 3: Implement** — iterate messages, create new Turn on each user message, append assistant/toolResult messages to current turn.

**Step 4: Run — verify pass**

**Step 5: Commit**

---

### Task 13: Update `actions.ts` — load functions use turns

**Files:**

- Modify: `apps/desktop/src/stores/server/actions.ts`

Update `loadChat`, `loadMessages`, `loadIntermediates`, `evictIntermediates` to call the new store actions (`loadTurns`, `loadIntermediates`, `evictIntermediates`).

```typescript
async loadChat(sessionId) {
  const res = await api.api.sessions[":id"].chat.$get({ param: { id: sessionId } });
  const body = await res.json();
  const turns = hydrateChatTurns(body.turns);
  const session = sessionRegistry.get(sessionId);
  session.actions.loadTurns(turns);
}

async loadMessages(sessionId) {
  const res = await api.api.sessions[":id"].messages.$get({ param: { id: sessionId } });
  const messages = await res.json();
  const turns = hydrateSessionTurns(messages);
  const session = sessionRegistry.get(sessionId);
  session.actions.loadTurns(turns);
  // load turn timings...
}
```

**Commit after completion.**

---

## Phase 4: WS Client Integration

### Task 14: Update `ws-client.ts` — use new dispatch

**Files:**

- Modify: `apps/desktop/src/stores/server/ws-client.ts`

Replace `dispatchEvent(actions, batcher, evt, opts)` with the registry dispatch:

```typescript
case "event": {
  if (!data.sessionId || data.event === undefined) break;
  const evt = data.event as AgentHarnessEvent;
  const session = sessionRegistry.get(data.sessionId);
  const batcher = getBatcher(data.sessionId);
  const ctx: HandlerContext = {
    store: session.store,
    setStore: session.setStore,
    actions: session.actions,
    batcher,
  };
  registry.dispatch(evt, ctx);
  break;
}
```

The registry is created once and `registerAll()` is called at module init.

**Commit after completion.**

---

## Phase 5: Component Layer

### Task 15: Update `task-chat-view.tsx` — read turns directly

**Files:**

- Modify: `apps/desktop/src/components/chat-area/task-chat-view.tsx`

Replace `buildChatTurns` call with direct store read:

```typescript
const turns = createMemo(() => {
  const session = sessionStore();
  return session ? session.store.turns : [];
});
```

No more projection. No more cache.

**Commit after completion.**

---

### Task 16: Update `session-turn.tsx` — thinking inline collapsible

**Files:**

- Modify: `apps/desktop/src/components/chat-area/timeline/session-turn.tsx`

Key changes:

1. Use `turn.userMessage` and `turn.messages` directly (already the same shape)
2. The collapse accordion uses `turn.messages` (slice 0,-1 for intermediates, last for summary)
3. Thinking parts render as collapsible sub-sections within `MessageContent`, NOT as separate intermediate messages

Add a `<ThinkingCollapsible>` component or inline `<details>`:

```tsx
function MessageContent(msg: UIMessage): JSX.Element {
  return (
    <div class={CHAT_COMPACT_STACK_GAP_CLASS}>
      <Index each={msg.parts}>
        {(part) => (
          <div class="flex flex-col gap-1">
            <Show
              when={part().type === "thinking"}
              fallback={
                <Part isStreaming={resolvePartStreaming(part(), msg.isStreaming)} part={part()} />
              }
            >
              <ThinkingCollapsible part={part()} />
            </Show>
            <Show when={!part().isStreaming}>
              <PartFooter copyText={getPartCopyText(part())} timestamp={msg.timestamp} />
            </Show>
          </div>
        )}
      </Index>
    </div>
  );
}
```

**Commit after completion.**

---

### Task 17: Update `estimate-turn-height.ts` — use `Turn` type

**Files:**

- Modify: `apps/desktop/src/components/chat-area/timeline/estimate-turn-height.ts`

Replace `ChatTurn` import with `Turn`. Replace `turn.assistantMessages` with `turn.messages`. Otherwise the estimation logic stays the same.

**Commit after completion.**

---

### Task 18: Update remaining consumers

Check and update any files that import from `turn-projection.ts` or reference `ChatTurn`:

```bash
rg "turn-projection|ChatTurn" apps/desktop/src -g "*.ts" -g "*.tsx"
```

Update each to use `Turn` from `stores/types.ts`.

**Commit after completion.**

---

## Phase 6: Cleanup

### Task 19: Delete old files

**Files to delete:**

- `apps/desktop/src/stores/session/turn-projection.ts`
- `apps/desktop/src/stores/session/__tests__/turn-projection-stability.test.ts`
- `apps/desktop/src/stores/session/__tests__/turn-projection.test.ts`
- `apps/desktop/src/stores/session/event-reducer.ts`
- `apps/desktop/src/stores/session/__tests__/event-reducer.test.ts`

**Commit:**

```bash
git rm apps/desktop/src/stores/session/turn-projection.ts
git rm apps/desktop/src/stores/session/__tests__/turn-projection-stability.test.ts
git rm apps/desktop/src/stores/session/__tests__/turn-projection.test.ts
git rm apps/desktop/src/stores/session/event-reducer.ts
git rm apps/desktop/src/stores/session/__tests__/event-reducer.test.ts
git commit -m "refactor(store): delete turn-projection and event-reducer (replaced by turn-first store)"
```

---

### Task 20: Remove old types from `types.ts`

Clean up any leftover types that were kept for backward compat:

- Remove `TurnMeta` if no longer used
- Remove any old `SessionStoreData` fields (`messageOrder`, `messages`, `turnTimings`)
- Remove `agentMessageToUI` if no longer used (or update for turn structure)

**Commit after completion.**

---

### Task 21: Update `session-store.test.ts` — migrate to new store API

**Files:**

- Rewrite: `apps/desktop/src/stores/session/__tests__/session-store.test.ts`

The old test file tests `messageOrder`, `messages` record, etc. Replace with tests against the new turn-first store API. Many of these tests are already covered by `turn-store.test.ts` (Task 2).

**Commit after completion.**

---

### Task 22: Update `actions.test.ts` and `ws-client.test.ts`

**Files:**

- Update: `apps/desktop/src/stores/server/__tests__/actions.test.ts`
- Update: `apps/desktop/src/stores/server/__tests__/ws-client.test.ts`

These tests reference `store.messages`, `store.messageOrder`. Update to use `store.turns`.

**Commit after completion.**

---

### Task 23: Full test run + type check

```bash
vp run desktop#test
vp check
```

Fix any remaining type errors or test failures.

**Final commit:**

```bash
git add -A && git commit -m "fix(store): complete turn-first migration — all tests pass"
```

---

## Migration Notes

### Backward Compatibility

During the migration, old types (`ChatTurn`, `TurnMeta`) can coexist with new types (`Turn`). The old files (`turn-projection.ts`, `event-reducer.ts`) are deleted only in Phase 6 after all consumers are updated.

### Performance Verification

After Phase 5, manually verify:

1. Token streaming doesn't cause full-list re-renders (check with Solid DevTools)
2. Compaction markers appear immediately (the original bug)
3. Virtualized list scroll is smooth with 50+ turns
4. Intermediate load/evict doesn't disturb other turns

### Extensibility Test

After completion, verify adding a new part type is 3 steps:

1. Add to `MessagePart` union
2. Register handlers in `handlers/X-events.ts`
3. Register component in `register-parts.ts`

No changes needed to store, projection, or virtualizer.
