# Homepage & Task Session Workflow Implementation Plan (Codebase-Aligned v2)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current session-first workspace UX with a task-first workflow that starts on a homepage, supports research/spec selection, and runs multiple task sessions in parallel.

**Architecture:**

- Server: migrate the primary conversation table from `sessions` to `task_sessions` and expose task-session APIs (`/api/task-sessions`, `/api/project-keypoints`) on the existing Hono server.
- Desktop: split workspace UI into two views: Homepage (task creation + progress) and Task Session (existing 3-panel chat layout).
- Integration: reuse current chat/spec infrastructure (session bridge, SessionManager, wizard actions, SSE bus) but map it to task-session semantics with a **hard cut** (no temporary compatibility layer). Runtime behavior is controlled only by `runtimeMode`.

**Tech Stack:** SolidJS, TypeScript, Hono, Drizzle ORM (SQLite/libsql), Vitest, @corvu/resizable, existing session/chat pipeline.

---

## Scope and Non-Goals

### In Scope

- Rename DB table `sessions` -> `task_sessions`
- Add task-session workflow fields (`status`, `spec_type`, `last_activity_at`)
- Add `project_keypoints` table and endpoints
- Replace desktop workspace entry UX with homepage-first view
- Add homepage components and task list UX
- Add task-session API/client/provider plumbing
- Expand `runtimeMode` to `intake | plan | build` and use it as the only behavior gate for tool/model policies
- Add `session_kind` (`intake` | `task`) to `task_sessions` for explicit list filtering and copy-drop isolation
- Rename memory-task API route from `/api/tasks` to `/api/agent-tasks` to avoid ambiguity with task sessions
- Keep append-only migration policy compliance

### Out of Scope (for this plan)

- Full rename of all internal Core `SessionManager` classes/types in `packages/core`
- Re-architecting memory-task storage (`tasks`, `task_dependencies`, `task_messages`)
- Replacing existing SSE transport protocol wholesale

---

## Critical Constraints (Current Codebase)

1. Server is Hono, not Express.

- Entry: `packages/server/src/index.ts`
- Existing route style: `app.route("/", router)`

2. DB is SQLite via Drizzle libsql.

- Schema path: `packages/server/db/schema.ts`
- Drizzle config: `packages/server/drizzle.config.ts` (`dialect: "sqlite"`)

3. Migration policy is append-only.

- Never modify/delete previous SQL/snapshot files
- Add only new migration SQL + new snapshot + journal update
- Reference: `scripts/check-server-migration-policy.mjs`

4. Desktop state is under `apps/desktop/src/core/state/*`, not `apps/desktop/src/state/*`.

5. Existing `/api/tasks` is used for memory tasks today; in this plan we hard-cut and rename it to `/api/agent-tasks`.

---

## Target Data Model

### task_sessions (renamed from sessions)

- `session_id` (keep column name initially to reduce blast radius)
- `resource_id`
- `thread_id`
- `parent_id`
- `workspace_id`
- `title`
- `summary`
- `share_url`
- `created_at`
- `last_accessed` (keep for compatibility during migration)
- `status` (`researching` | `specifying` | `implementing` | `completed` | `failed`)
- `spec_type` (`comprehensive` | `quick` | null)
- `session_kind` (`intake` | `task`)
- `last_activity_at`

### project_keypoints

- `id`
- `workspace_id`
- `task_session_id`
- `task_title`
- `milestone` (`started` | `completed`)
- `completed_at`
- `summary`
- `artifacts` (JSON text array)
- `created_at`

---

## API Contract (Target)

### Task Sessions

- `GET /api/task-sessions?workspaceId=<id>&kind=task` (default kind is `task`)
- `GET /api/task-sessions/latest?workspaceId=<id>&kind=task` (default kind is `task`)
- `GET /api/task-sessions/:taskSessionId`
- `POST /api/task-sessions`
- `PATCH /api/task-sessions/:taskSessionId`
- `DELETE /api/task-sessions/:taskSessionId`

### Keypoints

- `GET /api/project-keypoints?workspaceId=<id>`
- `POST /api/project-keypoints`

### Existing APIs to keep (with path rename)

- `/api/chat` and related session bridge flow
- `/api/agent-tasks` memory-task endpoints used by right panel

---

## Runtime Mode Contract (Single Source of Truth)

### Canonical runtime mode enum

- `runtimeMode: "intake" | "plan" | "build"`
- `intake`: homepage research and decisioning; read/research toolset only
- `plan`: task-session spec refinement and planning; spec/planning tools enabled; no general implementation writes
- `build`: implementation and delivery; full toolset

### Runtime mode transitions

- `intake -> plan` when user confirms spec creation from homepage decisions
- `plan -> build` when user approves implementation start
- `build -> plan` when user explicitly requests returning to planning
- no direct `intake -> build`
- no automatic transition to `intake` from `plan` or `build` in the same task session

### UI state vs runtime mode

- UI view state (`homepage` vs `task-session`) is derived from `activeTaskSessionId` and does not replace runtime mode.
- Runtime mode drives tool/model behavior and permission boundaries.
- `session_kind` drives list visibility:
  - homepage intake scratch sessions: `session_kind=intake`
  - user-visible task sessions: `session_kind=task`

---

## Phase 1: Database & Schema Migration

### Task 1: Add failing schema tests for task-session migration

**Files:**

- Create: `packages/server/db/__tests__/task-sessions-schema.test.ts`
- Modify: `packages/server/db/__tests__/index.test.ts`

**Step 1: Add test coverage for new table name and columns**

```ts
// packages/server/db/__tests__/task-sessions-schema.test.ts
import { describe, expect, it } from "vitest";

import { taskSessions } from "../../db/schema";

describe("task_sessions schema", () => {
  it("exposes renamed table export", () => {
    expect(taskSessions).toBeDefined();
    expect(taskSessions.session_id).toBeDefined();
  });

  it("includes workflow columns", () => {
    expect(taskSessions.status).toBeDefined();
    expect(taskSessions.spec_type).toBeDefined();
    expect(taskSessions.last_activity_at).toBeDefined();
  });
});
```

**Step 2: Run targeted test (expect FAIL before schema update)**

Run: `pnpm --filter @sakti-code/server test db/__tests__/task-sessions-schema.test.ts`
Expected: FAIL (missing export/columns)

