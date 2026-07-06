# Remove Store System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the multi-repo store system (~3,055 source lines + ~4,135 test lines) from `packages/sakti/`, leaving only single-project root finding.

**Architecture:** The store system is a multi-repo management layer (register/resolve cross-repo "stores") that the desktop app doesn't need. It's entangled with 5 non-store files via the misnamed `StoreError`/`StoreDiagnostic` types (really the CLI's generic error taxonomy). Removal proceeds in 4 dependency-ordered phases: extract error types → delete orphaned references → simplify root resolver → delete store CRUD.

**Tech Stack:** TypeScript, Commander.js, Vitest, node:fs

---

## Pre-existing State

**4 pre-existing test failures** (do not try to fix these — 3 will disappear when their test files are deleted in Phase 4):
- `test/cli-e2e/store-lifecycle.test.ts` (1 failure)
- `test/core/store/registry.test.ts` (1 failure)
- `test/commands/store.test.ts` (1 failure)
- `test/specs/source-specs-normalization.test.ts` (1 failure — stays throughout)

**Build command:** `node build.js` (from `packages/sakti/`)
**Test command:** `VITEST_MAX_WORKERS=2 pnpm exec vitest run` (from `packages/sakti/`)
**Single test:** `VITEST_MAX_WORKERS=2 pnpm exec vitest run test/path/file.test.ts`
**Commit:** Always use `git commit --no-verify` (pre-commit hook fails on bulk formatting drift)

---

## Phase 1: Extract Error Types

**Goal:** Move `StoreError`/`StoreDiagnostic`/`makeStoreDiagnostic` from `store/errors.ts` to a generic `src/core/errors.ts`, breaking 5 files' dependency on the store package.

### Task 1.1: Create `src/core/errors.ts`

**Files:**
- Create: `packages/sakti/src/core/errors.ts`

**Step 1: Create the file**

Copy the content of `src/core/store/errors.ts` but rename the types to be generic:

```typescript
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  target?: string;
  fix?: string;
}

export class SaktiError extends Error {
  readonly diagnostic: Diagnostic;

  constructor(
    message: string,
    code: string,
    options: { target?: string; fix?: string } = {}
  ) {
    super(message);
    this.name = 'SaktiError';
    this.diagnostic = {
      severity: 'error',
      code,
      message,
      ...options,
    };
  }
}

export function makeDiagnostic(
  severity: DiagnosticSeverity,
  code: string,
  message: string,
  options: { target?: string; fix?: string } = {}
): Diagnostic {
  return {
    severity,
    code,
    message,
    ...options,
  };
}
```

**Step 2: Verify build**

Run: `node build.js`
Expected: Build succeeds (the new file isn't imported yet)

**Step 3: Commit**

```bash
git add packages/sakti/src/core/errors.ts
git commit --no-verify -m "feat(sakti): add generic errors.ts (SaktiError/Diagnostic)"
```

---

### Task 1.2: Re-export from `store/errors.ts` as aliases

**Files:**
- Modify: `packages/sakti/src/core/store/errors.ts`

**Step 1: Replace the file with re-exports**

This keeps existing imports working during migration. Replace the entire file content:

```typescript
export { SaktiError as StoreError, type Diagnostic as StoreDiagnostic, makeDiagnostic as makeStoreDiagnostic, type DiagnosticSeverity as StoreDiagnosticSeverity } from '../errors.js';
```

**Step 2: Verify build**

Run: `node build.js`
Expected: Build succeeds (all existing imports still resolve via aliases)

**Step 3: Run tests**

Run: `VITEST_MAX_WORKERS=2 pnpm exec vitest run`
Expected: Same 4 pre-existing failures, zero new failures

**Step 4: Commit**

```bash
git add packages/sakti/src/core/store/errors.ts
git commit --no-verify -m "refactor(sakti): re-export StoreError as alias for SaktiError"
```

---

### Task 1.3: Migrate `shared-output.ts` to use `SaktiError`/`Diagnostic`

**Files:**
- Modify: `packages/sakti/src/commands/shared-output.ts`

**Step 1: Update imports**

Change:
```typescript
import { StoreError, type StoreDiagnostic } from '../core/store/errors.js';
```
To:
```typescript
import { SaktiError, type Diagnostic } from '../core/errors.js';
```

**Step 2: Update references in the file**

Replace all `StoreError` → `SaktiError`, `StoreDiagnostic` → `Diagnostic` throughout the file. There are 3 usages: the `asStatus` function signature and body.

**Step 3: Verify build**

Run: `node build.js`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add packages/sakti/src/commands/shared-output.ts
git commit --no-verify -m "refactor(sakti): migrate shared-output to SaktiError"
```

---

### Task 1.4: Migrate `sakti-root.ts`, `file-state.ts`, `root-selection.ts`

**Files:**
- Modify: `packages/sakti/src/core/sakti-root.ts` (imports `makeStoreDiagnostic`, `StoreDiagnostic`)
- Modify: `packages/sakti/src/core/file-state.ts` (imports `StoreError`)
- Modify: `packages/sakti/src/core/root-selection.ts` (imports `StoreError`)

**Step 1: Update `sakti-root.ts`**

Change import from `'./store/errors.js'` to `'./errors.js'`. Replace `StoreDiagnostic` → `Diagnostic`, `makeStoreDiagnostic` → `makeDiagnostic` throughout.

**Step 2: Update `file-state.ts`**

Change import from `'./store/errors.js'` to `'./errors.js'`. Replace `StoreError` → `SaktiError` throughout (return type annotation + 2 `new StoreError(...)` calls).

**Step 3: Update `root-selection.ts`**

Change import `import { StoreError } from './store/errors.js'` to `import { SaktiError } from './errors.js'`. Replace `StoreError` → `SaktiError` in the `fromStoreError` function (line 94: `error instanceof StoreError` → `error instanceof SaktiError`).

**Step 4: Verify build + tests**

Run: `node build.js && VITEST_MAX_WORKERS=2 pnpm exec vitest run`
Expected: Build succeeds, same 4 pre-existing failures, zero new failures

**Step 5: Commit**

```bash
git add packages/sakti/src/core/sakti-root.ts packages/sakti/src/core/file-state.ts packages/sakti/src/core/root-selection.ts
git commit --no-verify -m "refactor(sakti): migrate core files from StoreError to SaktiError"
```

---

### Task 1.5: Migrate `references.ts` + `store.ts` command

**Files:**
- Modify: `packages/sakti/src/core/references.ts`
- Modify: `packages/sakti/src/commands/store.ts`

**Step 1: Update `references.ts`**

Change imports from `'./store/errors.js'` to `'./errors.js'`. Replace `makeStoreDiagnostic` → `makeDiagnostic`, `StoreDiagnostic` → `Diagnostic` throughout. (Note: `references.ts` will be deleted in Phase 2, but migrate it now for consistency.)

**Step 2: Update `store.ts`**

Change imports from `'../core/store/errors.js'` to `'../core/errors.js'`. Replace all `StoreError` → `SaktiError`, `StoreDiagnostic` → `Diagnostic`, `makeStoreDiagnostic` → `makeDiagnostic` throughout the file. There are ~20 usages.

**Step 3: Verify build + tests**

Run: `node build.js && VITEST_MAX_WORKERS=2 pnpm exec vitest run`
Expected: Build succeeds, same 4 pre-existing failures, zero new failures

**Step 4: Commit**

```bash
git add packages/sakti/src/core/references.ts packages/sakti/src/commands/store.ts
git commit --no-verify -m "refactor(sakti): migrate references + store command to SaktiError"
```

---

## Phase 2: Delete References Module

**Goal:** Remove `references.ts` (407 lines) — fully orphaned since context removal. `assembleReferenceIndex()` has zero callers.

### Task 2.1: Remove vestigial `references` field from `shared.ts`

**Files:**
- Modify: `packages/sakti/src/commands/workflow/shared.ts`

**Step 1: Remove the import and field**

Delete the import line:
```typescript
import type { ReferenceIndexEntry } from '../../core/references.js';
```

Delete the field from the interface (~line 49):
```typescript
  references?: ReferenceIndexEntry[];
```

**Step 2: Verify build**

Run: `node build.js`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add packages/sakti/src/commands/workflow/shared.ts
git commit --no-verify -m "refactor(sakti): remove vestigial references field from shared.ts"
```

---

### Task 2.2: Delete `references.ts` + barrel export

**Files:**
- Delete: `packages/sakti/src/core/references.ts`
- Modify: `packages/sakti/src/core/index.ts` (remove `export * from './references.js'`)

**Step 1: Delete references.ts**

```bash
rm packages/sakti/src/core/references.ts
```

**Step 2: Remove barrel export**

In `packages/sakti/src/core/index.ts`, delete the line:
```typescript
export * from './references.js';
```

**Step 3: Check for stragglers**

Run: `grep -rn "references" packages/sakti/src/ --include="*.ts" | grep -v node_modules | grep -v "// " | grep -v "comment"`
Expected: No imports from `references.js` remain

**Step 4: Verify build + tests**

Run: `node build.js && VITEST_MAX_WORKERS=2 pnpm exec vitest run`
Expected: Build succeeds, same 4 pre-existing failures, zero new failures

**Step 5: Commit**

```bash
git add -A packages/sakti/
git commit --no-verify -m "refactor(sakti): delete orphaned references module (#references)"
```

---

## Phase 3: Simplify Root Selection

**Goal:** Strip `root-selection.ts` from 503 to ~150 lines by removing store-backed root resolution. Only "nearest `.sakti/`" + "implicit fallback" remain.

### Task 3.1: Simplify `resolveSaktiRoot` to nearest-only

**Files:**
- Modify: `packages/sakti/src/core/root-selection.ts`

**Step 1: Remove store-related types**

Change `SaktiRootSource` from:
```typescript
export type SaktiRootSource = 'store' | 'declared' | 'nearest' | 'implicit';
```
To:
```typescript
export type SaktiRootSource = 'nearest' | 'implicit';
```

Remove `storeId?` from `ResolvedSaktiRoot` interface.

Remove `StoreSelectorOptions` interface. Change `ResolveSaktiRootOptions` to:
```typescript
export interface ResolveSaktiRootOptions {
  startPath?: string;
  allowImplicitRoot?: boolean;
}
```

**Step 2: Delete store-specific functions**

Delete these functions entirely:
- `resolveStoreRoot` (~80 lines, line 136)
- `inspectRegisteredStore` (~60 lines, line 230)
- `resolveNearestOrDeclaredRoot` (~50 lines, line 291) — the "declared" branch checks store pointers
- `fromStoreError` (~10 lines, line 93)
- `emitStoreRootBanner` (~10 lines, line 440)
- `withStoreFlag` (~5 lines, line 450)
- `isStoreSelectedRoot` (~5 lines, line 430)

**Step 3: Simplify `resolveSaktiRoot`**

Replace the entire function body with:
```typescript
export async function resolveSaktiRoot(
  options: ResolveSaktiRootOptions = {}
): Promise<ResolvedSaktiRoot> {
  const startPath = options.startPath ?? process.cwd();
  const nearestRoot = findQualifyingRootSync(startPath);
  if (nearestRoot) {
    return makeRoot(nearestRoot, 'nearest');
  }

  if (options.allowImplicitRoot === false) {
    throw new RootSelectionError(
      'No Sakti root found from the current directory.',
      'no_sakti_root',
      { target: 'sakti.root', fix: 'Run sakti new change to create a root here.' }
    );
  }

  return makeRoot(canonicalDirectory(startPath), 'implicit');
}
```

**Step 4: Simplify `resolveRootForCommand`**

Remove the `selector: StoreSelectorOptions` parameter. Replace with:
```typescript
export async function resolveRootForCommand(
  options: {
    json?: boolean;
    failurePayload?: Record<string, unknown>;
    allowImplicitRoot?: boolean;
  } = {}
): Promise<ResolvedSaktiRoot | null> {
  try {
    const root = await resolveSaktiRoot(
      options.allowImplicitRoot !== undefined
        ? { allowImplicitRoot: options.allowImplicitRoot }
        : {}
    );
    return root;
  } catch (error) {
    if (options.json && isRootSelectionError(error)) {
      console.log(
        JSON.stringify(
          { ...(options.failurePayload ?? {}), status: [error.diagnostic] },
          null,
          2
        )
      );
      process.exitCode = 1;
      return null;
    }
    throw error;
  }
}
```

**Step 5: Remove store imports**

Delete these imports from `root-selection.ts`:
```typescript
import { SaktiError } from './errors.js';  // only if fromStoreError was the sole user
import {
  getStoreMetadataPath,
  listStoreRegistryEntries,
  readStoreRegistryState,
  readOptionalStoreMetadataState,
  validateStoreId,
} from './store/foundation.js';
import { getStoreRootForBackend } from './store/registry.js';
```

Keep `import { findRepoPlanningRootSync } from './planning-home.js'` and `import { inspectSaktiRoot } from './sakti-root.js'` only if still used. Check with grep after editing.

**Step 6: Verify build**

Run: `node build.js`

If there are TypeScript errors about removed types/functions, fix the references. The main ones will be:
- `root-selection.ts` internal references to deleted functions
- `ResolvedSaktiRoot.storeId` references elsewhere

Expected: Build may fail initially — fix all type errors by removing references to `storeId`, `store`, `storePath`, `isStoreSelectedRoot`, `withStoreFlag`, `emitStoreRootBanner`.

**Step 7: Commit (even if commands still need cleanup)**

```bash
git add packages/sakti/src/core/root-selection.ts
git commit --no-verify -m "refactor(sakti): simplify root-selection to nearest-only resolution"
```

---

### Task 3.2: Update all command callers

**Files:**
- Modify: `packages/sakti/src/commands/show.ts`
- Modify: `packages/sakti/src/commands/workflow/new-change.ts`
- Modify: `packages/sakti/src/commands/workflow/status.ts`
- Modify: `packages/sakti/src/commands/validate.ts`
- Modify: `packages/sakti/src/core/archive.ts`
- Modify: `packages/sakti/src/cli/index.ts`

**Step 1: Update each command file**

For each file, remove:
- `store?: string` and `storePath?: string` from option interfaces
- `--store` and `--store-path` option registrations
- Imports of `withStoreFlag`, `isStoreSelectedRoot` from root-selection
- Replace `withStoreFlag(root, 'sakti ...')` calls with plain string literals `'sakti ...'`
- Replace `resolveRootForCommand(options, ...)` calls — `options` no longer has `store`/`storePath`, so pass only the output options: `resolveRootForCommand({ json: options.json })`

**For `cli/index.ts`:**
- Remove `STORE_OPTION_DESCRIPTION` constant
- Remove `hiddenStorePathOption` function
- Remove all `.option('--store <id>', ...)` and `.addOption(hiddenStorePathOption())` lines
- Remove `store?` / `storePath?` from action handler type annotations

**For `archive.ts`:**
- Remove `store`/`storePath` from `ArchiveOptions`
- Remove `withStoreFlag`/`isStoreSelectedRoot` imports
- Replace all `withStoreFlag(root, 'sakti archive ...')` with `'sakti archive ...'`
- Remove `store`/`storePath` from the root resolution call

**For `show.ts`:**
- Remove `store`/`storePath` from the options interface
- Remove `withStoreFlag`/`isStoreSelectedRoot` imports and usages
- Simplify the `resolveRootForCommand` call

**For `new-change.ts`:**
- Remove `store`/`storePath` from `NewChangeOptions`
- Remove `withStoreFlag`/`isStoreSelectedRoot` imports and usages

**For `status.ts`:**
- Remove `store`/`storePath` from `StatusOptions`
- Remove `withStoreFlag` import if still present

**For `validate.ts`:**
- Remove `store`/`storePath` from options
- Remove store-related imports

**Step 2: Verify build**

Run: `node build.js`
Expected: Build succeeds with zero type errors

**Step 3: Run tests**

Run: `VITEST_MAX_WORKERS=2 pnpm exec vitest run`
Expected: Same 4 pre-existing failures, zero new failures. Some store tests may now fail differently (they pass `--store` flags) — that's expected, they'll be deleted in Phase 4.

**Step 4: Commit**

```bash
git add -A packages/sakti/
git commit --no-verify -m "refactor(sakti): remove --store flags from all commands"
```

---

## Phase 4: Delete Store System

**Goal:** Delete the entire store directory, store command, and all store tests.

### Task 4.1: Delete store source files

**Files:**
- Delete: `packages/sakti/src/core/store/` (entire directory: errors.ts, foundation.ts, registry.ts, operations.ts, git.ts, index.ts)
- Delete: `packages/sakti/src/commands/store.ts`
- Modify: `packages/sakti/src/cli/index.ts` (remove store command import + registration)
- Modify: `packages/sakti/src/core/index.ts` (remove `export * from './store/index.js'`)

**Step 1: Delete store source**

```bash
rm -rf packages/sakti/src/core/store/
rm packages/sakti/src/commands/store.ts
```

**Step 2: Remove CLI registration**

In `packages/sakti/src/cli/index.ts`, remove:
```typescript
import { registerStoreCommand } from '../commands/store.js';
```
And:
```typescript
registerStoreCommand(program);
```

**Step 3: Remove barrel export**

In `packages/sakti/src/core/index.ts`, remove:
```typescript
export * from './store/index.js';
```

**Step 4: Check for stragglers**

Run: `grep -rn "core/store/\|commands/store\|registerStoreCommand\|store/foundation\|store/registry\|store/operations\|store/git\|store/errors" packages/sakti/src/ --include="*.ts"`
Expected: No remaining imports from store modules

**Step 5: Verify build**

Run: `node build.js`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add -A packages/sakti/
git commit --no-verify -m "refactor(sakti): delete store system source (3055 lines)"
```

---

### Task 4.2: Delete store tests

**Files:**
- Delete: `packages/sakti/test/commands/store.test.ts`
- Delete: `packages/sakti/test/commands/store-remote.test.ts`
- Delete: `packages/sakti/test/commands/store-root-selection.test.ts`
- Delete: `packages/sakti/test/commands/store-git.test.ts`
- Delete: `packages/sakti/test/commands/declared-store-fallback.test.ts`
- Delete: `packages/sakti/test/cli-e2e/store-lifecycle.test.ts`
- Delete: `packages/sakti/test/core/store/` (entire directory: registry.test.ts, foundation.test.ts)

**Step 1: Delete all store test files**

```bash
rm packages/sakti/test/commands/store.test.ts
rm packages/sakti/test/commands/store-remote.test.ts
rm packages/sakti/test/commands/store-root-selection.test.ts
rm packages/sakti/test/commands/store-git.test.ts
rm packages/sakti/test/commands/declared-store-fallback.test.ts
rm packages/sakti/test/cli-e2e/store-lifecycle.test.ts
rm -rf packages/sakti/test/core/store/
```

**Step 2: Check for remaining store references in tests**

Run: `grep -rn "\-\-store\|store register\|registerStore\|StoreError\|StoreDiagnostic\|store doctor\|store setup" packages/sakti/test/ --include="*.ts" | grep -v node_modules`
Fix any remaining references. Tests that use store fixtures (`createSaktiRoot`, `registerStore`) in non-store contexts may need updating.

**Step 3: Run tests**

Run: `VITEST_MAX_WORKERS=2 pnpm exec vitest run`
Expected: Only 1 pre-existing failure remains (`source-specs-normalization.test.ts`). The other 3 pre-existing failures are gone (their test files deleted). Zero new failures.

**Step 4: Commit**

```bash
git add -A packages/sakti/
git commit --no-verify -m "test(sakti): delete store test suite (4135 lines)"
```

---

### Task 4.3: Clean up store fixtures + helpers

**Files:**
- Check: `packages/sakti/test/helpers/` for store-specific helpers
- Check: `packages/sakti/test/commands/legacy-groups-removed.test.ts` for store references
- Check: any test importing `registerStore` or `getGlobalDataDir` from the barrel

**Step 1: Find and clean stragglers**

Run: `grep -rn "registerStore\|getGlobalDataDir\|store\|StoreError\|SaktiError" packages/sakti/test/ --include="*.ts" | grep -v node_modules | grep -v "store.test"`

Update any test that imports `registerStore` from the barrel — it no longer exists. Tests that set up store fixtures need to be rewritten to use plain `.sakti/` directories.

**Step 2: Verify build + tests**

Run: `node build.js && VITEST_MAX_WORKERS=2 pnpm exec vitest run`
Expected: Build succeeds, only 1 pre-existing failure (`source-specs-normalization.test.ts`), zero new failures

**Step 3: Commit**

```bash
git add -A packages/sakti/
git commit --no-verify -m "test(sakti): clean up store fixture references"
```

---

### Task 4.4: Clean up `src/core/errors.ts` — remove store alias

**Files:**
- Modify: `packages/sakti/src/core/store/errors.ts` (should already be deleted in 4.1)
- Verify: no remaining `StoreError`/`StoreDiagnostic`/`makeStoreDiagnostic` references

**Step 1: Verify no aliases remain**

Run: `grep -rn "StoreError\|StoreDiagnostic\|makeStoreDiagnostic\|store/errors" packages/sakti/src/ --include="*.ts"`
Expected: Clean (the store/errors.ts file was deleted in Task 4.1)

If any remain, update them to use `SaktiError`/`Diagnostic`/`makeDiagnostic` from `errors.ts`.

**Step 2: Verify build + tests**

Run: `node build.js && VITEST_MAX_WORKERS=2 pnpm exec vitest run`
Expected: Build succeeds, only 1 pre-existing failure, zero new failures

**Step 3: Commit (if changes)**

```bash
git add -A packages/sakti/
git commit --no-verify -m "refactor(sakti): remove final StoreError aliases"
```

---

## Phase 5: Final Cleanup

### Task 5.1: Remove `--store-path` hidden option infrastructure

**Files:**
- Check: `packages/sakti/src/cli/index.ts`

Verify that `hiddenStorePathOption`, `STORE_OPTION_DESCRIPTION`, and all `.addOption(hiddenStorePathOption())` calls are removed. These should have been removed in Task 3.2 but double-check.

**Step 1: Grep for stragglers**

Run: `grep -n "storePath\|STORE_OPTION\|hiddenStorePath" packages/sakti/src/cli/index.ts`
Expected: Clean

---

### Task 5.2: Update SIMPLIFICATION_REVIEW.md

**Files:**
- Modify: `packages/sakti/SIMPLIFICATION_REVIEW.md`

Mark #5 Store System as ✅ Done. Update the summary table and line count totals.

**Step 1: Update the checklist**

Change #5 from ⬜ Pending to ✅ Done with description.

**Step 2: Update summary table**

Update line counts. After this plan: ~29,000+ lines deleted total, only 1 pre-existing test failure remains.

**Step 3: Commit**

```bash
git add packages/sakti/SIMPLIFICATION_REVIEW.md
git commit --no-verify -m "docs(sakti): mark #5 store system complete in simplification review"
```

---

## Summary

| Phase | What | Lines removed | Key risk |
|-------|------|---------------|----------|
| 1 | Extract error types | 0 net | Low — alias re-exports keep everything working |
| 2 | Delete references.ts | -407 | None — already orphaned |
| 3 | Simplify root-selection | -300 | Medium — touches 6+ command files |
| 4 | Delete store system + tests | -7,190 | Low — deletion after deps removed |
| 5 | Final cleanup | ~0 | None |

**Total: ~7,900 lines removed.** After completion, the only remaining pre-existing test failure is `source-specs-normalization.test.ts`.
