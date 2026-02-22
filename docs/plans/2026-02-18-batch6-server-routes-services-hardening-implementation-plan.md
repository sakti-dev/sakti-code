# Batch 6 Server Routes & Services Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all Batch 6 placeholder route behavior with reliable runtime-backed implementations, add comprehensive route/service/middleware integration tests, and eliminate identified edge-case gaps so the server behaves coherently as a system.

**Architecture:** This plan upgrades placeholder HTTP endpoints into functional integrations backed by existing core/runtime modules and server state stores. The implementation proceeds route-by-route using strict TDD, with explicit integration contracts between middleware, route handlers, provider/session/runtime services, and persistence layers. All behavior changes are guarded by targeted tests first, then validated by a full Batch 6 suite.

**Tech Stack:** TypeScript, Hono, Vitest, Zod, Drizzle, existing `@sakti-code/core` runtime/session/instance APIs, server bus/events/state modules.

---

## 0. Scope, Constraints, and Success Criteria

### 0.1 In-Scope Files (Batch 6)

- `packages/server/src/routes/*`
- `packages/server/src/services/*`
- `packages/server/src/middleware/*`
- Existing and new tests under:
- `packages/server/tests/routes/*`
- `packages/server/tests/middleware/*`
- `packages/server/src/routes/__tests__/*`
- `packages/server/src/services/__tests__/*`

### 0.2 Primary Placeholder Targets to Replace

- `packages/server/src/routes/command.ts`
- `packages/server/src/routes/mcp.ts`
- `packages/server/src/routes/vcs.ts`
- `packages/server/src/routes/project.ts`
- `packages/server/src/routes/diff.ts`
- `packages/server/src/routes/todo.ts`

### 0.3 Additional Hardening Targets (Already touched in prior pass)

- `packages/server/src/routes/files.ts`
- `packages/server/src/routes/workspace.ts`
- `packages/server/src/middleware/cache.ts`

### 0.4 Non-Goals

- No new frontend/UI work.
- No protocol redesign for existing stable routes.
- No large refactors of core agent internals outside what route integrations need.
- No speculative features beyond explicit endpoint contracts.

### 0.5 Success Criteria

- Every placeholder route returns meaningful runtime-backed data or explicit deterministic unsupported-state payloads with consistent schema.
- New tests cover success paths, validation errors, integration edge cases, and cross-route coherence.
- No regressions in existing Batch 6 tests.
- Full Batch 6 route/service/middleware suite passes.
- Contracts documented in tests and route comments.

---

## 1. High-Level Delivery Strategy

### 1.1 Delivery Principles

- Test-first for every behavior change.
- Implement minimal passing logic per failing test.
- Preserve existing API shape where possible.
- Prefer deterministic outputs over inferred/magic behavior.
- Use explicit input validation and stable error responses.
- Verify integration behavior against session/runtime state, not only isolated unit mocks.

### 1.2 Sequence

1. Establish baseline and route contracts.
2. Implement `project` + `vcs` (core workspace introspection foundation).
3. Implement `command` + `mcp` capability/status surfaces.
4. Implement `diff` + `todo` from session-backed data.
5. Expand integration tests for cross-route coherence.
6. Final hardening/refactor pass.
7. Full verification.

---

## 2. Architecture Decisions and Trade-Offs

### 2.1 Route Data Source Priorities

1. Request-scoped context (`sessionBridge` + `Instance` context).
2. Explicit query/header overrides where API allows.
3. Runtime/state stores (session message store, bus/db events).
4. Persistent fallback sources (checkpoint/session DB).

### 2.2 Error Semantics

- Validation failures: `400`.
- Missing resource/session: `404`.
- Unauthorized: keep existing auth middleware behavior (`401`).
- Unsupported capability for valid request: `200` with explicit capability flags (preferred) unless endpoint semantics demand failure.
- Internal failures: `500` with safe message.

### 2.3 Integration Consistency Rules

- If `/api/workspace` resolves a directory, `/api/project`, `/api/vcs`, `/api/mcp/status`, and `/api/lsp/status` should use the same resolution rules.
- `sessionId`-scoped routes (`/api/chat/:sessionId/*`) must not leak other sessions’ data.
- Placeholder endpoints replaced with deterministic schemas and test-asserted keys.

---

## 3. Target Route Contracts (Final Desired Behavior)

### 3.1 `GET /api/project`

- Inputs:
- `directory` query optional.
- fallback to `instanceContext.directory` when available.
- fallback to `process.cwd()` when no context.
- Output:
- `id`: deterministic project id (derived from root).
- `name`: project name from detected root.
- `path`: absolute project root path.
- `detectedBy`: enum of detection mechanism.
- `packageJson`: optional summary.
- Error:
- invalid directory input -> `400`.

### 3.2 `GET /api/projects`

- Output list of known/recent projects discoverable from current runtime/session context and safe local heuristics.
- Deterministic empty list only when truly no candidates.
- Include metadata (`id`, `name`, `path`, `source`, `lastSeen`).

### 3.3 `GET /api/vcs`

- Inputs: same directory resolution as project route.
- Output:
- `directory`
- `type` (`git` | `none`)
- `branch`
- `commit`
- `dirty` boolean
- `ahead`/`behind` optional if known
- `status` string summary
- If repo absent: explicit `type: "none"`, `status: "uninitialized"`.

### 3.4 `GET /api/commands`

- Return actual command catalog available to agent runtime.
- Include command metadata (`id`, `name`, `description`, `requiresApproval`, `category`, `enabled`).
- Include optional filters via query if present (`category`, `enabled`).

### 3.5 `GET /api/mcp/status`

- Inputs: resolved directory.
- Output:
- `directory`
- `servers`: list with `id`, `name`, `status`, `capabilities`, `latencyMs?`, `error?`
- `summary`: counts (`total`, `connected`, `degraded`, `offline`).

### 3.6 `GET /api/chat/:sessionId/diff`

- Inputs:
- `sessionId` path required.
- pagination query (`limit`, `offset`) optional.
- data source: session messages/events/checkpoint normalized history.
- Output:
- `sessionID`
- `diffs`: list of file changes with `path`, `changeType`, `before?`, `after?`, `timestamp`, `sourceMessageId?`
- `hasMore`, `total`.

### 3.7 `GET /api/chat/:sessionId/todo`

- Inputs same as diff route.
- Output:
- `sessionID`
- `todos`: list with `id`, `content`, `status`, `priority?`, `sourceMessageId?`, `updatedAt`
- `hasMore`, `total`.

---

## 4. Global Test Strategy

### 4.1 Test Categories

- Contract tests for each route schema and status codes.
- Validation tests for malformed query/path/body.
- Integration tests for directory/session resolution via middleware.
- Cross-route coherence tests (`workspace` vs `project` vs `vcs`).
- State-driven tests (`diff`/`todo` from session data stores).
- Regression tests for previously fixed issues.

### 4.2 Test Rules

- Every new behavior starts with failing test.
- Tests assert response body keys and semantic correctness, not just status code.
- Keep test naming explicit and scenario-focused.
- Use deterministic fixtures; avoid time-sensitive flakiness.

### 4.3 Test Execution Layers

- Targeted test file while in RED/GREEN loop.
- Route-group test run after each endpoint family.
- Full Batch 6 run at each phase checkpoint.

---

## 5. Implementation Plan (Task-by-Task)

### Task 1: Baseline Snapshot and Guardrails

**Files:**

- Modify: `docs/plans/2026-02-18-batch6-server-routes-services-hardening-implementation-plan.md`
- Verify: `packages/server/tests/routes/*`
- Verify: `packages/server/tests/middleware/*`

**Step 1: Record baseline test command list in notes**

```bash
pnpm -C packages/server test tests/routes tests/middleware src/routes/__tests__ src/services/__tests__
```

**Step 2: Run baseline suite and capture current status**

Run: `pnpm -C packages/server test tests/routes tests/middleware src/routes/__tests__ src/services/__tests__`
Expected: current suite passes before additional feature tests are introduced.

**Step 3: Freeze API behavior expectations for placeholder routes**

- Document current outputs for `project`, `projects`, `vcs`, `commands`, `mcp/status`, `diff`, `todo`.
- Note exact response fields to preserve/extend.

**Step 4: Add TODO checklist in implementation notes**

- Add route-by-route checklist with checkboxes in local working notes.

**Step 5: Commit baseline notes (optional checkpoint)**

```bash
git add docs/plans/2026-02-18-batch6-server-routes-services-hardening-implementation-plan.md
git commit -m "docs: capture batch6 hardening baseline and contracts"
```

---

### Task 2: Create Shared Route Utility for Directory Resolution

**Files:**

- Create: `packages/server/src/routes/_shared/directory-resolver.ts`
- Modify: `packages/server/src/routes/workspace.ts`
- Test: `packages/server/tests/routes/workspace.test.ts`

**Step 1: Write failing tests for resolver behavior via workspace/project/vcs routes**

