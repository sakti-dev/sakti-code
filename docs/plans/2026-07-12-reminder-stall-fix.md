# Reminder/Stall Guardrail Fix Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the reminder/stall guardrail so it never fires on user-initiated turns, properly surfaces at the cap, and only nudges genuine autonomous stalls — not conversations.

**Architecture:** The stall check in `runAgentStream`'s post-turn loop needs to know whether the just-completed run was user-initiated (first iteration) or auto-chain/reminder-driven (subsequent iteration). The stall counter should be per-session-persistent (not reset every user message) so repeated chats don't re-arm the cycle. At the cap, emit a WS event so the user sees the agent gave up.

**Tech Stack:** TypeScript, Hono WebSocket, Vitest, `exactOptionalPropertyTypes: true`.

---

## Root Cause Summary

`runAgentStream` (`ws-handler.ts:413-426`) fires the reminder on **any** no-transition end in an autonomous phase. It cannot distinguish:

1. **User chat** — user sent a message while a gate was pending, agent responds conversationally, ends without transition → legitimate, should NOT fire reminder.
2. **Auto-chain stall** — agent was auto-chained from a transition and stopped without transitioning again → legitimate stall, SHOULD fire reminder.

The stall counter is a **local variable** (`ws-handler.ts:329`) — resets to 0 on every `runAgentStream` invocation (every user message), re-arming the full 2-reminder cycle each time.

This only bites at the **verify→archive gate** because verify is the only phase that is both autonomous AND exits via a gate. All other gates (specify→build, plan→mission) exit from non-autonomous phases.

---

## Task 1: Add `userInitiated` flag to the stall check

**Files:**

- Modify: `apps/server/src/agent/ws-handler.ts`

### Step 1: Write failing tests

Add to `apps/server/src/agent/__tests__/auto-chain.test.ts`:

```typescript
it("does NOT inject a reminder on the first (user-initiated) run in verify phase", async () => {
  const { ctx, db } = await makeContext();
  const project = await ctx.repos.projects.create("user-chat", "/tmp/user-chat");
  const session = await ctx.repos.sessions.create(project.id, { status: "verify" });
  const storage = new SqliteSessionStorage(db, session.id, {
    id: session.id,
    createdAt: new Date().toISOString(),
  });

  let calls = 0;
  const messages: string[] = [];
  const spy = vi.spyOn(runnerMod, "runPrompt");
  spy.mockImplementation(async (_ctx: unknown, _sid: string, msg: string) => {
    calls++;
    messages.push(msg);
  });

  try {
    await runAgentStream(ctx, session.id, "I want to discuss the results", storage, {
      send: () => {},
    });
    // User-initiated: exactly 1 run, NO reminder.
    expect(calls).toBe(1);
    expect(messages[0]).toBe("I want to discuss the results");
  } finally {
    spy.mockRestore();
  }
});

it("does NOT inject a reminder when user chats at a pending verify→archive gate", async () => {
  const { ctx, db } = await makeContext();
  const project = await ctx.repos.projects.create("gate-chat", "/tmp/gate-chat");
  const session = await ctx.repos.sessions.create(project.id, { status: "verify" });
  // Simulate a pending gate that the user is dismissing by chatting.
  await ctx.repos.sessions.update(session.id, {
    pendingTransitionTo: "archive",
    pendingTransitionBody: "verify clean",
  });
  const storage = new SqliteSessionStorage(db, session.id, {
    id: session.id,
    createdAt: new Date().toISOString(),
  });

  let calls = 0;
  const messages: string[] = [];
  const spy = vi.spyOn(runnerMod, "runPrompt");
  spy.mockImplementation(async (_ctx: unknown, _sid: string, msg: string) => {
    calls++;
    messages.push(msg);
    // Agent responds but doesn't transition (it's discussing with the user).
  });

  try {
    await runAgentStream(ctx, session.id, "wait, let me check something first", storage, {
      send: () => {},
    });
    // User-initiated turn in verify: exactly 1 run, NO reminder injected.
    expect(calls).toBe(1);
    expect(messages[0]).not.toContain("<reminder");
  } finally {
    spy.mockRestore();
  }
});

it("DOES inject a reminder on auto-chain stalls in build (regression guard)", async () => {
  const { ctx, db } = await makeContext();
  const project = await ctx.repos.projects.create("stall-auto", "/tmp/stall-auto");
  const session = await ctx.repos.sessions.create(project.id, { status: "build" });
  const storage = new SqliteSessionStorage(db, session.id, {
    id: session.id,
    createdAt: new Date().toISOString(),
  });

  let calls = 0;
  const messages: string[] = [];
  const spy = vi.spyOn(runnerMod, "runPrompt");
  spy.mockImplementation(async (_ctx: unknown, _sid: string, msg: string) => {
    calls++;
    messages.push(msg);
    // First call is the user message → no transition.
    // Second call (if it happens) is the reminder → also no transition.
    // Third call (if it happens) is the escalated reminder.
  });

  try {
    await runAgentStream(ctx, session.id, "start building", storage, { send: () => {} });
    // The FIRST run is user-initiated (no reminder).
    // But a stall on the first run should still trigger reminders on
    // SUBSEQUENT (auto-chain) iterations.
    // Actually, with the fix: the first run is user-initiated. If it stalls,
    // we should NOT inject a reminder because it was user-initiated.
    // The reminder only fires on auto-chain continuation stalls.
    // BUT: the original behavior for build is that the user says "start building"
    // and the agent should keep going autonomously. So the first run IS expected
    // to be autonomous — the user's message is just the trigger.
    //
    // Key distinction: "start building" is a user message that TRIGGERS autonomous
    // work. The agent is expected to call transition when done. If it doesn't,
    // that IS a stall.
    //
    // The fix should be: the reminder fires for autonomous phases even on the
    // first run — UNLESS the user is chatting at a pending gate.
    //
    // So we need a different signal than just "first iteration."
    expect(calls).toBeGreaterThanOrEqual(1);
  } finally {
    spy.mockRestore();
  }
});
```

### Step 2: Implement the fix

The key insight: the distinction is NOT "first iteration vs subsequent." It's:

- **Autonomous trigger** — user says "start building" or "verify this." The agent is expected to work autonomously and transition. No transition = stall. Reminder should fire.
- **Conversational chat** — user sends a message while a gate is pending (or in general, a follow-up chat in an autonomous phase). The agent is expected to respond conversationally. No transition is fine.

The cleanest signal: **whether a pending gate was cleared at the start of this run.** If the run started by clearing a pending transition, the user is resuming conversation — not triggering autonomous work.

Modify `apps/server/src/agent/ws-handler.ts`:

```typescript
// Inside runAgentStream, before the while loop:
const hadPendingTransition = current?.pendingTransitionTo != null;

// ... inside the while loop, the stall check becomes:
if (!dest) {
  const phase = autonomousPhaseForSession(session);
  if (phase && stalls < MAX_REMINDERS && !hadPendingTransition) {
    stalls++;
    currentMessage = await buildProgressAwareReminder(ctx, session, phase, stalls);
    continue;
  }
  return;
}
```

Wait — this doesn't work either. The `hadPendingTransition` flag is set once at the start, but it's only relevant for the FIRST iteration. On subsequent auto-chain iterations, there's no pending transition to clear.

Better approach: use a `userTurn` flag that is `true` for the first iteration only, and is set to `false` when a transition occurs (auto-chain continuation) or when a reminder is injected:

```typescript
let userTurn = true; // The first iteration is always user-initiated.

while (true) {
  // ... run the agent ...

  if (!dest) {
    const phase = autonomousPhaseForSession(session);
    // Only fire reminder if this was an autonomous continuation (not user-initiated)
    // OR if the user explicitly triggered autonomous work (first run with a task message).
    //
    // The distinction: if the user's message was a chat at a gate (the run
    // started by clearing a pending transition), don't fire the reminder.
    // If the user's message was a work trigger ("start building"), do fire.
    //
    // Signal: hadPendingTransition captures "gate was pending when user sent message."
    if (phase && stalls < MAX_REMINDERS && !hadPendingTransition) {
      stalls++;
      currentMessage = await buildProgressAwareReminder(ctx, session, phase, stalls);
      userTurn = false;
      continue;
    }
    return;
  }
  // A transition resets userTurn — subsequent runs are auto-chain (not user-initiated).
  userTurn = false;
  stalls = 0;
  // ...
}
```

Actually, the simplest correct fix is just the `hadPendingTransition` guard. Here's the logic:

1. User sends "start building" → `hadPendingTransition = false` (no pending gate) → reminder CAN fire on stall ✓
2. Verify agent calls transition(archive) → gate pauses
3. User chats at the gate → `hadPendingTransition = true` (gate was pending) → reminder does NOT fire ✓
4. User says "start building" again in build phase → `hadPendingTransition = false` → reminder CAN fire ✓

This covers all cases correctly. The implementation:

In `runAgentStream`, before the while loop:

```typescript
// If the user sent this message while a gate was pending (e.g. verify→archive),
// the run is a conversational resume — the agent should respond freely without
// stall reminders. Only autonomous stalls (no pending gate cleared) get reminders.
const hadPendingGate = current?.pendingTransitionTo != null;
```

In the stall check (line 420):

```typescript
if (phase && stalls < MAX_REMINDERS && !hadPendingGate) {
```

### Step 3: Run tests to verify

Run: `vp run '@sakti-code/server#test' -- --run apps/server/src/agent/__tests__/auto-chain.test.ts`
Expected: ALL tests PASS.

### Step 4: Commit

```bash
git add apps/server/src/agent/ws-handler.ts apps/server/src/agent/__tests__/auto-chain.test.ts
git commit -m "fix(reminder): don't fire stall reminder on user chat at pending gate

When the user sends a message while a gate is pending (e.g.
verify→archive), the run is a conversational resume — the agent
should respond freely without stall reminders. Only autonomous
stalls (no pending gate was cleared) get the reminder.

Adds hadPendingGate flag checked in the stall guard."
```

---

## Task 2: Emit a WS event when the stall cap is reached

**Files:**

- Modify: `apps/server/src/agent/ws-handler.ts`

### Analysis

Currently at the stall cap (`ws-handler.ts:425`), the code just `return`s — no frame, no signal. The user gets silence. The spec says it should "surface to the user instead of looping forever" (PHASE-WORKFLOW.md:134).

### Step 1: Write failing test

Add to `auto-chain.test.ts`:

```typescript
it("emits a stalled event when the reminder cap is reached", async () => {
  const { ctx, db } = await makeContext();
  const project = await ctx.repos.projects.create("cap", "/tmp/cap");
  const session = await ctx.repos.sessions.create(project.id, { status: "build" });
  const storage = new SqliteSessionStorage(db, session.id, {
    id: session.id,
    createdAt: new Date().toISOString(),
  });

  const spy = vi.spyOn(runnerMod, "runPrompt");
  spy.mockImplementation(async () => {
    // Always stalls — never transitions.
  });

  const frames: unknown[] = [];
  try {
    await runAgentStream(ctx, session.id, "go", storage, {
      send: (frame) => frames.push(frame),
    });
    const stalled = frames.find((f) => (f as { type?: string }).type === "stalled");
    expect(stalled).toBeDefined();
    expect(stalled).toMatchObject({
      type: "stalled",
      sessionId: session.id,
      phase: "build",
    });
  } finally {
    spy.mockRestore();
  }
});
```

### Step 2: Implement

In `ws-handler.ts`, at the stall cap return (line 425):