**Step 3: Commit test-only change**

```bash
git add packages/server/db/__tests__/task-sessions-schema.test.ts packages/server/db/__tests__/index.test.ts
git commit -m "test(server): add failing schema tests for task_sessions migration"
```

---

### Task 2: Rename table export from sessions to taskSessions in schema

**Files:**

- Modify: `packages/server/db/schema.ts`

**Step 1: Rename table constant and table name**

```ts
// from
export const sessions = sqliteTable("sessions", { ... });

// to
export const taskSessions = sqliteTable("task_sessions", { ... });
```

**Step 2: Update FK references in same schema file**

```ts
.references(() => taskSessions.session_id, { onDelete: "cascade" })
```

Update all references in:

- `toolSessions`
- `events`
- any other local references to `sessions`

**Step 3: Run typecheck**

Run: `pnpm --filter @sakti-code/server typecheck`
Expected: PASS or finite errors to be fixed in next tasks.
Note: do not add compatibility alias exports; this plan is hard-cut.

**Step 4: Commit**

```bash
git add packages/server/db/schema.ts
git commit -m "refactor(server): rename sessions table export to taskSessions"
```

---

### Task 3: Add status/spec_type/session_kind/last_activity_at to task_sessions

**Files:**

- Modify: `packages/server/db/schema.ts`

**Step 1: Add workflow columns**

```ts
status: text("status").notNull().default("researching"),
spec_type: text("spec_type"),
session_kind: text("session_kind").notNull().default("task"),
last_activity_at: integer("last_activity_at", { mode: "timestamp" })
  .notNull()
  .default(sql`(unixepoch() * 1000)`),
```

Use `integer(..., { mode: "timestamp" })` to match current schema conventions.

**Step 2: Add indexes for list/sort/filter**

```ts
statusIndex: index("task_sessions_status_idx").on(table.status),
kindIndex: index("task_sessions_kind_idx").on(table.session_kind),
workspaceActivityIndex: index("task_sessions_workspace_activity_idx").on(
  table.workspace_id,
  table.last_activity_at
),
workspaceKindActivityIndex: index("task_sessions_workspace_kind_activity_idx").on(
  table.workspace_id,
  table.session_kind,
  table.last_activity_at
),
```

**Step 3: Update exported types if needed**

```ts
export type TaskSession = typeof taskSessions.$inferSelect;
export type NewTaskSession = typeof taskSessions.$inferInsert;
```

**Step 4: Run schema tests**

Run: `pnpm --filter @sakti-code/server test db/__tests__/task-sessions-schema.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/db/schema.ts
 git commit -m "feat(server): add task session workflow and session_kind columns"
```

---

### Task 4: Add project_keypoints table with milestone dedupe support

**Files:**

- Modify: `packages/server/db/schema.ts`
- Create: `packages/server/db/__tests__/project-keypoints-schema.test.ts`

**Step 1: Add table definition**

```ts
export const projectKeypoints = sqliteTable(
  "project_keypoints",
  {
    id: text("id").primaryKey(),
    workspace_id: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    task_session_id: text("task_session_id")
      .notNull()
      .references(() => taskSessions.session_id, { onDelete: "cascade" }),
    task_title: text("task_title").notNull(),
    milestone: text("milestone").notNull(), // started | completed
    completed_at: integer("completed_at", { mode: "timestamp" }).notNull(),
    summary: text("summary").notNull(),
    artifacts: text("artifacts", { mode: "json" }).$type<string[]>().notNull(),
    created_at: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  table => ({
    workspaceCompletedIdx: index("project_keypoints_workspace_completed_idx").on(
      table.workspace_id,
      table.completed_at
    ),
    taskMilestoneIdx: index("project_keypoints_task_milestone_idx").on(
      table.task_session_id,
      table.milestone
    ),
  })
);
```

**Step 2: Add test**

```ts
// packages/server/db/__tests__/project-keypoints-schema.test.ts
import { describe, expect, it } from "vitest";
import { projectKeypoints } from "../../db/schema";

describe("project_keypoints schema", () => {
  it("has expected columns", () => {
    expect(projectKeypoints.id).toBeDefined();
    expect(projectKeypoints.workspace_id).toBeDefined();
    expect(projectKeypoints.task_session_id).toBeDefined();
    expect(projectKeypoints.milestone).toBeDefined();
    expect(projectKeypoints.artifacts).toBeDefined();
  });
});
```

**Step 3: Run targeted tests**

Run: `pnpm --filter @sakti-code/server test db/__tests__/project-keypoints-schema.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/server/db/schema.ts packages/server/db/__tests__/project-keypoints-schema.test.ts
git commit -m "feat(server): add project_keypoints schema"
```

---

### Task 5: Generate append-only migration and verify migration policy

**Files:**

- Add: `packages/server/drizzle/<new>_*.sql`
- Add: `packages/server/drizzle/meta/<new>_snapshot.json`
- Modify: `packages/server/drizzle/meta/_journal.json`

**Step 1: Generate migration**

Run: `pnpm --filter @sakti-code/server drizzle:generate`
Expected: New SQL + snapshot created

**Step 2: Review SQL for table rename correctness**

Ensure migration contains one of:

- explicit `ALTER TABLE sessions RENAME TO task_sessions;`
- or valid Drizzle-generated equivalent with data-preserving table rebuild

If generated SQL is destructive/unwanted, edit only the new migration file (do not touch previous files).

No data backfill requirements:

- app is pre-launch
- do not add bespoke status/spec_type backfill logic for historical rows
- rely on defaults for any copied rows

**Step 3: Run migrations locally**

Run: `pnpm --filter @sakti-code/server drizzle:migrate`
Expected: PASS

**Step 4: Run migration policy check test**

Run: `pnpm --filter @sakti-code/server test db/__tests__/migration-policy.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/drizzle/ packages/server/drizzle/meta/
git commit -m "chore(server): add task_sessions + keypoints migration"
```

---

## Phase 2: Server Data Access & Route Layer

### Task 6: Introduce canonical `db/task-sessions.ts` (hard cut)

**Files:**

- Create: `packages/server/db/task-sessions.ts`
- Delete: `packages/server/db/sessions.ts`
- Modify: `packages/server/db/index.ts`
- Test: `packages/server/db/__tests__/task-sessions.test.ts`

**Step 1: Create canonical task-session DB module**

