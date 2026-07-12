# Fix: Transition Gate Card Renders for Auto Edges

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop the desktop from showing a confirmation card for auto-chain transitions (build→verify, verify→build); only show it for genuine gate edges (specify→build, verify→archive, plan→mission, archive→done).

**Architecture:** The server owns the transition table (single source of truth for gate/auto). Today the desktop eagerly sets a card on every `transition` tool-call event (`tool_execution_start`), before the server has resolved gate-vs-auto. Fix: the server emits a `transition_resolved` WS frame AFTER resolving the edge — carrying `mode: "gate" | "auto"` and the current `status`. The desktop shows/clears the card and syncs its status based solely on this frame. The existing `loadChat` re-derivation from DB handles reload/rehydration.

**Tech Stack:** Hono WS (server), SolidJS stores (desktop), vitest (testing), TypeBox (runtime validation).

---

## Root Cause Summary

Three interlocking defects:

1. **Card renders for ALL transitions** — `tool-events.ts:9-16` calls `setPendingTransition` on every `transition` tool-call, regardless of gate/auto. The server resolves gate-vs-auto AFTER the run, so the desktop jumps the gun.

2. **Nothing clears the card during auto-chain** — `lifecycle-events.ts` handlers (`agent_end`, `agent_start`, etc.) never clear `pendingTransition`. The card set in defect 1 persists through the entire chained run.

3. **Desktop status goes stale during auto-chain** — `applyTransition` flips status server-side, but the server never pushes status changes to the desktop. The desktop's `server-store` keeps the old status, creating a contradictory UX (card says "confirm build→verify" while the verify agent is already running).

## Fix Approach: `transition_resolved` WS frame

The server emits ONE new frame after resolving every transition edge:

```ts
interface TransitionResolvedFrame {
  type: "transition_resolved";
  sessionId: string;
  to: string; // destination phase
  mode: "gate" | "auto"; // server's gating decision
  status: string; // session status AFTER resolution
  body?: string; // gate only: the body for the confirmation card
}
```

Desktop handler:

- `mode === "gate"` → `setPendingTransition({to, body})`, `updateSession(id, {status})`
- `mode === "auto"` → `clearPendingTransition()`, `updateSession(id, {status})`

This eliminates all three defects:

- No card for auto edges (defect 1 ✓)
- Nothing to clear since card was never set (defect 2 ✓)
- Status synced via frame (defect 3 ✓)

Reload/rehydration already works: `loadChat` re-derives from DB (`pendingTransitionTo` is set for gates, null for auto).

---

## Task 1: Add `TransitionResolvedFrame` to WS types

**Files:**

- Modify: `apps/server/src/agent/ws-handler.ts` (WsOut union, ~line 116)
- Test: `apps/server/src/agent/__tests__/ws-types.test.ts`

**Step 1: Write the failing test**

Add to `ws-types.test.ts`:

```typescript
it("WsOut includes transition_resolved frame for gate and auto modes", () => {
  const frames: WsOut[] = [
    {
      type: "transition_resolved",
      sessionId: "s1",
      to: "build",
      mode: "gate",
      status: "specify",
      body: "spec summary",
    },
    {
      type: "transition_resolved",
      sessionId: "s1",
      to: "verify",
      mode: "auto",
      status: "verify",
    },
  ];
  expect(frames).toHaveLength(2);
});
```

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/server#test' -- --run apps/server/src/agent/__tests__/ws-types.test.ts`
Expected: FAIL — `transition_resolved` not assignable to `WsOut`.

**Step 3: Implement — add the frame interface and include in WsOut**

In `ws-handler.ts`, add the interface (near the other frame interfaces, ~line 114):

```typescript
/** Server has resolved a transition edge. Gate = show card; auto = sync status, no card. */
export interface TransitionResolvedFrame {
  body?: string;
  mode: "gate" | "auto";
  sessionId: string;
  status: string;
  to: string;
  type: "transition_resolved";
}
```

