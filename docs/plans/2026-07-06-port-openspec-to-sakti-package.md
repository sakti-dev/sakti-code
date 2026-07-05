# Port OpenSpec CLI to `@sakti-code/sakti` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Copy the OpenSpec reference CLI into `packages/sakti/` as the `sakti` CLI, renaming all "openspec" references to "sakti" (project dir `.sakti/`, metadata `.sakti.yaml`, slash commands `sakti:*`).

**Architecture:** The OpenSpec reference (`openspec/references/OpenSpec/`) is a Commander-based CLI with 100+ TypeScript source files. We copy it verbatim into the sakti-code monorepo as `packages/sakti/`, then do global find-and-replace to rename all OpenSpec-specific identifiers to Sakti equivalents. The package exposes a `sakti` binary and follows the monorepo's `vp pack` build convention.

**Tech Stack:** TypeScript, Commander, Zod, chalk, ora, @inquirer, yaml, vitest

---

### Task 1: Create package directory and copy files

**Files:**

- Create: `packages/sakti/`
- Modify: none
- Test: `ls packages/sakti/src/core/index.ts` exists

**Step 1: Create the directory structure**

Run:

```bash
mkdir -p packages/sakti
```

**Step 2: Copy source files from OpenSpec reference**

Run:

```bash
cp -r openspec/references/OpenSpec/src packages/sakti/src
cp -r openspec/references/OpenSpec/test packages/sakti/test
cp -r openspec/references/OpenSpec/schemas packages/sakti/schemas
cp -r openspec/references/OpenSpec/scripts packages/sakti/scripts
cp openspec/references/OpenSpec/vitest.config.ts packages/sakti/vitest.config.ts
cp openspec/references/OpenSpec/vitest.setup.ts packages/sakti/vitest.setup.ts
cp openspec/references/OpenSpec/build.js packages/sakti/build.js
cp openspec/references/OpenSpec/AGENTS.md packages/sakti/AGENTS.md
cp openspec/references/OpenSpec/.gitignore packages/sakti/.gitignore
```

**Step 3: Verify copy succeeded**

Run:

```bash
ls packages/sakti/src/core/index.ts
ls packages/sakti/test/helpers/run-cli.ts
```

**Step 4: Commit**

```bash
git add packages/sakti/
git commit -m "feat(sakti): copy OpenSpec CLI source into packages/sakti"
```

---

### Task 2: Create and adapt package.json

**Files:**

- Create: `packages/sakti/package.json`

**Step 1: Write the adapted package.json**

Create `packages/sakti/package.json`:

- name: `@sakti-code/sakti`
- version: `0.0.0` (matches other packages)
- type: `module`
- bin: `{ "sakti": "./bin/sakti.js" }`
- exports: same pattern as other packages (development → `./src/index.ts`, default → `./dist/index.js`)
- main: `./dist/index.js`
- types: `./dist/index.d.ts`
- files: `["dist", "bin", "schemas", "scripts"]`
- scripts: build uses `vp pack` (monorepo convention), test uses `vitest run`
- dependencies: copy from OpenSpec (commander, zod, chalk, ora, @inquirer/prompts, cross-spawn, fast-glob, yaml, posthog-node)
- devDependencies: @types/node, vitest, vite-plus

Key differences from OpenSpec's package.json:

- Build script: `vp pack` instead of `node build.js`
- No prepare/prepublishOnly scripts
- No lint/config for ESLint (monorepo uses `vp check`)
- No changesets (handled at workspace level)

**Step 2: Commit**

```bash
git add packages/sakti/package.json
git commit -m "feat(sakti): add package.json adapted for monorepo"
```

---

### Task 3: Create and adapt tsconfig.json

**Files:**

- Create: `packages/sakti/tsconfig.json`

**Step 1: Write the adapted tsconfig.json**

Create `packages/sakti/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"],
  "compilerOptions": {
    "strictNullChecks": true,
    "types": ["node"]
  }
}
```

Note: The base tsconfig has `noEmit: true` and `bundler` module resolution. The OpenSpec source uses `.js` import extensions (NodeNext style). The `bundler` module resolution still handles `.js` → `.ts` resolution, so this should work.

**Step 2: Commit**

```bash
git add packages/sakti/tsconfig.json
git commit -m "feat(sakti): add tsconfig extending workspace base"
```

---

### Task 4: Create bin/sakti.js entrypoint

**Files:**

- Create: `packages/sakti/bin/sakti.js`
- Test: `node packages/sakti/bin/sakti.js --help`

**Step 1: Write the bin entrypoint**

