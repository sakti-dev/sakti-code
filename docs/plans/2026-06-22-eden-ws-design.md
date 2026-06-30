# Eden Typed WebSocket Design

**Goal:** Replace the raw WebSocket client with Eden treaty's typed `.ws.subscribe()`, adding TypeBox runtime validation to the server's WS endpoint for end-to-end type safety.

**Decision:** Frame-level TypeBox schemas (`t.Unknown()` for the `AgentHarnessEvent` payload inside `EventFrame`). This gives runtime validation of frame discrimination (welcome/event/error/push) and Eden WS typed `.send()` / `.subscribe()`, without attempting to express the complex generic `AgentHarnessEvent` union as TypeBox.

---

## Server: TypeBox schemas on `.ws()`

Add `body` and `response` schemas to `.ws("/ws", { ... })` in `apps/server/src/agent/ws.ts`. Define them in `ws-handler.ts` alongside the existing TS interfaces.

### Body schema (inbound: client to server)

```typescript
const wsBodySchema = t.Union([
  t.Object({ type: t.Literal("prompt"), sessionId: t.String(), message: t.String() }),
  t.Object({ type: t.Literal("abort"), sessionId: t.String() }),
  t.Object({ type: t.Literal("steer"), sessionId: t.String(), message: t.String() }),
  t.Object({ type: t.Literal("followUp"), sessionId: t.String(), message: t.String() }),
]);
```

### Response schema (outbound: server to client)

```typescript
const wsResponseSchema = t.Union([
  t.Object({ type: t.Literal("welcome"), version: t.String(), cwd: t.String() }),
  t.Object({ type: t.Literal("event"), sessionId: t.String(), event: t.Unknown() }),
  t.Object({ type: t.Literal("error"), sessionId: t.String(), error: t.String() }),
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

### Impact on server message handler

The `msg as WsIn` cast in `ws.ts:124` is removed — Elysia validates and types the body automatically. Invalid messages are rejected before reaching the handler.

The TS interfaces (`WsIn`, `WsOut`, `WelcomeFrame`, etc.) stay as source of truth. TypeBox schemas are a runtime validation layer, not a replacement.

---

## Client: ws-client uses Eden WS

### Signature change

```typescript
// Before
export function createWsClient(url: string, deps: WsClientDeps, WebSocketCtor: typeof WebSocket);

// After
export function createWsClient(api: TreatyClient, deps: WsClientDeps);
```

Where `TreatyClient` is `ReturnType<typeof treaty<App>>`.

### Connection lifecycle

`connect()` calls `api.ws.subscribe()` which returns an `EdenWS` instance synchronously. EdenWS:

- Exposes the native WebSocket as `.ws` (public field) for `readyState` access
- `.send(obj)` auto-JSON.stringifies objects
- `.on("message", handler)` auto-JSON.parses — `event.data` is the typed object directly
- `.on("open"/"close"/"error", handler)` pass through native events unchanged
- `.close()` delegates to `ws.close()`

### Reconnection

EdenWS does not reconnect. The existing reconnection state machine stays:

- On `close` event, schedule `setTimeout(connect, RECONNECT_DELAY_MS)`
- On reconnect, call `api.ws.subscribe()` again and re-wire handlers
- `disconnect()` sets `shouldReconnect = false` and closes

### What EdenWS eliminates

| Current code                      | Replaced by                          |
| --------------------------------- | ------------------------------------ |
| `new WebSocketCtor(url)`          | `api.ws.subscribe()`                 |
| `JSON.parse(event.data) as WsOut` | Eden auto-parses, `event.data` typed |
| `ws.send(JSON.stringify(msg))`    | `edenWs.send(msg)` auto-serializes   |
| `url` parameter                   | Derived from treaty client domain    |
| `WebSocketCtor` parameter         | EdenWS creates WebSocket internally  |
| Direct `WsIn`/`WsOut` imports     | Types flow through Eden's `App` type |

### What stays

- `handleFrame()` — frame dispatching logic (welcome/event/error/push switch) unchanged
- `getBatcher()` — per-session token batcher creation unchanged
- Reconnection state machine (`shouldReconnect`, `RECONNECT_DELAY_MS`, `reconnectTimer`)
- `WsClient` interface (`send` + `disconnect`)
- `WsClientDeps` (server store, session registry, terminal registry)
- `data.event as AgentHarnessEvent` cast in `handleFrame` — bridges `t.Unknown()` to compile-time type

### store-context.tsx

No more hardcoded `WS_URL`. The treaty client is passed directly:

```typescript
const ws = createWsClient(api, {
  serverStore: server,
  sessionRegistry: sessions,
  terminalRegistry: terminals,
});
```

---

## Testing

Mock `api.ws.subscribe()` to return a fake EdenWS with `.on()`, `.send()`, `.close()`, and `.ws.readyState`. Simpler than the current mock — one function to mock instead of a WebSocket constructor + event assignment pattern.
