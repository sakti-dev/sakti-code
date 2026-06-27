# agent-effect Migration Patterns (Effect v4)

Concrete templates established by the Phase 0 vertical slice. Each horizontal phase (A–Cleanup) references these by number.

## Canonical references

When the docs, the skill, and the source disagree, **the source wins**:

- **Effect v4 source (pinned to installed `4.0.0-beta.90`):** `openspec/references/effect-v4/packages/`
  - `effect/src/Context.ts` — `Context.Service` definition
  - `effect/src/Schema.ts` — `Schema.TaggedErrorClass`, `Schema.Class`, `Schema.brand`
  - `effect/src/Effect.ts` — `Effect.fn`, `Effect.gen`
  - `effect/src/Layer.ts` — `Layer.effect`, `Layer.sync`, `Layer.provideMerge`
- **opencode (real-world v4 codebase, `4.0.0-beta.83`):** `openspec/references/opencode/packages/`
  - `core/src/fs-util.ts` — `Context.Service` + `Layer.effect` + `Effect.fn` pattern
  - `opencode/src/account/schema.ts` — `Schema.TaggedErrorClass` with `Schema.Defect` cause
  - `opencode/src/account/repo.ts` — `defaultLayer = layer.pipe(Layer.provide(X.defaultLayer))`
- **Skill (high-level guide, may lag source):** `.opencode/skills/effect-ts/`
  - **Caveat:** skill documents `ServiceMap.Service` — **WRONG**. The actual v4 source uses `Context.Service`. Verified at `effect/src/Tracer.ts:168`, `effect/src/DateTime.ts:1889`. Use `Context.Service`.

---

## Pattern 1: TaggedError template

Converts a project-specific `class FooError extends Error { code; constructor(code, message, cause?) }` into a v4 `Schema.TaggedErrorClass` so it can be caught via `Effect.catchTag("FooError", …)` and serialized over the wire.

```typescript
// BEFORE
export type FooErrorCode = "not_found" | "invalid" | "unknown"

export class FooError extends Error {
  public code: FooErrorCode
  constructor(code: FooErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = "FooError"
    this.code = code
  }
}

// AFTER (v4)
import { Schema } from "effect"

export const FooErrorCode = Schema.Literals(["not_found", "invalid", "unknown"])
export type FooErrorCode = typeof FooErrorCode.Type

export class FooError extends Schema.TaggedErrorClass<FooError>()("FooError", {
  code: FooErrorCode,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
```

### Constructor: object form (call sites)

```typescript
// BEFORE
throw new FooError("not_found", "missing", underlyingError)

// AFTER
yield* new FooError({
  code: "not_found",
  message: "missing",
  ...(underlyingError !== undefined ? { cause: underlyingError } : {}),
})
```

Notes:
- **Yieldable** — `yield* new FooError({...})` is preferred over `Effect.fail(new FooError({...}))`. The skill calls these "yieldable errors."
- The conditional spread on `cause` satisfies `exactOptionalPropertyTypes: true`.
- `Schema.Defect()` wraps any unknown error value; the resulting `cause` field is serializable.

### Recovery: tagged catch (no more `instanceof`)

```typescript
// BEFORE
try { … } catch (e) {
  if (e instanceof FooError) { /* e.code, e.message typed */ }
}

// AFTER (inside Effect)
Effect.catchTag("FooError", (e) => /* e.code, e.message typed */ )

// Multiple tags
Effect.catchTags({
  FooError: (e) => …,
  BarError: (e) => …,
})
```

**`instanceof` still works** but is not the idiomatic v4 form. Leave existing `instanceof` sites alone during the conversion; they'll naturally migrate when their enclosing function becomes Effect-typed.

### Canonical references
- `openspec/references/effect-v4/packages/effect/src/Schema.ts` — search `TaggedErrorClass`
- `openspec/references/opencode/packages/opencode/src/account/schema.ts:39-60` — `AccountServiceError`, `AccountTransportError` with `Schema.Defect` cause
- `.opencode/skills/effect-ts/references/error-handling.md`

**Established by:** Phase 0 Task 0.4 (converts `SessionError`).

---

