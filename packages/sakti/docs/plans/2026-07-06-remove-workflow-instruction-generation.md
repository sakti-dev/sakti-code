# Remove Workflow Instruction Generation (Clusters #1 + #2)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the workflow instruction-generation commands and their template content from `packages/sakti/`, keeping only the `new change` and `status` scaffolding commands.

**Architecture:** The workflow cluster has two halves: (1) CLI commands that generate instruction text (`instructions`, `templates`, `schemas`) and (2) TypeScript template files that produce the text content. These form a closed dependency unit — nothing outside the workflow directory imports from the templates. We delete the instruction-generation commands and all template files, then trim the CLI registrations and barrel exports. The `new change` and `status` commands stay because the bundled skill still needs directory scaffolding and artifact status checking.

**Tech Stack:** TypeScript, Commander.js, Vitest, pnpm

**Context:**
- Commit with `--no-verify` (pre-commit `vp check --fix` fails on bulk deletions)
- Build command: `node build.js` (runs `tsc`)
- Test command: `VITEST_MAX_WORKERS=2 pnpm exec vitest run`
- All paths relative to `packages/sakti/`

---

## Files to Delete (28 files, ~4,500 lines)

### Template files (cluster #2):
- `src/core/templates/workflows/onboard.ts`
- `src/core/templates/workflows/propose.ts`
- `src/core/templates/workflows/new-change.ts`
- `src/core/templates/workflows/continue-change.ts`
- `src/core/templates/workflows/ff-change.ts`
- `src/core/templates/workflows/apply-change.ts`
- `src/core/templates/workflows/verify-change.ts`
- `src/core/templates/workflows/archive-change.ts`
- `src/core/templates/workflows/bulk-archive-change.ts`
- `src/core/templates/workflows/sync-specs.ts`
- `src/core/templates/workflows/explore.ts`
- `src/core/templates/workflows/feedback.ts`
- `src/core/templates/workflows/store-selection.ts`
- `src/core/templates/skill-templates.ts`
- `src/core/templates/index.ts`

### Instruction-generation commands (cluster #1, partial):
- `src/commands/workflow/instructions.ts`
- `src/commands/workflow/templates.ts`
- `src/commands/workflow/schemas.ts`

### Artifact-graph instruction-loading (only used by `instructions` command):
- `src/core/artifact-graph/instruction-loader.ts`
- `test/core/artifact-graph/instruction-loader.test.ts`

## Files to Modify

- `src/commands/workflow/index.ts` — remove exports for deleted commands
- `src/cli/index.ts` — remove imports + command registrations for `instructions`, `templates`, `schemas`
- `src/core/artifact-graph/index.ts` — remove re-exports of deleted instruction-loader
- `src/core/index.ts` — remove re-export of deleted templates module (if present)
- `test/cli-e2e/basic.test.ts` — remove test cases for deleted commands
- `test/commands/artifact-workflow.test.ts` — remove test blocks for deleted commands
- `test/cli-e2e/capstone-journeys.test.ts` — remove `instructions` calls from journey test
- `test/core/artifact-graph/workflow.integration.test.ts` — remove or trim instruction-loading tests

## Files to Keep (DO NOT DELETE)

- `src/commands/workflow/new-change.ts` (168 lines) — `sakti new change <name>`
- `src/commands/workflow/status.ts` (152 lines) — `sakti status --change <name>`
- `src/commands/workflow/shared.ts` (201 lines) — shared utilities used by both
- `src/commands/workflow/index.ts` (trimmed) — barrel exports for the above
- `src/core/artifact-graph/schema.ts` — schema parsing (used by task-progress)
- `src/core/artifact-graph/resolver.ts` — schema resolution (used by task-progress)
- `src/core/artifact-graph/graph.ts` — dependency graph (used by status command)
- `src/core/artifact-graph/types.ts` — type definitions
- `src/core/artifact-graph/index.ts` (trimmed) — barrel exports

---

### Task 1: Delete template files (cluster #2)