Add `TransitionResolvedFrame` to the `WsOut` union:

```typescript
export type WsOut =
  | EventFrame
  | ErrorFrame
  | WelcomeFrame
  | PushFrame
  | PermissionAskedFrame
  | PermissionRepliedFrame
  | TransitionResolvedFrame;
```

**Step 4: Run test to verify it passes**

Run: `vp run '@sakti-code/server#test' -- --run apps/server/src/agent/__tests__/ws-types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/agent/ws-handler.ts apps/server/src/agent/__tests__/ws-types.test.ts
git commit -m "feat(ws): add TransitionResolvedFrame to WsOut union"
```

---

## Task 2: Emit `transition_resolved` frame in the auto-chain engine

**Files:**

- Modify: `apps/server/src/agent/ws-handler.ts` — `runAgentStream` while-loop, gate branch (~line 403) and auto branch (~line 417-436)
- Test: `apps/server/src/agent/__tests__/auto-chain.test.ts`

**Step 1: Write the failing tests**

Add these tests to `auto-chain.test.ts`:

```typescript
it("emits transition_resolved {mode:gate} for verify→archive gate edge", async () => {
  const { ctx, db } = await makeContext();
  const project = await ctx.repos.projects.create("gate-frame", "/tmp/gate-frame");
  const session = await ctx.repos.sessions.create(project.id, { status: "verify" });
  const storage = new SqliteSessionStorage(db, session.id, {
    id: session.id,
    createdAt: new Date().toISOString(),
  });

  const spy = vi.spyOn(runnerMod, "runPrompt");
  spy.mockImplementation(async (ctx2: unknown, sid: string) => {
    const c = ctx2 as {
      repos: { sessions: { update: (id: string, d: object) => Promise<unknown> } };
    };
    await c.repos.sessions.update(sid, {
      pendingTransitionTo: "archive",
      pendingTransitionBody: "verify clean",
    });
  });

  const frames: unknown[] = [];
  try {
    await runAgentStream(ctx, session.id, "verify", storage, {
      send: (frame) => frames.push(frame),
    });
    const resolved = frames.find((f) => (f as { type?: string }).type === "transition_resolved");
    expect(resolved).toBeDefined();
    expect(resolved).toMatchObject({
      type: "transition_resolved",
      to: "archive",
      mode: "gate",
      status: "verify",
      body: "verify clean",
    });
  } finally {
    spy.mockRestore();
  }
});

it("emits transition_resolved {mode:auto} for build→verify auto edge", async () => {
  const { ctx, db } = await makeContext();
  const project = await ctx.repos.projects.create("auto-frame", "/tmp/auto-frame");
  const session = await ctx.repos.sessions.create(project.id, { status: "build" });
  const storage = new SqliteSessionStorage(db, session.id, {
    id: session.id,
    createdAt: new Date().toISOString(),
  });

  let calls = 0;
  const spy = vi.spyOn(runnerMod, "runPrompt");
  spy.mockImplementation(async (ctx2: unknown, sid: string) => {
    calls++;
    if (calls === 1) {
      const c = ctx2 as {
        repos: { sessions: { update: (id: string, d: object) => Promise<unknown> } };
      };
      await c.repos.sessions.update(sid, {
        pendingTransitionTo: "verify",
        pendingTransitionBody: "done",
      });
    }
    // Second call (verify run) — no transition, just stop.
  });

  const frames: unknown[] = [];
  try {
    await runAgentStream(ctx, session.id, "go", storage, {
      send: (frame) => frames.push(frame),
    });
    const resolved = frames.find((f) => (f as { type?: string }).type === "transition_resolved");
    expect(resolved).toBeDefined();
    expect(resolved).toMatchObject({
      type: "transition_resolved",
      to: "verify",
      mode: "auto",
      status: "verify",
    });
    // Auto mode must NOT carry a body (no card to show).
    expect(resolved).not.toHaveProperty("body");
  } finally {
    spy.mockRestore();
  }
});

it("does NOT emit transition_resolved when no transition was called", async () => {
  const { ctx, db } = await makeContext();
  const project = await ctx.repos.projects.create("no-trans", "/tmp/no-trans");
  const session = await ctx.repos.sessions.create(project.id, { status: "specify" });
  const storage = new SqliteSessionStorage(db, session.id, {
    id: session.id,
    createdAt: new Date().toISOString(),
  });

  const spy = vi.spyOn(runnerMod, "runPrompt");
  spy.mockImplementation(async () => {});

  const frames: unknown[] = [];
  try {
    await runAgentStream(ctx, session.id, "design", storage, {
      send: (frame) => frames.push(frame),
    });
    const resolved = frames.find((f) => (f as { type?: string }).type === "transition_resolved");
    expect(resolved).toBeUndefined();
  } finally {
    spy.mockRestore();
  }
});
```

