# Project Grouping + Migration Squash Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the flat HomeView workspace list with project-grouped cards, while performing a one-time server migration squash to reset Drizzle history.

**Architecture:** Perform a controlled schema squash (new baseline migration + explicit policy exception), add a `projects` table linked from `workspaces.project_id`, detect project identity at workspace creation time, and return workspace rows with embedded project info for UI grouping. Keep `/api/projects` ownership in the existing `project` module (no duplicate route under workspace module).

**Tech Stack:** Drizzle ORM (SQLite/libsql), Hono, SolidJS, TypeScript, Vitest

---

## Preconditions (Required)

- This is a **breaking migration-history reset** for local/dev DBs.
- Effective date for this squash: **February 27, 2026**.
- Existing append-only migration guardrails must be adjusted for this one transition, then restored.

---

## Phase 1: Controlled Migration Squash

### Task 1: Add one-time squash mode to migration policy checker

**Files:**

- Modify: `scripts/check-server-migration-policy.mjs`
- Modify: `packages/server/db/__tests__/migration-policy.test.ts`

**Step 1: Add explicit squash gate**

Add a narrow opt-in mode (for example `SAKTI_ALLOW_MIGRATION_SQUASH=1`) that allows migration file deletions/modifications **only** when enabled.

**Step 2: Keep strict mode default**

Default behavior must remain append-only. CI should still fail migration rewrites unless squash mode is explicitly enabled.

**Step 3: Add tests for both modes**

Add/adjust tests to verify:

- strict mode still rejects deletion/modification/rename
- squash mode allows planned reset diff

**Step 4: Run tests**

Run: `pnpm --filter @sakti-code/server test packages/server/db/__tests__/migration-policy.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/check-server-migration-policy.mjs packages/server/db/__tests__/migration-policy.test.ts
git commit -m "chore(server): add one-time migration squash policy gate"
```

---

### Task 2: Regenerate Drizzle baseline migration set

**Files:**

- Delete/Recreate: `packages/server/drizzle/*.sql`
- Delete/Recreate: `packages/server/drizzle/meta/*.json`

**Step 1: Inspect migration directory**

Run: `ls -la packages/server/drizzle packages/server/drizzle/meta`
Expected: current migration chain is visible.

**Step 2: Remove old generated migrations (intentional squash)**

Use tracked-file-safe commands (no broad cleanup commands outside target files):

```bash
git rm packages/server/drizzle/*.sql
git rm packages/server/drizzle/meta/*.json
```

**Step 3: Generate fresh baseline from current schema**

Run: `pnpm --filter @sakti-code/server drizzle:generate`
Expected: new baseline SQL and meta journal/snapshots generated.

**Step 4: Validate with squash mode enabled**

Run: `SAKTI_ALLOW_MIGRATION_SQUASH=1 pnpm migrations:check:server`
Expected: PASS

**Step 5: Commit baseline squash**

```bash
git add packages/server/drizzle/
git commit -m "chore(server): squash drizzle migrations to fresh baseline"
```

---

### Task 3: Define DB reset behavior for existing local environments

**Files:**

- Modify: `docs/plans/2026-02-28-project-grouping.md` (this file, note retained as implementation note)
- Optional Modify: `docs/TASK_FIRST_WORKFLOW.md` (if you want permanent mention)

**Step 1: Decide reset strategy (hard reset for local DB)**

For this squash, document that existing local DBs may require recreation because migration history has been reset.

**Step 2: Reference actual default DB location**

Document default path as `~/.sakti/db/sakticode.db` (or overridden via `DATABASE_URL`).

**Step 3: Commit docs update (if separate)**

```bash
git add docs/TASK_FIRST_WORKFLOW.md docs/plans/2026-02-28-project-grouping.md
git commit -m "docs: record db reset behavior for migration squash"
```

---

## Phase 2: Schema + Data Layer for Project Grouping

### Task 4: Add projects table and workspace foreign key

**Files:**

- Modify: `packages/server/db/schema.ts`

**Step 1: Add `projects` table**

Columns:

- `id` (text PK)
- `name` (text not null)
- `path` (text not null unique)
- `created_at` (timestamp not null)

Indexes:

- index on `path`

**Step 2: Add nullable `project_id` to `workspaces`**

`project_id` references `projects.id` with `onDelete: "set null"`.

**Step 3: Export table types**

Add `Project` / `NewProject` infer types.

**Step 4: Generate migration (append-only from new baseline)**

Run: `pnpm --filter @sakti-code/server drizzle:generate`
Expected: migration adds projects table + workspace column/index changes.

**Step 5: Validate migration policy in strict mode**

Run: `pnpm migrations:check:server`
Expected: PASS (no squash mode needed now).

**Step 6: Commit**

```bash
git add packages/server/db/schema.ts packages/server/drizzle/
git commit -m "feat(server): add projects table and workspace project foreign key"
```

---

