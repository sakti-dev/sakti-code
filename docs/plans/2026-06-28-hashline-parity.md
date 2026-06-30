# Hashline Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the hashline edit tool to full parity with the oh-my-pi reference — bounded snapshot store (lru-cache), no-op loop guard, tree-sitter block resolution via our own napi crate, missing test coverage, and diff preview — closing the gaps found in the 2026-06-28 deep-dive review.

**Architecture:**

- A new Rust crate `crates/pi-natives/` (napi-rs cdylib) path-depends on the vendored `vendor/pi-crates/crates/pi-ast` and exposes `block_range_at` (+ AST ops later) to Node as the `@sakti-code/pi-natives` workspace package. napi-rs addons are N-API ABI-stable, so they load under Electron **without** rebuild (unlike node-pty).
- The hashline TS layer (`packages/tools/src/edit/hashline/`) gains: `block.ts` (language-agnostic block-edit resolver), a `block-resolver.ts` wrapper over `@sakti-code/pi-natives`, a bounded `InMemorySnapshotStore` (lru-cache), and a no-op loop guard. The patcher/input wires the resolver; the edit tool wires the guard and diff preview.

**Tech Stack:** Rust (edition 2024, napi-rs 3.x), TypeScript (exactOptionalPropertyTypes + noUncheckedIndexedAccess), vitest, pnpm workspace, node:sqlite unaffected.

**Reference sources (now vendored in our repo):**

- `vendor/pi-crates/crates/pi-ast/src/{block.rs,summary.rs,ops.rs,language/,lib.rs}` — the Rust algorithms
- `openspec/references/oh-my-pi/packages/hashline/src/` — the TS reference (block.ts, diff-preview.ts, snapshots.ts, etc.)
- `openspec/references/oh-my-pi/packages/hashline/test/` — reference unit tests (~205 tests)
- `openspec/references/oh-my-pi/packages/coding-agent/src/edit/hashline/` — wrapper layer (noop-loop-guard.ts, block-resolver.ts, execute.ts, diff.ts)

**Status of foundation (DONE before this plan):**

- ✅ Fork branch `crates-only` on `sakti-dev/oh-my-pi` (filter-repo, ~8MB)
- ✅ Subtree at `vendor/pi-crates/` (workspace globs intact, pi-ast resolves with zero Cargo surgery)
- ✅ `scripts/sync-pi-crates.sh` + `pi:sync`/`pi:pull`/`pi:push` scripts

**Conventions (from AGENTS.md):**

- TDD: failing test first (RED), implement to green, refactor. Verify RED before implementing.
- `exactOptionalPropertyTypes: true` + `noUncheckedIndexedAccess: true` — guard all optional spreads and array accesses.
- Tests in `__tests__/` colocated with source; vitest throughout.
- `pnpm run fix` before committing; `pnpm run typecheck` to verify.
- No `console.log` in production code; use the structured logger where logs are needed.
- Port discipline: copy from reference then adapt (Bun._ → node:_, `#private` is fine to keep, catalog deps → concrete versions). Do not rewrite from scratch.

---

## Phase 1 — `crates/pi-natives` (Rust + napi-rs)

Expose `block_range_at` to Node. This is the highest-risk phase (new toolchain). Land a smoke test first that proves Node → Rust → pi-ast → span, then expand the surface.

### Task 1.1: Scaffold the Rust workspace + napi crate skeleton

**Files:**

- Create: `Cargo.toml` (repo-root Rust workspace manifest — NOT part of the pnpm workspace)
- Create: `crates/pi-natives/Cargo.toml`
- Create: `crates/pi-natives/build.rs`
- Create: `crates/pi-natives/src/lib.rs`
- Create: `crates/pi-natives/package.json` (the `@sakti-code/pi-natives` package)
- Create: `crates/pi-natives/.gitignore`

