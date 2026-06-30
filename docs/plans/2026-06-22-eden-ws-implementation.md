# Eden Typed WebSocket Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the raw WebSocket client with Eden treaty's typed `.ws.subscribe()`, adding TypeBox runtime validation schemas to the server's WS endpoint.

**Architecture:** Two-sided change: (1) server adds TypeBox `body`/`response` schemas to `.ws("/ws", ...)`, (2) client replaces raw `new WebSocket(url)` with `api.ws.subscribe()`. Frame-level types flow through Eden. The `AgentHarnessEvent` payload uses `t.Unknown()` — too complex for TypeBox, handled by casting in the reducer. Reconnection logic stays on the client side (EdenWS doesn't reconnect).

**Tech Stack:** Elysia TypeBox (`t` from `"elysia"`), `@elysiajs/eden` treaty client, SolidJS stores.

**Design doc:** `docs/plans/2026-06-22-eden-ws-design.md`

---

## Critical Context

### EdenWS API (confirmed from source)

`api.ws.subscribe()` returns an `EdenWS` instance synchronously:

- `.ws` — public field, the underlying native `WebSocket` (use for `readyState`)
- `.send(obj)` — auto-`JSON.stringify` for objects
- `.on("message", handler)` — auto-`JSON.parse`, `event.data` is typed as `Schema['response'][200]`
- `.on("open"/"close"/"error", handler)` — pass-through native events
- `.close()` — delegates to `ws.close()`, returns `this`
- Does NOT reconnect. Does NOT expose `readyState` directly (use `.ws.readyState`)

### Current state (after Phase 1 refactor)

The ws-client already uses dependency injection:

```typescript
createWsClient(url: string, deps: WsClientDeps, WebSocketCtor: typeof WebSocket)
```

This plan replaces `url` + `WebSocketCtor` with the treaty `api` client.

### Server convention

TypeBox schemas are imported as `t` from `"elysia"`. Existing routes define schemas inline or via `.model()`. See `apps/server/src/routes/sessions/sessions.ts` for the pattern.

### Commands

```bash
cd apps/app && npx vitest run                     # frontend tests
cd apps/server && bun run test                     # server tests
bun typecheck                                      # root typecheck
bun x ultracite fix                                # lint + format
```

---

## Task 1: Server — Add TypeBox WS schemas to ws-handler.ts

**Files:**

- Modify: `apps/server/src/agent/ws-handler.ts` (add schema exports)

**Step 1: Add TypeBox schemas**

Add these exports at the bottom of `apps/server/src/agent/ws-handler.ts`, after the existing TS interfaces:

```typescript
import { t } from "elysia";

// TypeBox schemas for runtime validation on the .ws() endpoint.
// These mirror the TS interfaces above. The TS interfaces stay as
// the compile-time source of truth; TypeBox is the runtime layer.

export const wsBodySchema = t.Union([
  t.Object({
    type: t.Literal("prompt"),
    sessionId: t.String(),
    message: t.String(),
  }),
  t.Object({
    type: t.Literal("abort"),
    sessionId: t.String(),
  }),
  t.Object({
    type: t.Literal("steer"),
    sessionId: t.String(),
    message: t.String(),
  }),
  t.Object({
    type: t.Literal("followUp"),
    sessionId: t.String(),
    message: t.String(),
  }),
]);

export const wsResponseSchema = t.Union([
  t.Object({
    type: t.Literal("welcome"),
    version: t.String(),
    cwd: t.String(),
  }),
  t.Object({
    type: t.Literal("event"),
    sessionId: t.String(),
    event: t.Unknown(),
  }),
  t.Object({
    type: t.Literal("error"),
    sessionId: t.String(),
    error: t.String(),
  }),
  t.Object({
    type: t.Literal("push"),
    channel: t.Literal("terminal.data"),
    data: t.Object({ terminalId: t.String(), data: t.String() }),
  }),
  t.Object({
    type: t.Literal("push"),
    channel: t.Literal("terminal.exit"),
    data: t.Object({ terminalId: t.String(), exitCode: t.Number() }),
  }),
]);
```

**Step 2: Verify typecheck**

```bash
bun typecheck
```

Expected: PASS — TypeBox schemas are standalone exports, nothing uses them yet.

**Step 3: Commit**

```bash
git add apps/server/src/agent/ws-handler.ts
git commit -m "feat(server): add TypeBox WS body/response schemas"
```

---

## Task 2: Server — Wire schemas into .ws() and remove manual cast

**Files:**

- Modify: `apps/server/src/agent/ws.ts:106-138`

**Step 1: Update imports**

In `apps/server/src/agent/ws.ts`, add `t` import and schema imports:

Replace:

```typescript
import { Elysia } from "elysia";
import type { ErrorFrame, WsHandle, WsIn } from "./ws-handler.ts";
import { handleMessage } from "./ws-handler.ts";
```

With:

```typescript
import { Elysia } from "elysia";
import type { WsHandle } from "./ws-handler.ts";
import { handleMessage, wsBodySchema, wsResponseSchema } from "./ws-handler.ts";
```

**Step 2: Add schemas to .ws() options**

Replace the `.ws("/ws", { ... })` block:

```typescript
return new Elysia({ name: "ws" }).ws("/ws", {
  body: wsBodySchema,
  response: wsResponseSchema,
  open(ws) {
    const wsId = getWsId(ws);
    wsConnections.set(wsId, ws);
    if (!terminalCallbacksWired) {
      wireTerminalCallbacks(ctx);
      terminalCallbacksWired = true;
    }
    ws.send({
      type: "welcome",
      version: SERVER_VERSION,
      cwd: process.cwd(),
    });
  },
  close(ws) {
    const wsId = getWsId(ws);
    clearStorageForConnection(wsId);
    wsConnections.delete(wsId);
    ctx.terminalManager.closeByConnection(wsId);
  },
  message(ws, msg) {
    const wsId = getWsId(ws);
    if (!msg.sessionId) {
      ws.send({
        error: "Missing sessionId",
        sessionId: "",
        type: "error",
      });
      return;
    }
    const storage = getOrCreateStorage(wsId, ctx, msg.sessionId);
    handleMessage(ctx, storage, ws, msg);
  },
});
```

Key changes:

- Added `body: wsBodySchema` and `response: wsResponseSchema`
- `ws.send()` calls now send objects (not `JSON.stringify` strings) — Elysia serializes them
- `createWelcomeFrame()` function removed — send the object directly in `open()`
- `msg as WsIn` cast removed — `msg` is typed by the body schema
- Removed `satisfies ErrorFrame` — the object shape matches the response schema

**Step 3: Remove createWelcomeFrame**

Delete the `createWelcomeFrame` function (lines 10-16 in the original file):

```typescript
// DELETE THIS:
export function createWelcomeFrame(): string {
  return JSON.stringify({
    type: "welcome",
    version: SERVER_VERSION,
    cwd: process.cwd(),
  });
}
```

**Step 4: Update pushToConnection to send objects**

In the same file, update `pushToConnection`:

Replace:

```typescript
export function pushToConnection(connectionId: string, data: unknown) {
  const ws = wsConnections.get(connectionId);
  if (ws) {
    ws.send(JSON.stringify(data));
  }
}
```

With:

```typescript
export function pushToConnection(connectionId: string, data: unknown) {
  const ws = wsConnections.get(connectionId);
  if (ws) {
    ws.send(data);
  }
}
```

Elysia's WS `ws.send()` accepts objects when a response schema is defined — it serializes them automatically.

**Step 5: Check for createWelcomeFrame references**

```bash
rg "createWelcomeFrame" apps/server/src/
```

If any test references `createWelcomeFrame`, update it to construct the object directly.

**Step 6: Run server typecheck**

```bash
cd apps/server && bun run typecheck
```

Expected: PASS

**Step 7: Run server tests**

```bash
cd apps/server && bun run test
```

Expected: PASS

**Step 8: Commit**

```bash
git add apps/server/src/agent/ws.ts
git commit -m "feat(server): wire TypeBox schemas into .ws(), remove manual casts

Body and response schemas are now enforced by Elysia. ws.send() takes
objects instead of JSON strings. The msg as WsIn cast is removed —
Elysia validates and types the body automatically."
```

---

## Task 3: Client — Refactor ws-client to use Eden WS

**Files:**

- Modify: `apps/app/src/stores/ws-client.ts`
- Modify: `apps/app/src/stores/__tests__/ws-client.test.ts`

**Step 1: Rewrite ws-client.ts**

Replace entire contents of `apps/app/src/stores/ws-client.ts`:

```typescript
import type { AgentHarnessEvent } from "@sakti-code/agent";
import { dispatchEvent } from "./event-reducer.ts";
import type { ServerActions, ServerStoreData } from "./server-store.ts";
import type { SessionRegistry } from "./session-registry.ts";
import type { TerminalRegistry } from "./terminal-registry.ts";
import { createTokenBatcher } from "./token-batcher.ts";

const RECONNECT_DELAY_MS = 2000;

export interface WsClient {
  disconnect: () => void;
  send: (msg: WsInMessage) => void;
}

export interface WsClientDeps {
  serverStore: { store: ServerStoreData; actions: ServerActions };
  sessionRegistry: SessionRegistry;
  terminalRegistry: TerminalRegistry;
}

/**
 * Minimal treaty client shape — only the .ws.subscribe() path.
 * This lets tests inject a mock without constructing a full treaty client.
 */
export interface WsSubscribeApi {
  ws: {
    subscribe: () => EdenWSLike;
  };
}

/**
 * Minimal EdenWS interface — the subset of EdenWS methods we use.
 * EdenWS has more methods, but we only need these.
 */
export interface EdenWSLike {
  ws: { readyState: number };
  send: (data: unknown) => void;
  on: (
    type: "open" | "message" | "close" | "error",
    listener: (event: { data?: unknown }) => void,
  ) => void;
  close: () => void;
}

/** Inbound message type (client → server) */
type WsInMessage =
  | { type: "prompt"; sessionId: string; message: string }
  | { type: "abort"; sessionId: string }
  | { type: "steer"; sessionId: string; message: string }
  | { type: "followUp"; sessionId: string; message: string };

export function createWsClient(api: WsSubscribeApi, deps: WsClientDeps): WsClient {
  const { serverStore: server, sessionRegistry, terminalRegistry } = deps;
  let conn: EdenWSLike | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let shouldReconnect = true;

  const batchers = new Map<string, ReturnType<typeof createTokenBatcher>>();

  function getBatcher(sessionId: string) {
    let b = batchers.get(sessionId);
    if (!b) {
      const session = sessionRegistry.get(sessionId);
      b = createTokenBatcher((msgId, text) => {
        session.actions.appendToken(msgId, text);
      });
      batchers.set(sessionId, b);
    }
    return b;
  }

  function handleFrame(data: unknown): void {
    const frame = data as {
      type: string;
      sessionId?: string;
      error?: string;
      channel?: string;
      data?: unknown;
      event?: unknown;
    };

    switch (frame.type) {
      case "welcome":
        server.actions.setConnectionStatus("open");
        break;

      case "event": {
        const session = sessionRegistry.get(frame.sessionId!);
        const batcher = getBatcher(frame.sessionId!);
        dispatchEvent(session.actions, batcher, frame.event as AgentHarnessEvent);
        break;
      }

      case "error": {
        const session = sessionRegistry.get(frame.sessionId!);
        const msgId = session.store.streaming.currentMessageId;
        if (msgId) {
          session.actions.setError(msgId, frame.error!);
        }
        break;
      }

      case "push": {
        if (frame.channel === "terminal.data") {
          const d = frame.data as { terminalId: string; data: string };
          terminalRegistry.get(d.terminalId).appendData(d.data);
        } else if (frame.channel === "terminal.exit") {
          const d = frame.data as { terminalId: string; exitCode: number };
          terminalRegistry.get(d.terminalId).setExit(d.exitCode);
        }
        break;
      }
    }
  }

  function connect(): void {
    server.actions.setConnectionStatus("connecting");
    conn = api.ws.subscribe();

    conn.on("open", () => {
      server.actions.setConnectionStatus("open");
    });

    conn.on("message", (event) => {
      handleFrame(event.data);
    });

    conn.on("close", () => {
      server.actions.setConnectionStatus("closed");
      conn = null;
      if (shouldReconnect) {
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    });
  }

  connect();

  return {
    send(msg: WsInMessage) {
      if (conn && conn.ws.readyState === 1) {
        conn.send(msg);
      }
    },
    disconnect() {
      shouldReconnect = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      conn?.close();
    },
  };
}
```

Note: `readyState === 1` is `WebSocket.OPEN`. Using the numeric literal avoids importing `WebSocket` just for the constant.

**Step 2: Rewrite ws-client.test.ts**

Replace entire contents of `apps/app/src/stores/__tests__/ws-client.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createServerStore } from "../server-store.ts";
import { SessionRegistry } from "../session-registry.ts";
import { TerminalRegistry } from "../terminal-registry.ts";
import { createWsClient, type EdenWSLike, type WsSubscribeApi } from "../ws-client.ts";

function makeDeps() {
  return {
    serverStore: createServerStore(),
    sessionRegistry: new SessionRegistry(),
    terminalRegistry: new TerminalRegistry(),
  };
}

function makeMockEdenWs() {
  const openHandlers: Array<() => void> = [];
  const messageHandlers: Array<(event: { data?: unknown }) => void> = [];
  const closeHandlers: Array<() => void> = [];
  const sent: unknown[] = [];
  let readyState = 0;

  const mock: EdenWSLike = {
    ws: {
      get readyState() {
        return readyState;
      },
    },
    send(data: unknown) {
      sent.push(data);
    },
    on(type, listener) {
      if (type === "open") openHandlers.push(listener as () => void);
      else if (type === "message")
        messageHandlers.push(listener as (e: { data?: unknown }) => void);
      else if (type === "close") closeHandlers.push(listener as () => void);
    },
    close() {
      readyState = 3;
      for (const h of closeHandlers) h();
    },
  };

  return {
    mock,
    sent,
    fireOpen() {
      readyState = 1;
      for (const h of openHandlers) h();
    },
    fireMessage(data: unknown) {
      for (const h of messageHandlers) h({ data });
    },
    fireClose() {
      readyState = 3;
      for (const h of closeHandlers) h();
    },
  };
}

function makeMockApi() {
  const edenWs = makeMockEdenWs();
  const api: WsSubscribeApi = {
    ws: {
      subscribe: () => edenWs.mock,
    },
  };
  return { api, edenWs };
}

describe("WS client", () => {
  it("connection starts as connecting", () => {
    const deps = makeDeps();
    const { api } = makeMockApi();
    const ws = createWsClient(api, deps);

    expect(deps.serverStore.store.connection.status).toBe("connecting");

    ws.disconnect();
  });

  it("welcome frame sets connection to open", () => {
    const deps = makeDeps();
    const { api, edenWs } = makeMockApi();
    const ws = createWsClient(api, deps);

    edenWs.fireOpen();
    edenWs.fireMessage({ type: "welcome", version: "1.0.0", cwd: "/tmp" });

    expect(deps.serverStore.store.connection.status).toBe("open");

    ws.disconnect();
  });

  it("dispatches event frames to session store", () => {
    const deps = makeDeps();
    const { api, edenWs } = makeMockApi();
    const ws = createWsClient(api, deps);

    edenWs.fireOpen();
    edenWs.fireMessage({
      type: "event",
      sessionId: "s-test",
      event: { type: "agent_start" },
    });

    const session = deps.sessionRegistry.get("s-test");
    expect(session.store.streaming.phase).toBe("thinking");

    ws.disconnect();
  });

  it("send sends typed message via Eden WS", () => {
    const deps = makeDeps();
    const { api, edenWs } = makeMockApi();
    const ws = createWsClient(api, deps);

    edenWs.fireOpen();
    ws.send({ type: "prompt", sessionId: "s1", message: "hello" });

    expect(edenWs.sent).toHaveLength(1);
    expect(edenWs.sent[0]).toEqual({
      type: "prompt",
      sessionId: "s1",
      message: "hello",
    });

    ws.disconnect();
  });

  it("send is dropped when socket not open", () => {
    const deps = makeDeps();
    const { api, edenWs } = makeMockApi();
    const ws = createWsClient(api, deps);

    ws.send({ type: "prompt", sessionId: "s1", message: "hello" });
    expect(edenWs.sent).toHaveLength(0);

    ws.disconnect();
  });

  it("error frame sets error on current message", () => {
    const deps = makeDeps();
    const { api, edenWs } = makeMockApi();
    const ws = createWsClient(api, deps);

    edenWs.fireOpen();

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

    edenWs.fireMessage({ type: "error", sessionId: "s1", error: "boom" });

    expect(session.store.messages.m1!.error).toBe("boom");
    expect(session.store.streaming.phase).toBe("error");

    ws.disconnect();
  });

  it("push frame routes terminal data", () => {
    const deps = makeDeps();
    const { api, edenWs } = makeMockApi();
    const ws = createWsClient(api, deps);

    edenWs.fireOpen();
    edenWs.fireMessage({
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
    const { api, edenWs } = makeMockApi();
    const ws = createWsClient(api, deps);

    edenWs.fireOpen();
    edenWs.fireMessage({
      type: "push",
      channel: "terminal.exit",
      data: { terminalId: "t1", exitCode: 0 },
    });

    const term = deps.terminalRegistry.get("t1");
    expect(term.store.exitCode).toBe(0);

    ws.disconnect();
  });

  it("disconnect sets connection to closed", () => {
    const deps = makeDeps();
    const { api, edenWs } = makeMockApi();
    const ws = createWsClient(api, deps);

    edenWs.fireOpen();
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
git commit -m "refactor(ws-client): use Eden treaty WS instead of raw WebSocket

Replaces new WebSocket(url) with api.ws.subscribe(). Eden handles
JSON parse/serialize automatically. The treaty client is injected
for testability. Reconnection logic stays on the client side."
```

---

## Task 4: Client — Update store-context.tsx to pass treaty api

**Files:**

- Modify: `apps/app/src/stores/store-context.tsx`

**Step 1: Update createWsClient call**

In `apps/app/src/stores/store-context.tsx`, update the ws-client creation:

Replace:

```typescript
const API_URL = "http://localhost:3001";
const WS_URL = "ws://localhost:3001/ws";
```

With:

```typescript
const API_URL = "http://localhost:3001";
```

Replace:

```typescript
const ws = createWsClient(WS_URL, {
  serverStore: server,
  sessionRegistry: sessions,
  terminalRegistry: terminals,
});
```

With:

```typescript
const ws = createWsClient(api, {
  serverStore: server,
  sessionRegistry: sessions,
  terminalRegistry: terminals,
});
```

**Step 2: Run typecheck**

```bash
bun typecheck
```

Expected: PASS — the treaty client's `api.ws.subscribe()` matches `WsSubscribeApi`.

**Step 3: Run all frontend tests**

```bash
cd apps/app && npx vitest run
```

Expected: PASS

**Step 4: Commit**

```bash
git add apps/app/src/stores/store-context.tsx
git commit -m "refactor(store-context): pass treaty api to createWsClient

Removes hardcoded WS_URL. Eden derives the WebSocket URL from the
treaty client's domain automatically."
```

---

## Task 5: Server — Verify WS integration end-to-end

**Step 1: Start the server**

```bash
bun dev:server
```

**Step 2: Verify server starts without errors**

Expected: Server starts on port 3001, no schema validation errors.

**Step 3: Test WS connection manually (optional)**

If a WS client tool is available (e.g., `wscat`):

```bash
wscat -c ws://localhost:3001/ws
```

Expected: Receives a welcome frame as a JSON object.

**Step 4: Run full typecheck + lint**

```bash
bun typecheck && bun x ultracite fix
```

Expected: Clean.

**Step 5: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: lint fixes from Eden WS migration"
```

---

## Verification Checklist

After all tasks complete, verify:

- [ ] Server `.ws()` has `body: wsBodySchema` and `response: wsResponseSchema`
- [ ] No `msg as WsIn` cast in server WS handler
- [ ] `ws.send()` calls in server send objects, not JSON strings
- [ ] `createWelcomeFrame()` removed (or updated to return object)
- [ ] `ws-client.ts` uses `api.ws.subscribe()` instead of `new WebSocket(url)`
- [ ] No manual `JSON.parse` or `JSON.stringify` in ws-client
- [ ] `store-context.tsx` has no `WS_URL` constant
- [ ] All ws-client tests pass with mock EdenWS
- [ ] `bun typecheck` passes
- [ ] `bun x ultracite fix` clean
- [ ] Server starts and accepts WS connections
