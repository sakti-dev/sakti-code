## Purpose

Session controls let a client interact with an active agent-loop run mid-flight: injecting a "steer" message to redirect the loop while it works (aborting an in-progress tool but never the LLM stream), or queueing "follow-up" messages to run as additional turns after the current one completes. Both are delivered over the existing WebSocket and also exposed as REST fallback endpoints.

## Requirements

### Requirement: Agent loop processes steer messages mid-stream
The system SHALL allow clients to inject a steer message into an active loop via `loop.steer(message: string)`. The steer message SHALL be queued in a FIFO buffer (bounded at 10 items). When a steer message is present:
- If the loop is currently streaming from the LLM, the steer SHALL be processed after the LLM stream completes (before tool execution).
- If a tool is executing, the tool SHALL be aborted via its `AbortSignal`, the partial tool result SHALL be appended to messages, and the steer message SHALL be injected as a user message.
- If no tool is executing and no LLM stream is active, the steer SHALL be injected immediately as a user message.

#### Scenario: steer during LLM streaming
- **WHEN** `loop.steer("Consider a different approach")` is called while the LLM is streaming a response
- **THEN** the stream is allowed to complete, the steer message is appended as a user message, and the loop re-sends the updated message list to the LLM

#### Scenario: steer during tool execution
- **WHEN** `loop.steer("Stop and reconsider")` is called while a bash tool is executing
- **THEN** the current tool execution is aborted, the partial tool result is appended, the steer message is appended as a user message, and the loop re-sends to the LLM

#### Scenario: steer queue overflow
- **WHEN** 10 steer messages are already queued and an 11th steer arrives
- **THEN** the 11th message is silently dropped (not queued)

### Requirement: Agent loop processes follow-up messages after current turn
The system SHALL allow clients to queue a follow-up message via `loop.followUp(message: string)`. The followUp message SHALL be queued in a separate FIFO buffer (bounded at 10). After the current turn completes (including all tool executions), the loop SHALL check the follow-up queue. If non-empty, the loop SHALL pop the first message, inject it as a user message, and continue the loop (sending to LLM). The loop SHALL repeat until the follow-up queue is empty.

#### Scenario: follow-up sent during a multi-turn loop
- **WHEN** `loop.followUp("Now refactor the result")` is called during tool execution
- **THEN** the follow-up is queued, the current turn completes normally, and then the follow-up message is processed as a new turn

#### Scenario: follow-up processed before loop termination
- **WHEN** the loop is about to terminate (LLM returned no tool calls) and the follow-up queue is non-empty
- **THEN** the loop does NOT terminate; instead it injects the follow-up message and continues

#### Scenario: multiple follow-ups processed sequentially
- **WHEN** two follow-up messages are queued and the loop completes a turn
- **THEN** the first follow-up is processed; when that turn completes, the second follow-up is processed; only when the queue is empty does the loop terminate

### Requirement: Steer and follow-up messages are persisted
All steer and follow-up messages SHALL be appended to the session store immediately when injected into the loop, as user messages with the session's message history.

#### Scenario: steer message appears in message history
- **WHEN** a steer message is injected into the loop
- **THEN** `store.appendMessage(sessionId, userMessage)` is called with the steer text, and the message appears in subsequent `loadMessages` calls

### Requirement: Steer/follow-up routes via WS
The system SHALL accept `steer` and `followUp` messages over the existing WebSocket connection at `/ws`. Inbound messages SHALL be `{type:"steer", sessionId, message}` and `{type:"followUp", sessionId, message}`. The WS handler SHALL look up the active loop for the sessionId via the abort registry and call the corresponding method. If no active loop exists, the handler SHALL send an `error` frame back.

#### Scenario: steer over WS with active loop
- **WHEN** a `steer` message arrives for a sessionId with an active run
- **THEN** the handler calls `loop.steer(message)` and the steer is queued

#### Scenario: steer over WS without active loop
- **WHEN** a `steer` message arrives for a sessionId with no active run
- **THEN** the handler sends an `error` frame with message "No active run for session X"

### Requirement: Steer/follow-up routes via REST (fallback)
The system SHALL expose `POST /api/sessions/:id/steer` and `POST /api/sessions/:id/follow-up` as REST endpoints. These SHALL look up the active loop for the sessionId and call the corresponding method. If no active run exists, the endpoint SHALL return HTTP 404.

#### Scenario: REST steer with active run
- **WHEN** `POST /api/sessions/:id/steer` with body `{message: "..."}` is called for a session with an active run
- **THEN** the response status is 200 and the steer is queued

#### Scenario: REST steer without active run
- **WHEN** `POST /api/sessions/:id/steer` is called for a session with no active run
- **THEN** the response status is 404