**Step 2: Run tests to verify they fail**

Run: `vp run '@sakti-code/server#test' -- --run apps/server/src/agent/__tests__/auto-chain.test.ts`
Expected: FAIL — `resolved` is `undefined` (frame never emitted).

**Step 3: Implement — emit the frame in both branches**

In `runAgentStream` (`ws-handler.ts`), the `WsHandle` interface's `send` method already accepts `unknown`. The gate branch is at ~line 403 and the auto branch is at ~line 406-436.

**Gate branch** (currently `if (edge.mode === "gate") return;`):

```typescript
if (edge.mode === "gate") {
  ws.send({
    body: session.pendingTransitionBody ?? "",
    mode: "gate",
    sessionId,
    status: session.status,
    to: dest,
    type: "transition_resolved",
  } satisfies TransitionResolvedFrame);
  return; // pause for the confirm route
}
```

**Auto branch** (after `await applyTransition(...)`, before `currentMessage = edge.instruction`):

```typescript
try {
  await applyTransition(
    { ... },
    session,
    edge,
  );
} catch (err) {
  log?.error?.("auto-chain: applyTransition failed — stopping", err, { sessionId });
  await clearPendingTransition(ctx, sessionId);
  return;
}
// Sync the desktop: status flipped, auto-chain applied, no card.
const updated = ctx.repos.sessions.findById(sessionId);
ws.send({
  mode: "auto",
  sessionId,
  status: updated?.status ?? edge.statusTarget ?? session.status,
  to: dest,
  type: "transition_resolved",
} satisfies TransitionResolvedFrame);
currentMessage = edge.instruction;
```

**Step 4: Run tests to verify they pass**

Run: `vp run '@sakti-code/server#test' -- --run apps/server/src/agent/__tests__/auto-chain.test.ts`
Expected: PASS — all three new tests pass, plus existing auto-chain tests still pass.

**Step 5: Commit**

```bash
git add apps/server/src/agent/ws-handler.ts apps/server/src/agent/__tests__/auto-chain.test.ts
git commit -m "feat(ws): emit transition_resolved frame on every transition edge resolution"
```

---

## Task 3: Remove eager card-setting from `tool_execution_start` handler

**Files:**

- Modify: `apps/desktop/src/stores/session/handlers/tool-events.ts:9-17`
- Test: `apps/desktop/src/stores/session/__tests__/tool-handlers.test.ts`

**Step 1: Write the failing test (modify the existing test)**

The existing test at `tool-handlers.test.ts:72-86` asserts that `transition` tool_call sets `pendingTransition`. This is now WRONG — the card should only appear via the `transition_resolved` frame. Replace it:

```typescript
it("transition tool_execution_start does NOT set pendingTransition (card comes from transition_resolved frame)", () => {
  const { session, dispatch } = setupHandlers();
  dispatch({ message: userMsg("hi"), type: "message_start" });
  dispatch({ message: assistantMsg(), type: "message_start" });
  dispatch({
    args: { to: "build", body: "spec summary" },
    toolCallId: "tc1",
    toolName: "transition",
    type: "tool_execution_start",
  });
  // The card is NO LONGER set from the tool-call event.
  // It arrives via the transition_resolved WS frame (handled in ws-client).
  expect(session.store.pendingTransition).toBeNull();
});
```

