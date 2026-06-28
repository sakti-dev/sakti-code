# Hashline Edit Tool Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a hashline edit mode to sakti-code's edit tool — a line-anchored patch language with content-hash validation, alongside the existing replace mode, using an adapter architecture like oh-my-pi's `EditTool` class.

**Architecture:** A single unified `edit` tool that dispatches to either the existing `replace` executor or a new `hashline` executor based on a mode setting. The hashline mode introduces: (1) a pure TypeScript parser + applier for the hashline patch language, (2) a snapshot store binding `[path#hash]` tags to full file content, (3) `[path#hash]` headers + numbered lines in the read tool's output format. The snapshot store lives as a singleton in `tools-builder.ts` and is shared between the read tool (recording snapshots) and the edit tool (validating + recovering).

**Tech Stack:** TypeScript-only (no Rust). TypeBox schemas. Works with the existing `AgentTool` interface. Snapshot store is an in-memory LRU cache (matching the oh-my-pi `InMemorySnapshotStore` pattern).

**Key concepts:**
- **Hashline patch language** — `SWAP N.=M:`, `DEL N..M`, `INS.PRE N:`, `INS.POST N:`, `INS.HEAD:`, `INS.TAIL:`, `REM`, `MV DEST`
- **4-hex content hash** — derived from the full normalized file content, anchors edits to a specific file version
- **Snapshot store** — records `path → { hash, fullText, seenLines }` so stale-tag edits can recover via 3-way merge
- **Adapter pattern** — `createEditTool(cwd, { mode })` returns an `AgentTool` whose `parameters` and `execute` match the selected mode

---

## Architecture Overview

```
                    ┌─────────────────────┐
                    │    tools-builder.ts  │
                    │  buildTools(cwd)     │
                    └────────┬────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     createEditTool()  createReadTool()    ...
     (mode-aware)      (emits [path#hash]
              │         + line numbers)    │
              │              │              │
              ▼              ▼              │
     ┌────────────────┐  ┌──────────┐       │
     │  EditTool       │  │ ReadTool │       │
     │  - mode resolver│  │ - hash   │       │
     │  - replace exec │  │   header │       │
     │  - hashline exec│  │ - line # │       │
     └───────┬────────┘  └────┬─────┘       │
             │                │              │
             └────┬───────────┘              │
                  │                          │
          ┌───────▼────────┐                │
          │ SnapshotStore  │                │
          │ (singleton)    │◄───────────────┘
          │ - record()     │
          │ - byHash()     │
          │ - head()       │
          └────────────────┘

     Hashline Core Library (pure TS, no IO):
     ┌──────────────────────────────────────┐
     │  types.ts       — Anchor, Cursor,    │
     │                    Edit, ApplyResult  │
     │  tokenizer.ts   — line classifier    │
     │  parser.ts      — state machine      │
     │  apply.ts       — applyEdits()       │
     │  format.ts      — computeFileHash()  │
     │  input.ts       — Patch/PatchSection │
     │  snapshots.ts   — SnapshotStore      │
     └──────────────────────────────────────┘
```

---

## Task Breakdown

### Task 1: Hashline Core Types (`packages/tools/src/lib/hashline/types.ts`)

**Files:**
- Create: `packages/tools/src/lib/hashline/types.ts`
- Test: `packages/tools/src/lib/__tests__/hashline.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import type { Anchor, ApplyResult, Cursor, Edit } from "../hashline/types";

describe("Hashline types", () => {
  it("Anchor is a 1-indexed line number", () => {
    const anchor: Anchor = { line: 1 };
    expect(anchor.line).toBe(1);
  });

  it("Cursor can be bof, eof, before_anchor, or after_anchor", () => {
    const bof: Cursor = { kind: "bof" };
    expect(bof.kind).toBe("bof");

    const before: Cursor = { kind: "before_anchor", anchor: { line: 5 } };
    expect(before.kind).toBe("before_anchor");
    expect(before.anchor.line).toBe(5);
  });

  it("Edit can be insert, delete, or block", () => {
    const insert: Edit = { kind: "insert", cursor: { kind: "bof" }, text: "hello", lineNum: 1, index: 0 };
    expect(insert.kind).toBe("insert");

    const del: Edit = { kind: "delete", anchor: { line: 3 }, lineNum: 2, index: 1 };
    expect(del.kind).toBe("delete");
  });

  it("ApplyResult has text and optional firstChangedLine", () => {
    const result: ApplyResult = { text: "hello\nworld", firstChangedLine: 1 };
    expect(result.text).toBe("hello\nworld");
    expect(result.firstChangedLine).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/tools && pnpm vitest run src/lib/__tests__/hashline.test.ts`
