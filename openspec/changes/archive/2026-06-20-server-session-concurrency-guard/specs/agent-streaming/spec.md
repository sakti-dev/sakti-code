## ADDED Requirements

### Requirement: Same-session concurrent prompts are rejected, not silently overwritten
The system SHALL reject a `prompt` message for a session that already has an active run, sending an `error` frame with a guidance message — it SHALL NOT silently start a second run that overwrites the first's registry entry. The rejection SHALL carry a message guiding the client to the correct alternatives: `"A run is already active for session <id>. Send a 'steer' or 'followUp' message to queue input, or 'abort' to cancel the active run first."` This mirrors pi's default-path concurrency rejection (`agent-session.ts:1037-1048`: when `isStreaming` and no `streamingBehavior` is specified, throw `"Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message."`), adapted to our WS message-type vocabulary where the queue-vs-reject choice is encoded in the message type (`prompt` = reject path; `steer`/`followUp` = queue path). The guard SHALL be race-free: `registerRun` SHALL perform a synchronous check-and-set (`if activeRuns.has(sessionId) return false; activeRuns.set(...); return true`) so that no `await` gap exists between the concurrency check and the registration — two near-simultaneous `prompt` messages on the same session SHALL result in exactly one successful run and one rejection, regardless of timing. A `prompt` for a session with no active run SHALL start normally. After a run terminates (normal completion, abort, or error) and unregisters itself, a subsequent `prompt` on the same session SHALL succeed.

#### Scenario: Second prompt on active session is rejected with guidance
- **WHEN** a `prompt` message arrives for a session that has an active run
- **THEN** the system sends an `error` frame with message matching `/A run is already active.*steer.*followUp.*abort/` and does NOT start a second run (the first run's registry entry is preserved)

#### Scenario: Race-free: two near-simultaneous prompts yield exactly one run
- **WHEN** two `prompt` messages for the same session arrive within the same event-loop tick (or across `await` boundaries before `registerRun`)
- **THEN** exactly one prompt starts a run and the other receives an `error` frame — the atomic `registerRun` (synchronous `has`+`set`) guarantees no double-registration

#### Scenario: Prompt on idle session starts normally
- **WHEN** a `prompt` message arrives for a session with no active run
- **THEN** the system starts the run, registers it, and forwards events — no rejection

#### Scenario: Prompt after termination succeeds
- **WHEN** a run terminates (completes, is aborted, or errors) and unregisters itself, then a new `prompt` arrives for the same session
- **THEN** the new prompt starts normally (the session is no longer guarded)

#### Scenario: Steer and followUp while active still queue (unchanged)
- **WHEN** a `steer` or `followUp` message arrives for a session with an active run
- **THEN** the message is queued via `loop.steer()` / `loop.followUp()` as before — the concurrency guard applies only to `prompt`, not to steer/followUp (these are pi's explicit-streamingBehavior queue paths, already wired)

#### Scenario: Abort during the termination window still rejects a new prompt
- **WHEN** `abort` has been called but the run has not yet reached its `finally { unregisterRun }` block
- **THEN** a new `prompt` on the same session is still rejected (the run is technically still active until fully unregistered), matching pi's `isStreaming` remaining true until the stream fully drains