**Files:**
- Delete: `src/core/templates/workflows/` (13 files)
- Delete: `src/core/templates/skill-templates.ts`
- Delete: `src/core/templates/index.ts`
- Delete: `src/core/templates/` (directory itself, now empty)

**Step 1: Delete the entire templates directory**

```bash
rm -rf src/core/templates/
```

**Step 2: Verify no remaining imports of templates**

Run:
```bash
grep -rn "core/templates\|skill-templates\|templates/workflows" src/ --include="*.ts"
```

Expected: no output (all references gone). If any remain, note them — they'll be handled in Task 4.

**Step 3: Verify build still compiles**

```bash
node build.js
```

Expected: `Build completed successfully!` — templates were only consumed by instruction-generation commands (deleted in Task 3), so the build may already break if commands still import them. If it fails, that's expected — proceed to Task 3 to remove the importing commands.

**Step 4: Commit**

```bash
git add -A packages/sakti/
git commit --no-verify -m "refactor(sakti): delete workflow template files (3,772 lines)

Instruction generation will be bundled as static skill files
in the desktop app. Removes:
- src/core/templates/workflows/ (13 workflow instruction generators)
- src/core/templates/skill-templates.ts
- src/core/templates/index.ts"
```

---

### Task 2: Delete instruction-loader (artifact-graph)

**Files:**
- Delete: `src/core/artifact-graph/instruction-loader.ts`
- Delete: `test/core/artifact-graph/instruction-loader.test.ts`

**Step 1: Check who imports instruction-loader**

Run:
```bash
grep -rn "instruction-loader" src/ test/ --include="*.ts"
```

Expected: only `src/core/artifact-graph/index.ts` re-exports it, and the deleted `instructions.ts` command imported from it. If other files reference it, stop and document them.

**Step 2: Delete the files**

```bash
rm src/core/artifact-graph/instruction-loader.ts
rm test/core/artifact-graph/instruction-loader.test.ts
```

**Step 3: Commit**

```bash
git add -A packages/sakti/
git commit --no-verify -m "refactor(sakti): delete artifact-graph instruction-loader

Only used by the deleted instructions command."
```

---

### Task 3: Delete instruction-generation commands

**Files:**
- Delete: `src/commands/workflow/instructions.ts`
- Delete: `src/commands/workflow/templates.ts`
- Delete: `src/commands/workflow/schemas.ts`

**Step 1: Verify no cross-dependencies**

Run:
```bash
grep -rn "workflow/instructions\|workflow/templates\|workflow/schemas" src/ --include="*.ts" | grep -v "src/commands/workflow/index.ts"
```

Expected: no output. Only `workflow/index.ts` barrel re-exports them (handled in Task 4).

**Step 2: Delete the files**

```bash
rm src/commands/workflow/instructions.ts
rm src/commands/workflow/templates.ts
rm src/commands/workflow/schemas.ts
```

**Step 3: Commit**

```bash
git add -A packages/sakti/
git commit --no-verify -m "refactor(sakti): delete instruction-generation commands

Removes instructions, templates, schemas commands.
Keeps new-change and status scaffolding commands."
```

---

### Task 4: Trim workflow barrel exports

**Files:**
- Modify: `src/commands/workflow/index.ts`

**Step 1: Read current file**

Run: `cat src/commands/workflow/index.ts`

Current content:
```typescript
export { statusCommand } from './status.js';
export type { StatusOptions } from './status.js';

export { instructionsCommand, applyInstructionsCommand } from './instructions.js';
export type { InstructionsOptions } from './instructions.js';

export { templatesCommand } from './templates.js';
export type { TemplatesOptions } from './templates.js';

export { schemasCommand } from './schemas.js';
export type { SchemasOptions } from './schemas.js';

export { newChangeCommand } from './new-change.js';
export type { NewChangeOptions } from './new-change.js';

export { DEFAULT_SCHEMA } from './shared.js';
```

**Step 2: Rewrite to remove deleted exports**

Replace the entire file with:

```typescript
/**
 * Workflow CLI Commands
 *
 * Commands for the artifact-driven workflow: status, new change.
 */

export { statusCommand } from './status.js';
export type { StatusOptions } from './status.js';

export { newChangeCommand } from './new-change.js';
export type { NewChangeOptions } from './new-change.js';

export { DEFAULT_SCHEMA } from './shared.js';
```

**Step 3: Commit**

```bash
git add packages/sakti/src/commands/workflow/index.ts
git commit --no-verify -m "refactor(sakti): trim workflow barrel exports"
```

---

### Task 5: Trim artifact-graph barrel exports

**Files:**
- Modify: `src/core/artifact-graph/index.ts`

**Step 1: Read current file**

Run: `cat src/core/artifact-graph/index.ts`

**Step 2: Remove instruction-loader re-exports**

Delete any lines that reference `instruction-loader` or `InstructionLoader` or types exported from it (e.g., `LoadInstructionsOptions`, `LoadedInstruction`, `ApplyInstructions`, `PlanningHomeSummary`). Keep exports for `schema.ts`, `resolver.ts`, `graph.ts`, `types.ts`.

**Step 3: Verify build compiles**

```bash
node build.js
```

Expected: `Build completed successfully!`

If build fails due to missing imports in `shared.ts` or `status.ts` (they may reference instruction-loader types), check what they actually import and inline or simplify.

**Step 4: Commit**

```bash
git add packages/sakti/src/core/artifact-graph/index.ts
git commit --no-verify -m "refactor(sakti): trim artifact-graph barrel exports"
```

---

### Task 6: Remove core/index.ts templates re-export

**Files:**
- Modify: `src/core/index.ts`

**Step 1: Check for templates re-export**

Run:
```bash
grep -n "templates" src/core/index.ts
```

If there's a line like `export * from './templates.js';`, remove it. If not present, skip this task.

**Step 2: Verify build**

```bash
node build.js
```

Expected: `Build completed successfully!`

**Step 3: Commit (only if changed)**

```bash
git add packages/sakti/src/core/index.ts
git commit --no-verify -m "refactor(sakti): remove templates re-export from core barrel"
```

---

### Task 7: Update CLI registrations

**Files:**
- Modify: `src/cli/index.ts`

**Step 1: Read the import block**

Lines ~26-38 currently import:
```typescript
import {
  statusCommand,
  instructionsCommand,      // DELETE
  applyInstructionsCommand, // DELETE
  templatesCommand,         // DELETE
  schemasCommand,           // DELETE
  newChangeCommand,
  DEFAULT_SCHEMA,
  type StatusOptions,
  type InstructionsOptions, // DELETE
  type TemplatesOptions,    // DELETE
  type SchemasOptions,      // DELETE
  type NewChangeOptions,
} from '../commands/workflow/index.js';
```

**Step 2: Trim the import block**

Replace with:
```typescript
import {
  statusCommand,
  newChangeCommand,
  DEFAULT_SCHEMA,
  type StatusOptions,
  type NewChangeOptions,
} from '../commands/workflow/index.js';
```

**Step 3: Remove command registrations**

Delete the entire `instructions` command block (the `program.command('instructions [artifact]')...` block with its `.action()` that calls `instructionsCommand` / `applyInstructionsCommand`).

Delete the entire `templates` command block (the `program.command('templates')...` block).

Delete the entire `schemas` command block (the `program.command('schemas')...` block).

Keep the `status` command block and the `new change` command block.

**Step 4: Verify no remaining references to deleted commands**

Run:
```bash
grep -n "instructionsCommand\|applyInstructionsCommand\|templatesCommand\|schemasCommand\|InstructionsOptions\|TemplatesOptions\|SchemasOptions" src/cli/index.ts
```

Expected: no output.

**Step 5: Verify build**

```bash
node build.js
```

Expected: `Build completed successfully!`

**Step 6: Verify CLI runs**

```bash
node bin/sakti.js --help
```

Expected: help output WITHOUT `instructions`, `templates`, or `schemas` in the command list. Should still show `status` and `new change`.

**Step 7: Commit**