```ts
// packages/server/db/task-sessions.ts
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db, taskSessions, threads } from "./index";

export type TaskSessionStatus =
  | "researching"
  | "specifying"
  | "implementing"
  | "completed"
  | "failed";

export interface TaskSessionRecord {
  taskSessionId: string;
  resourceId: string;
  threadId: string;
  workspaceId: string | null;
  title: string | null;
  status: TaskSessionStatus;
  specType: "comprehensive" | "quick" | null;
  sessionKind: "intake" | "task";
  createdAt: Date;
  lastAccessed: Date;
  lastActivityAt: Date;
}
```

Implement equivalents of current CRUD (`createTaskSession`, `getTaskSession`, `deleteTaskSession`, etc).

**Step 2: Update imports at call sites to use `db/task-sessions.ts` directly**

- Update all server modules importing `../../db/sessions` to import from `../../db/task-sessions`.
- Keep function semantics unchanged while renaming symbols to task-session terminology.

**Step 3: Add tests for new module**

Create `task-sessions.test.ts` mirroring old `sessions.test.ts` behavior plus status/spec assertions.

**Step 4: Run tests**

Run: `pnpm --filter @sakti-code/server test db/__tests__/task-sessions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/db/task-sessions.ts packages/server/db/index.ts packages/server/db/__tests__/task-sessions.test.ts packages/server/src/
git rm packages/server/db/sessions.ts
git commit -m "refactor(server): hard-cut to task-sessions db module"
```

---

### Task 7: Update session bridge and runtime adapter to taskSessions storage

**Files:**

- Modify: `packages/server/src/middleware/session-bridge.ts`
- Modify: `packages/server/src/runtime.ts`
- Modify: `packages/server/src/index.ts` (`Env` type import path if needed)
- Test: `packages/server/src/middleware/__tests__/session-bridge.test.ts`

**Step 1: Update bridge imports and function calls**

```ts
import {
  createTaskSession,
  createTaskSessionWithId,
  getTaskSession,
  touchTaskSession,
} from "../../db/task-sessions";
```

Use only `X-Task-Session-ID` for the hard cut:

- reject requests that pass legacy `X-Session-ID` only
- return `X-Task-Session-ID` in response headers/events
- update CORS allowed headers accordingly
- when auto-creating session rows via `/api/chat`, set `session_kind` based on incoming/runtime mode:
  - `runtimeMode=intake` => `session_kind=intake`
  - `runtimeMode=plan|build` => `session_kind=task`

**Step 2: Update runtime adapter table mapping**

```ts
import { db, taskSessions } from "../db";

if (table === "sessions") {
  await db.insert(taskSessions).values(values as any);
}
```

Preserve `query.sessions` adapter shape because Core `SessionManager` still expects it.

**Step 3: Expand middleware tests**

- verifies UUID validation still enforced
- verifies legacy header-only requests are rejected
- verifies create/reuse behavior unchanged

**Step 4: Run tests**

Run: `pnpm --filter @sakti-code/server test src/middleware/__tests__/session-bridge.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/middleware/session-bridge.ts packages/server/src/runtime.ts packages/server/src/middleware/__tests__/session-bridge.test.ts
git commit -m "refactor(server): route session bridge through task-sessions storage"
```

---

### Task 7A: Expand core runtime mode to `intake | plan | build`

**Files:**

- Modify: `packages/core/src/spec/helpers.ts`
- Modify: `packages/core/src/session/mode-transition.ts`
- Modify: `packages/core/src/tools/phase-tools.ts`
- Modify: `packages/core/src/session/controller.ts`
- Modify: `packages/core/src/tools/task.ts`
- Modify: `packages/core/src/session/__tests__/mode-transition.integration.test.ts`
- Modify: `packages/core/src/tools/__tests__/phase-tools.test.ts`

**Step 1: Expand runtime mode type**

- Update `RuntimeMode` in `spec/helpers.ts` to:
  - `"intake" | "plan" | "build"`
- Update mode parsing helper to accept `intake`.

**Step 2: Update transition rules**

- In `mode-transition.ts`, allow:
  - `intake->plan`
  - `plan->build`
  - `build->plan`
- Keep disallowed:
  - direct `intake->build`
  - automatic `plan/build->intake`

**Step 3: Set session default runtime mode to `intake`**

- In `SessionController.processMessage`, change fallback from `"build"` to `"intake"` when no persisted mode exists.
- Ensure existing task-session flows explicitly transition to `plan` after spec creation.

**Step 4: Tool gating by runtime mode**

- In `phase-tools.ts`, add an explicit `intake` toolset constant.
- `intake` must be read/research oriented and exclude implementation-write tools.
- Preserve existing `build` full-write toolset.

**Step 5: Subagent policy**

- In `tools/task.ts`, enforce conservative subagent spawning in `intake`:
  - allow `explore`
  - reject direct `plan` and `general` unless runtime transitions to `plan`

**Step 6: Tests**

- Update mode-transition integration tests for new valid/invalid transitions.
- Update phase-tools tests to assert `intake` gating.

**Step 7: Run tests**

Run: `pnpm --filter @sakti-code/core test src/session/__tests__/mode-transition.integration.test.ts src/tools/__tests__/phase-tools.test.ts`
Expected: PASS

**Step 8: Commit**

```bash
git add packages/core/src/spec/helpers.ts packages/core/src/session/mode-transition.ts packages/core/src/tools/phase-tools.ts packages/core/src/session/controller.ts packages/core/src/tools/task.ts packages/core/src/session/__tests__/mode-transition.integration.test.ts packages/core/src/tools/__tests__/phase-tools.test.ts
git commit -m "feat(core): add runtimeMode intake and enforce runtime-gated tools"
```

---

### Task 8: Add task-session routes and remove sessions route in same PR

**Files:**

- Create: `packages/server/src/routes/task-sessions.ts`
- Delete: `packages/server/src/routes/sessions.ts`
- Modify: `packages/server/src/index.ts`
- Create: `packages/server/src/routes/__tests__/task-sessions.test.ts`

**Step 1: Implement canonical route file**

