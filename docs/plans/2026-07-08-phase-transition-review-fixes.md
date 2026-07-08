# Phase Transition Review Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all issues found in the deep-dive code review of the phase transition system: changeName linkage (C1), gate-approve auto-start + instruction delivery (C2), escalation tone (I1), missing tests (I2, M4), and cleanup items (I3, M1, M3).

**Architecture:** C1 adds a server-side change-name resolver used at the plan→mission gate. C2 extends the confirm route response to carry the `<instruction>` block, which the desktop client auto-sends as a WS prompt after approve. I1 adds a stall-count param to `buildReminder` for escalation tone. The rest are targeted tests + mechanical cleanup.

**Tech Stack:** TypeScript, Hono, node:sqlite + Drizzle, SolidJS, Vitest, `vp` toolchain.

**Design doc:** `docs/plans/2026-07-08-phase-transition-system.md` (the system being fixed)

**Key commands:**

```bash
vp run '@sakti-code/server#test'          # server tests
vp run '@sakti-code/tools#test'           # tools tests
vp run -r test                            # all tests (3 pre-existing baseline failures expected)
vp check                                  # format + lint + typecheck (0 errors expected)
vp check --fix                            # same, with autofixes
```

**Conventions:** TDD. `exactOptionalPropertyTypes: true` (use `delete` / conditional spread, never assign `undefined`). Tests in `__tests__/`. No `.only`/`.skip`. Arrow callbacks, `for...of`, `const` by default, `as const` for immutables. SolidJS uses `class`/`for` (not `className`/`htmlFor`).

**Context for the implementer:**

- The transition system replaced `ask` with `transition({ to, body })`. A server-side transition table (`transition-table.ts`) declares each phase edge as gate/auto + side-effects + `<instruction>` templates.
- The auto-chain engine (`ws-handler.ts:runAgentStream`) loops: run → inspect pending transition → chain (auto) or pause (gate).
- `phaseFromSession({ kind, status })` maps DB state to a phase: plan→"plan", specifying→"specify", building→"build", review→"verify", merged→"archive".
- Gate approvals go through `POST /api/sessions/:id/confirm` with `{ action, to, body }`.
- The desktop client (`plan-chat.tsx`, `mission-chat-view.tsx`) renders yes/no cards and calls `actions.confirmTransition`.
- `SAKTI_CHANGES_DIR = ".sakti/changes"` is exported from `@sakti-code/sakti`.
- Default session status is `"specifying"` (schema.ts:25). Valid statuses: specifying, building, review, merged.

**Existing files you will touch:**

```
apps/server/src/agent/config/transition-table.ts          # phaseFromSession (M1)
apps/server/src/agent/config/transition-apply.ts           # (read-only reference)
apps/server/src/agent/reminder.ts                          # escalation tone (I1)
apps/server/src/agent/ws-handler.ts                        # stall count wiring (I1)
apps/server/src/routes/sessions/confirm.ts                 # C1 + C2
apps/server/src/routes/sessions/__tests__/confirm.test.ts  # I2
apps/server/src/agent/__tests__/auto-chain.test.ts         # M4
apps/desktop/src/stores/server/actions.ts                  # C1 + C2
apps/desktop/src/stores/server/server-store.ts             # (read-only reference)
apps/desktop/src/stores/server/__tests__/actions.test.ts   # C1 + C2
apps/desktop/src/components/onboarding/plan-chat.tsx       # C1
apps/desktop/src/components/chat-area/mission-chat-view.tsx # C2
apps/desktop/src/components/chat-area/parts/ask-card.tsx   # M3 rename
apps/desktop/src/stores/session/session-store.ts           # M3 rename (stale var)
```

---

## Task 1: Cleanup — phaseFromSession explicit statuses + persistTransitionSideEffect comment (M1 + I3)

**Files:**

- Modify: `apps/server/src/agent/config/transition-table.ts:122-136`
- Modify: `apps/server/src/agent/config/__tests__/transition-table.test.ts`
- Modify: `apps/server/src/agent/ws-handler.ts:197-204`

### Step 1: Write failing test for unknown status throwing

In `apps/server/src/agent/config/__tests__/transition-table.test.ts`, add:

```ts
it("phaseFromSession throws for an unknown status on a mission", () => {
  expect(() => phaseFromSession({ kind: "mission", status: "bogus-phase" })).toThrow(
    /Unknown status/,
  );
});
```

Update the existing test at line 76 that currently asserts `phaseFromSession({ kind: "mission", status: "bogus" })` returns `"specify"` — change it to assert it throws instead:

```ts
it("phaseFromSession throws for an unknown status on a mission", () => {
  expect(() => phaseFromSession({ kind: "mission", status: "bogus" })).toThrow(/Unknown status/);
});
```

### Step 2: Run test to verify it fails

```bash
vp run '@sakti-code/server#test' -- src/agent/config/__tests__/transition-table.test.ts
```

Expected: FAIL (current default returns "specify", doesn't throw).

### Step 3: Fix phaseFromSession

In `apps/server/src/agent/config/transition-table.ts`, replace the `phaseFromSession` function (lines 122-136):

```ts
export function phaseFromSession(session: { kind: string; status: string }): Phase {
  if (session.kind === "plan") return "plan";
  switch (session.status) {
    case "specifying":
      return "specify";
    case "building":
      return "build";
    case "review":
      return "verify";
    case "merged":
      return "archive";
    default:
      throw new Error(
        `Unknown status "${session.status}" for session kind "${session.kind}" — cannot derive phase.`,
      );
  }
}
```

### Step 4: Run test to verify it passes

```bash
vp run '@sakti-code/server#test' -- src/agent/config/__tests__/transition-table.test.ts
```

Expected: PASS.

### Step 5: Add invariant comment to persistTransitionSideEffect

In `apps/server/src/agent/ws-handler.ts`, update the JSDoc on `persistTransitionSideEffect` (around line 197-204). Add this paragraph after the existing description:

```ts
/**
 * ...existing JSDoc...
 *
 * **Why fire-and-forget is safe:** `node:sqlite` writes are synchronous —
 * the SQL executes during the microtask, before the `await runPrompt(...)`
 * continuation runs. If the DB layer ever becomes async, this MUST be
 * awaited (the transition signal would be lost silently).
 */
```

### Step 6: Full server test + check

```bash
vp run '@sakti-code/server#test' && vp check
```

Expected: all pass, 0 errors.

### Step 7: Commit

```bash
git add -A && git commit -m "fix: phaseFromSession throws on unknown status + document persistTransitionSideEffect invariant"
```

---

## Task 2: Escalation tone in reminder guardrail (I1)

**Files:**

- Modify: `apps/server/src/agent/reminder.ts`
- Modify: `apps/server/src/agent/__tests__/reminder.test.ts`
- Modify: `apps/server/src/agent/ws-handler.ts`

### Step 1: Write failing tests

In `apps/server/src/agent/__tests__/reminder.test.ts`, add:

```ts
it("escalation tone at the stall cap (stallCount >= 2)", () => {
  const reminder = buildReminder("build", undefined, 2);
  expect(reminder).toContain("stalled");
  expect(reminder).toContain("blocker");
});

it("non-escalated reminder does not contain escalation language", () => {
  const reminder = buildReminder("build", undefined, 0);
  expect(reminder).not.toContain("stalled");
});
```

### Step 2: Run test to verify it fails

```bash
vp run '@sakti-code/server#test' -- src/agent/__tests__/reminder.test.ts
```

Expected: FAIL (`buildReminder` doesn't accept a third param).

### Step 3: Update buildReminder signature + implementation

In `apps/server/src/agent/reminder.ts`, update `buildReminder`:

```ts
/**
 * Build the oh-my-pi style `<reminder>` injected when an autonomous agent ends
 * its turn WITHOUT a `transition` call (a stall). Build is progress-aware
 * (real counts when `progress` is supplied); verify is phase-aware. At the
 * stall cap (`stallCount >= 2`), the tone escalates to surface the blocker.
 */
export function buildReminder(
  phase: AutonomousPhase,
  progress?: TaskProgressLike,
  stallCount = 0,
): string {
  const escalated = stallCount >= 2;
  if (phase === "build") {
    const remaining = progress ? progress.total - progress.completed : 0;
    const progressNote =
      progress && remaining > 0 ? ` — ${remaining} of ${progress.total} tasks still unchecked` : "";
    if (escalated) {
      return `<reminder phase="build" escalated>
You've stalled twice without completing the build phase${progressNote}. Explain the specific blocker in your output, or finish the remaining tasks and call transition({to:"verify"}). Do not stall again without progress.
</reminder>`;
    }
    return `<reminder phase="build">
Build phase isn't complete${progressNote}. Continue: pick the next unchecked task in tasks.md, write its failing test (RED), implement minimally (GREEN), commit. Only call transition({to:"verify"}) once every task is checked AND the project's full test suite passes.
</reminder>`;
  }
  if (escalated) {
    return `<reminder phase="verify" escalated>
You've stalled twice without completing verification. Explain the specific blocker, or finish checking and call transition({to:"build"}) with a fixing plan or transition({to:"archive"}) if clean.
</reminder>`;
  }
  return `<reminder phase="verify">
Verify phase isn't complete. Finish checking completeness, correctness, and coherence against design.md + specs + tasks.md. If you found issues, write the fixing plan and call transition({to:"build"}). Only call transition({to:"archive"}) if the work is genuinely clean.
</reminder>`;
}
```

### Step 4: Run test to verify it passes

```bash
vp run '@sakti-code/server#test' -- src/agent/__tests__/reminder.test.ts
```

Expected: PASS.

### Step 5: Wire stallCount through ws-handler

In `apps/server/src/agent/ws-handler.ts`, update `buildProgressAwareReminder` (around line 408) to accept and pass `stallCount`:

```ts
async function buildProgressAwareReminder(
  ctx: ServerContext,
  session: { changeName: string | null; projectId: string },
  phase: "build" | "verify",
  stallCount: number,
): Promise<string> {
  if (phase !== "build" || !session.changeName) {
    return buildReminder(phase, undefined, stallCount);
  }
  try {
    const project = ctx.repos.projects.findById(session.projectId);
    if (!project) return buildReminder(phase, undefined, stallCount);
    const progress = await getTaskProgressForChange(
      path.join(project.cwd, SAKTI_CHANGES_DIR),
      session.changeName,
      project.cwd,
    );
    return buildReminder(phase, progress, stallCount);
  } catch {
    return buildReminder(phase, undefined, stallCount);
  }
}
```

Update the call site (around line 338):

```ts
if (phase && stalls < MAX_REMINDERS) {
  stalls++;
  currentMessage = await buildProgressAwareReminder(ctx, session, phase, stalls);
  continue;
}
```

### Step 6: Full server test + check

```bash
vp run '@sakti-code/server#test' && vp check
```

### Step 7: Commit

```bash
git add -A && git commit -m "feat(server): escalation tone in reminder guardrail at stall cap"
```

---

## Task 3: changeName wiring at plan→mission gate (C1)

**Goal:** When a plan graduates to a mission, the mission session must have `changeName` set so progress-aware build reminders work.

**Approach:** The confirm route for plan→mission scans `.sakti/changes/` for the most recently created change dir and stamps it on the plan session. The desktop client reads it from the returned session and passes it to `createSession` for the mission.

**Files:**

- Create: `apps/server/src/agent/config/resolve-change-name.ts`
- Create: `apps/server/src/agent/config/__tests__/resolve-change-name.test.ts`
- Modify: `apps/server/src/routes/sessions/confirm.ts`
- Modify: `apps/desktop/src/stores/server/actions.ts` (createSession accepts changeName + confirmTransition mirrors changeName)
- Modify: `apps/desktop/src/components/onboarding/plan-chat.tsx`
- Modify: `apps/desktop/src/stores/server/__tests__/actions.test.ts`
- Modify: `apps/desktop/src/components/onboarding/__tests__/plan-chat.test.tsx`

### Step 1: Write failing test for resolveActiveChangeName

Create `apps/server/src/agent/config/__tests__/resolve-change-name.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { resolveActiveChangeName } from "../resolve-change-name.ts";

describe("resolveActiveChangeName", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "sakti-test-"));
  });

  afterEach(() => {
    // tmpdir auto-cleans; nothing needed
  });

  it("returns the most recently created change dir", () => {
    const changesDir = join(cwd, ".sakti/changes");
    mkdirSync(join(changesDir, "older-change"), { recursive: true });
    writeFileSync(join(changesDir, "older-change", ".sakti.yaml"), "name: older-change\n");
    // Small delay so the second is genuinely newer (mtime granularity).
    mkdirSync(join(changesDir, "newer-change"), { recursive: true });
    writeFileSync(join(changesDir, "newer-change", ".sakti.yaml"), "name: newer-change\n");
    // Bump mtime to ensure ordering.
    const future = new Date(Date.now() + 10_000);
    const { utimesSync } = require("node:fs");
    utimesSync(join(changesDir, "newer-change", ".sakti.yaml"), future, future);

    expect(resolveActiveChangeName(cwd)).toBe("newer-change");
  });

  it("returns null when no changes dir exists", () => {
    expect(resolveActiveChangeName(cwd)).toBeNull();
  });

  it("returns null when changes dir is empty", () => {
    mkdirSync(join(cwd, ".sakti/changes"), { recursive: true });
    expect(resolveActiveChangeName(cwd)).toBeNull();
  });

  it("ignores non-directory entries", () => {
    const changesDir = join(cwd, ".sakti/changes");
    mkdirSync(changesDir, { recursive: true });
    writeFileSync(join(changesDir, "README.md"), "not a change");
    expect(resolveActiveChangeName(cwd)).toBeNull();
  });
});
```

### Step 2: Run test to verify it fails

```bash
vp run '@sakti-code/server#test' -- src/agent/config/__tests__/resolve-change-name.test.ts
```

Expected: FAIL (module not found).

### Step 3: Implement resolveActiveChangeName

Create `apps/server/src/agent/config/resolve-change-name.ts`:

```ts
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SAKTI_CHANGES_DIR } from "@sakti-code/sakti";

/**
 * Resolve the most recently modified change name in a project's
 * `.sakti/changes/` directory. Used at plan→mission graduation to link the
 * new mission session to its SDD change (so progress-aware reminders work).
 *
 * Returns null if the changes dir doesn't exist, is empty, or contains no
 * valid change directories (directories with a `.sakti.yaml` marker). Never
 * throws.
 */
export function resolveActiveChangeName(projectCwd: string): string | null {
  const changesDir = join(projectCwd, SAKTI_CHANGES_DIR);
  if (!existsSync(changesDir)) return null;

  let best: { name: string; mtime: number } | null = null;
  for (const entry of readdirSync(changesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const marker = join(changesDir, entry.name, ".sakti.yaml");
    if (!existsSync(marker)) continue;
    const mtime = statSync(marker).mtimeMs;
    if (best === null || mtime > best.mtime) {
      best = { name: entry.name, mtime };
    }
  }
  return best?.name ?? null;
}
```

### Step 4: Run test to verify it passes

```bash
vp run '@sakti-code/server#test' -- src/agent/config/__tests__/resolve-change-name.test.ts
```

Expected: PASS.

### Step 5: Wire into confirm route for plan→mission

In `apps/server/src/routes/sessions/confirm.ts`, add import at the top:

```ts
import { resolveActiveChangeName } from "../../agent/config/resolve-change-name.ts";
```

In the `approve` block (after `applyTransition(...)` and before the pending clear), add changeName resolution for plan→mission:

```ts
if (action === "approve") {
  const forceReset = edge.requiresForcedObserve ? buildForceReset(ctx, existing) : undefined;
  const graduate =
    edge.requiresGraduation && existing.kind === "plan"
      ? buildGraduation(ctx, existing)
      : undefined;
  await applyTransition(
    {
      repos: ctx.repos,
      ...(forceReset !== undefined ? { forceReset } : {}),
      ...(graduate !== undefined ? { graduate } : {}),
      ...(ctx.log !== undefined ? { log: ctx.log } : {}),
    },
    existing,
    edge,
  );
  // plan→mission: resolve the active change name and stamp it on the
  // plan session so the client can carry it to the new mission.
  if (edge.from === "plan" && edge.to === "mission") {
    const project = ctx.repos.projects.findById(existing.projectId);
    if (project) {
      const changeName = resolveActiveChangeName(project.cwd);
      if (changeName) {
        await ctx.repos.sessions.update(id, { changeName });
      }
    }
  }
}
```

### Step 6: Update desktop actions — confirmTransition mirrors changeName

In `apps/desktop/src/stores/server/actions.ts`:

Update the `confirmTransition` implementation (around line 257) to also mirror `changeName`:

```ts
    async confirmTransition(sessionId, to, body, action) {
      try {
        const res = await api.api.sessions[":id"].confirm.$post({
          param: { id: sessionId },
          json: { action, to, body },
        });
        if (!res.ok) {
          setLastError(`Failed to ${action} (${res.status})`);
          return false;
        }
        const updated = (await res.json()) as SessionMeta;
        server.actions.updateSession(sessionId, {
          status: updated.status,
          ...(updated.changeName !== undefined ? { changeName: updated.changeName } : {}),
          pendingTransitionTo: null,
          pendingTransitionBody: null,
        });
        return true;
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Failed to confirm transition");
        return false;
      }
    },
```

Update the `createSession` interface (line 34) and implementation (line 95) to accept `changeName`:

Interface:

```ts
createSession: (projectId: string, title?: string, changeName?: string) =>
  Promise<SessionMeta | undefined>;
```

Implementation:

```ts
    async createSession(projectId, title, changeName) {
      try {
        const res = await api.api.sessions.$post({
          json: {
            projectId,
            ...(title === undefined ? {} : { title }),
            ...(changeName === undefined ? {} : { changeName }),
          },
        });
        if (!res.ok) {
          return;
        }
        const session = (await res.json()) as SessionMeta;
        server.actions.addSession(session);
        return session;
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Failed to create session");
      }
    },
```

### Step 7: Update plan-chat.tsx to pass changeName

In `apps/desktop/src/components/onboarding/plan-chat.tsx`, update `handleConfirmSession` (around line 52). After the `confirmTransition` call, read the changeName from the store and pass it to `createSession`:

```ts
const handleConfirmSession = async () => {
  const session = sessionStore();
  const ask = session?.store.pendingTransition;
  const sid = props.sessionId;
  if (!(session && ask && sid)) {
    return;
  }

  await actions.confirmTransition(sid, ask.to, ask.body, "approve");

  // Read the changeName that the confirm route resolved + stamped on the
  // plan session, and carry it to the new mission.
  const changeName = server.store.sessions[sid]?.changeName ?? undefined;

  const title =
    ask.body
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0)
      ?.slice(0, 80) ?? undefined;

  const missionSession = await actions.createSession(props.projectId, title, changeName);
  if (!missionSession) return;

  const planProfileId = server.store.sessions[sid]?.profileId;
  if (planProfileId) {
    await actions.selectProfile(missionSession.id, planProfileId);
  }

  session.actions.clearPendingTransition();

  const planIdx = getSessionTabIndex(props.projectId, sid);
  if (planIdx >= 0) closeSessionTab(props.projectId, planIdx);
  openSessionTab(props.projectId, missionSession.id, "mission");

  actions.sendPrompt(missionSession.id, ask.body);
};
```

### Step 8: Update desktop tests

In `apps/desktop/src/stores/server/__tests__/actions.test.ts`, the existing `confirmTransition` test mock response (around line 360) should already have `changeName: null`. Add a test that verifies changeName is mirrored:

```ts
it("mirrors changeName from the confirm response", async () => {
  const deps = makeDeps();
  deps.serverStore.actions.addSession({
    id: "s1",
    projectId: "p1",
    title: null,
    modelId: null,
    profileId: null,
    thinkingLevel: "off",
    kind: "plan",
    pendingTransitionBody: "brief",
    parentSessionId: null,
    changeName: null,
    pendingTransitionTo: "mission",
    status: "specifying",
    createdAt: 1,
    updatedAt: 1,
  });
  const mockApi = {
    api: {
      sessions: {
        ":id": {
          confirm: {
            $post: vi.fn(() =>
              okRes({
                id: "s1",
                projectId: "p1",
                title: null,
                modelId: null,
                profileId: null,
                thinkingLevel: "off",
                kind: "plan",
                pendingTransitionBody: null,
                parentSessionId: null,
                changeName: "add-feature-x",
                pendingTransitionTo: null,
                status: "specifying",
                createdAt: 1,
                updatedAt: 2,
              }),
            ),
          },
        },
      },
    },
  };
  const actions = createActions(mockApi as never, makeMockWs(), deps);

  await actions.confirmTransition("s1", "mission", "brief", "approve");

  expect(deps.serverStore.store.sessions.s1?.changeName).toBe("add-feature-x");
});
```

In `apps/desktop/src/components/onboarding/__tests__/plan-chat.test.tsx`, update the `server.store.sessions` mock to include `changeName`:

```ts
    server: { store: { sessions: {} as Record<string, { profileId: string | null; changeName: string | null }> } },
```

### Step 9: Run all tests + check

```bash
vp run '@sakti-code/server#test' && vp run '@sakti-code/desktop#test' && vp check
```

Note: if the desktop test command is different, check `package.json` — it may be `vp run desktop#test`.

### Step 10: Commit

```bash
git add -A && git commit -m "fix: wire changeName from plan→mission gate to mission session

The confirm route resolves the active change name from .sakti/changes/ and
stamps it on the plan session. The desktop client carries it to the new
mission via createSession. This unblocks progress-aware build reminders for
plan-graduated missions."
```

---

## Task 4: Gate-approve auto-start + instruction delivery (C2)

**Goal:** After a gate-approve (specify→build, verify→archive), the next phase's agent auto-starts with its `<instruction>` block as the first message — no manual user prompt needed.

**Approach:** The confirm route returns the edge's `instruction` alongside the session for approve actions. The desktop `confirmTransition` action returns it. `mission-chat-view.tsx` sends it as a WS prompt.

**Files:**

- Modify: `apps/server/src/routes/sessions/confirm.ts`
- Modify: `apps/server/src/routes/sessions/__tests__/confirm.test.ts`
- Modify: `apps/desktop/src/stores/server/actions.ts` (interface + implementation)
- Modify: `apps/desktop/src/components/chat-area/mission-chat-view.tsx`
- Modify: `apps/desktop/src/stores/server/__tests__/actions.test.ts`
- Modify: `apps/desktop/src/components/onboarding/__tests__/plan-chat.test.tsx`

### Step 1: Write failing test — confirm route returns instruction

In `apps/server/src/routes/sessions/__tests__/confirm.test.ts`, add:

```ts
it("approve returns the edge instruction for auto-start", async () => {
  const { app, ctx } = await makeApp([confirmRoutes]);
  const project = await ctx.repos.projects.create("p", "/tmp/p");
  const session = await ctx.repos.sessions.create(project.id, {
    kind: "mission",
    status: "specifying",
    pendingTransitionTo: "build",
    pendingTransitionBody: "spec summary",
  });

  const res = await app.request(`/api/sessions/${session.id}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "approve", to: "build", body: "spec summary" }),
  });

  expect(res.status).toBe(200);
  const json = (await res.json()) as { instruction?: string };
  expect(json.instruction).toBeDefined();
  expect(json.instruction).toContain("<instruction>");
  expect(json.instruction).toContain("build mode");
});

