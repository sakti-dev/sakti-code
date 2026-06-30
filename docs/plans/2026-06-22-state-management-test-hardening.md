# State Management Test Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix critical bugs in the SolidJS state management layer and achieve comprehensive unit test coverage across all store modules.

**Architecture:** Four phases: (1) fix the event-reducer tool-call-dropping bug and singleton state leak, (2) build shared test infrastructure (factories, helpers, cleanup), (3) fill all missing unit tests per module following real agent event ordering, (4) fix remaining code quality issues surfaced in review.

**Tech Stack:** SolidJS 1.9 (`createStore`, `createSignal`, `createRoot`, `createEffect`), vitest 4.x, `@solidjs/testing-library`, `@earendil-works/pi-ai` types.

---

## Critical Context for the Implementer

### The #1 bug: tool calls silently dropped

The agent loop emits events in this order (confirmed in `packages/agent/src/loop/agent-loop.ts:195-232`):

```
agent_start → turn_start → message_start(assistant) → message_update(text_delta) →
message_end → tool_execution_start → tool_execution_end → turn_end → agent_end
```

The current reducer clears `currentMessageId` on `message_end`. So when `tool_execution_start` fires, `getCurrentMessageId()` returns `null` and the tool call is silently skipped. **The UI will never show tool calls.**

The correct pattern (confirmed from pibun reference at `openspec/references/pibun/apps/web/src/wireTransport.ts:232-236`): `message_end` only flips `isStreaming = false`. The pointer is cleared on `turn_end`, after all tools have finished.

### The #2 bug: module-level singletons

`session-registry.ts`, `terminal-registry.ts`, `server-store.ts`, and `ui-signals.ts` all use module-level mutable state. This causes test pollution (state leaks between test files) and HMR breakage in dev.

The fix: factories return fresh instances. The `StoreProvider` creates them and provides via context. Tests create their own instances — no singleton pollution.

### Agent event types (from `packages/agent/src/types.ts:493-533`)

```typescript
// Agent lifecycle
{ type: "agent_start" }
{ type: "agent_end"; messages: AgentMessage[] }

// Turn lifecycle (a turn = one assistant response + tool calls)
{ type: "turn_start" }
{ type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }

// Message lifecycle
{ type: "message_start"; message: AgentMessage }
{ type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
{ type: "message_end"; message: AgentMessage }

// Tool execution lifecycle
{ type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
{ type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
{ type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean }
```

### AssistantMessage shape (from pi-ai)

```typescript
interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: string;
  provider: string;
  model: string;
  usage: Usage;
  stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
  timestamp: number;
  // optional: responseModel, responseId, diagnostics, errorMessage
}

interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}
```

### Commands

```bash
cd apps/app && npx vitest run                    # run all frontend tests
cd apps/app && npx vitest run <file>             # run specific test file
bun typecheck                                     # root typecheck
bun x ultracite fix                               # lint + format
```

---

## Phase 1: Fix Critical Bugs

### Task 1: Fix event-reducer — don't clear currentMessageId on message_end

**Files:**

- Modify: `apps/app/src/stores/event-reducer.ts:87-94`

**Step 1: Write the failing test**

Add to `apps/app/src/stores/__tests__/event-reducer.test.ts`:

```typescript
it("full turn lifecycle: message_end does not prevent tool_execution_start", () => {
  const { session, batcher } = setup();

  // Simulate real event ordering from agent-loop.ts
  dispatchEvent(session.actions, batcher, {
    type: "message_start",
    message: makeAssistantMessage(""),
  } as AgentHarnessEvent);

  const msgId = session.store.streaming.currentMessageId!;

  dispatchEvent(session.actions, batcher, {
    type: "message_end",
    message: makeAssistantMessage(""),
  } as AgentHarnessEvent);

  // message_end should finalize the message, NOT clear currentMessageId
  expect(session.store.messages[msgId]!.isStreaming).toBe(false);
  expect(session.store.streaming.currentMessageId).toBe(msgId);

  // tool_execution_start must still find the message
  dispatchEvent(session.actions, batcher, {
    type: "tool_execution_start",
    toolCallId: "tc1",
    toolName: "bash",
    args: { command: "ls" },
  } as AgentHarnessEvent);

  expect(session.store.messages[msgId]!.parts).toHaveLength(1);
  expect(session.store.messages[msgId]!.parts[0]).toMatchObject({
    type: "tool_call",
    toolName: "bash",
    status: "running",
  });
});
```

Also add a test that `turn_end` clears currentMessageId:

```typescript
it("turn_end clears currentMessageId after tools complete", () => {
  const { session, batcher } = setup();

  dispatchEvent(session.actions, batcher, {
    type: "message_start",
    message: makeAssistantMessage(""),
  } as AgentHarnessEvent);
  const msgId = session.store.streaming.currentMessageId!;

  dispatchEvent(session.actions, batcher, {
    type: "message_end",
    message: makeAssistantMessage(""),
  } as AgentHarnessEvent);

  dispatchEvent(session.actions, batcher, {
    type: "turn_end",
    message: makeAssistantMessage("done"),
    toolResults: [],
  } as AgentHarnessEvent);

  expect(session.store.streaming.currentMessageId).toBeNull();
  expect(session.store.streaming.phase).toBe("idle");
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/app && npx vitest run stores/__tests__/event-reducer.test.ts
```

Expected: FAIL — the first test fails because `currentMessageId` is null after `message_end`, so tool_execution_start is skipped.

**Step 3: Fix event-reducer.ts**

In `apps/app/src/stores/event-reducer.ts`, change the `message_end` case:

Replace:

```typescript
    case "message_end": {
      const msgId = actions.getCurrentMessageId();
      if (msgId) {
        actions.finalizeMessage(msgId);
        actions.clearCurrentMessage();
      }
      break;
    }
```

With:

```typescript
    case "message_end": {
      const msgId = actions.getCurrentMessageId();
      if (msgId) {
        actions.finalizeMessage(msgId);
      }
      break;
    }
```

And change the `turn_end` case:

Replace:

```typescript
    case "turn_end":
      actions.setPhase("idle");
      break;
```

With:

```typescript
    case "turn_end":
      actions.setPhase("idle");
      actions.clearCurrentMessage();
      break;
```

**Step 4: Run all event-reducer tests**

```bash
cd apps/app && npx vitest run stores/__tests__/event-reducer.test.ts
```

Expected: PASS

**Step 5: Run full test suite to check for regressions**

```bash
cd apps/app && npx vitest run
```

Expected: All pass. The old event-reducer tests that went `message_start → tool_execution_start` (skipping `message_end`) still work because `currentMessageId` is still set.

**Step 6: Commit**

```bash
git add apps/app/src/stores/event-reducer.ts apps/app/src/stores/__tests__/event-reducer.test.ts
git commit -m "fix(event-reducer): don't clear currentMessageId until turn_end

message_end was clearing currentMessageId before tool_execution_start,
causing all tool calls to be silently dropped. The real agent event
ordering is message_end → tool_execution_start → turn_end."
```

---

### Task 2: Refactor server-store from singleton to factory

**Files:**

- Modify: `apps/app/src/stores/server-store.ts` (remove singleton, keep factory)
- Modify: `apps/app/src/stores/__tests__/server-store.test.ts` (already uses factory)

**Step 1: Remove singleton from server-store.ts**

In `apps/app/src/stores/server-store.ts`, delete the bottom section:

```typescript
// DELETE THESE LINES:
let singleton: ServerStore | null = null;

export function getServerStore(): ServerStore {
  if (!singleton) {
    singleton = createServerStore();
  }
  return singleton;
}
```

The `createServerStore` factory function stays — that's all we need.

**Step 2: Verify server-store tests still pass**

```bash
cd apps/app && npx vitest run stores/__tests__/server-store.test.ts
```

Expected: PASS (tests already use `createServerStore()` directly)

**Step 3: Commit**

```bash
git add apps/app/src/stores/server-store.ts
git commit -m "refactor(server-store): remove module-level singleton

Singletons cause test pollution and HMR breakage. Consumers should
create or receive a store instance via StoreProvider context."
```

---

### Task 3: Refactor session-registry and terminal-registry from module-level to instance

**Files:**

- Modify: `apps/app/src/stores/session-registry.ts`
- Modify: `apps/app/src/stores/terminal-registry.ts`
- Modify: `apps/app/src/stores/__tests__/session-registry.test.ts`

**Step 1: Refactor session-registry.ts to a class/factory**

Replace entire contents of `apps/app/src/stores/session-registry.ts`:

```typescript
import type { SessionStore } from "./session-store.ts";
import { createSessionStore } from "./session-store.ts";

export class SessionRegistry {
  private readonly stores = new Map<string, SessionStore>();

  get(sessionId: string): SessionStore {
    let store = this.stores.get(sessionId);
    if (!store) {
      store = createSessionStore(sessionId);
      this.stores.set(sessionId, store);
    }
    return store;
  }

  has(sessionId: string): boolean {
    return this.stores.has(sessionId);
  }

  dispose(sessionId: string): void {
    this.stores.delete(sessionId);
  }

  disposeAll(): void {
    this.stores.clear();
  }
}
```

**Step 2: Refactor terminal-registry.ts the same way**

