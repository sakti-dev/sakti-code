# Debugging Guide

Use when a test, build, or runtime failure occurs during implementation. Enter this protocol BEFORE proposing any fix.

**Iron law: no fixes without root cause investigation first.** Random fixes waste time and create new bugs.

---

## When to Enter This Protocol

- A test fails unexpectedly
- The build crashes or errors
- Runtime behavior doesn't match expectations
- A previously-passing test breaks after your changes

**Especially when:** you're under time pressure, the fix "seems obvious," or you've already tried multiple fixes. Those are exactly the moments to slow down and follow the process.

---

## The Four Phases

### Phase 1: Root Cause Investigation

**BEFORE attempting any fix:**

1. **Read the error completely** — don't skim. Stack traces, line numbers, error codes. They usually contain the answer.

2. **Reproduce consistently** — can you trigger it reliably? What are the exact steps? If not reproducible, gather more data.

3. **Check recent changes** — what did you just change? `git diff` shows exactly what's different. The bug is almost always in what you just touched.

4. **Trace data flow** — where does the bad value originate? What passed it here? Keep tracing backward until you find the source. Fix at the source, not at the symptom.

### Phase 2: Pattern Analysis

1. **Find working examples** — is there similar code in the same codebase that works? What's different?
2. **Compare** — list every difference between working and broken, however small.
3. **Understand dependencies** — what does this code rely on? Config? Environment? Other modules?

### Phase 3: Hypothesis and Testing

1. **Form a single hypothesis** — "I think X is the root cause because Y." Be specific.
2. **Test minimally** — make the smallest possible change to test the hypothesis. One variable at a time.
3. **Verify** — did it work? Yes → Phase 4. No → form a NEW hypothesis. Don't stack fixes on top of each other.

### Phase 4: Implementation

1. **Write a failing test** that reproduces the bug (follow TDD cycle from execution guide).
2. **Fix the root cause** — one change, no "while I'm here" improvements.
3. **Verify** — the failing test now passes, and no other tests broke.
4. **If 3+ fixes failed:** stop. Question the architecture. Discuss with the user before attempting more fixes.

---

## Red Flags — STOP and Return to Phase 1

| Thought                                    | Reality                                                    |
| ------------------------------------------ | ---------------------------------------------------------- |
| "Quick fix for now, investigate later"     | First fix sets the pattern — do it right                   |
| "Just try changing X and see"              | Guessing wastes time — investigate first                   |
| "Add multiple changes, run tests"          | Can't isolate what worked — one change at a time           |
| "It's probably X, let me fix that"         | Seeing symptoms ≠ understanding root cause                 |
| "One more fix attempt" (after 2+ failures) | 3+ failures = architectural problem — question the pattern |

---

## Keep It in the Current Change

The bug fix, test, and task checkoff stay in the current change. Don't start a separate "write test cases" change. The verification loop is part of the build phase.
