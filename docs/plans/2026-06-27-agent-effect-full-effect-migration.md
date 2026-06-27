# agent-effect Full Effect Migration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate `packages/agent-effect` from a verbatim structural port to a fully Effect-**v4**-native package — typed errors via `Schema.TaggedErrorClass`, services via `Context.Service` + `Layer.effect`, `Either` instead of `Result`, the agent loop as a `Stream`, `Session` as a v4 service, and `@effect/vitest` for tests. Fixes latent bugs C1–C6 and perf issues P1, P2, P4–P8 along the way.

**Architecture:** Vertical Slice + Horizontal Phases (Approach C). Convert `Session` end-to-end first to establish 6 reusable patterns, then apply those patterns horizontally to every remaining module. Always-green TDD: every commit keeps the full test suite passing. Temporary `// @migration` adapters at caller boundaries let not-yet-migrated modules keep their Promise APIs.

**Tech Stack:**
- TypeScript, vitest, biome (via ultracite)
- **`effect@4.0.0-beta.90`** (v4 beta; opencode reference on `4.0.0-beta.83`)
- **`@effect/vitest@4.0.0-beta.90`** (matched to effect version)
- `@effect/platform@^4.0.0-beta` — to add in Phase FS (deferred)
- `@sakti-code/llm` (workspace; will be modified in Phase LLM to add Effect variants)
- `typebox`, `uuid`, `yaml` (unchanged)

**Design doc:** `docs/plans/2026-06-27-agent-effect-full-effect-migration-design.md` — read this first for architecture, layer tree, and pattern rationale.

**Canonical v4 references (when API behavior is unclear):**
- **Effect v4 source (pinned to installed `4.0.0-beta.90`):** `openspec/references/effect-v4/packages/effect/src/`
- **opencode (real-world v4 codebase):** `openspec/references/opencode/packages/`
- **Migration patterns:** `docs/patterns/agent-effect-migration-patterns.md`
- **Skill:** `.opencode/skills/effect-ts/` (verify against source — `ServiceMap.Service` is a known skill typo; use `Context.Service`)

---

## How to use this plan

**Conventions:**
- Each phase ships green. Run `pnpm run test`, `pnpm exec tsc --noEmit`, `pnpm run fix` before every commit.
- All tests run from `packages/agent-effect`: `cd packages/agent-effect && pnpm run test` (or `pnpm exec vitest run <path>`).
- Typecheck: `cd packages/agent-effect && pnpm exec tsc --noEmit`.
- Biome: `pnpm run fix` from repo root.
- Code style: follow `AGENTS.md` (arrow fns for callbacks, `for…of`, no `any`, `const` by default, etc.).
- All commit messages follow existing style: `feat(agent-effect): …`, `refactor(agent-effect): …`, `fix(agent-effect): …`, `docs(agent-effect): …`.

**Patterns reference:** `docs/patterns/agent-effect-migration-patterns.md` documents the 6 patterns (TaggedError, Context.Service, Layer composition, Effect-returning function, it.effect test, @migration caller adapter) with v4 canonical code. Phases A+ reference patterns by number.

