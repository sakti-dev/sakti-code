# Antigravity-Level Chat UI Implementation Plan

## Overview

This plan transforms the current chat UI into a **dual-mode Antigravity-style interface** with:

1. **Planning Mode** → Aggregated "Run Card" UI (single evolving block)
2. **Build Mode** → Chronological "Activity Feed" UI (flat timeline)

Both modes share the same underlying event stream; only the rendering differs.

---

## Current State Analysis

### What We Have ✅

- **O(1) message store** (`store.ts`) - Already optimized with `{order, byId}` normalized structure
- **AI SDK v6 UIMessage streaming** - Server uses `createUIMessageStream` + `createUIMessageStreamResponse`
- **Custom data parts** - `data-rlm-state`, `data-progress`, `data-permission`, `data-session`
- **Basic message rendering** - `MessageBubble`, `MessageList`, `MessageParts` components
- **Tool call/result rendering** - `ToolCallPart`, `ToolResultPart`, `ToolCallBlock`

### What's Missing ❌

- **Mode metadata** - No `mode: "planning" | "build"` on messages
- **Run Card component** - No aggregated planning view
- **Activity Feed component** - No chronological build view
- **Agent Event data parts** - No `data-run`, `data-action`, `data-terminal`
- **"Thought for Ns" timing** - No gap detection for thinking indicators
- **Files Edited tracking** - No file change aggregation
- **Progress Groups** - No grouped progress updates
- **Design tokens** - No Antigravity dark glass styling system

---

## Tool & Agent Mapping (from `packages/core/src`)

### Agents Available

| Agent     | Mode     | Model          | Purpose                          |
| --------- | -------- | -------------- | -------------------------------- |
| `build`   | primary  | glm-4.7        | Main agent for user-facing tasks |
| `explore` | subagent | glm-4.7-flashx | Read-only codebase exploration   |
| `plan`    | subagent | glm-4.7        | Implementation planning          |

### AgentEvent Types (from `agent/workflow/types.ts`)

```typescript
AgentEvent =
  | { type: "text", text: string, agentId: string }
  | { type: "tool-call", toolCallId: string, toolName: string, args: any, agentId: string }
  | { type: "tool-result", toolCallId: string, toolName: string, result: any, agentId: string }
  | { type: "finish", finishReason: string, agentId: string }
  | { type: "error", error: string, agentId: string }
```

### Tool → UI Action Mapping

| Tool                       | Category    | UI Event Kind | Icon        | Actions              |
| -------------------------- | ----------- | ------------- | ----------- | -------------------- |
| **Filesystem (Read-only)** |
| `read`                     | filesystem  | `analyzed`    | 📄 Search   | Open file            |
| `ls`                       | filesystem  | `analyzed`    | 📁 Folder   | —                    |
| `glob`                     | filesystem  | `analyzed`    | 🔍 Search   | —                    |
| `grep`                     | search      | `analyzed`    | 🔍 Search   | Open file + line     |
| `ast-query`                | search-docs | `analyzed`    | 🌳 Tree     | Open file + range    |
| `grep-search`              | search-docs | `analyzed`    | 🔍 Search   | Open file + range    |
| `file-read-docs`           | search-docs | `analyzed`    | 📄 File     | Open file            |
| `search-docs`              | search-docs | `analyzed`    | 📚 Docs     | —                    |
| `webfetch`                 | search      | `analyzed`    | 🌐 Globe    | Open URL             |
| **Filesystem (Write)**     |
| `write`                    | filesystem  | `created`     | ➕ Plus     | Open file, Open diff |
| `edit`                     | filesystem  | `edited`      | ✏️ Pencil   | Open file, Open diff |
| `multiedit`                | filesystem  | `edited`      | ✏️ Pencil   | Open file, Open diff |
| `apply_patch`              | filesystem  | `edited`      | 🔧 Wrench   | Open file, Open diff |
| **Shell**                  |
| `bash`                     | shell       | `terminal`    | 💻 Terminal | Open terminal        |
| **AI/Meta**                |
| `sequentialthinking`       | thinking    | `thought`     | 🧠 Brain    | —                    |
| `task`                     | subagent    | `note`        | 🤖 Bot      | —                    |

### AI SDK Reasoning Events → "Thought for Ns" Display

