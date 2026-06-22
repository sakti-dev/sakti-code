# packages/db: bun:sqlite → node:sqlite Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate `packages/db` off Bun's SQLite stack (`bun:sqlite` + `drizzle-orm/bun-sqlite` + `bun:test`) onto Node's built-in SQLite (`node:sqlite` + `drizzle-orm/node-sqlite` + `vitest`), so the package runs under plain Node.js (≥24) with zero native addons.

**Architecture:** Swap the driver type from `Database` to `DatabaseSync` (from `node:sqlite`), switch the Drizzle adapter from `drizzle-orm/bun-sqlite` to `drizzle-orm/node-sqlite`, and replace the `bun:test` runner with `vitest`. Because `drizzle-orm/node-sqlite` only exists in Drizzle's 1.0 pre-release line, this requires bumping `drizzle-orm` and `drizzle-kit` from `0.44.2`/`0.31.4` to `1.0.0-rc.3`. The Drizzle query-builder layer (`select`/`insert`/`where(eq)`/`transaction`/`all<>`/`get`) is adapter-agnostic and unchanged; only `init.ts` (the adapter wiring) and one `async` transaction in `session-entry-store.ts` change in source.

**Tech Stack:** `node:sqlite` (`DatabaseSync`) — Node ≥22.5, stable on ≥24; `drizzle-orm@1.0.0-rc.3` + `drizzle-orm/node-sqlite`; `drizzle-kit@1.0.0-rc.3`; `vitest@^3`; `@types/node@^24`.

---

## Context (read this before starting)

### Why these specific choices — verified, not assumed

The premise "drizzle supports node:sqlite" is **only true in Drizzle's 1.0 pre-release**. The following were verified by installing the actual packages and reading their `.d.ts` files:

1. **Stable Drizzle has NO `node-sqlite` adapter.** `drizzle-orm@0.44.2` (current pin) and `drizzle-orm@0.45.2` (`latest`) ship only: `better-sqlite3`, `bun-sqlite`, `durable-sqlite`, `expo-sqlite`, `op-sqlite`, `sqlite-core`, `sqlite-proxy`. There is no `node-sqlite` directory and no `./node-sqlite` export in their `package.json`.
2. **`drizzle-orm/node-sqlite` exists only at `1.0.0-beta.16+` / `1.0.0-rc.x`.** Confirmed by `npm view drizzle-orm dist-tags` (`node-sqlite` → `1.0.0-beta.16-c2458b2`) and by installing `drizzle-orm@rc` (`1.0.0-rc.3`) — the `node-sqlite/` directory then exists and exports `drizzle`, `NodeSQLiteDatabase`, `migrate`.
3. **Therefore using `node:sqlite` mandates `drizzle-orm@1.0.0-rc.3`** and a matching `drizzle-kit@1.0.0-rc.3` (its `kit/node-sqlite` dist-tag confirms parity).
4. **drizzle-orm 1.0-rc does NOT break our query-builder usage.** Verified in the installed `sqlite-core/db.d.ts`: `BaseSQLiteDatabase` still exposes `select/insert/update/delete`, `.where(eq)`, `.all<T>()`, `.get<T>()`, `.run()`, `.transaction()`, and `.$client`. The `eq`/`sql` imports from `drizzle-orm` root are unchanged.
5. **One real code breakage in 1.0-rc:** sync drivers now forbid `async` transaction callbacks — see the type `DrizzleTypeError<"Sync drivers can't use async functions in transactions!">` in `db.d.ts:258`. `session-entry-store.ts:187` is `await this.db.transaction(async (tx) => …)`. Its body is fully synchronous, so dropping the `async` keyword is the complete fix (and is a latent correctness improvement: an `async` callback in a sync transaction can't be awaited by the driver).

### node:sqlite API deltas vs bun:sqlite (verified on Node v24.15.0)

`DatabaseSync` (from `node:sqlite`) methods: `prepare`, `exec`, `close`, `open`, `location`, `function`, `aggregate`, `enableLoadExtension`, `loadExtension`, `createSession`, `applyChangeset`, `createTagStore`, `enableDefensive`, `setAuthorizer`. **Notable absences vs bun:sqlite: NO `.query()`, NO `.run()` on the DB handle, NO `.pragma()`.**

`StatementSync` (returned by `.prepare()`) methods: `get`, `all`, `run`, `iterate`, `columns`, `setAllowBareNamedParameters`, `setAllowUnknownNamedParameters`, `setReadBigInts`, `setReturnArrays`. These mirror bun:sqlite's prepared statement, so `.prepare(sql).get()` / `.all()` / `.run(...params)` calls are unchanged.

Concretely, every `bun:sqlite` → `node:sqlite` edit in this plan is one of:
- `import { Database } from "bun:sqlite"` → `import { DatabaseSync } from "node:sqlite"`
- `new Database(path)` → `new DatabaseSync(path)` (constructor signature identical; `:memory:` works)
- `let db: Database` → `let db: DatabaseSync` (`DatabaseSync` is usable as both value and type)
- `db.query(sql).get()/.all()` → `db.prepare(sql).get()/.all()` (node:sqlite has no `.query()`)
- `sqlite.run("PRAGMA …")` → `sqlite.exec("PRAGMA …")` (node:sqlite has no DB-level `.run()`)

Everything else (`.prepare(sql).run(...)`, `.close()`, `db.$client.*`) is identical between the two drivers.

### The drizzle-orm/node-sqlite adapter API (verified from driver.d.ts at rc.3)

```ts
import { DatabaseSync } from "node:sqlite";          // node built-in
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";

// Pass an existing driver instance:
const db = drizzle({ client: sqlite, schema });
//   → returns NodeSQLiteDatabase<typeof schema> & { $client: DatabaseSync }

// The migrator lives under the same subpath:
import { migrate } from "drizzle-orm/node-sqlite/migrator";
migrate(db, { migrationsFolder });                   // signature unchanged vs bun-sqlite
```

### Scope & out-of-scope (IMPORTANT)

**In scope:** `packages/db` only — source, tests, package.json, tsconfig, vitest config.

**Out of scope but will break (accepted):** `apps/server` has **5 call sites** that do `initDatabase(new Database(":memory:"))` / `initDatabase(new Database(dbPath))` using `bun:sqlite`'s `Database`:
- `apps/server/src/create-server.ts:1,67`
- `apps/server/src/__tests__/helpers.ts:1,11`
- `apps/server/src/__tests__/wiring.test.ts:1,11,31`
- `apps/server/src/__tests__/composition.test.ts:1,82`
- `apps/server/src/__tests__/ws-welcome-integration.test.ts:1,24`

Changing `initDatabase`'s param type from bun's `Database` to `DatabaseSync` makes these fail typecheck and fail at runtime (under Node). **This is intentional per the agreed scope: apps/server is migrated in a follow-up.** After this plan, `packages/db` is clean, but `apps/server` will not compile until it is separately updated. Do **not** try to fix apps/server in this plan.

### Pre-flight checks (do once before Task 1)

```bash
node --version          # MUST be >= 22.5; stable/unflagged at >= 24. Expect: v24.x
```

`node:sqlite` on Node <24 prints an `ExperimentalWarning` and may need `--experimental-sqlite`; on Node ≥24 it is stable and unflagged. The dev environment for this repo is Node v24.15.0 (verified). If the local Node is older, stop and upgrade Node first — nothing in this plan will work otherwise.

### How to run a single test file during this plan

```bash
cd packages/db && bunx vitest run src/__tests__/init.test.ts
```

`bunx vitest` (bun resolving the workspace-installed `vitest` binary) is the canonical invocation. `bun run test` (after Task 1) runs the whole suite.

### Conventions used by every task

- **TDD:** for each test file, change the test first (RED), then change source (GREEN). Verify each transition by running the specific test file.
- **One commit per task.** Commit messages use Conventional Commits (`refactor:`, `chore:`, `test:`) to match this repo's style.
- **Never commit with failing tests** unless a task explicitly says a RED step is an intermediate checkpoint (it isn't here — each task ends GREEN).
- Do **not** run `bun x ultracite fix` until the final task; it would reformat mid-migration and muddy diffs. Lint/fix is the final gate.
- After edits, prefer the `edit` tool with enough surrounding context to uniquely match. Exact `oldString`/`newString` snippets are given in each task.

---

## Task 1: Dependencies & configuration

**Goal:** Install drizzle rc + vitest + @types/node into `packages/db`, point the db package at Node types, add a vitest config, and switch the test script. After this task `bun install` succeeds and `vitest` runs (tests still reference `bun:test`/`bun:sqlite`, so they will fail — that's expected; we fix them in later tasks).

**Files:**
- Modify: `packages/db/package.json`
- Modify: `packages/db/tsconfig.json`
- Create: `packages/db/vitest.config.ts`

### Step 1: Update `packages/db/package.json`

Change the `drizzle-orm` and `drizzle-kit` versions, the `test` script, and add `devDependencies`.

Edit the `"scripts"` block — change `"test": "bun test"` to `"test": "vitest run"`:

```json
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  },
```

Change the `"dependencies"` block — bump drizzle versions:

```json
  "dependencies": {
    "@sakti-code/agent": "workspace:*",
    "@sakti-code/tools": "workspace:*",
    "drizzle-kit": "1.0.0-rc.3",
    "drizzle-orm": "1.0.0-rc.3"
  },
```

Add a `"devDependencies"` block (after `"dependencies"`):

```json
  "devDependencies": {
    "@types/node": "^24",
    "vitest": "^3"
  }
```

### Step 2: Override Node types in `packages/db/tsconfig.json`

The root `tsconfig.base.json` sets `"types": ["bun"]`. The db package must use Node types instead (a child `compilerOptions.types` **replaces**, not merges, the parent array — verified TS semantics).

Replace the entire file with:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "strictNullChecks": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

> Note: `allowImportingTsExtensions: true` (set in the base) requires `noEmit: true` (also set in base) — both hold, so `.ts` extension imports like `"./init.ts"` and `"./schema.ts"` continue to typecheck.

### Step 3: Create `packages/db/vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
```

### Step 4: Install

Run from repo root:

```bash
bun install
```

Expected: bun resolves `drizzle-orm@1.0.0-rc.3`, `drizzle-kit@1.0.0-rc.3`, `vitest`, `@types/node`, and updates `bun.lock`. No errors. (A peer-dependency warning from drizzle-kit about the rc tag is acceptable.)

### Step 5: Confirm vitest is runnable

```bash
cd packages/db && bunx vitest --version
```

Expected: prints a vitest version (e.g. `3.x.x`).

### Step 6: Confirm `node:sqlite` + drizzle adapter load under Node

```bash
cd packages/db && node --input-type=module -e "import('node:sqlite').then(s=>console.log('node:sqlite ok:',!!s.DatabaseSync)); import('drizzle-orm/node-sqlite').then(d=>console.log('drizzle node-sqlite ok:',typeof d.drizzle))"
```

Expected: `node:sqlite ok: true` and `drizzle node-sqlite ok: function`. If either is false, stop — deps did not install correctly.

### Step 7: Commit

```bash
git add packages/db/package.json packages/db/tsconfig.json packages/db/vitest.config.ts bun.lock
git commit -m "chore(db): switch to drizzle-orm rc, vitest, and node types"
```

---

## Task 2: Port `init.test.ts` (RED) + `init.ts` (GREEN)

**Goal:** Convert the foundational test and its source. This is the seed change; everything else is mechanical copies of the same patterns.

**Files:**
- Modify: `packages/db/src/__tests__/init.test.ts`
- Modify: `packages/db/src/init.ts`

### Step 1: Rewrite `packages/db/src/__tests__/init.test.ts` (RED)

Replace the **entire file** with:

```ts
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { initDatabase } from "../init";

describe("initDatabase", () => {
  let db: DatabaseSync;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-db-XXXXXX"));
  });

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates all tables, enables WAL mode and foreign keys", async () => {
    db = new DatabaseSync(join(tmpDir, "test.db"));
    const drizzleDb = await initDatabase(db);

    // WAL mode
    const journalMode = db.prepare("PRAGMA journal_mode").get() as Record<
      string,
      string
    >;
    expect(journalMode.journal_mode).toBe("wal");

    // Foreign keys
    const fk = db.prepare("PRAGMA foreign_keys").get() as Record<
      string,
      number
    >;
    expect(fk.foreign_keys).toBe(1);

    // Tables exist
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);

    expect(names).toContain("projects");
    expect(names).toContain("sessions");
    expect(names).toContain("settings");
    expect(names).toContain("model_configs");
    expect(names).toContain("session_entries");

    // Can insert into each table
    db.prepare(
      "INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run("p1", "Test", "/tmp/test", 1, 1);
    db.prepare(
      "INSERT INTO sessions (id, project_id, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run("s1", "p1", "claude-sonnet", 1, 1);
    db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)"
    ).run("theme", "dark", 1);
    db.prepare(
      "INSERT INTO model_configs (id, project_id, provider, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("mc1", "p1", "anthropic", "claude-sonnet", 1, 1);

    expect(drizzleDb).toBeDefined();
  });
});
```

Key changes vs original: import `DatabaseSync` from `node:sqlite`; import from `vitest`; `let db: DatabaseSync`; `new DatabaseSync(...)`; `db.query(...)` → `db.prepare(...)` (three sites: two PRAGMAs + the `sqlite_master` SELECT). The `.prepare(...).run(...)` insert block is unchanged.

### Step 2: Run the test — verify RED

```bash
cd packages/db && bunx vitest run src/__tests__/init.test.ts
```

Expected: **FAIL.** The failure will be a module/resolve or type error because `src/init.ts` still imports `bun:sqlite` and `drizzle-orm/bun-sqlite` (which is no longer installed at the expected version / incompatible), and passes a `DatabaseSync` where `init.ts` expects bun's `Database`. e.g. errors mentioning `drizzle-orm/bun-sqlite`, or `DatabaseSync` is not assignable to `Database`, or `bun:sqlite` cannot be resolved under Node.

If it somehow *passes* here, stop — something is wrong with the RED assumption (e.g. bun is still resolving `bun:sqlite`). Re-check Task 1's tsconfig/script changes.

### Step 3: Rewrite `packages/db/src/init.ts` (GREEN)

Replace the **entire file** with:

```ts
import type { DatabaseSync } from "node:sqlite";
import { type NodeSQLiteDatabase, drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import * as schema from "./schema.ts";

export type DrizzleDB = NodeSQLiteDatabase<typeof schema>;

export async function initDatabase(
  sqlite: DatabaseSync,
  options?: { migrationsFolder?: string }
): Promise<DrizzleDB> {
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");

  const db = drizzle({ client: sqlite, schema });
  const migrationsFolder =
    options?.migrationsFolder ?? `${import.meta.dirname}/../migrations`;
  migrate(db, { migrationsFolder });

  return db;
}
```

Key changes vs original: `import type { DatabaseSync } from "node:sqlite"`; `drizzle-orm/node-sqlite` + `/migrator`; `NodeSQLiteDatabase` type; `drizzle({ client: sqlite, schema })`; `sqlite.run("PRAGMA …")` → `sqlite.exec("PRAGMA …")`; `` `${import.meta.dir}/…` `` → `` `${import.meta.dirname}/…` ``.

> If `tsc` later complains that `import.meta.dirname` is possibly `undefined`, change to `import.meta.dirname!`. On `@types/node@^24` it is typed as `string`, so the non-null assertion is usually unnecessary.

### Step 4: Run the test — verify GREEN

```bash
cd packages/db && bunx vitest run src/__tests__/init.test.ts
```

Expected: **PASS** (1 test). This validates: `DatabaseSync` constructs, drizzle node-sqlite adapter wraps it, WAL + foreign_keys PRAGMAs apply, migrations apply (all 5 tables exist), and raw inserts work.

If it fails on migrations (e.g. journal format mismatch from the drizzle-kit version bump), see Task 8 — but try Task 8's `db:generate` check first only if this step fails.

### Step 5: Commit

```bash
git add packages/db/src/init.ts packages/db/src/__tests__/init.test.ts
git commit -m "refactor(db): port init.ts and init.test.ts to node:sqlite"
```

---

## Task 3: Fix the async-in-sync transaction in `session-entry-store.ts`

**Goal:** Satisfy drizzle-orm 1.0-rc's "sync drivers can't use async functions in transactions" type constraint. This is a one-word change but it is a *source* change required for the package to typecheck, so it gets its own commit.

**Files:**
- Modify: `packages/db/src/session-entry-store.ts:187`

### Step 1: Drop `async` from the `forkFrom` transaction callback

The callback body is already fully synchronous (`tx.select…get()`, `tx.insert…run()`, `tx.update…run()`, no `await` inside), so removing `async` changes neither behavior nor return type.

`oldString` (unique match — the only `transaction(async (tx)` in the file):

```ts
    await this.db.transaction(async (tx) => {
      const row = tx
        .select({ max: sql<number>`coalesce(max(sequence), -1)` })
```

`newString`:

```ts
    this.db.transaction((tx) => {
      const row = tx
        .select({ max: sql<number>`coalesce(max(sequence), -1)` })
```

Rationale for also dropping `await`: a sync driver's `transaction()` returns `T` synchronously (not a Promise); `await`-ing it is harmless at runtime but the rc type makes the callback's `T` non-Promise, and keeping a stray `await` on a non-promise is fine — however removing it keeps the call site honest. (The other transaction at line 51 is already `(tx) =>` with no `async`; leave it.)

### Step 2: Sanity-check the file still parses

```bash
cd packages/db && bunx tsc --noEmit src/session-entry-store.ts 2>&1 | head -20 || true
```

This standalone check may emit unrelated errors (it doesn't pick up the full project config); the authoritative typecheck runs in Task 7. The goal here is just to confirm no *new* syntax errors were introduced at line 187.

### Step 3: Commit

```bash
git add packages/db/src/session-entry-store.ts
git commit -m "refactor(db): make forkFrom transaction synchronous for node:sqlite"
```

---

## Task 4: Port `session-entry-store.test.ts`

**Goal:** Mechanical port — same patterns as Task 2. The test body uses only `storage.*` methods (no direct `Database` calls beyond setup), so only the imports and the `new Database(...)` constructor change.

**Files:**
- Modify: `packages/db/src/__tests__/session-entry-store.test.ts`

### Step 1: Edit the imports (lines 1–2)

`oldString`:

```ts
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
```

`newString`:

```ts
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
```

### Step 2: Edit the `let` declaration (line 11)

`oldString`:

```ts
  let sqlite: Database;
```

`newString`:

```ts
  let sqlite: DatabaseSync;
```

### Step 3: Edit the constructor (line 23)

`oldString`:

```ts
    sqlite = new Database(join(tmpDir, "test.db"));
```

`newString`:

```ts
    sqlite = new DatabaseSync(join(tmpDir, "test.db"));
```

No other changes. Lines 26–35 (`.prepare(…).run()`) and line 41 (`sqlite.close()`) already match the node:sqlite API.

### Step 4: Run the test — verify GREEN

```bash
cd packages/db && bunx vitest run src/__tests__/session-entry-store.test.ts
```

Expected: **PASS** (all tests in that file). This exercises `appendEntry` (sync transaction at line 51 — confirms sync-transaction path works), `getPathToRoot` (raw `db.all<>` via drizzle), `findEntries`/`getEntries` (`.all()`), and `setLeafId`/`getLeafId`.

### Step 5: Commit

```bash
git add packages/db/src/__tests__/session-entry-store.test.ts
git commit -m "test(db): port session-entry-store.test.ts to node:sqlite and vitest"
```

---

## Task 5: Port `session-entry-store-fork.test.ts`

**Goal:** Port the fork tests. This file is the one that exercises the Task 3 fix (`forkFrom`'s now-sync transaction). There are **three** `new Database(":memory:")` sites (lines 38, 84, 123) that all need changing.

**Files:**
- Modify: `packages/db/src/__tests__/session-entry-store-fork.test.ts`

### Step 1: Edit the imports (lines 1–2)

`oldString`:

```ts
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
```

`newString`:

```ts
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
```

### Step 2: Replace all three `new Database(":memory:")` sites

Use `replaceAll` semantics — the string `new Database(":memory:")` appears identically on lines 38, 84, and 123. Replace each with `new DatabaseSync(":memory:")`.

`oldString` (applied via `replaceAll: true`):

```ts
new Database(":memory:")
```

`newString` (applied via `replaceAll: true`):

```ts
new DatabaseSync(":memory:")
```

### Step 3: Run the test — verify GREEN (this is the real proof of Task 3)

```bash
cd packages/db && bunx vitest run src/__tests__/session-entry-store-fork.test.ts
```

Expected: **PASS** (3 tests). These tests call `storage.forkFrom(...)`, which executes the previously-`async` transaction. Passing here confirms both (a) the node:sqlite driver applies the transaction atomically and (b) the `async`→sync change in Task 3 didn't alter fork semantics (tree structure preserved, IDs regenerated, leaf pointer updated — all asserted by these tests).

If these tests fail with a transaction error, re-check Task 3: the callback must be `(tx) =>` not `async (tx) =>`.

### Step 4: Commit

```bash
git add packages/db/src/__tests__/session-entry-store-fork.test.ts
git commit -m "test(db): port session-entry-store-fork.test.ts to node:sqlite and vitest"
```

---

## Task 6: Port `repos/__tests__/repos.test.ts`

**Goal:** Port the repository tests. These use `db.$client.prepare(…).run()` and `db.$client.close?.()` — both already node:sqlite-compatible (the drizzle node-sqlite adapter exposes `$client` as the `DatabaseSync`). So only imports and the four `new Database(...)` constructors change.

**Files:**
- Modify: `packages/db/src/repos/__tests__/repos.test.ts`

### Step 1: Edit the imports (lines 1–2)

`oldString`:

```ts
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
```

`newString`:

```ts
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
```

### Step 2: Replace all four `new Database(join(tmpDir, "test.db"))` sites

There are four identical constructor calls (lines 15, 53, 88, 140). Replace all.

`oldString` (applied via `replaceAll: true`):

```ts
const sqlite = new Database(join(tmpDir, "test.db"));
```

`newString` (applied via `replaceAll: true`):

```ts
const sqlite = new DatabaseSync(join(tmpDir, "test.db"));
```

No other changes. `db.$client.prepare(…).run()` (lines 143–147, 165–169) and `db.$client.close?.()` (afterAll blocks) are unchanged — `DatabaseSync.prepare().run()` and `DatabaseSync.close()` exist.

### Step 3: Run the test — verify GREEN

```bash
cd packages/db && bunx vitest run src/repos/__tests__/repos.test.ts
```

Expected: **PASS** (all tests across ProjectRepo, SessionRepo, SettingsRepo, ModelConfigRepo). This confirms the drizzle query-builder repos (`select/insert/update/where(eq)/get/all`) work unchanged against `drizzle-orm@1.0.0-rc.3`, and that `db.$client` is the `DatabaseSync`.

### Step 4: Commit

```bash
git add packages/db/src/repos/__tests__/repos.test.ts
git commit -m "test(db): port repos.test.ts to node:sqlite and vitest"
```

---

## Task 7: Full verification gate

**Goal:** Prove the whole `packages/db` is green and contains zero Bun references. This is the "claiming done" checkpoint — run every command and read the actual output before asserting success.

**Files:** none modified.

### Step 1: No `bun:sqlite` / `bun:test` references remain in packages/db

```bash
rg -n "bun:sqlite|bun:test|from \"bun" packages/db/src --glob '!*.md' || echo "CLEAN: no bun imports"
rg -n "Bun\." packages/db/src || echo "CLEAN: no Bun.* API usage"
```

Expected: both print `CLEAN: …`. (The `rg` for `Bun\.` should find nothing — `packages/db` never used `Bun.*` globals.)

### Step 2: Full test suite

```bash
cd packages/db && bun run test
```

Expected: all test files pass; vitest reports 0 failures. (Approximate count: init 1, session-entry-store ~12, session-entry-store-fork 3, repos ~10.)

### Step 3: Typecheck the package

```bash
cd packages/db && bun run typecheck
```

Expected: `tsc --noEmit` exits 0 with no output. This is the check that catches: stale `bun:sqlite` type imports, the `async`-in-sync-transaction constraint (Task 3), `import.meta.dirname` typing, and any drizzle 1.0-rc API drift in `repos/*.ts`.

If this fails, the most likely causes and their fixes:
- `"Sync drivers can't use async functions in transactions!"` → there is still an `async` transaction callback somewhere; Task 3 covered `session-entry-store.ts:187`. Grep `transaction(async` and fix.
- `Cannot find module 'bun:sqlite'` or `'bun:test'` → a test file wasn't ported; revisit Tasks 4–6.
- `Cannot find module 'node:sqlite'` → `@types/node` not installed or `tsconfig.json` `types` not set to `["node"]`; revisit Task 1.

### Step 4: Format & lint gate

```bash
bun x ultracite fix
```

Expected: applies formatting and reports no remaining diagnostics. If diagnostics appear, read them — they're usually trivial (unused import after a port, a `let` that should be `const`). Fix and re-run.

### Step 5: Commit (only if Step 4 changed anything)

```bash
git add -u
git commit -m "style(db): ultracite fix after node:sqlite migration" || echo "nothing to commit"
```

---

## Task 8: Verify drizzle-kit still generates / applies migrations

**Goal:** Guard against the drizzle-kit `0.31.4` → `1.0.0-rc.3` bump silently changing the migration file/journal format. The runtime `init.ts` already re-applies migrations (Task 2's passing test proves existing migrations apply), but we must also confirm `drizzle-kit generate` still works for *future* schema changes.

**Files:** none modified (this is verification; if it surfaces a real problem, that becomes a follow-up).

### Step 1: Run `db:generate` against a throwaway output

```bash
cd packages/db && bunx drizzle-kit generate --out /tmp/sakti-migration-check --name verify-node-sqlite
```

Expected: drizzle-kit reads `src/schema.ts`, connects via `dialect: "sqlite"` + `dbCredentials.url`, and emits SQL + journal into `/tmp/sakti-migration-check/`. It may print `No schema changes` (if the snapshot matches) or emit an identical migration. Either is fine.

If it errors with something about `node:sqlite` / driver binding, the `drizzle.config.ts` (`dialect: "sqlite"`) may need no change (drizzle-kit's sqlite dialect is driver-agnostic for generation). Confirm `packages/db/drizzle.config.ts` is unchanged and still has `dialect: "sqlite"`.

### Step 2: Confirm the existing migrations still apply cleanly (already proven, restate)

Task 2 Step 4 passing == `migrate(db, { migrationsFolder })` ran the existing `packages/db/migrations/*` successfully under drizzle-orm rc. No action unless that test failed.

### Step 3: Clean up the throwaway output

```bash
rm -rf /tmp/sakti-migration-check
```

### Step 4: No commit (verification-only task)

---

## Done — definition of done

`packages/db` is fully migrated when ALL hold:
1. `rg "bun:sqlite|bun:test|Bun\." packages/db/src` → no matches.
2. `cd packages/db && bun run test` → all green.
3. `cd packages/db && bun run typecheck` → exit 0.
4. `bun x ultracite fix` → no diagnostics.
5. `bunx drizzle-kit generate` → succeeds (Task 8).

**Known accepted breakage (out of scope):** `apps/server` will fail typecheck because its 5 `initDatabase(new Database(…))` call sites still use `bun:sqlite`'s `Database`. That is the next plan. Do not attempt to fix it here.

---

## Rollback

If the migration needs to be abandoned before completion:
```bash
git revert <commit-sha-of-task-1>..<HEAD>   # revert tasks 2..8
git checkout HEAD~ -- packages/db/package.json packages/db/tsconfig.json   # restore task 1 configs
```
Then `bun install` to restore `drizzle-orm@0.44.2`. The source/test files revert with the `git revert` range.

---

## Reference: exact before/after for the two substantive files

### `packages/db/src/init.ts`

**Before:**
```ts
import type { Database } from "bun:sqlite";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema.ts";

export type DrizzleDB = BunSQLiteDatabase<typeof schema>;

export async function initDatabase(
  sqlite: Database,
  options?: { migrationsFolder?: string }
): Promise<DrizzleDB> {
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  const migrationsFolder =
    options?.migrationsFolder ?? `${import.meta.dir}/../migrations`;
  migrate(db, { migrationsFolder });

  return db;
}
```

**After:** (see Task 2 Step 3)

### node:sqlite quick-reference (verified on Node v24.15.0)

| bun:sqlite | node:sqlite |
|---|---|
| `import { Database } from "bun:sqlite"` | `import { DatabaseSync } from "node:sqlite"` |
| `new Database(path)` | `new DatabaseSync(path)` |
| `db.query(sql).get()` | `db.prepare(sql).get()` |
| `db.query(sql).all()` | `db.prepare(sql).all()` |
| `db.run("PRAGMA …")` | `db.exec("PRAGMA …")` |
| `db.prepare(sql).run(...params)` | `db.prepare(sql).run(...params)` (unchanged) |
| `db.close()` | `db.close()` (unchanged) |
| `import.meta.dir` | `import.meta.dirname` |