```ts
// packages/server/src/routes/task-sessions.ts
import { Hono } from "hono";
import {
  createTaskSession,
  deleteTaskSession,
  getLatestTaskSessionByWorkspace,
  getTaskSession,
  listTaskSessions,
  updateTaskSession,
} from "../../db/task-sessions";

const app = new Hono<Env>();

app.get("/api/task-sessions", ...);
app.get("/api/task-sessions/latest", ...);
app.get("/api/task-sessions/:taskSessionId", ...);
app.post("/api/task-sessions", ...);
app.patch("/api/task-sessions/:taskSessionId", ...);
app.delete("/api/task-sessions/:taskSessionId", ...);
```

Serialize fields in camelCase for desktop client.

- list/latest endpoints must filter to `session_kind=task` by default (no intake scratch rows in task list/home cards).

**Step 2: Remove `/api/sessions` route immediately**

- delete route registration and file
- update any callers/tests to `/api/task-sessions`

**Step 3: Mount new route in server index**

```ts
import taskSessionsRouter from "./routes/task-sessions";
app.route("/", taskSessionsRouter);
```

**Step 4: Add route tests**

Use existing Hono style (`app.request`) with auth header, similar to existing tests.

**Step 5: Run tests**

Run: `pnpm --filter @sakti-code/server test src/routes/__tests__/task-sessions.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/server/src/routes/task-sessions.ts packages/server/src/index.ts packages/server/src/routes/__tests__/task-sessions.test.ts
git rm packages/server/src/routes/sessions.ts
git commit -m "feat(server): hard-cut to /api/task-sessions routes"
```

---

### Task 9: Add project keypoints API routes

**Files:**

- Create: `packages/server/src/routes/project-keypoints.ts`
- Modify: `packages/server/src/index.ts`
- Create: `packages/server/src/routes/__tests__/project-keypoints.test.ts`

**Step 1: Implement routes**

```ts
// GET /api/project-keypoints?workspaceId=...
// POST /api/project-keypoints
```

POST payload:

- `workspaceId` (required)
- `taskSessionId` (required)
- `taskTitle` (required)
- `milestone` (`started` | `completed`, required)
- `summary` (required)
- `artifacts` (optional string[])

Server dedupe rule:

- keep latest keypoint per (`taskSessionId`, `milestone`)
- on duplicate milestone writes, replace previous summary/artifacts/completedAt (latest wins)

**Step 2: Mount route**

```ts
import projectKeypointsRouter from "./routes/project-keypoints";
app.route("/", projectKeypointsRouter);
```

**Step 3: Add tests**

- create keypoint
- list by workspace
- validate required fields
- duplicate milestone write keeps only latest

**Step 4: Run tests**

Run: `pnpm --filter @sakti-code/server test src/routes/__tests__/project-keypoints.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/routes/project-keypoints.ts packages/server/src/index.ts packages/server/src/routes/__tests__/project-keypoints.test.ts
git commit -m "feat(server): add project keypoints API"
```

---

## Phase 3: Desktop API Client & State Refactor

### Task 10: Add task-session API methods in desktop client

**Files:**

- Modify: `apps/desktop/src/core/services/api/api-client.ts`
- Create: `apps/desktop/src/core/services/api/__tests__/api-client-task-sessions.test.ts`

**Step 1: Add types**

```ts
export interface TaskSessionInfo {
  taskSessionId: string;
  resourceId: string;
  threadId: string;
  workspaceId: string | null;
  title: string | null;
  status: "researching" | "specifying" | "implementing" | "completed" | "failed";
  specType: "comprehensive" | "quick" | null;
  sessionKind: "intake" | "task";
  createdAt: string;
  lastAccessed: string;
  lastActivityAt: string;
}
```

**Step 2: Add methods**

- `listTaskSessions(workspaceId?: string, kind: "task" | "intake" = "task")`
- `getTaskSession(taskSessionId: string)`
- `createTaskSession(payload)`
- `updateTaskSession(taskSessionId, patch)`
- `deleteTaskSession(taskSessionId)`
- `getLatestTaskSession(workspaceId: string)`

Use existing `commonHeaders()` auth pattern.

**Step 3: Remove legacy sessions client methods in same PR**

- delete `listSessions/getSession/deleteSession/getLatestSession` methods
- replace all call sites with task-session methods

**Step 4: Add tests**

- verifies endpoint URLs
- verifies auth headers
- verifies serialization

**Step 5: Run tests**

Run: `pnpm --filter @sakti-code/desktop test:unit`
Expected: PASS for client tests

**Step 6: Commit**

```bash
git add apps/desktop/src/core/services/api/api-client.ts apps/desktop/src/core/services/api/__tests__/api-client-task-sessions.test.ts
git commit -m "feat(desktop): add task-session API client methods"
```

---

### Task 11: Refactor WorkspaceProvider to task-session-first state

**Files:**

- Modify: `apps/desktop/src/core/state/providers/workspace-provider.tsx`
- Create: `apps/desktop/src/core/state/providers/__tests__/workspace-provider-task-sessions.test.tsx`

**Step 1: Rename context fields**

From:

- `sessions`
- `activeSessionId`
- `setActiveSessionId`
- `refreshSessions`

To:

- `taskSessions`
- `activeTaskSessionId`
- `setActiveTaskSessionId`
- `refreshTaskSessions`

**Step 2: Hard-cut rename of context contract**
No aliases in this plan. Rename context contract directly and update all call sites/tests in this phase.

**Step 3: Update provider logic to call task-session API methods**

- load via `client.listTaskSessions(params.id)`
- default filter `kind="task"` so intake scratch sessions are hidden
- no auto-select first task session (homepage view requires null active ID)

**Step 4: Add tests**

- initializes with empty taskSessions
- refresh uses task-session API
- does not auto-select first task session

**Step 5: Run tests**