Add tests asserting precedence:

1. explicit query directory
2. `instanceContext.directory`
3. fallback `process.cwd()`
4. invalid input handling

**Step 2: Run targeted test to verify RED**

Run: `pnpm -C packages/server test tests/routes/workspace.test.ts`
Expected: new tests fail because resolver utility does not exist.

**Step 3: Write minimal shared resolver implementation**

```ts
// directory-resolver.ts
export function resolveDirectory(
  c: Context<Env>,
  options?: { allowFallbackCwd?: boolean }
): string | null;
```

Behavior:

- normalize path
- reject empty/whitespace
- optional cwd fallback

**Step 4: Integrate resolver into workspace route**

- replace ad-hoc fallback logic with utility.

**Step 5: Run targeted tests to verify GREEN**

Run: `pnpm -C packages/server test tests/routes/workspace.test.ts`
Expected: pass.

**Step 6: Commit**

```bash
git add packages/server/src/routes/_shared/directory-resolver.ts packages/server/src/routes/workspace.ts packages/server/tests/routes/workspace.test.ts
git commit -m "refactor: add shared directory resolver for batch6 routes"
```

---

### Task 3: Add Shared Pagination Validation Utility

**Files:**

- Create: `packages/server/src/routes/_shared/pagination.ts`
- Test: `packages/server/tests/routes/session-data.test.ts`
- Test: `packages/server/tests/routes/batch6-pagination.test.ts` (new)

**Step 1: Write failing tests for limit/offset parsing edge cases**

Cases:

- non-numeric
- negative
- zero limit
- too-large limit
- whitespace

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/batch6-pagination.test.ts`
Expected: fail.

**Step 3: Implement parse utility**

```ts
export function parseLimitOffset(
  query: Record<string, string | undefined>,
  defaults?: { limit: number; maxLimit: number }
);
```

**Step 4: Reuse in file search and upcoming diff/todo routes**

- keep backward compatible defaults.

**Step 5: Run tests GREEN**

Run: `pnpm -C packages/server test tests/routes/batch6-pagination.test.ts src/routes/__tests__/files.test.ts`
Expected: pass.

**Step 6: Commit**

```bash
git add packages/server/src/routes/_shared/pagination.ts packages/server/tests/routes/batch6-pagination.test.ts packages/server/src/routes/files.ts packages/server/src/routes/__tests__/files.test.ts
git commit -m "feat: add shared pagination parser and validation tests"
```

---

### Task 4: Introduce Project Detection Service

**Files:**

- Create: `packages/server/src/services/project-detection.ts`
- Test: `packages/server/src/services/__tests__/project-detection.test.ts`

**Step 1: Write failing service tests**

Test scenarios:

- package.json project root detection
- git root fallback
- monorepo nested path handling
- no markers returns minimal unknown project

**Step 2: Run RED**

Run: `pnpm -C packages/server test src/services/__tests__/project-detection.test.ts`
Expected: fail.

**Step 3: Implement minimal service**

Functions:

- `detectProject(directory: string)`
- `listKnownProjects(seedDirectories: string[])`

**Step 4: Verify GREEN**

Run: `pnpm -C packages/server test src/services/__tests__/project-detection.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/src/services/project-detection.ts packages/server/src/services/__tests__/project-detection.test.ts
git commit -m "feat: add project detection service for batch6 routes"
```

---

### Task 5: Implement `GET /api/project` with Real Detection

**Files:**

- Modify: `packages/server/src/routes/project.ts`
- Test: `packages/server/tests/routes/project.test.ts` (new)

**Step 1: Write failing route tests for `/api/project`**

Cases:

- explicit directory query
- fallback to instance context
- fallback cwd
- invalid directory -> 400
- response contains stable keys

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/project.test.ts`
Expected: fail.

**Step 3: Implement minimal route logic**

- use `resolveDirectory`
- call `detectProject`
- map service response to API schema

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/project.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/src/routes/project.ts packages/server/tests/routes/project.test.ts
git commit -m "feat: implement project route with runtime detection"
```

---

### Task 6: Implement `GET /api/projects` Listing

**Files:**

- Modify: `packages/server/src/routes/project.ts`
- Test: `packages/server/tests/routes/project.test.ts`

**Step 1: Add failing tests for `/api/projects`**

Cases:

- returns at least current/fallback project entry
- deterministic empty if no accessible directories
- metadata fields present

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/project.test.ts`
Expected: fail.

**Step 3: Implement minimal list behavior**

- seed from current directory + optional session/workspace contexts
- dedupe by canonical path

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/project.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/src/routes/project.ts packages/server/tests/routes/project.test.ts
git commit -m "feat: implement projects listing route"
```

---

### Task 7: Add VCS Introspection Service

**Files:**

- Create: `packages/server/src/services/vcs-inspect.ts`
- Test: `packages/server/src/services/__tests__/vcs-inspect.test.ts`

**Step 1: Write failing tests for VCS status extraction**

Cases:

- git repo recognized
- no git repo -> type none
- branch + commit extraction
- dirty status detection

**Step 2: Run RED**

Run: `pnpm -C packages/server test src/services/__tests__/vcs-inspect.test.ts`
Expected: fail.

**Step 3: Implement minimal service**

Use non-shell approach where possible:

- inspect `.git/HEAD`
- parse refs
- optionally shell fallback for status if needed (controlled)

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test src/services/__tests__/vcs-inspect.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/src/services/vcs-inspect.ts packages/server/src/services/__tests__/vcs-inspect.test.ts
git commit -m "feat: add vcs inspection service"
```

---

### Task 8: Implement `GET /api/vcs`

**Files:**

- Modify: `packages/server/src/routes/vcs.ts`
- Test: `packages/server/tests/routes/vcs.test.ts` (new)

**Step 1: Write failing tests for route output contract**

Cases:

- valid git repo response
- non-repo response with `type: none`
- directory resolution precedence
- bad directory validation

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/vcs.test.ts`
Expected: fail.

**Step 3: Implement route using resolver + vcs service**

- preserve `directory` in output
- include normalized status fields

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/vcs.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/src/routes/vcs.ts packages/server/tests/routes/vcs.test.ts
git commit -m "feat: implement vcs route with real repository status"
```

---

### Task 9: Cross-Route Coherence Test (`workspace` + `project` + `vcs`)

**Files:**

- Test: `packages/server/tests/routes/workspace-project-vcs.integration.test.ts` (new)

**Step 1: Write failing integration tests**

Assertions:

- same resolved directory across three routes for same request context.
- consistent fallback behavior.

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/workspace-project-vcs.integration.test.ts`
Expected: fail.

**Step 3: Implement minimal fixes if mismatch appears**

- adjust resolver usage in each route.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/workspace-project-vcs.integration.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/tests/routes/workspace-project-vcs.integration.test.ts packages/server/src/routes/workspace.ts packages/server/src/routes/project.ts packages/server/src/routes/vcs.ts
git commit -m "test: enforce cross-route directory coherence"
```

---

### Task 10: Discover Runtime Command Sources

**Files:**

- Inspect: `packages/core/src` command/task/permission modules
- Create: `packages/server/src/services/command-catalog.ts`
- Test: `packages/server/src/services/__tests__/command-catalog.test.ts`

**Step 1: Write failing tests for command catalog extraction**

Cases:

- list available command ids
- include required metadata fields
- deterministic sort order

**Step 2: Run RED**

Run: `pnpm -C packages/server test src/services/__tests__/command-catalog.test.ts`
Expected: fail.

**Step 3: Implement service**

- read command definitions from core/runtime registration points.
- map to route-friendly DTO.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test src/services/__tests__/command-catalog.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/src/services/command-catalog.ts packages/server/src/services/__tests__/command-catalog.test.ts
git commit -m "feat: add command catalog service"
```

---

### Task 11: Implement `GET /api/commands`

**Files:**

- Modify: `packages/server/src/routes/command.ts`
- Test: `packages/server/tests/routes/command.test.ts` (new)

**Step 1: Write failing route tests**

Cases:

- non-empty command list in normal runtime
- supports query filters
- stable schema

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/command.test.ts`
Expected: fail.

**Step 3: Implement route logic**

- use command catalog service.
- apply filter parsing with validation.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/command.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/src/routes/command.ts packages/server/tests/routes/command.test.ts
git commit -m "feat: implement command listing route"
```

---

### Task 12: Discover MCP Runtime Status Sources

**Files:**

- Inspect: MCP runtime/state modules in core/server
- Create: `packages/server/src/services/mcp-status.ts`
- Test: `packages/server/src/services/__tests__/mcp-status.test.ts`

**Step 1: Write failing service tests**

Cases:

- no servers configured -> empty summary
- mixed online/offline/degraded mapping
- directory-scoped status

**Step 2: Run RED**

Run: `pnpm -C packages/server test src/services/__tests__/mcp-status.test.ts`
Expected: fail.

**Step 3: Implement service**

- gather server list from runtime provider.
- normalize into stable response model.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test src/services/__tests__/mcp-status.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/src/services/mcp-status.ts packages/server/src/services/__tests__/mcp-status.test.ts
git commit -m "feat: add mcp status aggregation service"
```

