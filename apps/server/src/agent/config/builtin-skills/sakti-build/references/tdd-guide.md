# TDD Guide

Write the test first. Watch it fail. Write minimal code to pass.

**Core principle:** if you didn't watch the test fail, you don't know if it tests the right thing.

---

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Write code before the test? Delete it. Start over. Not "keep as reference", not "adapt it while writing tests" — delete means delete. Implement fresh from tests.

**Exceptions (ask the user):** throwaway prototypes, generated code, configuration files.

---

## The Cycle: RED → GREEN → REFACTOR

### RED — Write Failing Test

Write one minimal test showing what should happen.

<Good>

```typescript
test("retries failed operations 3 times", async () => {
  let attempts = 0;
  const operation = () => {
    attempts++;
    if (attempts < 3) throw new Error("fail");
    return "success";
  };

  const result = await retryOperation(operation);

  expect(result).toBe("success");
  expect(attempts).toBe(3);
});
```

Clear name, tests real behavior, one thing.

</Good>

<Bad>

```typescript
test("retry works", async () => {
  const mock = jest
    .fn()
    .mockRejectedValueOnce(new Error())
    .mockRejectedValueOnce(new Error())
    .mockResolvedValueOnce("success");
  await retryOperation(mock);
  expect(mock).toHaveBeenCalledTimes(3);
});
```

Vague name, tests mock not code.

</Bad>

**Requirements:** one behavior per test, clear name, real code (no mocks unless unavoidable).

### Verify RED — Watch It Fail

**MANDATORY. Never skip.**

```bash
npm test path/to/test.test.ts
```

Confirm:

- Test **fails** (not errors)
- Failure message is the expected one
- Fails because feature is missing (not typos)

Test passes immediately? You're testing existing behavior — fix the test. Test errors? Fix the error, re-run until it fails correctly.

### GREEN — Minimal Code

Write the simplest code that makes the test pass.

<Good>

```typescript
async function retryOperation<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  throw new Error("unreachable");
}
```

Just enough to pass.

</Good>

<Bad>

```typescript
async function retryOperation<T>(
  fn: () => Promise<T>,
  options?: {
    maxRetries?: number;
    backoff?: "linear" | "exponential";
    onRetry?: (attempt: number) => void;
  },
): Promise<T> {
  // YAGNI — nobody asked for this
}
```

Over-engineered.

</Bad>

Don't add features, refactor other code, or "improve" beyond the test.

### Verify GREEN — Watch It Pass

**MANDATORY.**

```bash
npm test path/to/test.test.ts
```

Confirm: test passes, other tests still pass, output is clean (no warnings/errors).

Test fails? Fix the code, not the test. Other tests fail? Fix now.

### REFACTOR — Clean Up

After green only: remove duplication, improve names, extract helpers. **Tests must stay green.** Don't add behavior.

---

## Why Order Matters

**"I'll write tests after to verify it works"** — tests written after code pass immediately. Passing immediately proves nothing:

- Might test the wrong thing
- Might test implementation, not behavior
- Might miss edge cases you forgot
- You never saw it catch the bug

Test-first forces you to see the test fail, proving it actually tests something.

**"Tests after achieve the same goals"** — No. Tests-after answer "what does this do?" Tests-first answer "what should this do?" Tests-after are biased by your implementation.

---

## Common Rationalizations

| Excuse                                 | Reality                                                       |
| -------------------------------------- | ------------------------------------------------------------- |
| "Too simple to test"                   | Simple code breaks. Test takes 30 seconds.                    |
| "I'll test after"                      | Tests passing immediately prove nothing.                      |
| "Already manually tested"              | Ad-hoc ≠ systematic. No record, can't re-run.                 |
| "Deleting X hours of work is wasteful" | Sunk cost fallacy. Keeping unverified code is technical debt. |
| "Keep as reference, write tests first" | You'll adapt it. That's testing after. Delete means delete.   |
| "Need to explore first"                | Fine. Throw away exploration, start with TDD.                 |
| "Test hard = design unclear"           | Listen to the test. Hard to test = hard to use. Simplify.     |
| "TDD will slow me down"                | TDD is faster than debugging.                                 |
| "This is different because..."         | It isn't. Start over with TDD.                                |

---

## Red Flags — STOP and Start Over

- Code before test
- Test after implementation
- Test passes immediately
- Can't explain why the test failed
- Rationalizing "just this once"
- "Keep as reference" or "adapt existing code"
- "Already spent X hours, deleting is wasteful"

**All of these mean: delete code. Start over with TDD.**

---

## Good Tests

| Quality          | Good                                | Bad                                                 |
| ---------------- | ----------------------------------- | --------------------------------------------------- |
| **Minimal**      | One thing. "and" in name? Split it. | `test("validates email and domain and whitespace")` |
| **Clear**        | Name describes behavior             | `test("test1")`                                     |
| **Shows intent** | Demonstrates desired API            | Obscures what code should do                        |

---

## Bug Fix Integration

Bug found? Write a failing test reproducing it. Follow the TDD cycle. The test proves the fix and prevents regression.

Never fix bugs without a test.

---

## When Stuck

| Problem                | Solution                                                   |
| ---------------------- | ---------------------------------------------------------- |
| Don't know how to test | Write wished-for API. Write assertion first. Ask the user. |
| Test too complicated   | Design too complicated. Simplify the interface.            |
| Must mock everything   | Code too coupled. Use dependency injection.                |
| Test setup huge        | Extract helpers. Still complex? Simplify the design.       |

---

## Verification Checklist

Before marking a task complete:

- [ ] Every new function/method has a test
- [ ] Watched each test fail before implementing
- [ ] Each test failed for the expected reason
- [ ] Wrote minimal code to pass
- [ ] All tests pass
- [ ] Output is clean (no warnings/errors)
- [ ] Tests use real code (mocks only if unavoidable)
- [ ] Edge cases and errors covered

Can't check all boxes? You skipped TDD. Start over.