> [!IMPORTANT]
> The `reasoning` part type comes from the **AI SDK's `fullStream`**, NOT from the `sequentialthinking` tool. This is how OpenCode implements "Thinking..." displays.

**Current Gap in ekacode:**
The `AgentProcessor` in `packages/core/src/session/processor.ts` only handles:

- `text-delta` → text
- `tool-call` → tool-call event
- `tool-result` / `tool-error` → tool-result event
- `finish` / `error`

**Missing handlers (need to add):**

- `reasoning-start` → Create new reasoning part
- `reasoning-delta` → Append to reasoning text
- `reasoning-end` → Finalize reasoning part

**OpenCode's `ReasoningPart` schema (from `message-v2.ts`):**

```typescript
export const ReasoningPart = PartBase.extend({
  type: z.literal("reasoning"),
  text: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
  time: z.object({
    start: z.number(),
    end: z.number().optional(),
  }),
});
```

**UI Display:**

- During streaming: Show "Thinking..." spinner with partial text
- After completion: Show thinking duration ("Thought for 3s") + collapsible content

### Subagent (Task Tool) Events

When `task` tool is called, it spawns a subagent. The UI should show:

- **Build mode**: "Spawned explore subagent: Analyzing codebase structure..."
- **Planning mode**: Progress group titled with subagent description

Subagent types: `explore`, `plan`, `general`

---

## Phase 1: Type System & Data Model

### 1.1 Extend `ui-message.ts` with Agent Event Types

#### [MODIFY] [ui-message.ts](file:///home/eekrain/CODE/ekacode/apps/desktop/src/types/ui-message.ts)

Add the canonical `AgentEvent` model and new data part types:

```typescript
// Agent mode determines which UI composition to render
export type AgentMode = "planning" | "build" | "chat";

// Canonical event kinds (shared across modes)
export type AgentEventKind =
  | "thought"
  | "note"
  | "analyzed"
  | "created"
  | "edited"
  | "deleted"
  | "terminal"
  | "error"
  | "tool";

// Event action types for user interaction
export type AgentEventAction =
  | { type: "open-file"; path: string }
  | { type: "open-diff"; path: string }
  | { type: "open-terminal"; id: string };

// Canonical agent event (used in both modes)
export interface AgentEvent {
  id: string;
  ts: number;
  kind: AgentEventKind;
  title: string;
  subtitle?: string;
  file?: { path: string; range?: string };
  diff?: { plus: number; minus: number };
  terminal?: {
    command: string;
    cwd?: string;
    outputPreview: string;
    exitCode?: number;
    background?: boolean;
  };
  error?: { message: string; details?: string };
  actions?: AgentEventAction[];
}

// Planning mode: Run Card state
export interface RunCardData {
  runId: string;
  title: string;
  subtitle?: string;
  status: "planning" | "executing" | "done" | "error";
  filesEditedOrder: string[];
  groupsOrder: string[];
  collapsedAll?: boolean;
}

// Planning mode: File entry
export interface RunFileData {
  path: string;
  tag?: "Task" | "Implementation Plan" | "Doc" | "Code";
  diff?: { plus: number; minus: number };
  cta?: "open" | "open-diff";
}

// Planning mode: Progress group
export interface RunGroupData {
  index: number;
  title: string;
  collapsed: boolean;
  itemsOrder: string[];
}

// Build mode: Action row
export interface ActionData extends AgentEvent {
  // Same as AgentEvent, used directly in build mode feed
}

// Message metadata for mode selection
export interface ChatMessageMetadata {
  mode: AgentMode;
  runId?: string;
  startedAt?: number;
  firstSignificantUpdateAt?: number;
  finishedAt?: number;
  elapsedMs?: number;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}
```

### 1.2 Extend `ChatUIMessage` type definition

Update the existing type to include new data parts:

```typescript
export type ChatUIMessage = UIMessage<
  never,
  {
    // Existing
    "data-rlm-state": RLMStateData;
    "data-progress": ProgressData;
    "data-permission": PermissionRequestData;
    "data-session": SessionData;
    // NEW: Planning mode
    "data-run": RunCardData;
    "data-run-file": RunFileData;
    "data-run-group": RunGroupData;
    "data-run-item": AgentEvent;
    // NEW: Build mode
    "data-action": ActionData;
    "data-terminal": TerminalData;
    "data-thought": ThoughtData;
  }
>;
```

