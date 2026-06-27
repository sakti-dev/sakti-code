# Wire agent-effect to Server — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `@sakti-code/agent` with `@sakti-code/agent-effect` in `apps/server/` and `apps/desktop/` so the Effect-native package serves production traffic.

**Architecture:** Mechanical swap — no server code logic changes. `agent-effect` re-exports all symbols from `agent` with identical types. The 5 `@migration` wrappers serve as the Promise boundary.

**Tech Stack:** pnpm workspace, TypeScript, vitest

---

### Task 1: Swap dependency + tsconfig in apps/server

**Files:**
- Modify: `apps/server/package.json:33`
- Modify: `apps/server/tsconfig.json:7`

**Step 1: Update package.json dependency**

Replace `"@sakti-code/agent": "workspace:*"` with `"@sakti-code/agent-effect": "workspace:*"` in `apps/server/package.json:33`.

**Step 2: Update tsconfig path mapping**

Replace:
```
"@sakti-code/agent": ["../../packages/agent/src/index.ts"]
```
with:
```
"@sakti-code/agent-effect": ["../../packages/agent-effect/src/index.ts"]
```
in `apps/server/tsconfig.json:7`.

**Step 3: Install**

Run: `pnpm install`
Expected: resolves `@sakti-code/agent-effect` workspace dependency.

**Step 4: Commit**

```
git add apps/server/package.json apps/server/tsconfig.json pnpm-lock.yaml
git commit -m "chore(server): swap @sakti-code/agent → @sakti-code/agent-effect"
```

---

### Task 2: Rename all imports in apps/server/src (production code)

**Files:**
- Modify: `apps/server/src/agent/runner.ts` (lines 12, 28 — two import blocks)
- Modify: `apps/server/src/agent/ws-handler.ts` (line 5)
- Modify: `apps/server/src/agent/execution-env.ts` (lines 22, 23)
- Modify: `apps/server/src/agent/tools-builder.ts` (line 1)
- Modify: `apps/server/src/agent/replay-runner.ts` (line 1)
- Modify: `apps/server/src/lib/context-loader.ts` (lines 10, 11)
- Modify: `apps/server/src/lib/permission-channel.ts` (line 7)
- Modify: `apps/server/src/routes/sessions/sessions.ts` (line 2)
- Modify: `apps/server/src/routes/sessions/stats.ts` (lines 1, 2)
- Modify: `apps/server/src/routes/sessions/forking.ts` (line 1)
- Modify: `apps/server/src/routes/sessions/compaction.ts` (line 6)
- Modify: `apps/server/src/routes/sessions/last-assistant-text.ts` (line 1)
- Modify: `apps/server/src/routes/sessions/export.ts` (line 1)

**Step 1: Batch rename all imports**

In all 13 files above, replace every `from "@sakti-code/agent"` with `from "@sakti-code/agent-effect"`.

**Step 2: Typecheck server**

Run: `cd apps/server && pnpm run typecheck`
Expected: no errors.

**Step 3: Commit**

```
git add apps/server/src/
git commit -m "chore(server): update all imports to @sakti-code/agent-effect"
```

---

### Task 3: Rename all imports in apps/server/src (test code)

**Files:**
- Modify: `apps/server/src/__tests__/forking.test.ts` (line 1)
- Modify: `apps/server/src/agent/__tests__/runner.test.ts` (line 6)
- Modify: `apps/server/src/agent/__tests__/helpers.ts` (line 1)
- Modify: `apps/server/src/agent/__tests__/switch-agent.test.ts` (line 5)

**Step 1: Rename imports**

Replace `from "@sakti-code/agent"` with `from "@sakti-code/agent-effect"` in all 4 test files.

**Step 2: Run server tests**

Run: `cd apps/server && pnpm run test`
Expected: all server tests pass.

**Step 3: Commit**

```
git add apps/server/src/__tests__/
git commit -m "chore(server): update test imports to @sakti-code/agent-effect"
```

---

### Task 4: Swap dependency + tsconfig in apps/desktop

**Files:**
- Modify: `apps/desktop/package.json:25`
- Modify: `apps/desktop/tsconfig.json:15`

**Step 1: Update package.json dependency**

Replace `"@sakti-code/agent": "workspace:*"` with `"@sakti-code/agent-effect": "workspace:*"` in `apps/desktop/package.json:25`.

**Step 2: Update tsconfig path mapping**

Replace:
```
"@sakti-code/agent": ["../../packages/agent/src/index.ts"]
```
with:
```
"@sakti-code/agent-effect": ["../../packages/agent-effect/src/index.ts"]
```
in `apps/desktop/tsconfig.json:15`.

**Step 3: Commit**

```
git add apps/desktop/package.json apps/desktop/tsconfig.json pnpm-lock.yaml
git commit -m "chore(desktop): swap @sakti-code/agent → @sakti-code/agent-effect"
```

---

### Task 5: Rename all imports in apps/desktop/src

**Files:**
- Modify: 16 files importing `@sakti-code/agent` (all type-only imports) — see Task 6 exploration output for full list.

**Step 1: Batch rename all imports**

In all 16 files in `apps/desktop/src/`, replace every `from "@sakti-code/agent"` with `from "@sakti-code/agent-effect"`.

**Step 2: Typecheck desktop**

Run: `cd apps/desktop && pnpm run typecheck` (or equivalent — check package.json scripts)
Expected: no errors.

**Step 3: Run desktop tests**

Run: `cd apps/desktop && pnpm run test`
Expected: all desktop tests pass (especially `import-check.test.ts` which validates type availability).

**Step 4: Commit**

```
git add apps/desktop/src/
git commit -m "chore(desktop): update all imports to @sakti-code/agent-effect"
```

---

### Task 6: Full verification

**Files:** None (verification only)

**Step 1: Run full monorepo typecheck**

Run: `pnpm run typecheck`
Expected: all packages typecheck clean.

**Step 2: Run full monorepo test suite**

Run: `pnpm run fix` (runs lint + tests across monorepo)
Expected: all tests pass, no lint errors.

**Step 3: Verify no stale references**

Run: `rg 'from "@sakti-code/agent"' apps/`
Expected: zero matches (all imports now point to `agent-effect`).

**Step 4: Verify server starts**

Run: `timeout 10 pnpm run dev:server 2>&1 || true`
Expected: server starts on port 3001 without import errors.

**Step 5: Commit (if any fixes needed)**

Otherwise: plan is complete.