```javascript
#!/usr/bin/env node

import { runCli } from "../dist/cli/index.js";

runCli();
```

**Step 2: Make it executable**

```bash
chmod +x packages/sakti/bin/sakti.js
```

**Step 3: Quick validation (will fail until build, but verify syntax)**

```bash
node packages/sakti/bin/sakti.js --help
```

Expected: Error about missing dist/ or module not found (that's OK — dist doesn't exist yet).

**Step 4: Commit**

```bash
git add packages/sakti/bin/sakti.js
git commit -m "feat(sakti): add CLI binary entrypoint"
```

---

### Task 5: Implement send-based find-and-replace for `.openspec.yaml` → `.sakti.yaml`

**Files:**

- Modify: all `.ts` files in `packages/sakti/src/` and `packages/sakti/test/` that reference `.openspec.yaml`

**Step 1: Find all occurrences**

Run:

```bash
rg '\.openspec\.yaml' packages/sakti/ --files-with-matches
```

**Step 2: Replace in all files**

```bash
rg '\.openspec\.yaml' packages/sakti/ --files-with-matches | while read f; do
  sed -i 's/\.openspec\.yaml/\.sakti\.yaml/g' "$f"
done
```

**Step 3: Verify no remaining occurrences**

```bash
rg '\.openspec\.yaml' packages/sakti/
```

Expected: no matches.

**Step 4: Commit**

```bash
git add -u
git commit -m "feat(sakti): rename .openspec.yaml → .sakti.yaml"
```

---

### Task 6: Replace project directory `openspec/` → `.sakti/` in path references

**Files:**

- Modify: all `.ts` files in `packages/sakti/src/` and `packages/sakti/test/` that reference `'openspec'` or `"openspec"` or `` `openspec` `` as a directory path

**Step 1: Analyze the pattern**

The project directory `openspec/` appears in path constructions like:

- `path.join(root, 'openspec', 'changes')`
- `path.join(projectRoot, 'openspec', 'specs')`
- `'openspec/'` in constants
- `openspec/` in glob patterns and error messages

We need to replace `'openspec'` → `'.sakti'` when it's used as a directory segment. BUT we must NOT replace `'openspec'` when it's the CLI name (like in error messages).

**Step 2: Review all matches manually**

First, list all files and their `openspec` occurrences:

```bash
rg 'openspec' packages/sakti/src/ --files-with-matches
```

For each file, inspect the context and decide which replacements are needed. The critical ones:

- `src/core/global-config.ts`: `GLOBAL_CONFIG_DIR_NAME = 'openspec'` → `GLOBAL_CONFIG_DIR_NAME = 'sakti'` (and DATA dir)
- `src/utils/item-discovery.ts`: `path.join(root, 'openspec', 'changes')` → `path.join(root, '.sakti', 'changes')`
- `src/utils/change-utils.ts`: `path.join(options.changesDir ?? path.join(projectRoot, 'openspec', 'changes'), name)` → `.sakti`
- `src/utils/change-metadata.ts`: METADATA_FILENAME already handled in Task 5
- `src/core/list.ts`: path references
- `src/core/working-set.ts`: role strings
- All test files that construct paths

**Step 3: Apply targeted replacements**

For the path-construction pattern, we need to replace:

- `'openspec'` → `'.sakti'` when used as a path segment (like `'openspec', 'changes'`)
- But NOT when it's a CLI description (like `'openspec list'`)

The safest approach: replace `'openspec'` only in path-join contexts:

```bash
rg 'openspec' packages/sakti/ --files-with-matches --type ts | while read f; do
  # Replace path-construction patterns with '.sakti'
  sed -i "s/join(root, 'openspec'/join(root, '.sakti'/g" "$f"
  sed -i "s/join(projectRoot, 'openspec'/join(projectRoot, '.sakti'/g" "$f"
  sed -i "s/join(targetPath, 'openspec'/join(targetPath, '.sakti'/g" "$f"
  sed -i "s/join(dirPath, 'openspec'/join(dirPath, '.sakti'/g" "$f"
  sed -i "s/join(changesDir ?? path.join(projectRoot, 'openspec'/join(changesDir ?? path.join(projectRoot, '.sakti'/g" "$f"
  sed -i "s/'openspec', 'changes'/'.sakti', 'changes'/g" "$f"
  sed -i "s/'openspec', 'specs'/'.sakti', 'specs'/g" "$f"
  sed -i "s/'openspec', 'config'/'.sakti', 'config'/g" "$f"
  sed -i "s/'openspec', 'AGENTS'/'.sakti', 'AGENTS'/g" "$f"
  sed -i "s/'openspec', 'explorations'/'.sakti', 'explorations'/g" "$f"
  sed -i "s/'openspec', 'project.md'/'.sakti', 'project.md'/g" "$f"
  sed -i "s/'openspec\/changes'/'.sakti\/changes'/g" "$f"
  sed -i "s/'openspec\/specs'/'.sakti\/specs'/g" "$f"
  sed -i "s/'openspec\/AGENTS.md'/'.sakti\/AGENTS.md'/g" "$f"
  sed -i "s/'openspec\/config.yaml'/'.sakti\/config.yaml'/g" "$f"
  sed -i "s/'openspec\/project.md'/'.sakti\/project.md'/g" "$f"
  sed -i "s/openspecDir = path.join(projectRoot, 'openspec'/openspecDir = path.join(projectRoot, '.sakti'/g" "$f"
  # Also handle the GLOBAL_CONFIG_DIR_NAME and GLOBAL_DATA_DIR_NAME
  sed -i "s/GLOBAL_CONFIG_DIR_NAME = 'openspec'/GLOBAL_CONFIG_DIR_NAME = 'sakti'/g" "$f"
  sed -i "s/GLOBAL_DATA_DIR_NAME = 'openspec'/GLOBAL_DATA_DIR_NAME = 'sakti'/g" "$f"
done
```

**Step 4: Check for remaining `/openspec/` patterns**

```bash
rg "['\"\`]openspec['\"\`]" packages/sakti/src/ | grep -v "node_modules" | grep -v "\.openspec"
```

**Step 5: Also update the `GLOBAL_CONFIG_DIR_NAME` and `GLOBAL_DATA_DIR_NAME` constant values manually**

Read `packages/sakti/src/core/global-config.ts` and verify:

- `GLOBAL_CONFIG_DIR_NAME = 'sakti'`
- `GLOBAL_DATA_DIR_NAME = 'sakti'`

Also update the comments that mention config paths like `~/.config/openspec/` → `~/.config/sakti/`.

**Step 6: Commit**

```bash
git add -u
git commit -m "feat(sakti): rename project dir openspec/ → .sakti/"
```

---

### Task 7: Rename CLI name `openspec` → `sakti`

**Files:**

- Modify: `packages/sakti/src/cli/index.ts`
- Modify: all other files that reference the CLI as "openspec"

**Step 1: Change the Commander program name**

In `packages/sakti/src/cli/index.ts`:

```diff
- .name('openspec')
+ .name('sakti')
```

Also update description from `'AI-native system for spec-driven development'` to something Sakti-specific.

And the helper message:

```diff
- if (name && name !== 'openspec') {
+ if (name && name !== 'sakti') {
```

```diff
- return names.join(':') || 'openspec';
+ return names.join(':') || 'sakti';
```

**Step 2: Update all error/help text that says "OpenSpec"**

Change:

- `'Initialize OpenSpec in your project'` → `'Initialize sakti in your project'`
- `'Manage OpenSpec change proposals'` → `'Manage change proposals'`
- `"openspec change list" is deprecated` → `"sakti change list" is deprecated`
- `"openspec change ..." commands are deprecated` → etc.
- `--store-path <path> description with "openspec store register"` → `"sakti store register"`
- All `openspec commands/subcommands` in error messages and deprecation warnings

**Step 3: Update the `getCommandPath` function comment**

```diff
- // Skip the root 'openspec' command
+ // Skip the root 'sakti' command
```

**Step 4: Verify**

Run:

```bash
rg '\bopenspec\b' packages/sakti/src/cli/index.ts
```

**Step 5: Commit**

```bash
git add packages/sakti/src/cli/index.ts
git commit -m "feat(sakti): rename CLI from openspec to sakti"
```

---

### Task 8: Rename global config path comments

**Files:**

- Modify: `packages/sakti/src/core/global-config.ts`

**Step 1: Read and update global-config.ts**

Update:

- Comments mentioning `$XDG_CONFIG_HOME/openspec/` → `$XDG_CONFIG_HOME/sakti/`
- Comments mentioning `~/.config/openspec/` → `~/.config/sakti/`
- Comments mentioning `~/.local/share/openspec/` → `~/.local/share/sakti/`
- Comments mentioning `%APPDATA%/openspec/` → `%APPDATA%/sakti/`
- Comments mentioning `%LOCALAPPDATA%/openspec/` → `%LOCALAPPDATA%/sakti/`

These are in JSDoc comments and inline comments.

**Step 2: Commit**

```bash
git add packages/sakti/src/core/global-config.ts
git commit -m "feat(sakti): update global config path comments"
```

---

### Task 9: Rename slash commands `opsx:` → `sakti:`

