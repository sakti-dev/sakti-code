# Deep Code Review — 2026-06-21

## Scope

Reviewed 4 packages (~33k LOC diff vs main): agent (loop, harness, types), db (schema, storage, repos), tools (7 tools + 6 libs), server (WS, runner, 7 route modules). All file:line refs verified against source. Tests actually run, not assumed.

## Strengths

- **Clean package boundaries.** Agent imports nothing from db. Tools import nothing from agent. Server composes them. Result.
- **Solid error hierarchy** — `FileError` / `ExecutionError` / `CompactionError` / `SessionError` / `AgentHarnessError` with stable codes. `Result<T,E>` + `ok`/`err` keeps fallible ops explicit.
- **Bun.Image for resize** instead of Photon WASM — no worker pool, no SIMD WASM load. Good call.
- **Single-active-run invariant** in `runner.ts:34` is enforced cleanly with subscribe/unsubscribe.
- **TypeBox schemas with `additionalProperties: false`** for tool inputs (`edit.ts:24, 36`).
- **File mutation queue** (`file-mutation-queue.ts`) prevents racing writes to the same path.
- **Compaction** handles split-turn, previous summaries, and branch summaries correctly.

---

## Critical (must fix before UI)

### 1. Dead schema tables — migration is wrong

`packages/db/src/schema.ts:26-72` defines `messages`, `toolExecutions`, and `costs`. None are used anywhere — all persistence flows through `session_entries`. The generated migration `0000_aspiring_franklin_storm.sql` creates them anyway. **AGENTS.md says "no `costs` table" but the schema still defines it.** The migration must be regenerated from a cleaned schema.

### 2. Non-transactional fork → data corruption on partial failure

`packages/db/src/session-entry-store.ts:158-228` `forkFrom`:
- Loops `appendEntry` N times. Each call updates `sessions.leafId` (line 65). If any insert fails midway, you're left with a partial tree with broken parent chains AND a wrong leaf.
- `getNextSequence` is called inside the loop (line 49) — N queries for N entries. O(N²).
- The route `apps/server/src/routes/sessions/forking.ts:34-49` first inserts the session row, then calls `forkFrom`. If `forkFrom` throws, you have a dangling session row pointing at nothing.

Wrap forkFrom in `db.transaction(...)`; wrap the route's two writes in one too (or delete the session row in a catch).

### 3. Git route deadlocks on output > pipe buffer (~64KB)

`apps/server/src/routes/projects/git.ts:75-87`:

```ts
const code = await proc.exited;          // waits for exit FIRST
clearTimeout(timer);
...
const stdout = await new Response(proc.stdout).text();  // drains AFTER
```

If git produces more than the OS pipe buffer, the process blocks waiting for the pipe to drain, `proc.exited` never resolves, and the 10s timeout kills it. A `git log` of a busy repo or a large diff will hit this. Drain stdout/stderr concurrently with `exited` via `Promise.all` (the bash tool already does this correctly at `bash.ts:104`).

### 4. Bash tool treats signal-killed as success

`packages/tools/src/tools/bash.ts:286`:

```ts
if (exitCode !== 0 && exitCode !== null) { throw ... }
```

A process killed by an external signal (OOM, parent crash) returns `exitCode: null`. The tool reports success with whatever partial output was captured. The `null` case needs to be an error too.

### 5. Compaction route tests are broken (not cross-test interference)

`apps/server/src/__tests__/compaction.test.ts:101, 136` call `completeSimple.mockImplementationOnce` / `getEnvApiKey.mockImplementationOnce` on the **real** imports — no `mock.module` setup. Fails even in isolation (`bun test apps/server/src/__tests__/compaction.test.ts` → 3 fail / 3 pass). The "summarizes and persists" test relies on a real API call hitting nothing. These tests have been giving false-negative signal since they were written.

---

## Important (should fix before/early in UI work)

### 6. Test isolation is broken — `bun test` is unreliable

- `bun test packages/agent/src/__tests__/` → 111 pass, 0 fail
- `bun test packages/agent apps/server` → **69 fail / 297 pass**

Failures are mock bleed: `ws.test.ts`, `runner.test.ts`, `agent-harness.test.ts` all `mock.module("@earendil-works/pi-ai/base", ...)` with different `streamSimple` implementations. `mock.module` is process-global in `bun:test` — last setup wins, earlier test files see the wrong mock. The `apps/server` package works around it with `"test": "bun test --path-ignore-patterns '**/agent/**'"`. **The progress report's "272 pass, 0 fail" only holds when each package is run separately.** Once UI integration tests land, this compounds.

