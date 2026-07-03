# SDD Task Lifecycle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> **VOCABULARY NOTE (2026-07-04):** The domain word `task` was renamed to
> `mission`. The `sessions.kind` value is now `'mission'` (was `'task'`);
> `SessionMeta.kind` is `"intake" | "mission"`; `TaskChatView` → `MissionChatView`
> (`task-chat-view.tsx` → `mission-chat-view.tsx`); `currentTask` (streaming
> field) is UNCHANGED (unrelated concept). Below, domain references to
> "task"/"Task" mean "mission". Plan-step labels like "Task 1.1" are unchanged.

**Goal:** Replace the ad-hoc `propose_session` flow with a built-in spec-driven task lifecycle (`planning → building → review → merged`) gated by one generic `ask` tool, status-driven agent resolution, forced compaction on the plan→build switch, and a sidebar redesigned around the active project's tasks.

**Architecture:** A single generic `ask({ kind?, body })` tool in `packages/tools` is wired at the server (`apps/server`) to specific transitions per `kind`. Task `status` (new `sessions` column) drives both the agent resolver (`planning`→plan agent, `building`→build agent) and the sidebar (active vs archived). The plan→build approval forces a compaction (or OM observation) before the agent switch, since the switch invalidates the prompt cache anyway.

**Tech Stack:** TypeScript monorepo, Hono server, SolidJS desktop, node:sqlite + Drizzle, `@sakti-code/agent` (Effect-based), vitest, `vp` toolchain.

**Design doc:** `docs/plans/2026-07-04-sdd-task-lifecycle-design.md` — read it first for rationale.

---

## Integration map (verified via codebase graph)

| Concern                   | File:line                                                                                                 | Change                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| status column             | `packages/db/src/schema.ts:12-27`                                                                         | add `status` col                                                                            |
| SessionRepo create/update | `packages/db/src/repos/index.ts:57-89,112-130`                                                            | add `status`                                                                                |
| SessionMeta               | `apps/desktop/src/stores/server/server-store.ts:11-21`                                                    | add `status`                                                                                |
| ask tool                  | `packages/tools/src/ask/` (new)                                                                           | create; mirror `propose-session/`                                                           |
| delete propose-session    | `packages/tools/src/propose-session/`                                                                     | delete                                                                                      |
| tool factory              | `apps/server/src/agent/config/tool-registry.ts:37-62` (`TOOL_FACTORIES`)                                  | `propose_session`→`ask`                                                                     |
| agent catalog             | `apps/server/src/agent/config/server-agents.ts:73-127`                                                    | intake swap tool; plan/build add `ask`                                                      |
| prompts                   | `apps/server/src/agent/config/prompts.ts`                                                                 | rewrite INTAKE/PLAN/BUILD (SDD-aware)                                                       |
| resolver                  | `apps/server/src/agent/config/resolve-agent.ts:38-45`                                                     | branch on `status` for tasks                                                                |
| ask wiring table          | `apps/server/src/agent/config/ask-kinds.ts` (new)                                                         | kind→{onApprove,onReject,card}                                                              |
| confirm route             | `apps/server/src/routes/sessions/confirm.ts` (new)                                                        | `POST /:id/confirm`                                                                         |
| route compose             | `apps/server/src/routes/sessions/sessions.ts:8`                                                           | chain confirm route                                                                         |
| force compact             | `packages/agent/src/memory/compaction/auto-compaction.ts:293` (`runAutoCompaction`)                       | call directly (bypasses `checkCompaction`)                                                  |
| force observe             | `packages/agent/src/memory/observational-memory/engine.ts`                                                | add public `forceObserve()` (mirror `forceReflect:264`, calls private `runSyncObserve:696`) |
| OM-enabled check          | `apps/server/src/agent/config/resolve-observational-memory.ts` (`resolveOmConfig`)                        | `undefined` ⇒ OM off                                                                        |
| desktop WS dispatch       | `apps/desktop/src/stores/session/handlers/tool-events.ts:11-19` (`registerToolHandlers`)                  | `propose_session` branch → `ask` branch by kind                                             |
| desktop store             | `apps/desktop/src/stores/session/session-store.ts:16-19,508-514`                                          | `ProposedSession`→`PendingAsk`; rename setters                                              |
| session card              | `apps/desktop/src/components/chat-area/parts/proposed-session-card.tsx`                                   | generalize → `AskCard` (by kind)                                                            |
| intake mount              | `apps/desktop/src/components/onboarding/onboarding-panel.tsx:14-81`                                       | uses AskCard; `handleConfirmSession`                                                        |
| task mount                | `apps/desktop/src/components/chat-area/task-chat-view.tsx:10-27` (`TaskChatView`)                         | mount plan/completion cards                                                                 |
| sidebar rewrite           | `apps/desktop/src/components/layout/sidebar/sidebar.tsx`                                                  | remove project tree; tasks for active tab                                                   |
| sidebar deletions         | `sidebar/{project-group,project-context-menu,add-project-input,memory-sidebar-card,om-progress-bars}.tsx` | delete                                                                                      |
| task row                  | `sidebar/session-item.tsx` → `task-row.tsx`                                                               | 2-line, pill, dot, kebab                                                                    |
| active project            | `apps/desktop/src/stores/workspace/tab-store.ts` (`activeTab().projectId`)                                | source for task filter                                                                      |
| activity dot              | `apps/desktop/src/stores/session/session-registry.ts` + `session-store.ts` (`streaming.phase`)            | derive idle/working/error                                                                   |