**Effect source reference:** The full Effect-TS v4 source is checked out at `openspec/references/effect-v4/packages/` (pinned at `effect@4.0.0-beta.90`, matching what's installed). opencode's v4 codebase is at `openspec/references/opencode/packages/` (real-world reference, `4.0.0-beta.83`). If you're unsure how an Effect API behaves — `Schema.TaggedErrorClass` shape, `Context.Service` signatures, `Layer` composition semantics, `Schedule` combinators, `Stream` patterns, `@effect/platform` service shapes — **read the source**. Particularly useful:

- `openspec/references/effect-v4/packages/effect/src/Context.ts` — `Context.Service` definition (NOT `ServiceMap.Service` as the skill claims)
- `openspec/references/effect-v4/packages/effect/src/Schema.ts` — `Schema.TaggedErrorClass`, `Schema.Class`, `Schema.brand`
- `openspec/references/effect-v4/packages/effect/src/Effect.ts` — `Effect.fn`, `Effect.gen`
- `openspec/references/opencode/packages/core/src/fs-util.ts` — full pattern: `Context.Service` + `Layer.effect` + `Effect.fn`
- `openspec/references/opencode/packages/opencode/src/account/schema.ts` — `Schema.TaggedErrorClass` with `Schema.Defect` cause

When docs and source disagree, **source wins** (docs lag; source is pinned).

**Granularity note:** Phase 0 has full TDD micro-steps. Phases A–Retry have task-level breakdowns with key code samples. Phases Compaction–Cleanup are outlines — when reached, write a dedicated sub-plan if uncertainty surfaces during execution.

---

## Phase 0: Vertical Slice (Session) — ~3 days

**Establishes all 6 patterns. Converts `Session`, `SessionError`, `SessionStorage`, `buildSessionContext`, and rewrites session tests as `it.effect`.**

### Task 0.1: Add `@effect/vitest` devDep (matched to v4 effect)

**Files:**
- Modify: `packages/agent-effect/package.json`

**Step 1:** Confirm versions in `package.json` (should already be set):
```json
{
  "dependencies": { "effect": "4.0.0-beta.90" },
  "devDependencies": { "@effect/vitest": "4.0.0-beta.90" }
}
```
If not, run: `cd packages/agent-effect && pnpm add effect@4.0.0-beta.90 && pnpm add -D @effect/vitest@4.0.0-beta.90`

**Step 2:** Verify install:
```bash
node -e "console.log(require('./packages/agent-effect/node_modules/effect/package.json').version)"
# Should print: 4.0.0-beta.90
```

**Step 3:** Commit
```bash
git add packages/agent-effect/package.json pnpm-lock.yaml
git commit -m "chore(agent-effect): pin effect@4.0.0-beta.90 + @effect/vitest@4.0.0-beta.90"
```

---

### Task 0.2: Write `PATTERNS.md` skeleton

**Files:**
- Create: `docs/patterns/agent-effect-migration-patterns.md`

**Step 1:** Create file with section headers (no content yet — filled in as patterns land):
```markdown
# agent-effect Migration Patterns

Concrete templates established by the Phase 0 vertical slice. Each horizontal phase (A–Cleanup) references these by number.

## Pattern 1: TaggedError template
(filled by Task 0.4)

## Pattern 2: Service Tag + Layer
(filled by Task 0.8)

## Pattern 3: Service class (Effect.Service)
(filled by Task 0.12)

## Pattern 4: Effect-returning function
(filled by Task 0.14)

## Pattern 5: Test pattern (it.effect + TestLayer)
(filled by Task 0.16)

## Pattern 6: Caller adapter (@migration)
(filled by Task 0.18)
```

**Step 2:** Commit
```bash
git add docs/patterns/agent-effect-migration-patterns.md
git commit -m "docs(patterns): scaffold agent-effect migration patterns doc"
```

---

### Task 0.3: Write failing test for v4 `Schema.TaggedErrorClass` `SessionError`

**Files:**
- Create: `packages/agent-effect/src/harness/__tests__/session-error.tagged.test.ts`

**Step 1:** Write the failing test using **v4** patterns (NOT `Data.TaggedError` — see Pattern 1 in PATTERNS.md):

```typescript
import { describe, it, expect } from "@effect/vitest"
import { Effect, Either } from "effect"
import { SessionError } from "../types.ts"

describe("SessionError (Schema.TaggedErrorClass)", () => {
  it("has _tag = 'SessionError' and typed fields", () => {
    const error = new SessionError({
      code: "not_found",
      message: "missing entry",
    })
    expect(error._tag).toBe("SessionError")
    expect(error.code).toBe("not_found")
    expect(error.message).toBe("missing entry")
  })

  it("is still instanceof Error", () => {
    const error = new SessionError({ code: "storage", message: "disk full" })
    expect(error).toBeInstanceOf(Error)
  })

  it("supports optional cause", () => {
    const underlying = new Error("disk I/O")
    const error = new SessionError({
      code: "storage",
      message: "write failed",
      cause: underlying,
    })
    expect(error.cause).toBe(underlying)
  })

  it.effect("recovers via Effect.catchTag", () =>
    Effect.gen(function* () {
      const result = yield* Effect.fail(
        new SessionError({ code: "not_found", message: "x" })
      ).pipe(
        Effect.catchTag("SessionError", (e) =>
          Effect.succeed(`recovered: ${e.code}`)
        )
      )
      expect(result).toBe("recovered: not_found")
    })
  )

  it.effect("appears in Either channel via Effect.either", () =>
    Effect.gen(function* () {
      const either = yield* Effect.either(
        Effect.fail(new SessionError({ code: "storage", message: "y" }))
      )
      expect(Either.isLeft(either)).toBe(true)
      if (Either.isLeft(either)) {
        expect(either.left._tag).toBe("SessionError")
        expect(either.left.code).toBe("storage")
      }
    })
  )

  it.effect("is yieldable — no Effect.fail needed", () =>
    Effect.gen(function* () {
      const either = yield* Effect.either(
        Effect.gen(function* () {
          yield* new SessionError({ code: "not_found", message: "z" })
        })
      )
      expect(Either.isLeft(either)).toBe(true)
    })
  )
})
```

**Step 2:** Run to verify it fails:
```bash
cd packages/agent-effect && pnpm exec vitest run src/harness/__tests__/session-error.tagged.test.ts
```
Expected: FAIL — `SessionError` is not yet a TaggedErrorClass; `new SessionError({...})` doesn't match current positional constructor `(code, message, cause?)`.

---

### Task 0.4: Convert `SessionError` to `Schema.TaggedErrorClass` (v4)

**Files:**
- Modify: `packages/agent-effect/src/harness/types.ts:180-196` (the `SessionErrorCode` union + `SessionError` class)
- Modify call sites (find with `rg -n "new SessionError\(" src/`)

**Step 1:** Replace the type + class with v4 form (Pattern 1 from PATTERNS.md):

```typescript
// BEFORE
export type SessionErrorCode =
  | "not_found"
  | "invalid_session"
  | "invalid_entry"
  | "invalid_fork_target"
  | "storage"
  | "unknown";

export class SessionError extends Error {
  public code: SessionErrorCode;
  constructor(code: SessionErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SessionError";
    this.code = code;
  }
}

// AFTER (v4)
import { Schema } from "effect";

export const SessionErrorCode = Schema.Literals([
  "not_found",
  "invalid_session",
  "invalid_entry",
  "invalid_fork_target",
  "storage",
  "unknown",
]);
export type SessionErrorCode = typeof SessionErrorCode.Type;

export class SessionError extends Schema.TaggedErrorClass<SessionError>()(
  "SessionError",
  {
    code: SessionErrorCode,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}
```

Add `import { Schema } from "effect";` at the top of `types.ts` (alongside the existing type imports).

**Step 2:** Find and update all `new SessionError(code, message, cause?)` call sites:
```bash
cd packages/agent-effect && rg -n "new SessionError\(" src/
```

Known sites (verify before editing):
- `harness/session.ts:252` — `new SessionError("not_found", \`Entry ${targetId} not found\`)`
- `harness/session.ts:279` — same with `entryId`
- `harness/memory-storage.ts:69, 85, 153` — multi-line form: `new SessionError("invalid_session", \`...${this.leafId}...\`)`
- `harness/memory-storage.ts:95, 144` — single-line: `new SessionError("not_found", \`Entry ${leafId} not found\`)`
- `compaction/branch-summarization.ts:104` — `new SessionError("invalid_session", \`Entry ${current} not found\`)`

Each converts to object form:
```typescript
new SessionError({
  code: "not_found",
  message: `Entry ${id} not found`,
})
```

No existing site passes `cause`, so no conditional spread needed in this pass.

**Step 3:** Run the failing test — should now PASS:
```bash
pnpm exec vitest run src/harness/__tests__/session-error.tagged.test.ts
```

**Step 4:** Run the full suite to verify no regressions:
```bash
pnpm run test
```
Expected: 233+ tests pass (6 new from this task).

**Step 5:** Verify Pattern 1 in `docs/patterns/agent-effect-migration-patterns.md` matches what we landed (already done — no edits needed unless divergence).

**Step 6:** Commit
```bash
git add packages/agent-effect/src/harness/types.ts \
        packages/agent-effect/src/harness/__tests__/session-error.tagged.test.ts \
        packages/agent-effect/src/harness/session.ts \
        packages/agent-effect/src/harness/memory-storage.ts \
        packages/agent-effect/src/compaction/branch-summarization.ts
git commit -m "refactor(agent-effect): convert SessionError to Schema.TaggedErrorClass (v4 Pattern 1)

Establishes Pattern 1 for the migration.
- SessionErrorCode becomes Schema.Literals (serializable)
- SessionError becomes Schema.TaggedErrorClass
- All call sites updated to object-form constructor
- Yieldable: yield* new SessionError({...}) works without Effect.fail
- catchTag('SessionError', ...) is the idiomatic recovery"
```

---

### Task 0.5: Write failing test for `SessionStorage` as `Context.Tag`

**Files:**
- Create: `packages/agent-effect/src/harness/__tests__/session-storage.tag.test.ts`

**Step 1:** Write the failing test:
```typescript
import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { it } from "@effect/vitest"
import { SessionStorage, type SessionTreeEntry } from "../types.ts"

describe("SessionStorage (Context.Tag)", () => {
  it.effect("is accessible via yield* SessionStorage", () =>
    Effect.gen(function* () {
      const storage = yield* SessionStorage
      const id = yield* storage.createEntryId()
      expect(typeof id).toBe("string")
    }).pipe(
      Effect.provide(
        Layer.succeed(SessionStorage, {
          createEntryId: () => Effect.succeed("test-id"),
          getLeafId: () => Effect.succeed(null),
          appendEntry: () => Effect.void,
          getEntry: () => Effect.succeed(undefined),
          getEntries: () => Effect.succeed([]),
          getBranch: () => Effect.succeed([]),
          getPathToRoot: () => Effect.succeed([]),
          getLabel: () => Effect.succeed(undefined),
          findEntries: () => Effect.succeed([]),
          getMetadata: () => Effect.succeed({} as never),
          setLeafId: () => Effect.void,
        })
      )
    )
  )
})
```

**Step 2:** Run — expected FAIL (`SessionStorage` is currently an interface, not a `Context.Tag`).

---

### Task 0.6: Convert `SessionStorage` interface to `Context.Tag` + change method signatures

**Files:**
- Modify: `packages/agent-effect/src/harness/types.ts:427-442`

**Step 1:** Replace the interface + add Service class (v4 pattern — see Pattern 2 in PATTERNS.md):

```typescript
import { Context, Effect } from "effect"
import type { SessionMetadata, SessionTreeEntry } from "./types.ts"
import { SessionError } from "./types.ts"

// 1. The interface (the Shape) — all methods return Effect
export interface SessionStorageShape<TMetadata extends SessionMetadata = SessionMetadata> {
  readonly appendEntry: (entry: SessionTreeEntry) => Effect.Effect<void, SessionError>
  readonly createEntryId: () => Effect.Effect<string, SessionError>
  readonly findEntries: <TType extends SessionTreeEntry["type"]>(
    type: TType
  ) => Effect.Effect<Array<Extract<SessionTreeEntry, { type: TType }>>, SessionError>
  readonly getEntries: () => Effect.Effect<SessionTreeEntry[], SessionError>
  readonly getEntry: (
    id: string
  ) => Effect.Effect<SessionTreeEntry | undefined, SessionError>
  readonly getLabel: (
    id: string
  ) => Effect.Effect<string | undefined, SessionError>
  readonly getLeafId: () => Effect.Effect<string | null, SessionError>
  readonly getMetadata: () => Effect.Effect<TMetadata, SessionError>
  readonly getPathToRoot: (
    leafId: string | null
  ) => Effect.Effect<SessionTreeEntry[], SessionError>
  readonly setLeafId: (
    leafId: string | null
  ) => Effect.Effect<void, SessionError>
}

// 2. The Service Tag (Context.Service, NOT Context.Tag — Tag isn't in v4)
//    Pattern: class X extends Context.Service<X, Shape>()("Identifier") {}
export class SessionStorage<TMetadata extends SessionMetadata = SessionMetadata>
  extends Context.Service<SessionStorage<TMetadata>, SessionStorageShape<TMetadata>>()(
    "@sakti-code/SessionStorage"
  ) {}
```

Note: `SessionStorage` (the class) becomes the Tag — callers do `yield* SessionStorage`. The interface name changes to `SessionStorageShape` to avoid collision.

**Step 2:** Update the failing test to use `SessionStorage` as a Tag (yield* it) and `SessionStorageShape` for the shape:

**Step 3:** Run failing test — should still FAIL because `InMemorySessionStorage` doesn't implement the new signature yet (Task 0.7 fixes that).

---

### Task 0.7: Convert `InMemorySessionStorage` to a Layer

**Files:**
- Modify: `packages/agent-effect/src/harness/memory-storage.ts` (entire file)

**Step 1:** Rewrite using `Layer.effect` + `Ref` for internal state. Pattern:

```typescript
import { Effect, Layer, Ref } from "effect"
import { SessionStorage, type SessionStorageImpl, type SessionMetadata, SessionError } from "./types.ts"
// … other imports

export const InMemorySessionStorageLive: <TMetadata extends SessionMetadata = SessionMetadata>() =>
  Layer.Layer<SessionStorage<TMetadata>, never, never> = () =>
    Layer.effect(SessionStorage, Effect.gen(function* () {
      const entries = yield* Ref.make(new Map<string, SessionTreeEntry>())
      const leafIdRef = yield* Ref.make<string | null>(null)
      const metadataRef = yield* Ref.make<TMetadata>({} as TMetadata)

      return {
        createEntryId: () => Effect.sync(() => /* existing uuidv7 logic */),
        appendEntry: (entry) =>
          Ref.update(entries, (m) => m.set(entry.id, entry)),  // atomic — fixes C5
        getLeafId: () => Ref.get(leafIdRef),
        setLeafId: (id) => Ref.set(leafIdRef, id),
        getEntry: (id) => Effect.gen(function* () {
          const m = yield* Ref.get(entries)
          return m.get(id)
        }),
        getEntries: () => Effect.gen(function* () {
          const m = yield* Ref.get(entries)
          return Array.from(m.values())
        }),
        getPathToRoot: (leafId) => Effect.gen(function* () {
          const m = yield* Ref.get(entries)
          // existing walk logic, but reading from `m`
          // …
        }),
        // … all other methods
      } satisfies SessionStorageImpl
    }))
```

Keep the existing logic verbatim; only change: read state via `Ref.get`, mutate via `Ref.update`/`Ref.set`. This **fixes C5 (Session append race)** — `Ref` updates are atomic.

**Step 2:** Export a default instance for tests: `export const InMemorySessionStorageDefault = InMemorySessionStorageLive()`.

**Step 3:** Delete the old `class InMemorySessionStorage { … }`.

**Step 4:** Find all `new InMemorySessionStorage()` callers and update:
```bash
rg -n "new InMemorySessionStorage" packages/agent-effect/
```
Replace with `Layer.provide(program, InMemorySessionStorageLive())` or equivalent.

**Step 5:** Run failing test — should PASS now.

**Step 6:** Run full suite. Expected: many tests fail (every consumer of `SessionStorage` is broken — `session.ts`, `session.test.ts`, anywhere `new Session(storage)` is constructed). This is expected — we'll fix them in Tasks 0.9–0.13.

---

### Task 0.8: Document Pattern 2 + commit `SessionStorage` conversion

**Step 1:** Fill Pattern 2 in `PATTERNS.md` with the interface→Tag + Layer template.

**Step 2:** Commit the conversion (state: tests partially failing — `SessionStorage` and `InMemorySessionStorageLive` are converted; callers not yet adapted).

DO NOT commit broken. Instead, do tasks 0.9–0.13 first, then commit everything together at 0.13.

---

### Task 0.9: Write failing test for `Session` as `Effect.Service`

**Files:**
- Create: `packages/agent-effect/src/harness/__tests__/session.service.test.ts`

**Step 1:** Write the failing test:
```typescript
import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { it } from "@effect/vitest"
import { Session } from "../session.ts"
import { InMemorySessionStorageLive } from "../memory-storage.ts"
import { createUserMessage } from "./session-test-utils.ts"

describe("Session (Effect.Service)", () => {
  it.effect("appends a message and updates leaf", () =>
    Effect.gen(function* () {
      const session = yield* Session
      yield* session.appendMessage(createUserMessage("hello"))
      const leaf = yield* session.getLeafId()
      expect(leaf).not.toBeNull()
    }).pipe(Effect.provide(Session.Default))
  )

  it.effect("reads messages back via getBranch", () =>
    Effect.gen(function* () {
      const session = yield* Session
      yield* session.appendMessage(createUserMessage("first"))
      yield* session.appendMessage(createUserMessage("second"))
      const branch = yield* session.getBranch()
      expect(branch.length).toBeGreaterThanOrEqual(2)
    }).pipe(Effect.provide(Session.Default))
  )
})
```

Note: `Session.Default` should be a Layer that provides both `Session` AND `SessionStorage` (since Session depends on SessionStorage).

**Step 2:** Run — FAIL (`Session` is currently a plain class, not `Effect.Service`).

---

### Task 0.10: Convert `Session` class to `Effect.Service`

**Files:**
- Modify: `packages/agent-effect/src/harness/session.ts:105-296`

**Step 1:** Replace the class with v4 `Context.Service` form (Pattern 2 + 3 from PATTERNS.md). **Note**: v4 splits Tag from Layer — `Context.Service` defines the Tag only; the Layer is a separate declaration.

```typescript
import { Context, Effect, Layer } from "effect"

// 1. The interface (Shape)
export interface SessionShape<TMetadata extends SessionMetadata = SessionMetadata> {
  readonly getMetadata: () => Effect.Effect<TMetadata, SessionError>
  readonly getLeafId: () => Effect.Effect<string | null, SessionError>
  readonly getEntry: (id: string) => Effect.Effect<SessionTreeEntry | undefined, SessionError>
  readonly getEntries: () => Effect.Effect<SessionTreeEntry[], SessionError>
  readonly getLabel: (id: string) => Effect.Effect<string | undefined, SessionError>
  readonly getBranch: (fromId?: string) => Effect.Effect<SessionTreeEntry[], SessionError>
  readonly buildContext: () => Effect.Effect<SessionContext, SessionError>
  readonly appendMessage: (msg: AgentMessage) => Effect.Effect<void, SessionError>
  readonly appendCompaction: <T>(arg: { firstKeptEntryId: string; summary: string; details?: T }) => Effect.Effect<void, SessionError>
  readonly moveTo: (entryId: string) => Effect.Effect<void, SessionError>
  // … other methods
}

// 2. The Service Tag (Context.Service, NOT Effect.Service — v3 form is deprecated)
export class Session<TMetadata extends SessionMetadata = SessionMetadata>
  extends Context.Service<Session<TMetadata>, SessionShape<TMetadata>>()(
    "@sakti-code/Session"
  ) {}

// 3. The Layer (separately declared, depends on SessionStorage)
//    Pattern 3 (Layer composition): use Layer.effect + yield* dependencies
export const SessionLive = Layer.effect(
  Session,
  Effect.gen(function* () {
    const storage = yield* SessionStorage

    return {
      getMetadata: () => storage.getMetadata(),
      getLeafId: () => storage.getLeafId(),
      getEntry: (id) => storage.getEntry(id),
      getEntries: () => storage.getEntries(),
      getLabel: (id) => storage.getLabel(id),

      // Service methods use Effect.fn for tracing (Pattern 4)
      getBranch: Effect.fn("Session.getBranch")(function* (fromId?: string) {
        const leafId = fromId ?? (yield* storage.getLeafId())
        return yield* storage.getPathToRoot(leafId)
      }),

      buildContext: Effect.fn("Session.buildContext")(function* () {
        const branch = yield* (yield* Session).getBranch()
        return buildSessionContextFromEntries(branch)
      }),

      appendMessage: Effect.fn("Session.appendMessage")(function* (msg: AgentMessage) {
        const id = yield* storage.createEntryId()
        const parentId = yield* storage.getLeafId()
        const entry: MessageEntry = {
          type: "message",
          id,
          parentId: parentId ?? null,
          timestamp: Date.now(),
          message: msg,
        }
        yield* storage.appendEntry(entry)
        yield* storage.setLeafId(id)
      }),

      // … other methods, each as Effect.fn("Session.X")(function* () { ... })
    }
  })
)

// Convenience: Session with default InMemory storage baked in (for tests)
export const SessionWithInMemory = SessionLive.pipe(
  Layer.provideMerge(InMemorySessionStorageLive)
)
```

**Step 2:** Drop `getStorage()` (no longer needed — consumers ask `SessionStorage` directly via `yield*`).

**Step 3:** Run failing test (from Task 0.9) — should now PASS when provided `SessionLive` (which requires `SessionStorage`) or `SessionWithInMemory` (self-contained).

---

### Task 0.11: Convert `buildSessionContext` to Effect-returning

**Files:**
- Modify: `packages/agent-effect/src/harness/session.ts:26-103` (the existing `buildSessionContext` function)

**Step 1:** Split into two functions:
- `buildSessionContextFromEntries(entries: SessionTreeEntry[]): SessionContext` — pure tree-walk logic (stays as-is, just renamed)
- `buildSessionContext(fromId?: string): Effect.Effect<SessionContext, SessionError, Session>` — the Effect-returning wrapper

```typescript
// Pure (no change to logic — just renamed)
export function buildSessionContextFromEntries(
  entries: SessionTreeEntry[]
): SessionContext {
  // … existing body of buildSessionContext
}

// Effect-returning
export const buildSessionContext = (
  fromId?: string
): Effect.Effect<SessionContext, SessionError, Session> =>
  Effect.gen(function* () {
    const session = yield* Session
    const branch = yield* session.getBranch(fromId)
    return buildSessionContextFromEntries(branch)
  })
```

---

### Task 0.12: Add caller adapters for not-yet-migrated modules

**Files:**
- Modify: `packages/agent-effect/src/compaction.ts`
- Modify: `packages/agent-effect/src/compaction/auto-compaction.ts`
- Modify: `packages/agent-effect/src/compaction/branch-summarization.ts`
- Modify: `packages/agent-effect/src/harness/agent-harness.ts`

For each file, find every call to `session.someMethod()` or `buildSessionContext(session)` and wrap:

```typescript
// BEFORE
async function compact(session: Session, ...) {
  const entries = await session.getBranch()
  // …
}

// AFTER
import { Effect } from "effect"

// @migration TODO: remove when compaction.ts migrates to Effect (Phase Compaction)
export async function compact(session: Session, ...) {
  return Effect.runPromise(
    compactEffect(...).pipe(Effect.provideService(Session, session))
  )
}

export const compactEffect = (
  ...
): Effect.Effect<CompactResult, CompactionError, Session | CompletionProvider> =>
  Effect.gen(function* () {
    const session = yield* Session
    const entries = yield* session.getBranch()
    // …
  })
```

Run `rg -n "session\.(getBranch|appendMessage|getLeafId|getEntry|getMetadata|appendCompaction|moveTo)" packages/agent-effect/src/` to find all sites.

**Important:** Each adapter must be tagged `// @migration TODO: remove when X migrates to Effect (Phase Y)`. Final cleanup in Phase Cleanup does `rg "@migration"` to find them all.

---

### Task 0.13: Run full suite — fix any remaining breakages

**Step 1:** `pnpm run test` from `packages/agent-effect`.
Expected: some tests in `session.test.ts` still broken (they call `new Session(storage)`).

**Step 2:** Update `session.test.ts` to either use the new Effect API or to call a legacy constructor helper. Since Task 0.16 rewrites `session.test.ts` as `it.effect`, for now:
- Update tests minimally to make them pass via `Effect.runPromise(...)` wrappers, OR
- Delete and rewrite (Task 0.16).

Pragmatic choice: rewrite now if the existing tests are simple; otherwise wrap.

**Step 3:** Once full suite is green, commit everything together:

```bash
git add packages/agent-effect/src/harness/{types,session,memory-storage}.ts \
        packages/agent-effect/src/harness/__tests__/session-storage.tag.test.ts \
        packages/agent-effect/src/harness/__tests__/session.service.test.ts \
        packages/agent-effect/src/{compaction.ts,compaction/auto-compaction.ts,compaction/branch-summarization.ts,harness/agent-harness.ts} \
        packages/agent-effect/src/harness/__tests__/session.test.ts
git commit -m "refactor(agent-effect): convert Session + SessionStorage to Effect services

Establishes Patterns 2 (Service Tag + Layer) and 3 (Effect.Service class).
InMemorySessionStorage rewritten with Ref-based state — fixes C5 (append race).
Session, SessionStorage, and buildSessionContext are now Effect-native.
Callers in compaction/auto-compaction/branch-summarization/agent-harness
use temporary @migration adapters — removed in Phase Cleanup."
```

---

### Task 0.14: Document Patterns 3 + 4

**Step 1:** Fill Pattern 3 (`Effect.Service` class template) in `PATTERNS.md` using `Session` as the example.

**Step 2:** Fill Pattern 4 (Effect-returning function template) using `buildSessionContext` as the example.

**Step 3:** Commit
```bash
git add docs/patterns/agent-effect-migration-patterns.md
git commit -m "docs(patterns): document Service + Effect-function patterns from slice"
```

---

### Task 0.15: Rewrite `session.test.ts` as `it.effect`

**Files:**
- Modify: `packages/agent-effect/src/harness/__tests__/session.test.ts`

**Step 1:** Rewrite each existing test using `it.effect` + `Effect.provide(Session.Default)`. Use the `InMemorySessionStorageLive` Layer as the test storage.

Existing 10 tests should map 1:1. Examples:
```typescript
it.effect("appends a message as a child of the current leaf", () =>
  Effect.gen(function* () {
    const session = yield* Session
    yield* session.appendMessage(createUserMessage("hello"))
    const branch = yield* session.getBranch()
    expect(branch.length).toBe(1)
  }).pipe(Effect.provide(Session.Default))
)
```

**Step 2:** Run — verify all 10 pass.

**Step 3:** Delete the temporary `session-error.tagged.test.ts` and `session-storage.tag.test.ts` and `session.service.test.ts` — they were scaffolding; their content merges into the rewritten `session.test.ts`. (Or keep them as separate concerns — judgment call.)

**Step 4:** Commit
```bash
git add packages/agent-effect/src/harness/__tests__/session.test.ts
git rm packages/agent-effect/src/harness/__tests__/session-error.tagged.test.ts \
       packages/agent-effect/src/harness/__tests__/session-storage.tag.test.ts \
       packages/agent-effect/src/harness/__tests__/session.service.test.ts
git commit -m "test(agent-effect): rewrite session.test.ts as @effect/vitest it.effect

Establishes Pattern 5 (it.effect + TestLayer) for the migration."
```

---

### Task 0.16: Document Pattern 5 + 6

**Step 1:** Fill Pattern 5 in `PATTERNS.md` with the `it.effect` template.

**Step 2:** Fill Pattern 6 (caller adapter template) with the `@migration` pattern.

**Step 3:** Commit
```bash
git add docs/patterns/agent-effect-migration-patterns.md
git commit -m "docs(patterns): document test + caller-adapter patterns from slice"
```

---

### Task 0.17: Verify Phase 0 complete

**Step 1:** Run all phase gates (see Verification Gates section):
- `pnpm run test` — all green
- `pnpm exec tsc --noEmit` — clean
- `pnpm run fix` — clean
- No new `any` introduced
- `rg "@migration" packages/agent-effect/src/ | wc -l` — count recorded as baseline (will go to 0 in Phase Cleanup)

**Step 2:** Commit baseline count
```bash
echo "Phase 0 baseline: $(rg "@migration" packages/agent-effect/src/ | wc -l) adapters" >> docs/plans/2026-06-27-agent-effect-full-effect-migration.md
git add docs/plans/2026-06-27-agent-effect-full-effect-migration.md
git commit -m "docs(agent-effect): record Phase 0 @migration adapter baseline"
```

---

## Phase A: Remaining TaggedErrors → `Schema.TaggedErrorClass` — ~1 day

**Apply Pattern 1 to the 5 remaining error classes. Mechanical.**

### Task A.1: Convert `FileError`

**Files:**
- Modify: `packages/agent-effect/src/harness/types.ts:114-138`
- Modify: any call sites (find with `rg "new FileError\(" packages/agent-effect/src/`)

**Steps:** Apply Pattern 1 (from PATTERNS.md) verbatim — `Schema.TaggedErrorClass` form. Update all `new FileError(code, message, cause?)` call sites to object form. Add `import { Schema } from "effect"` if not already present.

**Commit:**
```bash
git add -u && git commit -m "refactor(agent-effect): convert FileError to Schema.TaggedErrorClass (Pattern 1)"
```

### Task A.2: Convert `ExecutionError`

Same as A.1 — apply Pattern 1 to `ExecutionError` (`types.ts:139-154`).

**Commit:** `refactor(agent-effect): convert ExecutionError to Schema.TaggedErrorClass`

### Task A.3: Convert `CompactionError`

Same — `types.ts:155-169`.

**Commit:** `refactor(agent-effect): convert CompactionError to Schema.TaggedErrorClass`

### Task A.4: Convert `BranchSummaryError`

Same — `types.ts:170-187`.

**Commit:** `refactor(agent-effect): convert BranchSummaryError to Schema.TaggedErrorClass`

### Task A.5: Convert `AgentHarnessError`

Same — `types.ts:209-217`. Also convert `AgentHarnessErrorCode` to `Schema.Literals`.

**Important:** Check `normalizeHarnessError` in `agent-harness.ts:165-187` — it does `instanceof` checks. Verify they still work, or convert to `_tag`-based switch (preferred for v4).

**Commit:** `refactor(agent-effect): convert AgentHarnessError to Schema.TaggedErrorClass`

### Task A.6: Update `normalizeHarnessError` to use `_tag` switch

**Files:**
- Modify: `packages/agent-effect/src/harness/agent-harness.ts:165-187`

Replace `instanceof` chain with `_tag`-based switch:
```typescript
const normalizeHarnessError = (error: unknown): AgentHarnessError => {
  if (error instanceof Error && "_tag" in error) {
    switch (error._tag) {
      case "SessionError": return new AgentHarnessError({ code: "session", message: error.message, cause: error as Error })
      case "CompactionError": return new AgentHarnessError({ code: "compaction", message: error.message, cause: error as Error })
      // …
    }
  }
  return new AgentHarnessError({ code: "unknown", message: String(error) })
}
```

**Commit:** `refactor(agent-effect): switch normalizeHarnessError to _tag-based matching`

---

## Phase B: `Result<T,E>` → `Either<E,T>` — ~1 day

**Apply Pattern 4 to all `Result`/`ok`/`err` sites.**

### Task B.1: Convert `Result` type definition

**Files:**
- Modify: `packages/agent-effect/src/harness/types.ts:17-42`

**Step 1:** Replace the type and helpers:
```typescript
// BEFORE
export type Result<TValue, TError> = { ok: true; value: TValue } | { ok: false; error: TError }
export function ok<TValue, TError>(value: TValue): Result<TValue, TError> { … }
export function err<TValue, TError>(error: TError): Result<TValue, TError> { … }

// AFTER — re-export Either from effect
import { Either } from "effect"
export type { Either as Result }  // TEMPORARY alias — deleted in Task B.10
export const ok = Either.right
export const err = Either.left
```

Keep `ok`/`err`/`Result` as temporary aliases so call sites work without changes. Type narrows via `Either.isLeft` / `Either.isRight` instead of `.ok`.

**Step 2:** Find call sites using `.ok` boolean:
```bash
rg -n "\.ok\b" packages/agent-effect/src/ | grep -v test
```
Convert each `if (!result.ok)` to `if (Either.isLeft(result))` (access `.left` for error, `.right` for value).

**Commit:** `refactor(agent-effect): replace Result with Either (alias layer)`

### Task B.2: Convert compaction.ts Result sites

**Files:**
- Modify: `packages/agent-effect/src/compaction.ts`

Apply Pattern 4 to `prepareCompaction`, `compact`, `generateSummary`, `generateTurnPrefixSummary`. Each currently returns `Promise<Result<T, CompactionError>>` — change to `Effect.Effect<T, CompactionError, …>` (deps via `R`).

**Commit:** `refactor(agent-effect): convert compaction.ts to Either/Effect`

### Task B.3: Convert branch-summarization.ts Result sites

Same pattern. `collectEntriesForBranchSummary`, `generateBranchSummary`.

**Commit:** `refactor(agent-effect): convert branch-summarization.ts to Either/Effect`

### Task B.4: Convert loader-shared.ts Result sites

**Files:**
- Modify: `packages/agent-effect/src/harness/loader-shared.ts`

`parseFrontmatter` returns `Result<T, Error>` today — keep it pure (no Effect, since it's a pure string parser) but return `Either<Error, T>`.

`resolveKind` is async — becomes `Effect<…, Error, FileSystem>` (Phase Loaders will handle the FileSystem dep). For now, leave it as async returning `Either`.

**Commit:** `refactor(agent-effect): convert loader-shared.ts to Either`

### Task B.5: Convert remaining Result sites

```bash
rg -n "Result<" packages/agent-effect/src/
```
Update any stragglers.

**Commit:** `refactor(agent-effect): remove remaining Result usage`

### Task B.6: Drop temporary `ok`/`err`/`Result` aliases

After all sites converted, delete the aliases from `types.ts`. Update remaining imports.

**Commit:** `refactor(agent-effect): remove Result/ok/err aliases — Either everywhere`

---

## Phase LLM: `@sakti-code/llm` Effect variants — ~1 day

**Add Effect-native API to `@sakti-code/llm`. No changes to existing Promise API.**

### Task L.1: Add `streamEffect` and `completeEffect`

**Files:**
- Modify: `packages/llm/src/index.ts` (export)
- Create: `packages/llm/src/effect.ts`

**Step 1:** Create `packages/llm/src/effect.ts` (v4 patterns):
```typescript
import { Effect, Schema } from "effect"
import { stream, complete, type StreamRequest, type CompletionRequest, type StreamResult, type CompletionResult } from "./index.ts"

// v4: Schema.TaggedErrorClass, NOT Data.TaggedError (Pattern 1)
export class LLMError extends Schema.TaggedErrorClass<LLMError>()("LLMError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export const streamEffect = (
  req: StreamRequest
): Effect.Effect<StreamResult, LLMError, never> =>
  Effect.tryPromise({
    try: () => stream(req),
    catch: (e) => new LLMError({ message: "stream failed", cause: e }),
  })

export const completeEffect = (
  req: CompletionRequest
): Effect.Effect<CompletionResult, LLMError, never> =>
  Effect.tryPromise({
    try: () => complete(req),
    catch: (e) => new LLMError({ message: "complete failed", cause: e }),
  })
```

**Step 2:** Add `"effect": "4.0.0-beta.90"` to `packages/llm/package.json` deps.

**Step 3:** Export from `packages/llm/src/index.ts`:
```typescript
export * from "./effect.ts"
```

**Step 4:** Test from `packages/llm` (add a unit test that mocks the underlying `stream`/`complete`).

**Commit:** `feat(llm): add Effect-native streamEffect/completeEffect variants (v4)`

### Task L.2: Introduce `StreamProvider` and `CompletionProvider` services in agent-effect

**Files:**
- Create: `packages/agent-effect/src/services/llm.ts`

**Step 1:** Define services with v4 `Context.Service` (Pattern 2):
```typescript
import { Context, Effect, Layer } from "effect"
import { streamEffect, completeEffect, LLMError, type StreamRequest, type CompletionRequest } from "@sakti-code/llm"

// Service shapes
interface StreamProviderShape {
  readonly stream: (req: StreamRequest) => Effect.Effect<StreamResult, LLMError>
}
interface CompletionProviderShape {
  readonly complete: (req: CompletionRequest) => Effect.Effect<CompletionResult, LLMError>
}

// v4 Service Tags (Context.Service, NOT Context.Tag — Pattern 2)
export class StreamProvider extends Context.Service<StreamProvider, StreamProviderShape>()(
  "@sakti-code/StreamProvider"
) {}

export class CompletionProvider extends Context.Service<CompletionProvider, CompletionProviderShape>()(
  "@sakti-code/CompletionProvider"
) {}

// Live Layers (Pattern 3 — Layer.effect / Layer.sync)
export const StreamProviderLive = Layer.succeed(StreamProvider, {
  stream: (req) => streamEffect(req),
})

export const CompletionProviderLive = Layer.succeed(CompletionProvider, {
  complete: (req) => completeEffect(req),
})
```

**Step 2:** Export from `index.ts`.

**Commit:** `feat(agent-effect): add StreamProvider + CompletionProvider services (Pattern 2)`

---

## Phase C1+C2: Vanilla fix for `EventStream` + fire-and-forget — ~2 hours

**Fix the catastrophic hang bug independently of Effect migration. Stays vanilla; carries straight into Phase D.**

### Task C1C2.1: Add error path to `EventStream`

**Files:**
- Modify: `packages/agent-effect/src/utils/event-stream.ts`

**Step 1:** Add `error` method + reject `finalResultPromise`:
```typescript
// Add to EventStream class
error(error: unknown): void {
  if (this.done) return
  this.done = true
  this.errorState = error
  // Drain waiting consumers with done iterator
  for (const waiter of this.waiting) {
    waiter({ done: true, value: undefined })
  }
  this.waiting = []
  // Reject the result promise if anyone is awaiting
  if (this.resultReject) this.resultReject(error)
}

private errorState: unknown
private resultReject: ((e: unknown) => void) | undefined

// Update result() to wire reject:
async result(): Promise<R> {
  // existing logic, but capture reject:
  return new Promise<R>((resolve, reject) => {
    this.resultReject = reject
    // existing resolve wiring
  })
}

// Update the async iterator to throw if errorState:
if (this.errorState !== undefined) {
  throw this.errorState
}
```

**Step 2:** Write tests for the error path.

**Commit:** `fix(agent-effect): add EventStream.error() to terminate iterators on failure (C2)`

### Task C1C2.2: Add `.catch` to fire-and-forget loop wrappers

**Files:**
- Modify: `packages/agent-effect/src/loop/agent-loop.ts:43-56, 83-96`

**Step 1:** Replace both:
```typescript
// BEFORE
void runAgentLoop(...).then((messages) => { stream.end(messages); })

// AFTER
void runAgentLoop(...).then(
  (messages) => stream.end(messages),
  (error) => stream.error(error)
)
```

**Step 2:** Test: write a test that mocks `runAgentLoop` to throw, verify the consumer doesn't hang.

**Commit:** `fix(agent-effect): terminate stream on loop rejection (C1)`

---

## Phase Retry: `retry-loop.ts` → Effect — ~1-2 days

**Convert retry loop to `Effect.retry` + `Schedule.exponential`. First non-trivial Effect concurrency work.**

### Task R.1: Convert `abortableSleep` to `Clock.sleep`

`Clock.sleep` is interruptible by default — no manual `AbortController` plumbing needed.

### Task R.2: Convert `shouldRetry`/`computeRetryDelay` (pure) — leave as-is

These are pure functions; stay as helpers consumed by the Effect retry logic.

### Task R.3: Convert `executeWithRetry` to Effect

Use:
```typescript
Effect.retry(effect, {
  while: (e) => isRetryableAssistantError(e),
  schedule: Schedule.exponential("1 second", 2.0).pipe(
    Schedule.compose(Schedule.recurs(maxRetries))
  ),
}).pipe(
  Effect.tap(() => emit({ type: "auto_retry_attempt", ... })),
  // …
)
```

### Task R.4: Rewrite `retry-loop.test.ts` as `it.effect`

24 tests. Use `TestClock.adjust` to fast-forward time instead of real delays.

### Task R.5: Remove `@migration` adapters from caller (none — retry-loop is consumed by server only)

**Commit per task** — keep commits small.

---

## Phase Loaders: `loader-shared` + 4 entity loaders + `builtin-agents` — ~2 days

**Introduce `FileSystem` Layer (Pattern 2). Apply Pattern 4 to all loader functions.**

### Tasks L.1–L.6

For each of `loader-shared.ts`, `commands.ts`, `agents.ts`, `prompt-templates.ts`, `skills.ts`, `builtin-agents.ts`:

1. Identify the FileSystem/Shell calls (`env.readTextFile`, `env.listDir`, etc.).
2. Introduce a `FileSystem` Context.Tag in `harness/types.ts` mirroring the existing `FileSystem` interface but Effect-returning.
3. Convert each function: `async function loadX(env): Promise<...>` → `loadX: Effect.Effect<..., FileError, FileSystem>`.
4. Rewrite test file as `it.effect`, providing a `FileSystemTest` Layer.
5. After all loaders converted, delete the `// @migration` adapters from each loader's callers (compaction, harness).

**Bonus perf:** Fix P6 (parallel I/O at startup) — wrap independent directory walks in `Effect.all({ concurrency: 8 })`.

**Commits:** One per loader module. Each commit = green suite.

---

## Phase Compaction: compaction pipeline — ~3 days

**Convert `compaction.ts` + `auto-compaction.ts` + `branch-summarization.ts`.**

Apply Patterns 1, 3, 4. Each LLM call (`complete()`) becomes `yield* CompletionProvider.complete(...)`. Each session access becomes `yield* Session`.

### Key tasks
1. Convert `prepareCompaction` to Effect.
2. Convert `compact` to Effect — wraps two parallel LLM calls via `Effect.all([historyResult, turnPrefixResult])`.
3. Convert `generateSummary` / `generateTurnPrefixSummary`.
4. Convert `auto-compaction.ts` — `evaluateCompaction`, `runCompaction`.
5. Convert `branch-summarization.ts` — `collectEntriesForBranchSummary`, `generateBranchSummary`.
6. Rewrite tests as `it.effect`. Use `TestLayer` for `CompletionProvider` (mock the LLM).
7. **Perf P4:** Add `estimateTokensFromEntries(pathEntries)` to avoid building the full message tree just to count tokens.
8. **Perf P5:** Drop the re-fetch loop in `collectEntriesForBranchSummary` — iterate the already-fetched array.
9. Delete `// @migration` adapters from Phase 0 (compaction was the main consumer).

**Commit per task.**

---

## Phase D: `loop/agent-loop.ts` → Effect-native — ~1-2 weeks

**The biggest, riskiest phase. May warrant its own dedicated sub-plan when reached.**

### Key migrations
1. `EventStream` → `Queue<AgentEvent>` + `Stream` (or replace with `Stream.async`).
2. `runLoop` (~950 lines) → `Effect.gen` with `while` loop.
3. `AgentLoopConfig`'s ~15 callbacks → individual service tags:
   - `BeforeToolCall`, `AfterToolCall`, `PrepareNextTurn`, `GetFollowUpMessages`, `GetSteeringMessages`, `TransformContext`, `ConvertToLlm`, `EvaluatePermission`, `ResolvePermissionAsk`, `ShouldStopAfterTurn`.
4. `agentLoop`/`agentLoopContinue` fire-and-forget wrappers → `Effect.fork` with proper error channel (the Phase C1+C2 vanilla fix carries over naturally).
5. `defaultStreamFn` dynamic import → `StreamProvider` Layer.
6. Permission flow (ask/reply) → `Effect.service`-based request/reply.
7. Tool preflight → `Effect.all` for parallel preparation (where safe).

### Bug fixes integrated
- **C1+C2:** naturally fixed by `Effect.fork` + `Stream` error channel.
- **C4:** `Ref<AgentHarnessPhase>` + scoped `Effect`.
- **C6:** `Effect.gen` has no `Promise.all` masking footgun.

### Perf fixes integrated
- **P1:** Skip `prepareNextTurn` rebuild when no pending writes were flushed (reuse `hadPendingMutations` flag at `agent-harness.ts:660`).
- **P2:** Delta `convertToLlm` — cache converted prefix `[0..k-1]`.
- **P8:** Guard debug-log arg allocation with `if (config.logger)`.

### Tests
Rewrite all 27 `agent-loop.test.ts` tests as `it.effect`. The mock `streamFn` becomes a `TestLayer` for `StreamProvider`.

**Stop and write a dedicated sub-plan before starting Phase D** if uncertainty surfaces.

---

## Phase E: `agent.ts` → Effect — ~3 days

Convert `Agent` class to Effect-based lifecycle:
- `_state` → `Ref<AgentState>`
- `listeners` Set → `PubSub<AgentEvent>` or `Queue` per subscriber
- `subscribe()` → returns `Stream<AgentEvent>`
- `start()` / `continue()` / `stop()` → `Effect<..., AgentError, AgentLoop>`; `stop()` → `Fiber.interrupt`

Rewrite `agent.test.ts` (18 tests) as `it.effect`.

---

## Phase Harness: `agent-harness.ts` → Layer-based — ~1 week

**The orchestrator. Depends on Phase D.**

### Key migrations
1. ~20 mutable private fields → `Ref`/`SynchronizedRef`/`Queue`/`PubSub`.
2. Event multiplexer (`Map<string, Set<handler>>`) → split into:
   - `PubSub` for fire-and-forget events (`queue_update`, `save_point`, `tool_call`, …)
   - `Effect` service for request/reply hooks (`before_agent_start`, `tool_result`, `session_before_compact`)
3. Every public method (`startAgent`, `switchAgent`, `continueAgent`, `abort`, `compact`, `navigateTree`) → scoped `Effect` sharing one cancelable fiber.
4. `runAbortController` plumbing → `Fiber.interrupt`.
5. `waitForIdle` → `Fiber.join`.
6. `pendingSessionWrites` → `Queue` drained at `turn_end`/`agent_end` save points.

### Bug fixes integrated
- **C3:** `Fiber.interrupt(runFiber)` reaches into any in-flight method — compaction becomes abortable.
- **C4:** Phase state in `Ref`, transitions atomic.

### Code cleanups integrated
- Delete `if (!model)` dead branches (M1).
- Delete `"retry"` from `AgentHarnessPhase` (M2 — never assigned).
- Delete `before_provider_payload` / `after_provider_response` events (M3 — never emitted) OR wire them up.
- Replace `getActiveTools()` `!` with filter (M4).
- Extract `runAsTurn(fn)` helper (M7) — removes ~60 lines of duplication.
- Split `navigateTree` (M6) into sub-functions.
- Replace magic strings with `as const` registry (M5).
- Document `emitHook` "last wins" semantics (M8).
- **Perf P3:** one `cloneStreamOptions` per provider request.
- **Perf P7:** trim hook-chain clones.

Rewrite 4 harness test files (`agent-harness.test.ts`, `agent-harness-continue.test.ts`, `agent-switch.test.ts`, `agent-type.test.ts`) as `it.effect`.

---

## Phase FS: `FileSystem` → `@effect/platform` — ~2-3 days (independent)

Replace custom `FileSystem`/`Shell`/`ExecutionEnv` interfaces (`harness/types.ts:236-319`) with `@effect/platform` services.

**Prerequisite:** Run after Phase Loaders (which introduces the `FileSystem` Tag) — this phase swaps the implementation.

Add `@effect/platform` and `@effect/platform-node` as deps. Map `FileError.code` → `@effect/platform`'s `PlatformError._tag` at the adapter boundary.

Tests use `@effect/platform`'s test fixtures (`FileSystem.layerNoop`).

---

## Phase Cleanup: Remove `@migration` adapters + dead code — ~1 day

1. `rg "@migration" packages/agent-effect/src/` — list all adapters.
2. Each adapter's TODO names the phase that should remove it. Confirm that phase has landed. Delete the adapter + the legacy `async function` wrapper.
3. `pnpm run test` — green.
4. Restore JSDoc on any modules where it was stripped during the structural port and not yet restored.
5. Final `pnpm run fix` + `pnpm exec tsc --noEmit`.
6. Commit:
   ```bash
   git commit -m "refactor(agent-effect): remove all @migration adapters — migration complete"
   ```

---

## Verification Gates (every phase)

Before committing the final task of any phase:

1. **Tests green:** `cd packages/agent-effect && pnpm run test` — all tests pass.
2. **Typecheck clean:** `cd packages/agent-effect && pnpm exec tsc --noEmit`.
3. **Lint clean:** `pnpm run fix` from repo root.
4. **No new `any`/unsafe casts:** spot-check via `rg ": any" packages/agent-effect/src/` (compare count before/after).
5. **Adapters tagged:** any new `// @migration` adapter has `TODO: remove when X migrates (Phase Y)`.
6. **Bug fixes verified:** if a phase claims to fix a bug (per matrix in design doc), a test must demonstrate the fix.
7. **PATTERNS.md updated:** if a new pattern emerged, document it before committing.

---

## Sequencing summary

| Week | Phase | Days | Bugs fixed | Perf fixed |
|------|-------|------|------------|------------|
| 1 | **0** Slice (Session) | 3 | C5 | — |
| 2 | **A** TaggedErrors | 1 | — | — |
| 2 | **B** Either | 1 | — | — |
| 2 | **LLM** Effect variants | 1 | — | — |
| 3 | **C1+C2** vanilla | 0.25 | C1, C2 | — |
| 3 | **Retry** | 2 | — | — |
| 3-4 | **Loaders** | 2 | — | P6 |
| 4-5 | **Compaction** | 3 | — | P4, P5 |
| 6-7 | **D** Agent Loop | 10 | C1, C2, C4, C6 | P1, P2, P8 |
| 8 | **E** Agent | 3 | — | — |
| 9-10 | **Harness** | 7 | C3 | P3, P7 |
| 11 | **FS** @effect/platform | 3 | — | — |
| 12 | **Cleanup** | 1 | — | — |

Phase F (tests → `@effect/vitest`) happens **inline** with each phase, not as a separate sweep.

---

## Stop-and-replan triggers

Pause and write a dedicated sub-plan if any of these occur:

1. **Phase D (agent loop) feels sprawling.** Write a `2026-XX-XX-agent-loop-effect-sub-plan.md` before proceeding.
2. **A pattern from Phase 0 doesn't fit a later module.** Document the divergence in PATTERNS.md, then either revise the pattern or split the module's migration into a separate plan.
3. **`@effect/vitest` proves awkward for a particular test shape.** Keep that test in plain `it()` form — don't force-convert. Document why.
4. **More than 3 new `// @migration` adapters accumulate in a single phase.** Reconsider sequencing — the phase may be trying to do too much.
5. **Test count drops below 230** (we have 233 today). Net test count should stay flat or grow; if it shrinks, we're losing coverage.

---

## Cross-references

- Design doc: `docs/plans/2026-06-27-agent-effect-full-effect-migration-design.md`
- Patterns: `docs/patterns/agent-effect-migration-patterns.md` (created in Phase 0)
- Effect-TS references: `.opencode/skills/effect-ts/references/*.md` (error-handling, layers, concurrency, streams, schema, testing, config, anti-patterns)
- **Effect source (pinned to installed version):** `openspec/references/effect/packages/` — read the actual implementation when API behavior is unclear. Subdirs: `effect/src/`, `platform/`, `platform-node/`. The docs site can lag; this source matches `effect@3.21.4` exactly.
- Original structural port plan (now superseded): `docs/plans/2026-06-27-agent-effect-tier5.md`
- Deep-dive code review findings (C1–C6, P1–P8, M1–M8): in conversation log; summarize into `docs/patterns/agent-effect-migration-patterns.md` as needed