---

## Phase 2: Server-Side Streaming Updates

### 2.0 Add Reasoning Event Handlers to AgentProcessor

#### [MODIFY] [processor.ts](file:///home/eekrain/CODE/ekacode/packages/core/src/session/processor.ts)

Add handlers for AI SDK reasoning stream events in `processStream()`:

```typescript
// Add to AgentEvent type in types.ts
| { type: "reasoning-start", reasoningId: string, agentId: string }
| { type: "reasoning-delta", reasoningId: string, text: string, agentId: string }
| { type: "reasoning-end", reasoningId: string, durationMs: number, agentId: string }

// Add to processStream switch statement:
case "reasoning-start":
  this.emitEvent({
    type: "reasoning-start",
    reasoningId: chunk.id,
    agentId: this.config.id,
  });
  break;

case "reasoning-delta":
  this.emitEvent({
    type: "reasoning-delta",
    reasoningId: chunk.id,
    text: chunk.text,
    agentId: this.config.id,
  });
  break;

case "reasoning-end":
  this.emitEvent({
    type: "reasoning-end",
    reasoningId: chunk.id,
    durationMs: Date.now() - reasoningStartTime,
    agentId: this.config.id,
  });
  break;
```

### 2.1 Add Mode to Chat Request/Response

#### [MODIFY] [chat.ts](file:///home/eekrain/CODE/ekacode/packages/server/src/routes/chat.ts)

Extend the chat schema and stream writer to support mode:

```typescript
const chatMessageSchema = z.object({
  message: z.union([z.string(), z.object({ content: z.array(...) })]),
  mode: z.enum(["planning", "build", "chat"]).optional().default("chat"),
  stream: z.boolean().optional().default(true),
});
```

### 2.2 Stream Run Card / Action Data Parts

When processing agent events, emit corresponding data parts:

```typescript
// Planning mode: emit data-run updates
if (mode === "planning") {
  writer.write({
    type: "data-run",
    id: runId,
    data: { title, subtitle, status, filesEditedOrder, groupsOrder },
  });

  // Emit individual events as data-run-item
  writer.write({
    type: "data-run-item",
    id: eventId,
    data: agentEvent,
  });
}

// Build mode: emit data-action for each event
if (mode === "build") {
  writer.write({
    type: "data-action",
    id: eventId,
    data: agentEvent,
  });
}
```

---

## Phase 3: Client-Side Store Updates

### 3.1 Add Events Store

#### [MODIFY] [store.ts](file:///home/eekrain/CODE/ekacode/apps/desktop/src/lib/chat/store.ts)

Add normalized event storage for O(1) updates:

```typescript
export interface ChatState {
  messages: ChatMessagesState;
  events: {
    order: string[];
    byId: Record<string, AgentEvent>;
  };
  // ... existing fields
}
```

Add methods:

- `addEvent(event: AgentEvent)`
- `updateEvent(eventId: string, updater)`
- `getEventsArray()`

### 3.2 Update Stream Parser

#### [MODIFY] [stream-parser.ts](file:///home/eekrain/CODE/ekacode/apps/desktop/src/lib/chat/stream-parser.ts)

Add handlers for new data part types:

- `data-run` → update run card state
- `data-run-item` → add event to current group
- `data-action` → add event to activity feed

---

## Phase 4: Design System (CSS Tokens)

### 4.1 Create Antigravity Design Tokens

#### [NEW] [design-tokens.css](file:///home/eekrain/CODE/ekacode/apps/desktop/src/assets/design-tokens.css)

```css
:root {
  /* Antigravity color palette */
  --ag-bg: 26 27 38;
  --ag-surface: 30 31 41;
  --ag-surface-2: 38 40 52;
  --ag-border: 255 255 255;
  --ag-text: 230 232 242;
  --ag-muted: 160 166 186;
  --ag-faint: 120 126 148;
  --ag-accent: 90 170 255;
  --ag-ok: 74 222 128;
  --ag-warn: 251 191 36;
  --ag-err: 248 113 113;
}
```

---

## Phase 5: Component Implementation

### 5.1 Mode Router Component

#### [NEW] [assistant-message.tsx](file:///home/eekrain/CODE/ekacode/apps/desktop/src/components/assistant-message.tsx)

