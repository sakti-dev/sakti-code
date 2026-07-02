# Intake Session Message Rehydration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the intake (onboarding) chat panel rehydrate its full message history from the DB when a project is reopened, mirroring the behavior the task-session panel already has.

**Architecture:** Rehydration uses the existing REST path (`GET /api/sessions/:id/messages` via the Hono RPC client → `hydrateSessionMessages` → `session.actions.loadMessages`). No WebSocket, no new transport. The only missing piece is a _call site_: `OnboardingPanel` never invokes `actions.loadMessages`. Because the intake session id arrives asynchronously (`upsertIntakeSession().then(...)` in `workspace-layout.tsx`), a plain `onMount` would fire while the id is still `null` — so the fix uses a `createEffect` keyed on `props.intakeSessionId`, guarded against refetching the same id.

**Tech Stack:** SolidJS (`createEffect`, `createMemo`), `@solidjs/testing-library`, vitest, Vite+ (`vp`).

---

## Root Cause (verified)

| Boundary                               | Status         | Evidence                                                                                                                                  |
| -------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Messages persisted to DB               | ✅ works       | same path as task sessions; intake id stable across reopens (`findIntakeByProject`, `apps/server/src/__tests__/intake-session.test.ts:7`) |
| `GET /api/sessions/:id/messages`       | ✅ works       | shared endpoint                                                                                                                           |
| `hydrateSessionMessages`               | ✅ works       | `apps/desktop/src/stores/server/__tests__/actions.test.ts:304`                                                                            |
| **UI calls `loadMessages` for intake** | ❌ **missing** | `onboarding-panel.tsx` has no such call; `task-chat-view.tsx:16-18` does (working reference)                                              |

So the store starts empty on reopen → `hasMessages()` is false → `EmptyState` renders instead of the `MessageTimeline`.

## Key Files Reference

| File                                                                         | Role                                                                |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `apps/desktop/src/components/onboarding/onboarding-panel.tsx`                | Intake chat view — **the file to fix**                              |
| `apps/desktop/src/components/onboarding/__tests__/onboarding-panel.test.tsx` | Its tests — mock `useStore` via `vi.mock("~/stores/store-context")` |
| `apps/desktop/src/components/chat-area/task-chat-view.tsx:16-18`             | Working reference: `onMount(() => actions.loadMessages(...))`       |
| `apps/desktop/src/stores/server/actions.ts:117-152`                          | `loadMessages(sessionId)` — REST fetch + hydrate (already correct)  |
| `apps/desktop/src/stores/session/hydrate-messages.ts`                        | `hydrateSessionMessages` (already correct)                          |
| `apps/desktop/src/components/layout/workspace-layout.tsx:40-57`              | Sets `intakeSessionId` async via `upsertIntakeSession().then(...)`  |

---

## Task 1: Add failing tests for intake message hydration

**Files:**

- Modify: `apps/desktop/src/components/onboarding/__tests__/onboarding-panel.test.tsx`

**Why the mock must change too:** `OnboardingPanel` will soon call `actions.loadMessages(...)`. The current mock only exposes `actions: { sendPrompt: vi.fn() }`, so the new call would throw "`loadMessages is not a function`" and break the existing tests. We add it via `vi.hoisted` so the test body can assert on the same fn instance.

**Step 1: Update the test file**

Replace the top of `apps/desktop/src/components/onboarding/__tests__/onboarding-panel.test.tsx` (lines 1–36, from the `import` down through the closing `}));` of the `vi.mock`) with:

```tsx
import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
import { OnboardingPanel } from "../onboarding-panel";

// Hoisted so the same fn instance is shared between the mocked useStore and
// the test assertions.
const mocks = vi.hoisted(() => ({
  loadMessages: vi.fn(),
}));

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    actions: { sendPrompt: vi.fn(), loadMessages: mocks.loadMessages },
    sessions: {
      get: () => ({
        store: {
          messageOrder: [],
          messages: {},
          streaming: { phase: "idle" },
        },
      }),
    },
    server: { store: { sessions: {} } },
    api: {
      api: {
        auth: { $get: async () => ({ ok: false, json: async () => [] }) },
        profiles: { $get: async () => ({ ok: false, json: async () => [] }) },
        models: {
          available: {
            $get: async () => ({ ok: false, json: async () => [] }),
            ":provider": {
              $get: async () => ({ ok: false, json: async () => [] }),
            },
          },
          connected: {
            $get: async () => ({ ok: false, json: async () => [] }),
          },
        },
      },
    },
  }),
}));
```

Then append these two tests inside the existing `describe("OnboardingPanel", ...)` block (after the current last test at line 54):

```tsx
it("loads intake messages when intakeSessionId is set", () => {
  render(() => <OnboardingPanel intakeSessionId="s1" projectId="p1" />);
  expect(mocks.loadMessages).toHaveBeenCalledWith("s1");
});

it("does not load messages when intakeSessionId is null", () => {
  render(() => <OnboardingPanel intakeSessionId={null} projectId="p1" />);
  expect(mocks.loadMessages).not.toHaveBeenCalled();
});
```