---

## Phase 1 — Status column & data model

### Task 1.1: Add `status` column to sessions schema

**Files:**

- Modify: `packages/db/src/schema.ts:22` (after the `kind` line)
- Test: `packages/db/src/__tests__/sessions-kind.test.ts` (pattern to follow)

**Step 1:** Write failing test in `packages/db/src/__tests__/sessions-status.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { createTestDb } from "./helpers"; // follow sessions-kind.test.ts setup

describe("sessions status column", () => {
  it("defaults new task sessions to planning", () => {
    const { db, repos } = createTestDb();
    const project = repos.projects.create("p", "/tmp/p");
    const session = repos.sessions.create(project.id);
    expect(session.status).toBe("planning");
  });

  it("can be set to building/review/merged", () => {
    const { repos } = setup();
    const project = repos.projects.create("p", "/tmp/p");
    const session = repos.sessions.create(project.id);
    const updated = repos.sessions.update(session.id, { status: "building" });
    expect(updated.status).toBe("building");
  });
});
```

**Step 2:** Run — `vp run '@sakti-code/db#test' packages/db/src/__tests__/sessions-status.test.ts`. Expected: FAIL (no `status`).

**Step 3:** Add column in `packages/db/src/schema.ts` after line 22:

```ts
status: text("status").notNull().default("planning"),
```

**Step 4:** Add `status?: string` to `SessionRepo.create` options (`repos/index.ts:57-66`) and `"status"` to the `update` Pick list (`repos/index.ts:117`). Wire both into the insert/set spreads.

**Step 5:** Run test — PASS.

**Step 6:** Commit: `feat(db): add sessions.status column (planning/building/review/merged)`.

### Task 1.2: Migrate existing task rows to `building`

**Files:**

- Modify: `apps/server/src/db/migrations.ts` (or the migration runner entry; locate via how existing schema changes are applied — search for where `CREATE TABLE`/migrations run on boot)

**Step 1:** Find the migration mechanism (grep `ALTER TABLE` / migration runner in `apps/server/src`). Existing task rows would get `'planning'` from the column default on `ADD COLUMN`; design says default them to `'building'`.

**Step 2:** Add a one-shot migration: after the `status` column is added, `UPDATE sessions SET status = 'building' WHERE kind = 'task' AND status = 'planning'` — but only run once. Follow whatever idempotent migration pattern the repo uses (settings-key guard, etc.).

**Step 3:** Test the migration with a fixture DB containing old task rows; assert they become `building`.

