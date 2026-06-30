# Port Pi Agent + Tools — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port pi's `packages/agent/` and `packages/coding-agent/src/core/tools/` into sakti-code, replacing persistence with SQLite and stripping TUI rendering.

**Architecture:** Faithful port of pi's 3-layer agent architecture (agent-loop → Agent → AgentHarness) into `packages/agent/`. Pi's JSONL persistence replaced by `SqliteSessionStorage` in `packages/db/`. Pi's tools ported into `packages/tools/` with TUI rendering stripped, using `Bun.Image` for image resize.

**Tech Stack:** TypeScript 6.0, Bun, `@earendil-works/pi-ai` 0.79.8, TypeBox, `bun:sqlite` + Drizzle ORM, Bun.Image

---

## Reference Map

Pi source lives at `openspec/references/pi/packages/`. Key paths:

| Pi Source                                              | Our Target                                              | Action   |
| ------------------------------------------------------ | ------------------------------------------------------- | -------- |
| `agent/src/types.ts`                                   | `packages/agent/src/types.ts`                           | Replace  |
| `agent/src/agent-loop.ts`                              | `packages/agent/src/loop/agent-loop.ts`                 | New file |
| `agent/src/agent.ts`                                   | `packages/agent/src/agent.ts`                           | New file |
| `agent/src/harness/types.ts`                           | `packages/agent/src/harness/types.ts`                   | New file |
| `agent/src/harness/messages.ts`                        | `packages/agent/src/harness/messages.ts`                | New file |
| `agent/src/harness/agent-harness.ts`                   | `packages/agent/src/harness/agent-harness.ts`           | New file |
| `agent/src/harness/system-prompt.ts`                   | `packages/agent/src/harness/system-prompt.ts`           | New file |
| `agent/src/harness/skills.ts`                          | `packages/agent/src/harness/skills.ts`                  | New file |
| `agent/src/harness/session/session.ts`                 | `packages/agent/src/harness/session.ts`                 | New file |
| `agent/src/harness/compaction/compaction.ts`           | `packages/agent/src/compaction/compaction.ts`           | Replace  |
| `agent/src/harness/compaction/branch-summarization.ts` | `packages/agent/src/compaction/branch-summarization.ts` | New file |
| `agent/src/harness/compaction/utils.ts`                | `packages/agent/src/compaction/utils.ts`                | New file |
| `agent/src/harness/utils/truncate.ts`                  | `packages/agent/src/lib/truncate.ts`                    | New file |
| `agent/src/harness/utils/shell-output.ts`              | `packages/agent/src/lib/shell-output.ts`                | New file |
| `coding-agent/src/core/tools/truncate.ts`              | `packages/tools/src/lib/truncate.ts`                    | Replace  |
| `coding-agent/src/core/tools/output-accumulator.ts`    | `packages/tools/src/lib/output-accumulator.ts`          | Replace  |
| `coding-agent/src/core/tools/path-utils.ts`            | `packages/tools/src/lib/path-utils.ts`                  | Replace  |
| `coding-agent/src/core/tools/file-mutation-queue.ts`   | `packages/tools/src/lib/file-mutation-queue.ts`         | New file |
| `coding-agent/src/core/tools/edit-diff.ts`             | `packages/tools/src/lib/edit-diff.ts`                   | New file |
| `coding-agent/src/core/tools/read.ts`                  | `packages/tools/src/tools/read.ts`                      | Replace  |
| `coding-agent/src/core/tools/write.ts`                 | `packages/tools/src/tools/write.ts`                     | Replace  |
| `coding-agent/src/core/tools/edit.ts`                  | `packages/tools/src/tools/edit.ts`                      | Replace  |
| `coding-agent/src/core/tools/bash.ts`                  | `packages/tools/src/tools/bash.ts`                      | Replace  |
| `coding-agent/src/core/tools/grep.ts`                  | `packages/tools/src/tools/grep.ts`                      | Replace  |
| `coding-agent/src/core/tools/find.ts`                  | `packages/tools/src/tools/find.ts`                      | Replace  |
| `coding-agent/src/core/tools/ls.ts`                    | `packages/tools/src/tools/ls.ts`                        | Replace  |

## Skip List (do not port)

- `agent/src/node.ts` — Node-specific, we provide Bun ExecutionEnv
- `agent/src/proxy.ts` — remote LLM proxy, not needed for v1
- `agent/src/harness/env/nodejs.ts` — Node FS impl, we write Bun impl
- `agent/src/harness/session/jsonl-repo.ts` — replaced by SQLite
- `agent/src/harness/session/jsonl-storage.ts` — replaced by SQLite
- `agent/src/harness/session/memory-repo.ts` — test-only
- `agent/src/harness/session/memory-storage.ts` — test-only
- `agent/src/harness/prompt-templates.ts` — defer to v2
- `coding-agent/src/core/tools/render-utils.ts` — TUI rendering, not needed
- `coding-agent/src/core/tools/index.ts` — TUI tool registration
- `coding-agent/src/core/tools/tool-definition-wrapper.ts` — ExtensionContext bridge
- All `coding-agent/src/modes/interactive/` — TUI
- All `coding-agent/src/utils/` — TUI/desktop utilities (except path-utils patterns)
- `packages/tui/` — entire TUI package