**Files:**

- Modify: all `.ts` files in `packages/sakti/` that reference `opsx:`

**Step 1: Find all occurrences**

Run:

```bash
rg 'opsx:' packages/sakti/ --files-with-matches
```

**Step 2: Replace in all files**

```bash
rg 'opsx:' packages/sakti/ --files-with-matches | while read f; do
  sed -i 's/opsx:/sakti:/g' "$f"
done
```

Also replace `opsx-` (in filenames like `opsx-*.md`):

```bash
rg 'opsx-' packages/sakti/ --files-with-matches | while read f; do
  sed -i 's/opsx-/sakti-/g' "$f"
done
```

**Step 3: Verify**

Run:

```bash
rg 'opsx' packages/sakti/ --files-with-matches
```

Expected: no matches (except possibly in gitignored files).

**Step 4: Commit**

```bash
git add -u
git commit -m "feat(sakti): rename slash commands opsx:* → sakti:*"
```

---

### Task 10: Rename skill generation templates (`openspec-*` → `sakti-*`)

**Files:**

- Modify: `packages/sakti/src/core/shared/skill-generation.ts`
- Modify: `packages/sakti/src/core/legacy-cleanup.ts`

**Step 1: Update skill-generation.ts**

In `packages/sakti/src/core/shared/skill-generation.ts`, replace skill directory names:

- `'openspec-explore'` → `'sakti-explore'`
- `'openspec-new-change'` → `'sakti-new-change'`
- `'openspec-continue-change'` → `'sakti-continue-change'`
- `'openspec-apply-change'` → `'sakti-apply-change'`
- `'openspec-ff-change'` → `'sakti-ff-change'`
- `'openspec-sync-specs'` → `'sakti-sync-specs'`
- `'openspec-archive-change'` → `'sakti-archive-change'`
- `'openspec-bulk-archive-change'` → `'sakti-bulk-archive-change'`
- `'openspec-verify-change'` → `'sakti-verify-change'`
- `'openspec-onboard'` → `'sakti-onboard'`
- `'openspec-propose'` → `'sakti-propose'`

Also replace:

- `'openspec-init'` → `'sakti-init'`
- `'openspec-update'` → `'sakti-update'`
- `'openspec-show'` → `'sakti-show'`

And any comments mentioning these names.

**Step 2: Update legacy-cleanup.ts**

Replace platform adapter patterns:

- `'.cursor/commands/openspec-*.md'` → `'.cursor/commands/sakti-*.md'`
- `'.windsurf/workflows/openspec-*.md'` → `'.windsurf/workflows/sakti-*.md'`
- `'.github/prompts/openspec-*.prompt.md'` → `'.github/prompts/sakti-*.prompt.md'`
- etc. (all 20+ platform patterns)

**Step 3: Commit**

```bash
git add packages/sakti/src/core/shared/skill-generation.ts packages/sakti/src/core/legacy-cleanup.ts
git commit -m "feat(sakti): rename skill templates openspec-* → sakti-*"
```

---

### Task 11: Update telemetry

**Files:**

- Modify: `packages/sakti/src/telemetry/index.ts`

**Step 1: Change or disable telemetry**

In `packages/sakti/src/telemetry/index.ts`, change:

```diff
- const POSTHOG_HOST = 'https://edge.openspec.dev';
+ const POSTHOG_HOST = 'https://edge.sakti-code.dev';
```

Or disable telemetry by default for the port. For now, update the hostname.

Also update `packages/sakti/src/telemetry/config.ts` comments if they mention `openspec`.

**Step 2: Commit**

```bash
git add packages/sakti/src/telemetry/index.ts packages/sakti/src/telemetry/config.ts
git commit -m "feat(sakti): update telemetry host URL"
```

---

### Task 12: Update remaining "openspec" string references in source

**Files:**

- Modify: all `.ts` files with remaining `openspec` references

**Step 1: Find all remaining occurrences**

```bash
rg 'openspec' packages/sakti/src/ --type ts
```

**Step 2: Review and replace each**

For each occurrence, decide:

- If it's a string literal referring to the project directory → change to `.sakti`
- If it's a CLI command reference → change to `sakti`
- If it's a concept/description → use "sakti" or rephrase
- If it's an identifier (variable/function/type name) → rename to `sakti` variant
- If it's a comment → update to use Sakti terminology

Key files to check (based on grep output):