**Step 4:** Commit: `feat(db): migrate existing task sessions to building status`.

### Task 1.3: Add `status` to desktop `SessionMeta`

**Files:** `apps/desktop/src/stores/server/server-store.ts:11-21`

**Step 1:** Update the interface:

```ts
export interface SessionMeta {
  createdAt: number;
  id: string;
  kind: "intake" | "task";
  modelId: string | null;
  profileId: string | null;
  projectId: string;
  status: "planning" | "building" | "review" | "merged";
  thinkingLevel: string;
  title: string | null;
  updatedAt: number;
}
```

**Step 2:** Run `vp check` — fix any type errors from missing `status` in test fixtures (search `SessionMeta` usages in `__tests__/` and add `status: "building"`).

**Step 3:** Commit: `feat(desktop): add status to SessionMeta`.

---

## Phase 2 — Generic `ask` tool

### Task 2.1: Create `ask` tool

**Files:** Create `packages/tools/src/ask/index.ts`, `packages/tools/src/ask/__tests__/ask.test.ts`

**Step 1:** Write failing test (`ask.test.ts`) — mirror `propose-session/__tests__/`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { createAskTool } from "../index.ts";

describe("ask tool", () => {
  it("terminates the turn and returns awaiting text", async () => {
    const tool = createAskTool();
    const result = await tool.execute({ kind: "session", body: "x" }, {});
    expect(result.terminate).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Awaiting");
  });

  it("accepts a call without a kind (open question)", async () => {
    const tool = createAskTool();
    const result = await tool.execute({ body: "which branch?" }, {});
    expect(result.terminate).toBe(true);
  });
});
```

**Step 2:** Run — FAIL (module missing).

**Step 3:** Create `packages/tools/src/ask/index.ts`, mirroring `propose-session/index.ts`:

```ts
import type { AgentTool } from "@sakti-code/agent";
import { type Static, Type } from "typebox";

const askSchema = Type.Object({
  kind: Type.Optional(
    Type.String({
      description:
        "Optional discriminator. Known kinds (session/plan/completion) present a confirmation card with wired actions; omit for an open question.",
    }),
  ),
  body: Type.String({
    description:
      "The content to present to the user — a brief, a plan, a completion summary, or a question.",
  }),
});

export type AskToolInput = Static<typeof askSchema>;

