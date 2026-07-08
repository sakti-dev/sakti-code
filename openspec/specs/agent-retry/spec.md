## Purpose

The retry loop wraps a failed LLM turn with error classification, exponential backoff, and UI visibility. It lives in the agent package but owns no transport — the caller supplies callbacks for emitting events, running turns, rolling back the session leaf, and providing an abort signal. The SDK runs with `maxRetries: 0`; retry is handled here for full control over timing, abort, and reporting.

## Requirements

### Requirement: shouldRetry classifies transient errors

The system SHALL decide whether a failed turn should be retried based on three conditions: auto-retry is enabled, the attempt budget is not exhausted, and the error classifies as transient via `isRetryableAssistantError` from `@sakti-code/llm`. All three must hold.

#### Scenario: Retryable error with budget remaining
- **WHEN** `shouldRetry({ attempt: 1, autoRetryEnabled: true, maxRetries: 3, message })` and the error is retryable
- **THEN** `true` is returned

#### Scenario: Auto-retry disabled
- **WHEN** `autoRetryEnabled: false`
- **THEN** `false` is returned regardless of error class

#### Scenario: Budget exhausted
- **WHEN** `attempt >= maxRetries`
- **THEN** `false` is returned

#### Scenario: Non-retryable error
- **WHEN** the error is not classified as retryable
- **THEN** `false` is returned

### Requirement: Exponential backoff doubles each attempt

The system SHALL compute the backoff delay as `baseDelayMs * 2^(attempt - 1)`. With the default `baseDelayMs` of 2000, delays are 2s, 4s, 8s.

#### Scenario: First retry delay
- **WHEN** `computeRetryDelay(1, 2000)` is called
- **THEN** `2000` (2 seconds) is returned

#### Scenario: Third retry delay
- **WHEN** `computeRetryDelay(3, 2000)` is called
- **THEN** `8000` (8 seconds) is returned

### Requirement: parseRetrySettings extracts settings from session KV map

The system SHALL parse retry settings from a `Record<string, string>` (the session settings map). Defaults: `enabled: false` (auto_retry must be explicitly `"true"`), `baseDelayMs: 2000`, `maxRetries: 3`.

#### Scenario: All settings provided
- **WHEN** `{ auto_retry: "true", base_delay_ms: "5000", max_retries: "5" }`
- **THEN** `{ enabled: true, baseDelayMs: 5000, maxRetries: 5 }` is returned

#### Scenario: Missing settings use defaults
- **WHEN** `{}` (empty map)
- **THEN** `{ enabled: false, baseDelayMs: 2000, maxRetries: 3 }` is returned

### Requirement: executeWithRetryEffect runs the turn with retry orchestration

The system SHALL provide `executeWithRetryEffect(deps, settings)` that runs a turn, and on failure, rolls back the session leaf, sleeps with exponential backoff, and re-runs. It emits `auto_retry_start` before each retry's backoff and a single `auto_retry_end` once the outcome is final.

#### Scenario: First turn succeeds — no retry events
- **WHEN** the first turn succeeds
- **THEN** no `auto_retry_*` events are emitted

#### Scenario: First turn fails, second succeeds
- **WHEN** the first turn fails with a retryable error and the retry succeeds
- **THEN** `auto_retry_start` (attempt 1, delay, errorMessage) is emitted, then `auto_retry_end` (success: true)

#### Scenario: All retries exhausted
- **WHEN** the turn fails 3 consecutive times with retryable errors
- **THEN** `auto_retry_start` is emitted for each attempt, then `auto_retry_end` (success: false, finalError)

#### Scenario: Not enabled — no retries
- **WHEN** `settings.enabled: false` and the turn fails
- **THEN** no retry events are emitted and the loop ends after the first failure

### Requirement: Leaf rollback before each retry

The system SHALL roll back the session leaf before each retry by moving the leaf to the failed assistant message's parent, so the retry re-runs from the preceding message.

#### Scenario: Failed assistant message orphaned
- **WHEN** a retry is about to start
- **THEN** the leaf is moved to the parent of the failed assistant message entry

### Requirement: Abort interrupts backoff

The system SHALL use `abortableSleep` during backoff that resolves immediately (returning `false`) if the abort signal fires. On abort during backoff, `auto_retry_end` (success: false) is emitted and the loop exits.

#### Scenario: Abort during backoff
- **WHEN** the abort signal fires while sleeping between retries
- **THEN** the sleep resolves immediately, `auto_retry_end` is emitted, and the loop exits

#### Scenario: Already aborted before sleep
- **WHEN** the signal is already aborted when sleep starts
- **THEN** the sleep resolves immediately with `false`

### Requirement: Retry deps are Effect-typed callbacks

The system SHALL define `RetryRunnerDepsEffect` with Effect-typed callbacks: `emit` (sync), `runTurn` (returns `Effect<AssistantMessage, Error>`), `rollbackLeaf` (returns `Effect<void, Error>`), `signal` (AbortSignal), and optional `logger`.

#### Scenario: Effect composition
- **WHEN** `executeWithRetryEffect` is composed with other Effects
- **THEN** all retry deps' Effects are yielded directly without bridge wrappers