Replace entire contents of `apps/app/src/stores/terminal-registry.ts`:

```typescript
import { createTerminalStore, type TerminalStore } from "./terminal-store.ts";

export class TerminalRegistry {
  private readonly stores = new Map<string, TerminalStore>();

  get(terminalId: string): TerminalStore {
    let store = this.stores.get(terminalId);
    if (!store) {
      store = createTerminalStore(terminalId);
      this.stores.set(terminalId, store);
    }
    return store;
  }

  has(terminalId: string): boolean {
    return this.stores.has(terminalId);
  }

  dispose(terminalId: string): void {
    this.stores.delete(terminalId);
  }

  disposeAll(): void {
    this.stores.clear();
  }
}
```

**Step 3: Rewrite session-registry.test.ts to use fresh instances**

Replace entire contents of `apps/app/src/stores/__tests__/session-registry.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { SessionRegistry } from "../session-registry.ts";

describe("SessionRegistry", () => {
  it("creates store lazily on first access", () => {
    const registry = new SessionRegistry();
    expect(registry.has("s1")).toBe(false);
    const store1 = registry.get("s1");
    expect(registry.has("s1")).toBe(true);

    const store2 = registry.get("s1");
    expect(store2).toBe(store1);
  });

  it("disposes store and allows re-creation", () => {
    const registry = new SessionRegistry();
    const store1 = registry.get("s2");
    registry.dispose("s2");
    expect(registry.has("s2")).toBe(false);

    const store2 = registry.get("s2");
    expect(store2).not.toBe(store1);
  });

  it("dispose non-existent session does not throw", () => {
    const registry = new SessionRegistry();
    expect(() => registry.dispose("nonexistent")).not.toThrow();
  });

  it("supports multiple coexisting sessions", () => {
    const registry = new SessionRegistry();
    const s1 = registry.get("s1");
    const s2 = registry.get("s2");
    expect(s1).not.toBe(s2);
    expect(registry.has("s1")).toBe(true);
    expect(registry.has("s2")).toBe(true);
  });

  it("disposeAll clears all sessions", () => {
    const registry = new SessionRegistry();
    registry.get("s1");
    registry.get("s2");
    registry.disposeAll();
    expect(registry.has("s1")).toBe(false);
    expect(registry.has("s2")).toBe(false);
  });
});
```

**Step 4: Run registry tests**

```bash
cd apps/app && npx vitest run stores/__tests__/session-registry.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add apps/app/src/stores/session-registry.ts apps/app/src/stores/terminal-registry.ts apps/app/src/stores/__tests__/session-registry.test.ts
git commit -m "refactor(registries): replace module-level singletons with class instances

SessionRegistry and TerminalRegistry are now instantiable classes.
Each consumer creates its own instance — no module-level state, no
test pollution, no HMR breakage."
```

---

### Task 4: Update ws-client to accept stores as dependencies

**Files:**

- Modify: `apps/app/src/stores/ws-client.ts`
- Modify: `apps/app/src/stores/__tests__/ws-client.test.ts`

**Step 1: Update ws-client.ts to accept injected dependencies**

Replace the top of `createWsClient` in `apps/app/src/stores/ws-client.ts`:

Replace:

```typescript
export function createWsClient(
  url: string,
  WebSocketCtor: typeof WebSocket = WebSocket
): WsClient {
  const server = getServerStore();
```

With:

```typescript
export interface WsClientDeps {
  serverStore: { store: ServerStoreData; actions: ServerActions };
  sessionRegistry: SessionRegistry;
  terminalRegistry: TerminalRegistry;
}

export function createWsClient(
  url: string,
  deps: WsClientDeps,
  WebSocketCtor: typeof WebSocket = WebSocket
): WsClient {
  const { serverStore: server, sessionRegistry, terminalRegistry } = deps;
```

Update the imports at the top of the file:

Replace:

```typescript
import { dispatchEvent } from "./event-reducer.ts";
import { getServerStore } from "./server-store.ts";
import { getSessionStore } from "./session-registry.ts";
import { getTerminalStore } from "./terminal-registry.ts";
import { createTokenBatcher } from "./token-batcher.ts";
```

With:

```typescript
import { dispatchEvent } from "./event-reducer.ts";
import type { ServerActions, ServerStoreData } from "./server-store.ts";
import { SessionRegistry } from "./session-registry.ts";
import { TerminalRegistry } from "./terminal-registry.ts";
import { createTokenBatcher } from "./token-batcher.ts";
```

Update all `getSessionStore(...)` calls to `sessionRegistry.get(...)` and `getTerminalStore(...)` to `terminalRegistry.get(...)`:

In `getBatcher`:

```typescript
const session = sessionRegistry.get(sessionId);
```

In `handleFrame`, `case "event"`:

```typescript
const session = sessionRegistry.get(data.sessionId);
```

In `handleFrame`, `case "error"`:

```typescript
const session = sessionRegistry.get(data.sessionId);
```

In `handleFrame`, `case "push"`:

```typescript
terminalRegistry.get(d.terminalId).appendData(d.data);
```

and:

```typescript
terminalRegistry.get(d.terminalId).setExit(d.exitCode);
```

**Step 2: Rewrite ws-client.test.ts**

Replace entire contents of `apps/app/src/stores/__tests__/ws-client.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createServerStore } from "../server-store.ts";
import { SessionRegistry } from "../session-registry.ts";
import { TerminalRegistry } from "../terminal-registry.ts";
import { createWsClient } from "../ws-client.ts";

class MockWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  readyState = 0;

  constructor(_url: string) {
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

function makeDeps() {
  return {
    serverStore: createServerStore(),
    sessionRegistry: new SessionRegistry(),
    terminalRegistry: new TerminalRegistry(),
  };
}

describe("WS client", () => {
  it("welcome frame sets connection to open", () => {
    const deps = makeDeps();
    const ws = createWsClient("ws://test", deps, MockWebSocket as never);

    const mockWs = MockWebSocket as unknown as MockWebSocket;
    // Simulate welcome after open
    deps.serverStore.store.connection.status; // trigger initial state read

    ws.disconnect();
  });

  it("dispatches event frames to session store", () => {
    const deps = makeDeps();
    const ws = createWsClient("ws://test", deps, MockWebSocket as never);

    // Access the underlying mock via the closure — we need a different approach
    ws.disconnect();
  });
});
```

Wait — the MockWebSocket approach needs rework. The old tests used a static `instances` array and `setTimeout`. Let me use a cleaner pattern:

Replace the entire ws-client.test.ts with:

```typescript
import { describe, expect, it, vi } from "vitest";
import { createServerStore } from "../server-store.ts";
import { SessionRegistry } from "../session-registry.ts";
import { TerminalRegistry } from "../terminal-registry.ts";
import { createWsClient } from "../ws-client.ts";
import type { WsOut } from "@sakti-code/server/ws";

function makeDeps() {
  return {
    serverStore: createServerStore(),
    sessionRegistry: new SessionRegistry(),
    terminalRegistry: new TerminalRegistry(),
  };
}

function makeMockWs() {
  const handlers = {
    onopen: null as (() => void) | null,
    onmessage: null as ((event: { data: string }) => void) | null,
    onclose: null as (() => void) | null,
  };
  const sent: string[] = [];
  let readyState = 0;

  const mock = {
    get readyState() {
      return readyState;
    },
    set onopen(fn: (() => void) | null) {
      handlers.onopen = fn;
    },
    set onmessage(fn: ((event: { data: string }) => void) | null) {
      handlers.onmessage = fn;
    },
    set onclose(fn: (() => void) | null) {
      handlers.onclose = fn;
    },
    send(data: string) {
      sent.push(data);
    },
    close() {
      readyState = 3;
      handlers.onclose?.();
    },
    fireOpen() {
      readyState = 1;
      handlers.onopen?.();
    },
    fireMessage(data: WsOut) {
      handlers.onmessage?.({ data: JSON.stringify(data) });
    },
    fireClose() {
      readyState = 3;
      handlers.onclose?.();
    },
    sent,
  };

  function MockWebSocketCtor() {
    return mock;
  }

  return { mock, Ctor: MockWebSocketCtor as never };
}

describe("WS client", () => {
  it("welcome frame sets connection to open", () => {
    const deps = makeDeps();
    const { mock, Ctor } = makeMockWs();
    const ws = createWsClient("ws://test", deps, Ctor);

    expect(deps.serverStore.store.connection.status).toBe("connecting");

    mock.fireOpen();
    mock.fireMessage({ type: "welcome", version: "1.0.0", cwd: "/tmp" });

    expect(deps.serverStore.store.connection.status).toBe("open");

    ws.disconnect();
  });

  it("dispatches event frames to session store", () => {
    const deps = makeDeps();
    const { mock, Ctor } = makeMockWs();
    const ws = createWsClient("ws://test", deps, Ctr);

    mock.fireOpen();
    mock.fireMessage({
      type: "event",
      sessionId: "s-test",
      event: { type: "agent_start" },
    });

    const session = deps.sessionRegistry.get("s-test");
    expect(session.store.streaming.phase).toBe("thinking");

    ws.disconnect();
  });

  it("send serializes and sends prompt frame", () => {
    const deps = makeDeps();
    const { mock, Ctor } = makeMockWs();
    const ws = createWsClient("ws://test", deps, Ctor);

    mock.fireOpen();
    ws.send({ type: "prompt", sessionId: "s1", message: "hello" });

    expect(mock.sent).toHaveLength(1);
    expect(JSON.parse(mock.sent[0]!)).toEqual({
      type: "prompt",
      sessionId: "s1",
      message: "hello",
    });

    ws.disconnect();
  });

  it("send is dropped when socket not open", () => {
    const deps = makeDeps();
    const { mock, Ctor } = makeMockWs();
    const ws = createWsClient("ws://test", deps, Ctor);

    // Don't fire open — socket is still connecting
    ws.send({ type: "prompt", sessionId: "s1", message: "hello" });
    expect(mock.sent).toHaveLength(0);

    ws.disconnect();
  });

  it("error frame sets error on current message", () => {
    const deps = makeDeps();
    const { mock, Ctor } = makeMockWs();
    const ws = createWsClient("ws://test", deps, Ctor);

    mock.fireOpen();

    // Set up a session with a current message
    const session = deps.sessionRegistry.get("s1");
    session.actions.addMessage({
      id: "m1",
      role: "assistant",
      content: "",
      parts: [],
      isStreaming: true,
      timestamp: Date.now(),
    });
    session.actions.setCurrentMessage("m1");

    mock.fireMessage({ type: "error", sessionId: "s1", error: "boom" });

    expect(session.store.messages.m1!.error).toBe("boom");
    expect(session.store.streaming.phase).toBe("error");

    ws.disconnect();
  });

  it("push frame routes terminal data", () => {
    const deps = makeDeps();
    const { mock, Ctor } = makeMockWs();
    const ws = createWsClient("ws://test", deps, Ctor);

    mock.fireOpen();
    mock.fireMessage({
      type: "push",
      channel: "terminal.data",
      data: { terminalId: "t1", data: "hello terminal" },
    });

    const term = deps.terminalRegistry.get("t1");
    expect(term.store.buffer).toBe("hello terminal");

    ws.disconnect();
  });

  it("push frame routes terminal exit", () => {
    const deps = makeDeps();
    const { mock, Ctor } = makeMockWs();
    const ws = createWsClient("ws://test", deps, Ctor);

    mock.fireOpen();
    mock.fireMessage({
      type: "push",
      channel: "terminal.exit",
      data: { terminalId: "t1", exitCode: 0 },
    });

    const term = deps.terminalRegistry.get("t1");
    expect(term.store.exitCode).toBe(0);

    ws.disconnect();
  });

  it("malformed JSON is silently ignored", () => {
    const deps = makeDeps();
    const { mock, Ctor } = makeMockWs();
    const ws = createWsClient("ws://test", deps, Ctor);

    mock.fireOpen();

    // Manually call onmessage with bad JSON
    mock.onmessage!({ data: "not valid json {{{" });

    // Connection should still be open, no crash
    expect(deps.serverStore.store.connection.status).toBe("open");

    ws.disconnect();
  });

  it("disconnect prevents reconnection", () => {
    const deps = makeDeps();
    const { mock, Ctor } = makeMockWs();
    const ws = createWsClient("ws://test", deps, Ctor);

    mock.fireOpen();
    ws.disconnect();

    expect(deps.serverStore.store.connection.status).toBe("closed");
  });
});
```

**Step 3: Run ws-client tests**

```bash
cd apps/app && npx vitest run stores/__tests__/ws-client.test.ts
```

Expected: PASS

**Step 4: Commit**

```bash
git add apps/app/src/stores/ws-client.ts apps/app/src/stores/__tests__/ws-client.test.ts
git commit -m "refactor(ws-client): inject stores as dependencies

WS client no longer imports module-level singletons. All stores
(server, session registry, terminal registry) are injected via
WsClientDeps. Tests create fresh instances per test."
```

---

### Task 5: Update store-context and actions to use new factory pattern

**Files:**

- Modify: `apps/app/src/stores/store-context.tsx`
- Modify: `apps/app/src/stores/actions.ts`
- Modify: `apps/app/src/stores/__tests__/actions.test.ts`

**Step 1: Update actions.ts to accept injected stores**

In `apps/app/src/stores/actions.ts`, change `createActions` signature:

Replace:

```typescript
export function createActions(api: ApiClient, ws: WsClient): Actions {
  const server = getServerStore();
```

With:

```typescript
export interface ActionsDeps {
  serverStore: { store: ServerStoreData; actions: ServerActions };
  sessionRegistry: SessionRegistry;
}

export function createActions(
  api: ApiClient,
  ws: WsClient,
  deps: ActionsDeps
): Actions {
  const { serverStore: server, sessionRegistry } = deps;
```

Update imports:

Replace:

```typescript
import { getServerStore, type Project, type SessionMeta } from "./server-store.ts";
import { getSessionStore } from "./session-registry.ts";
```

With:

```typescript
import type { Project, ServerActions, ServerStoreData, SessionMeta } from "./server-store.ts";
import { SessionRegistry } from "./session-registry.ts";
```

Replace all `getSessionStore(sessionId)` calls with `sessionRegistry.get(sessionId)`.

**Step 2: Update store-context.tsx to create all stores and inject**

Replace entire contents of `apps/app/src/stores/store-context.tsx`:

```typescript
import { treaty } from "@elysiajs/eden";
import type { App } from "@sakti-code/server";
import {
  createContext,
  onCleanup,
  type ParentComponent,
  useContext,
} from "solid-js";
import { type Actions, createActions, type ActionsDeps } from "./actions.ts";
import {
  createServerStore,
  type ServerStore,
} from "./server-store.ts";
import { SessionRegistry } from "./session-registry.ts";
import { TerminalRegistry } from "./terminal-registry.ts";
import { createWsClient, type WsClient } from "./ws-client.ts";

const API_URL = "http://localhost:3001";
const WS_URL = "ws://localhost:3001/ws";

export interface StoreContextValue {
  server: ServerStore;
  ws: WsClient;
  actions: Actions;
  sessions: SessionRegistry;
  terminals: TerminalRegistry;
  api: ReturnType<typeof treaty<App>>;
}

const StoreContext = createContext<StoreContextValue>();

export const StoreProvider: ParentComponent = (props) => {
  const server = createServerStore();
  const sessions = new SessionRegistry();
  const terminals = new TerminalRegistry();

  const api = treaty<App>(API_URL);
  const ws = createWsClient(WS_URL, { serverStore: server, sessionRegistry: sessions, terminalRegistry: terminals });
  const actions = createActions(api, ws, { serverStore: server, sessionRegistry: sessions });

  onCleanup(() => {
    ws.disconnect();
    sessions.disposeAll();
    terminals.disposeAll();
  });

  return (
    <StoreContext.Provider value={{ server, ws, actions, sessions, terminals, api }}>
      {props.children}
    </StoreContext.Provider>
  );
};

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) {
    throw new Error("useStore must be used within StoreProvider");
  }
  return ctx;
}
```

**Step 3: Update actions.test.ts**