## Import Adaptation Rules

Pi imports `@earendil-works/pi-agent-core` internally. Since we ARE the agent package, change all internal imports:

```
// Pi internal imports → our relative imports
"./types.ts"                      →  "../types.ts" (adjust relative paths)
"../types.ts"                     →  "../types.ts"
"../../types.ts"                  →  "../../types.ts"
"../messages.ts"                  →  "../harness/messages.ts"
"../session/session.ts"           →  "../harness/session.ts"
"./compaction/utils.ts"           →  "../compaction/utils.ts"

// Pi external imports (keep as-is)
"@earendil-works/pi-ai/base"      →  keep (same dep)
"typebox"                         →  keep (add dep if missing)
```

## TUI Stripping Rules (tools only)

Each tool file has a `render()` function producing TUI output. Strip:

1. Remove all `@earendil-works/pi-tui` imports (`Text`, `Box`, `Container`, etc.)
2. Remove all `modes/interactive/*` imports (theme, keybinding hints, diff rendering)
3. Remove all `utils/*` TUI imports (image-resize, mime, child-process — we use Bun equivalents)
4. Remove `render-utils.ts` imports (`getTextOutput`, `renderToolPath`, `str`, `keyHint`, etc.)
5. Remove `ToolDefinition`, `ToolRenderResultOptions` imports from `extensions/types.ts`
6. Remove `wrapToolDefinition()` call — the tool should return `AgentTool` directly
7. Remove the `render()` method from the tool definition
8. Remove `ToolRenderResultOptions` parameter from the execute function
9. Replace `highlightCode`, `getLanguageFromPath`, `theme` usage with plain text
10. Replace `resizeImage(buf, w, h)` with `await Bun.Image(buf).resize(w, h, { fit: "inside" }).png().bytes()`
11. Replace `ensureTool("rg")` / `ensureTool("fd")` with our `resolveBin("rg")` (defer auto-download)
12. Return `AgentTool` directly from the tool factory, not wrapped

---

### Task 1: Preparation — backup and deps

**Step 1:** Create a git branch

```bash
git checkout -b feat/port-pi-agent
```

**Step 2:** Add typebox dependency

```bash
bun add typebox
```

**Step 3:** Backup existing agent code

```bash
mkdir -p /tmp/sakti-backup
cp -r packages/agent/src /tmp/sakti-backup/agent-src
cp -r packages/tools/src /tmp/sakti-backup/tools-src
```

**Step 4:** Commit

```bash
git add package.json bun.lock
git commit -m "chore: add typebox dependency for pi agent port"
```

---

### Task 2: Port `types.ts` (agent core types)

**Files:**

- Reference: `openspec/references/pi/packages/agent/src/types.ts`
- Target: `packages/agent/src/types.ts` (replace existing)

**Step 1:** Read pi's `types.ts` to understand the full type surface

```bash
wc -l openspec/references/pi/packages/agent/src/types.ts
```

**Step 2:** Copy pi's `types.ts` into place

```bash
cp openspec/references/pi/packages/agent/src/types.ts packages/agent/src/types.ts
```

**Step 3:** Fix imports — all internal pi imports become relative within our package