**Step 1: Repo-root `Cargo.toml` (our Rust workspace, separate from vendor's)**

```toml
[workspace]
members = ["crates/pi-natives"]
resolver = "3"

[profile.release]
opt-level = 3
lto = "fat"
```

> Note: `vendor/pi-crates/Cargo.toml` is its own workspace root. Our crate path-depends into it; Cargo resolves cross-workspace path deps fine (pi-ast's `workspace = true` refs resolve against `vendor/pi-crates/Cargo.toml`, not ours). Do NOT add `vendor/` to our `[workspace] members`.

**Step 2: `crates/pi-natives/Cargo.toml`**

```toml
[package]
name = "pi-natives"
version = "0.0.0"
edition = "2024"
license = "MIT"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { version = "3", features = ["napi8"] }
napi-derive = "3"
pi-ast = { path = "../../vendor/pi-crates/crates/pi-ast" }

[build-dependencies]
napi-build = "3"
```

**Step 3: `crates/pi-natives/build.rs`**

```rust
fn main() {
    napi_build::setup();
}
```

**Step 4: `crates/pi-natives/src/lib.rs`** (skeleton — no napi fns yet, just proves it builds)

```rust
#[macro_use]
extern crate napi_derive;
```

**Step 5: `crates/pi-natives/package.json`**

```json
{
  "name": "@sakti-code/pi-natives",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./index.js",
  "types": "./index.d.ts",
  "scripts": {
    "build": "napi build --platform --release",
    "build:debug": "napi build --platform",
    "prepublishOnly": "napi prepublish -t npm"
  },
  "devDependencies": {
    "@napi-rs/cli": "^3"
  }
}
```

**Step 6: `crates/pi-natives/.gitignore`**

```
index.js
index.d.ts
*.node
target/
```

**Step 7: Verify it compiles (no Node binding yet)**

Run (from repo root, in `nix-shell -p rustc cargo` or after `rustup default stable`):

```bash
cd crates/pi-natives && cargo check
```

Expected: compiles (pi-ast + 62 grammars fetched + built; first run is slow ~3-5 min, cached after).

**Step 8: Commit**

```bash
git add Cargo.toml crates/pi-natives/ && git commit -m "feat(natives): scaffold pi-natives napi crate path-depending on pi-ast"
```

---

### Task 1.2: Expose `blockRangeAt` via napi + smoke test

**Files:**

- Modify: `crates/pi-natives/src/lib.rs` (add the napi fn)
- Test: `crates/pi-natives/__tests__/smoke.test.ts`

**Step 1: Write the failing smoke test (RED)**

`crates/pi-natives/__tests__/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { blockRangeAt } from "../index.js";

describe("blockRangeAt (napi)", () => {
  it("resolves the function block beginning on line 1", () => {
    const code = "function x() {\n  if (y) {\n  }\n}\n";
    const range = blockRangeAt({ code, path: "x.ts", line: 1 });
    expect(range).toEqual({ startLine: 1, endLine: 4 });
  });

  it("resolves the inner if block on line 2", () => {
    const code = "function x() {\n  if (y) {\n  }\n}\n";
    expect(blockRangeAt({ code, path: "x.ts", line: 2 })).toEqual({ startLine: 2, endLine: 3 });
  });

  it("returns null for a lone closing brace", () => {
    const code = "function x() {\n  if (y) {\n  }\n}\n";
    expect(blockRangeAt({ code, path: "x.ts", line: 3 })).toBeNull();
  });

  it("returns null for a blank line", () => {
    expect(
      blockRangeAt({ code: "function f() {\n\n  return 1;\n}\n", path: "f.ts", line: 2 }),
    ).toBeNull();
  });

  it("resolves a python def (indentation language)", () => {
    expect(blockRangeAt({ code: "def greet():\n    return 1\n", path: "g.py", line: 1 })).toEqual({
      startLine: 1,
      endLine: 2,
    });
  });

  it("returns null for an unrecognized extension", () => {
    expect(blockRangeAt({ code: "function x() {}", path: "x.unknownext", line: 1 })).toBeNull();
  });
});
```

**Step 2: Run it (RED — import fails because no binding built yet)**

```bash
cd crates/pi-natives && pnpm vitest run
```

Expected: FAIL — cannot find `../index.js`.

**Step 3: Add the napi binding**

`crates/pi-natives/src/lib.rs`:

```rust
#[macro_use]
extern crate napi_derive;

use napi::bindgen_prelude::*;

#[napi(object)]
pub struct BlockRangeOptions {
    /// Source code to inspect.
    pub code: String,
    /// Language alias (e.g. "rust", "typescript"); overrides path inference.
    pub lang: Option<String>,
    /// File path used to infer language by extension when `lang` is None.
    pub path: Option<String>,
    /// 1-indexed source line the block must begin on.
    pub line: u32,
}

#[napi(object)]
pub struct BlockRange {
    /// 1-indexed inclusive first line of the resolved block.
    pub start_line: u32,
    /// 1-indexed inclusive last line of the resolved block.
    pub end_line: u32,
}

/// Find the outermost named tree-sitter node that begins on `options.line`.
/// Returns its 1-indexed inclusive line span, or null when the language is
/// unrecognized, the line is blank/out-of-range, no node begins there, or the
/// resolved subtree contains a syntax error.
#[napi]
pub fn block_range_at(options: BlockRangeOptions) -> Result<Option<BlockRange>> {
    pi_ast::block::block_range_at(pi_ast::block::BlockRangeOptions {
        code: options.code,
        lang: options.lang,
        path: options.path,
        line: options.line,
    })
    .map(|range| range.map(|r| BlockRange { start_line: r.start_line, end_line: r.end_line }))
    .map_err(|e| Error::from_reason(e.to_string()))
}
```

> This mirrors `vendor/pi-crates/crates/pi-ast/src/block.rs`'s public `block_range_at` exactly. The `BlockRange`/`BlockRangeOptions` in pi-ast are `pub` structs with `pub start_line`/`end_line` — confirm field names by reading `vendor/pi-crates/crates/pi-ast/src/block.rs:18-38`.

**Step 4: Build the binding**

```bash
cd crates/pi-natives && pnpm run build:debug
```

Expected: produces `index.js`, `index.d.ts`, `*.node`. If `pi_ast::block::block_range_at` isn't public, check `vendor/pi-crates/crates/pi-ast/src/lib.rs` — it must `pub mod block;` (it does: `pub use`/`pub mod`).

**Step 5: Run the test (GREEN)**

```bash
cd crates/pi-natives && pnpm vitest run
```

Expected: 6 tests pass.

**Step 6: Commit**

```bash
git add crates/pi-natives/src/lib.rs crates/pi-natives/__tests__/ && git commit -m "feat(natives): expose blockRangeAt via napi, port pi-ast block tests"
```

---

### Task 1.3: Wire `@sakti-code/pi-natives` into the pnpm workspace + typecheck gate

**Files:**

- Modify: root `package.json` `workspaces` → add `"crates/*"`
- Modify: `turbo.json` (add a `build:natives` pipeline if you want it in `turbo run build`; otherwise document `pnpm --filter @sakti-code/pi-natives build`)

**Step 1: Add to workspace**

Root `package.json`:

```json
"workspaces": ["apps/*", "packages/*", "crates/*"],
```

**Step 2: Verify resolution**

```bash
pnpm install
node -e "import('@sakti-code/pi-natives').then(m => console.log(Object.keys(m)))"
```

Expected: prints `[ 'blockRangeAt' ]` (after `pnpm --filter @sakti-code/pi-natives build:debug`).

**Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml && git commit -m "chore(natives): add @sakti-code/pi-natives to pnpm workspace"
```

---

## Phase 2 — Bounded snapshot store (lru-cache)

The reference uses `lru-cache` with `max: 30` paths, `maxSize: 64 MiB`, and a `sizeCalculation` on text length. Ours uses an unbounded `Map` — a real memory leak in long sessions.

### Task 2.1: Install lru-cache

```bash
pnpm add lru-cache --filter @sakti-code/tools
```

### Task 2.2: Port the eviction tests (RED)

**File:** `packages/tools/src/lib/hashline-utils/__tests__/snapshots.test.ts` (new file)

Port from `openspec/references/oh-my-pi/packages/hashline/test/snapshots.test.ts`. The behaviors to pin (these are the ones our Map-based store currently can't defend):

```ts
import { describe, expect, it } from "vitest";
import { InMemorySnapshotStore } from "../snapshots";

describe("InMemorySnapshotStore eviction", () => {
  it("evicts the least-recently-used path when maxPaths is exceeded", () => {
    const store = new InMemorySnapshotStore({ maxPaths: 2 });
    store.record("/a", "a-content");
    store.record("/b", "b-content");
    // touch /a to make /b the LRU
    store.head("/a");
    store.record("/c", "c-content"); // exceeds maxPaths=2
    expect(store.head("/b")).toBeNull(); // /b evicted
    expect(store.head("/a")).not.toBeNull();
    expect(store.head("/c")).not.toBeNull();
  });

  it("bounds total bytes via maxTotalBytes (largest path history evicted)", () => {
    const store = new InMemorySnapshotStore({ maxTotalBytes: 50 });
    store.record("/big", "x".repeat(40));
    store.record("/small", "y".repeat(5));
    store.record("/new", "z".repeat(10)); // pushes over 50
    // the biggest contributor should be evicted to get under budget
    expect(store.head("/big")).toBeNull();
  });

  it("retains at most maxVersionsPerPath versions", () => {
    const store = new InMemorySnapshotStore({ maxVersionsPerPath: 2 });
    store.record("/f", "v1");
    store.record("/f", "v2");
    store.record("/f", "v3");
    expect(store.byHash("/f" /* hash of v1 */)).toBeNull(); // v1 dropped
  });

  it("relocates history preserving seenLines", () => {
    const store = new InMemorySnapshotStore();
    const tag = store.record("/a", "content", new Set([1, 2, 3]));
    store.relocate("/a", "/b");
    expect(store.head("/a")).toBeNull();
    const head = store.head("/b");
    expect(head?.seenLines).toEqual(new Set([1, 2, 3]));
    expect(head?.hash).toBe(tag);
  });

  it("promotes a re-observed older version to head", () => {
    const store = new InMemorySnapshotStore();
    const t1 = store.record("/f", "v1");
    store.record("/f", "v2");
    store.record("/f", "v1"); // re-observe v1
    expect(store.head("/f")?.hash).toBe(t1);
  });

  it("invalidate drops one path, preserves others", () => {
    const store = new InMemorySnapshotStore();
    store.record("/a", "x");
    store.record("/b", "y");
    store.invalidate("/a");
    expect(store.head("/a")).toBeNull();
    expect(store.head("/b")).not.toBeNull();
  });
});
```

> Compute the v1/v2/v3 hashes with the actual `computeFileHash` from `format.ts` (don't hardcode — import and compute). Adjust the `maxTotalBytes` test threshold if `sizeCalculation` semantics differ.

**Step: Run RED**

```bash
cd packages/tools && pnpm vitest run src/lib/hashline-utils/__tests__/snapshots.test.ts
```

Expected: FAIL — `maxPaths`/`maxTotalBytes` options don't exist on our `InMemorySnapshotStoreOptions`.

### Task 2.3: Refactor to LRUCache (GREEN)

**File:** `packages/tools/src/lib/hashline-utils/snapshots.ts`

Port from `openspec/references/oh-my-pi/packages/hashline/src/snapshots.ts:23-230`. Key changes:

- `import { LRUCache } from "lru-cache"` (use the main export, not `/raw` — main is fine for our usage; the reference uses `/raw` for a lower-level API we don't need)
- `#versions: LRUCache<string, Snapshot[]>` with `{ max, maxSize, sizeCalculation }`
- Add `maxPaths` and `maxTotalBytes` to `InMemorySnapshotStoreOptions` (defaults 30 and `64 * 1024 * 1024`)
- `record()` calls `this.#versions.get(path)` (refreshes LRU recency) instead of plain Map get

The full reference impl is at `openspec/references/oh-my-pi/packages/hashline/src/snapshots.ts:138-230` — copy lines 138-230 verbatim, then:

- Change `import { LRUCache } from "lru-cache/raw"` → `import { LRUCache } from "lru-cache"`
- Keep `#private` fields (our codebase already uses them)

**Step: Run GREEN**

```bash
cd packages/tools && pnpm vitest run src/lib/hashline-utils/__tests__/snapshots.test.ts
```

Expected: 6 tests pass.

**Step: Run full suite + typecheck**

```bash
cd packages/tools && pnpm vitest run && pnpm run typecheck
```

**Step: Commit**

```bash
git add packages/tools/src/lib/hashline-utils/ packages/tools/package.json
git commit -m "fix(tools): bound InMemorySnapshotStore with lru-cache (maxPaths, maxTotalBytes)"
```

---

## Phase 3 — No-op loop guard

Prevents infinite loops on byte-identical no-op edits (reference issue #2081: 182 repeats in 205 calls).

### Task 3.1: Port the guard (RED)

**Files:**

- Create: `packages/tools/src/edit/noop-loop-guard.ts`
- Test: `packages/tools/src/edit/__tests__/noop-loop-guard.test.ts`

**Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  NOOP_HARD_LIMIT,
  type NoopLoopGuardOwner,
  recordNoopEdit,
  resetNoopEdit,
} from "../noop-loop-guard";

describe("noop-loop-guard", () => {
  it("does not escalate on the first identical no-op", () => {
    const session: NoopLoopGuardOwner = {};
    const r = recordNoopEdit(session, "/a", "hash1");
    expect(r).toEqual({ count: 1, escalate: false });
  });

  it("escalates once count reaches NOOP_HARD_LIMIT for the same payload+path", () => {
    const session: NoopLoopGuardOwner = {};
    recordNoopEdit(session, "/a", "hash1");
    recordNoopEdit(session, "/a", "hash1");
    const r = recordNoopEdit(session, "/a", "hash1");
    expect(r.escalate).toBe(true);
    expect(r.count).toBe(NOOP_HARD_LIMIT);
  });

  it("resets the counter when the payload changes (progress earns another soft hint)", () => {
    const session: NoopLoopGuardOwner = {};
    recordNoopEdit(session, "/a", "hash1");
    recordNoopEdit(session, "/a", "hash1");
    const r = recordNoopEdit(session, "/a", "hash2"); // different payload
    expect(r).toEqual({ count: 1, escalate: false });
  });

  it("tracks paths independently", () => {
    const session: NoopLoopGuardOwner = {};
    recordNoopEdit(session, "/a", "h");
    recordNoopEdit(session, "/b", "h");
    recordNoopEdit(session, "/a", "h");
    expect(recordNoopEdit(session, "/b", "h").count).toBe(2);
  });

  it("resetNoopEdit clears a path after a successful commit", () => {
    const session: NoopLoopGuardOwner = {};
    recordNoopEdit(session, "/a", "h");
    resetNoopEdit(session, "/a");
    expect(recordNoopEdit(session, "/a", "h").count).toBe(1);
  });
});
```

**Step 2: Run RED** — `cd packages/tools && pnpm vitest run src/edit/__tests__/noop-loop-guard.test.ts` → FAIL (module missing).

### Task 3.2: Implement (GREEN)

Port from `openspec/references/oh-my-pi/packages/coding-agent/src/edit/hashline/noop-loop-guard.ts`. Adaptations:

- `hashPatchInput`: reference uses `Bun.hash(input).toString(16)` (xxHash64). Replace with our existing FNV-1a `computeFileHash` from `lib/hashline-utils/format.ts` (reuse — it's a stable hash of the bytes, which is all we need for "same payload?").
- Keep `NoopLoopGuardOwner` as `{ noopLoopGuard?: NoopLoopGuard }` — but our "session" is the tools-builder's per-agent context, not a `ToolSession`. The owner shape is just a mutable holder; we'll attach it in tools-builder (Task 3.3).

```ts
import { computeFileHash } from "../../lib/hashline-utils/format";

export interface NoopLoopEntry {
  hash: string;
  count: number;
}
export interface NoopLoopGuard {
  entries: Map<string, NoopLoopEntry>;
}
export interface NoopLoopGuardOwner {
  noopLoopGuard?: NoopLoopGuard;
}

export const NOOP_HARD_LIMIT = 3;

export function recordNoopEdit(
  session: NoopLoopGuardOwner,
  canonicalPath: string,
  inputHash: string,
) {
  if (!session.noopLoopGuard) session.noopLoopGuard = { entries: new Map() };
  const prev = session.noopLoopGuard.entries.get(canonicalPath);
  const count = prev && prev.hash === inputHash ? prev.count + 1 : 1;
  session.noopLoopGuard.entries.set(canonicalPath, { hash: inputHash, count });
  return { count, escalate: count >= NOOP_HARD_LIMIT };
}

export function resetNoopEdit(session: NoopLoopGuardOwner, canonicalPath: string) {
  session.noopLoopGuard?.entries.delete(canonicalPath);
}

export function hashPatchInput(input: string): string {
  return computeFileHash(input);
}
```

**Step: Run GREEN** → all 5 pass. Commit:

```bash
git add packages/tools/src/edit/noop-loop-guard.ts packages/tools/src/edit/__tests__/
git commit -m "feat(tools): port noop-loop-guard (3-strike escalation on identical no-ops)"
```

### Task 3.3: Wire the guard into `executeHashlineEdit`

**Files:**

- Modify: `packages/tools/src/edit/index.ts` (`executeHashlineEdit` + `createEditTool` signature)
- Modify: `apps/server/src/agent/tools-builder.ts` (create the owner, inject)

**Step 1: Extend `executeHashlineEdit`** to accept a `noopOwner: NoopLoopGuardOwner` and escalate per-section:

After each section's result, if `s.op === "noop"`:

- compute `inputHash = hashPatchInput(input)`, call `recordNoopEdit(noopOwner, canonicalPath, inputHash)`
- if `escalate`, throw an `Error` with a message like `"Repeated identical no-op edit on ${s.path} (${count}x) — re-read the file before editing again."`
- if a section is NOT a noop, call `resetNoopEdit(noopOwner, canonicalPath)` for that path.

Reference behavior: `openspec/references/oh-my-pi/packages/coding-agent/src/edit/hashline/execute.ts` — soft hint for counts 1–2, hard error at 3. Mirror it: for count < limit, the result text stays `"No change to ${s.path}"` (soft); at limit, throw.

**Step 2: Thread the owner through `createEditTool`** — add `noopOwner?: NoopLoopGuardOwner` to `EditToolOptions`, pass to `executeHashlineEdit`.

**Step 3: In `tools-builder.ts`**, create one owner per agent build and inject:

```ts
const noopOwner: NoopLoopGuardOwner = {};
// ...
createEditTool(cwd, { mode: "hashline", snapshotStore, noopOwner }),
```

**Step 4: Test** — add an integration test in `packages/tools/src/__tests__/tools.test.ts` that drives 3 identical no-op edits through the edit tool and asserts the 3rd throws. (Use the existing real-file fixture pattern in that file.)

**Step 5: Verify** — `cd packages/tools && pnpm vitest run && pnpm run typecheck` && `cd apps/server && pnpm run typecheck`. Commit:

```bash
git commit -am "feat(tools): wire noop-loop-guard into hashline edit (3-strike escalation)"
```

---

## Phase 4 — Block resolution (tree-sitter via `@sakti-code/pi-natives`)

Wire `SWAP.BLK` / `DEL.BLK` / `INS.BLK.POST` end-to-end. The native primitive exists (Phase 1); now the TS layer resolves deferred block edits.

### Task 4.1: Port `block.ts` (language-agnostic resolver) (RED)

**Files:**

- Create: `packages/tools/src/edit/hashline/block.ts`
- Test: `packages/tools/src/edit/hashline/__tests__/block.test.ts`

Port `openspec/references/oh-my-pi/packages/hashline/src/block.ts` (168 lines) **verbatim** — it's pure TS, no Bun/node deps. It imports from `./apply` (STRUCTURAL_CLOSER_RE), `./messages`, `./types`. Confirm those symbols exist in our port; if `STRUCTURAL_CLOSER_RE` isn't exported from our `apply.ts`, export it (the reference exports it).

**Step 1: Test (RED)** — port a focused subset of `openspec/references/oh-my-pi/packages/hashline/test/block.test.ts` (the `resolveBlockEdits` unit tests that don't need the Patcher — ~15 tests covering: hasBlockEdit detection, replace/delete/insert_after expansion, single-line rejection, unresolved throw vs drop, onResolved/onWarning callbacks). Use a stub `BlockResolver` returning fixed spans.

**Step 2: Implement** — copy `block.ts`, fix imports. Run GREEN.

**Step 3: Commit**:

```bash
git commit -am "feat(tools): port hashline block.ts (resolveBlockEdits, language-agnostic)"
```

### Task 4.2: Port `block-resolver.ts` wrapper over `@sakti-code/pi-natives`

**File:** Create `packages/tools/src/edit/hashline/block-resolver.ts`

Port `openspec/references/oh-my-pi/packages/coding-agent/src/edit/hashline/block-resolver.ts`. Adaptations:

- `import { blockRangeAt } from "@sakti-code/pi-natives"` (not `@oh-my-pi/pi-natives`)
- Memo key: reference uses `Bun.hash(text).toString(36)`. Replace with `computeFileHash(text)` from `lib/hashline-utils/format.ts`.
- Keep the FIFO-bounded `resolutionCache` (Map, cap 512, delete oldest on overflow).

```ts
import { blockRangeAt } from "@sakti-code/pi-natives";
import { computeFileHash } from "../../lib/hashline-utils/format";
import type { BlockResolver } from "./types";

const resolutionCache = new Map<string, { start: number; end: number } | null>();
const RESOLUTION_CACHE_MAX = 512;

export const nativeBlockResolver: BlockResolver = ({ path, text, line }) => {
  const key = `${computeFileHash(text)}:${text.length}:${line}:${path}`;
  const cached = resolutionCache.get(key);
  if (cached !== undefined) return cached;
  const range = blockRangeAt({ code: text, path, line });
  const result = range ? { start: range.startLine, end: range.endLine } : null;
  if (resolutionCache.size >= RESOLUTION_CACHE_MAX) {
    const oldest = resolutionCache.keys().next().value;
    if (oldest !== undefined) resolutionCache.delete(oldest);
  }
  resolutionCache.set(key, result);
  return result;
};
```

> Verify `BlockResolver` type is defined in our `types.ts`; if not, port it from the reference `types.ts` (`type BlockResolver = (input: { path: string; text: string; line: number }) => { start: number; end: number } | null`).

**Test:** unit test with a real TS snippet asserting `nativeBlockResolver({ path: "f.ts", text: "function f() {\n  return 1\n}\n", line: 1 })` → `{ start: 1, end: 3 }`. Commit.

### Task 4.3: Wire the resolver into the Patcher + input.ts

**Files:**

- Modify: `packages/tools/src/edit/hashline/patcher.ts`
- Modify: `packages/tools/src/edit/hashline/input.ts`
- Modify: `packages/tools/src/edit/index.ts` (`executeHashLineEdit` constructs `Patcher({ fs, snapshots, blockResolver: nativeBlockResolver })`)

**Step 1: `PatcherOptions`** — add `blockResolver?: BlockResolver`. In `patcher.ts`'s `#applyWithRecovery`, before recovery: if `hasBlockEdit(edits)`, call `resolveBlockEdits(edits, text, path, this.options.blockResolver, { onResolved, onWarning })` and feed the resolved edits onward. Reference: `openspec/references/oh-my-pi/packages/hashline/src/patcher.ts` (the `#applyWithRecovery` block phase).

**Step 2: `input.ts`** — `PatchSection.applyTo`/`applyPartialTo` currently take `_blockResolver?` and ignore it. Wire `resolveBlockEdits` in (reference: `input.ts` `applyTo`). Populate `PatchSectionResult.blockResolutions` from `onResolved`.

**Step 3: `executeHashLineEdit`** — pass `blockResolver: nativeBlockResolver` to `new Patcher({ ... })`.

**Step 4: Integration test (RED→GREEN)** — in `packages/tools/src/__tests__/tools.test.ts`, add tests:

- `SWAP.BLK 1:` rewrites a whole function block (write a fixture file with a 4-line function, read it, edit `SWAP.BLK 1:` with a 2-line body, assert the function was replaced lines 1-4).
- `DEL.BLK 1` deletes the block.
- `INS.BLK.POST 1:` inserts after the block's closing line.
- `SWAP.BLK` on a single-line statement is rejected with `blockSingleLineMessage`.

**Step 5: Verify** — `cd packages/tools && pnpm vitest run && pnpm run typecheck`. Commit:

```bash
git commit -am "feat(tools): wire block resolution (SWAP.BLK/DEL.BLK/INS.BLK.POST) via nativeBlockResolver"
```

### Task 4.4: Teach block ops in the edit-tool description + system prompt

**Files:**

- Modify: `packages/tools/src/edit/index.ts` `HASHLINE_DESCRIPTION` — append block op docs.
- Modify: the agent system prompt that documents edit ops (search `packages/agent/src/` for where hashline ops are taught).

Port the block-op section from `openspec/references/oh-my-pi/packages/hashline/src/prompt.md` (lines 9-39): the `SWAP.BLK N:` / `DEL.BLK N` / `INS.BLK.POST N:` semantics, the "anchor the opening line", "single-statement rejected", markdown-heading-as-block rules.

**Verify:** no test (prompt text), but `pnpm run typecheck`. Commit:

```bash
git commit -am "feat(tools): document SWAP.BLK/DEL.BLK/INS.BLK.POST in edit description + prompt"
```

---

## Phase 5 — Test backfill (close 79 → ~180)

The features mostly exist; the tests don't. Port the reference test files defending contracts we already ship.

### Task 5.1: Delimiter-balance repair tests

**File:** `packages/tools/src/edit/hashline/__tests__/boundary-repair.test.ts` (new)

Port from `openspec/references/oh-my-pi/packages/hashline/test/boundary-repair.test.ts` (~35 tests). Our `apply.ts` HAS the balance-repair functions (verified: `computeDelimiterBalance`, `netDeletedPrefixBalance`, etc. at `apply.ts:287-935`) — these tests should pass against our code as-is. Focus on: duplicated `});`/`</>` dropping, missing-closer sparing, cross-hunk residual spending, the "Root.tsx incident" multi-line closer.

**Step:** port the tests, run, fix any failures (likely a small number of edge cases where our port diverged). Commit.

### Task 5.2: Leniency parsing tests

**File:** `packages/tools/src/edit/hashline/__tests__/leniency.test.ts` (new)

Port from `openspec/references/oh-my-pi/packages/hashline/test/leniency.test.ts` (~32 tests): malformed-tag rejection, `*** Update File:` recovery, apply_patch contamination rejection, alternate range separators, auto-pipe bare rows, `N:` prefix stripping, abort sentinel. Commit.

### Task 5.3: Seen-line provenance + tag-path recovery (Patcher)

**File:** extend `packages/tools/src/edit/hashline/__tests__/hashline.test.ts` or new `patcher.test.ts`

Port from `openspec/references/oh-my-pi/packages/hashline/test/patcher.test.ts`:

- Seen-line provenance (4 tests): Patcher rejects edits on lines the read never displayed. **Requires** the read tool to record `seenLines` — verify `packages/tools/src/read/index.ts` calls `snapshotStore.record(path, text, seenLines)` with the displayed line set; if not, add it (small change).
- Tag-based path recovery (7 tests): basename → full-path rebind via `findByHash`. Our `SnapshotStore` and `Patcher` already have `findByHash` — verify the patcher's path-recovery path uses it (reference: `patcher.ts` `allowTagPathRecovery` + `findByHash`).
- `HEADTAIL_DRIFT_WARNING` on stale head/tail tag.
- MismatchError message contracts ("file changed between read and edit", "not from this session", "never invent the tag").

Commit each subset separately.

### Task 5.4: Recovery session-chain replay

**File:** extend `packages/tools/src/edit/hashline/__tests__/hashline.test.ts`

Port from `openspec/references/oh-my-pi/packages/hashline/test/recovery-session-chain.test.ts` (2 tests): refuse 3-way merge when the anchor diverged; replay + warn when unchanged. Requires the `RECOVERY_SESSION_REPLAY_WARNING` constant — check our `recovery.ts`/`messages.ts`; if missing, port it. Commit.

---

## Phase 6 — Diff preview + cleanup

### Task 6.1: Port `diff-preview.ts` + populate `details`

**Files:**

- Create: `packages/tools/src/edit/hashline/diff-preview.ts`
- Modify: `packages/tools/src/edit/index.ts` (`executeHashlineEdit` result + `EditToolDetails`)

Port `openspec/references/oh-my-pi/packages/hashline/src/diff-preview.ts` (124 lines, `buildCompactDiffPreview`). It has no Bun deps — pure TS over the `diff` package (already a dep).

In `executeHashlineEdit`, change the result to populate `details.diff` (the compact preview) and `details.firstChangedLine` per section, and append the preview to the result text (reference: `execute.ts` render path). Update `EditToolDetails` type to include `diff?: string`.

**Test:** snapshot test that editing a file produces a compact diff preview in the result. Commit.

### Task 6.2: Missing API surface + dead-code cleanup

**Files:**

- Modify: `packages/tools/src/edit/hashline/mismatch.ts` — add `displayMessage` getter + static `formatDisplayMessage` (reference: `mismatch.ts`).
- Modify: `packages/tools/src/lib/hashline-utils/format.ts` — export `HL_LINE_BODY_SEP_RE_RAW` (reference: `format.ts`).
- Modify: `packages/tools/src/edit/hashline/recovery.ts` — remove the unused top-level `recoverWithThreeWayMerge` export IF no caller uses it (grep first: `rg "recoverWithThreeWayMerge"`; if only its own test references it, drop the test too).

**Test:** add a test asserting `err.displayMessage` and `MismatchError.formatDisplayMessage(...)` return the formatted message. Commit.

---

## Final verification

```bash
pnpm run fix
pnpm run typecheck
pnpm --filter @sakti-code/tools test
pnpm --filter @sakti-code/pi-natives test
pnpm --filter @sakti-code/agent test
pnpm --filter @sakti-code/server test
```

All green. Then a manual smoke: `cd apps/desktop && pnpm run dev`, run a hashline edit with `SWAP.BLK` on a real file, confirm the block resolves and the diff preview renders.

## Out of scope (explicitly deferred)

- **LSP** (diagnostics, go-to-def, hover) — separate TS-level effort spawning language servers; the crate is tree-sitter (AST), not LSP. Future plan.
- **Streaming diff preview** (`onUpdate` while args stream) — reference `diff.ts` `streaming: true`; needs renderer wiring. Future.
- **Plan-mode write guard, auto-generated-file guard, notebook awareness, ACP bridge** — environment-specific (Electron+Hono, not their TUI/LSP/ACP stack).
- **pi-ast `ops` (astMatch/rewrite_source) + `summary` (file compaction)** — expose in a later plan once block resolution is proven; the crate foundation supports it.