Run: `pnpm --filter @sakti-code/desktop test:ui`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/desktop/src/core/state/providers/workspace-provider.tsx apps/desktop/src/core/state/providers/__tests__/workspace-provider-task-sessions.test.tsx
git commit -m "refactor(desktop): migrate workspace provider to task-session state"
```

---

### Task 12: Update chat + tasks hooks to consume activeTaskSessionId

**Files:**

- Modify: `apps/desktop/src/views/workspace-view/index.tsx`
- Modify: `apps/desktop/src/views/workspace-view/chat-area/chat-area.tsx`
- Modify: `apps/desktop/src/views/workspace-view/chat-area/input/use-chat-input.tsx`
- Modify: `apps/desktop/src/views/workspace-view/right-side/right-side.tsx`
- Modify: `apps/desktop/src/core/chat/hooks/use-tasks.ts`
- Test: `apps/desktop/src/core/chat/hooks/__tests__/use-tasks.test.ts`

**Step 1: Swap ctx accessors**

```ts
const { startListening } = useTasks(ctx.activeTaskSessionId);
```

**Step 2: Keep useTasks API signature unchanged (Accessor string|null)**

- no behavioral changes except caller IDs

**Step 3: Verify right-side task tab still works**

- loads memory tasks for active task session id from `/api/agent-tasks`

**Step 4: Run tests**

Run: `pnpm --filter @sakti-code/desktop test src/core/chat/hooks/__tests__/use-tasks.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/views/workspace-view/index.tsx apps/desktop/src/views/workspace-view/chat-area/chat-area.tsx apps/desktop/src/views/workspace-view/chat-area/input/use-chat-input.tsx apps/desktop/src/views/workspace-view/right-side/right-side.tsx apps/desktop/src/core/chat/hooks/use-tasks.ts apps/desktop/src/core/chat/hooks/__tests__/use-tasks.test.ts
git commit -m "refactor(desktop): wire hooks to activeTaskSessionId"
```

---

## Phase 4: New Task-First Homepage Components

### Task 13: Create `BigChatInput` component

**Files:**

- Create: `apps/desktop/src/components/big-chat-input/big-chat-input.tsx`
- Create: `apps/desktop/src/components/big-chat-input/__tests__/big-chat-input.test.tsx`

**Step 1: Implement component (Solid + Tailwind classes)**

Behavior:

- multiline textarea
- Enter sends, Shift+Enter newline
- auto-resize up to max height
- disabled state

**Step 2: Test component**

- renders placeholder
- sends via Enter
- ignores empty submit

**Step 3: Run test**

Run: `pnpm --filter @sakti-code/desktop test src/components/big-chat-input/__tests__/big-chat-input.test.tsx`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/desktop/src/components/big-chat-input/
git commit -m "feat(desktop): add BigChatInput component"
```

---

### Task 14: Create `WelcomePanel` component

**Files:**

- Create: `apps/desktop/src/components/welcome-panel/welcome-panel.tsx`
- Create: `apps/desktop/src/components/welcome-panel/__tests__/welcome-panel.test.tsx`

**Step 1: Implement component**

- welcome headline
- optional keypoint timeline cards
- relative time labels

**Step 2: Test**

- renders welcome message
- renders keypoints when provided
- hides progress section when empty

**Step 3: Run test**

Run: `pnpm --filter @sakti-code/desktop test src/components/welcome-panel/__tests__/welcome-panel.test.tsx`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/desktop/src/components/welcome-panel/
git commit -m "feat(desktop): add WelcomePanel component"
```

---

### Task 15: Create homepage `TaskCard` + `TaskList` components

**Files:**

- Create: `apps/desktop/src/components/task-card/task-card.tsx`
- Create: `apps/desktop/src/components/task-card/__tests__/task-card.test.tsx`
- Create: `apps/desktop/src/components/task-list/task-list.tsx`
- Create: `apps/desktop/src/components/task-list/__tests__/task-list.test.tsx`

**Step 1: Implement `TaskCard`**

- title
- status badge (researching/specifying/implementing/completed/failed)
- spec type chip
- last activity time
- active styling

**Step 2: Implement `TaskList`**

- search/filter input
- map task sessions from provider
- empty state
- onTaskSelect callback

**Step 3: Tests**

- card rendering/status
- list filtering
- click selects task

**Step 4: Run tests**

Run: `pnpm --filter @sakti-code/desktop test src/components/task-card/__tests__/task-card.test.tsx src/components/task-list/__tests__/task-list.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/components/task-card/ apps/desktop/src/components/task-list/
git commit -m "feat(desktop): add homepage task card/list components"
```

---

### Task 16: Create `TopToolbar` + `ResearchOutput` components

**Files:**

- Create: `apps/desktop/src/components/top-toolbar/top-toolbar.tsx`
- Create: `apps/desktop/src/components/top-toolbar/__tests__/top-toolbar.test.tsx`
- Create: `apps/desktop/src/components/research-output/research-output.tsx`
- Create: `apps/desktop/src/components/research-output/__tests__/research-output.test.tsx`

**Step 1: Implement `TopToolbar`**

- `view: "homepage" | "task-session"`
- home button only in task-session view
- task title and action menu area

**Step 2: Implement `ResearchOutput`**

- loading state
- summary text
- action buttons via existing `ActionButtonPart`

Important API correctness:

```tsx
<ActionButtonPart
  part={{ type: "action_buttons", buttons }}
  onAction={(action, button) => {
    // map wizard:start:comprehensive | wizard:start:quick
  }}