- `src/commands/change.ts`: error messages
- `src/commands/shared-output.ts`: output formatting
- `src/commands/show.ts`: description text
- `src/commands/validate.ts`: description text
- `src/commands/spec.ts`: description text
- `src/commands/config.ts`: description text
- `src/commands/schema.ts`: description text
- `src/commands/store.ts`: description text
- `src/commands/doctor.ts`: description text
- `src/commands/feedback.ts`: description text
- `src/commands/context.ts`: description text
- `src/commands/workset.ts`: description text
- `src/core/init.ts`: project setup text
- `src/core/update.ts`: update messages
- `src/core/list.ts`: output messages
- `src/core/archive.ts`: archive messages
- `src/core/view.ts`: view messages
- `src/core/openers.ts`: opener messages
- `src/core/profiles.ts`: profile messages
- `src/core/project-config.ts`: config messages
- `src/core/root-selection.ts`: root selection messages
- `src/core/shared/tool-detection.ts`: tool detection messages
- `src/core/change-status-policy.ts`: status messages
- `src/core/relationship-health.ts`: health messages
- `src/core/available-tools.ts`: tool descriptions
- `src/core/file-state.ts`: state messages

Plus all test files.

**Step 3: Commit after all replacements**

```bash
git add -u
git commit -m "feat(sakti): rename remaining openspec references in source"
```

---

### Task 13: Update test files

**Files:**

- Modify: all `.ts` files in `packages/sakti/test/`

**Step 1: Find and replace in tests**

The test files reference the same paths and names as the source, so most replacements should already be handled by the global find-and-replace in previous tasks. But we need to check for:

- Test fixture paths that reference `openspec/` directories
- Expected error messages containing "OpenSpec" or "openspec"
- Expected JSON output with "openspec" keys
- Import paths that might reference `@fission-ai/openspec`
- Test setup scripts

**Step 2: Run the same sed replacements on test/**

```bash
# .openspec.yaml → .sakti.yaml
rg '\.openspec\.yaml' packages/sakti/test/ --files-with-matches | while read f; do
  sed -i 's/\.openspec\.yaml/\.sakti\.yaml/g' "$f"
done

# opsx: → sakti:
rg 'opsx:' packages/sakti/test/ --files-with-matches | while read f; do
  sed -i 's/opsx:/sakti:/g' "$f"
done
```

**Step 3: Check for test-specific issues**

Look for test help text or expected output that contains CLI commands like `openspec list` that need to be `sakti list`.

Run:

```bash
rg 'openspec' packages/sakti/test/
```

**Step 4: Update the vitest.setup.ts if needed**

The setup might reference building the CLI before tests. Adjust as needed.

**Step 5: Commit**

```bash
git add -u
git commit -m "feat(sakti): update test files for sakti renames"
```

---

### Task 14: Adapt vitest.config.ts

**Files:**

- Modify: `packages/sakti/vitest.config.ts`

**Step 1: Verify vitest config works with monorepo**

The config references `vitest` but the monorepo uses `vitest` from the catalog (v4.x). The config should be compatible, but may need adjustments for:

- `globalSetup: './vitest.setup.ts'` — check path is still correct
- `pool: 'forks'` — should still work
- `include: ['test/**/*.test.ts']` — should still work

**Step 2: Commit**

```bash
git add packages/sakti/vitest.config.ts
git commit -m "feat(sakti): adapt vitest config for monorepo"
```

---

### Task 15: Install dependencies and build

**Step 1: Install dependencies**

```bash
vp install
```

**Step 2: Try building**

```bash
# Try with vp pack first (monorepo convention)
vp pack --filter @sakti-code/sakti
```

If `vp pack` doesn't work for this package (because the OpenSpec code uses `.js` import extensions with `NodeNext`-style imports), fall back to the original `tsc` build:

```bash
cd packages/sakti
npx tsc
```

**Step 3: Fix any build errors**

Common issues:

- Missing dependencies (install via `vp install`)
- Import resolution errors (adjust tsconfig or import paths)
- Type errors from stricter base tsconfig

**Step 4: Verify the CLI runs**

```bash
node packages/sakti/bin/sakti.js --help
```

Expected: Shows sakti CLI help with all subcommands.

**Step 5: Commit**

```bash
git add -u
git commit -m "feat(sakti): fix build issues and verify CLI works"
```

---

### Task 16: Run tests and fix failures

**Step 1: Run the tests**

```bash
cd packages/sakti
npx vitest run
```

**Step 2: Fix test failures**

Common issues:

- Tests expecting `openspec` in output but getting `sakti`
- Tests with hardcoded path references
- Tests failing due to config directory changes

**Step 3: Iterate until tests pass**

```bash
npx vitest run
```

**Step 4: Commit**

```bash
git add -u
git commit -m "feat(sakti): fix test failures after rename"
```
