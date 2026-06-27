# agent-effect Migration Patterns

Concrete templates established by the Phase 0 vertical slice. Each horizontal phase (A–Cleanup) references these by number.

When the docs site and the source at `openspec/references/effect/packages/` disagree, the source wins (pinned to `effect@3.21.4`).

## Pattern 1: TaggedError template

Converts a project-specific `class FooError extends Error { code; constructor(code, message, cause?) { … } }` into a `Data.TaggedError` so it can be caught via `Effect.catchTag("FooError", …)`.

```typescript
// BEFORE
import { Error } from "node:util"  // or global Error
export class FooError extends Error {
  public code: FooErrorCode
  constructor(code: FooErrorCode, message: string, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = "FooError"
    this.code = code
  }
}

// AFTER
import { Data } from "effect"
export class FooError extends Data.TaggedError("FooError")<{
  readonly code: FooErrorCode
  readonly message: string
  readonly cause?: Error
}>() {}
```

**Constructor call sites** change from positional to object form:
```typescript
// BEFORE
throw new FooError("not_found", "missing", underlyingError)

// AFTER
throw new FooError({
  code: "not_found",
  message: "missing",
  ...(underlyingError !== undefined ? { cause: underlyingError } : {})
})
```
The conditional spread on `cause` satisfies `exactOptionalPropertyTypes: true`.

**Recovery sites** change from `instanceof` to tagged catch:
```typescript
// BEFORE
try { … } catch (e) {
  if (e instanceof FooError) { /* handle */ }
}

// AFTER (inside Effect)
Effect.catchTag("FooError", (e) => /* handle; e.code, e.message typed */ )
```

`instanceof` still works in current Effect versions — leave existing `instanceof` sites alone during the conversion; they'll naturally migrate when their enclosing function becomes Effect-typed.

**Established by:** Task 0.4 (converted `SessionError` in `harness/types.ts`).

## Pattern 2: Service Tag + Layer

(filled by Task 0.8)

## Pattern 3: Service class (Effect.Service)

(filled by Task 0.14)

## Pattern 4: Effect-returning function

(filled by Task 0.14)

## Pattern 5: Test pattern (it.effect + TestLayer)

(filled by Task 0.16)

## Pattern 6: Caller adapter (@migration)

(filled by Task 0.16)