Read the file and fix any `@earendil-works/pi-agent-core` imports (shouldn't have any — this is a leaf file). Verify pi-ai imports resolve:

- `@earendil-works/pi-ai/base` → keep as-is
- `typebox` → keep as-is (now installed)

**Step 4:** Typecheck

```bash
bun typecheck
```

This will fail because downstream files (`loop/index.ts`, `compaction.ts`, etc.) reference old type shapes. That's expected — we'll update them in subsequent tasks.

**Step 5:** Commit

```bash
git add packages/agent/src/types.ts
git commit -m "feat(agent): port pi agent-core types"
```

---

### Task 3: Port `harness/types.ts` (Result, SessionTreeEntry, SessionStorage)

**Files:**

- Reference: `openspec/references/pi/packages/agent/src/harness/types.ts`
- Target: `packages/agent/src/harness/types.ts` (new file)

**Step 1:** Read pi's harness types

Note the key exports you need: `Result<T,E>`, `ok()`, `err()`, `SessionStorage` interface, `SessionTreeEntry` union (11 variants), `SessionRepo<TMetadata>`, `AgentHarnessPhase`, error classes.

**Step 2:** Copy and fix imports

```bash
cp openspec/references/pi/packages/agent/src/harness/types.ts packages/agent/src/harness/types.ts
```

Fix imports:

- `../../types.ts` → `../types.ts` (relative to new location)
- Any `@earendil-works/pi-agent-core` → not expected (this references sibling types.ts)

**Step 3:** Typecheck

```bash
bun typecheck
```

**Step 4:** Commit

```bash
git add packages/agent/src/harness/types.ts
git commit -m "feat(agent): port pi harness types (Result, SessionTreeEntry, SessionStorage)"
```

---

### Task 4: Port utility modules

**Files:**

- Reference: `openspec/references/pi/packages/agent/src/harness/utils/truncate.ts`
- Target: `packages/agent/src/lib/truncate.ts` (new file, for agent-internal use)
- Reference: `openspec/references/pi/packages/agent/src/harness/utils/shell-output.ts`
- Target: `packages/agent/src/lib/shell-output.ts` (new file)

**Step 1:** Copy truncate.ts

```bash
cp openspec/references/pi/packages/agent/src/harness/utils/truncate.ts packages/agent/src/lib/truncate.ts
```

Fix imports:

- `../../types.ts` → `../types.ts` (adjust relative path based on new location)

**Step 2:** Copy shell-output.ts

```bash
cp openspec/references/pi/packages/agent/src/harness/utils/shell-output.ts packages/agent/src/lib/shell-output.ts
```

Fix imports similarly.

**Step 3:** Port pi's truncate tests

```bash
cp openspec/references/pi/packages/agent/test/harness/truncate.test.ts packages/agent/src/__tests__/truncate.test.ts
```

Fix imports in the test file to match our paths.

**Step 4:** Run tests

```bash
bun vitest run packages/agent/src/__tests__/truncate.test.ts
```

**Step 5:** Typecheck

```bash
bun typecheck
```

**Step 6:** Commit

```bash
git add packages/agent/src/lib/ packages/agent/src/__tests__/truncate.test.ts
git commit -m "feat(agent): port truncate and shell-output utilities"
```

---

### Task 5: Port `messages.ts` (convertToLlm, custom message types)

**Files:**

- Reference: `openspec/references/pi/packages/agent/src/harness/messages.ts`
- Target: `packages/agent/src/harness/messages.ts` (new file)

**Step 1:** Copy

```bash
cp openspec/references/pi/packages/agent/src/harness/messages.ts packages/agent/src/harness/messages.ts
```

**Step 2:** Fix imports

- `../types.ts` → keep (same relative position within harness/)
- `../../types.ts` → `../types.ts`

**Step 3:** Verify it references the right types from our ported `types.ts`

Key things to check:

- `AgentMessage` union includes custom message types
- `CustomAgentMessages` declaration merging works
- `convertToLlm` handles all message types

**Step 4:** Typecheck

```bash
bun typecheck
```

**Step 5:** Commit

```bash
git add packages/agent/src/harness/messages.ts
git commit -m "feat(agent): port messages.ts (convertToLlm, custom message types)"
```

---

### Task 6: Port `session.ts` (Session class)

**Files:**

- Reference: `openspec/references/pi/packages/agent/src/harness/session/session.ts`
- Target: `packages/agent/src/harness/session.ts` (new file)

**Step 1:** Copy

```bash
cp openspec/references/pi/packages/agent/src/harness/session/session.ts packages/agent/src/harness/session.ts
```

**Step 2:** Fix imports

- All `../types.ts` → keep
- `../messages.ts` → keep

**Step 3:** Verify SessionStorage interface usage

The Session class calls `this.storage.getMetadata()`, `.getLeafId()`, `.appendEntry()`, etc. These are all through the `SessionStorage` interface — no direct file I/O. This file should compile cleanly once types are in place.

**Step 4:** Typecheck

```bash
bun typecheck
```

**Step 5:** Commit

```bash
git add packages/agent/src/harness/session.ts
git commit -m "feat(agent): port Session class"
```

---

### Task 7: SQLite schema for entry tree

**Files:**

- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/repos/entry-repo.ts`
- Test: `packages/db/src/__tests__/entry-repo.test.ts`

**Step 1:** Design the schema

Add a `session_entries` table to the existing schema. Each row is one `SessionTreeEntry`:

```ts
session_entries: sqliteTable("session_entries", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  parentId: text("parent_id"), // null for root entries
  sequence: integer("sequence").notNull(), // ordering within session
  kind: text("kind").notNull(), // "message", "compaction", "model_change", etc.
  content: text("content").notNull(), // JSON blob — shape depends on kind
  timestamp: integer("timestamp").notNull(),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
});
```

Also add `leafId` to the existing `sessions` table:

```ts
leafId: text("leaf_id"), // which entry is the current branch tip
```

**Step 2:** Write the migration in `packages/db/src/schema.ts`

Add the table + column to the existing schema. Follow the existing pattern for table creation.

**Step 3:** Write failing test for EntryRepo

Test: create entries, query by kind, getPathToRoot, getEntries for a session.

**Step 4:** Run test to verify it fails

```bash
cd packages/db && bun test
```

**Step 5:** Implement `EntryRepo` class

Methods to implement (matching `SessionStorage` interface):

```ts
class SqliteSessionStorage {
  constructor(db: BunSQLiteDatabase)

