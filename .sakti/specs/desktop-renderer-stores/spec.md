# desktop-renderer-stores Specification

## Purpose

The desktop-renderer-stores capability provides all client-side state management for the renderer. It includes the server store (project/session metadata), the session store (per-chat streaming, turns, messages), the LRU-capped `SessionRegistry`, the `TerminalStore` and `TerminalRegistry`, workspace tab stores (project tabs, session tabs), UI signals (layout, streaming, errors), the token batcher for collapsing high-frequency text deltas, and usage/aggregation utilities for token and cost display.

## Requirements

### Requirement: Server store

The server store SHALL be a SolidJS store holding server-sourced metadata: a map of `Project` objects, a map of `SessionMeta` objects, ordered ID arrays (`projectOrder`, `sessionOrder`), the active project and session IDs, and the WebSocket connection status (`"connecting" | "open" | "closed"`). The store SHALL expose actions for add/set/remove of projects and sessions, activation, connection status, and session patching. Session state SHALL use a `SessionMeta` shape including `id`, `projectId`, `kind` (`"plan" | "mission"`), `status`, `title`, `changeName`, `worktreePath`, `profileId`, `modelId`, `thinkingLevel`, `parentSessionId`, `pendingTransitionTo`, `pendingTransitionBody`, and timestamps.

#### Scenario: projects are set with reconciliation

- **WHEN** `setProjects` is called with a list of projects
- **THEN** the projects map is reconciled (added/removed/updated in place)
- **AND** `projectOrder` is set to the new order
- **AND** if `activeProjectId` is `null` and projects exist, the first project becomes active

#### Scenario: session is added and removed

- **WHEN** `addSession` is called
- **THEN** the session is added to the sessions map and appended to `sessionOrder`
- **WHEN** `removeSession` is called
- **THEN** the session is deleted from the map and filtered from `sessionOrder`

#### Scenario: session is patched

- **WHEN** `updateSession` is called with a partial `SessionMeta` patch
- **THEN** the matching session's fields are merged with the new values

### Requirement: Session store

Each session SHALL have a per-session `SessionStore` created via `createSessionStore()`. The store SHALL hold: an array of `Turn` objects, a `StreamState` (current message ID, current tool name, phase, started-at timestamp, token count), optional `PendingTransition`, `PermissionPending`, `RetryState`, and `OmWindowState`.

#### Scenario: new turn starts

- **WHEN** `startTurn` is called with a user message
- **THEN** a new `Turn` is appended with `working: true`, `endedAt: null`, and the user message
- **AND** the streaming state phase is set

#### Scenario: assistant message becomes the summary

- **WHEN** `addAssistantMessage` is called
- **THEN** any existing summary is demoted into `intermediates`
- **AND** the new message becomes the turn's `summary`
- **AND** the message ID is indexed for O(1) lookup

#### Scenario: text tokens are appended in-place

- **WHEN** `appendTextToken` is called with `(msgId, delta)`
- **THEN** the delta is appended to the message's `content` and to the last text `MessagePart`
- **AND** the streaming token count is incremented

#### Scenario: thinking tokens are appended in-place

- **WHEN** `appendThinkingToken` is called
- **THEN** the delta is appended to the last thinking part if one exists
- **OR** a new thinking part is pushed after finalizing the previous part

#### Scenario: tool call part is tracked

- **WHEN** `addToolCall` is called
- **THEN** a `tool_call` part is pushed with status `"running"`
- **WHEN** `completeToolCall` is called
- **THEN** the matching tool call part's status is set to `"done"` or `"error"` with the result

#### Scenario: OM markers are added and updated

- **WHEN** `addOmMarker` is called
- **THEN** a `om_marker` part is pushed with the given cycle ID, operation type, and status
- **WHEN** `updateOmMarker` is called for an existing cycle ID
- **THEN** the matching marker's fields are merged without creating duplicates

#### Scenario: message is finalized