## Pattern 2: Service template (`Context.Service` + Layer)

Defines a service as a `Context.Service` class (Tag) plus a separate `Layer` implementation. **The Tag and the Layer are always separate declarations** — this is the v4 split from v3's combined `Effect.Service<T>()("T", { effect, dependencies })`.

```typescript
// BEFORE
export interface MyService {
  doThing(id: string): Promise<void>
}

// AFTER (v4)
import { Context, Effect, Layer } from "effect"

// 1. Define the interface (the Shape)
interface MyServiceShape {
  readonly doThing: (id: string) => Effect.Effect<void, MyError>
}

// 2. Define the Tag (the Service class)
class MyService extends Context.Service<MyService, MyServiceShape>()(
  "@sakti-code/MyService"  // globally-unique identifier
) {}

// 3. Define the Layer implementation (separately)
const MyServiceLive = Layer.effect(
  MyService,
  Effect.gen(function* () {
    // yield* dependencies here
    return {
      doThing: Effect.fn("MyService.doThing")(function* (id: string) {
        // ...
      }),
    }
  })
)

// Optional: test layer
const MyServiceTest = Layer.sync(MyService, () => ({
  doThing: () => Effect.void,
}))
```

### Rules
- **Tag identifiers must be unique.** Use `"@sakti-code/<Service>"` for our packages, `"@app/<Service>"` for application code.
- **Shape methods return `Effect`** with `R = never` (no service requirements — dependencies are wired via Layer composition, not method signatures).
- **Layer naming:** camelCase with suffix — `layer` (live), `testLayer` (in-memory test), `Live` (constant), etc.
- **Use `Effect.fn("Service.method")(function* () { ... })` for all methods** — gives tracing spans for free.
- **Parameterized layers are stored in module-level constants** (Effect memoizes layers by reference identity — see Pattern 4).

### Canonical references
- `openspec/references/effect-v4/packages/effect/src/Context.ts:99,200` — `Service` interface + `Service` factory
- `openspec/references/effect-v4/packages/effect/src/Tracer.ts:168`, `DateTime.ts:1889` — `class X extends Context.Service<X, Shape>()("Id") {}` usage
- `openspec/references/opencode/packages/core/src/fs-util.ts:48` — `export class Service extends Context.Service<Service, Interface>()("@opencode/FileSystem") {}`
- `.opencode/skills/effect-ts/references/services-and-layers.md`

**Established by:** Phase 0 Task 0.6 (converts `SessionStorage`).

---

## Pattern 3: Layer composition (`Layer.provideMerge`)

Layers compose by satisfying each other's requirements. Use `Layer.provideMerge` (incremental, flat types) at composition roots.

```typescript
// Single dependency
const MyServiceLive = MyService.layer.pipe(Layer.provideMerge(DepService.layer))

// Multiple dependencies (incremental chain)
const MyServiceLive = MyService.layer.pipe(
  Layer.provideMerge(DepA.layer),
  Layer.provideMerge(DepB.layer),
  Layer.provideMerge(DepC.layer),
)

// Top-level app composition
const appLayer = MyServiceLive.pipe(
  Layer.provideMerge(Config.layer),
  Layer.provideMerge(Logger.layer),
  Layer.provideMerge(Database.layer),
)
```

### `provide` vs `provideMerge` vs `mergeAll`

The three are NOT interchangeable — this is the most common Effect type-error source:

| Method | Deps satisfied? | Available to program? | Use when |
|--------|----------------|----------------------|----------|
| `Layer.provide` | Yes | **No** (hidden) | Internal layer building — hide impl details |
| `Layer.provideMerge` | Yes | Yes | Tests needing setup access, incremental composition |
| `Layer.mergeAll` | No (just combines) | Yes | Combining independent layers at the same level |

```typescript
// provide: hides Database from the program
const internal = MyService.layer.pipe(Layer.provide(DatabaseLayer))
// Result type: Layer<MyService> — Database NOT available to consumers

// provideMerge: keeps Database accessible (use this in tests!)
const testLayer = MyService.layer.pipe(Layer.provideMerge(Database.testLayer))
// Result type: Layer<MyService | Database> — both available for setup/assertion
```