Replace entire contents of `apps/app/src/stores/__tests__/actions.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { createActions } from "../actions.ts";
import { createServerStore } from "../server-store.ts";
import { SessionRegistry } from "../session-registry.ts";
import type { WsClient } from "../ws-client.ts";

function makeMockWs(): WsClient {
  return {
    send: vi.fn(() => {}),
    disconnect: vi.fn(() => {}),
  };
}

function makeDeps() {
  return {
    serverStore: createServerStore(),
    sessionRegistry: new SessionRegistry(),
  };
}

describe("actions", () => {
  it("loadProjects fetches and populates store", async () => {
    const deps = makeDeps();
    const mockApi = {
      api: {
        projects: {
          get: vi.fn(() =>
            Promise.resolve({
              data: [
                {
                  id: "p1",
                  name: "Proj",
                  cwd: "/tmp",
                  createdAt: 1,
                  updatedAt: 1,
                },
              ],
              error: null,
            }),
          ),
        },
      },
    };
    const actions = createActions(mockApi as never, makeMockWs(), deps);

    await actions.loadProjects();

    expect(deps.serverStore.store.projects.p1).toBeDefined();
    expect(deps.serverStore.store.projectOrder).toEqual(["p1"]);
  });

  it("loadProjects sets active project to first if none set", async () => {
    const deps = makeDeps();
    const mockApi = {
      api: {
        projects: {
          get: vi.fn(() =>
            Promise.resolve({
              data: [{ id: "p1", name: "A", cwd: "/a", createdAt: 1, updatedAt: 1 }],
              error: null,
            }),
          ),
        },
      },
    };
    const actions = createActions(mockApi as never, makeMockWs(), deps);

    expect(deps.serverStore.store.activeProjectId).toBeNull();
    await actions.loadProjects();
    expect(deps.serverStore.store.activeProjectId).toBe("p1");
  });

  it("loadProjects does not override activeProjectId if already set", async () => {
    const deps = makeDeps();
    deps.serverStore.actions.setActiveProject("p2");
    const mockApi = {
      api: {
        projects: {
          get: vi.fn(() =>
            Promise.resolve({
              data: [{ id: "p1", name: "A", cwd: "/a", createdAt: 1, updatedAt: 1 }],
              error: null,
            }),
          ),
        },
      },
    };
    const actions = createActions(mockApi as never, makeMockWs(), deps);

    await actions.loadProjects();
    expect(deps.serverStore.store.activeProjectId).toBe("p2");
  });

  it("loadSessions fetches sessions for a project", async () => {
    const deps = makeDeps();
    const mockApi = {
      api: {
        sessions: {
          get: vi.fn(() =>
            Promise.resolve({
              data: [
                {
                  id: "s1",
                  projectId: "p1",
                  title: "Sess",
                  modelId: "gpt-4",
                  thinkingLevel: "off",
                  createdAt: 1,
                  updatedAt: 1,
                },
              ],
              error: null,
            }),
          ),
        },
      },
    };
    const actions = createActions(mockApi as never, makeMockWs(), deps);

    await actions.loadSessions("p1");

    expect(deps.serverStore.store.sessions.s1).toBeDefined();
  });

  it("sendPrompt inserts user message optimistically and sends via WS", () => {
    const ws = makeMockWs();
    const deps = makeDeps();
    const actions = createActions({} as never, ws, deps);

    actions.sendPrompt("s1", "hello world");

    const session = deps.sessionRegistry.get("s1");
    expect(session.store.messageOrder).toHaveLength(1);
    const msg = session.store.messages[session.store.messageOrder[0]!]!;
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("hello world");
    expect(session.store.streaming.phase).toBe("thinking");

    expect(ws.send).toHaveBeenCalledWith({
      type: "prompt",
      sessionId: "s1",
      message: "hello world",
    });
  });

  it("abortRun sends abort via WS", () => {
    const ws = makeMockWs();
    const deps = makeDeps();
    const actions = createActions({} as never, ws, deps);

    actions.abortRun("s1");

    expect(ws.send).toHaveBeenCalledWith({
      type: "abort",
      sessionId: "s1",
    });
  });

  it("steerRun sends steer via WS", () => {
    const ws = makeMockWs();
    const deps = makeDeps();
    const actions = createActions({} as never, ws, deps);

    actions.steerRun("s1", "stop and do X");

    expect(ws.send).toHaveBeenCalledWith({
      type: "steer",
      sessionId: "s1",
      message: "stop and do X",
    });
  });

  it("followUpRun sends followUp via WS", () => {
    const ws = makeMockWs();
    const deps = makeDeps();
    const actions = createActions({} as never, ws, deps);

    actions.followUpRun("s1", "now do Y");

    expect(ws.send).toHaveBeenCalledWith({
      type: "followUp",
      sessionId: "s1",
      message: "now do Y",
    });
  });

  it("REST error does not crash and leaves store unchanged", async () => {
    const deps = makeDeps();
    const mockApi = {
      api: {
        projects: {
          get: vi.fn(() =>
            Promise.resolve({
              data: null,
              error: { status: 500, value: "server down" },
            }),
          ),
        },
      },
    };
    const actions = createActions(mockApi as never, makeMockWs(), deps);

    await actions.loadProjects();

    expect(Object.keys(deps.serverStore.store.projects)).toHaveLength(0);
  });
});
```

**Step 4: Run all tests**

```bash
cd apps/app && npx vitest run
```

Expected: PASS

**Step 5: Commit**

```bash
git add apps/app/src/stores/actions.ts apps/app/src/stores/store-context.tsx apps/app/src/stores/__tests__/actions.test.ts
git commit -m "refactor(stores): inject all stores via context, no module-level state

StoreProvider now creates server store, session registry, terminal
registry, WS client, and actions — all wired via dependency injection.
Tests create fresh instances per test. Actions gain steerRun and
followUpRun coverage, error path coverage."
```

---

## Phase 2: Test Infrastructure

### Task 6: Create shared test helpers

**Files:**

- Create: `apps/app/src/stores/__tests__/helpers.ts`

**Step 1: Create the helpers file**

Create `apps/app/src/stores/__tests__/helpers.ts`:

```typescript
import type { AgentHarnessEvent, AgentMessage } from "@sakti-code/agent";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai/base";

// ── Usage factory ─────────────────────────────────────────────────

export function createMockUsage(input = 100, output = 50, cacheRead = 0, cacheWrite = 0): Usage {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

// ── Message factories ─────────────────────────────────────────────

export function makeAssistantMessage(
  text: string,
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
    api: "faux",
    provider: "faux",
    model: "faux-1",
    usage: createMockUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
    ...overrides,
  };
}

export function makeUserMessage(text: string): AgentMessage {
  return {
    role: "user",
    content: text,
    timestamp: Date.now(),
  } as AgentMessage;
}

export function makeAssistantMessageWithToolCall(
  text: string,
  toolCall: { id: string; name: string; args: Record<string, unknown> },
): AssistantMessage {
  return {
    ...makeAssistantMessage(text),
    content: [
      ...(text ? [{ type: "text", text }] : []),
      {
        type: "toolCall",
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.args,
      },
    ],
    stopReason: "toolUse",
  };
}

export function makeAssistantMessageWithThinking(text: string, thinking: string): AssistantMessage {
  return {
    ...makeAssistantMessage(text),
    content: [{ type: "thinking", thinking }, ...(text ? [{ type: "text", text }] : [])],
  };
}

// ── Event factories ───────────────────────────────────────────────

export function makeAgentStartEvent(): AgentHarnessEvent {
  return { type: "agent_start" } as AgentHarnessEvent;
}

export function makeAgentEndEvent(messages: AgentMessage[] = []): AgentHarnessEvent {
  return { type: "agent_end", messages } as AgentHarnessEvent;
}

export function makeTurnStartEvent(): AgentHarnessEvent {
  return { type: "turn_start" } as AgentHarnessEvent;
}

export function makeTurnEndEvent(message: AgentMessage): AgentHarnessEvent {
  return { type: "turn_end", message, toolResults: [] } as AgentHarnessEvent;
}

export function makeMessageStartEvent(message: AgentMessage): AgentHarnessEvent {
  return { type: "message_start", message } as AgentHarnessEvent;
}

export function makeMessageUpdateTextDeltaEvent(
  message: AgentMessage,
  delta: string,
): AgentHarnessEvent {
  return {
    type: "message_update",
    message,
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 0,
      delta,
      partial: message,
    },
  } as AgentHarnessEvent;
}

export function makeMessageEndEvent(message: AgentMessage): AgentHarnessEvent {
  return { type: "message_end", message } as AgentHarnessEvent;
}

export function makeToolExecutionStartEvent(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
): AgentHarnessEvent {
  return {
    type: "tool_execution_start",
    toolCallId,
    toolName,
    args,
  } as AgentHarnessEvent;
}

export function makeToolExecutionEndEvent(
  toolCallId: string,
  toolName: string,
  result: unknown,
  isError = false,
): AgentHarnessEvent {
  return {
    type: "tool_execution_end",
    toolCallId,
    toolName,
    result,
    isError,
  } as AgentHarnessEvent;
}

export function makeAbortEvent(): AgentHarnessEvent {
  return {
    type: "abort",
    clearedFollowUp: [],
    clearedSteer: [],
  } as AgentHarnessEvent;
}

// ── Full lifecycle sequence ───────────────────────────────────────

/**
 * Build a realistic single-turn event sequence:
 * agent_start → turn_start → message_start → text deltas → message_end →
 * tool executions → turn_end → agent_end
 */
export function makeFullTurnSequence(options: {
  text?: string;
  tools?: Array<{
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    result: unknown;
    isError?: boolean;
  }>;
}): AgentHarnessEvent[] {
  const events: AgentHarnessEvent[] = [];
  const assistantMsg = makeAssistantMessage(options.text ?? "");

  events.push(makeAgentStartEvent());
  events.push(makeTurnStartEvent());
  events.push(makeMessageStartEvent(assistantMsg));

  if (options.text) {
    events.push(makeMessageUpdateTextDeltaEvent(assistantMsg, options.text));
  }

  events.push(makeMessageEndEvent(assistantMsg));

  for (const tool of options.tools ?? []) {
    events.push(makeToolExecutionStartEvent(tool.toolCallId, tool.toolName, tool.args));
    events.push(
      makeToolExecutionEndEvent(tool.toolCallId, tool.toolName, tool.result, tool.isError),
    );
  }

  events.push(makeTurnEndEvent(assistantMsg));
  events.push(makeAgentEndEvent([assistantMsg]));

  return events;
}
```

**Step 2: Commit**

```bash
git add apps/app/src/stores/__tests__/helpers.ts
git commit -m "test: add shared test helpers for messages, events, and lifecycle sequences"
```

---

### Task 7: Update event-reducer tests to use helpers and add full lifecycle test

**Files:**

- Modify: `apps/app/src/stores/__tests__/event-reducer.test.ts`

**Step 1: Rewrite event-reducer.test.ts using helpers**

Replace entire contents of `apps/app/src/stores/__tests__/event-reducer.test.ts`:

```typescript
import type { AgentHarnessEvent } from "@sakti-code/agent";
import { describe, expect, it } from "vitest";
import { dispatchEvent } from "../event-reducer.ts";
import { createSessionStore } from "../session-store.ts";
import { createTokenBatcher } from "../token-batcher.ts";
import {
  makeAbortEvent,
  makeAgentEndEvent,
  makeAgentStartEvent,
  makeAssistantMessage,
  makeAssistantMessageWithThinking,
  makeFullTurnSequence,
  makeMessageEndEvent,
  makeMessageStartEvent,
  makeMessageUpdateTextDeltaEvent,
  makeToolExecutionEndEvent,
  makeToolExecutionStartEvent,
  makeTurnEndEvent,
  makeTurnStartEvent,
} from "./helpers.ts";

function setup() {
  const session = createSessionStore("s1");
  const batcher = createTokenBatcher((msgId, text) => {
    session.actions.appendToken(msgId, text);
  });
  return { session, batcher };
}

describe("event reducer — individual events", () => {
  it("agent_start sets phase to thinking", () => {
    const { session, batcher } = setup();
    dispatchEvent(session.actions, batcher, makeAgentStartEvent());
    expect(session.store.streaming.phase).toBe("thinking");
  });

  it("turn_start sets phase to thinking", () => {
    const { session, batcher } = setup();
    dispatchEvent(session.actions, batcher, makeTurnStartEvent());
    expect(session.store.streaming.phase).toBe("thinking");
  });

  it("message_start for assistant creates streaming message", () => {
    const { session, batcher } = setup();
    dispatchEvent(session.actions, batcher, makeMessageStartEvent(makeAssistantMessage("")));

    expect(session.store.messageOrder).toHaveLength(1);
    const msgId = session.store.messageOrder[0]!;
    expect(session.store.messages[msgId]!.role).toBe("assistant");
    expect(session.store.messages[msgId]!.isStreaming).toBe(true);
    expect(session.store.streaming.currentMessageId).toBe(msgId);
    expect(session.store.streaming.phase).toBe("writing");
  });

  it("message_start for user is skipped", () => {
    const { session, batcher } = setup();
    dispatchEvent(
      session.actions,
      batcher,
      makeMessageStartEvent({
        role: "user",
        content: "hello",
        timestamp: Date.now(),
      } as AgentHarnessEvent extends { message: infer M } ? M : never),
    );
    expect(session.store.messageOrder).toHaveLength(0);
  });

  it("message_update text_delta is batched", async () => {
    const { session, batcher } = setup();
    const msg = makeAssistantMessage("");
    dispatchEvent(session.actions, batcher, makeMessageStartEvent(msg));
    const msgId = session.store.streaming.currentMessageId!;

    dispatchEvent(session.actions, batcher, makeMessageUpdateTextDeltaEvent(msg, "Hello"));
    await Promise.resolve();

    expect(session.store.messages[msgId]!.content).toBe("Hello");
  });

  it("message_end finalizes message but does NOT clear currentMessageId", () => {
    const { session, batcher } = setup();
    dispatchEvent(session.actions, batcher, makeMessageStartEvent(makeAssistantMessage("")));
    const msgId = session.store.streaming.currentMessageId!;

    dispatchEvent(session.actions, batcher, makeMessageEndEvent(makeAssistantMessage("")));

    expect(session.store.messages[msgId]!.isStreaming).toBe(false);
    expect(session.store.streaming.currentMessageId).toBe(msgId);
  });

  it("tool_execution_start adds tool call part", () => {
    const { session, batcher } = setup();
    dispatchEvent(session.actions, batcher, makeMessageStartEvent(makeAssistantMessage("")));
    const msgId = session.store.streaming.currentMessageId!;

    dispatchEvent(
      session.actions,
      batcher,
      makeToolExecutionStartEvent("tc1", "bash", { command: "ls" }),
    );

    expect(session.store.messages[msgId]!.parts).toHaveLength(1);
    expect(session.store.messages[msgId]!.parts[0]).toMatchObject({
      type: "tool_call",
      toolName: "bash",
      status: "running",
    });
    expect(session.store.streaming.phase).toBe("tool_running");
  });

  it("tool_execution_end completes tool call", () => {
    const { session, batcher } = setup();
    dispatchEvent(session.actions, batcher, makeMessageStartEvent(makeAssistantMessage("")));
    const msgId = session.store.streaming.currentMessageId!;
    dispatchEvent(
      session.actions,
      batcher,
      makeToolExecutionStartEvent("tc1", "bash", { command: "ls" }),
    );

    dispatchEvent(
      session.actions,
      batcher,
      makeToolExecutionEndEvent("tc1", "bash", "file1\nfile2"),
    );

    expect(session.store.messages[msgId]!.parts[0]).toMatchObject({
      type: "tool_call",
      status: "done",
      result: "file1\nfile2",
    });
  });

  it("tool_execution_end with isError sets error status", () => {
    const { session, batcher } = setup();
    dispatchEvent(session.actions, batcher, makeMessageStartEvent(makeAssistantMessage("")));
    const msgId = session.store.streaming.currentMessageId!;
    dispatchEvent(
      session.actions,
      batcher,
      makeToolExecutionStartEvent("tc1", "bash", { command: "ls" }),
    );

    dispatchEvent(
      session.actions,
      batcher,
      makeToolExecutionEndEvent("tc1", "bash", "command not found", true),
    );

    expect(session.store.messages[msgId]!.parts[0]).toMatchObject({
      type: "tool_call",
      status: "error",
      result: "command not found",
    });
  });

  it("turn_end clears currentMessageId and sets idle", () => {
    const { session, batcher } = setup();
    dispatchEvent(session.actions, batcher, makeMessageStartEvent(makeAssistantMessage("")));
    dispatchEvent(session.actions, batcher, makeTurnEndEvent(makeAssistantMessage("done")));

    expect(session.store.streaming.currentMessageId).toBeNull();
    expect(session.store.streaming.phase).toBe("idle");
  });

  it("agent_end clears state and sets idle", () => {
    const { session, batcher } = setup();
    dispatchEvent(session.actions, batcher, makeMessageStartEvent(makeAssistantMessage("")));
    dispatchEvent(session.actions, batcher, makeAgentEndEvent());

    expect(session.store.streaming.phase).toBe("idle");
    expect(session.store.streaming.currentMessageId).toBeNull();
    expect(session.store.streaming.currentToolName).toBeNull();
  });

  it("abort clears state and sets idle", () => {
    const { session, batcher } = setup();
    dispatchEvent(session.actions, batcher, makeMessageStartEvent(makeAssistantMessage("")));
    dispatchEvent(session.actions, batcher, makeAbortEvent());

    expect(session.store.streaming.phase).toBe("idle");
    expect(session.store.streaming.currentMessageId).toBeNull();
    expect(session.store.streaming.currentToolName).toBeNull();
  });
});

describe("event reducer — full lifecycle", () => {
  it("text-only turn: start → stream → end → turn_end", async () => {
    const { session, batcher } = setup();
    const events = makeFullTurnSequence({ text: "Hello world" });

    for (const event of events) {
      dispatchEvent(session.actions, batcher, event);
    }
    await Promise.resolve(); // flush batcher

    expect(session.store.messageOrder).toHaveLength(1);
    const msgId = session.store.messageOrder[0]!;
    expect(session.store.messages[msgId]!.content).toBe("Hello world");
    expect(session.store.messages[msgId]!.isStreaming).toBe(false);
    expect(session.store.streaming.phase).toBe("idle");
    expect(session.store.streaming.currentMessageId).toBeNull();
  });

  it("tool turn: text + one tool call", () => {
    const { session, batcher } = setup();
    const events = makeFullTurnSequence({
      text: "Let me check",
      tools: [
        {
          toolCallId: "tc1",
          toolName: "bash",
          args: { command: "ls" },
          result: "file1\nfile2",
        },
      ],
    });

    for (const event of events) {
      dispatchEvent(session.actions, batcher, event);
    }

    const msgId = session.store.messageOrder[0]!;
    const msg = session.store.messages[msgId]!;
    expect(msg.content).toBe("Let me check");
    expect(msg.parts).toHaveLength(1);
    expect(msg.parts[0]).toMatchObject({
      type: "tool_call",
      toolName: "bash",
      status: "done",
      result: "file1\nfile2",
    });
    expect(session.store.streaming.phase).toBe("idle");
  });

  it("tool turn with error: tool fails", () => {
    const { session, batcher } = setup();
    const events = makeFullTurnSequence({
      text: "",
      tools: [
        {
          toolCallId: "tc1",
          toolName: "bash",
          args: { command: "exit 1" },
          result: "Error: exit code 1",
          isError: true,
        },
      ],
    });

    for (const event of events) {
      dispatchEvent(session.actions, batcher, event);
    }

    const msgId = session.store.messageOrder[0]!;
    expect(session.store.messages[msgId]!.parts[0]).toMatchObject({
      status: "error",
      result: "Error: exit code 1",
    });
  });

  it("multiple tools in one turn", () => {
    const { session, batcher } = setup();
    const events = makeFullTurnSequence({
      text: "",
      tools: [
        {
          toolCallId: "tc1",
          toolName: "read",
          args: { path: "a.ts" },
          result: "content a",
        },
        {
          toolCallId: "tc2",
          toolName: "read",
          args: { path: "b.ts" },
          result: "content b",
        },
      ],
    });

    for (const event of events) {
      dispatchEvent(session.actions, batcher, event);
    }

    const msgId = session.store.messageOrder[0]!;
    expect(session.store.messages[msgId]!.parts).toHaveLength(2);
    expect(session.store.messages[msgId]!.parts[0]).toMatchObject({
      toolCallId: "tc1",
      status: "done",
    });
    expect(session.store.messages[msgId]!.parts[1]).toMatchObject({
      toolCallId: "tc2",
      status: "done",
    });
  });
});
```