/>
```

Use `onAction` (not `onButtonClick`).

**Step 3: Tests**

- toolbar mode rendering
- research states + action buttons

**Step 4: Run tests**

Run: `pnpm --filter @sakti-code/desktop test src/components/top-toolbar/__tests__/top-toolbar.test.tsx src/components/research-output/__tests__/research-output.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/components/top-toolbar/ apps/desktop/src/components/research-output/
git commit -m "feat(desktop): add top toolbar and research output components"
```

---

## Phase 5: Homepage + Task Session View Composition

### Task 17: Create `HomepageView`

**Files:**

- Create: `apps/desktop/src/views/homepage-view/homepage-view.tsx`
- Create: `apps/desktop/src/views/homepage-view/__tests__/homepage-view.test.tsx`

**Step 1: Build 2-panel layout**

- left: new `TaskList`
- right: `TopToolbar(mode="homepage")`, `WelcomePanel`, `ResearchOutput`, `BigChatInput`
- use `@corvu/resizable`

**Step 2: Wire interactions**

- selecting task from list calls `onTaskSelect`
- input submit triggers research flow handler

**Step 3: Tests**

- renders task list and welcome panel
- renders input
- task select callback fires

**Step 4: Run tests**

Run: `pnpm --filter @sakti-code/desktop test src/views/homepage-view/__tests__/homepage-view.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/views/homepage-view/
git commit -m "feat(desktop): add homepage view"
```

---

### Task 18: Integrate homepage/task-session view switching in `WorkspaceView`

**Files:**

- Modify: `apps/desktop/src/views/workspace-view/index.tsx`
- Create: `apps/desktop/src/views/workspace-view/__tests__/mode-switching.test.tsx`

**Step 1: Add derived view state**

```ts
const isHomepageMode = createMemo(() => ctx.activeTaskSessionId() === null);
```

**Step 2: Homepage view rendering**

- render `HomepageView` when no active task session

**Step 3: Task-session view rendering**

- preserve existing 3-panel layout (`LeftSide`, `ChatArea`, `ContextPanel`)
- replace left side component usage with task-session aware variant

**Step 4: Home button behavior**

- `TopToolbar` home button sets `activeTaskSessionId(null)`

**Step 5: Add tests**

- homepage shown when no active task
- task-session shown when active id exists
- home button returns to homepage

**Step 6: Run tests**

Run: `pnpm --filter @sakti-code/desktop test src/views/workspace-view/__tests__/mode-switching.test.tsx`
Expected: PASS

**Step 7: Commit**

```bash
git add apps/desktop/src/views/workspace-view/index.tsx apps/desktop/src/views/workspace-view/__tests__/mode-switching.test.tsx
git commit -m "feat(desktop): add homepage/task-session view switching"
```

---

### Task 19: Refactor left panel from Session list to Task Session list

**Files:**

- Modify: `apps/desktop/src/views/workspace-view/left-side/left-side.tsx`
- Modify: `apps/desktop/src/views/workspace-view/left-side/session-list.tsx`
- Modify: `apps/desktop/src/views/workspace-view/left-side/session-card.tsx`
- Create: `apps/desktop/src/views/workspace-view/left-side/__tests__/task-session-list.test.tsx`

**Step 1: Rename UI labels and handlers**

- “Sessions” -> “Tasks”
- click sets active task session id

**Step 2: Update props/types**

- move from `BaseSession` shape to `TaskSessionSummary` shape

**Step 3: Keep animation/UX behavior from existing components**

- grouped sections optional; if grouping logic is session-centric, simplify to sorted list by `lastActivityAt`

**Step 4: Tests**

- renders tasks
- active state classes
- click action

**Step 5: Run tests**

Run: `pnpm --filter @sakti-code/desktop test src/views/workspace-view/left-side/__tests__/task-session-list.test.tsx`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/desktop/src/views/workspace-view/left-side/
git commit -m "refactor(desktop): convert left sidebar to task session list"
```

---

## Phase 6: Research and Spec Selection Flow

### Task 20: Make `/api/chat` runtimeMode-aware for homepage intake and rename memory-task route

**Files:**

- Modify: `packages/server/src/routes/chat.ts`
- Modify: `packages/server/src/routes/tasks.ts` (rename route paths to `/api/agent-tasks`)
- Modify: `packages/server/src/index.ts`
- Create: `packages/server/src/routes/__tests__/chat-runtime-mode.test.ts`

**Step 1: Extend `/api/chat` request schema with runtime mode input**

- Add optional `runtimeMode` field to chat payload:
  - `"intake" | "plan" | "build"`
- If omitted, fall back to persisted runtime mode; if none exists, default to `intake` (per Task 7A).

**Step 2: Persist runtime mode on chat entry when provided**

- On valid `runtimeMode` in request, persist with `updateSessionRuntimeMode(sessionId, runtimeMode)` before agent execution.
- Reject invalid mode values with `400`.

**Step 3: Keep homepage research flow on `/api/chat`**

- Do not add `/api/task-sessions/research-preview`.
- Homepage research summary + decision buttons must come from normal chat streaming parts/events.
- enforce strict decision actions only:
  - `wizard:start:comprehensive`
  - `wizard:start:quick`
- unknown action IDs are ignored and logged.

**Step 4: Rename memory-task route paths**

- hard-cut `/api/tasks` to `/api/agent-tasks`
- update route registration and route tests in same PR

**Step 4: Run tests**

Run: `pnpm --filter @sakti-code/server test src/routes/__tests__/chat-runtime-mode.test.ts src/routes/__tests__/tasks.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/routes/chat.ts packages/server/src/routes/tasks.ts packages/server/src/index.ts packages/server/src/routes/__tests__/chat-runtime-mode.test.ts packages/server/src/routes/__tests__/tasks.test.ts
git commit -m "feat(server): add runtimeMode-aware chat and hard-cut memory-task route rename"
```

---

### Task 21: Wire HomepageView research flow through `/api/chat` (copy-drop handoff)

**Files:**

- Modify: `apps/desktop/src/views/homepage-view/homepage-view.tsx`
- Modify: `apps/desktop/src/core/services/api/api-client.ts`
- Modify: `apps/desktop/src/core/chat/hooks/use-chat.ts`
- Test: `apps/desktop/src/views/homepage-view/__tests__/homepage-view.test.tsx`

**Step 1: Add API client methods**

- extend `chat(...)` options with `runtimeMode?: "intake" | "plan" | "build"`
- `createTaskSession(...)`

**Step 2: Homepage send handler flow**

1. send message to `/api/chat` with `runtimeMode: "intake"` (same chat endpoint)
2. render `ResearchOutput` from streamed assistant parts
3. keep active task session null until spec selection
4. on spec selection, create task session with copy-drop handoff:

- `status=specifying`
- `specType` from selected action
- trigger agent handoff request on `/api/chat` with selected action context
- require structured handoff output from agent (schema-validated), including:
  - `title`
  - `specType`
  - `initialSummary`
  - `handoffContext` (research + relevant history)
- create new task session from structured handoff output (not from heuristic client synthesis)
- copy required research context into new task-session bootstrap payload, then clear/discard intake-only scratch context after success

**Step 3: Map `ResearchOutput` actions to spec selection handler**

- action IDs from button `onAction`
- map to `specType`
- allow only strict action IDs; reject anything else

**Step 4: Test flow**

- send message -> shows loading
- receives summary -> shows action buttons
- action click triggers callback
- action click triggers structured handoff generation and schema validation
- invalid handoff shape blocks task creation and shows recoverable error

**Step 5: Run tests**