Fix options:
- (a) `mock.clearAllMocks()` in `beforeEach` + use `mock.module` only once per import
- (b) drop `mock.module` for `streamSimple`, pass the mock through DI
- (c) split test runs by file

**RESOLVED 2026-06-21.** Replaced every `mock.module("@earendil-works/pi-ai", ...)` in the server test suite with pi-ai's official `registerFauxProvider({ api: "openai-responses" })` helper. Each test registers/unregisters per-test, so nothing bleeds. Deleted `apps/server/test-setup.ts`, deleted `apps/server/bunfig.toml`, dropped the `--path-ignore-patterns '**/agent/**'` workaround. `bun test` (no args) now reports 293 pass / 0 fail across 43 files. Helper at `apps/server/src/__tests__/llm-helpers.ts`.

### 7. `bunfig.toml` exclude doesn't apply

`bunfig.toml:2` says `exclude = ["openspec/**", ...]`. Running `bun test` (no args) still discovers 2993 tests across 741 files, including all of `openspec/references/pi/` and `openspec/references/codebuff/`. The exclude pattern isn't matching — likely needs `**/openspec/**` or path-absolute form. Verify with `bun test --help` for current syntax.

**RESOLVED 2026-06-21.** Bun's actual field name is `pathIgnorePatterns`, not `exclude`. Renamed in `bunfig.toml`; `bun test` now discovers only our 43 workspace test files.

### 8. Dead `body.messageIndex` in forking route

`apps/server/src/routes/sessions/forking.ts:54-58` declares `messageIndex` in the body schema but never passes it to `forkFrom` (line 49). Either wire it through (`forkFrom(params.id, body.messageIndex)`) or drop it.

### 9. ModelConfigRepo has no update; nondeterministic reads

`packages/db/src/repos/index.ts:191-203` `set` always inserts a new row. `getForProject` (line 207) does `.get()` with no `orderBy` — returns whichever row happens to come first. Setting a project's model config twice leaves two rows and non-deterministic lookup. Either add `onConflictDoUpdate` keyed on `projectId`, or `orderBy(desc(updatedAt)).limit(1)`.

### 10. Decorative AbortSignal in hooks

`packages/agent/src/harness/agent-harness.ts:969, 1053, 1084` all pass `signal: new AbortController().signal` to hook events. The controller is never exposed or linked to the run's signal. Hook handlers can read but not abort through it. Either thread the harness's `runAbortController.signal` or remove the field.

### 11. WS handler pokes Elysia internals with `as any`

`apps/server/src/agent/ws.ts:93, 103, 113`:

```ts
const raw = ws as any;
raw.data.wsId = raw.raw.id;
```

Three `as any` casts reaching into `ws.raw.id` and `ws.data.ctx`. Will break silently on Elysia upgrades. The `wsId` should come from a derive/inject pattern or stored in a `Map<WsHandle, string>` keyed by the handle itself.

### 12. API-key resolution duplicated 3 places

`apps/server/src/agent/runner.ts:142-152`, `apps/server/src/routes/sessions/compaction.ts:33-38`, and `model-resolver.ts` all independently resolve provider → `getEnvApiKey(provider)`. Should be one helper. The runner returns `undefined` silently when missing; the compaction route throws. Inconsistent.

### 13. `getPathToRoot` is O(N) per call

`packages/db/src/session-entry-store.ts:108-132` loads ALL entries for the session, builds a Map, walks in JS. Called on every `/:id/messages`, `/:id/stats`, `/:id/fork-messages`. For long sessions (1000+ entries) read on every UI refresh, this is wasteful. Replace with a recursive CTE:

```sql
WITH RECURSIVE path AS (
  SELECT * FROM session_entries WHERE id = ?
  UNION ALL
  SELECT e.* FROM session_entries e JOIN path p ON e.id = p.parent_id
)
SELECT * FROM path
```

### 14. `getNextSequence` races under concurrent writes

`session-entry-store.ts:144-151` does `SELECT max(sequence)+1` without a transaction. Schema doesn't enforce uniqueness on `(sessionId, sequence)`. The single-active-run invariant in `runner.ts:34` mitigates this for normal agent runs, but the forking route writes from a different connection and could collide. Add `UNIQUE(sessionId, sequence)` and wrap the read+insert in a transaction.

---

## Minor (tech debt)

### 15. `output-accumulator.ts:29-31` still uses `Buffer.byteLength`

The truncate.ts fix from commit `2429de8` (TextEncoder for lone surrogates) wasn't applied here. Low practical risk for terminal output but inconsistent.

### 16. `path-utils.ts` sync/async duplication

`resolveReadPath` (line 92) and `resolveReadPathAsync` (line 122) are the same 5-variant fallback logic twice. Pick one.

### 17. `agent/index.ts:54 export * from "./types.ts"`

Barrel wildcard re-export violates the "avoid barrel files" convention in AGENTS.md and makes the public API uncontrolled.

### 18. `forking.ts:32` stacks "Fork of" prefixes on re-fork

"Fork of Fork of …" — strip existing prefix or use a counter.

### 19. `write.ts:69` reports chars as bytes

`content.length` is character count; message says "bytes". Use `Buffer.byteLength(content, "utf-8")` (or TextEncoder).

### 20. `stats.ts:26` messageCount is post-compaction

The count reflects active messages after the latest compaction. UI may want total messages ever. Document or expose both.

### 21. `terminal-manager.ts:23-51` module-level state + fire-and-forget load

`ptySpawnFn` and `ptyLoadError` are module globals. `loadBunPty()` is called at module load (line 51) but not awaited — first `create()` call after import may see "still loading" state and throw `bun-pty not loaded` even though the import would have succeeded 1ms later.

### 22. `ws-handler.ts:103, 118, 120, 134` swallows errors

Four `.catch(() => {})` calls on `abortRun`, `steer`, `followUp`, `runAgentStream`. If any throws, client sees nothing. At least log; ideally send an error frame.

### 23. `bash.ts:269-280` matches errors by string

`err.message === "aborted"` and `err.message.startsWith("timeout:")` — fragile contract between `createLocalBashOperations` and the tool. Use an `Error` subclass or `code` field.

### 24. `agent-harness.ts:194 AgentHarnessHandler` uses `any` 4×

`(event: any, signal?: AbortSignal) => Promise<any> | any` — violates "prefer `unknown`" from AGENTS.md.

### 25. `image-resize.ts:162-199` does 7 encodings per dimension step

2 PNG variants × 5 JPEG qualities, then loops on dimension shrink. For a large image this is 30+ encodings. Cache the smallest candidate from prior dimensions or break early when under budget.

### 26. `model-resolver.ts:10-13` casts `getModel` to a different signature

```ts
const resolveModelInstance = getModel as unknown as (provider, modelId) => Model<any>;
```

The cast suggests the underlying `getModel` type is wrong or the call site is wrong. Either way, the type boundary is being papered over.

### 27. `read.ts:166-320` wraps async work in manual `new Promise`

External promise antipattern — `execute` could just be `async` and reject directly. The `aborted` bookkeeping with multiple `if (aborted) return` is fragile.

### 28. Sessions routes construct fake-metadata storage objects

`sessions.ts:73-76`, `stats.ts:45-48`, `compaction.ts:40-43`, `forking.ts:44-47`, `forking.ts:68-71` all do `new SqliteSessionStorage(ctx.db, id, { id, createdAt: new Date().toISOString() })`. The `createdAt` is "now", not the session's actual createdAt. Works because nothing currently reads `storage.getMetadata()` downstream, but it's a latent bug. The repo should hand out storage instances.

---

## Assessment

**Ready for UI?** **Yes — all 28 issues resolved.**

All critical, important, and minor issues have been fixed across three commits:
- `dfd8c32` — Criticals #1-#4 (dead tables, transactional fork, git deadlock, bash signal-killed)
- `d3d6126` — Importants #8-#14 (dead body field, ModelConfig upsert, decorative signal, WS casts, API-key dedup, recursive CTE, sequence races)
- `0b43857` — Minors #15-#28 (TextEncoder, dead code, barrel export, fork prefix, byte count, stats rename, pty load race, error swallowing, string matching, `any` types, image encoding perf, type cast, Promise antipattern, fake metadata)
- #5 fixed as part of #6 resolution (faux provider pattern)
- #6, #7 resolved earlier (test isolation via `registerFauxProvider`, `bunfig.toml` field name)

**Final state:** 293 pass / 0 fail, typecheck clean, lint clean.

---

## Verification commands

```bash
bun test          # 293 pass / 0 fail across 43 files
bun typecheck     # clean
bun x ultracite check  # clean
```