```bash
git add packages/sakti/src/cli/index.ts
git commit --no-verify -m "refactor(sakti): remove instructions/templates/schemas CLI commands

Skill instruction generation will be bundled in the desktop app."
```

---

### Task 8: Clean up e2e basic tests

**Files:**
- Modify: `test/cli-e2e/basic.test.ts`

**Step 1: Read the file**

Run: `cat test/cli-e2e/basic.test.ts`

Identify these test cases to remove:
- `it('keeps schemas --json free of spinner output', ...)` (line ~73)
- `it('keeps instructions --json free of spinner output', ...)` (line ~85)
- `it('keeps instructions apply --json free of spinner output', ...)` (line ~93)
- `it('keeps templates --json free of spinner output', ...)` (line ~101)

**Step 2: Remove those test cases**

Delete each `it(...)` block for the four cases above. Keep:
- `it('shows help output', ...)`
- `it('reports the package version', ...)`
- `it('validates the tmp-init fixture with --all --json', ...)`
- `it('keeps list --json free of spinner output', ...)`
- `it('keeps status --json free of spinner output', ...)`
- `it('returns an error for unknown items in the fixture', ...)`

**Step 3: Run the test file**

```bash
VITEST_MAX_WORKERS=2 pnpm exec vitest run test/cli-e2e/basic.test.ts
```

Expected: all remaining tests pass.

**Step 4: Commit**

```bash
git add packages/sakti/test/cli-e2e/basic.test.ts
git commit --no-verify -m "test(sakti): remove e2e tests for deleted commands"
```

---

### Task 9: Clean up artifact-workflow tests

**Files:**
- Modify: `test/commands/artifact-workflow.test.ts`

**Step 1: Find blocks to remove**

Run:
```bash
grep -n "describe(" test/commands/artifact-workflow.test.ts
```

Identify these `describe` blocks to remove entirely:
- `describe('instructions command', ...)` (line ~217)
- `describe('templates command', ...)` (line ~295)
- `describe('instructions apply command', ...)` (line ~422)
- `describe('instructions command with config', ...)` (line ~747)

Also remove individual `it(...)` cases outside `describe` blocks that test deleted commands:
- `it('instructions command help shows description', ...)` (line ~686)
- `it('templates command help shows description', ...)` (line ~692)

**Step 2: Remove those blocks**

Delete each `describe(...)` or standalone `it(...)` block identified above. Be careful to remove the entire block including all nested `it(...)` cases.

**Step 3: Check for any remaining references**

Run:
```bash
grep -n "instructions\|templates\|schemas" test/commands/artifact-workflow.test.ts
```

Expected: no references to the deleted commands. (Comments mentioning "instructions" conceptually are fine to clean up or leave.)

**Step 4: Run the test file**

```bash
VITEST_MAX_WORKERS=2 pnpm exec vitest run test/commands/artifact-workflow.test.ts
```

Expected: all remaining tests pass.

**Step 5: Commit**

```bash
git add packages/sakti/test/commands/artifact-workflow.test.ts
git commit --no-verify -m "test(sakti): remove artifact-workflow tests for deleted commands"
```

---

### Task 10: Clean up capstone-journeys test

**Files:**
- Modify: `test/cli-e2e/capstone-journeys.test.ts`

**Step 1: Read the file to understand the journey**

Run: `cat test/cli-e2e/capstone-journeys.test.ts`

The test runs a full lifecycle: create change → check status → **call `instructions` for each artifact** → write artifacts → archive.

The `instructions` calls (lines ~131-158) are used to get the `outputPath` for each artifact. Without the `instructions` command, the test needs to hardcode the expected paths.

**Step 2: Replace the instructions loop with hardcoded paths**

Find the block that loops through artifacts calling `sakti instructions <artifact.id> --change <name> --json` (lines ~131-158).

Replace it with direct file writes using known paths from the spec-driven schema:

```typescript
// Write artifacts directly — paths are known from the spec-driven schema.
const artifactTargets: Record<string, string> = {
  proposal: path.join(changeDir, 'proposal.md'),
  design: path.join(changeDir, 'design.md'),
  tasks: path.join(changeDir, 'tasks.md'),
};
// specs uses a subdirectory
const specsTarget = path.join(changeDir, 'specs', 'api', 'spec.md');

for (const artifact of artifacts) {
  const target =
    artifact.id === 'specs'
      ? specsTarget
      : artifactTargets[artifact.id];
  if (!target) continue;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    artifact.id === 'specs'
      ? '## ADDED Requirements\n\n### Requirement: Rate limits\nThe API SHALL rate-limit.\n\n#### Scenario: Limit hit\n- **WHEN** the limit is exceeded\n- **THEN** requests are rejected\n'
      : `# ${artifact.id}\n\nDone.\n`
  );
}
```

**Step 3: Run the test**

```bash
VITEST_MAX_WORKERS=2 pnpm exec vitest run test/cli-e2e/capstone-journeys.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add packages/sakti/test/cli-e2e/capstone-journeys.test.ts
git commit --no-verify -m "test(sakti): replace instructions calls with hardcoded paths in journey"
```

---

### Task 11: Clean up artifact-graph integration test

**Files:**
- Modify or Delete: `test/core/artifact-graph/workflow.integration.test.ts`

**Step 1: Check what the integration test covers**

Run:
```bash
grep -n "describe\|it(" test/core/artifact-graph/workflow.integration.test.ts | head -20
```

**Step 2: If it only tests instruction loading, delete it**

If all test cases call `instruction-loader` functions or the `instructions` command:

```bash
rm test/core/artifact-graph/workflow.integration.test.ts
```

**Step 3: If it tests other artifact-graph behavior, trim instruction-related cases**

Remove only the `it(...)` cases that reference instruction loading. Keep cases that test schema resolution, graph building, etc.

**Step 4: Run the test file (if not deleted)**

```bash
VITEST_MAX_WORKERS=2 pnpm exec vitest run test/core/artifact-graph/workflow.integration.test.ts
```

Expected: PASS (or file deleted).

**Step 5: Commit**

```bash
git add -A packages/sakti/test/core/artifact-graph/
git commit --no-verify -m "test(sakti): clean up artifact-graph integration tests"
```

---

### Task 12: Final build + full test run

**Step 1: Clean build**

```bash
rm -rf dist/ && node build.js
```

Expected: `Build completed successfully!`

**Step 2: Run full test suite**

```bash
VITEST_MAX_WORKERS=2 pnpm exec vitest run > /tmp/sakti-test-final.txt 2>&1
grep -E 'Test Files|Tests ' /tmp/sakti-test-final.txt | tail -3
```

Expected: test count should be ~960+ passing (down from 1014 — we removed test cases). Failures should be the same 10 pre-existing ones (or fewer, since some pre-existing failures may have been in deleted tests).

**Step 3: Verify CLI command list**

```bash
node bin/sakti.js --help
```

Verify the output does NOT contain: `instructions`, `templates`, `schemas`.
Verify the output DOES contain: `status`, `new`, `list`, `view`, `change`, `spec`, `validate`, `archive`, `store`, `doctor`, `context`, `workset`, `config`, `schema`, `feedback`.

**Step 4: Commit any remaining changes**

```bash
git add -A packages/sakti/
git commit --no-verify -m "chore(sakti): final cleanup after workflow removal"
```

---

## Pre-existing Test Failures (reference)

These 10 failures existed BEFORE this work and are unrelated:

1. `workset.test.ts` (4): opener config exit codes and args mismatches
2. `artifact-workflow.test.ts` (2): instructions apply exit code (may be removed by this plan)
3. `store-lifecycle.test.ts` (1): end-state directory regex
4. `store.test.ts` (1): command hint with `--store` flag
5. `store/registry.test.ts` (1): error handling
6. `telemetry/index.test.ts` (1): DELETED (telemetry already removed)
7. `source-specs-normalization.test.ts` (1): spec normalization edge case

After this plan, failures #2 and #6 should be gone (their test cases are deleted). Expected remaining: ~8 pre-existing failures.