### Task 5: Add projects DB module and workspace DB mapping

**Files:**

- Create: `packages/server/db/projects.ts`
- Modify: `packages/server/db/index.ts`
- Modify: `packages/server/db/workspaces.ts`

**Step 1: Implement `db/projects.ts` CRUD helpers**

Implement:

- `createProject`
- `getProjectById`
- `getProjectByPath`
- `listProjects`

Use consistent camelCase mapping in return types.

**Step 2: Export module from `db/index.ts`**

Add: `export * from "./projects";`

**Step 3: Add `projectId` support in workspace DB model**

Update:

- `CreateWorkspaceInput`
- `WorkspaceData`
- row mapping in `mapToWorkspaceData`
- insert payload in `createWorkspace`

**Step 4: Update tests**

Modify/add tests in:

- `packages/server/db/__tests__/workspaces.test.ts`

Cover:

- workspace creation with `projectId`
- null/default project behavior remains valid

**Step 5: Run tests**

Run: `pnpm --filter @sakti-code/server test packages/server/db/__tests__/workspaces.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/server/db/projects.ts packages/server/db/index.ts packages/server/db/workspaces.ts packages/server/db/__tests__/workspaces.test.ts
git commit -m "feat(server): persist project entities and workspace project linkage"
```

---

## Phase 3: Workspace Creation and Project Detection

### Task 6: Add robust project detection utility

**Files:**

- Create: `packages/server/src/modules/workspace/infrastructure/detect-project.ts`

**Step 1: Implement detection with safe fallbacks**

Behavior:

- Attempt to read git remote origin for workspace repo.
- Parse common URL forms (https + ssh) for GitHub/GitLab/Bitbucket.
- Fall back to folder name when remote unavailable/unparseable.

Output:

- stable display `name`
- stable project grouping key/path

**Step 2: Keep implementation non-fragile**

Requirements:

- no throw for non-git directories
- deterministic lowercase normalization where needed
- testable pure parsing helpers

**Step 3: Add tests**

Create tests for parsing edge cases and fallback behavior.

**Step 4: Run tests**

Run: `pnpm --filter @sakti-code/server test`
Expected: relevant new tests PASS.

**Step 5: Commit**

```bash
git add packages/server/src/modules/workspace/infrastructure/detect-project.ts
git commit -m "feat(server): detect project identity from git origin with fallback"
```

---

### Task 7: Wire project creation/linking in workspace usecases + repository domain

**Files:**

- Modify: `packages/server/src/modules/workspace/domain/repositories/workspace.repository.ts`
- Modify: `packages/server/src/modules/workspace/infrastructure/repositories/workspace.repository.drizzle.ts`
- Modify: `packages/server/src/modules/workspace/application/usecases/list-workspaces.usecase.ts`

**Step 1: Extend domain types**

Add `projectId` to:

- workspace entity shape
- create input types where required

**Step 2: Usecase create flow**

On workspace create:

- dedupe by path
- if `projectId` missing, detect project
- find-or-create project record
- create workspace with linked `projectId`

**Step 3: Keep module boundaries clean**

Use repository/usecase boundaries; avoid route-level DB orchestration.

**Step 4: Add/adjust tests**

Update usecase/repository tests for:

- dedupe behavior
- project auto-linking

**Step 5: Run server checks**

Run:

- `pnpm --filter @sakti-code/server typecheck`
- `pnpm --filter @sakti-code/server test`
  Expected: PASS

**Step 6: Commit**

```bash
git add packages/server/src/modules/workspace/domain/repositories/workspace.repository.ts packages/server/src/modules/workspace/infrastructure/repositories/workspace.repository.drizzle.ts packages/server/src/modules/workspace/application/usecases/list-workspaces.usecase.ts
git commit -m "feat(server): auto-link workspaces to detected projects"
```

---

## Phase 4: API Contract Updates (No Duplicate `/api/projects` Route)

### Task 8: Return project info in workspace responses

**Files:**

- Modify: `packages/server/src/modules/workspace/controller/routes/workspaces.route.ts`
- Modify: `packages/server/src/modules/workspace/controller/routes/__tests__/workspaces.test.ts`

**Step 1: Extend serialized workspace shape**

Include:

- `projectId`
- `project` (nullable object)

**Step 2: Avoid N+1 fetch pattern**

Implement list response with batched lookup or query join so list endpoints do not call one query per row.

**Step 3: Keep route ownership intact**

Do **not** add `/api/projects` to workspace routes. Existing endpoint remains in `project` module.

**Step 4: Update route tests**

Add assertions for project fields in:

- `GET /api/workspaces`
- `GET /api/workspaces/:id`
- creation response

**Step 5: Run tests**

Run: `pnpm --filter @sakti-code/server test packages/server/src/modules/workspace/controller/routes/__tests__/workspaces.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/server/src/modules/workspace/controller/routes/workspaces.route.ts packages/server/src/modules/workspace/controller/routes/__tests__/workspaces.test.ts
git commit -m "feat(server): include linked project info in workspace API responses"
```