---

### Task 13: Implement `GET /api/mcp/status`

**Files:**

- Modify: `packages/server/src/routes/mcp.ts`
- Test: `packages/server/tests/routes/mcp.test.ts` (new)

**Step 1: Write failing route tests**

Cases:

- returns summary counts
- includes normalized server objects
- directory resolution consistency

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/mcp.test.ts`
Expected: fail.

**Step 3: Implement route via resolver + mcp status service**

- add safe error handling.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/mcp.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/src/routes/mcp.ts packages/server/tests/routes/mcp.test.ts
git commit -m "feat: implement mcp status route"
```

---

### Task 14: Define Session-Derived Diff Model

**Files:**

- Create: `packages/server/src/services/session-diff.ts`
- Test: `packages/server/src/services/__tests__/session-diff.test.ts`

**Step 1: Write failing tests for diff extraction**

Input sources:

- live session message store
- normalized checkpoint messages fallback

Cases:

- file creation/update/delete detection
- duplicate change collapse by message id
- pagination deterministic ordering

**Step 2: Run RED**

Run: `pnpm -C packages/server test src/services/__tests__/session-diff.test.ts`
Expected: fail.

**Step 3: Implement minimal extractor**

- parse message parts/tool outputs for file-change events.
- fallback to known event patterns.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test src/services/__tests__/session-diff.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/src/services/session-diff.ts packages/server/src/services/__tests__/session-diff.test.ts
git commit -m "feat: add session diff extraction service"
```

---

### Task 15: Implement `GET /api/chat/:sessionId/diff`

**Files:**

- Modify: `packages/server/src/routes/diff.ts`
- Test: `packages/server/tests/routes/diff.test.ts` (new)

**Step 1: Write failing route tests**

Cases:

- valid session returns diff list
- unknown session returns empty or 404 (choose and codify)
- pagination validations
- schema key checks

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/diff.test.ts`
Expected: fail.

**Step 3: Implement route**

- parse pagination via shared utility.
- call session diff service.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/diff.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/src/routes/diff.ts packages/server/tests/routes/diff.test.ts
git commit -m "feat: implement session diff route"
```

---

### Task 16: Define Session-Derived Todo Model

**Files:**

- Create: `packages/server/src/services/session-todo.ts`
- Test: `packages/server/src/services/__tests__/session-todo.test.ts`

**Step 1: Write failing tests for todo extraction**

Cases:

- extraction from assistant/tool plan outputs
- status transitions (`open`, `in_progress`, `done`)
- deduplication by semantic id
- stable ordering

**Step 2: Run RED**

Run: `pnpm -C packages/server test src/services/__tests__/session-todo.test.ts`
Expected: fail.

**Step 3: Implement service**

- parse known todo/plan structures from message parts.
- map to canonical todo DTO.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test src/services/__tests__/session-todo.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/src/services/session-todo.ts packages/server/src/services/__tests__/session-todo.test.ts
git commit -m "feat: add session todo extraction service"
```

---

### Task 17: Implement `GET /api/chat/:sessionId/todo`

**Files:**

- Modify: `packages/server/src/routes/todo.ts`
- Test: `packages/server/tests/routes/todo.test.ts` (new)

**Step 1: Write failing route tests**

Cases:

- returns todos for active session
- pagination and validation
- consistent response metadata

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/todo.test.ts`
Expected: fail.

**Step 3: Implement route via todo service**

- include `total` plus paging flags.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/todo.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/src/routes/todo.ts packages/server/tests/routes/todo.test.ts
git commit -m "feat: implement session todo route"
```

---

### Task 18: Add Session Data Fixtures for Diff/Todo Parsing

**Files:**

- Create: `packages/server/tests/fixtures/session-history/diff-basic.json`
- Create: `packages/server/tests/fixtures/session-history/diff-complex.json`
- Create: `packages/server/tests/fixtures/session-history/todo-basic.json`
- Create: `packages/server/tests/fixtures/session-history/todo-transitions.json`
- Test: `packages/server/src/services/__tests__/session-diff.test.ts`
- Test: `packages/server/src/services/__tests__/session-todo.test.ts`

**Step 1: Add failing fixture-based tests**

- parse fixture records and assert canonical DTO output exactly.

**Step 2: Run RED**

Run: `pnpm -C packages/server test src/services/__tests__/session-diff.test.ts src/services/__tests__/session-todo.test.ts`
Expected: fail.

**Step 3: Adjust extraction logic minimalistically**

- support fixture shapes without overgeneralizing.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test src/services/__tests__/session-diff.test.ts src/services/__tests__/session-todo.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/tests/fixtures/session-history packages/server/src/services/__tests__/session-diff.test.ts packages/server/src/services/__tests__/session-todo.test.ts packages/server/src/services/session-diff.ts packages/server/src/services/session-todo.ts
git commit -m "test: add fixture-driven parsing coverage for session diff/todo"
```

---

### Task 19: Route Schema Consistency Tests

**Files:**

- Create: `packages/server/tests/routes/batch6-schema-consistency.test.ts`

**Step 1: Write failing schema consistency tests**

Validate each route includes required keys and stable types:

- project
- projects
- vcs
- commands
- mcp/status
- diff
- todo

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/batch6-schema-consistency.test.ts`
Expected: fail.

**Step 3: Implement minimal route output normalization fixes**

- ensure optional keys included as `null`/`undefined` consistently.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/batch6-schema-consistency.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/tests/routes/batch6-schema-consistency.test.ts packages/server/src/routes/project.ts packages/server/src/routes/vcs.ts packages/server/src/routes/command.ts packages/server/src/routes/mcp.ts packages/server/src/routes/diff.ts packages/server/src/routes/todo.ts
git commit -m "test: enforce schema consistency across batch6 routes"
```

---

### Task 20: Add Invalid Input Security Tests

**Files:**

- Create: `packages/server/tests/routes/batch6-input-validation.test.ts`
- Modify: relevant route files for validation hardening

**Step 1: Write failing tests for invalid/malicious input**

Cases:

- path traversal-like directory strings
- oversized query values
- malformed unicode control characters
- invalid session ids for session routes

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/batch6-input-validation.test.ts`
Expected: fail.

**Step 3: Implement minimal validation guards**

- sanitize/reject invalid path tokens.
- centralize zod schemas where possible.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/batch6-input-validation.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/tests/routes/batch6-input-validation.test.ts packages/server/src/routes/project.ts packages/server/src/routes/vcs.ts packages/server/src/routes/mcp.ts packages/server/src/routes/diff.ts packages/server/src/routes/todo.ts

git commit -m "fix: harden batch6 route input validation"
```

---

### Task 21: Add Error-Path Determinism Tests

**Files:**

- Create: `packages/server/tests/routes/batch6-error-semantics.test.ts`

**Step 1: Write failing tests for deterministic error envelope semantics**

- For each route, assert expected status for invalid input vs internal failure.
- Ensure body includes `error` key and stable message.

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/batch6-error-semantics.test.ts`
Expected: fail.

**Step 3: Normalize route error behavior**

- align with existing middleware/error handler conventions.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/batch6-error-semantics.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/tests/routes/batch6-error-semantics.test.ts packages/server/src/routes/project.ts packages/server/src/routes/vcs.ts packages/server/src/routes/command.ts packages/server/src/routes/mcp.ts packages/server/src/routes/diff.ts packages/server/src/routes/todo.ts
git commit -m "test: stabilize batch6 error semantics"
```

---

### Task 22: Add Middleware Interaction Test Matrix

**Files:**

- Create: `packages/server/tests/routes/batch6-middleware-integration.test.ts`

**Step 1: Write failing tests for interactions with auth/rate-limit/cache/session-bridge**

- cached route responses must remain correct with auth state.
- rate-limit headers present on batch6 routes.
- session-bridge context usage does not alter auth behavior.

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/batch6-middleware-integration.test.ts`
Expected: fail.

**Step 3: Implement minimal compatibility fixes**

- update headers/caching exclusions for dynamic endpoints if needed.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/batch6-middleware-integration.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/tests/routes/batch6-middleware-integration.test.ts packages/server/src/index.ts packages/server/src/middleware/cache.ts

git commit -m "test: add middleware integration matrix for batch6 routes"
```

---

### Task 23: Add Route-Specific Caching Policy Assertions

**Files:**

- Modify: `packages/server/src/middleware/cache.ts`
- Test: `packages/server/tests/middleware/cache.test.ts`
- Test: `packages/server/tests/routes/batch6-cache-policy.test.ts` (new)

**Step 1: Write failing tests for cache policy by route**

- dynamic session routes (`diff`, `todo`) should bypass or short TTL.
- stable metadata routes may be cacheable.

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/batch6-cache-policy.test.ts tests/middleware/cache.test.ts`
Expected: fail.