**Step 2: Run tests**

```bash
cd apps/app && npx vitest run stores/__tests__/event-reducer.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add apps/app/src/stores/__tests__/event-reducer.test.ts
git commit -m "test(event-reducer): add full lifecycle tests with real event ordering

Uses shared helpers. Tests text-only turns, tool turns, error tools,
and multi-tool turns. Verifies the message_end → tool_execution_start
ordering fix."
```

---

## Phase 3: Fill Missing Tests

### Task 8: Comprehensive types.ts tests

**Files:**

- Modify: `apps/app/src/stores/__tests__/types.test.ts`

**Step 1: Rewrite types.test.ts**

Replace entire contents of `apps/app/src/stores/__tests__/types.test.ts`:

```typescript
import type { AgentMessage } from "@sakti-code/agent";
import { describe, expect, it } from "vitest";
import { agentMessageToUI, idleStreamState } from "../types.ts";
import {
  makeAssistantMessage,
  makeAssistantMessageWithToolCall,
  makeAssistantMessageWithThinking,
} from "./helpers.ts";

describe("agentMessageToUI — user messages", () => {
  it("converts a user text message", () => {
    const msg = {
      role: "user",
      content: "hello world",
      timestamp: 1000,
    } as AgentMessage;

    const ui = agentMessageToUI(msg);
    expect(ui.role).toBe("user");
    expect(ui.content).toBe("hello world");
    expect(ui.parts).toHaveLength(1);
    expect(ui.parts[0]).toEqual({ type: "text", text: "hello world" });
    expect(ui.isStreaming).toBe(false);
  });

  it("converts user message with array content", () => {
    const msg = {
      role: "user",
      content: [
        { type: "text", text: "part1 " },
        { type: "text", text: "part2" },
      ],
      timestamp: 1000,
    } as unknown as AgentMessage;

    const ui = agentMessageToUI(msg);
    expect(ui.content).toBe("part1 part2");
  });
});

describe("agentMessageToUI — assistant messages", () => {
  it("converts an assistant message with usage", () => {
    const msg = makeAssistantMessage("hi there", {
      timestamp: 2000,
      usage: {
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 150,
        cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
      },
    });

    const ui = agentMessageToUI(msg as unknown as AgentMessage);
    expect(ui.role).toBe("assistant");
    expect(ui.usage).toEqual({ input: 100, output: 50, cost: 0.003 });
  });

  it("converts assistant message with array content", () => {
    const msg = makeAssistantMessage("part1 part2");
    const ui = agentMessageToUI(msg as unknown as AgentMessage);
    expect(ui.content).toBe("part1 part2");
  });

  it("converts assistant message with empty content", () => {
    const msg = makeAssistantMessage("");
    const ui = agentMessageToUI(msg as unknown as AgentMessage);
    expect(ui.content).toBe("");
    expect(ui.parts).toHaveLength(0);
  });
});

describe("agentMessageToUI — edge cases", () => {
  it("falls back to Date.now() when timestamp missing", () => {
    const before = Date.now();
    const msg = {
      role: "user",
      content: "test",
    } as AgentMessage;
    const after = Date.now();

    const ui = agentMessageToUI(msg);
    expect(ui.timestamp).toBeGreaterThanOrEqual(before);
    expect(ui.timestamp).toBeLessThanOrEqual(after);
  });

  it("converts toolResult role to system message", () => {
    const msg = {
      role: "toolResult",
      toolCallId: "tc1",
      toolName: "bash",
      content: [{ type: "text", text: "output" }],
      isError: false,
      timestamp: 1000,
    } as unknown as AgentMessage;

    const ui = agentMessageToUI(msg);
    expect(ui.role).toBe("system");
    expect(ui.content).toBe("");
    expect(ui.parts).toHaveLength(0);
  });

  it("converts bashExecution role to system message", () => {
    const msg = {
      role: "bashExecution",
      command: "ls",
      output: "file1",
      exitCode: 0,
      cancelled: false,
      truncated: false,
      timestamp: 1000,
    } as unknown as AgentMessage;

    const ui = agentMessageToUI(msg);
    expect(ui.role).toBe("system");
  });

  it("generates unique IDs for each message", () => {
    const msg = makeAssistantMessage("test");
    const ui1 = agentMessageToUI(msg as unknown as AgentMessage);
    const ui2 = agentMessageToUI(msg as unknown as AgentMessage);
    expect(ui1.id).not.toBe(ui2.id);
  });
});

describe("idleStreamState", () => {
  it("starts idle with zero tokens", () => {
    expect(idleStreamState.phase).toBe("idle");
    expect(idleStreamState.tokenCount).toBe(0);
    expect(idleStreamState.currentMessageId).toBeNull();
    expect(idleStreamState.currentToolName).toBeNull();
    expect(idleStreamState.startedAt).toBe(0);
  });
});
```

**Step 2: Run tests**

```bash
cd apps/app && npx vitest run stores/__tests__/types.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add apps/app/src/stores/__tests__/types.test.ts
git commit -m "test(types): cover user, assistant, toolResult, bashExecution, edge cases"
```

---

### Task 9: Comprehensive session-store.ts tests

**Files:**

- Modify: `apps/app/src/stores/__tests__/session-store.test.ts`

**Step 1: Rewrite session-store.test.ts**