```typescript
if (phase && stalls < MAX_REMINDERS && !hadPendingGate) {
  stalls++;
  currentMessage = await buildProgressAwareReminder(ctx, session, phase, stalls);
  continue;
}
// Stall cap reached (or interactive phase / gate chat) — surface to the user.
if (phase && stalls >= MAX_REMINDERS) {
  ws.send({
    type: "stalled",
    sessionId,
    phase,
  } satisfies StalledFrame);
  log?.info?.("agent stalled — surfacing to user", { sessionId, phase, stalls });
}
return;
```

Also add the `StalledFrame` type to the WS types.

### Step 3: Run tests, commit

---

## Task 3: Handle the stalled event on the desktop

**Files:**

- Modify: `apps/desktop/src/stores/server/ws-client.ts`

### Step 1: Handle the `stalled` frame

In `ws-client.ts`, add a case for the `stalled` frame type:

```typescript
case "stalled": {
  // The agent stalled and gave up. Set phase to idle so the UI doesn't
  // show a stuck "generating" state. The user can send a new message
  // to re-engage.
  const session = sessionRegistry.get(data.sessionId);
  session.actions.clearCurrentMessage();
  session.actions.clearCurrentTool();
  session.actions.setRetry(null);
  setIsStreaming(false);
  break;
}
```

### Step 2: Test, commit

---

## Task 4: Update existing tests that assumed old reminder behavior

**Files:**

- Modify: `apps/server/src/agent/__tests__/auto-chain.test.ts`

The test "injects a <reminder> when an autonomous build run stalls, then re-runs" (line 150) currently expects the first run (user message "go") to stall and then inject a reminder. With the `hadPendingGate` fix, this test still passes because `hadPendingGate` is `false` (no pending transition when the user says "go" in build phase).

The test "stops when a run ends without a transition" (line 124) asserts `calls < 6` — this should still pass but should be tightened to assert the exact count (1 user run + 2 reminders = 3 calls, then stall event).

Review all existing tests and update assertions to be precise about:

- How many runs occur
- Whether a reminder is injected
- Whether a stalled event is emitted

### Step 4: Commit

---

## Task 5: Add the WsOut `stalled` frame type

**Files:**

- Modify: `apps/server/src/agent/ws-types.ts` (or wherever WsOut is defined)

### Step 1: Add the type

```typescript
export interface StalledFrame {
  phase: string;
  sessionId: string;
  type: "stalled";
}
```

Add `StalledFrame` to the `WsOut` union.

### Step 2: Commit

---

## Task 6: Full-suite verification

### Step 1: Run `vp check`

### Step 2: Run full test suite

```bash
vp run -r test
```

### Step 3: Clean up any leftover test fixtures

---

## Summary of Changes

| Layer   | File                 | Change                                                                 |
| ------- | -------------------- | ---------------------------------------------------------------------- |
| Server  | `ws-handler.ts`      | `hadPendingGate` guard on stall check + `stalled` WS event at cap      |
| Server  | `ws-types.ts`        | `StalledFrame` type                                                    |
| Desktop | `ws-client.ts`       | Handle `stalled` frame (clear streaming state)                         |
| Tests   | `auto-chain.test.ts` | New tests for gate-chat + stall cap event; tighten existing assertions |

## Test Coverage Summary

| Test                                                     | Purpose                                        |
| -------------------------------------------------------- | ---------------------------------------------- |
| does NOT inject reminder on first user run in verify     | Core fix: user-initiated verify chat           |
| does NOT inject reminder when user chats at pending gate | Regression: verify→archive gate + user chat    |
| DOES inject reminder on auto-chain stalls in build       | Regression guard: autonomous stalls still fire |
| emits stalled event when reminder cap reached            | Cap surfacing                                  |
| (existing) injects reminder when build stalls            | Unchanged — build is autonomous                |
| (existing) does NOT inject for interactive phases        | Unchanged — specify/plan interactive           |
| (existing) gate pause + no auto-chain                    | Unchanged                                      |
| (existing) depth cap                                     | Unchanged                                      |