**Step 3: Implement minimal policy controls**

- include path exclusions in middleware setup or route headers.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/batch6-cache-policy.test.ts tests/middleware/cache.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/src/middleware/cache.ts packages/server/tests/routes/batch6-cache-policy.test.ts packages/server/tests/middleware/cache.test.ts
git commit -m "fix: enforce cache policy for dynamic batch6 endpoints"
```

---

### Task 24: Add Route Registration Integrity Test

**Files:**

- Create: `packages/server/tests/routes/batch6-registration.test.ts`
- Modify: `packages/server/src/index.ts` only if needed

**Step 1: Write failing tests to ensure routes are mounted and reachable**

- assert status codes are not 404 for all target endpoints.

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/batch6-registration.test.ts`
Expected: fail if mis-registered.

**Step 3: Fix mounting issues if found**

- adjust `app.route` registrations.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/batch6-registration.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/tests/routes/batch6-registration.test.ts packages/server/src/index.ts
git commit -m "test: verify batch6 route registration integrity"
```

---

### Task 25: Add Performance Guard Test (Smoke)

**Files:**

- Create: `packages/server/tests/routes/batch6-performance-smoke.test.ts`

**Step 1: Write failing smoke test for response latency bounds in local test env**

- avoid strict brittle timings; use coarse bounds.

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/batch6-performance-smoke.test.ts`
Expected: fail initially if route paths do expensive repeated work.

**Step 3: Optimize minimal hotspots**

- avoid repeated filesystem scans in single request.
- add per-request memoization where needed.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/batch6-performance-smoke.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/tests/routes/batch6-performance-smoke.test.ts packages/server/src/routes/project.ts packages/server/src/routes/vcs.ts packages/server/src/services/project-detection.ts packages/server/src/services/vcs-inspect.ts
git commit -m "perf: add smoke guards for batch6 route responsiveness"
```

---

### Task 26: Add Structured Logging Consistency for New Routes

**Files:**

- Modify: `packages/server/src/routes/project.ts`
- Modify: `packages/server/src/routes/vcs.ts`
- Modify: `packages/server/src/routes/command.ts`
- Modify: `packages/server/src/routes/mcp.ts`
- Modify: `packages/server/src/routes/diff.ts`
- Modify: `packages/server/src/routes/todo.ts`
- Test: `packages/server/tests/routes/batch6-logging.test.ts` (new)

**Step 1: Write failing tests for log metadata shape (mock logger layer)**

- verify route/module/requestId context tagging.

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/batch6-logging.test.ts`
Expected: fail.

**Step 3: Add minimal logging statements**

- do not leak sensitive data.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/batch6-logging.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/src/routes/project.ts packages/server/src/routes/vcs.ts packages/server/src/routes/command.ts packages/server/src/routes/mcp.ts packages/server/src/routes/diff.ts packages/server/src/routes/todo.ts packages/server/tests/routes/batch6-logging.test.ts
git commit -m "chore: normalize structured logging for batch6 routes"
```

---

### Task 27: Expand LSP/MCP Coherence Test

**Files:**

- Modify: `packages/server/tests/routes/lsp.test.ts`
- Modify: `packages/server/tests/routes/mcp.test.ts`
- Create: `packages/server/tests/routes/lsp-mcp-coherence.test.ts`

**Step 1: Write failing tests comparing health/status patterns between LSP and MCP routes**

- both should return `servers` arrays and stable `directory` semantics.

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/lsp.test.ts tests/routes/mcp.test.ts tests/routes/lsp-mcp-coherence.test.ts`
Expected: fail.

**Step 3: Align response contracts minimally**

- adjust mcp route schema where needed.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/lsp.test.ts tests/routes/mcp.test.ts tests/routes/lsp-mcp-coherence.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/tests/routes/lsp.test.ts packages/server/tests/routes/mcp.test.ts packages/server/tests/routes/lsp-mcp-coherence.test.ts packages/server/src/routes/mcp.ts
git commit -m "test: enforce lsp/mcp route coherence"
```

---

### Task 28: Add Session Isolation Tests for Diff/Todo

**Files:**

- Create: `packages/server/tests/routes/diff-todo-session-isolation.test.ts`

**Step 1: Write failing tests**

- events/messages from session A must not appear in session B.

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/diff-todo-session-isolation.test.ts`
Expected: fail.

**Step 3: Fix service filtering**

- enforce strict `sessionId` filtering in extractors.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/diff-todo-session-isolation.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/tests/routes/diff-todo-session-isolation.test.ts packages/server/src/services/session-diff.ts packages/server/src/services/session-todo.ts
git commit -m "fix: enforce strict session isolation for diff/todo routes"
```

---

### Task 29: Add Retry/Idempotency Tests for Dynamic Routes

**Files:**

- Create: `packages/server/tests/routes/batch6-idempotency.test.ts`

**Step 1: Write failing tests**

- repeated GET calls should preserve data ordering and pagination determinism.

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/batch6-idempotency.test.ts`
Expected: fail.

**Step 3: Fix non-determinism**

- ensure sort keys stable (`timestamp`, then id).

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/batch6-idempotency.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/tests/routes/batch6-idempotency.test.ts packages/server/src/services/session-diff.ts packages/server/src/services/session-todo.ts
git commit -m "test: guarantee idempotent ordering for batch6 GET routes"
```

---

### Task 30: Add Robust Unknown-State Tests

**Files:**

- Create: `packages/server/tests/routes/batch6-unknown-state.test.ts`

**Step 1: Write failing tests for missing dependencies/state**

- no repo
- no session messages
- no MCP providers
- command registry unavailable

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/batch6-unknown-state.test.ts`
Expected: fail.

**Step 3: Implement graceful fallback outputs**

- return explicit `unknown/uninitialized` statuses, not crashes.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/batch6-unknown-state.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/tests/routes/batch6-unknown-state.test.ts packages/server/src/routes/project.ts packages/server/src/routes/vcs.ts packages/server/src/routes/mcp.ts packages/server/src/routes/command.ts packages/server/src/routes/diff.ts packages/server/src/routes/todo.ts
git commit -m "fix: graceful unknown-state handling across batch6 routes"
```

---

### Task 31: Expand Service-Level Unit Coverage for File Services

**Files:**

- Modify: `packages/server/src/services/__tests__/file-index.test.ts`
- Modify: `packages/server/src/services/__tests__/file-watcher.test.ts`

**Step 1: Add failing edge-case tests**

- unicode path handling
- deep directory limit behavior
- remove/add race sequence

**Step 2: Run RED**

Run: `pnpm -C packages/server test src/services/__tests__/file-index.test.ts src/services/__tests__/file-watcher.test.ts`
Expected: fail.

**Step 3: Implement minimal fixes if needed**

- keep index invariants stable.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test src/services/__tests__/file-index.test.ts src/services/__tests__/file-watcher.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/src/services/__tests__/file-index.test.ts packages/server/src/services/__tests__/file-watcher.test.ts packages/server/src/services/file-index.ts packages/server/src/services/file-watcher.ts
git commit -m "test: expand file service edge-case coverage"
```

---

### Task 32: Add OpenAPI Drift Checks for New/Updated Route Schemas

**Files:**

- Modify: `packages/server/src/routes/provider.openapi.ts` (if shared schema patterns reused)
- Create: `packages/server/src/schema/__tests__/batch6-schema-drift.test.ts`

**Step 1: Write failing schema drift tests**

- compare runtime payload sample shapes to declared schemas or snapshots.

**Step 2: Run RED**

Run: `pnpm -C packages/server test src/schema/__tests__/batch6-schema-drift.test.ts`
Expected: fail.

**Step 3: Update schema declarations/snapshots**

- only include batch6 routes touched.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test src/schema/__tests__/batch6-schema-drift.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/src/schema/__tests__/batch6-schema-drift.test.ts packages/server/src/schema/provider.schemas.json packages/server/src/schema/generate-provider-schema.mjs
git commit -m "test: add schema drift checks for batch6 route contracts"
```

---

### Task 33: Add Route Documentation Comments and Examples

**Files:**

- Modify: `packages/server/src/routes/project.ts`
- Modify: `packages/server/src/routes/vcs.ts`
- Modify: `packages/server/src/routes/command.ts`
- Modify: `packages/server/src/routes/mcp.ts`
- Modify: `packages/server/src/routes/diff.ts`
- Modify: `packages/server/src/routes/todo.ts`

**Step 1: Add failing doc lint/test if applicable**

- If no doc lint exists, skip failing test and do minimal comment updates.

**Step 2: Update route-level docs**

Include:

- request examples
- query parameters
- response fields
- error semantics

**Step 3: Run relevant lint/type checks**

Run: `pnpm -C packages/server test tests/routes/project.test.ts tests/routes/vcs.test.ts tests/routes/command.test.ts tests/routes/mcp.test.ts tests/routes/diff.test.ts tests/routes/todo.test.ts`
Expected: pass.

**Step 4: Commit**

```bash
git add packages/server/src/routes/project.ts packages/server/src/routes/vcs.ts packages/server/src/routes/command.ts packages/server/src/routes/mcp.ts packages/server/src/routes/diff.ts packages/server/src/routes/todo.ts
git commit -m "docs: update batch6 route contracts and examples"
```

---

### Task 34: Add End-to-End Batch 6 Happy Path Test

**Files:**

- Create: `packages/server/tests/routes/batch6-e2e-happy-path.test.ts`

**Step 1: Write failing E2E scenario test**

Scenario chain:

1. workspace
2. project
3. vcs
4. command
5. mcp
6. chat session
7. diff/todo for that session

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/batch6-e2e-happy-path.test.ts`
Expected: fail.