Keep the existing "transition tool without a `to` does not set pendingTransition" test — it still passes (still null, for the same reason but different cause).

**Step 2: Run test to verify it fails**

Run: `vp run desktop#test -- --run apps/desktop/src/stores/session/__tests__/tool-handlers.test.ts`
Expected: FAIL — `pendingTransition` is `{to: "build", body: "spec summary"}` (the old eager set still runs).

**Step 3: Implement — remove the setPendingTransition block**

In `tool-events.ts`, remove the entire `if (event.toolName === "transition")` block from the `tool_execution_start` handler. The handler should only add the tool_call part (for UI display), nothing else:

```typescript
registerHandler("tool_execution_start", (event, ctx) => {
  const msgId = ctx.actions.getCurrentMessageId();
  if (msgId) {
    ctx.actions.addToolCall(msgId, event.toolCallId, event.toolName, event.args);
  }
});
```

**Step 4: Run test to verify it passes**

Run: `vp run desktop#test -- --run apps/desktop/src/stores/session/__tests__/tool-handlers.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/stores/session/handlers/tool-events.ts apps/desktop/src/stores/session/__tests__/tool-handlers.test.ts
git commit -m "fix(desktop): stop eagerly setting transition card from tool-call event"
```

---

## Task 4: Handle `transition_resolved` frame in the desktop WS client

**Files:**

- Modify: `apps/desktop/src/stores/server/ws-client.ts` — `handleFrame` switch (~line 72)
- Test: `apps/desktop/src/stores/server/__tests__/ws-client.test.ts`

**Step 1: Write the failing tests**

Add to `ws-client.test.ts`:

```typescript
it("transition_resolved {mode:gate} sets pendingTransition + updates status", () => {
  const deps = makeDeps();
  const { api, fake } = makeMockApi();
  const ws = createWsClient(api, deps);

  // Register the session so the handler can find it.
  const session = deps.sessionRegistry.get("s-gate");
  // Seed server-store with old status.
  deps.serverStore.actions.addSession({
    id: "s-gate",
    projectId: "p1",
    title: null,
    modelId: null,
    profileId: null,
    thinkingLevel: "off",
    kind: "mission",
    parentSessionId: null,
    changeName: null,
    worktreePath: null,
    pendingTransitionTo: null,
    pendingTransitionBody: null,
    status: "specify",
    createdAt: 1,
    updatedAt: 1,
  });

  fake.fireOpen();
  fake.fireMessage({
    type: "transition_resolved",
    sessionId: "s-gate",
    to: "build",
    mode: "gate",
    status: "specify",
    body: "spec summary",
  });

  expect(session.store.pendingTransition).toMatchObject({
    to: "build",
    body: "spec summary",
  });
  expect(deps.serverStore.store.sessions["s-gate"]?.status).toBe("specify");

  ws.disconnect();
});

it("transition_resolved {mode:auto} clears pendingTransition + updates status", () => {
  const deps = makeDeps();
  const { api, fake } = makeMockApi();
  const ws = createWsClient(api, deps);

  const session = deps.sessionRegistry.get("s-auto");
  // Seed: card was previously set (stale), status is "build".
  session.actions.setPendingTransition({ to: "verify", body: "done" });
  deps.serverStore.actions.addSession({
    id: "s-auto",
    projectId: "p1",
    title: null,
    modelId: null,
    profileId: null,
    thinkingLevel: "off",
    kind: "mission",
    parentSessionId: null,
    changeName: null,
    worktreePath: null,
    pendingTransitionTo: "verify",
    pendingTransitionBody: "done",
    status: "build",
    createdAt: 1,
    updatedAt: 1,
  });

  fake.fireOpen();
  fake.fireMessage({
    type: "transition_resolved",
    sessionId: "s-auto",
    to: "verify",
    mode: "auto",
    status: "verify",
  });

  // Card cleared — no confirmation needed for auto edges.
  expect(session.store.pendingTransition).toBeNull();
  // Status synced.
  expect(deps.serverStore.store.sessions["s-auto"]?.status).toBe("verify");

  ws.disconnect();
});
```