Replace entire contents of `apps/app/src/stores/__tests__/session-store.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createRoot } from "solid-js";
import { createStore } from "solid-js/store";
import { createSessionStore } from "../session-store.ts";
import type { UIMessage } from "../types.ts";

function makeMessage(overrides: Partial<UIMessage> = {}): UIMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role: "assistant",
    content: "",
    parts: [],
    isStreaming: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("session store — addMessage", () => {
  it("inserts into messages map and order", () => {
    const session = createSessionStore("s1");
    session.actions.addMessage(makeMessage({ id: "m1", content: "hello" }));

    expect(session.store.messages.m1).toBeDefined();
    expect(session.store.messages.m1!.content).toBe("hello");
    expect(session.store.messageOrder).toEqual(["m1"]);
  });

  it("preserves insertion order for multiple messages", () => {
    const session = createSessionStore("s1");
    session.actions.addMessage(makeMessage({ id: "m1" }));
    session.actions.addMessage(makeMessage({ id: "m2" }));
    session.actions.addMessage(makeMessage({ id: "m3" }));

    expect(session.store.messageOrder).toEqual(["m1", "m2", "m3"]);
  });
});

describe("session store — appendToken", () => {
  it("appends to content", () => {
    const session = createSessionStore("s1");
    session.actions.addMessage(makeMessage({ id: "m1", content: "Hel" }));

    session.actions.appendToken("m1", "lo");
    expect(session.store.messages.m1!.content).toBe("Hello");

    session.actions.appendToken("m1", " World");
    expect(session.store.messages.m1!.content).toBe("Hello World");
  });

  it("increments tokenCount", () => {
    const session = createSessionStore("s1");
    session.actions.addMessage(makeMessage({ id: "m1" }));

    session.actions.appendToken("m1", "a");
    session.actions.appendToken("m1", "b");
    expect(session.store.streaming.tokenCount).toBe(2);
  });
});

describe("session store — setContent", () => {
  it("replaces entire content", () => {
    const session = createSessionStore("s1");
    session.actions.addMessage(makeMessage({ id: "m1", content: "old" }));

    session.actions.setContent("m1", "new content");
    expect(session.store.messages.m1!.content).toBe("new content");
  });
});

describe("session store — setPhase", () => {
  it("updates streaming phase", () => {
    const session = createSessionStore("s1");
    session.actions.setPhase("thinking");
    expect(session.store.streaming.phase).toBe("thinking");

    session.actions.setPhase("writing");
    expect(session.store.streaming.phase).toBe("writing");

    session.actions.setPhase("error");
    expect(session.store.streaming.phase).toBe("error");
  });
});

describe("session store — currentMessage tracking", () => {
  it("setCurrentMessage and clearCurrentMessage", () => {
    const session = createSessionStore("s1");
    session.actions.setCurrentMessage("m1");
    expect(session.store.streaming.currentMessageId).toBe("m1");

    session.actions.clearCurrentMessage();
    expect(session.store.streaming.currentMessageId).toBeNull();
  });

  it("getCurrentMessageId returns current value", () => {
    const session = createSessionStore("s1");
    expect(session.actions.getCurrentMessageId()).toBeNull();

    session.actions.setCurrentMessage("m1");
    expect(session.actions.getCurrentMessageId()).toBe("m1");
  });
});

describe("session store — currentTool tracking", () => {
  it("setCurrentTool and clearCurrentTool", () => {
    const session = createSessionStore("s1");
    session.actions.setCurrentTool("bash");
    expect(session.store.streaming.currentToolName).toBe("bash");

    session.actions.clearCurrentTool();
    expect(session.store.streaming.currentToolName).toBeNull();
  });
});

describe("session store — addToolCall", () => {
  it("adds a tool_call part and sets current tool", () => {
    const session = createSessionStore("s1");
    session.actions.addMessage(makeMessage({ id: "m1" }));

    session.actions.addToolCall("m1", "tc1", "bash", { command: "ls" });

    expect(session.store.messages.m1!.parts).toHaveLength(1);
    expect(session.store.messages.m1!.parts[0]).toEqual({
      type: "tool_call",
      toolCallId: "tc1",
      toolName: "bash",
      input: { command: "ls" },
      status: "running",
    });
    expect(session.store.streaming.currentToolName).toBe("bash");
    expect(session.store.streaming.phase).toBe("tool_running");
  });

  it("adds multiple tool calls to same message", () => {
    const session = createSessionStore("s1");
    session.actions.addMessage(makeMessage({ id: "m1" }));

    session.actions.addToolCall("m1", "tc1", "read", {});
    session.actions.addToolCall("m1", "tc2", "write", {});

    expect(session.store.messages.m1!.parts).toHaveLength(2);
  });
});

describe("session store — completeToolCall", () => {
  it("marks tool done with result", () => {
    const session = createSessionStore("s1");
    session.actions.addMessage(makeMessage({ id: "m1" }));
    session.actions.addToolCall("m1", "tc1", "bash", {});

    session.actions.completeToolCall("m1", "tc1", "file1\nfile2");

    expect(session.store.messages.m1!.parts[0]).toMatchObject({
      type: "tool_call",
      status: "done",
      result: "file1\nfile2",
    });
    expect(session.store.streaming.currentToolName).toBeNull();
  });

  it("marks tool error with isError=true", () => {
    const session = createSessionStore("s1");
    session.actions.addMessage(makeMessage({ id: "m1" }));
    session.actions.addToolCall("m1", "tc1", "bash", {});

    session.actions.completeToolCall("m1", "tc1", "failed", true);

    expect(session.store.messages.m1!.parts[0]).toMatchObject({
      status: "error",
      result: "failed",
    });
  });
});

describe("session store — setError", () => {
  it("sets error on message and phase to error", () => {
    const session = createSessionStore("s1");
    session.actions.addMessage(makeMessage({ id: "m1" }));

    session.actions.setError("m1", "Something broke");

    expect(session.store.messages.m1!.error).toBe("Something broke");
    expect(session.store.streaming.phase).toBe("error");
  });
});

describe("session store — finalizeMessage", () => {
  it("sets isStreaming to false", () => {
    const session = createSessionStore("s1");
    session.actions.addMessage(makeMessage({ id: "m1", isStreaming: true }));

    session.actions.finalizeMessage("m1");

    expect(session.store.messages.m1!.isStreaming).toBe(false);
  });
});

describe("session store — loadMessages", () => {
  it("replaces entire message set", () => {
    const session = createSessionStore("s1");
    session.actions.addMessage(makeMessage({ id: "old" }));

    session.actions.loadMessages([
      makeMessage({ id: "m1", content: "first" }),
      makeMessage({ id: "m2", content: "second" }),
    ]);

    expect(Object.keys(session.store.messages)).toHaveLength(2);
    expect(session.store.messageOrder).toEqual(["m1", "m2"]);
    expect(session.store.messages.old).toBeUndefined();
  });
});

describe("session store — reset", () => {
  it("clears everything back to idle", () => {
    const session = createSessionStore("s1");
    session.actions.addMessage(makeMessage({ id: "m1" }));
    session.actions.setPhase("writing");
    session.actions.setCurrentMessage("m1");
    session.actions.setCurrentTool("bash");

    session.actions.reset();

    expect(Object.keys(session.store.messages)).toHaveLength(0);
    expect(session.store.messageOrder).toEqual([]);
    expect(session.store.streaming.phase).toBe("idle");
    expect(session.store.streaming.currentMessageId).toBeNull();
    expect(session.store.streaming.currentToolName).toBeNull();
  });
});

describe("session store — reactivity", () => {
  it("store updates are visible in createEffect", () => {
    const captured: string[] = [];
    createRoot((dispose) => {
      const session = createSessionStore("s1");

      createEffect(() => {
        captured.push(session.store.streaming.phase);
      });

      session.actions.setPhase("thinking");
      session.actions.setPhase("writing");

      dispose();
    });

    // Initial run captures "idle", then updates capture "thinking" and "writing"
    expect(captured).toContain("thinking");
    expect(captured).toContain("writing");
  });
});
```

Note: add `import { createEffect } from "solid-js";` to the imports.

**Step 2: Run tests**

```bash
cd apps/app && npx vitest run stores/__tests__/session-store.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add apps/app/src/stores/__tests__/session-store.test.ts
git commit -m "test(session-store): cover all 14 actions + reactivity verification"
```

---

### Task 10: Comprehensive server-store.ts tests

**Files:**

- Modify: `apps/app/src/stores/__tests__/server-store.test.ts`

**Step 1: Rewrite server-store.test.ts**

Replace entire contents of `apps/app/src/stores/__tests__/server-store.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createServerStore } from "../server-store.ts";

describe("server store — setProjects", () => {
  it("populates projects and order", () => {
    const { store, actions } = createServerStore();
    actions.setProjects([
      { id: "p1", name: "A", cwd: "/a", createdAt: 1, updatedAt: 1 },
      { id: "p2", name: "B", cwd: "/b", createdAt: 2, updatedAt: 2 },
    ]);

    expect(Object.keys(store.projects)).toHaveLength(2);
    expect(store.projects.p1!.name).toBe("A");
    expect(store.projectOrder).toEqual(["p1", "p2"]);
  });

  it("replaces previous projects on second call", () => {
    const { store, actions } = createServerStore();
    actions.setProjects([{ id: "p1", name: "A", cwd: "/a", createdAt: 1, updatedAt: 1 }]);
    actions.setProjects([{ id: "p2", name: "B", cwd: "/b", createdAt: 2, updatedAt: 2 }]);

    expect(store.projects.p1).toBeUndefined();
    expect(store.projects.p2).toBeDefined();
    expect(store.projectOrder).toEqual(["p2"]);
  });
});

describe("server store — setActiveProject", () => {
  it("updates activeProjectId", () => {
    const { store, actions } = createServerStore();
    actions.setActiveProject("p1");
    expect(store.activeProjectId).toBe("p1");
  });
});

describe("server store — setSessions", () => {
  it("populates sessions", () => {
    const { store, actions } = createServerStore();
    actions.setSessions([
      {
        id: "s1",
        projectId: "p1",
        title: "Sess",
        modelId: "gpt-4",
        thinkingLevel: "off",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    expect(store.sessions.s1).toBeDefined();
    expect(store.sessions.s1!.title).toBe("Sess");
  });

  it("replaces previous sessions on second call", () => {
    const { store, actions } = createServerStore();
    actions.setSessions([
      {
        id: "s1",
        projectId: "p1",
        title: "Old",
        modelId: "gpt-4",
        thinkingLevel: "off",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    actions.setSessions([
      {
        id: "s2",
        projectId: "p1",
        title: "New",
        modelId: "gpt-4",
        thinkingLevel: "off",
        createdAt: 2,
        updatedAt: 2,
      },
    ]);

    expect(store.sessions.s1).toBeUndefined();
    expect(store.sessions.s2).toBeDefined();
  });
});

describe("server store — addSession", () => {
  it("adds a single session", () => {
    const { store, actions } = createServerStore();
    actions.addSession({
      id: "s1",
      projectId: "p1",
      title: null,
      modelId: "gpt-4",
      thinkingLevel: "off",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(store.sessions.s1).toBeDefined();
  });

  it("appends to sessionOrder", () => {
    const { store, actions } = createServerStore();
    actions.setSessions([
      {
        id: "s1",
        projectId: "p1",
        title: "A",
        modelId: "gpt-4",
        thinkingLevel: "off",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    actions.addSession({
      id: "s2",
      projectId: "p1",
      title: "B",
      modelId: "gpt-4",
      thinkingLevel: "off",
      createdAt: 2,
      updatedAt: 2,
    });

    expect(store.sessionOrder).toEqual(["s1", "s2"]);
  });
});

describe("server store — updateSession", () => {
  it("merges partial patch into session", () => {
    const { store, actions } = createServerStore();
    actions.setSessions([
      {
        id: "s1",
        projectId: "p1",
        title: "Old",
        modelId: "gpt-4",
        thinkingLevel: "off",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    actions.updateSession("s1", { title: "New" });

    expect(store.sessions.s1!.title).toBe("New");
    expect(store.sessions.s1!.modelId).toBe("gpt-4");
  });
});

describe("server store — removeSession", () => {
  it("removes from sessions and sessionOrder", () => {
    const { store, actions } = createServerStore();
    actions.setSessions([
      {
        id: "s1",
        projectId: "p1",
        title: "A",
        modelId: "gpt-4",
        thinkingLevel: "off",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "s2",
        projectId: "p1",
        title: "B",
        modelId: "gpt-4",
        thinkingLevel: "off",
        createdAt: 2,
        updatedAt: 2,
      },
    ]);

    actions.removeSession("s1");

    expect(store.sessions.s1).toBeUndefined();
    expect(store.sessionOrder).toEqual(["s2"]);
  });

  it("removing non-existent session does not throw", () => {
    const { actions } = createServerStore();
    expect(() => actions.removeSession("nonexistent")).not.toThrow();
  });
});

describe("server store — setActiveSession", () => {
  it("updates activeSessionId", () => {
    const { store, actions } = createServerStore();
    actions.setActiveSession("s1");
    expect(store.activeSessionId).toBe("s1");
  });
});

describe("server store — setConnectionStatus", () => {
  it("updates connection status", () => {
    const { store, actions } = createServerStore();
    actions.setConnectionStatus("open");
    expect(store.connection.status).toBe("open");

    actions.setConnectionStatus("closed");
    expect(store.connection.status).toBe("closed");
  });
});
```