### Canonical references
- `openspec/references/opencode/packages/opencode/src/account/account.ts:459` — `defaultLayer = layer.pipe(Layer.provideMerge(X.defaultLayer), Layer.provideMerge(Y.layer))`
- `.opencode/skills/effect-ts/references/services-and-layers.md` (table at line 248)

**Established by:** Phase 0 Task 0.7 + 0.10 (when `SessionStorage` and `Session` Layers compose).

---

## Pattern 4: Effect-returning function (`Effect.fn`)

Service methods are defined with `Effect.fn("Name")(function* () {...})`. Pure helper functions just return `Effect.gen(function* () { ... })` directly (no name needed).

```typescript
// BEFORE
async function loadX(env: ExecutionEnv, path: string): Promise<Result<X, Error>> {
  const content = await env.readTextFile(path)
  return parse(content)
}

// AFTER (v4)
import { Effect } from "effect"

// Plain Effect-returning function (no service required)
const loadX = (path: string): Effect.Effect<X, FileError, FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem  // require the FileSystem service
    const content = yield* fs.readFileString(path)
    return parse(content)
  })

// Service method (named for tracing)
class MyService extends Context.Service<MyService, Shape>()("@scope/MyService") {
  static readonly layer = Layer.effect(MyService, Effect.gen(function* () {
    const fs = yield* FileSystem
    return {
      loadThing: Effect.fn("MyService.loadThing")(function* (id: string) {
        const content = yield* fs.readFileString(`things/${id}`)
        return parse(content)
      }),
    }
  }))
}
```

### Rules
- **Inputs that were "things with behavior" (env, storage, deps)** → become `R` (requirements) via `yield* Service`.
- **Inputs that were data (paths, options, ids)** → stay as function arguments.
- **Errors** → typed in the `E` channel.
- **Use `Effect.fn("name")` for service methods** — gives tracing spans. **Use plain `Effect.gen` for one-off functions** — no name needed.

### Canonical references
- `openspec/references/effect-v4/packages/effect/src/Effect.ts:1870,5845` — `Effect.fn` definitions
- `openspec/references/opencode/packages/core/src/fs-util.ts:55-60` — `Effect.fn("FileSystem.existsSafe")(function* (path) {...})`
- `.opencode/skills/effect-ts/SKILL.md:28-62` — `Effect.gen` + `Effect.fn` syntax

**Established by:** Phase 0 Task 0.11 (when `buildSessionContext` becomes `Effect<...>`).

---

## Pattern 5: Test pattern (`it.effect` + `Layer.provide`)

Tests use `@effect/vitest`'s `it.effect` (provides `TestContext` automatically — `TestClock`, `TestRandom`, etc.). Each test provides its own fresh layer.

```typescript
import { describe, it, expect } from "@effect/vitest"
import { Effect } from "effect"

describe("MyService", () => {
  // Happy path
  it.effect("does the thing", () =>
    Effect.gen(function* () {
      const svc = yield* MyService
      yield* svc.doThing("id")
      // ...assertions
    }).pipe(Effect.provide(MyService.testLayer))
  )

  // Error path: swap channels with Effect.flip
  it.effect("fails with NotFoundError", () =>
    Effect.gen(function* () {
      const svc = yield* MyService
      const error = yield* svc.findById("missing").pipe(Effect.flip)
      expect(error._tag).toBe("NotFoundError")
    }).pipe(Effect.provide(MyService.testLayer))
  )
})
```

### Variants

| Variant | When to use |
|---------|-------------|
| `it.effect` | Default. Provides `TestContext` (Clock starts at 0, deterministic Random). Most Effect tests. |
| `it.live` | When you need the real system clock or actual time delays. |
| `it.scoped` | When the test itself needs a `Scope` (rare — scoping is automatic in v4). |
| `it.layer(Layer)("describe name", (it) => {...})` | Only for **expensive shared resources** (DB connections). Default is fresh layer per test. |

### Providing layers

