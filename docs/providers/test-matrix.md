# Multi-Provider Branch Test Matrix

Date: 2026-02-14
Branch: `feature/opencode-multi-provider-parity`

## Full Suite Baseline

### `@ekacode/server`

- Status: FAIL
- Summary: 4 failing tests, 143 passing
- Failing suites:
  - `tests/routes/chat.test.ts`
    - `should use existing session when provided`
    - `should process multiple messages in the same session`
  - `tests/middleware/session-bridge.test.ts`
    - `should validate existing session`
    - `should create new session when provided sessionId does not exist`

### `@ekacode/core`

- Status: FAIL
- Summary: 1 failing test, 465 passing, 10 skipped
- Failing suite:
  - `tests/session/controller.test.ts`
    - `should run the controller with a task`

### `@ekacode/desktop`

- Status: FAIL
- Summary: 15 failing tests, 750 passing, 1 skipped
- Failing suites:
  - `tests/integration/chat-area-parity-recorded.test.tsx`
    - `renders turn timeline from recorded fixture events`
  - `tests/unit/core/state/stores/question-store.test.ts`
    - 14 failing cases (all centered around `normalizeQuestionRequest` and undefined `questions` handling)

## Notes

- These failures are baseline branch issues not introduced by provider integration changes.
- Provider-focused targeted suites are currently green.