- **WHEN** `finalizeMessage` is called
- **THEN** the last part's `isStreaming` is set to `false`
- **AND** the message's `isStreaming` is set to `false`
- **AND** if usage is provided, it is set on the message

#### Scenario: turn is finalized

- **WHEN** `finalizeTurn` is called with an ended-at timestamp
- **THEN** the working turn's `endedAt` is set and `working` becomes `false`

#### Scenario: turns are loaded from REST

- **WHEN** `loadTurns` is called with a `Turn[]`
- **THEN** the turns array is reconciled and the message location index is rebuilt

#### Scenario: intermediates are lazy-loaded and evicted

- **WHEN** `loadIntermediates` is called for a turn
- **THEN** the turn's `intermediates` are set, `intermediatesLoaded` becomes `true`
- **WHEN** `evictIntermediates` is called
- **THEN** the intermediates are cleared, `intermediatesLoaded` becomes `false`, and the location index entries are removed

#### Scenario: store resets cleanly

- **WHEN** `reset` is called
- **THEN** turns, pending transition, permission, retry, streaming state, and OM status are all cleared
- **AND** the message location index is cleared

### Requirement: Session message types

Messages in the renderer SHALL use a `UIMessage` type with `id`, `role`, `content`, `parts` (array of `MessagePart`), `isStreaming`, `timestamp`, optional `error`, and optional `usage`. `MessagePart` SHALL be a discriminated union of `text` (plain text content), `tool_call` (tool name, ID, input, status, result, details), `thinking` (hidden reasoning text with started/ended timestamps), and `om_marker` (oh-my-pi lifecycle cycle with operation type, status, timing, and context fields).

#### Scenario: AgentMessage is converted to UIMessage

- **WHEN** an `AgentMessage` from the server is converted via `agentMessageToUI`
- **THEN** user and assistant messages produce a `UIMessage` with a single text part
- **AND** assistant usage (input, output, cost, reasoningTokens) is extracted when present
- **AND** unknown roles produce an empty system message

### Requirement: SessionRegistry (LRU)

The `SessionRegistry` SHALL manage per-session stores with LRU eviction at a configurable cap (default 3). `get(sessionId)` SHALL create a store via `createRoot` (for SolidJS reactive disposal) on first access and refresh recency by re-inserting the entry at the end of the insertion-order map. When the cap is exceeded, the least-recently-used store SHALL be disposed (reactive root torn down, history dropped). The caller SHALL be responsible for re-loading history on subsequent access.

#### Scenario: get-or-create with LRU eviction

- **WHEN** `get` is called for an uncached session
- **THEN** a new `SessionStore` is created under a `createRoot` disposer
- **AND** if the cache exceeds the cap, the oldest store is disposed

#### Scenario: access refreshes recency

- **WHEN** `get` is called for an already-cached session
- **THEN** the session is moved to the most-recently-used position
- **AND** it survives eviction even if the cap is exceeded

#### Scenario: dispose removes a single session

- **WHEN** `dispose(sessionId)` is called
- **THEN** the store's reactive root is torn down
- **AND** the entry is removed from the map

### Requirement: Terminal store and registry

The `TerminalStore` SHALL hold a string buffer (capped at 512K characters, trimming to the last 256K when exceeded), `exitCode`, `cols`, and `rows`. It SHALL expose `appendData` (appends to buffer with trimming), `setExit`, `resize` (cols/rows), and `reset`. The `TerminalRegistry` SHALL manage terminal stores similarly to `SessionRegistry` (createRoot, disposable) but without LRU eviction — all terminals persist until explicitly disposed or the registry is disposed.

#### Scenario: terminal buffer is trimmed at capacity

- **WHEN** `appendData` causes buffer length to exceed 512K characters
- **THEN** the buffer is trimmed to the last 256K characters

#### Scenario: terminal registry disposes all

- **WHEN** `disposeAll` is called
- **THEN** all terminal roots are torn down and the registry is cleared