it("reject does NOT return an instruction", async () => {
  const { app, ctx } = await makeApp([confirmRoutes]);
  const project = await ctx.repos.projects.create("p", "/tmp/p");
  const session = await ctx.repos.sessions.create(project.id, {
    kind: "mission",
    status: "specifying",
    pendingTransitionTo: "build",
    pendingTransitionBody: "spec summary",
  });

  const res = await app.request(`/api/sessions/${session.id}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reject", to: "build", body: "needs work" }),
  });

  expect(res.status).toBe(200);
  const json = (await res.json()) as { instruction?: string };
  expect(json.instruction).toBeUndefined();
});
```

### Step 2: Run test to verify it fails

```bash
vp run '@sakti-code/server#test' -- src/routes/sessions/__tests__/confirm.test.ts
```

Expected: FAIL (response has no `instruction` field).

### Step 3: Update confirm route to return instruction

In `apps/server/src/routes/sessions/confirm.ts`, update the return statements. The approve path returns the session + instruction; the reject path returns just the session:

```ts
// reject (NO): dismiss only — no status change, no side-effect.
await ctx.repos.sessions.update(id, {
  pendingTransitionTo: null,
  pendingTransitionBody: null,
});
const updated = ctx.repos.sessions.findById(id) ?? existing;
if (action === "approve") {
  return c.json({ ...updated, instruction: edge.instruction });
}
return c.json(updated);
```

(Remove the old `return c.json(ctx.repos.sessions.findById(id) ?? existing);` line.)

### Step 4: Run test to verify it passes

```bash
vp run '@sakti-code/server#test' -- src/routes/sessions/__tests__/confirm.test.ts
```

Expected: PASS.

### Step 5: Update desktop Actions interface

In `apps/desktop/src/stores/server/actions.ts`, update the `confirmTransition` type in the `Actions` interface (line 28-33):

```ts
confirmTransition: (sessionId: string, to: string, body: string, action: "approve" | "reject") =>
  Promise<{ ok: boolean; instruction: string | null }>;
```

### Step 6: Update confirmTransition implementation

In the same file, update the implementation (around line 257):

```ts
    async confirmTransition(sessionId, to, body, action) {
      try {
        const res = await api.api.sessions[":id"].confirm.$post({
          param: { id: sessionId },
          json: { action, to, body },
        });
        if (!res.ok) {
          setLastError(`Failed to ${action} (${res.status})}`);
          return { ok: false, instruction: null };
        }
        const updated = (await res.json()) as SessionMeta & { instruction?: string };
        server.actions.updateSession(sessionId, {
          status: updated.status,
          ...(updated.changeName !== undefined ? { changeName: updated.changeName } : {}),
          pendingTransitionTo: null,
          pendingTransitionBody: null,
        });
        return {
          ok: true,
          instruction: updated.instruction ?? null,
        };
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Failed to confirm transition");
        return { ok: false, instruction: null };
      }
    },
```

### Step 7: Update mission-chat-view.tsx to auto-start

In `apps/desktop/src/components/chat-area/mission-chat-view.tsx`, update `handleAsk`:

```ts
const handleAsk = async (askAction: "approve" | "reject") => {
  const ask = pendingTransition();
  if (!ask) {
    return;
  }
  const result = await actions.confirmTransition(props.sessionId, ask.to, ask.body, askAction);
  if (result.ok) {
    sessionStore()?.actions.clearPendingTransition();
    // Auto-start the next phase: the server flipped the status and returned
    // the <instruction> block. Send it as a WS prompt so the next-phase
    // agent runs immediately (no manual user message needed).
    if (result.instruction) {
      actions.sendPrompt(props.sessionId, result.instruction);
    }
  }
};
```

### Step 8: Update desktop tests

In `apps/desktop/src/stores/server/__tests__/actions.test.ts`, update the two existing `confirmTransition` tests:

Test 1 ("POSTs the confirm action and mirrors the returned status") — change the assertion from `await actions.confirmTransition(...)` to check the return value:

```ts
const result = await actions.confirmTransition("s1", "build", "the spec body", "approve");

expect(result.ok).toBe(true);
expect(mockApi.api.sessions[":id"].confirm.$post).toHaveBeenCalledWith({
  param: { id: "s1" },
  json: { action: "approve", to: "build", body: "the spec body" },
});
expect(deps.serverStore.store.sessions.s1?.status).toBe("building");
```

Test 2 ("does nothing when the server responds not ok"):

```ts
const result = await actions.confirmTransition("s1", "build", "body", "approve");

expect(result.ok).toBe(false);
expect(deps.serverStore.store.sessions.s1?.status).toBe("specifying");
```

In `apps/desktop/src/components/onboarding/__tests__/plan-chat.test.tsx`, update the mock:

```ts
  confirmTransition: vi.fn(async () => ({ ok: true, instruction: null })),
```

### Step 9: Run all tests + check

```bash
vp run '@sakti-code/server#test' && vp run desktop#test && vp check
```

### Step 10: Commit

```bash
git add -A && git commit -m "feat: gate-approve auto-starts next phase with <instruction> block

The confirm route returns the edge instruction on approve. The desktop client
sends it as a WS prompt so the next-phase agent runs immediately — no manual
user message needed. specify→build and verify→archive now auto-start."
```

---

## Task 5: Missing tests — plan→mission confirm route + auto-chain depth cap (I2 + M4)

**Files:**

- Modify: `apps/server/src/routes/sessions/__tests__/confirm.test.ts`
- Modify: `apps/server/src/agent/__tests__/auto-chain.test.ts`

### Step 1: Write plan→mission confirm route test

In `apps/server/src/routes/sessions/__tests__/confirm.test.ts`, add:

```ts
it("plan→mission approve stamps changeName from the changes dir", async () => {
  const { app, ctx } = await makeApp([confirmRoutes]);
  // Create a real temp cwd with a .sakti/changes/<name> dir so the
  // resolver can find it.
  const cwd = `/tmp/plan-mission-test-${Date.now()}`;
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(`${cwd}/.sakti/changes/add-feature`, { recursive: true });
  writeFileSync(`${cwd}/.sakti/changes/add-feature/.sakti.yaml`, "name: add-feature\n");

  const project = await ctx.repos.projects.create("plan-proj", cwd);
  const session = await ctx.repos.sessions.create(project.id, {
    kind: "plan",
    status: "specifying",
    pendingTransitionTo: "mission",
    pendingTransitionBody: "mission brief",
  });

  const res = await app.request(`/api/sessions/${session.id}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "approve", to: "mission", body: "mission brief" }),
  });

  expect(res.status).toBe(200);
  // changeName should be stamped on the plan session.
  const after = ctx.repos.sessions.findById(session.id);
  expect(after?.changeName).toBe("add-feature");
  // plan→mission has no statusTarget — status unchanged.
  expect(after?.status).toBe("specifying");
  // Pending cleared.
  expect(after?.pendingTransitionTo).toBeNull();
});
```

### Step 2: Run to verify it passes (confirm route already wired in Task 3)

```bash
vp run '@sakti-code/server#test' -- src/routes/sessions/__tests__/confirm.test.ts
```

Expected: PASS. If it fails because Task 3's confirm route change wasn't applied yet, apply the change first.

### Step 3: Write auto-chain depth-cap test

In `apps/server/src/agent/__tests__/auto-chain.test.ts`, add:

```ts
it("depth cap stops the auto-chain after MAX_CHAIN_DEPTH iterations", async () => {
  const { ctx, db } = await makeContext();
  const project = await ctx.repos.projects.create("depth", "/tmp/depth");
  const session = await ctx.repos.sessions.create(project.id, { status: "building" });
  const storage = new SqliteSessionStorage(db, session.id, {
    id: session.id,
    createdAt: new Date().toISOString(),
  });

  let calls = 0;
  const spy = vi.spyOn(runnerMod, "runPrompt");
  // Every run toggles between build→verify and verify→build, creating an
  // infinite auto-chain that only the depth cap can stop.
  spy.mockImplementation(async (ctx2: unknown, sid: string) => {
    calls++;
    const c = ctx2 as {
      repos: {
        sessions: {
          update: (id: string, d: object) => Promise<unknown>;
          findById: (id: string) => { status: string };
        };
      };
    };
    const currentStatus = c.repos.sessions.findById(sid).status;
    if (currentStatus === "building") {
      await c.repos.sessions.update(sid, {
        pendingTransitionTo: "verify",
        pendingTransitionBody: "done",
      });
    } else {
      await c.repos.sessions.update(sid, {
        pendingTransitionTo: "build",
        pendingTransitionBody: "fix it",
      });
    }
  });

  try {
    await runAgentStream(ctx, session.id, "go", storage, { send: () => {} });
    // MAX_CHAIN_DEPTH is 8; the initial run + 8 chained runs = 9 max.
    // The key assertion: it stopped (didn't infinite-loop).
    expect(calls).toBeLessThanOrEqual(10);
    expect(calls).toBeGreaterThanOrEqual(2);
  } finally {
    spy.mockRestore();
  }
});
```

### Step 4: Run to verify it passes

```bash
vp run '@sakti-code/server#test' -- src/agent/__tests__/auto-chain.test.ts
```

Expected: PASS.

### Step 5: Full test + check + commit

```bash
vp run '@sakti-code/server#test' && vp check
git add -A && git commit -m "test: plan→mission confirm route + auto-chain depth cap"
```

---

## Task 6: Rename AskCard → TransitionCard (M3)

**Goal:** The component, file, and all references should use "Transition" naming, not the stale "Ask" naming from the removed `ask` tool.

**Files:**

- Rename: `apps/desktop/src/components/chat-area/parts/ask-card.tsx` → `transition-card.tsx`
- Modify: `apps/desktop/src/components/chat-area/mission-chat-view.tsx`
- Modify: `apps/desktop/src/components/onboarding/plan-chat.tsx`
- Modify: `apps/desktop/src/stores/session/session-store.ts` (if any stale `pendingAsk` vars remain)
- Modify: `apps/desktop/src/stores/session/__tests__/tool-handlers.test.ts`

### Step 1: Rename the file + component

Rename `apps/desktop/src/components/chat-area/parts/ask-card.tsx` to `transition-card.tsx`.

Inside the file, rename:

- `AskCard` → `TransitionCard`
- `TransitionCardProps` → `TransitionCardProps` (already correct)
- `data-component="ask-card"` → `data-component="transition-card"`
- Update the function name: `export function TransitionCard(props: TransitionCardProps): JSX.Element {`

### Step 2: Update imports

In `apps/desktop/src/components/chat-area/mission-chat-view.tsx`:

```ts
import { TransitionCard } from "~/components/chat-area/parts/transition-card";
```

And update the JSX usage (around line 43):

```tsx
<TransitionCard
  to={ask().to}
  body={ask().body}
  onApprove={() => handleAsk("approve")}
  onReject={() => handleAsk("reject")}
/>
```

In `apps/desktop/src/components/onboarding/plan-chat.tsx`:

```ts
import { TransitionCard } from "~/components/chat-area/parts/transition-card";
```

And update the JSX usage (around line 101):

```tsx
<TransitionCard
  to={ask().to}
  body={ask().body}
  onApprove={handleConfirmSession}
  onReject={() => sessionStore()?.actions.clearPendingTransition()}
/>
```

### Step 3: Update any stale `pendingAsk` / `AskCard` references

Search for any remaining references:

```bash
rg "AskCard|ask-card|pendingAsk" apps/desktop/src --glob '*.ts' --glob '*.tsx'
```

Update each to use the new naming. In `session-store.ts`, if there's a variable named `pendingAsk`, rename to `pendingTransition` (it should already be — verify). In test files, update any `data-component="ask-card"` selectors to `data-component="transition-card"`.

### Step 4: Run tests + check

```bash
vp run desktop#test && vp check
```

### Step 5: Commit

```bash
git add -A && git commit -m "refactor: rename AskCard → TransitionCard (stale ask-tool naming)"
```

---

## Final verification

After all tasks:

```bash
vp run -r test    # only 3 pre-existing baseline failures in packages/sakti
vp check          # 0 errors
```

Sanity grep — no stale references:

```bash
rg "AskCard|ask-card" apps/desktop/src --glob '*.tsx' --glob '*.ts'   # expect: none
rg "BUILD_PROMPT|VERIFY_PROMPT|PLAN_PROMPT" apps/server/src           # expect: none
rg 'kind: "session"|kind: "completion"' apps/server/src               # expect: none
```