Top-level component that reads message metadata and routes to the correct renderer:

```tsx
export const AssistantMessage: Component<{ message: ChatUIMessage }> = props => {
  const mode = () => props.message.metadata?.mode ?? "chat";

  return (
    <Switch>
      <Match when={mode() === "planning"}>
        <RunCard message={props.message} />
      </Match>
      <Match when={mode() === "build"}>
        <ActivityFeed message={props.message} />
      </Match>
      <Match when={mode() === "chat"}>
        <MessageBubble message={props.message} />
      </Match>
    </Switch>
  );
};
```

### 5.2 Planning Mode: Run Card

#### [NEW] [run-card/](file:///home/eekrain/CODE/ekacode/apps/desktop/src/components/run-card/)

Directory structure:

```
run-card/
├── index.tsx           # Main RunCard component
├── run-header.tsx      # Title + status chip
├── files-section.tsx   # Files Edited list
├── progress-section.tsx # Progress Updates groups
├── progress-group.tsx  # Collapsible group
├── progress-item.tsx   # Individual event row
└── status-chip.tsx     # Status indicator
```

**RunCard Styling:**

```tsx
<div
  class={cn(
    "rounded-xl border border-white/10",
    "bg-[rgba(var(--ag-surface),0.92)]",
    "p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"
  )}
>
  <RunHeader data={runData} />
  <FilesSection files={files} />
  <ProgressSection groups={groups} items={items} />
</div>
```

### 5.3 Build Mode: Activity Feed

#### [NEW] [activity-feed/](file:///home/eekrain/CODE/ekacode/apps/desktop/src/components/activity-feed/)

Directory structure:

```
activity-feed/
├── index.tsx           # Main ActivityFeed component
├── action-row.tsx      # Generic action row
├── terminal-card.tsx   # Terminal output block
├── thought-separator.tsx # "Thought for Ns" row
└── error-row.tsx       # Error display
```

### 5.4 Terminal Card Component

#### [NEW] [terminal-card.tsx](file:///home/eekrain/CODE/ekacode/apps/desktop/src/components/activity-feed/terminal-card.tsx)

```tsx
<div class={cn("rounded-xl border border-white/10", "bg-[rgba(var(--ag-surface),0.88)]", "p-3")}>
  {/* Command line */}
  <div class="font-mono text-[12px] text-white/75">$ {props.terminal.command}</div>

  {/* Output area */}
  <div
    class={cn(
      "mt-2 rounded-lg border border-white/5 bg-black/25",
      "p-2 font-mono text-[12px] leading-5 text-white/65",
      "max-h-[280px] overflow-auto"
    )}
  >
    {props.terminal.outputPreview}
  </div>

  {/* Footer */}
  <div class="mt-2 flex items-center gap-2 text-[12px] text-white/45">
    <span>Ran terminal command</span>
    <button class="text-[rgb(var(--ag-accent))] hover:underline">Open Terminal</button>
    <span class={exitCode === 0 ? "text-[rgb(var(--ag-ok))]" : "text-[rgb(var(--ag-err))]"}>
      Exit code {exitCode}
    </span>
  </div>
</div>
```

### 5.5 "Thought for Ns" Client-Side Logic

#### [NEW] [use-thought-gaps.ts](file:///home/eekrain/CODE/ekacode/apps/desktop/src/hooks/use-thought-gaps.ts)

```typescript
export function useThoughtGaps(events: Accessor<AgentEvent[]>) {
  const [thoughtMarkers, setThoughtMarkers] = createSignal<ThoughtMarker[]>([]);

  createEffect(() => {
    const allEvents = events();
    const markers: ThoughtMarker[] = [];
    let lastTs = 0;

    for (const event of allEvents) {
      const gap = event.ts - lastTs;
      if (gap >= 900 && lastTs > 0) {
        markers.push({
          id: `thought-${event.id}`,
          beforeEventId: event.id,
          durationSec: Math.round(gap / 1000),
        });
      }
      lastTs = event.ts;
    }

    setThoughtMarkers(markers);
  });

  return thoughtMarkers;
}
```

---

## Phase 6: Update Existing Components

### 6.1 Update MessageList