export function createAskTool(): AgentTool<typeof askSchema, undefined> {
  return {
    name: "ask",
    label: "ask",
    description:
      "Present something to the user and end your turn. Use a known kind (session/plan/completion) for a workflow gate with wired actions, or omit kind for an open question. The user's response arrives as the next message.",
    parameters: askSchema,
    async execute() {
      return {
        content: [{ type: "text" as const, text: "Awaiting user." }],
        details: undefined,
        terminate: true,
      };
    },
  };
}
```

**Step 4:** Export from `packages/tools/src/index.ts` (barrel) — add `export * from "./ask/index.ts";`.

**Step 5:** Run test — PASS. Commit: `feat(tools): add generic ask tool`.

### Task 2.2: Delete `propose-session` tool

**Files:** Delete `packages/tools/src/propose-session/`; update `packages/tools/src/index.ts` barrel.

**Step 1:** Delete the directory. Remove its barrel export.

**Step 2:** Run `vp check` — EXPECT failures in `apps/server` (tool-registry import). Leave them for Task 2.3.

**Step 3:** Commit: `refactor(tools): remove propose-session tool (replaced by ask)`.

### Task 2.3: Register `ask` in the server tool factory

**Files:** `apps/server/src/agent/config/tool-registry.ts:37-62`

**Step 1:** Update imports — replace `createProposeSessionTool` import with `createAskTool` from `@sakti-code/tools`.

**Step 2:** In `TOOL_FACTORIES`, replace the `propose_session` entry with:

```ts
ask: () => createAskTool() as AgentTool,
```

**Step 3:** Update the tool-registry test (`__tests__/tool-registry.test.ts`) — any assertion referencing `propose_session` → `ask`.

**Step 4:** Run `vp run '@sakti-code/server#test'` — fix `server-agents.ts` next (Task 3.1) if `propose_session` is referenced in activeToolNames.

**Step 5:** Commit: `feat(server): register ask tool in TOOL_FACTORIES`.

---

## Phase 3 — Agent prompts & status-based resolver

### Task 3.1: Update agent catalog `activeToolNames`

**Files:** `apps/server/src/agent/config/server-agents.ts:73-127`

**Step 1:** In the `intake` agent activeToolNames, replace `"propose_session"` with `"ask"`.

**Step 2:** Add `"ask"` to the `plan` agent activeToolNames and the `build` agent activeToolNames.

**Step 3:** Update `server-agents.test.ts` if it asserts tool lists.

**Step 4:** Run `vp run '@sakti-code/server#test' src/agent/config/__tests__/server-agents.test.ts`. Commit: `feat(server): wire ask tool into intake/plan/build agents`.

### Task 3.2: Rewrite SDD-aware prompts

**Files:** `apps/server/src/agent/config/prompts.ts`

**Step 1:** Rewrite the three primary prompts. Each must teach its one `ask` kind and forbid crossing phase boundaries. Sketch:

- `INTAKE_SYSTEM_PROMPT` — product/rough planning only; **no implementation detail**; research feasibility; call `ask({ kind: "session", body })` when the _product_ plan is agreed, where `body` is a self-contained brief (what/why/constraints/rough plan) that becomes the task's first prompt. Remove all `propose_session` references.
- `PLAN_PROMPT` — research the codebase; produce a **detailed implementation plan** (numbered steps, file-level touch points, risks, test plan); no edits (ruleset denies them too); call `ask({ kind: "plan", body })` with the plan as `body`. The user approves before building.
- `BUILD_PROMPT` — execute the approved plan; make focused edits; verify (run `vp check` / tests); when done, call `ask({ kind: "completion", body })` where `body` summarizes what was changed and how it was verified.

**Step 2:** Keep `EXPLORE_PROMPT`, `GENERAL_PROMPT`, `DEFAULT_SYSTEM_PROMPT` as-is.

**Step 3:** Update any prompt-content tests (search `__tests__` for prompt string assertions).

**Step 4:** Run tests; commit: `feat(server): SDD-aware prompts for intake/plan/build`.

### Task 3.3: Status-based agent resolver

**Files:** `apps/server/src/agent/config/resolve-agent.ts:38-45`

**Step 1:** Write failing test in `resolve-agent` test file — a task session with `status: "planning"` resolves to the `plan` agent; `status: "building"` → `build` agent; intake kind → intake agent regardless.

**Step 2:** Run — FAIL.

**Step 3:** Extend `resolveSessionAgentForKind` to take `status`:

```ts
export function resolveSessionAgentForKind(
  kind: string,
  status: string | undefined,
  loadedAgents: AgentDefinition[],
  perSessionOverride?: string,
): { agent: AgentDefinition } {
  let name: string;
  if (perSessionOverride) {
    name = perSessionOverride;
  } else if (kind === "intake") {
    name = "intake";
  } else if (status === "planning") {
    name = "plan";
  } else {
    name = DEFAULT_AGENT_NAME; // "build" covers building/review/merged
  }
  return { agent: resolveAgentByName(name, loadedAgents) };
}
```

**Step 4:** Update all callers of `resolveSessionAgentForKind` (trace via `trace_path` inbound) to pass the session's `status`. The main caller is the WS runner (`apps/server/src/agent/ws-handler.ts`).

**Step 5:** Run tests — PASS. Commit: `feat(server): resolve task agent by status (planning→plan, building→build)`.

---

## Phase 4 — Server `ask` wiring & confirm route

### Task 4.1: Build the `ask-kinds` wiring table

**Files:** Create `apps/server/src/agent/config/ask-kinds.ts`, `apps/server/src/agent/config/__tests__/ask-kinds.test.ts`

**Step 1:** Define the wiring. This module owns the consequence of each `kind` — **status transitions only**; compaction is added in Phase 5. Each handler is a pure function of `(ctx, session) => Promise<session>`.

```ts
export type AskAction = "approve" | "reject";