### Requirement: Workspace tab stores

The system SHALL maintain two independent tab systems persisted to localStorage:

**Project tabs** (`project-tab-store`): A signal-based store with an ordered array of `ProjectTab` entries (each having a `projectId` or `page: "settings"`) and an active index. Tab state is persisted as `sakti-project-tabs`. Operations include `openProjectTab`, `closeProjectTab`, `switchProjectTab`, `openSettingsTab`, `newProjectTab`, `transformProjectTab`, and `filterStaleProjects`.

**Session tabs** (`session-tab-store`): A per-project store with an ordered array of `SessionTab` entries (each with `kind: "home" | "plan" | "mission"` and optional `sessionId`), keyed by project ID in a single record persisted as `sakti-session-tabs`. The first tab is always `{ kind: "home", sessionId: null }`. Operations include `openSessionTab`, `closeSessionTab`, `switchSessionTab`, `openDraftPlanTab`, `promoteDraftPlan`, and `filterStaleSessions`.

#### Scenario: project tabs persist to localStorage

- **WHEN** a project tab is opened or closed
- **THEN** the state is saved to `localStorage` key `"sakti-project-tabs"`
- **AND** on page reload, the saved tabs are restored

#### Scenario: home tab is always first and non-closable

- **WHEN** session tabs are initialized for a project
- **THEN** the first tab is always `{ kind: "home", sessionId: null }`
- **WHEN** `closeSessionTab` is called with index 0
- **THEN** it is a no-op (home tab cannot be closed)

#### Scenario: draft plan tab is promoted after creation

- **WHEN** `openDraftPlanTab` is called
- **THEN** a plan tab with `sessionId: null` is opened
- **WHEN** `promoteDraftPlan` is called with the created session ID
- **THEN** the draft tab's `sessionId` is updated

#### Scenario: stale tabs are filtered

- **WHEN** `filterStaleProjects` is called
- **THEN** project tabs with project IDs not in the valid set are reset to `{ projectId: null }`
- **WHEN** `filterStaleSessions` is called
- **THEN** session tabs with session IDs not in the valid set are removed

### Requirement: UI signals

The system SHALL expose signal-based UI state: `sidebarOpen` (boolean), `activeView` (`"chat" | "terminal" | "git"`), `isStreaming` (boolean), `lastError` (nullable string), `healthIssues` (array of `{ message, type }`), `updateAvailable` (boolean), and `updateVersion` (nullable string).

#### Scenario: streaming status is set during agent runs

- **WHEN** an `agent_start` WebSocket event arrives
- **THEN** `isStreaming` is set to `true`
- **WHEN** `agent_end` or `abort` events arrive
- **THEN** `isStreaming` is set to `false`

### Requirement: Token batcher

The `createTokenBatcher` SHALL batch text deltas by message ID via `queueMicrotask`, collapsing N synchronous `append` calls into a single callback per message per microtask. When `{ batch: false }` is passed, each `append` SHALL flush synchronously.

#### Scenario: deltas are batched per microtask

- **WHEN** `append("msg1", "a")` and `append("msg1", "b")` are called synchronously
- **THEN** the callback fires once with `("msg1", "ab")` on the next microtask

#### Scenario: no batching when disabled

- **WHEN** `createTokenBatcher` is created with `{ batch: false }`
- **THEN** each `append` fires the callback synchronously

### Requirement: Usage statistics

The `aggregateUsage` function SHALL sum `cost`, `input`, `output`, and `reasoningTokens` across all assistant messages in a turn array. `formatTokens` SHALL format token counts with thousands abbreviations ("1.2k", "12k"). `formatCost` SHALL format USD compactly ("$0", "$0.0012", "$1.23").

#### Scenario: usage is aggregated across turns

- **WHEN** `aggregateUsage` receives turns with usage data
- **THEN** it returns the sum of all assistant message costs, input tokens, output tokens, and reasoning tokens