**Step 3: Implement glue fixes**

- align route contracts, context propagation, and pagination defaults.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/batch6-e2e-happy-path.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/tests/routes/batch6-e2e-happy-path.test.ts packages/server/src/routes/project.ts packages/server/src/routes/vcs.ts packages/server/src/routes/command.ts packages/server/src/routes/mcp.ts packages/server/src/routes/diff.ts packages/server/src/routes/todo.ts

git commit -m "test: add batch6 route e2e happy path coverage"
```

---

### Task 35: Add End-to-End Batch 6 Failure Path Test

**Files:**

- Create: `packages/server/tests/routes/batch6-e2e-failure-path.test.ts`

**Step 1: Write failing E2E failure scenarios**

- invalid directory
- invalid session id
- missing required params
- unavailable runtime dependency

**Step 2: Run RED**

Run: `pnpm -C packages/server test tests/routes/batch6-e2e-failure-path.test.ts`
Expected: fail.

**Step 3: Implement minimal error handling fixes**

- ensure deterministic status/body for each failure type.

**Step 4: Run GREEN**

Run: `pnpm -C packages/server test tests/routes/batch6-e2e-failure-path.test.ts`
Expected: pass.

**Step 5: Commit**

```bash
git add packages/server/tests/routes/batch6-e2e-failure-path.test.ts packages/server/src/routes/project.ts packages/server/src/routes/vcs.ts packages/server/src/routes/command.ts packages/server/src/routes/mcp.ts packages/server/src/routes/diff.ts packages/server/src/routes/todo.ts

git commit -m "test: add batch6 route e2e failure-path coverage"
```

---

### Task 36: Add Regression Tests for Prior Batch 6 Fixes

**Files:**

- Modify: `packages/server/src/routes/__tests__/files.test.ts`
- Modify: `packages/server/tests/routes/workspace.test.ts`
- Modify: `packages/server/tests/middleware/cache.test.ts`

**Step 1: Ensure regressions remain covered**

- invalid files limit 400.
- workspace cwd fallback route-level behavior.
- cache duplicate logging cleanup unaffected.

**Step 2: Run RED/GREEN only if additional assertions fail**

Run: `pnpm -C packages/server test src/routes/__tests__/files.test.ts tests/routes/workspace.test.ts tests/middleware/cache.test.ts`
Expected: pass.

**Step 3: Commit**

```bash
git add packages/server/src/routes/__tests__/files.test.ts packages/server/tests/routes/workspace.test.ts packages/server/tests/middleware/cache.test.ts

git commit -m "test: lock in previously fixed batch6 regressions"
```

---

### Task 37: Verify Full Route Set with Targeted Grouping

**Files:**

- Verify only

**Step 1: Run project/vcs/command/mcp group**

Run:

```bash
pnpm -C packages/server test tests/routes/project.test.ts tests/routes/vcs.test.ts tests/routes/command.test.ts tests/routes/mcp.test.ts
```

Expected: pass.

**Step 2: Run diff/todo/session group**

Run:

```bash
pnpm -C packages/server test tests/routes/diff.test.ts tests/routes/todo.test.ts tests/routes/session-data.test.ts tests/middleware/session-bridge.test.ts
```

Expected: pass.

**Step 3: Run middleware integration group**

Run:

```bash
pnpm -C packages/server test tests/middleware/auth.test.ts tests/middleware/cache.test.ts tests/middleware/rate-limit.test.ts tests/middleware/error-handler.test.ts
```

Expected: pass.

**Step 4: Commit verification artifact (optional notes)**

```bash
git add docs/plans/2026-02-18-batch6-server-routes-services-hardening-implementation-plan.md
git commit -m "docs: update verification checkpoints for batch6 plan"
```

---

### Task 38: Full Batch 6 Verification Gate

**Files:**

- Verify only

**Step 1: Run full batch6 test suite**

```bash
pnpm -C packages/server test tests/routes tests/middleware src/routes/__tests__ src/services/__tests__
```

Expected: all tests pass.

**Step 2: If any failures, fix with micro TDD loops**

- add failing assertion
- minimal fix
- rerun affected test
- rerun full suite

**Step 3: Record final pass summary**

- total files
- total tests
- wall time
- notable warnings

**Step 4: Commit final batch6 implementation**

```bash
git add packages/server/src/routes packages/server/src/services packages/server/src/middleware packages/server/tests packages/server/src/routes/__tests__ packages/server/src/services/__tests__

git commit -m "feat: complete batch6 route/service/middleware hardening"
```

---

### Task 39: Optional Cleanup and Refactor Pass

**Files:**

- Modify only where duplication exists

**Step 1: Identify duplication in route validation and response mapping**

- extract shared mappers only if at least 2 call sites.

**Step 2: Add/adjust tests before refactor if behavior risk exists**

- lock behavior first.

**Step 3: Refactor minimally**

- preserve route contracts.

**Step 4: Run targeted + full suite**

```bash
pnpm -C packages/server test tests/routes tests/middleware src/routes/__tests__ src/services/__tests__
```

**Step 5: Commit**

```bash
git add packages/server/src/routes packages/server/src/services

git commit -m "refactor: reduce duplication in batch6 route handlers"
```

---

### Task 40: Final Handoff Notes for Reviewer/Integrator

**Files:**

- Create: `docs/plans/2026-02-18-batch6-hardening-handoff.md`

**Step 1: Summarize delivered behavior changes**

- list each route old vs new behavior.

**Step 2: Summarize test additions and rationale**

- map tests to discovered bug classes.

**Step 3: Summarize residual risks and deferred work**

- any intentionally unsupported corners.

**Step 4: Commit handoff doc**

```bash
git add docs/plans/2026-02-18-batch6-hardening-handoff.md
git commit -m "docs: add batch6 hardening handoff summary"
```

---

## 6. Route-by-Route Test Case Matrix

### 6.1 `/api/project` Test Matrix

- Returns detected project for explicit `directory`.
- Uses `instanceContext.directory` when query absent.
- Falls back to cwd when no context.
- Returns 400 for empty directory.
- Returns 400 for malformed directory input.
- Includes `id`, `name`, `path`, `detectedBy` keys.
- Handles nested monorepo package path.
- Handles missing package.json with git fallback.
- Handles no markers with safe default.
- Does not throw internal stack traces.

### 6.2 `/api/projects` Test Matrix

- Returns deterministic list format.
- Dedupe by canonical path.
- Includes fallback current project.
- Empty list only when no candidates exist.
- Stable sort order.
- `source` field present for each entry.
- Handles unreadable candidate paths gracefully.
- No crashes on runtime unavailable.
- Keeps response under expected shape even when partially failing.
- Auth middleware still enforced.

### 6.3 `/api/vcs` Test Matrix

- Detects git repo.
- Reads branch name.
- Reads commit hash.
- Computes dirty status.
- Returns `type: none` for non-repo.
- Preserves resolved directory.
- Handles invalid directory with 400.
- Handles IO failure with safe 500.
- No shell injection vector from query input.
- Stable schema keys always present.

### 6.4 `/api/commands` Test Matrix

- Returns non-empty when command registry available.
- Returns deterministic empty when unavailable.
- Includes `id`, `name`, `description`, `category`.
- `requiresApproval` reflects policy metadata.
- Query filter `category` works.
- Query filter `enabled` works.
- Invalid filter values -> 400.
- Stable sort order.
- No duplicates.
- Auth + rate limit headers preserved.

### 6.5 `/api/mcp/status` Test Matrix

- Includes `directory` echo.
- Includes `servers` array.
- Includes `summary` counts.
- Handles zero-server case.
- Handles mixed status case.
- Handles runtime error gracefully.
- Supports context-based directory fallback.
- Invalid directory -> 400.
- Schema keys stable.
- Works with auth middleware.

### 6.6 `/api/chat/:sessionId/diff` Test Matrix

- Basic diff extraction from live messages.
- Fallback extraction from checkpoint history.
- `limit`/`offset` pagination works.
- Invalid pagination -> 400.
- Unknown session semantics are deterministic.
- Session isolation across multiple sessions.
- Stable sort order.
- Includes `total` and `hasMore`.
- Empty diff set handled cleanly.
- No cross-session leakage.

### 6.7 `/api/chat/:sessionId/todo` Test Matrix

- Basic todo extraction from session outputs.
- Status transitions reflected.
- Dedupe repeated todo entries.
- Pagination works.
- Invalid pagination -> 400.
- Unknown session deterministic response.
- Session isolation preserved.
- Stable ordering + ids.
- Includes metadata fields.
- Empty list handled cleanly.

---

## 7. Implementation Reference Snippets (for Executor)

### 7.1 Shared Directory Resolver Skeleton

```ts
import path from "node:path";
import type { Context } from "hono";
import type { Env } from "../../index";

