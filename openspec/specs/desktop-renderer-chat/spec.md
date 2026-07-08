# desktop-renderer-chat Specification

## Purpose

The desktop-renderer-chat capability provides the chat interface for both plan and mission sessions. It includes the `MissionChatView` (mission chat with transition gate and archive state), `PlanChat` (onboarding chat with draft → plan → mission graduation), the `ChatInput` with chip-based composition, slash/at context menus, permission strip, profile selection, and retry banner, the `MessageTimeline` with collapsible turns and step-by-step streaming, a pluggable part registry for rendering `text`, `tool_call`, `om_marker`, and `transition` message parts, and the WebSocket event handler dispatch that transforms raw `AgentHarnessEvent` values into store mutations.

## Requirements

### Requirement: Mission chat view

The `MissionChatView` SHALL load the session's chat history on mount via `actions.loadChat(sessionId)`. It SHALL render the `MessageTimeline` for the session's turns, a `TransitionCard` when a pending transition exists, and the `ChatInput`. When the session status is `"done"`, the chat input SHALL be replaced by a message stating the mission was archived, the worktree was removed, and the branch is retained for merge/review.

#### Scenario: chat loads on mount

- **WHEN** `MissionChatView` mounts with a session ID
- **THEN** `actions.loadChat(sessionId)` is called to fetch turn history

#### Scenario: transition card blocks input

- **WHEN** a pending transition exists
- **THEN** a `TransitionCard` is shown above the input area
- **WHEN** the user clicks "Approve" on the card
- **THEN** `actions.confirmTransition` is called
- **AND** on success the pending transition is cleared
- **AND** if the response includes an instruction, it is auto-sent as a WS prompt to start the next phase agent

#### Scenario: done status hides input

- **WHEN** session status is `"done"`
- **THEN** the chat input area is replaced by a message indicating completion
- **AND** the change name is shown in the message

### Requirement: Plan chat view

The `PlanChat` SHALL support two modes: a draft mode (`sessionId: null`) where the first user message creates a child plan session, and an active mode where it loads the existing plan session's chat. In draft mode, `handleDraftSend` SHALL call `createChildPlan`, apply any pre-selected draft profile, promote the draft tab, and send the prompt. In active mode with a pending transition, `handleConfirmSession` SHALL call `confirmTransition`, read the resulting `changeName` and `worktreePath` from the server, create a new mission session carrying those values, close the plan tab, open the mission tab, and send the mission brief as an initial prompt.

#### Scenario: draft send creates a child plan

- **WHEN** the user sends a message in draft mode
- **THEN** `actions.createChildPlan(projectId)` is called
- **AND** the draft profile is applied to the new session
- **AND** the draft tab is promoted with the new session ID
- **AND** the message is sent to the new session

#### Scenario: plan confirm graduates to mission

- **WHEN** the user approves a plan→mission transition
- **THEN** `actions.confirmTransition` is called
- **AND** on success, `changeName` and `worktreePath` are read from the plan session's server-side meta
- **AND** a new mission session is created with those values
- **AND** the plan session's profile is carried over
- **AND** the plan tab is closed, the mission tab is opened
- **AND** the pending transition body is sent as the first mission prompt

### Requirement: Message timeline

The `MessageTimeline` SHALL render a chronologically-ordered list of turns. Each `SessionTurn` SHALL show the user message, any intermediate assistant messages (collapsed by default with a count badge for lazy loading), and the final summary. Intermediates SHALL be loaded on demand via `actions.loadIntermediates` when the user expands the collapsed section, and evicted via `actions.evictIntermediates` when collapsed. The timeline SHALL auto-scroll to the latest turn when new content arrives, and track visibility for sticky scrolling.

#### Scenario: turns render chronologically

- **WHEN** turns are loaded into the timeline
- **THEN** they render in chronological order with the most recent at the bottom

#### Scenario: intermediates are lazy-loaded

- **WHEN** a turn has `intermediateCount > 0` and `intermediatesLoaded === false`
- **THEN** a collapsible badge shows the count
- **WHEN** the user expands it
- **THEN** `actions.loadIntermediates(sessionId, turnId)` is called
- **WHEN** the user collapses it
- **THEN** `actions.evictIntermediates(sessionId, turnId)` is called

### Requirement: Pluggable part rendering

Message parts SHALL be rendered via a registry of `PartComponent` functions keyed by `MessagePart.type`. The default registry SHALL register `"text"` (plain markdown content), `"tool_call"` (collapsible tool invocation with input, output, status), and `"om_marker"` (oh-my-pi lifecycle indicators). The `MessagePart` component SHALL look up the registered component by type and render it, or render nothing if unregistered.

#### Scenario: text parts render markdown

- **WHEN** a `text` part is encountered
- **THEN** it is rendered with markdown formatting via the registered `TextPart` component

#### Scenario: tool call parts show lifecycle

- **WHEN** a `tool_call` part is encountered
- **THEN** it is rendered with tool name, status ("running", "done", "error"), input, and result
- **AND** the component supports collapsible details