#### [MODIFY] [message-list.tsx](file:///home/eekrain/CODE/ekacode/apps/desktop/src/views/workspace-view/chat-area/message-list.tsx)

Replace `MessageBubble` with `AssistantMessage` for assistant messages:

```tsx
<For each={props.messages}>
  {message => (
    <Show when={message.role === "assistant"} fallback={<MessageBubble message={message} />}>
      <AssistantMessage message={message} />
    </Show>
  )}
</For>
```

### 6.2 Update MessageParts

#### [MODIFY] [message-parts.tsx](file:///home/eekrain/CODE/ekacode/apps/desktop/src/components/message-parts.tsx)

Add cases for new data part types in the Switch:

- `data-run` → render nothing (handled by RunCard)
- `data-action` → render nothing (handled by ActivityFeed)
- `data-terminal` → render TerminalCard

---

## Phase 7: Integration & Polish

### 7.1 Wire Up Electron Actions

Connect "Open file", "Open diff", "Open terminal" buttons to Electron IPC:

```typescript
const handleAction = (action: AgentEventAction) => {
  switch (action.type) {
    case "open-file":
      window.api.openFile(action.path);
      break;
    case "open-diff":
      window.api.openDiff(action.path);
      break;
    case "open-terminal":
      window.api.focusTerminal(action.id);
      break;
  }
};
```

### 7.2 Collapsible Groups

Implement expand/collapse for progress groups with:

- Individual group toggle
- "Collapse all" button in section header

### 7.3 Animations

Add smooth transitions:

- Row hover: `transition-colors duration-150`
- Chevron rotation: `transition-transform duration-200`
- Card appearance: `animate-fade-in-up`

---

## Deliverables Checklist

### Phase 1: Types ✅

- [ ] Add `AgentMode`, `AgentEventKind`, `AgentEvent` types
- [ ] Add `RunCardData`, `RunFileData`, `RunGroupData` types
- [ ] Add `ActionData`, `ChatMessageMetadata` types
- [ ] Update `ChatUIMessage` with new data parts

### Phase 2: Server ⚙️

- [ ] Add `mode` to chat request schema
- [ ] Stream `data-run` parts in planning mode
- [ ] Stream `data-action` parts in build mode
- [ ] Set message metadata with mode info

### Phase 3: Store 🔧

- [ ] Add events normalized store
- [ ] Add event CRUD methods
- [ ] Update stream parser for new parts

### Phase 4: Design 🎨

- [ ] Create design tokens CSS
- [ ] Import in main styles

### Phase 5: Components 🧩

- [ ] `AssistantMessage` router
- [ ] `RunCard` + sub-components
- [ ] `ActivityFeed` + sub-components
- [ ] `TerminalCard`
- [ ] `useThoughtGaps` hook

### Phase 6: Integration 🔌

- [ ] Update `MessageList`
- [ ] Update `MessageParts`
- [ ] Update `MessageBubble`

### Phase 7: Polish ✨

- [ ] Electron action handlers
- [ ] Collapsible groups
- [ ] Animations & transitions

---

## Implementation Order

1. **Phase 1** - Types (foundation)
2. **Phase 4** - Design tokens (can work in parallel)
3. **Phase 3** - Store updates
4. **Phase 5** - Components (most work)
5. **Phase 6** - Integration
6. **Phase 2** - Server (can be mocked initially)
7. **Phase 7** - Polish

---

## Verification Plan

### Automated Tests

```bash
pnpm --filter @ekacode/desktop tsc --noEmit  # Type check
pnpm --filter @ekacode/desktop test          # Unit tests
```

### Manual Verification

1. Send a planning-mode message → verify Run Card renders
2. Send a build-mode message → verify Activity Feed renders
3. Verify "Thought for Ns" appears after gaps
4. Verify file/terminal actions trigger Electron IPC
5. Verify streaming updates are smooth (no jank at 50+ events/sec)

---

## Notes

> [!IMPORTANT]
> The normalized events store (`events: {order, byId}`) is critical for build mode performance. Without it, frequent action updates will cause O(N) scans.

> [!TIP]
> For initial development, mock the server-side mode by adding a toggle in the UI. This allows frontend work to proceed without server changes.

> [!CAUTION]
> Do NOT log per-delta events in production. The current parser logs each line which will bottleneck at high token rates.
