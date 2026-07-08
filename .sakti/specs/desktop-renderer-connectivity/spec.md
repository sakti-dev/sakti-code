# desktop-renderer-connectivity Specification

## Purpose

The desktop-renderer-connectivity capability provides the network layer between the renderer and the embedded Hono server. It includes the type-safe Hono RPC client (`api.ts`), the WebSocket client (`ws-client.ts`) with automatic reconnect and event dispatch, and the `Actions` facade (`actions.ts`) that exposes all renderer→server operations (CRUD for projects/sessions, prompt submission, transition confirmation, intermediate loading, permission replies, and steering/follow-up).

## Requirements

### Requirement: Type-safe API client

The system SHALL create a Hono RPC client via `hc<App>(url)` targeting `window.location.origin`. The client type SHALL be derived from the server's `App` type. The `api` factory function SHALL delegate directly to `hc`.

#### Scenario: API client targets window origin

- **WHEN** the Hono RPC client is created
- **THEN** the base URL is `window.location.origin`
- **AND** the client is fully typed via `hc<App>`

### Requirement: Electron type bridge

The renderer SHALL declare the global `sakti` property via `import type` only — the import is erased at build time so no Electron code enters the renderer bundle. The type SHALL be `SaktiDesktopAPI` from the shared contract.

#### Scenario: window.sakti is typed but not bundled

- **WHEN** the renderer compiles
- **THEN** `window.sakti` has type `SaktiDesktopAPI`
- **AND** no `electron/` code is included in the renderer bundle

### Requirement: WebSocket client lifecycle

The `WsClient` SHALL connect on creation via `api.ws.$ws()`, listen for `open`, `message`, `error`, and `close` events, and set the server store's connection status accordingly. On `close`, the client SHALL reconnect with exponential backoff starting at 1 second, doubling per attempt, capped at 30 seconds. On `message`, JSON frames SHALL be parsed and dispatched by type:

- `"welcome"` — set connection status to `open`
- `"event"` — dispatch the `AgentHarnessEvent` to the session's event handler via the `tokenBatcher` and session actions
- `"error"` — set the session's streaming error and finalize the turn
- `"push"` — channel `"terminal.data"` appends data to a terminal store; `"terminal.exit"` sets the exit code
- `"permission.asked"` — set the session's permission pending state
- `"permission.replied"` — clear the session's permission pending state

The client SHALL support `disconnect()` with `shouldReconnect = false` to prevent reconnection loops, and SHALL clean up all batchers and timers. On reconnect, the `reconnectAttempts` counter SHALL reset to 0 after a successful open.

#### Scenario: WebSocket connects and sets status

- **WHEN** `createWsClient` is called
- **THEN** a WebSocket connection is established to the server's WS endpoint
- **AND** the connection status is set to `"connecting"`
- **WHEN** the socket opens
- **THEN** the status becomes `"open"` and reconnect attempts are reset to 0

#### Scenario: agent events dispatch to session store

- **WHEN** a `"event"` frame arrives with a known session ID
- **THEN** the `AgentHarnessEvent` is dispatched to the session's registered handler
- **AND** the streaming status (`isStreaming`) is updated based on `agent_start`/`agent_end` events

#### Scenario: terminal data is pushed via WS

- **WHEN** a `"push"` frame with channel `"terminal.data"` arrives
- **THEN** the data is appended to the corresponding terminal store

#### Scenario: permission asked/replied updates session state

- **WHEN** a `"permission.asked"` frame arrives
- **THEN** the session store's `permission` field is set with the permission details
- **WHEN** a `"permission.replied"` frame arrives
- **THEN** the session store's `permission` field is cleared

#### Scenario: error frame sets session error

- **WHEN** an `"error"` frame arrives
- **THEN** the session's current streaming message gets the error
- **AND** the turn is finalized

#### Scenario: reconnect with exponential backoff

- **WHEN** the WebSocket closes and `shouldReconnect` is `true`
- **THEN** the status is set to `"closed"`
- **AND** after `1000 * 2^attempt ms` (max 30s), a new connection is attempted
- **AND** `reconnectAttempts` is incremented

#### Scenario: disconnect prevents reconnection

- **WHEN** `disconnect()` is called
- **THEN** `shouldReconnect` becomes `false`
- **AND** any pending reconnect timer is cleared
- **AND** all batchers are disposed
- **AND** the socket is closed

### Requirement: Actions facade

The `Actions` facade SHALL expose all renderer→server operations as async functions. Each action SHALL use the Hono RPC client for REST calls and the WsClient for real-time calls. Errors SHALL be caught and surfaced via `setLastError`. The actions SHALL include:

- `loadProjects()` / `addProject(cwd)` — project CRUD
- `loadSessions(projectId)` / `createSession(projectId, title?, changeName?, worktreePath?)` / `renameSession(sessionId, title)` / `deleteSession(sessionId)` — session CRUD
- `createChildPlan(projectId)` / `listChildPlans(projectId)` — plan session lifecycle
- `loadMessages(sessionId)` — load flat message history
- `loadChat(sessionId)` — load turn-based chat with pending transition re-derivation
- `loadIntermediates(sessionId, turnId)` / `evictIntermediates(sessionId, turnId)` — lazy intermediate loading
- `sendPrompt(sessionId, text)` — submit user message via WS, setting pending transition state
- `abortRun(sessionId)` — abort via WS
- `steerRun(sessionId, text)` / `followUpRun(sessionId, text)` — run steering via WS
- `confirmTransition(sessionId, to, body, action)` — gate approval/rejection via REST, mirroring server state (status, changeName, worktreePath) to the local store
- `replyPermission(sessionId, id, reply)` — respond to permission requests via WS
- `selectProfile(sessionId, profileId)` — update session profile via REST

#### Scenario: sendPrompt clears pending transition and starts a turn

- **WHEN** `sendPrompt(sessionId, text)` is called
- **THEN** any pending transition is cleared locally
- **AND** if the session meta has a pending transition, the server-side state is also cleared via `updateSession`
- **AND** a user message `UIMessage` is created
- **AND** `startTurn` is called on the session store
- **AND** the streaming phase is set to `"thinking"`
- **AND** a `{ type: "prompt", sessionId, message }` frame is sent via WS

#### Scenario: confirmTransition mirrors server state

- **WHEN** `confirmTransition(sessionId, to, body, "approve")` returns `{ ok: true }`
- **THEN** the session meta's status, changeName, and worktreePath are updated from the response
- **AND** `pendingTransitionTo` and `pendingTransitionBody` are cleared
- **WHEN** the response includes `instruction`
- **THEN** it is returned for the caller to display

#### Scenario: loadChat re-derives pending transitions from server

- **WHEN** `loadChat(sessionId)` loads a session with `pendingTransitionTo` and `pendingTransitionBody`
- **THEN** the session store's pending transition is set from those values
- **AND** the confirm card survives page reload

#### Scenario: REST errors surface via setLastError

- **WHEN** any REST call returns a non-OK status or throws
- **THEN** `setLastError` is called with a descriptive error message
- **AND** the action returns `undefined` or `false` as appropriate