Expected: FAIL - "Cannot find module" (file doesn't exist)

**Step 3: Write minimal implementation**

```typescript
export interface Anchor {
  line: number;
}

export type Cursor =
  | { kind: "bof" }
  | { kind: "eof" }
  | { kind: "before_anchor"; anchor: Anchor }
  | { kind: "after_anchor"; anchor: Anchor };

export type Edit =
  | { kind: "insert"; cursor: Cursor; text: string; lineNum: number; index: number; mode?: "replacement"; blockStart?: number }
  | { kind: "delete"; anchor: Anchor; lineNum: number; index: number }
  | { kind: "block"; anchor: Anchor; payloads: string[]; mode?: "insert_after"; lineNum: number; index: number };

export type FileOp = { kind: "rem" } | { kind: "move"; dest: string };

export interface ApplyResult {
  text: string;
  firstChangedLine?: number;
  warnings?: string[];
  blockResolutions?: BlockResolution[];
}

export interface ParsedRange {
  start: Anchor;
  end: Anchor;
}

export interface BlockSpan {
  start: number;
  end: number;
}

export interface BlockResolution {
  anchorLine: number;
  start: number;
  end: number;
  op: "replace" | "delete" | "insert_after";
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/tools && pnpm vitest run src/lib/__tests__/hashline.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/tools/src/lib/hashline/types.ts packages/tools/src/lib/__tests__/hashline.test.ts
git commit -m "feat(hashline): add core types (Anchor, Cursor, Edit, ApplyResult)"
```

---

### Task 2: File Hash Computation (`packages/tools/src/lib/hashline/format.ts`)

**Files:**
- Create: `packages/tools/src/lib/hashline/format.ts`
- Modify: `packages/tools/src/lib/__tests__/hashline.test.ts`

**Step 1: Write the failing test**

Add to `hashline.test.ts`:

```typescript
import { computeFileHash, formatHashlineHeader } from "../hashline/format";

describe("computeFileHash", () => {
  it("produces a consistent 4-hex-char hash", () => {
    const hash = computeFileHash("hello\nworld\n");
    expect(hash).toMatch(/^[0-9A-F]{4}$/);
  });

  it("produces the same hash for identical content", () => {
    const a = computeFileHash("const x = 1;\n");
    const b = computeFileHash("const x = 1;\n");
    expect(a).toBe(b);
  });

  it("produces different hashes for different content", () => {
    const a = computeFileHash("hello\n");
    const b = computeFileHash("world\n");
    expect(a).not.toBe(b);
  });
});

describe("formatHashlineHeader", () => {
  it("formats [path#HASH]", () => {
    expect(formatHashlineHeader("src/foo.ts", "A1B2")).toBe("[src/foo.ts#A1B2]");
  });
});
```

**Step 2 & 3: Run, implement, run**

The hash function: FNV-1a 32-bit, mask to 16 bits (4 hex chars), uppercase. This matches oh-my-pi's approach — fast, non-cryptographic, collision-resistant enough for edit anchoring.

```typescript
const HL_FILE_PREFIX = "[";
const HL_FILE_SUFFIX = "]";
const HL_FILE_HASH_SEP = "#";
const HL_FILE_HASH_LENGTH = 4;

export function computeFileHash(text: string): string {
  let hash = 0x811C9DC5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash & 0xFFFF).toString(16).toUpperCase().padStart(4, "0");
}

export function formatHashlineHeader(path: string, hash: string): string {
  return `${HL_FILE_PREFIX}${path}${HL_FILE_HASH_SEP}${hash}${HL_FILE_SUFFIX}`;
}
```

**Step 4 & 5:** Run tests, commit.

---

### Task 3: Hashline Tokenizer (`packages/tools/src/lib/hashline/tokenizer.ts`)

**Files:**
- Create: `packages/tools/src/lib/hashline/tokenizer.ts`
- Modify: `packages/tools/src/lib/__tests__/hashline.test.ts`

The tokenizer classifies each line of a hashline patch into tokens:
- `header` — `[path#HASH]` or `[path]`
- `op-block` — `SWAP 5.=7:`, `DEL 10..12`, `INS.PRE 3:`, `INS.POST 3:`, `INS.HEAD:`, `INS.TAIL:`, `REM`, `MV "dest.ts"`
- `payload-literal` — `+literal body`
- `raw` — anything else (context lines, bare body)
- `blank` — empty line
- `envelope-begin/end` — `*** Begin/End Patch`
- `abort` — `*** Abort`

Key constants:

```typescript
export const HL_REPLACE_KEYWORD = "SWAP";
export const HL_DELETE_KEYWORD = "DEL";
export const HL_INSERT_KEYWORD = "INS";
export const HL_INSERT_BEFORE = "PRE";
export const HL_INSERT_AFTER = "POST";
export const HL_INSERT_HEAD = "HEAD";
export const HL_INSERT_TAIL = "TAIL";
export const HL_REM_KEYWORD = "REM";
export const HL_MOVE_KEYWORD = "MV";
export const HL_REPLACE_BLOCK_KEYWORD = "SWAP.BLK";
export const HL_DELETE_BLOCK_KEYWORD = "DEL.BLK";
export const HL_INSERT_AFTER_BLOCK_KEYWORD = "INS.BLK.POST";
export const HL_PAYLOAD_REPLACE = "+";
export const HL_HEADER_COLON = ":";
export const HL_FILE_PREFIX = "[";
export const HL_FILE_SUFFIX = "]";
export const HL_FILE_HASH_SEP = "#";
export const HL_FILE_HASH_LENGTH = 4;
```

Step 1 tests: tokenize header lines, op-block lines, payload-literal lines, raw lines, blank lines.
Step 3: implement `Tokenizer` class with `feed(chunk)`, `end()`, `tokenize(line)`, `isOp(line)`.

---

### Task 4: Hashline Parser (`packages/tools/src/lib/hashline/parser.ts`)

**Files:**
- Create: `packages/tools/src/lib/hashline/parser.ts`
- Modify: `packages/tools/src/lib/__tests__/hashline.test.ts`

The `Executor` class is a state machine consuming tokens and producing `Edit[]`.

State transitions:
```
op-block token → flush pending → start new pending op
payload-literal token → add to pending payload
blank token → defer (interior or trailing)
raw token → add as bare payload (or error if no pending op)
```

Step 1 test: parse a simple `SWAP 5.=7:` with body, verify edits produced.
Step 1 test: parse `DEL 10..12` with no body, verify delete edits.
Step 1 test: parse `INS.POST 3:` with body, verify insert_after edits.
Step 1 test: parse streaming input with incomplete trailing op.

---

### Task 5: Hashline Applier (`packages/tools/src/lib/hashline/apply.ts`)

**Files:**
- Create: `packages/tools/src/lib/hashline/apply.ts`
- Modify: `packages/tools/src/lib/__tests__/hashline.test.ts`

Pure function: `applyEdits(text, edits) → { text, firstChangedLine, warnings }`.

Applies edits bottom-up (by anchor line) so earlier deletes don't shift later anchors.
- BOF inserts first, EOF inserts last
- Per-line: before-inserts, replacement inserts, keep-line / delete, after-inserts
- Drops phantom deletes (trailing "" of newline-terminated file)
- Validates line bounds

Step 1 tests:
- Single line replace
- Multi-line replace (range)
- Delete lines
- Insert before, after, head, tail
- Insert at BOF on empty file
- Out-of-bounds anchor errors

---

### Task 6: Patch/PatchSection (`packages/tools/src/lib/hashline/input.ts`)

**Files:**
- Create: `packages/tools/src/lib/hashline/input.ts`
- Modify: `packages/tools/src/lib/__tests__/hashline.test.ts`

`Patch.parse(input)` splits raw hashline input by `[path#HASH]` headers into `PatchSection[]`.
Each `PatchSection` lazily parses its diff body.

Step 1 tests:
- Single section patch
- Multi-section patch (two `[path]` headers)
- Section with tagged hash
- Fallback path when no header exists
- Malformed header error

---

### Task 7: Snapshot Store (`packages/tools/src/lib/hashline/snapshots.ts`)

**Files:**
- Create: `packages/tools/src/lib/hashline/snapshots.ts`
- Modify: `packages/tools/src/lib/__tests__/hashline.test.ts`

Abstract `SnapshotStore` class (for future persistence) + `InMemorySnapshotStore` implementation.

```typescript
export class InMemorySnapshotStore extends SnapshotStore {
  // record(path, fullText, seenLines?) → hash string
  // head(path) → Snapshot | null
  // byHash(path, hash) → Snapshot | null
  // findByHash(hash) → Snapshot[] (for cross-path recovery)
  // recordSeenLines(path, hash, lines)
  // invalidate(path)
  // relocate(from, to)
  // clear()
}
```

Step 1 tests:
- Record and retrieve by hash
- Record same content twice → same hash, no duplicate
- RecordSeenLines merges into existing snapshot
- FindByHash returns all paths with that hash
- Invalidate clears path history
- Relocate moves history to new path

---

### Task 8: Read Tool Changes (`packets/tools/src/tools/read.ts`)

**Files:**
- Modify: `packages/tools/src/tools/read.ts`
- Modify: `packages/tools/src/__tests__/tools.test.ts`

When a snapshot store is provided via `ReadToolOptions`, the read tool:
1. Computes `computeFileHash()` on the full file content
2. Formats output as:
   ```
   [relative/path#A1B2]
    1: line one
    2: line two
   ```
3. Records the snapshot via `store.record(path, fullText, seenLineNumbers)`

**Key design decision:** The hash is computed on the **full file**, not just the displayed portion. This means the read tool reads the whole file to compute the hash, even if truncation limits the displayed output. This is correct — the hash must cover the full file for the edit tool to validate that the file hasn't changed between read and edit.

For partial reads (offset/limit), only the displayed lines are recorded as `seenLines` (for the anchor-visible-lines check).

```typescript
export interface ReadToolOptions {
  autoResizeImages?: boolean;
  operations?: ReadOperations;
  snapshotStore?: SnapshotStore;  // new
}
```

Step 1 tests:
- Read without snapshot store → unchanged format
- Read with snapshot store → output includes `[path#HASH]` header and line numbers
- Partial read → header still has full-file hash, only displayed lines in seenLines
- Write tool also records snapshot after successful write (so next edit sees current hash)

---

### Task 9: Hashline Edit Executor (`packages/tools/src/tools/edit-hashline-executor.ts`)

**Files:**
- Create: `packages/tools/src/lib/hashline/execute.ts`
- Create: `packages/tools/src/lib/hashline/fs.ts` (abstract Filesystem seam)
- Modify: `packages/tools/src/lib/__tests__/hashline.test.ts`

The hashline executor wraps the pure parser + applier with the filesystem + snapshot store:

1. `Patch.parse(input, { cwd })` → sections
2. For each section:
   a. Resolve path via `resolveToCwd()`
   b. Read file via `fs.readFile()`
   c. Compute file hash → compare with section's `fileHash`
   d. If hash matches → apply edits directly
   e. If hash doesn't match → try recovery (3-way merge via `Recovery`)
   f. If recovery fails → throw `MismatchError`
3. Write result back to file
4. Record new snapshot

The `Filesystem` abstract class (in `fs.ts`) is the IO seam, exactly like oh-my-pi's:

```typescript
export abstract class Filesystem {
  abstract readText(relativePath: string): Promise<string>;
  abstract writeText(relativePath: string, content: string): Promise<{ text: string }>;
  abstract delete(relativePath: string): Promise<void>;
  abstract move(from: string, to: string, content?: string): Promise<void>;
  abstract exists(relativePath: string): Promise<boolean>;
  abstract resolveAbsolute(relativePath: string): string;
  abstract canonicalPath(relativePath: string): string;
}
```

The concrete `NodeFilesystem` implementation uses `node:fs/promises`.

---

### Task 10: Recovery (`packages/tools/src/lib/hashline/recovery.ts`)

**Files:**
- Create: `packages/tools/src/lib/hashline/recovery.ts`
- Modify: `packages/tools/src/lib/__tests__/hashline.test.ts`

When a section tag doesn't match the live file hash:
1. Look up the tagged snapshot via `store.byHash(path, hash)`
2. Apply edits against the snapshot text
3. Compute a `diff` between snapshot-before and snapshot-after
4. Apply that diff onto the live content via `Diff.applyPatch()` (from the `diff` npm package)
5. If 3-way merge succeeds → return merged result + warning
6. If fails → return null (caller throws `MismatchError`)

---

### Task 11: Edit Tool Adapter (`packages/tools/src/tools/edit.ts` refactor)

**Files:**
- Modify: `packages/tools/src/tools/edit.ts` — major refactor
- Modify: `packages/tools/src/__tests__/tools.test.ts`
- Modify: `packages/tools/src/index.ts`

Refactor `createEditTool` to:

```typescript
export interface EditToolOptions {
  mode?: "replace" | "hashline";
  operations?: EditOperations;
  snapshotStore?: SnapshotStore;  // required for hashline mode
}

export function createEditTool(
  cwd: string,
  options?: EditToolOptions
): AgentTool<...> {
  if (options?.mode === "hashline") {
    return createHashlineEditTool(cwd, options);
  }
  return createReplaceEditTool(cwd, options);
}
```

But to keep the single-tool-name architecture, we return one object whose `parameters` and `execute` are mode-dependent:

```typescript
export function createEditTool(
  cwd: string,
  options?: EditToolOptions
): AgentTool<TSchema, EditToolDetails | undefined> {
  const mode = options?.mode ?? "replace";
  const parameters = mode === "hashline"
    ? hashlineEditSchema
    : replaceEditSchema;

  return {
    name: "edit",
    label: "edit",
    get description() { ... },       // mode-aware
    get parameters() { ... },        // mode-aware
    permissions(params) { ... },
    prepareArguments,
    async execute(toolCallId, input, signal, onUpdate) {
      if (mode === "hashline") {
        return executeHashline(cwd, input, options?.snapshotStore, signal);
      }
      return executeReplace(cwd, input, options?.operations, signal);
    },
  };
}
```

**For hashline mode schema:**
```typescript
const hashlineEditSchema = Type.Object({
  input: Type.String({
    description: "Hashline patch with SWAP/DEL/INS/REM/MV operations"
  })
});
```

**For replace mode schema:** unchanged from current.

---

### Task 12: Integration — tools-builder.ts + runner.ts

**Files:**
- Modify: `apps/server/src/agent/tools-builder.ts`
- Modify: `apps/server/src/agent/runner.ts`

Create snapshot store as a singleton in `tools-builder.ts`, share between read and edit tools:

```typescript
import { InMemorySnapshotStore } from "@sakti-code/tools/lib/hashline/snapshots";

export function buildTools(cwd: string): AgentTool[] {
  const snapshotStore = new InMemorySnapshotStore();

  return [
    createReadTool(cwd, { autoResizeImages: true, snapshotStore }),
    createWriteTool(cwd),
    createEditTool(cwd, { mode: "hashline", snapshotStore }),
    createBashTool(cwd),
    createGrepTool(cwd),
    createFindTool(cwd),
    createLsTool(cwd),
  ];
}
```

The mode setting should come from the session's profile/settings. For now, bake `mode: "hashline"` as the default and allow override from settings later.

---

### Task 13: Write Tool Snapshot Recording (`packages/tools/src/tools/write.ts`)

**Files:**
- Modify: `packages/tools/src/tools/write.ts`

After a successful write, record the snapshot so the next hashline edit validates against the fresh content. The write tool must also format its output with `[path#HASH]` header when a snapshot store is configured.

---

### Task 14: End-to-End Tests

**Files:**
- Modify: `packages/tools/src/__tests__/tools.test.ts`

Add tests for:
- Hashline edit: single replace (SWAP)
- Hashline edit: delete lines (DEL)
- Hashline edit: insert (INS.PRE, INS.POST, INS.HEAD, INS.TAIL)
- Hashline edit: stale tag rejection (modify file between read and edit)
- Hashline edit: read+edit roundtrip via snapshot store
- Hashline edit: multi-section patch in one call

---

## Key Design Decisions

### 1. Mode at creation time vs runtime

**Decision: Mode is baked at tool-creation time** (passed in `createEditTool(cwd, { mode })`). This is simpler and matches the current architecture where `tools-builder.ts` produces the tool array once per session. Runtime mode switching can be added later by making the mode a session setting and regenerating tools.

### 2. Snapshot store lifecycle

**Decision: Singleton per `buildTools()` call**, shared between read, write, and edit tools. The snapshot store lives for the duration of a session. It is not persisted to disk (session-only recovery). If compaction clears the store, the next read re-populates it.

### 3. Hash algorithm

**Decision: FNV-1a 32-bit → 16-bit (4 hex chars).** Same as oh-my-pi. Collision risk is ~1/65536 for any two different files; within a session with ~100 edits this is negligible. Fast, no dependencies.

### 4. Recovery strategy

**Decision: 3-way merge via `diff` npm package** (already a dependency). Apply edits against the snapshot, produce a unified diff, apply that diff to the live content with `fuzzFactor: 0`. Reject if the merge doesn't align exactly.

### 5. File hash always on full content

**Decision: The `[path#HASH]` tag always covers the full file**, not the displayed portion. The read tool reads the full file to compute the hash even when truncating output. Partial reads record `seenLines` so the edit tool can reject anchors targeting lines the model hasn't seen.

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `packages/tools/src/lib/hashline/types.ts` | Create | Core type definitions |
| `packages/tools/src/lib/hashline/format.ts` | Create | Hash computation + header formatting |
| `packages/tools/src/lib/hashline/tokenizer.ts` | Create | Line classifier |
| `packages/tools/src/lib/hashline/parser.ts` | Create | Token state machine → Edit[] |
| `packages/tools/src/lib/hashline/apply.ts` | Create | applyEdits() pure function |
| `packages/tools/src/lib/hashline/input.ts` | Create | Patch/PatchSection parsing |
| `packages/tools/src/lib/hashline/snapshots.ts` | Create | SnapshotStore (abstract + in-memory) |
| `packages/tools/src/lib/hashline/recovery.ts` | Create | 3-way-merge stale-tag recovery |
| `packages/tools/src/lib/hashline/execute.ts` | Create | Hashline executor (FS + snapshots) |
| `packages/tools/src/lib/hashline/fs.ts` | Create | Abstract Filesystem seam |
| `packages/tools/src/tools/edit.ts` | Modify | Add mode dispatch + hashline schema |
| `packages/tools/src/tools/read.ts` | Modify | Add `[path#HASH]` + line numbers |
| `packages/tools/src/tools/write.ts` | Modify | Record snapshot after write |
| `packages/tools/src/index.ts` | Modify | Export new types |
| `apps/server/src/agent/tools-builder.ts` | Modify | Create + share SnapshotStore |
| `packages/tools/src/lib/__tests__/hashline.test.ts` | Create | Core lib tests |
| `packages/tools/src/__tests__/tools.test.ts` | Modify | Tool-level tests |

---

## Commit Sequence

1. `feat(hashline): add core types (Anchor, Cursor, Edit, ApplyResult)`
2. `feat(hashline): add file hash computation and header formatting`
3. `feat(hashline): add tokenizer for hashline patch language`
4. `feat(hashline): add parser (Executor state machine)`
5. `feat(hashline): add applyEdits pure function`
6. `feat(hashline): add Patch/PatchSection input parsing`
7. `feat(hashline): add InMemorySnapshotStore`
8. `feat(hashline): add 3-way-merge recovery`
9. `feat(hashline): add hashline executor (Filesystem + SnapshotStore)`
10. `feat(hashline): refactor createEditTool with mode dispatch`
11. `feat(read): add [path#HASH] headers and line-numbered output`
12. `feat(write): record snapshot after successful write`
13. `feat(server): wire SnapshotStore into tools-builder`
14. `test: add end-to-end hashline edit tests`