export function resolveDirectory(
  c: Context<Env>,
  options: { allowFallbackCwd?: boolean } = {}
): { ok: true; directory: string } | { ok: false; reason: string } {
  const queryDir = c.req.query("directory")?.trim();
  const contextDir = c.get("instanceContext")?.directory?.trim();

  const raw = queryDir || contextDir || (options.allowFallbackCwd ? process.cwd() : "");
  if (!raw) {
    return { ok: false, reason: "Directory parameter required" };
  }

  if (/\u0000/.test(raw)) {
    return { ok: false, reason: "Invalid directory parameter" };
  }

  return { ok: true, directory: path.resolve(raw) };
}
```

### 7.2 Shared Pagination Parser Skeleton

```ts
export function parseLimitOffset(
  query: Record<string, string | undefined>,
  defaults = { limit: 50, maxLimit: 1000 }
): { ok: true; limit: number; offset: number } | { ok: false; reason: string } {
  const rawLimit = query.limit?.trim();
  const rawOffset = query.offset?.trim();

  const limit = rawLimit === undefined ? defaults.limit : Number.parseInt(rawLimit, 10);
  const offset = rawOffset === undefined ? 0 : Number.parseInt(rawOffset, 10);

  if (
    rawLimit !== undefined &&
    (!/^\d+$/.test(rawLimit) || limit < 1 || limit > defaults.maxLimit)
  ) {
    return { ok: false, reason: "Invalid limit parameter" };
  }

  if (rawOffset !== undefined && (!/^\d+$/.test(rawOffset) || offset < 0)) {
    return { ok: false, reason: "Invalid offset parameter" };
  }

  return { ok: true, limit, offset };
}
```

### 7.3 Diff Route Skeleton

```ts
app.get("/api/chat/:sessionId/diff", async c => {
  const sessionId = c.req.param("sessionId");
  const page = parseLimitOffset(c.req.query(), { limit: 100, maxLimit: 1000 });
  if (!page.ok) return c.json({ error: page.reason }, 400);

  const result = await getSessionDiffs({ sessionId, limit: page.limit, offset: page.offset });
  return c.json({
    sessionID: sessionId,
    diffs: result.items,
    hasMore: result.hasMore,
    total: result.total,
  });
});
```

### 7.4 Todo Route Skeleton

```ts
app.get("/api/chat/:sessionId/todo", async c => {
  const sessionId = c.req.param("sessionId");
  const page = parseLimitOffset(c.req.query(), { limit: 100, maxLimit: 1000 });
  if (!page.ok) return c.json({ error: page.reason }, 400);

  const result = await getSessionTodos({ sessionId, limit: page.limit, offset: page.offset });
  return c.json({
    sessionID: sessionId,
    todos: result.items,
    hasMore: result.hasMore,
    total: result.total,
  });
});
```

### 7.5 Project Route Skeleton

```ts
projectRouter.get("/api/project", async c => {
  const resolved = resolveDirectory(c, { allowFallbackCwd: true });
  if (!resolved.ok) return c.json({ error: resolved.reason }, 400);

  const project = await detectProject(resolved.directory);
  return c.json(project);
});
```

### 7.6 VCS Route Skeleton

```ts
vcsRouter.get("/api/vcs", async c => {
  const resolved = resolveDirectory(c, { allowFallbackCwd: true });
  if (!resolved.ok) return c.json({ error: resolved.reason }, 400);

  const vcs = await inspectVcs(resolved.directory);
  return c.json({ ...vcs, directory: resolved.directory });
});
```

### 7.7 Command Route Skeleton

```ts
commandRouter.get("/api/commands", async c => {
  const category = c.req.query("category");
  const enabled = c.req.query("enabled");
  const commands = await getCommandCatalog({ category, enabled });
  return c.json({ commands });
});
```

### 7.8 MCP Route Skeleton

```ts
mcpRouter.get("/api/mcp/status", async c => {
  const resolved = resolveDirectory(c, { allowFallbackCwd: true });
  if (!resolved.ok) return c.json({ error: resolved.reason }, 400);

  const status = await getMcpStatus({ directory: resolved.directory });
  return c.json(status);
});
```

---

## 8. Data Model Definitions (Planned)

### 8.1 Project DTO

```ts
export interface ProjectDto {
  id: string;
  name: string;
  path: string;
  detectedBy: "package-json" | "git" | "fallback";
  packageJson?: {
    name?: string;
    version?: string;
    private?: boolean;
    workspaces?: string[];
  };
}
```

### 8.2 VCS DTO

```ts
export interface VcsDto {
  directory: string;
  type: "git" | "none";
  branch?: string;
  commit?: string;
  dirty?: boolean;
  ahead?: number;
  behind?: number;
  status: string;
}
```

### 8.3 Command DTO

```ts
export interface CommandDto {
  id: string;
  name: string;
  description: string;
  category: "workspace" | "edit" | "shell" | "session" | "other";
  enabled: boolean;
  requiresApproval: boolean;
}
```

### 8.4 MCP DTO

```ts
export interface McpServerDto {
  id: string;
  name: string;
  status: "connected" | "degraded" | "offline";
  capabilities: string[];
  latencyMs?: number;
  error?: string;
}