```typescript
// Fresh per test (preferred — no state leakage)
it.effect("test name", () =>
  Effect.gen(function* () { ... }).pipe(Effect.provide(MyService.testLayer))
)

// Shared across a describe (only for expensive resources)
it.layer(MyService.layer)("MyService", (it) => {
  it.effect("first", () => Effect.gen(function* () { ... }))
  it.effect("second", () => Effect.gen(function* () { ... }))
})

// Composed test layer with deps accessible for setup
const testLayer = MyService.layer.pipe(
  Layer.provideMerge(DepA.testLayer),
  Layer.provideMerge(DepB.testLayer),
)

it.effect("uses both deps", () =>
  Effect.gen(function* () {
    const a = yield* DepA        // accessible because provideMerge
    const svc = yield* MyService
    // ...
  }).pipe(Effect.provide(testLayer))
)
```

### Canonical references
- `.opencode/skills/effect-ts/references/testing.md` — full worked example
- `openspec/references/opencode/packages/opencode/test/` — real test files

**Established by:** Phase 0 Task 0.15 (rewrites `session.test.ts`).

---

## Pattern 6: Caller adapter (`// @migration`)

During the migration, downstream callers (not yet converted) need a Promise-based wrapper around the new Effect API. Each adapter is tagged `// @migration` and removed in Phase Cleanup.

```typescript
// BEFORE (Phase 0 lands)
import { Session } from "./harness/session.ts"

export async function prepareCompaction(session: Session, ...) {
  const entries = await session.getBranch()
  // ...
}

// AFTER (during migration — Phase 0 has converted Session to Context.Service)
import { Effect } from "effect"
import { Session } from "./harness/session.ts"

// @migration TODO: remove when compaction.ts migrates to Effect (Phase Compaction)
export async function prepareCompaction(session: Session, ...) {
  return Effect.runPromise(
    prepareCompactionEffect(...).pipe(Effect.provideService(Session, session))
  )
}

// NEW: Effect-native version (what future code calls)
export const prepareCompactionEffect = (
  ...
): Effect.Effect<PrepareResult, CompactionError, Session | CompletionProvider> =>
  Effect.gen(function* () {
    const session = yield* Session
    const entries = yield* session.getBranch()
    // ...
  })
```

### Rules
- Every `// @migration` adapter must have a `TODO: remove when X migrates (Phase Y)` comment.
- `grep "@migration" packages/agent-effect/src/` shows all outstanding adapters. Final cleanup is one PR.
- Adapters wrap Effect via `Effect.runPromise` (the only place inside `agent-effect` where it's OK to call `runPromise`).

### Cleanup verification
- At end of migration: `rg "@migration" packages/agent-effect/src/ | wc -l` must be 0.
- Phase 0 records a baseline count after the slice lands.

**Established by:** Phase 0 Task 0.12.

---

## Anti-patterns to avoid (from skill, verified against v4 source)

| Do not | Do instead |
|--------|-----------|
| `class X extends Data.TaggedError("X")<{...}>() {}` | `class X extends Schema.TaggedErrorClass<X>()("X", { fields }) {}` |
| `Effect.Service<T>()("T", { effect, deps }) {}` (v3 combined form) | `class T extends Context.Service<T, Shape>()("T") {}` + separate `Layer.effect(T, ...)` |
| `ServiceMap.Service<...>` (skill typo) | `Context.Service<...>` (canonical) |
| `throw new Error("...")` inside `Effect.gen` | `yield* new FooError({...})` or `Effect.fail(...)` |
| `Effect.catchAll(() => ...)` losing type info | `Effect.catchTag("X", ...)` / `Effect.catchTags({...})` |
| Scatter `Effect.provide` calls | Provide once at app entry |
| Call parameterized layer constructors inline | Store layers in constants (memoization by reference identity) |
| `console.log(...)` | `Effect.log(...)` with structured data |
| `process.env.KEY` | `Config.string("KEY")` or `Config.redacted("KEY")` |
| `instanceof FooError` (when inside Effect code) | `Effect.catchTag("FooError", ...)` |
| `new Promise((resolve, reject) => ...)` executors | `Effect.async` / `Effect.tryPromise` |
| Direct mutable class fields for shared state | `Ref<T>` / `SynchronizedRef<T>` |