#### Scenario: OM markers render lifecycle indicators

- **WHEN** an `om_marker` part is encountered
- **THEN** it is rendered with the operation type (observation, reflection, buffering), status, and optional timing/token data

### Requirement: Transition card

The `TransitionCard` SHALL render a styled card for gate pauses with a title, the handoff body (collapsible expandable preformatted text), and approve/reject buttons. The card's presentation SHALL vary by destination phase: "Proposed Mission" → "Create"/"Revise" for `mission`, "Proposed Spec" → "Approve"/"Revise" for `build`, "Ready to Archive" → "Archive"/"Request changes" for `archive`, and "Archive Complete" → "Finish & Remove Worktree"/"Keep" for `done`.

#### Scenario: card renders per destination phase

- **WHEN** a transition card shows for `to: "mission"`
- **THEN** the title is "Proposed Mission" with a clipboard icon
- **WHEN** a transition card shows for `to: "build"`
- **THEN** the title is "Proposed Spec" with a file-text icon
- **WHEN** a transition card shows for `to: "archive"`
- **THEN** the title is "Ready to Archive" with an archive icon

### Requirement: Chat input with chip composition

The `ChatInput` SHALL provide a chip-based input field (`ChipInput`) that supports:
- Free text input
- Slash commands (`/`) triggering a `ContextMenu` that fetches available commands and skills from the server via `GET /api/projects/:id/context`
- At-mentions (`@`) triggering a file picker menu with debounced (120ms) search via `GET /api/projects/:id/files?query=`
- Enter to submit, Shift+Enter for newlines
- A send button with visual feedback during generation
- A `ProfileSelect` dropdown for per-session model profile selection
- An `InputFooter` showing character count and aggregated token/cost statistics

#### Scenario: slash commands fetch project context

- **WHEN** the user types `/` in the input
- **THEN** a context menu appears with available commands and skills
- **AND** `GET /api/projects/:id/context` is fetched on project load

#### Scenario: at-mentions search files

- **WHEN** the user types `@` in the input
- **THEN** a file picker appears with debounced search
- **AND** `GET /api/projects/:id/files?query=` is called 120ms after the last keystroke

#### Scenario: permission strip blocks input

- **WHEN** a permission request is pending for the session
- **THEN** a `PermissionStrip` renders above the input with Allow/Deny buttons
- **WHEN** the user clicks Allow or Deny
- **THEN** `actions.replyPermission` is called with the response

#### Scenario: retry banner shows retry progress

- **WHEN** a retry is in progress
- **THEN** a retry banner renders above the input showing the error message, countdown timer, attempt number, max attempts, and a Cancel button
- **WHEN** Cancel is clicked
- **THEN** `actions.abortRun` is called

#### Scenario: profile select changes model profile

- **WHEN** the user selects a profile from the dropdown
- **THEN** `actions.selectProfile(sessionId, profileId)` is called

#### Scenario: token/cost stats display in footer

- **WHEN** the session has at least one assistant turn with usage data
- **THEN** the footer shows aggregated input/output token counts and cost

### Requirement: Event handler dispatch

The system SHALL register typed event handlers for all `AgentHarnessEvent` types on module import. The dispatch `ensureHandlersRegistered` SHALL be called once and register handlers for lifecycle events, message events, tool events, oh-my-pi events, and retry events. Each handler SHALL mutate the session store via the provided `HandlerContext` (containing session actions, token batcher, and store).

#### Scenario: lifecycle handlers process start/end/abort

- **WHEN** an `agent_start` event arrives
- **THEN** a new assistant message is started and the streaming phase is set
- **WHEN** an `agent_end` event arrives
- **THEN** the final message is finalized, the turn end-time is set, and usage is extracted
- **WHEN** an `abort` event arrives
- **THEN** the turn is finalized with the current state

#### Scenario: message handlers process text/thinking deltas

- **WHEN** a `text_delta` event arrives
- **THEN** the delta is appended to the current message via the token batcher
- **WHEN** a `thinking_delta` event arrives
- **THEN** the delta is appended as a thinking token

#### Scenario: tool handlers track call lifecycle

- **WHEN** a `tool_call_start` event arrives
- **THEN** a tool call part is added with status "running"
- **WHEN** a `tool_call_end` event arrives
- **THEN** the tool call part is completed with result (or error)
- **WHEN** a `tool_call_delta` event arrives
- **THEN** the delta is streamed into the tool call

#### Scenario: OM handlers process observation cycle events

- **WHEN** an `om_cycle_start` event arrives
- **THEN** an OM marker is added with the cycle ID
- **WHEN** an `om_cycle_end` event arrives
- **THEN** the marker is updated with completion status and token counts

#### Scenario: retry handlers show/hide retry banner

- **WHEN** an `auto_retry_start` event arrives
- **THEN** the session's retry state is set with attempt number, delay, error message, and max attempts
- **WHEN** an `auto_retry_end` event arrives
- **THEN** the retry state is cleared