**Step 2: Run tests to verify they fail**

Run: `vp run desktop#test -- --run apps/desktop/src/stores/server/__tests__/ws-client.test.ts`
Expected: FAIL — the `transition_resolved` case doesn't exist in `handleFrame`, so nothing happens.

**Step 3: Implement — add the case to `handleFrame`**

In `ws-client.ts`, inside the `handleFrame` switch, add:

```typescript
case "transition_resolved": {
  const session = sessionRegistry.get(data.sessionId);
  if (data.mode === "gate") {
    session.actions.setPendingTransition({
      to: data.to,
      body: data.body ?? "",
    });
  } else {
    // Auto edge: clear any stale card (defense-in-depth — the eager
    // set was removed from tool-events, but a late frame from a prior
    // run could still surface).
    session.actions.clearPendingTransition();
  }
  // Sync status (covers defect 3 — stale status during auto-chain).
  if (data.status) {
    server.actions.updateSession(data.sessionId, { status: data.status });
  }
  break;
}
```

**Step 4: Run tests to verify they pass**

Run: `vp run desktop#test -- --run apps/desktop/src/stores/server/__tests__/ws-client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/stores/server/ws-client.ts apps/desktop/src/stores/server/__tests__/ws-client.test.ts
git commit -m "feat(desktop): handle transition_resolved frame — gate shows card, auto syncs status"
```

---

## Task 5: Defense-in-depth — clear `pendingTransition` on `agent_start`

This is a safety net. If a stale card somehow survives (e.g., a delayed WS frame from a previous run), the next run's `agent_start` clears it. This is correct because:

- Auto edges: server chains → next run starts → `agent_start` → clear (redundant but safe).
- Gate edges: no next run until confirmed → card stays (correct).
- Gate approved: confirm route starts new run → `agent_start` → clear (redundant, `confirmTransition` already cleared it).

**Files:**

- Modify: `apps/desktop/src/stores/session/handlers/lifecycle-events.ts:4-6`
- Test: `apps/desktop/src/stores/session/__tests__/lifecycle-handlers.test.ts`

**Step 1: Write the failing test**

Add to `lifecycle-handlers.test.ts`:

```typescript
it("agent_start clears stale pendingTransition (defense-in-depth)", () => {
  const { session, dispatch } = setupHandlers();
  // Simulate a stale card from a prior run.
  session.actions.setPendingTransition({ to: "verify", body: "stale" });
  expect(session.store.pendingTransition).not.toBeNull();

  dispatch({ type: "agent_start" });

  expect(session.store.pendingTransition).toBeNull();
});
```

**Step 2: Run test to verify it fails**

Run: `vp run desktop#test -- --run apps/desktop/src/stores/session/__tests__/lifecycle-handlers.test.ts`
Expected: FAIL — `pendingTransition` is still `{to: "verify", body: "stale"}`.

**Step 3: Implement — add clearPendingTransition to agent_start**

In `lifecycle-events.ts`:

```typescript
registerHandler("agent_start", (_event, ctx) => {
  ctx.actions.setPhase("thinking");
  ctx.actions.clearPendingTransition();
});
```

**Step 4: Run test to verify it passes**

Run: `vp run desktop#test -- --run apps/desktop/src/stores/session/__tests__/lifecycle-handlers.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/stores/session/handlers/lifecycle-events.ts apps/desktop/src/stores/session/__tests__/lifecycle-handlers.test.ts
git commit -m "fix(desktop): clear stale pendingTransition on agent_start (defense-in-depth)"
```

---

## Task 6: Regression test — reload rehydration from DB still works