**Step 2: Run the tests to verify the new ones fail**

Run (from repo root, `workdir` = `apps/desktop`):

```
vp test run src/components/onboarding/__tests__/onboarding-panel.test.tsx
```

Expected: the two new tests **FAIL**:

- "loads intake messages when intakeSessionId is set" → `expect(vi.fn()).toHaveBeenCalledWith("s1")` fails (0 calls).
- "does not load messages when intakeSessionId is null" → passes trivially for now, but keep it — it will guard the implementation against calling with `null`.

> Note: if you want a clean two-test RED, the second test already passes pre-implementation. That's fine; it becomes meaningful once the effect exists (it proves the `null` guard works). The first test is the true RED signal.

**Step 3: Commit the failing test**

```bash
git add apps/desktop/src/components/onboarding/__tests__/onboarding-panel.test.tsx
git commit -m "test(desktop): assert OnboardingPanel loads intake messages

Failing red: OnboardingPanel never calls actions.loadMessages, so
reopening a project shows an empty intake chat instead of history."
```

---

## Task 2: Implement the load-on-id-available effect

**Files:**

- Modify: `apps/desktop/src/components/onboarding/onboarding-panel.tsx:1,15-23`

**Step 1: Add `createEffect` to the imports**

In `apps/desktop/src/components/onboarding/onboarding-panel.tsx`, change line 1:

```tsx
import { createMemo, type JSX, Show } from "solid-js";
```

to:

```tsx
import { createEffect, createMemo, type JSX, Show } from "solid-js";
```

**Step 2: Add the hydration effect**

Immediately after the `const { sessions, actions } = useStore();` line (currently line 16) and before the `sessionStore` memo, insert:

```tsx
// Hydrate intake history when the intake session becomes available.
// intakeSessionId is set asynchronously by upsertIntakeSession()
// (workspace-layout.tsx), so onMount would fire while it's still null —
// react to the id becoming non-null instead. The lastLoadedId guard
// prevents refetching the same session on unrelated re-renders.
let lastLoadedId: string | null = null;
createEffect(() => {
  const id = props.intakeSessionId;
  if (id && id !== lastLoadedId) {
    lastLoadedId = id;
    void actions.loadMessages(id);
  }
});
```

Leave everything else in the component unchanged.

**Why this is safe / loop-free:**

- `loadMessages` mutates `session.store.messages` (via `reconcile` in `session-store.ts:160`), not `props.intakeSessionId` — so the effect's dependency doesn't change and there's no infinite loop.
- `lastLoadedId` absorbs unrelated re-renders that don't change the id.
- On project switch, `<Show keyed when={activeProject()}>` in `workspace-layout.tsx:126` recreates `OnboardingPanel`, resetting `lastLoadedId` to `null` — a fresh load per project. Correct.

**Step 3: Run the tests to verify they pass**

```
vp test run src/components/onboarding/__tests__/onboarding-panel.test.tsx
```

Expected: **all tests PASS**, including "loads intake messages when intakeSessionId is set".

**Step 4: Commit**

```bash
git add apps/desktop/src/components/onboarding/onboarding-panel.tsx
git commit -m "fix(desktop): hydrate intake messages when session becomes available

OnboardingPanel never called actions.loadMessages, so reopening a
project showed an empty intake chat. Add a createEffect keyed on
intakeSessionId (it arrives async via upsertIntakeSession, so onMount
would miss it) with a lastLoadedId guard against refetch."
```

---

## Task 3: Verify — full suite, typecheck, lint

**Step 1: Run the desktop test suite (regression check)**

```
vp run desktop#test
```

Expected: ALL PASS. Pay attention to anything in `stores/` or `components/` that touches `OnboardingPanel` or `useStore`.

**Step 2: Typecheck**

```
vp run desktop#typecheck
```

Expected: no errors. (The `createEffect` and `loadMessages` types already exist; this is a belt-and-suspenders check.)

**Step 3: Lint + format**

```
vp check
```

Expected: clean. If it reports formatting changes, run `vp check --fix` and re-run `vp check` to confirm clean, then amend or add a follow-up commit for the formatting only.

**Step 4: Manual smoke test**

```
vp run desktop#dev
```

Then in the running app:

1. Pick a project → send a message in the intake chat → wait for the assistant reply.
2. Close the app (or switch to another project and back).
3. Reopen the same project.

Expected: the intake chat area shows the previous user + assistant messages (text, and any tool calls/thinking if present), not the `EmptyState` "No messages yet" placeholder.

---

## Out of scope (do not do here)

- Changing the REST endpoint, `hydrateSessionMessages`, or the WS streaming path — they already work (proven by the task-session path).
- Adding a loading spinner during fetch — the store currently renders `EmptyState` until messages arrive. That's a separate UX polish task if desired.
- Dedup test for "same id not re-called" — covered by the `lastLoadedId` guard; a dedicated re-render test is low-value given Solid's effect semantics. Add only if a regression appears.