export interface McpStatusDto {
  directory: string;
  servers: McpServerDto[];
  summary: {
    total: number;
    connected: number;
    degraded: number;
    offline: number;
  };
}
```

### 8.5 Diff DTO

```ts
export interface SessionDiffDto {
  path: string;
  changeType: "added" | "modified" | "deleted" | "renamed";
  before?: string;
  after?: string;
  timestamp: number;
  sourceMessageId?: string;
}
```

### 8.6 Todo DTO

```ts
export interface SessionTodoDto {
  id: string;
  content: string;
  status: "open" | "in_progress" | "done" | "blocked";
  priority?: "low" | "medium" | "high";
  sourceMessageId?: string;
  updatedAt: number;
}
```

---

## 9. Risk Register and Mitigations

### Risk 1: Hidden dependency assumptions in core runtime APIs

- Impact: route implementation blocked or brittle.
- Mitigation:
- create thin adapter services in `packages/server/src/services/*`.
- mock those adapters in tests.

### Risk 2: Non-deterministic session parsing for diff/todo

- Impact: flaky tests and inconsistent UX.
- Mitigation:
- fixture-based parsing tests.
- stable sorting and dedupe keys.

### Risk 3: Over-caching dynamic endpoints

- Impact: stale diff/todo responses.
- Mitigation:
- explicit cache bypass/exclusion tests.

### Risk 4: Performance regressions from filesystem scanning

- Impact: slow route responses.
- Mitigation:
- lightweight project/vcs lookup with memoization.
- smoke performance tests.

### Risk 5: Breaking existing chat/session contracts

- Impact: regression in previously passing tests.
- Mitigation:
- run chat/session tests after each related change.
- keep directory fallback route-local when needed.

### Risk 6: Schema drift across routes

- Impact: frontend/runtime mismatch.
- Mitigation:
- schema consistency tests.
- drift snapshot tests.

---

## 10. Verification Plan (Required Before Completion)

### 10.1 Per-Task Verification

- Always run the specific test file modified.
- If a shared utility changed, run all consumers’ tests.

### 10.2 Per-Phase Verification

Phase A (project/vcs):

```bash
pnpm -C packages/server test tests/routes/project.test.ts tests/routes/vcs.test.ts tests/routes/workspace-project-vcs.integration.test.ts
```

Phase B (command/mcp):

```bash
pnpm -C packages/server test tests/routes/command.test.ts tests/routes/mcp.test.ts tests/routes/lsp-mcp-coherence.test.ts
```

Phase C (diff/todo):

```bash
pnpm -C packages/server test tests/routes/diff.test.ts tests/routes/todo.test.ts tests/routes/diff-todo-session-isolation.test.ts
```

Phase D (middleware/system):

```bash
pnpm -C packages/server test tests/routes/batch6-middleware-integration.test.ts tests/routes/batch6-cache-policy.test.ts tests/middleware/cache.test.ts tests/middleware/auth.test.ts tests/middleware/rate-limit.test.ts tests/middleware/error-handler.test.ts
```

### 10.3 Final Verification (Mandatory)

```bash
pnpm -C packages/server test tests/routes tests/middleware src/routes/__tests__ src/services/__tests__
```

Expected:

- all pass
- no new warnings except known unrelated baseline warnings (if any)

---

## 11. Commit Strategy

### 11.1 Recommended Commit Cadence

- 1 commit per route/service milestone (Tasks 4-17).
- 1 commit per cross-cutting test matrix group (Tasks 19-23).
- 1 final integration commit after full verification.

### 11.2 Commit Message Prefixes

- `feat:` for new route/service behavior
- `fix:` for bug corrections
- `test:` for coverage additions
- `refactor:` for non-behavioral cleanup
- `docs:` for handoff and contract docs

### 11.3 Example Sequence

1. `feat: add project detection service for batch6 routes`
2. `feat: implement project route with runtime detection`
3. `feat: add vcs inspection service`
4. `feat: implement vcs route with real repository status`
5. `feat: add command catalog service`
6. `feat: implement command listing route`
7. `feat: add mcp status aggregation service`
8. `feat: implement mcp status route`
9. `feat: add session diff extraction service`
10. `feat: implement session diff route`
11. `feat: add session todo extraction service`
12. `feat: implement session todo route`
13. `test: enforce schema consistency across batch6 routes`
14. `fix: harden batch6 route input validation`
15. `feat: complete batch6 route/service/middleware hardening`

---

## 12. Executor Checklist (Line-by-Line Operational)

- [ ] Confirm clean git state or isolate changes.
- [ ] Run baseline full suite once.
- [ ] Create shared route utilities before route implementations.
- [ ] Implement `project` service and route via TDD.
- [ ] Implement `vcs` service and route via TDD.
- [ ] Add coherence integration test for workspace/project/vcs.
- [ ] Implement `command` service and route via TDD.
- [ ] Implement `mcp` service and route via TDD.
- [ ] Add lsp/mcp coherence test.
- [ ] Implement session diff service.
- [ ] Implement diff route and tests.
- [ ] Implement session todo service.
- [ ] Implement todo route and tests.
- [ ] Add schema consistency test suite.
- [ ] Add input validation test suite.
- [ ] Add error semantics test suite.
- [ ] Add middleware integration test suite.
- [ ] Add cache policy tests and policy adjustments.
- [ ] Add route registration integrity test.
- [ ] Add session isolation tests for diff/todo.
- [ ] Add idempotency tests for dynamic GETs.
- [ ] Add unknown-state behavior tests.
- [ ] Expand file service edge-case tests.
- [ ] Add batch6 e2e happy path.
- [ ] Add batch6 e2e failure path.
- [ ] Re-run grouped route/middleware suites.
- [ ] Re-run full batch6 suite.
- [ ] Capture final summary metrics.
- [ ] Prepare handoff note doc.

---

## 13. Exact Command Reference

### 13.1 Test Commands (Targeted)

```bash
pnpm -C packages/server test tests/routes/project.test.ts
pnpm -C packages/server test tests/routes/vcs.test.ts
pnpm -C packages/server test tests/routes/command.test.ts
pnpm -C packages/server test tests/routes/mcp.test.ts
pnpm -C packages/server test tests/routes/diff.test.ts
pnpm -C packages/server test tests/routes/todo.test.ts
pnpm -C packages/server test tests/routes/workspace-project-vcs.integration.test.ts
pnpm -C packages/server test tests/routes/lsp-mcp-coherence.test.ts
pnpm -C packages/server test tests/routes/diff-todo-session-isolation.test.ts
pnpm -C packages/server test tests/routes/batch6-schema-consistency.test.ts
pnpm -C packages/server test tests/routes/batch6-input-validation.test.ts
pnpm -C packages/server test tests/routes/batch6-error-semantics.test.ts
pnpm -C packages/server test tests/routes/batch6-middleware-integration.test.ts
pnpm -C packages/server test tests/routes/batch6-cache-policy.test.ts
pnpm -C packages/server test tests/routes/batch6-registration.test.ts
pnpm -C packages/server test tests/routes/batch6-performance-smoke.test.ts
pnpm -C packages/server test tests/routes/batch6-e2e-happy-path.test.ts
pnpm -C packages/server test tests/routes/batch6-e2e-failure-path.test.ts
pnpm -C packages/server test src/services/__tests__/project-detection.test.ts
pnpm -C packages/server test src/services/__tests__/vcs-inspect.test.ts
pnpm -C packages/server test src/services/__tests__/command-catalog.test.ts
pnpm -C packages/server test src/services/__tests__/mcp-status.test.ts
pnpm -C packages/server test src/services/__tests__/session-diff.test.ts
pnpm -C packages/server test src/services/__tests__/session-todo.test.ts
```

### 13.2 Full Verification Command

```bash
pnpm -C packages/server test tests/routes tests/middleware src/routes/__tests__ src/services/__tests__
```

### 13.3 Useful Diagnostics

```bash
git status --short
rg -n "TODO: Implement actual" packages/server/src/routes
rg -n "describe\(|it\(" packages/server/tests/routes packages/server/src/services/__tests__
```

---

## 14. Definition of Done (Strict)

- [ ] No placeholder TODO remains in the seven target routes.
- [ ] Each target route has at least one dedicated route test file.
- [ ] Diff/todo extraction logic has service-level fixture tests.
- [ ] Cross-route coherence test passes.
- [ ] Middleware interaction tests pass.
- [ ] Full Batch 6 suite passes.
- [ ] Route contracts are documented.
- [ ] Handoff doc exists and is accurate.

---

## 15. Expanded Micro-Task Breakdown (for Parallel/Sequential Execution)

### 15.1 `project` Stream

- [ ] Add service test scaffolding.
- [ ] Add fixture directories for detection.
- [ ] Implement detection by package.json.
- [ ] Implement detection by git root.
- [ ] Implement fallback unknown project.
- [ ] Add route tests for `/api/project`.
- [ ] Add route tests for `/api/projects`.
- [ ] Wire resolver into route.
- [ ] Normalize output DTO.
- [ ] Add validation branch tests.

### 15.2 `vcs` Stream

- [ ] Add vcs service tests.
- [ ] Implement `.git/HEAD` parsing.
- [ ] Resolve ref to commit hash.
- [ ] Add dirty-state heuristic.
- [ ] Add route tests.
- [ ] Handle non-repo state.
- [ ] Add invalid directory tests.
- [ ] Normalize route schema.
- [ ] Add integration with project route coherence test.
- [ ] Confirm middleware headers preserved.

### 15.3 `command` Stream

- [ ] Inspect command registry source.
- [ ] Add service mapping tests.
- [ ] Implement category mapping.
- [ ] Implement enabled/approval flags.
- [ ] Add route tests.
- [ ] Add query filter validation tests.
- [ ] Implement filter parser.
- [ ] Add unknown-state fallback.
- [ ] Add deterministic sort.
- [ ] Document command schema.

### 15.4 `mcp` Stream

- [ ] Inspect mcp runtime source.
- [ ] Add mcp status service tests.
- [ ] Implement per-server normalization.
- [ ] Implement summary aggregation.
- [ ] Add route tests.
- [ ] Add coherence test with lsp route.
- [ ] Add invalid directory validation.
- [ ] Add runtime unavailable fallback.
- [ ] Add error field normalization.
- [ ] Document route schema.

### 15.5 `diff` Stream

- [ ] Add session diff fixture tests.
- [ ] Implement parser for file-change parts.
- [ ] Implement parser fallback from normalized messages.
- [ ] Add dedupe logic.
- [ ] Add stable sorting.
- [ ] Add pagination support.
- [ ] Add route tests.
- [ ] Add session isolation tests.
- [ ] Add unknown session behavior tests.
- [ ] Add cache bypass assertions.

### 15.6 `todo` Stream

- [ ] Add session todo fixture tests.
- [ ] Implement parser for plan/todo structures.
- [ ] Implement status transition handling.
- [ ] Add dedupe logic.
- [ ] Add stable sorting.
- [ ] Add pagination support.
- [ ] Add route tests.
- [ ] Add session isolation tests.
- [ ] Add unknown session behavior tests.
- [ ] Add cache bypass assertions.

---

## 16. Post-Implementation Review Checklist (for Human Reviewer)

- [ ] Read each target route file and confirm no TODO placeholders remain.
- [ ] Confirm error messages are user-safe and actionable.
- [ ] Confirm response schema consistency across related routes.
- [ ] Confirm no route does heavy repeated IO per request without need.
- [ ] Confirm new tests fail if route behavior regresses.
- [ ] Confirm session-scoped routes do not cross-contaminate data.
- [ ] Confirm middleware policies still apply correctly.
- [ ] Confirm no existing route behavior regressed (especially chat/session).

---

## 17. Optional Future Enhancements (Out of Immediate Scope)

- Add OpenAPI spec sections for new batch6 route contracts.
- Add richer diff semantic model with hunk-level details.
- Add todo provenance links to full message transcript.
- Add project discovery cache persistence across process restarts.
- Add mcp per-capability diagnostics endpoints.

---

## 18. Final Execution Handoff Message Template

Use this exact handoff structure when another agent starts executing:

1. “Follow `docs/plans/2026-02-18-batch6-server-routes-services-hardening-implementation-plan.md` in strict TDD order.”
2. “Do not implement production code before adding failing tests for each task.”
3. “Commit after each task group as documented.”
4. “Run full Batch 6 verification at Task 38 and report exact pass counts.”
5. “If any assumption blocks implementation, pause and document decision request.”

---

## 19. Line-Filler Quality Guard (Intentional)

This section intentionally provides additional explicit executor cues so no ambiguity remains:

- Prefer deterministic data shaping in route handlers.
- Keep extraction logic in services, not route files.
- Avoid route handlers with more than one screenful of logic.
- Validate and normalize all query input before service calls.
- Use explicit default values in every response.
- Keep sorting stable and test-asserted.
- Always include route-level regression tests for bugs discovered during implementation.
- Avoid broad try/catch swallowing; map expected failures explicitly.
- Use minimal code to pass each failing test.
- Avoid introducing hidden side effects in GET endpoints.

Additional detailed implementation guard lines:

- Ensure every new service exports a typed return interface.
- Ensure every route test asserts both status and payload shape.
- Ensure every service test includes at least one edge-case fixture.
- Ensure session-based parsers are isolated from unrelated store data.
- Ensure no placeholder values (`"unknown"`) are used where real data is available.
- Ensure unknown-state behavior is explicit and documented.
- Ensure all new files are included in tsconfig/project references if needed.
- Ensure import paths follow existing project conventions.
- Ensure tests use existing setup helpers for DB/session fixtures.
- Ensure no fragile time-based assertions without controlled clocks.

More explicit route-specific guard lines:

- `/api/project`: never return relative path in `path`.
- `/api/projects`: never include duplicates by canonical absolute path.
- `/api/vcs`: when git absent, do not include fake branch.
- `/api/commands`: never include hidden/disabled commands unless requested by filter.
- `/api/mcp/status`: summary counts must equal servers list classification.
- `/api/chat/:sessionId/diff`: never include diffs without `path` and `changeType`.
- `/api/chat/:sessionId/todo`: never include todos without `id`, `content`, `status`.

More operational guard lines:

- Run route tests after each route change.
- Run service tests after each parser change.
- Run middleware tests after cache/policy changes.
- Re-run chat/session tests after any session-related utility change.
- Keep commit scope narrow and descriptive.
- Document unresolved concerns in handoff doc.

---

## 20. Long-Form Step Expansion (Executor-Friendly Red/Green Loops)

Below is a redundant-but-intentional expansion of Red/Green loops to reduce execution ambiguity.

### 20.1 Red/Green Loop Template A (Route)

1. Add one failing test to route test file.
2. Run only that file.
3. Confirm failure is expected (missing behavior, not typo).
4. Implement minimal route change.
5. Re-run same test file.
6. Confirm pass.
7. Run closely related integration test file.
8. Commit.

### 20.2 Red/Green Loop Template B (Service)

1. Add one failing test to service test file.
2. Use fixture input where possible.
3. Run test file.
4. Confirm expected fail.
5. Implement minimal parser/mapping logic.
6. Re-run service test file.
7. Confirm pass.
8. Run route tests that consume this service.
9. Commit.

### 20.3 Red/Green Loop Template C (Cross-Route Integration)

1. Add failing cross-route test.
2. Run integration file.
3. Confirm fail shows mismatch.
4. Adjust shared resolver or output normalization.
5. Re-run integration file.
6. Confirm pass.
7. Re-run individual route files touched.
8. Commit.

### 20.4 Red/Green Loop Template D (Validation/Error)

1. Add failing validation/error test.
2. Run targeted file.
3. Confirm fail due to wrong status/body.
4. Implement minimal guard.
5. Re-run file.
6. Confirm pass.
7. Re-run schema consistency tests.
8. Commit.

---

## 21. Additional Detailed Task Fragments

### 21.1 Project Route Detailed Fragments

- Fragment A: Input normalization.
- Fragment B: Project ID derivation.
- Fragment C: Package summary parsing.
- Fragment D: Response serialization.
- Fragment E: Error branch consistency.
- Fragment F: Empty state behavior.
- Fragment G: Integration with workspace.
- Fragment H: Tests for encoded path.
- Fragment I: Tests for invalid path.
- Fragment J: Final route docs.

### 21.2 VCS Route Detailed Fragments

- Fragment A: Repo root detection.
- Fragment B: HEAD parsing.
- Fragment C: Ref fallback.
- Fragment D: Dirty status detection.
- Fragment E: Non-repo shaping.
- Fragment F: Error boundary.
- Fragment G: Integration with project route.
- Fragment H: status string standardization.
- Fragment I: Response field optionality.
- Fragment J: Final docs/tests sync.

### 21.3 Command Route Detailed Fragments

- Fragment A: Registry read abstraction.
- Fragment B: DTO mapping.
- Fragment C: category normalization.
- Fragment D: filter parsing.
- Fragment E: enabled flag semantics.
- Fragment F: approval semantics.
- Fragment G: deterministic sorting.
- Fragment H: empty-state semantics.
- Fragment I: validation error semantics.
- Fragment J: final integration check.

### 21.4 MCP Route Detailed Fragments

- Fragment A: status source abstraction.
- Fragment B: per-server mapping.
- Fragment C: capabilities mapping.
- Fragment D: summary counting.
- Fragment E: degraded status handling.
- Fragment F: error field conventions.
- Fragment G: directory fallback.
- Fragment H: invalid input handling.
- Fragment I: coherence with lsp.
- Fragment J: final docs/tests sync.

### 21.5 Diff Route Detailed Fragments

- Fragment A: source selection order.
- Fragment B: event/message parsing.
- Fragment C: change type inference.
- Fragment D: dedupe logic.
- Fragment E: sorting.
- Fragment F: pagination.
- Fragment G: session isolation.
- Fragment H: unknown session.
- Fragment I: schema consistency.
- Fragment J: final integration check.

### 21.6 Todo Route Detailed Fragments

- Fragment A: source selection order.
- Fragment B: todo extraction patterns.
- Fragment C: status transition merge.
- Fragment D: priority normalization.
- Fragment E: dedupe logic.
- Fragment F: sorting.
- Fragment G: pagination.
- Fragment H: session isolation.
- Fragment I: schema consistency.
- Fragment J: final integration check.

---

## 22. Contingency Handling

### 22.1 If Core API is Missing for Commands

- Implement fallback command catalog from known static definitions.
- Mark source field as `fallback-static`.
- Add explicit test for fallback branch.

### 22.2 If MCP Runtime Access Is Not Available in Server Context

- Implement adapter returning `servers: []` + summary zeros + `statusSource: "unavailable"`.
- Keep route functional with deterministic schema.
- Add tests for unavailable branch.

### 22.3 If Diff/Todo Extraction Signal Is Weak in Messages

- Add extraction from persisted events DB as secondary source.
- Add precedence tests: live session store first, events second, checkpoint third.

### 22.4 If Performance Becomes a Concern

- Add per-request cache for expensive service lookups.
- Add short-lived process cache with invalidation hooks.
- Add tests ensuring stale safety for dynamic endpoints.

---

## 23. Quality Gates by Milestone

### Milestone A Gate (Project + VCS)

- [ ] project service tests pass
- [ ] vcs service tests pass
- [ ] project route tests pass
- [ ] vcs route tests pass
- [ ] workspace/project/vcs coherence tests pass

### Milestone B Gate (Command + MCP)

- [ ] command service tests pass
- [ ] mcp service tests pass
- [ ] command route tests pass
- [ ] mcp route tests pass
- [ ] lsp/mcp coherence tests pass

### Milestone C Gate (Diff + Todo)

- [ ] session diff service tests pass
- [ ] session todo service tests pass
- [ ] diff route tests pass
- [ ] todo route tests pass
- [ ] session isolation tests pass

### Milestone D Gate (System Hardening)

- [ ] schema consistency tests pass
- [ ] input validation tests pass
- [ ] error semantics tests pass
- [ ] middleware integration tests pass
- [ ] cache policy tests pass

### Milestone E Gate (Final)

- [ ] full batch6 suite passes
- [ ] handoff notes generated
- [ ] no unresolved TODO placeholders

---

## 24. Final Notes for the Next Agent

- Execute in strict order unless blocked.
- If parallelizing, only split independent streams after shared utilities are done.
- Do not skip RED stage.
- Do not batch too many behavior changes into one commit.
- Keep each commit reviewable and test-backed.
- If any route behavior decision is ambiguous, codify via test and document reasoning in commit body.