---

### Task 9: Align existing `/api/projects` behavior with DB-backed projects

**Files:**

- Modify: `packages/server/src/modules/project/application/usecases/get-project.usecase.ts`
- Modify: `packages/server/src/modules/project/controller/routes/project.route.ts` (if needed)
- Modify: `packages/server/src/modules/project/controller/routes/__tests__/project.test.ts`

**Step 1: Keep endpoint location, update data source**

Update `listProjects()` to read from DB project records (or clearly document why it remains context-only if intentionally deferred).

**Step 2: Define stable response contract**

Ensure frontend-facing `projects[]` fields are explicit and documented.

**Step 3: Run tests**

Run: `pnpm --filter @sakti-code/server test packages/server/src/modules/project/controller/routes/__tests__/project.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/server/src/modules/project/application/usecases/get-project.usecase.ts packages/server/src/modules/project/controller/routes/project.route.ts packages/server/src/modules/project/controller/routes/__tests__/project.test.ts
git commit -m "feat(server): align projects API with persisted project records"
```

---

## Phase 5: Desktop Types + HomeView Grouped UI

### Task 10: Update desktop API client contracts

**Files:**

- Modify: `apps/desktop/src/core/services/api/api-client.ts`
- Modify: `apps/desktop/src/core/services/api/__tests__/*` (relevant files)

**Step 1: Add project types**

Add `Project` interface and extend `Workspace` with:

- `projectId: string | null`
- `project: Project | null`

**Step 2: Add/adjust projects API method only if needed**

If HomeView groups from workspace payload alone, keep it simple and avoid extra fetch.

**Step 3: Update API client tests**

Cover decoding of new workspace shape.

**Step 4: Run checks**

Run:

- `pnpm --filter @sakti-code/desktop typecheck`
- `pnpm --filter @sakti-code/desktop test`
  Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/core/services/api/api-client.ts apps/desktop/src/core/services/api/__tests__/
git commit -m "feat(desktop): support project-linked workspace API contract"
```

---

### Task 11: Implement grouped HomeView components and behavior

**Files:**

- Create: `apps/desktop/src/views/home-view/components/project-card.tsx`
- Create: `apps/desktop/src/views/home-view/components/__tests__/project-card.test.tsx`
- Modify: `apps/desktop/src/views/home-view/home-view.tsx`
- Modify: `apps/desktop/src/views/home-view/components/workspace-dashboard.tsx`
- Modify: `apps/desktop/src/views/home-view/components/__tests__/workspace-dashboard.test.tsx`

**Step 1: Create grouped card component**

Render:

- project header/title
- list of project workspaces
- open workspace actions

**Step 2: Group active workspaces in HomeView**

Group by `workspace.projectId` (fallback bucket for ungrouped).

**Step 3: Preserve existing archive/search behavior**

Ensure grouped UI does not regress:

- search behavior
- keyboard navigation expectations
- archive/restore flows

**Step 4: Update tests**

Add tests for:

- grouping correctness
- interaction callbacks
- ungrouped fallback

**Step 5: Run desktop checks**

Run:

- `pnpm --filter @sakti-code/desktop typecheck`
- `pnpm --filter @sakti-code/desktop test`
  Expected: PASS

**Step 6: Commit**

```bash
git add apps/desktop/src/views/home-view/
git commit -m "feat(desktop): group HomeView workspaces by project"
```

---

## Phase 6: End-to-End Verification

### Task 12: Full validation across repo

**Step 1: Server validation**

Run:

- `pnpm --filter @sakti-code/server typecheck`
- `pnpm --filter @sakti-code/server test`

**Step 2: Desktop validation**

Run:

- `pnpm --filter @sakti-code/desktop typecheck`
- `pnpm --filter @sakti-code/desktop test`

**Step 3: Migration validation**

Run:

- `pnpm migrations:check:server`

**Step 4: Repo-wide validation**

Run:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

**Step 5: Build validation**

Run:

- `pnpm build`

**Step 6: Commit any targeted fixes**

```bash
git add <targeted-files>
git commit -m "fix: resolve project-grouping verification issues"
```

---

## Rollout Notes

- After the migration squash commit lands, remove squash-mode usage from normal workflows.
- Keep migration policy strict by default for all subsequent schema changes.
- For developers with old local DB state, recreate DB at `~/.sakti/db/sakticode.db` (or equivalent `DATABASE_URL` target) if migration-history mismatch occurs.

---

## Summary

This plan intentionally performs a one-time migration squash, then ships project grouping safely by:

1. Making migration reset explicit, gated, and test-covered
2. Adding persisted project entities linked to workspaces
3. Detecting and auto-linking projects during workspace creation
4. Extending workspace API contract with embedded project data
5. Updating HomeView UI and tests to render grouped project cards
6. Running strict repo-wide verification before completion
