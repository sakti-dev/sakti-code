# Antigravity Chat UI - Task Tracker

## Phase 1: Type System & Data Model

- [ ] Add `AgentMode` type (`"planning" | "build" | "chat"`)
- [ ] Add `AgentEventKind` type (including `reasoning` event)
- [ ] Add `AgentEventAction` type (open-file, open-diff, open-terminal)
- [ ] Add `AgentEvent` interface (canonical event model)
- [ ] Add `ReasoningPart` interface (matches OpenCode's schema)
- [ ] Add `RunCardData`, `RunFileData`, `RunGroupData` interfaces
- [ ] Add `ActionData`, `TerminalData`, `ThoughtData` interfaces
- [ ] Add `ChatMessageMetadata` interface (mode, runId, timestamps)
- [ ] Update `ChatUIMessage` generic with new data part types

## Phase 2: Server-Side Streaming Updates

### 2.0 AgentProcessor Reasoning Events (core package)

- [ ] Add `reasoning-start`, `reasoning-delta`, `reasoning-end` to AgentEvent type
- [ ] Add `reasoning-start` handler in `processStream()` switch
- [ ] Add `reasoning-delta` handler in `processStream()` switch
- [ ] Add `reasoning-end` handler in `processStream()` switch
- [ ] Track reasoning start time for duration calculation

### 2.1 Server Chat Streaming (server package)

- [ ] Add `mode` field to `chatMessageSchema` in `chat.ts`
- [ ] Create `toolToEventKind()` mapper function
- [ ] Handle `reasoning-start/delta/end` events → `data-thought` parts
- [ ] Stream `data-run` parts for planning mode
- [ ] Stream `data-action` parts for build mode
- [ ] Stream `data-terminal` parts for bash commands
- [ ] Set message metadata with mode, runId, timestamps, usage

## Phase 3: Client Store Updates

- [ ] Add `events: { order, byId }` to `ChatState`
- [ ] Add `reasoning: { byId }` to `ChatState` for active reasoning
- [ ] Implement `addEvent()`, `updateEvent()`, `getEventsArray()` methods
- [ ] Update stream parser for `data-thought` (reasoning) parts
- [ ] Update stream parser for `data-run` parts
- [ ] Update stream parser for `data-action` parts
- [ ] Update stream parser for `data-terminal` parts

## Phase 4: Design System

- [ ] Create `design-tokens.css` with Antigravity color palette
- [ ] Add color tokens: `--ag-bg`, `--ag-surface`, `--ag-accent`, etc.
- [ ] Import design tokens in main `index.css`
- [ ] Create `.glass-card`, `.action-row` utility classes

## Phase 5: Component Implementation

### Mode Router

- [ ] Create `AssistantMessage` component (mode router)

### Run Card (Planning Mode)

- [ ] Create `run-card/index.tsx` - Main RunCard component
- [ ] Create `run-card/run-header.tsx` + status-chip
- [ ] Create `run-card/files-section.tsx` + file-row
- [ ] Create `run-card/progress-section.tsx` + progress-group + progress-item

### Activity Feed (Build Mode)

- [ ] Create `activity-feed/index.tsx` - Main component
- [ ] Create `activity-feed/action-row.tsx` - Generic action
- [ ] Create `activity-feed/terminal-card.tsx` - Terminal output
- [ ] Create `activity-feed/thought-indicator.tsx` - "Thought for Ns"
- [ ] Create `activity-feed/error-row.tsx` - Error display

### Tool-Specific Renderers

- [ ] Create icon mapping for `AgentEventKind`
- [ ] Implement file/terminal/reasoning event rows

## Phase 6: Integration

- [ ] Update `MessageList` to use `AssistantMessage`
- [ ] Update `MessageParts` with new data part handlers
- [ ] Connect components to store state

## Phase 7: Polish

- [ ] Wire Electron IPC for file/diff/terminal actions
- [ ] Implement collapse toggles for groups
- [ ] Add hover/animation transitions
- [ ] Remove per-delta logging from parser

## Verification

- [ ] TypeScript compiles without errors
- [ ] Planning mode renders Run Card
- [ ] Build mode renders Activity Feed
- [ ] "Thought for Ns" appears during/after reasoning
- [ ] File/terminal actions trigger Electron IPC
- [ ] Streaming is smooth at high event rates