Verify that the `loadChat` re-derivation path (which rehydrates the card from the DB on app restart) still works correctly. This test already exists conceptually in the `actions.test.ts` `loadChat` tests. Add an explicit assertion for the pending-transition re-derivation.

**Files:**

- Test: `apps/desktop/src/stores/server/__tests__/actions.test.ts` (find the `loadChat` describe block)

**Step 1: Write the failing test**

Add to the `loadChat` describe block in `actions.test.ts`:

```typescript
it("loadChat re-derives pendingTransition from server meta (gate survives reload)", async () => {
  const deps = makeDeps();
  deps.serverStore.actions.addSession({
    id: "s-rehydrate",
    projectId: "p1",
    title: null,
    modelId: null,
    profileId: null,
    thinkingLevel: "off",
    kind: "mission",
    parentSessionId: null,
    changeName: null,
    worktreePath: null,
    pendingTransitionTo: "build",
    pendingTransitionBody: "spec summary",
    status: "specify",
    createdAt: 1,
    updatedAt: 1,
  });

  const mockApi = {
    api: {
      sessions: {
        ":id": {
          chat: {
            $get: vi.fn(async () => okRes({ turns: [] })),
          },
        },
      },
    },
  };
  const actions = createActions(mockApi as never, makeMockWs(), deps);
  const session = deps.sessionRegistry.get("s-rehydrate");

  await actions.loadChat("s-rehydrate");

  expect(session.store.pendingTransition).toMatchObject({
    to: "build",
    body: "spec summary",
  });
});

it("loadChat clears pendingTransition when server meta has none (auto edge consumed)", async () => {
  const deps = makeDeps();
  deps.serverStore.actions.addSession({
    id: "s-consumed",
    projectId: "p1",
    title: null,
    modelId: null,
    profileId: null,
    thinkingLevel: "off",
    kind: "mission",
    parentSessionId: null,
    changeName: null,
    worktreePath: null,
    pendingTransitionTo: null,
    pendingTransitionBody: null,
    status: "verify",
    createdAt: 1,
    updatedAt: 1,
  });

  const mockApi = {
    api: {
      sessions: {
        ":id": {
          chat: {
            $get: vi.fn(async () => okRes({ turns: [] })),
          },
        },
      },
    },
  };
  const actions = createActions(mockApi as never, makeMockWs(), deps);
  const session = deps.sessionRegistry.get("s-consumed");
  // Seed a stale card that should be cleared.
  session.actions.setPendingTransition({ to: "verify", body: "stale" });

  await actions.loadChat("s-consumed");

  expect(session.store.pendingTransition).toBeNull();
});
```

**Step 2: Run test**

Run: `vp run desktop#test -- --run apps/desktop/src/stores/server/__tests__/actions.test.ts`
Expected: PASS (these test the existing `loadChat` path which is unchanged — confirms no regression).

Note: Check the test file for the `okRes` / `errRes` helper and the `makeMockWs` helper, and use the same patterns. If `loadChat` tests already exist with a different setup, follow that pattern.

**Step 3: Commit (test-only, no implementation change)**

```bash
git add apps/desktop/src/stores/server/__tests__/actions.test.ts
git commit -m "test(desktop): regression test for loadChat pendingTransition re-derivation"
```

---

## Task 7: Update `wsResponseSchema` TypeBox validation (server)

The server's WS module validates outgoing frames against a TypeBox schema. The new `transition_resolved` frame type must be included so validation passes.

**Files:**

- Modify: `apps/server/src/agent/ws-handler.ts` — `wsResponseSchema` (~line 165)
- Test: `apps/server/src/agent/__tests__/ws-types.test.ts`

**Step 1: Write the failing test**

Add to `ws-types.test.ts`:

```typescript
it("wsResponseSchema validates transition_resolved frames", () => {
  // The schema is used for runtime validation of outgoing frames.
  // Verify the new frame type is accepted.
  const frame = {
    type: "transition_resolved",
    sessionId: "s1",
    to: "build",
    mode: "gate",
    status: "specify",
    body: "spec summary",
  };
  // wsResponseSchema should accept this — if the schema doesn't include
  // the transition_resolved variant, the server would reject the frame.
  expect(Compiler.Check(wsResponseSchema, frame)).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/server#test' -- --run apps/server/src/agent/__tests__/ws-types.test.ts`
Expected: FAIL — `Compiler.Check` returns `false` (schema doesn't include `transition_resolved`).

**Step 3: Implement — add the variant to `wsResponseSchema`**

In `ws-handler.ts`, add to the `wsResponseSchema` TypeBox union:

```typescript
Type.Object({
  type: Type.Literal("transition_resolved"),
  sessionId: Type.String(),
  to: Type.String(),
  mode: Type.Union([Type.Literal("gate"), Type.Literal("auto")]),
  status: Type.String(),
  body: Type.Optional(Type.String()),
}),
```

Import `Compiler` from `"typebox/compile"` in the test file if not already imported.

**Step 4: Run test to verify it passes**

Run: `vp run '@sakti-code/server#test' -- --run apps/server/src/agent/__tests__/ws-types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/agent/ws-handler.ts apps/server/src/agent/__tests__/ws-types.test.ts
git commit -m "feat(ws): add transition_resolved to wsResponseSchema validation"
```

---

## Task 8: Full-suite verification + typecheck + lint

**Step 1: Run all server tests**

Run: `vp run '@sakti-code/server#test'`
Expected: All pass, including the existing auto-chain and confirm tests.

**Step 2: Run all desktop tests**

Run: `vp run desktop#test`
Expected: All pass, including the modified tool-handler and lifecycle tests.

**Step 3: Run typecheck + lint + format**

Run: `vp check`
Expected: No errors.

**Step 4: Run all workspace tests**

Run: `vp run -r test`
Expected: All pass.

**Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: fix lint/typecheck issues from transition gate fix"
```

---

## Summary of changes

| File                                                           | Change                                                                                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/agent/ws-handler.ts`                          | Add `TransitionResolvedFrame` interface; include in `WsOut` union; add to `wsResponseSchema`; emit frame in gate + auto branches of `runAgentStream`    |
| `apps/desktop/src/stores/session/handlers/tool-events.ts`      | Remove eager `setPendingTransition` from `tool_execution_start` (root cause)                                                                            |
| `apps/desktop/src/stores/server/ws-client.ts`                  | Add `transition_resolved` case to `handleFrame` — gate sets card + syncs status; auto clears card + syncs status                                        |
| `apps/desktop/src/stores/session/handlers/lifecycle-events.ts` | Add `clearPendingTransition()` to `agent_start` (defense-in-depth)                                                                                      |
| Tests (6 files)                                                | Regression coverage for every layer: WS types, auto-chain emission, desktop frame handling, card-setting removal, lifecycle defense, reload rehydration |

## What this fixes

1. **No card for auto edges** — the desktop never sets a card unless the server says `mode: "gate"`.
2. **Status stays in sync** — the `transition_resolved` frame carries the post-resolution status; the desktop updates immediately.
3. **Verify-phase reminder no longer contradicts the UI** — without a stale card, the verify agent running autonomously with verify-phase reminders is expected, non-confusing behavior.
4. **Reload rehydration preserved** — the existing `loadChat` → DB → `pendingTransitionTo` path is untouched and covered by regression tests.
5. **Defense-in-depth** — `agent_start` clears any stale card, so even a delayed/raced frame can't leave a phantom card.

## What stays the same

- The `transition` tool (`packages/tools/src/transition/index.ts`) — unchanged, still a pure signal.
- The transition table (`apps/server/src/agent/config/transition-table.ts`) — unchanged, still the single source of truth.
- The auto-chain engine logic — unchanged, just emits a new frame.
- The confirm route — unchanged.
- `loadChat` re-derivation — unchanged, regression-tested.
- The `TransitionCard` component — unchanged (already has the right `TransitionGateTo` type).