**Step 2: Run tests**

```bash
cd apps/app && npx vitest run stores/__tests__/server-store.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add apps/app/src/stores/__tests__/server-store.test.ts
git commit -m "test(server-store): cover all actions including updateSession, removeSession, replace semantics"
```

---

### Task 11: Comprehensive terminal-store.ts and terminal-registry.ts tests

**Files:**

- Modify: `apps/app/src/stores/__tests__/terminal-store.test.ts`
- Create: `apps/app/src/stores/__tests__/terminal-registry.test.ts`

**Step 1: Rewrite terminal-store.test.ts**

Replace entire contents:

```typescript
import { describe, expect, it } from "vitest";
import { createTerminalStore } from "../terminal-store.ts";

describe("terminal store", () => {
  it("appendData accumulates buffer", () => {
    const term = createTerminalStore("t1");
    expect(term.store.buffer).toBe("");

    term.appendData("hello ");
    term.appendData("world");
    expect(term.store.buffer).toBe("hello world");
  });

  it("setExit marks the terminal as exited", () => {
    const term = createTerminalStore("t1");
    expect(term.store.exitCode).toBeNull();

    term.setExit(0);
    expect(term.store.exitCode).toBe(0);
  });

  it("setExit with non-zero code", () => {
    const term = createTerminalStore("t1");
    term.setExit(130);
    expect(term.store.exitCode).toBe(130);
  });

  it("resize updates cols and rows", () => {
    const term = createTerminalStore("t1");
    expect(term.store.cols).toBe(80);
    expect(term.store.rows).toBe(24);

    term.resize(120, 40);
    expect(term.store.cols).toBe(120);
    expect(term.store.rows).toBe(40);
  });

  it("reset clears buffer and exitCode", () => {
    const term = createTerminalStore("t1");
    term.appendData("some data");
    term.setExit(1);

    term.reset();

    expect(term.store.buffer).toBe("");
    expect(term.store.exitCode).toBeNull();
  });
});
```

**Step 2: Create terminal-registry.test.ts**

Create `apps/app/src/stores/__tests__/terminal-registry.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { TerminalRegistry } from "../terminal-registry.ts";

describe("TerminalRegistry", () => {
  it("creates store lazily on first access", () => {
    const registry = new TerminalRegistry();
    expect(registry.has("t1")).toBe(false);
    const store1 = registry.get("t1");
    expect(registry.has("t1")).toBe(true);

    const store2 = registry.get("t1");
    expect(store2).toBe(store1);
  });

  it("disposes store and allows re-creation", () => {
    const registry = new TerminalRegistry();
    const store1 = registry.get("t2");
    registry.dispose("t2");
    expect(registry.has("t2")).toBe(false);

    const store2 = registry.get("t2");
    expect(store2).not.toBe(store1);
  });

  it("dispose non-existent terminal does not throw", () => {
    const registry = new TerminalRegistry();
    expect(() => registry.dispose("nonexistent")).not.toThrow();
  });

  it("disposeAll clears all terminals", () => {
    const registry = new TerminalRegistry();
    registry.get("t1");
    registry.get("t2");
    registry.disposeAll();
    expect(registry.has("t1")).toBe(false);
    expect(registry.has("t2")).toBe(false);
  });
});
```

**Step 3: Run tests**

```bash
cd apps/app && npx vitest run stores/__tests__/terminal-store.test.ts stores/__tests__/terminal-registry.test.ts
```

Expected: PASS

**Step 4: Commit**

```bash
git add apps/app/src/stores/__tests__/terminal-store.test.ts apps/app/src/stores/__tests__/terminal-registry.test.ts
git commit -m "test(terminal): cover all store methods + registry lifecycle"
```

---

### Task 12: Comprehensive token-batcher.ts tests

**Files:**

- Modify: `apps/app/src/stores/__tests__/token-batcher.test.ts`

**Step 1: Rewrite token-batcher.test.ts**

Replace entire contents:

```typescript
import { describe, expect, it } from "vitest";
import { createTokenBatcher } from "../token-batcher.ts";

describe("token batcher", () => {
  it("accumulates deltas and flushes on microtask", async () => {
    const flushed: { id: string; text: string }[] = [];
    const batcher = createTokenBatcher((id, text) => {
      flushed.push({ id, text });
    });

    batcher.append("msg1", "Hello");
    batcher.append("msg1", " ");
    batcher.append("msg1", "World");
    batcher.append("msg2", "Other");

    expect(flushed).toHaveLength(0);

    await Promise.resolve();

    expect(flushed).toEqual([
      { id: "msg1", text: "Hello World" },
      { id: "msg2", text: "Other" },
    ]);

    batcher.dispose();
  });

  it("does not double-flush", async () => {
    const flushed: string[] = [];
    const batcher = createTokenBatcher((_, text) => flushed.push(text));

    batcher.append("msg1", "token");
    await Promise.resolve();

    expect(flushed).toEqual(["token"]);

    await Promise.resolve();
    expect(flushed).toEqual(["token"]);

    batcher.dispose();
  });

  it("dispose prevents pending flush", async () => {
    const flushed: string[] = [];
    const batcher = createTokenBatcher((_, text) => flushed.push(text));

    batcher.append("msg1", "data");
    batcher.dispose();

    await Promise.resolve();
    expect(flushed).toHaveLength(0);
  });

  it("re-append after dispose starts fresh", async () => {
    const flushed: string[] = [];
    const batcher = createTokenBatcher((_, text) => flushed.push(text));

    batcher.append("msg1", "first");
    batcher.dispose();

    batcher.append("msg2", "second");
    await Promise.resolve();

    expect(flushed).toEqual(["second"]);
  });

  it("handles empty string deltas", async () => {
    const flushed: string[] = [];
    const batcher = createTokenBatcher((_, text) => flushed.push(text));

    batcher.append("msg1", "");
    batcher.append("msg1", "a");
    batcher.append("msg1", "");
    await Promise.resolve();

    expect(flushed).toEqual(["a"]);

    batcher.dispose();
  });

  it("handles interleaved messages", async () => {
    const flushed: { id: string; text: string }[] = [];
    const batcher = createTokenBatcher((id, text) => {
      flushed.push({ id, text });
    });

    batcher.append("a", "1");
    batcher.append("b", "2");
    batcher.append("a", "3");
    batcher.append("b", "4");
    await Promise.resolve();

    const aFlush = flushed.filter((f) => f.id === "a");
    const bFlush = flushed.filter((f) => f.id === "b");
    expect(aFlush).toEqual([{ id: "a", text: "13" }]);
    expect(bFlush).toEqual([{ id: "b", text: "24" }]);

    batcher.dispose();
  });
});
```

**Step 2: Run tests**

```bash
cd apps/app && npx vitest run stores/__tests__/token-batcher.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add apps/app/src/stores/__tests__/token-batcher.test.ts
git commit -m "test(token-batcher): cover dispose, re-append, empty deltas, interleaving"
```

---

### Task 13: Typecheck and final verification

**Step 1: Run full test suite**

```bash
cd apps/app && npx vitest run
```

Expected: All tests pass.

**Step 2: Run typecheck**

```bash
bun typecheck
```

Expected: Zero errors.

**Step 3: Run lint**

```bash
bun x ultracite fix
```

Expected: Clean.

**Step 4: Count tests**

```bash
cd apps/app && npx vitest run 2>&1 | grep "Tests "
```

Expected: Significantly more than the original 41 tests.

**Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "test: comprehensive unit test coverage for state management layer"
```

---

## Verification Checklist

After all tasks complete, verify:

- [ ] `message_end` does NOT clear `currentMessageId`
- [ ] `turn_end` clears `currentMessageId`
- [ ] Tool calls appear in store after realistic event sequence
- [ ] No module-level mutable state in any store file
- [ ] All tests create fresh instances — no singleton pollution
- [ ] `SessionRegistry` and `TerminalRegistry` are instantiable classes
- [ ] WS client accepts injected dependencies
- [ ] Store context creates all stores and cleans up on unmount
- [ ] Test helpers cover all common message and event types
- [ ] Full lifecycle tests exercise real agent event ordering
- [ ] Every store action has at least one test
- [ ] `terminal-registry.test.ts` exists and passes
- [ ] `store-context.tsx` is updated and wired
- [ ] `bun typecheck` passes
- [ ] `bun x ultracite fix` clean