Run: `pnpm --filter @sakti-code/desktop test src/views/homepage-view/__tests__/homepage-view.test.tsx`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/desktop/src/views/homepage-view/homepage-view.tsx apps/desktop/src/core/services/api/api-client.ts apps/desktop/src/core/chat/hooks/use-chat.ts apps/desktop/src/views/homepage-view/__tests__/homepage-view.test.tsx
git commit -m "feat(desktop): wire homepage intake flow through runtimeMode-aware chat"
```

---

### Task 22: Integrate spec-type selection with existing wizard state

**Files:**

- Modify: `apps/desktop/src/core/chat/services/spec-wizard-controller.ts`
- Modify: `apps/desktop/src/core/state/stores/workflow-state-store.ts`
- Modify: `apps/desktop/src/views/homepage-view/homepage-view.tsx`
- Test: `apps/desktop/src/core/chat/services/__tests__/spec-wizard-controller.test.ts`

**Step 1: Add helper for initializing workflow state from homepage**

```ts
upsertWorkflowState({
  sessionId: taskSessionId,
  phase: specType === "quick" ? "tasks" : "requirements",
  specType,
  responses: [],
  updatedAt: Date.now(),
});
```

**Step 2: Update task session status after spec selection**

- `researching` -> `specifying`
- transition runtime mode `intake -> plan` via `transitionSessionMode`
- defensive guard: when opening any `session_kind=task` session, if persisted runtime mode is still `intake`, auto-transition to `plan` before enabling task-session tools

**Step 3: Activate selected task session**

- set `activeTaskSessionId(taskSessionId)` to transition into task-session view

**Step 4: Test controller integration**

- existing wizard actions still valid
- runtime transition and state transitions remain correct
- reopening a task session never leaves runtime mode in `intake`

**Step 5: Run tests**

Run: `pnpm --filter @sakti-code/desktop test src/core/chat/services/__tests__/spec-wizard-controller.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/desktop/src/core/chat/services/spec-wizard-controller.ts apps/desktop/src/core/state/stores/workflow-state-store.ts apps/desktop/src/views/homepage-view/homepage-view.tsx apps/desktop/src/core/chat/services/__tests__/spec-wizard-controller.test.ts
git commit -m "feat(desktop): connect homepage spec selection to wizard workflow"
```

---

### Task 23: Create project keypoints on completion milestones

**Files:**

- Modify: `apps/desktop/src/views/homepage-view/homepage-view.tsx`
- Modify: `apps/desktop/src/core/services/api/api-client.ts`
- Modify: `packages/server/src/routes/project-keypoints.ts`
- Test: desktop + server keypoint tests

**Step 1: Keypoint creation trigger**

- when workflow transitions to implementation start or completed
- create keypoint with milestone-specific narrative wording:
  - start milestone: `Started task "<title>" with <specType> spec after research: <summary>`
  - completion milestone: `Completed task "<title>": <completion summary>`
- include artifacts where available (spec files, key commits/files, generated docs)
- include explicit `milestone` field (`started` or `completed`) in payload
- enforce latest-wins write semantics per (`taskSessionId`, `milestone`)

**Step 2: Load keypoints on homepage mount**

- `GET /api/project-keypoints?workspaceId=...`
- feed into `WelcomePanel`

**Step 3: Tests**

- keypoint persisted via API
- homepage renders newly created keypoint
- repeated writes for same milestone show only latest keypoint text/artifacts

**Step 4: Run tests**

Run: `pnpm --filter @sakti-code/server test src/routes/__tests__/project-keypoints.test.ts`
Run: `pnpm --filter @sakti-code/desktop test src/views/homepage-view/__tests__/homepage-view.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/views/homepage-view/homepage-view.tsx apps/desktop/src/core/services/api/api-client.ts packages/server/src/routes/project-keypoints.ts packages/server/src/routes/__tests__/project-keypoints.test.ts
git commit -m "feat(workflow): persist project keypoints from task workflow"
```

---

## Phase 7: Event Contracts and Hard-Cut Cleanup

### Task 24: Add task-session SSE event type(s) (optional but recommended)

**Files:**

- Modify: `packages/server/src/bus/index.ts`
- Modify: `packages/shared/src/event-types.ts`
- Modify: `packages/shared/src/event-guards.ts`
- Modify: `apps/desktop/src/core/chat/domain/event-router-adapter.ts`
- Tests in server/shared/desktop

**Step 1: Define new event(s)**

- `task-session.updated`
- payload includes `taskSessionId`, status/spec metadata

**Step 2: Publish from task-session mutations**

- create/update/delete operations

**Step 3: Desktop event handling**

- update provider list without full refetch when possible

**Step 4: Tests**

- event type recognized in guards
- event routed in adapter

**Step 5: Run tests**

Run: `pnpm --filter @sakti-code/server test src/bus/__tests__/task-events.test.ts`
Run: `pnpm --filter @sakti-code/desktop test:unit`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/server/src/bus/index.ts packages/shared/src/event-types.ts packages/shared/src/event-guards.ts apps/desktop/src/core/chat/domain/event-router-adapter.ts
git commit -m "feat(events): add task-session update events"
```

---

### Task 25: Hard-cut validation and dead-code purge

**Files:**

- Modify: `packages/server/db/schema.ts`
- Modify: `apps/desktop/src/core/state/providers/workspace-provider.tsx`
- Modify: `apps/desktop/src/core/services/api/api-client.ts`
- Modify: any remaining `/api/sessions`, `/api/tasks`, `X-Session-ID`, and `activeSessionId` callers

**Step 1: Enforce hard-cut invariants**

- no `sessions` alias export in schema
- no `/api/sessions` route or client methods
- no `X-Session-ID` usage in desktop/server
- no `/api/tasks` usage for memory tasks (must be `/api/agent-tasks`)
- no `activeSessionId`/`setActiveSessionId`/`refreshSessions` in workspace provider contract

**Step 2: Grep for stragglers**

Run:

```bash
rg -n "\bsessions\b|/api/sessions|X-Session-ID|/api/tasks|activeSessionId|setActiveSessionId|refreshSessions" packages/server apps/desktop/src
```

Expected: no workflow-layer references remain (Core internals excluded).

**Step 3: Commit**

```bash
git add packages/server/db/schema.ts apps/desktop/src/core/state/providers/workspace-provider.tsx apps/desktop/src/core/services/api/api-client.ts packages/server/src/routes/
git commit -m "refactor: enforce hard-cut removal of legacy session contracts"
```

---

## Phase 8: End-to-End Verification

### Task 26: Add end-to-end homepage -> research -> spec -> task-session test

**Files:**