  getMetadata(): Promise<{ projectId: string; title?: string; ... }>
  getLeafId(): Promise<string | null>
  setLeafId(leafId: string | null): Promise<void>
  createEntryId(): string // nanoid
  appendEntry(entry: SessionTreeEntry): Promise<void>
  getEntry(id: string): Promise<SessionTreeEntry | undefined>
  findEntries<TKind>(kind: TKind): Promise<Extract<SessionTreeEntry, { type: TKind }>[]>
  getLabel(id: string): Promise<string | undefined>
  getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]>
  getEntries(): Promise<SessionTreeEntry[]>
}
```

Key implementation detail: `appendEntry` must:

1. INSERT the entry row
2. If entry has `type !== "leaf"`, UPDATE sessions SET leaf_id = entry.id

`getPathToRoot` must:

1. Start from leafId
2. Walk parentId up to root
3. Return entries in root→leaf order

**Step 6:** Run test to verify it passes

```bash
cd packages/db && bun test
```

**Step 7:** Typecheck

```bash
bun typecheck
```

**Step 8:** Commit

```bash
git add packages/db/src/schema.ts packages/db/src/repos/entry-repo.ts packages/db/src/__tests__/entry-repo.test.ts
git commit -m "feat(db): add session_entries table and SqliteSessionStorage"
```

---

### Task 8: Port `compaction/utils.ts`

**Files:**

- Reference: `openspec/references/pi/packages/agent/src/harness/compaction/utils.ts`
- Target: `packages/agent/src/compaction/utils.ts` (new file)

**Step 1:** Copy

```bash
cp openspec/references/pi/packages/agent/src/harness/compaction/utils.ts packages/agent/src/compaction/utils.ts
```

**Step 2:** Fix imports

**Step 3:** Typecheck

```bash
bun typecheck
```

**Step 4:** Commit

```bash
git add packages/agent/src/compaction/utils.ts
git commit -m "feat(agent): port compaction utils (file ops, serialize)"
```

---

### Task 9: Port `compaction.ts` + `branch-summarization.ts`

**Files:**

- Reference: `openspec/references/pi/packages/agent/src/harness/compaction/compaction.ts`
- Target: `packages/agent/src/compaction.ts` (replace existing)
- Reference: `openspec/references/pi/packages/agent/src/harness/compaction/branch-summarization.ts`
- Target: `packages/agent/src/compaction/branch-summarization.ts` (new file)

**Step 1:** Copy both files

```bash
cp openspec/references/pi/packages/agent/src/harness/compaction/compaction.ts packages/agent/src/compaction.ts
cp openspec/references/pi/packages/agent/src/harness/compaction/branch-summarization.ts packages/agent/src/compaction/branch-summarization.ts
```

**Step 2:** Fix imports in both files

The compaction files reference:

- `../../types.ts` → `../types.ts`
- `../messages.ts` → `../harness/messages.ts`
- `../session/session.ts` → `../harness/session.ts`
- `../types.ts` → `../harness/types.ts`
- `./utils.ts` → `./utils.ts` (same directory, fine)
- `@earendil-works/pi-ai/base` → keep

**Step 3:** Port pi's compaction tests

```bash
cp openspec/references/pi/packages/coding-agent/test/compaction.test.ts packages/agent/src/__tests__/compaction.test.ts
```

Fix imports in test to match our paths. Note: these tests may reference coding-agent internals — adapt as needed. If the tests are too coupled to coding-agent's harness, write simpler tests covering the core logic: `estimateTokens`, `shouldCompact`, `prepareCompaction`.

**Step 4:** Run tests

```bash
bun vitest run packages/agent/src/__tests__/compaction.test.ts
```

**Step 5:** Typecheck

```bash
bun typecheck
```

**Step 6:** Commit

```bash
git add packages/agent/src/compaction/
git commit -m "feat(agent): port pi compaction (iterative summary, split-turn, file tracking)"
```

---

### Task 10: Port `agent-loop.ts`

**Files:**

- Reference: `openspec/references/pi/packages/agent/src/agent-loop.ts`
- Target: `packages/agent/src/loop/agent-loop.ts` (new file)

**Step 1:** Copy

```bash
cp openspec/references/pi/packages/agent/src/agent-loop.ts packages/agent/src/loop/agent-loop.ts
```

**Step 2:** Fix imports

- `./types.ts` → `../types.ts`
- `@earendil-works/pi-ai/base` → keep
- `typebox` → keep (if used)

**Step 3:** Port pi's agent-loop tests

```bash
cp openspec/references/pi/packages/agent/test/agent-loop.test.ts packages/agent/src/__tests__/agent-loop.test.ts
```

Fix imports. These tests mock `streamSimple` — verify the mocks work with our setup.

**Step 4:** Run tests

```bash
bun vitest run packages/agent/src/__tests__/agent-loop.test.ts
```

**Step 5:** Typecheck

```bash
bun typecheck
```

**Step 6:** Commit

```bash
git add packages/agent/src/loop/ packages/agent/src/__tests__/agent-loop.test.ts
git commit -m "feat(agent): port pi agent-loop (pure stateless loop)"
```

---

### Task 11: Port `agent.ts` (stateful Agent class)

**Files:**

- Reference: `openspec/references/pi/packages/agent/src/agent.ts`
- Target: `packages/agent/src/agent.ts` (new file)

**Step 1:** Copy

```bash
cp openspec/references/pi/packages/agent/src/agent.ts packages/agent/src/agent.ts
```

**Step 2:** Fix imports

- `./agent-loop.ts` → `./loop/agent-loop.ts`
- `./types.ts` → `./types.ts`
- `@earendil-works/pi-ai/base` → keep

**Step 3:** Port pi's agent tests

```bash
cp openspec/references/pi/packages/agent/test/agent.test.ts packages/agent/src/__tests__/agent.test.ts
```

Fix imports.

**Step 4:** Run tests

```bash
bun vitest run packages/agent/src/__tests__/agent.test.ts
```

**Step 5:** Typecheck

```bash
bun typecheck
```

**Step 6:** Commit

```bash
git add packages/agent/src/agent.ts packages/agent/src/__tests__/agent.test.ts
git commit -m "feat(agent): port pi Agent class (state wrapper, prompt/steer/followUp)"
```

---

### Task 12: Port `agent-harness.ts`

**Files:**

- Reference: `openspec/references/pi/packages/agent/src/harness/agent-harness.ts`
- Target: `packages/agent/src/harness/agent-harness.ts` (new file)

This is the largest file (1064 lines). It orchestrates everything.

**Step 1:** Copy

```bash
cp openspec/references/pi/packages/agent/src/harness/agent-harness.ts packages/agent/src/harness/agent-harness.ts
```

**Step 2:** Fix imports

- `../../types.ts` → `../types.ts`
- `../../agent-loop.ts` → `../loop/agent-loop.ts` (or `../loop` export)
- `../../agent.ts` → `../agent.ts`
- `./types.ts` → `./types.ts`
- `./messages.ts` → `./messages.ts`
- `./session/session.ts` → `./session.ts`
- `./system-prompt.ts` → `./system-prompt.ts`
- `./skills.ts` → `./skills.ts`
- `./compaction/*` → `../compaction/*`

**Step 3:** Verify key methods

Check that:

- `createTurnState()` calls `session.buildContext()` (through SessionStorage interface)
- `createStreamFn()` wires auth correctly
- `createLoopConfig()` sets up all hooks (beforeToolCall, afterToolCall, validateToolArguments, prepareNextTurn, shouldStopAfterTurn, transformContext)
- `handleAgentEvent()` persists messages via session
- Phase state machine transitions are correct

**Step 4:** Port pi's harness tests

```bash
cp openspec/references/pi/packages/agent/test/harness/agent-harness.test.ts packages/agent/src/__tests__/agent-harness.test.ts
```

These tests likely use memory-storage — check if they need our `SqliteSessionStorage` or if pi's `memory-storage.ts` is self-contained enough to copy temporarily.

**Step 5:** Run tests

```bash
bun vitest run packages/agent/src/__tests__/agent-harness.test.ts
```

**Step 6:** Typecheck

```bash
bun typecheck
```

**Step 7:** Commit

```bash
git add packages/agent/src/harness/agent-harness.ts packages/agent/src/__tests__/agent-harness.test.ts
git commit -m "feat(agent): port pi agent-harness (hooks, state machine, queues)"
```

---

### Task 13: Port `system-prompt.ts`

**Files:**

- Reference: `openspec/references/pi/packages/agent/src/harness/system-prompt.ts`
- Target: `packages/agent/src/harness/system-prompt.ts` (new file)

**Step 1:** Copy

```bash
cp openspec/references/pi/packages/agent/src/harness/system-prompt.ts packages/agent/src/harness/system-prompt.ts
```

**Step 2:** Fix imports

**Step 3:** Verify it's pure formatting (no file I/O)

```bash
grep -n "readFile\|fs\.\|node:fs" packages/agent/src/harness/system-prompt.ts
```

Should find nothing — it takes pre-loaded data and formats it.

**Step 4:** Typecheck + commit

```bash
bun typecheck
git add packages/agent/src/harness/system-prompt.ts
git commit -m "feat(agent): port pi system prompt builder"
```

---

### Task 14: Port `skills.ts`

**Files:**

- Reference: `openspec/references/pi/packages/agent/src/harness/skills.ts`
- Target: `packages/agent/src/harness/skills.ts` (new file)

**Step 1:** Copy

```bash
cp openspec/references/pi/packages/agent/src/harness/skills.ts packages/agent/src/harness/skills.ts
```

**Step 2:** Fix imports

This file uses `ExecutionEnv` for file I/O. Keep the `env` parameter — the server will provide a Bun implementation.

**Step 3:** Typecheck + commit

```bash
bun typecheck
git add packages/agent/src/harness/skills.ts
git commit -m "feat(agent): port pi skills system"
```

---

### Task 15: Update agent package exports

**Files:**

- Modify: `packages/agent/src/index.ts`

**Step 1:** Update exports to include all ported modules

```ts
// Core
export * from "./types.ts";
export * from "./agent.ts";
export * from "./loop/agent-loop.ts";

// Harness
export * from "./harness/types.ts";
export * from "./harness/agent-harness.ts";
export * from "./harness/messages.ts";
export * from "./harness/session.ts";
export * from "./harness/system-prompt.ts";
export * from "./harness/skills.ts";

// Compaction
export * from "./compaction.ts";
export * from "./compaction/branch-summarization.ts";
export * from "./compaction/utils.ts";

// Lib
export * from "./lib/truncate.ts";
```

**Step 2:** Remove or archive old files

The old agent loop and compaction files are replaced:

- `packages/agent/src/loop/index.ts` → replaced by `agent-loop.ts`
- `packages/agent/src/loop/streaming.ts` → logic now in `agent-loop.ts`
- `packages/agent/src/loop/tool-execution.ts` → logic now in `agent-loop.ts`
- `packages/agent/src/loop/events.ts` → logic now in `agent-loop.ts`
- `packages/agent/src/compaction.ts` → replaced by new `compaction/` dir
- `packages/agent/src/config.ts` → replaced by pi's types

```bash
mkdir -p packages/agent/src/_legacy
mv packages/agent/src/loop/index.ts packages/agent/src/_legacy/
mv packages/agent/src/loop/streaming.ts packages/agent/src/_legacy/
mv packages/agent/src/loop/tool-execution.ts packages/agent/src/_legacy/
mv packages/agent/src/loop/events.ts packages/agent/src/_legacy/
mv packages/agent/src/compaction.ts packages/agent/src/_legacy/
```

**Step 3:** Typecheck

```bash
bun typecheck
```

Fix any remaining type errors from old code still being imported.

**Step 4:** Commit

```bash
git add packages/agent/src/
git commit -m "refactor(agent): update exports, archive legacy loop"
```

---

### Task 16: Port tool utility modules

**Files:**

- Reference: `openspec/references/pi/packages/coding-agent/src/core/tools/truncate.ts`
- Target: `packages/tools/src/lib/truncate.ts` (replace existing)
- Reference: `openspec/references/pi/packages/coding-agent/src/core/tools/output-accumulator.ts`
- Target: `packages/tools/src/lib/output-accumulator.ts` (new file)
- Reference: `openspec/references/pi/packages/coding-agent/src/core/tools/path-utils.ts`
- Target: `packages/tools/src/lib/path-utils.ts` (new file)
- Reference: `openspec/references/pi/packages/coding-agent/src/core/tools/file-mutation-queue.ts`
- Target: `packages/tools/src/lib/file-mutation-queue.ts` (new file)
- Reference: `openspec/references/pi/packages/coding-agent/src/core/tools/edit-diff.ts`
- Target: `packages/tools/src/lib/edit-diff.ts` (new file)

**Step 1:** Copy all utility files

```bash
cp openspec/references/pi/packages/coding-agent/src/core/tools/truncate.ts packages/tools/src/lib/truncate.ts
cp openspec/references/pi/packages/coding-agent/src/core/tools/output-accumulator.ts packages/tools/src/lib/output-accumulator.ts
cp openspec/references/pi/packages/coding-agent/src/core/tools/path-utils.ts packages/tools/src/lib/path-utils.ts
cp openspec/references/pi/packages/coding-agent/src/core/tools/file-mutation-queue.ts packages/tools/src/lib/file-mutation-queue.ts
cp openspec/references/pi/packages/coding-agent/src/core/tools/edit-diff.ts packages/tools/src/lib/edit-diff.ts
```

**Step 2:** Fix imports in each file

These utility files should have minimal imports (mostly `node:path`, `node:fs`). Fix:

- `../../../config.ts` → remove or inline the needed value
- `../../utils/paths.ts` → extract needed functions inline
- `../render-utils.ts` → remove TUI imports

For `path-utils.ts`, check what it imports from `../../../config.ts` — likely just a path constant. Inline it.

**Step 3:** Typecheck

```bash
bun typecheck
```

**Step 4:** Commit

```bash
git add packages/tools/src/lib/
git commit -m "feat(tools): port pi tool utilities (truncate, accumulator, path-utils, edit-diff, mutation-queue)"
```

---

### Task 17: Port `read.ts`

**Files:**

- Reference: `openspec/references/pi/packages/coding-agent/src/core/tools/read.ts`
- Target: `packages/tools/src/tools/read.ts` (replace existing)

**Step 1:** Copy

```bash
cp openspec/references/pi/packages/coding-agent/src/core/tools/read.ts packages/tools/src/tools/read.ts
```

**Step 2:** Strip TUI (follow TUI Stripping Rules from top of this doc)

Remove:

- All `@earendil-works/pi-tui` imports
- All `modes/interactive/*` imports
- All `utils/image-resize.ts` import
- All `utils/mime.ts` import (use our own detection)
- All `render-utils.ts` imports
- `ToolDefinition`, `ToolRenderResultOptions` imports
- `wrapToolDefinition()` call
- `render()` method
- `keyHint`, `highlightCode`, `getLanguageFromPath`, `theme` usage

Replace:

- `resizeImage(buf, maxW, maxH)` → `await Bun.Image(buf).resize(maxW, maxH, { fit: "inside" }).png().bytes()`
- Make the tool factory return `AgentTool` directly (imported from `@sakti-code/agent`)

**Step 3:** Typecheck

```bash
bun typecheck
```

**Step 4:** Commit

```bash
git add packages/tools/src/tools/read.ts
git commit -m "feat(tools): port pi read tool (byte-accurate truncation, structured images)"
```

---

### Task 18: Port `write.ts`

**Files:**

- Reference: `openspec/references/pi/packages/coding-agent/src/core/tools/write.ts`
- Target: `packages/tools/src/tools/write.ts` (replace existing)

**Step 1:** Copy and strip TUI

```bash
cp openspec/references/pi/packages/coding-agent/src/core/tools/write.ts packages/tools/src/tools/write.ts
```

Strip TUI per rules. Key change: uses `withFileMutationQueue` from our ported utility.

**Step 2:** Typecheck + commit

```bash
bun typecheck
git add packages/tools/src/tools/write.ts
git commit -m "feat(tools): port pi write tool (mutation queue, proper dirname)"
```

---

### Task 19: Port `edit.ts` + `edit-diff.ts`

**Files:**

- Reference: `openspec/references/pi/packages/coding-agent/src/core/tools/edit.ts`
- Target: `packages/tools/src/tools/edit.ts` (replace existing)
- `edit-diff.ts` already ported in Task 16

**Step 1:** Copy and strip TUI

```bash
cp openspec/references/pi/packages/coding-agent/src/core/tools/edit.ts packages/tools/src/tools/edit.ts
```

Strip TUI. Key features gained:

- `prepareArguments` — legacy `oldText`/`newText` → `edits[]` conversion
- Fuzzy matching via `edit-diff.ts`
- Safety checks (empty oldText, no-op, overlap detection)
- Lone `\r` normalization
- `withFileMutationQueue`
- Diff/patch/firstChangedLine in result

**Step 2:** Typecheck + commit

```bash
bun typecheck
git add packages/tools/src/tools/edit.ts
git commit -m "feat(tools): port pi edit tool (fuzzy match, safety checks, legacy args)"
```

---

### Task 20: Port `bash.ts`

**Files:**

- Reference: `openspec/references/pi/packages/coding-agent/src/core/tools/bash.ts`
- Target: `packages/tools/src/tools/bash.ts` (replace existing)
- `output-accumulator.ts` already ported in Task 16

**Step 1:** Copy and strip TUI

```bash
cp openspec/references/pi/packages/coding-agent/src/core/tools/bash.ts packages/tools/src/tools/bash.ts
```

Strip TUI. Key features gained:

- Tail truncation (keeps last N lines, not first)
- Process tree kill (`detached: true` + `killProcessTree`)
- No forced 30s timeout
- Exit code status line
- `cwd` existence precheck
- `TextDecoder({stream: true})` for UTF-8 streaming
- Uses ported `OutputAccumulator`

**Step 2:** Replace `waitForChildProcess` utility

Pi imports this from `../../utils/child-process.ts`. Either:

- Port that utility (it's small — just promisifies child exit + cleanup)
- Or inline the logic: `await new Promise(r => child.on("exit", r))`

**Step 3:** Typecheck + commit

```bash
bun typecheck
git add packages/tools/src/tools/bash.ts
git commit -m "feat(tools): port pi bash tool (tail truncation, tree kill, UTF-8 safe)"
```

---

### Task 21: Port `grep.ts`

**Files:**

- Reference: `openspec/references/pi/packages/coding-agent/src/core/tools/grep.ts`
- Target: `packages/tools/src/tools/grep.ts` (replace existing)

**Step 1:** Copy and strip TUI

```bash
cp openspec/references/pi/packages/coding-agent/src/core/tools/grep.ts packages/tools/src/tools/grep.ts
```

Strip TUI. Key features gained:

- Async `spawn` instead of `execSync` (no event loop blocking)
- `rg --json` structured output (colon-parse bug eliminated)
- Global match counting (not per-file `--max-count`)
- `glob`, `literal`, `context` params
- Per-line truncation (50KB lines capped)
- Abort signal support
- Flag-injection immune (args array, no shell)

**Step 2:** Replace `ensureTool` with our `resolveBin`

**Step 3:** Typecheck + commit

```bash
bun typecheck
git add packages/tools/src/tools/grep.ts
git commit -m "feat(tools): port pi grep tool (async, rg --json, global count)"
```

---

### Task 22: Port `find.ts`

**Files:**

- Reference: `openspec/references/pi/packages/coding-agent/src/core/tools/find.ts`
- Target: `packages/tools/src/tools/find.ts` (replace existing)

**Step 1:** Copy and strip TUI

```bash
cp openspec/references/pi/packages/coding-agent/src/core/tools/find.ts packages/tools/src/tools/find.ts
```

Strip TUI. Key features gained:

- Async `spawn` instead of `execSync`
- `--full-path` when pattern contains `/`
- POSIX path normalization
- Abort signal support

**Step 2:** Replace `ensureTool` with `resolveBin`

**Step 3:** Typecheck + commit

```bash
bun typecheck
git add packages/tools/src/tools/find.ts
git commit -m "feat(tools): port pi find tool (async, path globs, POSIX normalization)"
```

---

### Task 23: Port `ls.ts`

**Files:**

- Reference: `openspec/references/pi/packages/coding-agent/src/core/tools/ls.ts`
- Target: `packages/tools/src/tools/ls.ts` (replace existing)

**Step 1:** Copy and strip TUI

```bash
cp openspec/references/pi/packages/coding-agent/src/core/tools/ls.ts packages/tools/src/tools/ls.ts
```

Strip TUI. Key features gained:

- Exists + isDir precheck
- "(empty directory)" notice
- Entry limit notice
- Alphabetical case-insensitive sort
- Abort signal

**Step 2:** Typecheck + commit

```bash
bun typecheck
git add packages/tools/src/tools/ls.ts
git commit -m "feat(tools): port pi ls tool (precheck, notices, case-insensitive sort)"
```

---

### Task 24: Update tools package exports + types

**Files:**

- Modify: `packages/tools/src/index.ts`
- Modify: `packages/tools/src/lib/types.ts`
- Remove: `packages/tools/src/lib/shared.ts` (replaced by pi's patterns)
- Remove: `packages/tools/src/lib/shell.ts` (replaced by output-accumulator + bash)

**Step 1:** Update `lib/types.ts` to align with pi's `AgentToolResult`

The tools now return `(TextContent | ImageContent)[]` content blocks. Update `ToolResult` type.

**Step 2:** Update exports

Export all tools + utility modules.

**Step 3:** Remove old utility files

```bash
git rm packages/tools/src/lib/shared.ts packages/tools/src/lib/shell.ts
```

**Step 4:** Typecheck

```bash
bun typecheck
```

**Step 5:** Commit

```bash
git add packages/tools/src/
git commit -m "refactor(tools): update exports and types for pi agent compatibility"
```

---

### Task 25: Server integration — ExecutionEnv + runner wiring

**Files:**

- Create: `apps/server/src/agent/execution-env.ts`
- Modify: `apps/server/src/agent/runner.ts`

**Step 1:** Implement `BunExecutionEnv`

```ts
import type { ExecutionEnv } from "@sakti-code/agent";
import { access, constants, readFile, readdir, stat, writeFile, mkdir, rm } from "node:fs/promises";
import { execSync, spawn } from "node:child_process";
import { resolve, dirname, basename } from "node:path";

export class BunExecutionEnv implements ExecutionEnv {
  async readTextFile(path: string): Promise<string> {
    return readFile(path, "utf-8");
  }
  async listDir(path: string): Promise<string[]> {
    return readdir(path).then((entries) => entries.map((e) => e.name));
  }
  async fileInfo(path: string) {
    const s = await stat(path);
    return { exists: true, isDirectory: s.isDirectory(), size: s.size, mtime: s.mtimeMs };
  }
  canonicalPath(path: string): string {
    return resolve(path);
  }
  async exists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
  exec(
    command: string,
    options?: { cwd?: string; timeout?: number; env?: Record<string, string> },
  ) {
    return execSync(command, {
      cwd: options?.cwd,
      timeout: options?.timeout ?? 30000,
      env: { ...process.env, ...options?.env },
      encoding: "utf-8",
    });
  }
  spawn(command: string, args: string[], options?: { cwd?: string; env?: Record<string, string> }) {
    return spawn(command, args, { cwd: options?.cwd, env: { ...process.env, ...options?.env } });
  }
}
```

**Step 2:** Update `runner.ts` to use `AgentHarness` + `SqliteSessionStorage` + `BunExecutionEnv`

Key changes to `runPrompt()`:

1. Create `SqliteSessionStorage` for the session
2. Create `BunExecutionEnv`
3. Create `AgentHarness` with all config
4. Call `harness.prompt()` instead of raw `createAgentLoop()`
5. Stream events from harness back over WS

**Step 3:** Typecheck

```bash
bun typecheck
```

**Step 4:** Run server tests

```bash
cd apps/server && bun test
```

**Step 5:** Commit

```bash
git add apps/server/src/agent/
git commit -m "feat(server): wire AgentHarness + SqliteSessionStorage + BunExecutionEnv"
```

---

### Task 26: Integration verification — run the full stack

**Step 1:** Start the server

```bash
bun dev:server
```

**Step 2:** Verify health check

```bash
curl http://localhost:3001/health
```

**Step 3:** Create a test session via WS and send a prompt

Use a test script or the existing app to send a prompt and verify:

- System prompt is sent to LLM
- Tools execute correctly
- Streaming events flow correctly
- Messages persist to SQLite
- Compaction triggers when context fills up

**Step 4:** Run full test suite

```bash
bun vitest run
cd packages/db && bun test
cd apps/server && bun test
```

**Step 5:** Fix any issues found

**Step 6:** Final commit

```bash
git add -A
git commit -m "feat: complete pi agent + tools port — integration verified"
```

---

## Execution Checklist

- [ ] Task 1: Preparation (branch, typebox, backup)
- [ ] Task 2: Port `types.ts`
- [ ] Task 3: Port `harness/types.ts`
- [ ] Task 4: Port utility modules (truncate, shell-output)
- [ ] Task 5: Port `messages.ts`
- [ ] Task 6: Port `session.ts`
- [ ] Task 7: SQLite schema + SqliteSessionStorage
- [ ] Task 8: Port compaction utils
- [ ] Task 9: Port compaction + branch-summarization
- [ ] Task 10: Port agent-loop.ts
- [ ] Task 11: Port agent.ts
- [ ] Task 12: Port agent-harness.ts
- [ ] Task 13: Port system-prompt.ts
- [ ] Task 14: Port skills.ts
- [ ] Task 15: Update agent exports
- [ ] Task 16: Port tool utilities
- [ ] Task 17: Port read.ts
- [ ] Task 18: Port write.ts
- [ ] Task 19: Port edit.ts
- [ ] Task 20: Port bash.ts
- [ ] Task 21: Port grep.ts
- [ ] Task 22: Port find.ts
- [ ] Task 23: Port ls.ts
- [ ] Task 24: Update tools exports + types
- [ ] Task 25: Server integration (ExecutionEnv + runner)
- [ ] Task 26: Integration verification