export interface AskKindHandlers {
  onApprove: (sessionId: string, body: string, ctx: AskCtx) => Promise<void>;
  onReject?: (sessionId: string, ctx: AskCtx) => Promise<void>;
  card: "proposed-session" | "proposed-plan" | "proposed-completion";
}

export const ASK_KINDS: Record<string, AskKindHandlers> = {
  session: {
    card: "proposed-session",
    // Task creation happens desktop-side via createSession (existing flow);
    // onApprove here is a no-op (the card's Create button calls the REST
    // session-create directly, as OnboardingPanel does today).
    onApprove: async () => {},
  },
  plan: {
    card: "proposed-plan",
    onApprove: async (id, _body, ctx) => {
      await ctx.repos.sessions.update(id, { status: "building" });
      // Phase 5 inserts the forced compaction/observe here.
    },
    onReject: async () => {},
  },
  completion: {
    card: "proposed-completion",
    onApprove: async (id, _body, ctx) => {
      await ctx.repos.sessions.update(id, { status: "merged" });
    },
    onReject: async (id, _body, ctx) => {
      await ctx.repos.sessions.update(id, { status: "building" });
    },
  },
};
```

**Step 2:** Test the table — for each kind, action → expected status. Mock `ctx.repos.sessions.update`.

**Step 3:** Run — PASS. Commit: `feat(server): ask-kinds wiring table`.

### Task 4.2: `POST /sessions/:id/confirm` route

**Files:** Create `apps/server/src/routes/sessions/confirm.ts`; modify `apps/server/src/routes/sessions/sessions.ts` to chain it.

**Step 1:** Write failing route test (`confirm.test.ts`) — POST `{ action: "approve" }` with a pending plan → session status becomes `building`; `{ action: "reject" }` for completion → `building`.

**Step 2:** Create the route sub-app (mirror `compaction.ts`'s structure — `factory.createApp()` or `new Hono().basePath()`):

```ts
export const confirmRoutes = new Hono().post("/:id/confirm", async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param("id");
  const { action, kind, body } = await c.req.json();
  const handlers = ASK_KINDS[kind];
  if (!handlers) return c.json({ error: "Unknown ask kind" }, 400);
  if (action === "approve") await handlers.onApprove(id, body, ctx);
  else if (action === "reject" && handlers.onReject) await handlers.onReject(id, body, ctx);
  const updated = ctx.repos.sessions.findById(id);
  return c.json(updated);
});
```

**Step 3:** Chain into the sessions composition in `sessions.ts` (follow how `compaction.ts`/`forking.ts` are composed — search for `.route(` in the sessions app builder).

**Step 4:** Run — PASS. Commit: `feat(server): POST /sessions/:id/confirm route`.

### Task 4.3: Desktop action for confirm

**Files:** `apps/desktop/src/stores/server/actions.ts`

**Step 1:** Add `confirmAsk(sessionId, kind, body, action)` calling the new RPC route (use `hcWithType` client; the route type flows from the App type).

**Step 2:** Test via existing actions test pattern.

**Step 3:** Commit: `feat(desktop): confirmAsk action`.

---

## Phase 5 — Forced compaction/observe on plan→build

### Task 5.1: Add public `forceObserve()` to the OM engine

**Files:** `packages/agent/src/memory/observational-memory/engine.ts`

**Step 1:** Write failing test — `forceObserve()` runs an observation cycle regardless of threshold (mirrors the existing `forceReflect` test at `__tests__/engine.test.ts`).

**Step 2:** Add the public method next to `forceReflect` (line 264). It loads entries and calls the existing private `runSyncObserve`:

```ts
async forceObserve(): Promise<ObservationalMemoryRecord> {
  const record = await this.getOrCreateRecord();
  const entries = await this.loadUnobservedMessageEntries(record);
  if (entries.length === 0) return record;
  const result = await this.runSyncObserve(record, entries);
  await this.pruneObservedMessages(result);
  this.emitOmStatus(result);
  return result;
}
```

**Step 3:** Run — PASS. Commit: `feat(agent): public ObservationalMemoryEngine.forceObserve()`.

### Task 5.2: Wire forced reset into the `plan` approve handler

**Files:** `apps/server/src/agent/config/ask-kinds.ts` (the `plan.onApprove`); `apps/server/src/agent/ws-handler.ts` or a helper for building compaction deps.

**Step 1:** In `plan.onApprove`, after `setStatus("building")`, branch on OM:

```ts
onApprove: async (id, body, ctx) => {
  await ctx.repos.sessions.update(id, { status: "building" });
  const session = await ctx.repos.sessions.findById(id);
  const omConfig = resolveOmConfig(ctx, session!);
  if (omConfig) {
    await ctx.forceObserve(id);       // Phase 5.3: thread the engine instance
  } else {
    await ctx.forceCompaction(id);    // Phase 5.3
  }
  // Preserve the approved plan body as a pinned lead for the build agent:
  await ctx.repos.sessionEntries.insertSystemNote(id, `Approved plan:\n\n${body}`);
},
```

**Step 2:** Expose `forceCompaction(sessionId)` and `forceObserve(sessionId)` on the server context. `forceCompaction` builds `RunCompactionDeps` (model/apiKey/session/settings — see how `handleCompactCommand` in `ws-handler.ts:294` builds them) and calls `runAutoCompaction(deps)` directly. `forceObserve` constructs the `ObservationalMemoryEngine` (as the WS runner does) and calls `forceObserve()`.

**Step 3:** Test: plan approve with OM off → `runAutoCompaction` invoked; OM on → `forceObserve` invoked. Mock both.

**Step 4:** Run — PASS. Commit: `feat(server): force compaction/observe on plan→build approval`.

---

## Phase 6 — Desktop WS dispatch & store generalization

### Task 6.1: Generalize `ProposedSession` → `PendingAsk`

**Files:** `apps/desktop/src/stores/session/session-store.ts:16-19,508-514,53`

**Step 1:** Replace:

```ts
export interface PendingAsk {
  kind: "session" | "plan" | "completion";
  body: string;
}
```

Rename the store field `proposedSession` → `pendingAsk`, the actions `setProposedSession`/`clearProposedSession` → `setPendingAsk`/`clearPendingAsk`. Update `SessionStoreData` (line 53) and `SessionActions` (lines 69, 92).

**Step 2:** Update all references (trace inbound for `setProposedSession`, `proposedSession`): `tool-events.ts`, `onboarding-panel.tsx`, `session-store` tests.

**Step 3:** Run `vp check` + tests. Commit: `refactor(desktop): ProposedSession → PendingAsk`.

### Task 6.2: Dispatch `ask` by kind in the WS handler

**Files:** `apps/desktop/src/stores/session/handlers/tool-events.ts:11-19`

**Step 1:** Replace the `propose_session` branch:

```ts
if (event.toolName === "ask") {
  const args = event.args as { kind?: unknown; body?: unknown };
  if (typeof args.body === "string") {
    const kind = typeof args.kind === "string" ? args.kind : undefined;
    // Only wire known gate kinds; open questions stay in the transcript.
    if (kind === "session" || kind === "plan" || kind === "completion") {
      ctx.actions.setPendingAsk({ kind, body: args.body });
    }
  }
}
```

**Step 2:** Update `tool-events` tests (replace `propose_session` fixtures with `ask`).

**Step 3:** Run — PASS. Commit: `feat(desktop): dispatch ask tool-call by kind`.

---

## Phase 7 — Desktop ask cards

### Task 7.1: Generalize the card → `AskCard`

**Files:** `apps/desktop/src/components/chat-area/parts/proposed-session-card.tsx` → rename to `ask-card.tsx`

**Step 1:** Generalize props to `{ kind, body, onApprove, onReject }` and vary the title/button labels by kind:

```ts
const COPY = {
  session: { title: "Proposed Session", approve: "Create", reject: "Revise" },
  plan: { title: "Proposed Plan", approve: "Approve", reject: "Revise" },
  completion: { title: "Ready for Review", approve: "Merge", reject: "Request changes" },
} as const;
```

**Step 2:** Update test (`proposed-session-card` test → `ask-card` test) covering all three kinds.

**Step 3:** Commit: `refactor(desktop): ProposedSessionCard → AskCard (kind-driven)`.

### Task 7.2: Wire the session card in `OnboardingPanel`

**Files:** `apps/desktop/src/components/onboarding/onboarding-panel.tsx:14-81`

**Step 1:** `handleConfirmSession` already does create→clear→setTab→sendPrompt (the `kind=session` flow is unchanged client-side; the task is born in `planning`). Swap `ProposedSessionCard` for `AskCard kind="session"` reading `pendingAsk`.

**Step 2:** Update `onboarding-panel.test.tsx`.

**Step 3:** Commit: `feat(desktop): intake uses AskCard (kind=session)`.

### Task 7.3: Mount plan & completion cards in `TaskChatView`

**Files:** `apps/desktop/src/components/chat-area/task-chat-view.tsx:10-27`

**Step 1:** Read `pendingAsk` from the task's session store. Render `AskCard` with the appropriate kind, wired to `actions.confirmAsk(sessionId, kind, body, action)`:

```tsx
<Show when={session()?.store.pendingAsk}>
  {(ask) => (
    <AskCard
      kind={ask().kind}
      body={ask().body}
      onApprove={() => actions.confirmAsk(sessionId, ask().kind, ask().body, "approve")}
      onReject={() => actions.confirmAsk(sessionId, ask().kind, ask().body, "reject")}
    />
  )}
</Show>
```

**Step 2:** Test: a task store with `pendingAsk={kind:"plan"}` renders Approve/Revise; clicking Approve calls `confirmAsk` with `action:"approve"`.

**Step 3:** Commit: `feat(desktop): plan/completion AskCards in TaskChatView`.

---

## Phase 8 — Sidebar redesign

### Task 8.1: Read active project from the tab store

**Files:** `apps/desktop/src/components/layout/sidebar/sidebar.tsx`

**Step 1:** Replace the project-tree data source. The active project is `activeTab()` from `tab-store.ts`. Add a memo `activeProjectId = () => activeTab()?.projectId ?? null`.

**Step 2:** Tasks = `server.store.sessionOrder.map(...).filter(s => s.projectId === activeProjectId() && s.kind === "task")` sorted by `updatedAt desc`.

**Step 3:** Commit (intermediate, after the rewrite lands in 8.2).

### Task 8.2: Rewrite `sidebar.tsx` — tasks list + active/archived split

**Files:** Modify `apps/desktop/src/components/layout/sidebar/sidebar.tsx`; create `apps/desktop/src/components/layout/sidebar/task-row.tsx`, `archived-accordion.tsx`; delete `project-group.tsx`, `project-context-menu.tsx`, `add-project-input.tsx`, `memory-sidebar-card.tsx`, `om-progress-bars.tsx`; rewrite `session-item.tsx` → remove (replaced by `task-row.tsx`).

**Step 1:** Write `task-row.test.tsx` — asserts: 2-line layout (title+time, dot+pill), status pill text, active left-bar when active, kebab always rendered.

**Step 2:** Implement `task-row.tsx`:

```tsx
export function TaskRow(props: {
  isActive: boolean;
  onClick: () => void;
  status: SessionMeta["status"];
  streamingPhase: StreamState["phase"];
  title: string | null;
  updatedAt: number;
}) {
  /* 2-line row: title+time over dot+pill+kebab */
}
```

- Status pill colors via a `STATUS_CLASS` map: planning→muted, building→blue, review→amber, merged→green.
- Activity dot derived from `streamingPhase`: working→green pulse, error→red, idle→dim.
- Kebab `FiMoreVertical` always visible, `text-muted-foreground hover:text-foreground`; dropdown (reuse `ProjectContextMenu`'s fixed-position pattern) with Rename + Delete.

**Step 3:** Write `archived-accordion.test.tsx` — asserts the `MemorySidebarCard`-style accordion: collapsed by default, chevron rotates, border-t on header, count badge, expands to reveal merged rows.

**Step 4:** Implement `archived-accordion.tsx` — reuse the exact toggle pattern from the deleted `memory-sidebar-card.tsx` (chevron + `FiArchive` + "Archived" + count). `border-t border-border` on the header button.

**Step 5:** Rewrite `sidebar.tsx`:

```tsx
export default function Sidebar() {
  const { server, sessions } = useStore();
  const activeProjectId = () => activeTab()?.projectId ?? null;
  const tasks = createMemo(() => /* filter+sort as in 8.1 */);
  const activeTasks = () => tasks().filter(t => t.status !== "merged");
  const archivedTasks = () => tasks().filter(t => t.status === "merged");
  // keep Cmd+B toggle, mobile backdrop
  return (
    <aside ...>
      <Header label="TASKS" onAdd={() => activeProjectId() && actions.upsertIntakeSession(activeProjectId())} />
      <Separator />
      <ScrollArea class="flex-1">
        <For each={activeTasks()}>{t => <TaskRow ... />}</For>
        <ArchivedAccordion tasks={archivedTasks()} onSelect={...} />
      </ScrollArea>
      <Footer />
    </aside>
  );
}
```

Remove: `expandedProjects`, `showAddInput`, `contextMenu`, the `<For each={projectOrder}>` tree, `<ProjectContextMenu>`, `<AddProjectInput>`, `<MemorySidebarCard>`, the active-project auto-expand effect.

**Step 6:** Update `sidebar` tests + any `timeline-renderer`/layout tests that referenced the old structure. Delete now-dead test files for deleted components.

**Step 7:** Run `vp check` + `vp run desktop#test`. Commit: `feat(desktop): redesign sidebar — tasks for active project, status pills, archived accordion`.

### Task 8.3: Delete dead sidebar files & confirm no dangling refs

**Files:** delete the five files listed in 8.2.

**Step 1:** Delete. Grep for any remaining imports (`ProjectGroup`, `ProjectContextMenu`, `AddProjectInput`, `MemorySidebarCard`, `OmProgressBars`, `SessionItem`).

**Step 2:** `vp check` must be clean. Commit: `chore(desktop): remove dead sidebar project/memory components`.

---

## Phase 9 — End-to-end verification

### Task 9.1: Full workspace check

**Step 1:** `vp check` — format + lint + typecheck, 0 errors.
**Step 2:** `vp run -r test` — all green except the known pre-existing `apps/server compaction.test.ts` failure (falsified at `55898ccc`; unrelated).
**Step 3:** Manual smoke (or document the path): intake → `ask(session)` → task born in `planning` → plan agent produces plan → `ask(plan)` → Approve → status `building` + compaction fires → build agent → `ask(completion)` → status `review` → Merge → `merged` → task moves to Archived accordion.

**Step 4:** Commit any fixups. Final commit: `chore: SDD task lifecycle — end-to-end verification`.

---

## Execution order & dependencies

```
Phase 1 (db status) ──┐
                      ├─▶ Phase 3 (prompts/resolver) ─▶ Phase 4 (wiring/confirm) ─▶ Phase 5 (force compact)
Phase 2 (ask tool) ───┘                                          │
                                                                 ▼
                                          Phase 6 (desktop store) ─▶ Phase 7 (cards) ─▶ Phase 8 (sidebar) ─▶ Phase 9
```

- Phases 1 & 2 are independent foundations; do 1 first (status is referenced everywhere).
- Phase 3 depends on 1 (status) + 2 (ask tool name).
- Phase 4 depends on 3.
- Phase 5 depends on 4.
- Phases 6→7→8 are the desktop chain, depending on 4 (confirm route) for the actions.
- Each task is independently committable.