- Create: `apps/desktop/src/__tests__/e2e/homepage-task-session-workflow.test.tsx`

**Step 1: Add flow test with API mocking**

Scenarios:

1. Open workspace -> homepage visible
2. Submit prompt in big input
3. Research loading shown
4. Research preview summary + spec actions shown
5. Select spec action
6. Mode switches to task-session view
7. Home button returns to homepage
8. Keypoint visible
9. Task session remains in list

**Step 2: Run contract project tests**

Run: `pnpm --filter @sakti-code/desktop test:integration`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/desktop/src/__tests__/e2e/homepage-task-session-workflow.test.tsx
git commit -m "test(desktop): add e2e coverage for homepage to task-session workflow"
```

---

### Task 27: Full verification across repo

**Step 1: Server checks**

```bash
pnpm --filter @sakti-code/server typecheck
pnpm --filter @sakti-code/server lint
pnpm --filter @sakti-code/server test
```

Expected: PASS

**Step 2: Desktop checks**

```bash
pnpm --filter @sakti-code/desktop typecheck
pnpm --filter @sakti-code/desktop lint
pnpm --filter @sakti-code/desktop test:unit
pnpm --filter @sakti-code/desktop test:ui
pnpm --filter @sakti-code/desktop test:integration
```

Expected: PASS

**Step 3: Workspace-wide checks**

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Expected: PASS (or documented existing unrelated failures)

**Step 4: Commit final stabilization fixes**

```bash
git add .
git commit -m "chore: stabilize task-first workflow and pass full verification"
```

---

## Phase 9: Documentation and Cleanup

### Task 28: Update workflow documentation and developer guides

**Files:**

- Create: `docs/TASK_FIRST_WORKFLOW.md`
- Modify: `AGENTS.md`
- Modify: relevant docs under `docs/` and `.kiro/steering/` if needed

**Step 1: Document new runtime modes**

- `intake` (homepage research and decisioning)
- `plan` (task-session planning/spec refinement)
- `build` (task-session implementation)
- UI view state distinction: `homepage` vs `task-session` (view only, not runtime mode)
- `session_kind` distinction: intake scratch vs user-visible task sessions
- task-session statuses and transitions

**Step 2: Document API changes**

- `/api/task-sessions`
- `/api/project-keypoints`
- hard removal of `/api/sessions` in this PR
- memory-task route rename: `/api/tasks` -> `/api/agent-tasks`

**Step 3: Document migration caveats**

- append-only migration policy
- hard-cut migration (no compatibility layer)

**Step 4: Commit docs**

```bash
git add docs/ AGENTS.md .kiro/steering/
git commit -m "docs: describe task-first workflow architecture and APIs"
```

---

## Command Matrix (Quick Reference)

### Server

- `pnpm --filter @sakti-code/server drizzle:generate`
- `pnpm --filter @sakti-code/server drizzle:migrate`
- `pnpm --filter @sakti-code/server typecheck`
- `pnpm --filter @sakti-code/server test`

### Core

- `pnpm --filter @sakti-code/core typecheck`
- `pnpm --filter @sakti-code/core test src/session/__tests__/mode-transition.integration.test.ts`
- `pnpm --filter @sakti-code/core test src/tools/__tests__/phase-tools.test.ts`

### Desktop

- `pnpm --filter @sakti-code/desktop typecheck`
- `pnpm --filter @sakti-code/desktop test:unit`
- `pnpm --filter @sakti-code/desktop test:ui`
- `pnpm --filter @sakti-code/desktop test:integration`

### Repo-wide

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

---

## Risk Register

1. **Core SessionManager coupling**

- Risk: Core still expects `sessions` adapter semantics.
- Mitigation: keep adapter key names only at runtime boundary where required; no external compatibility aliases.

2. **Hard-cut blast radius**

- Risk: simultaneous removal of `/api/sessions`, `X-Session-ID`, and legacy provider fields causes broad compile/test breakage.
- Mitigation: perform one atomic migration branch with strict grep gates and staged verification after each phase.

3. **Migration correctness in SQLite**

- Risk: generated migration may not preserve rename intent.
- Mitigation: inspect new migration SQL; adjust only newly generated migration file if required.

4. **`/api/tasks` route collision**

- Risk: confusion with memory tasks vs task-session entities.
- Mitigation: rename memory-task endpoint to `/api/agent-tasks` and reserve `/api/task-sessions` for workflow entity.

5. **Mode switch regressions**

- Risk: chat rendering assumptions tied to non-null active session.
- Mitigation: introduce homepage view tests and guard conditions before chat provider render, plus runtime transition tests for `intake->plan->build`.

6. **Intake scratch leakage into task list**

- Risk: copy-drop intake rows appear as tasks and confuse navigation.
- Mitigation: `session_kind` filtering at DB/API/client layers; task list queries default to `kind=task`.

7. **Structured handoff contract drift**

- Risk: agent output shape changes and breaks task creation.
- Mitigation: strict schema validation for handoff payload + tests for invalid shape handling.

---

## Definition of Done

- `task_sessions` is the canonical server table for conversation/task-session records.
- Homepage view is default for workspace open when no active task session selected.
- User can chat from homepage in `runtimeMode=intake`, run research, choose spec type, request agent-structured handoff output, create task session with copy-drop handoff, and transition runtime `intake->plan`.
- Returning home preserves running task sessions and shows keypoints.
- Homepage is always the default workspace entry point (no auto-open latest task session).
- Runtime transitions `intake->plan->build` and `build->plan` are implemented and tested.
- Task list excludes intake scratch sessions via `session_kind=task`.
- Reopening any task session cannot remain in runtime `intake` (auto-fix to `plan`).
- Keypoints are deduplicated by milestone with latest-wins behavior.
- All relevant server/desktop tests and typechecks pass.
- Documentation reflects new workflow and API contracts.

---

## Summary

This v2 plan preserves the original functional intent (task-first workflow, homepage onboarding, parallel task execution) while aligning execution details with the real codebase:

- **Hono + SQLite + Drizzle** instead of Express/Postgres assumptions
- **Real file paths** under `packages/server/db`, `packages/server/src/routes`, and `apps/desktop/src/core/state`
- **Hard-cut replacement strategy** with strict grep/test gates
- **Comprehensive test-first task breakdown** with explicit commands and commit checkpoints

Total: 29 tasks across 9 phases.
