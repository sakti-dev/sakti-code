# Unified Memory System Implementation Plan (Sakti Mantra Engine)

## Overview

This document specifies the implementation of a **unified Memory System** for sakti-code agents - achieving the "Memory Upgrade" through integration of **Task Memory** and **Message Memory**.

Based on industry research showing tool-use reliability degrades sharply as tool registries grow (SOP-Bench reports agents invoke incorrect tools "nearly 100% of the time" with large registries), we consolidate into **3 tools** that balance simplicity with functionality.

---

## The "Memory Upgrade" Concept

```
┌─────────────────────────────────────────────────────────────────────┐
│                         MEMORY SYSTEM                                 │
├─────────────────────────┬───────────────────────────────────────────┤
│     Task Memory        │            Message Memory                   │
│    (beads-like)        │    (Observations + BM25 Search)           │
├─────────────────────────┼───────────────────────────────────────────┤
│ - Tasks                │ - Observations (narrative, cacheable)      │
│ - Dependencies         │ - Recent messages (full detail)           │
│ - Blockers             │ - BM25 search (on-demand retrieval)       │
│ - Status workflow      │ - Survives session boundaries             │
│ - Summary-on-close    │ - LLM knows what to search for            │
└─────────────────────────┴───────────────────────────────────────────┘
```

**Key insight**: Observations tell LLM WHAT exists → LLM uses BM25 to find exact details

- Session 1: Implement code → Messages → Observer creates observations with specific names
- Session 2: LLM sees observation "created Login Zod schema" → searches "Login schema" → retrieves exact message

---

## Design Decisions

### Why 3 Tools?

| Research Finding                            | Application                        |
| ------------------------------------------- | ---------------------------------- |
| 4-6 tools maximum for reliable performance  | 3 tools is well under the limit    |
| "Consolidation over multiplication"         | Task ops + search split is natural |
| Discriminated unions work for same resource | Tools operate on Memory resource   |

### Tool Count Summary

| Tool Name       | Category | Actions                                         | Description                             |
| --------------- | -------- | ----------------------------------------------- | --------------------------------------- |
| `task-query`    | Read     | ready, show, list, search                       | Query tasks (including search by title) |
| `task-mutate`   | Write    | create, claim, close, dep, link, update_context | Modify tasks, messages, context         |
| `memory-search` | Search   | search                                          | Search past conversations (BM25)        |

---

## Implementation Phases

The plan is ambitious - implementing all features at once is risky. Here's a phased approach:

### Phase 1 - Minimum Viable Memory

**Goal:** Get working memory off Mastra with basic functionality. Deliver core value fast.

**Scope: EXCLUDES observations.** Just raw messages + FTS5 search.

- **Data model:**
  - Implement `threads`, `messages` (with `resourceId`, `taskId`, `messageIndex`)
  - Implement `tasks` + `taskDependencies`
  - Implement `task_messages` junction table
  - NO `observations` table in Phase 1

- **Functionality:**
  - Task tools: `task-query` (ready/show/list), `task-mutate` (create/claim/close/dep/link)
  - `memory-search`: FTS5 on `messages.content` with BM25 + recency boost
  - Implicit linking: `claim` → set `activeTaskId`, messages auto-tagged
  - Manual compaction only: `/compact` command or after N messages (sync)

**Phase 1 delivers:**

```
User: "implement login"
→ Agent creates task "Implement login"
→ Messages saved, FTS5 indexed automatically
→ memory-search("login") works immediately
→ task-query.ready() works
```

**Expected duration:** 1-2 weeks

### Phase 2 - Async Buffering & Crash Recovery

**Goal:** Production-ready with proper async handling.

- Introduce `observational_memory` with:
  - `activeObservations`, `bufferedObservationChunks`
  - State flags (`isObserving`, `isBufferingObservation`, etc.)
  - Lease-based locking for multi-instance safety
- Wire in:
  - `startAsyncBufferedObservation`
  - `tryActivateBufferedObservations`
  - Stale flag detection
- Scope: Default to `thread` (not `resource`) for safety

**Expected duration:** 1-2 weeks

### Phase 3 - Reflector & Multi-Level Compaction

**Goal:** Full hierarchical memory with reflection.

- Implement Reflector agent and reflection hierarchy
- Add `reflections` table
- Add sliding window: keep recent observations raw alongside reflections
- Refine context injection to 4-level stack

**Expected duration:** 1-2 weeks

---

# Part 1: Task Memory

## Data Model

### Task Entity

```typescript
interface Task {
  // Core
  id: string; // UUID v7 (RFC 9562 - time-ordered IDs)
  title: string; // Required, max 500 chars
  description?: string; // Optional detailed description

  // Status & Type
  status: TaskStatus; // open, in_progress, closed
  priority: number; // 0-4 (P0-P4)
  type: TaskType; // bug, feature, task, epic, chore

  // Assignment
  assignee?: string; // Session ID or user ID
  sessionId?: string; // Claiming agent's session

  // Timestamps
  createdAt: number; // Unix timestamp ms
  updatedAt: number; // Unix timestamp ms
  closedAt?: number; // Unix timestamp ms when closed
  closeReason?: string; // completed, wontfix, duplicate

  // Relationships
  dependencies: TaskDependency[];
  labels: string[];

  // Compaction (Memory Decay)
  summary?: string; // Agent-provided or AI-generated summary
  compactionLevel: number; // 0=none, 1=summarized, 2=archived
  compactedAt?: number;
  originalContent?: string; // Stored before compaction

  // Metadata
  metadata?: Record<string, unknown>;

  // Message links (INTEGRATION)
  linkedMessageIds: string[]; // Related chat messages
}
```

### Task Status

```typescript
type TaskStatus = "open" | "in_progress" | "closed";
// Note: "blocked" is computed from dependencies
```

### Task Type

```typescript
type TaskType = "bug" | "feature" | "task" | "epic" | "chore";
```

### Dependency

```typescript
interface TaskDependency {
  taskId: string;
  dependsOnId: string;
  type: "blocks" | "parent-child" | "related";
}
```

---

# Part 2: Message Memory

## Purpose

Message Memory provides persistent chat history that survives session boundaries with a hybrid approach:

```
Session 1:
- User: "implement login with Zod"
- Agent: creates LoginSchema with email, password fields
- Messages get compacted → Observation includes specific names

Session 2:
- User: "show me the login schema"
- LLM sees observation: "created Login Zod schema with email, password"
- LLM searches: "Login schema"
- BM25 returns exact message with the schema code
```

## Key Insight: Observations + BM25

```
┌─────────────────────────────────────────────────────────────┐
│ Context Window                                              │
├─────────────────────────────────────────────────────────────┤
│ [System Prompt]                                             │
├─────────────────────────────────────────────────────────────┤
│ Observations (narrative, stable prefix - cacheable)         │
│ - 🔴 14:30 Created Login Zod schema with email, password  │
│ - 🟢 14:35 Added validation for password min 8 chars      │
├─────────────────────────────────────────────────────────────┤
│ Recent Messages (full detail)                               │
│ - User: create login schema                                │
│ - Agent: const LoginSchema = z.object({...})               │
├─────────────────────────────────────────────────────────────┤
│ On-demand: LLM searches "Login schema" → BM25 returns 1 msg│
└─────────────────────────────────────────────────────────────┘
```

**Why this works**:

1. Observation tells LLM specific entity names (LoginSchema, email, password)
2. When LLM needs details, it uses those names to search
3. BM25 finds exact matches (code has precise identifiers)

## Data Model

### Chat Message

```typescript
interface ChatMessage {
  // Core
  id: string; // UUID v7
  role: "user" | "assistant" | "system";
  content: string; // Message content

  // Task Link (INTEGRATION)
  taskId?: string; // Associated task

  // Compaction
  originalContent?: string; // Original before compaction
  summary?: string; // Generated summary (when compacted)
  compactionLevel: number; // 0=none, 1=summarized

  // Metadata
  createdAt: number; // Unix timestamp ms
  messageIndex: number; // Order in conversation

  // Token tracking
  tokenCount?: number;
}
```

### Compaction Record

```typescript
interface CompactionRecord {
  id: string;
  startIndex: number; // Starting message index
  endIndex: number; // Ending message index
  messageCount: number;
  summary: string; // Generated summary
  createdAt: number;
  originalMessageIds: string[]; // For restore capability
}
```

---

### Normalized Observation Schema (Task-Driven Memory)

> **Important:** This schema supports the Task-Driven Memory system where different sub-agent modes (explore, bug_fixing, refactoring, testing, etc.) capture observations differently but store them uniformly.

```typescript
type AgentMode =
  | "default" // General coding (build mode)
  | "explore" // Codebase exploration
  | "bug_fixing" // Bug investigation and fixing
  | "refactoring" // Code refactoring
  | "testing" // Test writing/running
  | "debugging" // Debugging session
  | "research"; // Web research / docs lookup

interface Observation {
  id: string;
  mode: AgentMode; // Which mode created this
  timestamp: number;

  // Standard fields (always present)
  priority: "high" | "medium" | "low";
  category: string; // Mode-specific: "findings", "error", "test_result"
  content: string; // The actual observation text

  // Normalized metadata (always tracked)
  metadata: {
    // File tracking - normalized across all modes
    files: string[]; // All files mentioned
    lineNumbers?: number[]; // Line numbers referenced

    // Mode-specific data
    modeSpecific?: {
      // explore mode
      searchQueries?: string[];
      notFound?: string[];

      // bug_fixing mode
      errorType?: string;
      stackTrace?: string;
      rootCause?: string;

      // testing mode
      testResults?: TestResult[];
      coverage?: CoverageInfo;

      // refactoring mode
      filesAffected?: string[];
      breaking?: string[];

      // debugging mode
      symptoms?: string[];
      variables?: Record<string, unknown>;
    };
  };
}
```

**Key Design Principles:**

1. **Mode affects WHAT is captured, NOT how it's stored** - The `mode` field tells the observer what to focus on
2. **Same storage format for all modes** - Enables unified reflector/compaction
3. **Normalized file tracking** - All observations track `files` and `lineNumbers` consistently
4. **Extensible `modeSpecific`** - Easy to add new modes without schema changes

See **EXPLORE_AGENT_OBSERVATIONAL_MEMORY_PLAN.md** for detailed mode-specific prompts and configurations.

---

## Compaction Strategy

> **CRITICAL: Non-Destructive for BM25 Retrieval**
>
> BM25 can only retrieve what exists in the indexed corpus. If you overwrite `content` with summaries, you **lose exact code retrieval**. Never delete raw text - keep it for search.

### Three Storage Concerns

1. **Raw Store** - Original message content (for BM25 search)
2. **Search Text** - What gets indexed in FTS5 (raw for recent, extracted code blocks for old)
3. **Injection Summary** - What gets injected into LLM context (compact)

### When to Compact

| Trigger          | Action                           |
| ---------------- | -------------------------------- |
| Every N messages | Check if compaction needed       |
| 30+ messages     | Compact messages 1-10 to summary |
| Session end      | Compact remaining if > threshold |

### Compaction Levels

| Level | Condition    | Raw Stored | Search Text              | Injection    |
| ----- | ------------ | ---------- | ------------------------ | ------------ |
| 0     | Current      | Kept       | Full content             | Full content |
| 1     | 30+ messages | Kept       | Summary + key code lines | Summary only |
| 2     | 90+ messages | Kept       | Summary only             | Summary only |

### Compaction Process (Non-Destructive)

```
Messages 1-10 (old)
        │
        ▼
LLM generates:
- summary: "Discussed JWT vs OAuth..."
- extractedCode: "const JWT_SECRET = ..."
        │
        ▼
Store (NON-DESTRUCTIVE):
- originalContent: (full original - KEPT for search)
- summary: (for injection)
- searchText: summary + "\n" + extractedCode (for BM25)
- compactionLevel: 1
        │
        ▼
FTS5 indexes: searchText (NOT summary only!)
```

**Key insight:** FTS5 indexes `searchText` which includes both summary AND extracted code snippets. BM25 can find exact identifiers even from old messages.

---

## Production Implementation Details (From Mastra)

> **Critical:** These implementation details are essential for a production-ready system. Do not skip!

### 1. Async Buffering System (Critical)

The most important production feature - observation doesn't block the agent:

```typescript
interface AsyncBufferingConfig {
  /** Trigger async observation every N tokens (default: 6000) */
  bufferTokens: number;

  /** Activate buffered content when this ratio of threshold is reached (default: 0.8) */
  bufferActivation: number;

  /** Force sync observation after this many tokens (default: 7200) */
  blockAfter: number;
}
```

**Why Async Buffering Matters:**

1. Agent runs, messages accumulate in context
2. At `bufferTokens` (6k) → start background observation (async, non-blocking)
3. Store results in `bufferedObservationChunks` in DB
4. At threshold (30k) → activate buffered chunks + sync observation
5. Agent continues WITHOUT waiting for LLM calls

**Without Async Buffering:**

- Agent blocks every time observation triggers
- Long waits for user
- Poor UX

**Implementation:**

```typescript
// Start background observation (non-blocking)
async function startAsyncBufferedObservation(
  record: ObservationalMemoryRecord,
  unobservedMessages: MastraDBMessage[]
): Promise<void> {
  // 1. Set flag in DB
  await storage.setBufferingObservationFlag(record.id, true, currentPendingTokens);

  // 2. Start background task
  const observationPromise = (async () => {
    try {
      const observations = await callObserverAgent(record.activeObservations, unobservedMessages);

      // 3. Store in buffer
      await storage.updateBufferedObservations({
        id: record.id,
        chunk: {
          content: observations,
          messageIds: unobservedMessages.map(m => m.id),
          messageTokens: tokenCounter.countMessages(unobservedMessages),
          createdAt: new Date(),
        },
        pendingTokens: currentPendingTokens,
      });
    } catch (error) {
      // 4. Clear flag on error
      await storage.setBufferingObservationFlag(record.id, false);
    }
  })();

  // 5. Register in static map for cross-instance tracking
  ObservationalMemory.asyncBufferingOps.set(lockKey, observationPromise);
}

// Activate buffered observations
async function tryActivateBufferedObservations(
  record: ObservationalMemoryRecord,
  currentPendingTokens: number
): Promise<boolean> {
  const bufferedChunks = getBufferedChunks(record);
  if (bufferedChunks.length === 0) return false;

  const threshold = record.config.observationThreshold ?? 30000;
  const activationThreshold = threshold * (record.config.bufferActivation ?? 0.8);

  if (currentPendingTokens < activationThreshold) {
    return false; // Not enough tokens, keep buffering
  }

  // Swap buffered → active
  await storage.swapBufferedToActive({
    id: record.id,
    activationRatio: 1.0,
  });

  return true;
}
```

---

### 2. Token Counting & Thresholds

Accurate token counting is critical for proper observation triggering:

```typescript
interface TokenThresholds {
  /** Trigger observation when pending tokens reach this (default: 30000) */
  observationThreshold: number;

  /** Trigger reflection when observation tokens reach this (default: 40000) */
  reflectionThreshold: number;
}

function calculateObservationThresholds(
  allMessages: MastraDBMessage[],
  unobservedMessages: MastraDBMessage[],
  pendingTokens: number,
  otherThreadTokens: number,
  currentObservationTokens: number,
  record: ObservationalMemoryRecord
): { totalPendingTokens: number; threshold: number } {
  const allMessageTokens = tokenCounter.countMessages(allMessages);
  const unobservedTokens = tokenCounter.countMessages(unobservedMessages);

  // Total = all messages + other threads + pending from storage + current observations
  const totalPendingTokens = allMessageTokens + otherThreadTokens + pendingTokens + currentObservationTokens;

  // Threshold = observationThreshold - current observations (leaves room for new content)
  const threshold = (record.config.observationThreshold ?? 30000) - currentObservationTokens;

  return { totalPendingTokens, threshold };
}

// Usage in processInputStep:
const { totalPendingTokens, threshold } = calculateObservationThresholds(...);

if (totalPendingTokens >= threshold) {
  // Trigger observation
}
```

**Token Counting Implementation:**

```typescript
class TokenCounter {
  // Use tiktoken or similar
  private encoder: Tiktoken;

  countMessages(messages: MastraDBMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      total += this.countString(this.messageToString(msg));
    }
    return total;
  }

  countString(str: string): number {
    return this.encoder.encode(str).length;
  }

  private messageToString(msg: MastraDBMessage): string {
    // Convert message to string representation
    // Include role, content, etc.
  }
}
```

---

### 3. State Flags in Database (Crash Recovery)

State flags enable detecting and recovering from crashed processes:

```typescript
// Database columns for state tracking
interface ObservationalMemoryStateFlags {
  // Operation flags
  isObserving: boolean; // Observation in progress
  isReflecting: boolean; // Reflection in progress
  isBufferingObservation: boolean; // Async buffering in progress
  isBufferingReflection: boolean; // Async reflection buffering

  // Async buffering tracking
  lastBufferedAtTokens: number; // Token count when last buffer was triggered
  lastBufferedAtTime: Date | null; // Timestamp of last buffer

  // Safeguard
  observedMessageIds: string[]; // Message IDs already observed
}

// Stale flag detection
async function detectAndClearStaleFlags(record: ObservationalMemoryRecord): Promise<void> {
  // Check if flag is stale (from crashed process)
  if (record.isBufferingObservation) {
    // Check if operation is still running in this process
    const isActive = ObservationalMemory.asyncBufferingOps.has(record.id);
    if (!isActive) {
      // Flag is stale - clear it
      await storage.setBufferingObservationFlag(record.id, false);
    }
  }
}

// Set flag with token tracking
async function setBufferingObservationFlag(
  id: string,
  isBuffering: boolean,
  currentTokens: number
): Promise<void> {
  await storage.update(id, {
    isBufferingObservation: isBuffering,
    lastBufferedAtTokens: currentTokens,
    lastBufferedAtTime: isBuffering ? new Date() : null,
  });
}
```

---

### 4. Message Sealing System

When observation starts, messages are "sealed" to prevent content merging:

```typescript
// Seal a message - marks it as complete for observation
function sealMessage(message: MastraDBMessage): void {
  // 1. Set message-level sealed flag
  if (!message.content.metadata) {
    message.content.metadata = {};
  }
  if (!message.content.metadata.mastra) {
    message.content.metadata.mastra = {};
  }
  message.content.metadata.mastra.sealed = true;

  // 2. Add sealedAt to last part
  const lastPart = message.content.parts[message.content.parts.length - 1];
  if (!lastPart.metadata) {
    lastPart.metadata = {};
  }
  if (!lastPart.metadata.mastra) {
    lastPart.metadata.mastra = {};
  }
  lastPart.metadata.mastra.sealedAt = Date.now();
}

// Observation markers embedded in message parts
const ObservationMarkers = {
  START: "data-om-observation-start",
  END: "data-om-observation-end",
  FAILED: "data-om-observation-failed",
};

// Insert observation markers into message
function insertObservationMarker(
  message: MastraDBMessage,
  markerType: "start" | "end" | "failed"
): void {
  const marker = {
    type: `data-om-observation-${markerType}`,
    timestamp: Date.now(),
  };

  if (markerType === "start") {
    message.content.parts.push(marker as any);
  }
  // For end/failed, the marker is added by writer.custom() first
}

// Get unobserved parts from a message
function getUnobservedParts(message: MastraDBMessage): Part[] {
  const parts = message.content.parts;
  if (!parts || !Array.isArray(parts)) return [];

  // Find last completed observation (start + end)
  const endMarkerIndex = findLastCompletedObservationBoundary(message);

  if (endMarkerIndex === -1) {
    // No completed observation - all parts are unobserved
    return parts.filter(p => !isObservationMarker(p));
  }

  // Return only parts after end marker
  return parts.slice(endMarkerIndex + 1).filter(p => !isObservationMarker(p));
}

function findLastCompletedObservationBoundary(message: MastraDBMessage): number {
  const parts = message.content.parts;
  if (!parts) return -1;

  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i] as { type?: string };
    if (part?.type === "data-om-observation-end") {
      return i;
    }
  }
  return -1;
}
```

---

### 5. Process Flow (processInputStep)

This is the main entry point for memory processing:

```typescript
async function processInputStep(args: ProcessInputStepArgs): Promise<MessageList | MastraDBMessage[]> {
  const { messageList, requestContext, stepNumber, writer } = args;

  // 1. Get thread context
  const context = getThreadContext(requestContext, messageList);
  if (!context) return messageList;

  const { threadId, resourceId } = context;

  // 2. Fetch fresh record
  let record = await getOrCreateRecord(threadId, resourceId);

  // 3. Load historical messages (step 0 only)
  if (stepNumber === 0) {
    await loadHistoricalMessagesIfNeeded(messageList, threadId, resourceId, record.lastObservedAt);
  }

  // 4. Load other threads' context (resource scope)
  let unobservedContextBlocks: string | undefined;
  if (scope === 'resource' && resourceId) {
    unobservedContextBlocks = await loadOtherThreadsContext(resourceId, threadId);
  }

  // 5. Activate buffered observations (step 0)
  if (stepNumber === 0 && isAsyncObservationEnabled()) {
    await tryActivateBufferedObservations(record, ...);
  }

  // 6. Check reflection (step 0)
  if (stepNumber === 0) {
    if (shouldReflect(observationTokens)) {
      await triggerReflection(record, ...);
    } else if (shouldTriggerAsyncReflection(...)) {
      await triggerAsyncReflection(record, ...);
    }
  }

  // 7. Calculate thresholds and check observation
  if (!readOnly) {
    const thresholds = calculateObservationThresholds(...);
    const { totalPendingTokens, threshold } = thresholds;

    // Async buffering: trigger at bufferTokens intervals
    if (isAsyncObservationEnabled() && totalPendingTokens < threshold) {
      if (shouldTriggerAsyncObservation(...)) {
        startAsyncBufferedObservation(record, ...);
      }
    }

    // Threshold reached: observe synchronously
    if (stepNumber > 0 && totalPendingTokens >= threshold) {
      await handleThresholdReached(messageList, record, ...);
    }
  }

  // 8. Inject observations into context
  await injectObservationsIntoContext(messageList, record, threadId, resourceId, ...);

  // 9. Filter already-observed messages
  if (stepNumber === 0) {
    filterAlreadyObservedMessages(messageList, record);
  }

  return messageList;
}
```

---

### 6. Lookup Key Pattern

Single column for efficient queries across both thread and resource scope:

```typescript
// Generate lookup key
function getLookupKey(scope: "resource" | "thread", resourceId: string, threadId?: string): string {
  if (scope === "resource") {
    return `resource:${resourceId}`;
  }
  return `thread:${threadId}`;
}

// Query by lookup key
async function getObservationalMemory(
  storage: MemoryStorage,
  scope: "resource" | "thread",
  resourceId: string,
  threadId?: string
): Promise<ObservationalMemoryRecord | null> {
  const lookupKey = getLookupKey(scope, resourceId, threadId);
  return storage.getObservationalMemoryByLookupKey(lookupKey);
}
```

---

### 7. Context Injection

How observations are formatted and injected into the message list:

```typescript
async function injectObservationsIntoContext(
  messageList: MessageList,
  record: ObservationalMemoryRecord,
  threadId: string,
  resourceId: string | undefined,
  unobservedContextBlocks?: string,
  requestContext?: RequestContext
): Promise<void> {
  // Get thread metadata for current-task and suggested-response
  const thread = await storage.getThreadById({ threadId });
  const threadOMMetadata = getThreadOMMetadata(thread?.metadata);

  // Format observations
  const observationSystemMessage = formatObservationsForContext(
    record.activeObservations,
    threadOMMetadata?.currentTask,
    threadOMMetadata?.suggestedResponse,
    unobservedContextBlocks,
    new Date()
  );

  // Clear existing observation system messages
  messageList.clearSystemMessages("observational-memory");

  // Add formatted observations
  messageList.addSystem(observationSystemMessage, "observational-memory");

  // Add continuation hint
  const continuationMessage: MastraDBMessage = {
    id: "om-continuation",
    role: "user",
    createdAt: new Date(0),
    content: {
      format: 2,
      parts: [
        {
          type: "text",
          text: `<system-reminder>${OBSERVATION_CONTINUATION_HINT}</system-reminder>`,
        },
      ],
    },
    threadId,
    resourceId,
  };
  messageList.add(continuationMessage, "memory");
}

function formatObservationsForContext(
  observations: string,
  currentTask?: string,
  suggestedResponse?: string,
  unobservedContextBlocks?: string,
  currentDate?: Date
): string {
  // Optimize observations (remove non-critical emojis, etc.)
  let optimized = optimizeObservationsForContext(observations);

  let content = `
${OBSERVATION_CONTEXT_PROMPT}

<observations>
${optimized}
</observations>

${OBSERVATION_CONTEXT_INSTRUCTIONS}`;

  // Add unobserved context from other threads
  if (unobservedContextBlocks) {
    content += `

The following content is from OTHER conversations different from the current conversation:
START_OTHER_CONVERSATIONS_BLOCK
${unobservedContextBlocks}
END_OTHER_CONVERSATIONS_BLOCK`;
  }

  // Add current-task from thread metadata
  if (currentTask) {
    content += `

<current-task>
${currentTask}
</current-task>`;
  }

  if (suggestedResponse) {
    content += `

<suggested-response>
${suggestedResponse}
</suggested-response>`;
  }

  return content;
}
```

---

### Reflection Flow

When observations grow too large, the Reflector condenses them:

```typescript
async function shouldReflect(observationTokens: number): boolean {
  return observationTokens >= (config.reflectionThreshold ?? 40000);
}

async function triggerReflection(
  record: ObservationalMemoryRecord,
  observationTokens: number,
  threadId: string,
  writer: any,
  messageList: MessageList
): Promise<void> {
  // 1. Set reflecting flag
  await storage.update(record.id, { isReflecting: true });

  try {
    // 2. Get all observations to reflect
    const observations = record.activeObservations;

    // 3. Call Reflector agent
    const reflection = await callReflectorAgent(observations);

    // 4. Check if compression is needed
    let result = reflection;
    let compressionLevel = 0;

    while (result.tokenCount > observationTokens * 0.5 && compressionLevel < 2) {
      // Apply compression guidance
      const compressionPrompt = COMPRESSION_GUIDANCE[compressionLevel as 1 | 2];
      result = await callReflectorAgent(observations, compressionPrompt);
      compressionLevel++;
    }

    // 5. Create new generation
    await storage.createReflectionGeneration({
      threadId: record.threadId,
      resourceId: record.resourceId,
      scope: record.scope,
      content: result.observations,
      mergedFrom: [], // Track observation IDs that were merged
      generationCount: record.generationCount + 1,
    });

    // 6. Update thread metadata with current-task and suggested-response
    if (result.currentTask || result.suggestedResponse) {
      await storage.updateThread(threadId, {
        metadata: setThreadOMMetadata(currentThread.metadata, {
          currentTask: result.currentTask,
          suggestedResponse: result.suggestedResponse,
        }),
      });
    }
  } finally {
    // 7. Clear reflecting flag
    await storage.update(record.id, { isReflecting: false });
  }
}

// Call Reflector agent
async function callReflectorAgent(
  observations: string,
  compressionPrompt?: string
): Promise<ReflectorResult> {
  const agent = new Agent({
    id: "reflector",
    name: "reflector",
    model: config.model,
    instructions: buildReflectorSystemPrompt() + (compressionPrompt ?? ""),
  });

  const prompt = `
Existing observations:
${observations}

Please reflect and consolidate these observations into a more compact form.`;

  const result = await agent.generate(prompt);

  return {
    observations: parseObserverOutput(result.text).observations,
    currentTask: parseObserverOutput(result.text).currentTask,
    suggestedResponse: parseObserverOutput(result.text).suggestedContinuation,
    tokenCount: tokenCounter.countString(result.text),
  };
}
```

---

### 8. Configuration Defaults

```typescript
const DEFAULT_MEMORY_CONFIG = {
  // Observation thresholds
  observationThreshold: 30000, // 30k tokens
  reflectionThreshold: 40000, // 40k tokens

  // Async buffering (critical for production)
  bufferTokens: 6000, // Trigger every 6k tokens
  bufferActivation: 0.8, // Activate at 80% of threshold
  blockAfter: 7200, // Force sync after 7.2k tokens

  // Scope: DEFAULT TO THREAD for safety (see scope section below)
  scope: "thread", // 'resource' is experimental

  // Message history
  lastMessages: 10,
};
```

### 8.1 Agent Mode Configurations

For Task-Driven Memory with different sub-agent modes, see **EXPLORE_AGENT_OBSERVATIONAL_MEMORY_PLAN.md**:

| Mode        | Threshold | Focus                     | Use Case                |
| ----------- | --------- | ------------------------- | ----------------------- |
| default     | 30k       | Everything                | Main agent / build mode |
| explore     | 60k       | Findings + gaps           | Codebase exploration    |
| bug_fixing  | 40k       | Errors + root cause       | Bug investigation       |
| refactoring | 50k       | Interfaces + dependencies | Code refactoring        |
| testing     | 40k       | Tests + coverage          | Test writing            |
| debugging   | 40k       | Symptoms + variables      | Debugging sessions      |
| research    | 60k       | Findings + sources        | Web research            |

The mode is assigned when spawning sub-agents. See Appendix E in EXPLORE_AGENT_OBSERVATIONAL_MEMORY_PLAN.md for full implementation.

---

### Scope: Thread vs Resource

> **IMPORTANT:** Mastra marks resource scope as experimental and notes async buffering is NOT supported with resource scope.

**Default: `scope: 'thread'`**

Thread scope means each conversation has its own isolated memory. This is safer because:

- Each project/task gets clean memory boundaries
- No cross-project contamination
- Async buffering works correctly

**Resource scope** (e.g., per-user) can cause problems:

- One thread may continue work from another thread unexpectedly
- Processing "all unobserved messages across all threads" is slow
- Cross-thread observation sharing can cause wrong-file/wrong-branch mistakes

**Recommendation:** Use thread scope by default. Reserve resource scope for:

- Explicit single-project-per-user environments
- A separate "Working Memory" layer for stable preferences/facts only

---

### Concurrency: Lease-Based Locking

The in-memory `asyncBufferingOps` map is not safe for multi-instance deployments. Use lease-based locking:

```typescript
interface ObservationalMemoryLock {
  lockOwnerId: string; // Unique instance ID
  lockExpiresAt: Date; // Lease expiration
  lockOperationId: string; // Operation identifier (for compare-and-swap)
  lastHeartbeatAt: Date; // Last heartbeat
}

// Acquire lock before starting observation/reflection
async function acquireLock(
  recordId: string,
  ownerId: string,
  leaseMs: number = 30000
): Promise<{ success: boolean; operationId?: string }> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + leaseMs);
  const operationId = crypto.randomUUID();

  // Only acquire if lock is expired or we own it
  // CRITICAL: Use compare-and-swap on operationId to prevent overwriting newer work
  const result = await db
    .update(observationalMemory)
    .set({
      lockOwnerId: ownerId,
      lockExpiresAt: expiresAt,
      lockOperationId: operationId,
      lastHeartbeatAt: now,
    })
    .where(
      and(
        eq(observationalMemory.id, recordId),
        or(
          isNull(observationalMemory.lockExpiresAt),
          lt(observationalMemory.lockExpiresAt, now),
          and(
            eq(observationalMemory.lockOwnerId, ownerId),
            eq(observationalMemory.lockOperationId, currentOperationId) // Must match our operation
          )
        )
      )
    );

  return { success: result.changes > 0, operationId };
}

// Heartbeat to renew lease (must verify operationId)
async function heartbeatLock(
  recordId: string,
  ownerId: string,
  operationId: string
): Promise<boolean> {
  const result = await db
    .update(observationalMemory)
    .set({
      lastHeartbeatAt: new Date(),
      lockExpiresAt: new Date(Date.now() + 30000),
    })
    .where(
      and(
        eq(observationalMemory.id, recordId),
        eq(observationalMemory.lockOwnerId, ownerId),
        eq(observationalMemory.lockOperationId, operationId) // CRITICAL: Verify same operation
      )
    );

  return result.changes > 0;
}

// Commit buffered work only if we still own the lock (prevent overwriting newer work)
async function commitBufferedObservations(
  recordId: string,
  ownerId: string,
  operationId: string,
  bufferedChunks: BufferedChunk[]
): Promise<boolean> {
  // Verify we still own the lock with the same operationId
  const record = await db
    .select()
    .from(observationalMemory)
    .where(eq(observationalMemory.id, recordId));

  if (!record || record.lockOwnerId !== ownerId || record.lockOperationId !== operationId) {
    // Lock lost or different operation - do not commit!
    return false;
  }

  // Safe to commit
  await db
    .update(observationalMemory)
    .set({
      bufferedObservationChunks: bufferedChunks,
      isBufferingObservation: false,
    })
    .where(eq(observationalMemory.id, recordId));

  return true;
}
```

> **Critical:** Always verify both `lockOwnerId` AND `lockOperationId` before committing. Without operationId, an instance could lose its lease, then later commit buffered results, overwriting a newer owner's work.

---

### SQLite Configuration

libsql does NOT enable WAL by default. Configure at startup:

```typescript
async function initializeDatabase(db: Database) {
  // Enable WAL mode for better concurrency
  await db.execute(sql`PRAGMA journal_mode = WAL`);

  // Set busy timeout for write conflicts (5 seconds)
  await db.execute(sql`PRAGMA busy_timeout = 5000`);

  // Use NORMAL synchronous for performance (SAFE with WAL)
  // ⚠️ DURABILITY TRADEoff: With NORMAL, a power loss may lose recently committed transactions
  // Use FULL for stronger durability at cost of performance
  await db.execute(sql`PRAGMA synchronous = NORMAL`);

  // Enable foreign keys
  await db.execute(sql`PRAGMA foreign_keys = ON`);
}
```

**Why WAL?**

- Allows readers and writers to proceed concurrently
- Significantly faster in most scenarios
- Prevents "database is locked" errors during concurrent writes

**⚠️ Durability Tradeoff:**

- `synchronous=NORMAL`: Fast but a power loss may lose recently committed transactions
- `synchronous=FULL`: Safer durability but slower writes
- For agent memory, losing a few recent messages may confuse users - consider your SLOs

### FTS5 Index Maintenance (Ops Runbook)

```sql
-- Rebuild FTS index if suspected inconsistent (rare)
INSERT INTO messages_fts(messages_fts) VALUES('rebuild');

-- Optimize FTS index for better query performance (can be slow - run during low traffic)
INSERT INTO messages_fts(messages_fts) VALUES('optimize');
```

**When to run:**

- After bulk data migration (manual sync required - see migration section)
- If queries return unexpected results (rebuild)
- Periodically for performance (optimize during maintenance windows)

---

## Retrieval: Observations + BM25

### The Hybrid Approach

Instead of vector embeddings, we use:

1. **Observational Memory** - narrative summaries (from OM research)
2. **BM25 search** - keyword retrieval via SQLite FTS5

### Why BM25 Over Vectors?

| Aspect        | BM25                     | Vector           |
| ------------- | ------------------------ | ---------------- |
| Matches       | Keywords ("LoginSchema") | Semantic         |
| Storage       | Text + FTS5 index        | Float arrays     |
| API needed    | No                       | Yes (embeddings) |
| Latency       | Lower                    | Higher           |
| Code matching | Excellent                | Good             |

**For coding agents, BM25 is often better** - code has precise identifiers that BM25 excels at matching.

### How It Works

```
1. Observation created:
   - "🔴 14:30 Created Login Zod schema with email, password fields"

2. Later, user asks: "show me the login schema"

3. LLM sees observation → knows entity name "Login"

4. LLM triggers BM25 search: "Login schema"

5. BM25 returns:
   {
     messageId: "msg-123",
     content: "const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(8) })",
     rank: 1
   }

6. LLM includes this message in response
```

### FTS5 Implementation Choices

SQLite FTS5 provides knobs that matter for code search:

**1. External-content tables** with triggers to keep indexes synced:

```sql
-- Create FTS table that references messages table
-- IMPORTANT: Index searchText (contains summary + code), not rawContent
CREATE VIRTUAL TABLE messages_fts USING fts5(
  searchText,
  content=messages,
  content_rowid=rowid,
  tokenize='unicode61 tokenchars "-_"'  -- Preserve code identifiers
);

-- Triggers to keep FTS in sync (use searchText field)
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, searchText) VALUES (new.rowid, new.searchText);
END;

CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, searchText) VALUES('delete', old.rowid, old.searchText);
END;

CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, searchText) VALUES('delete', old.rowid, old.searchText);
  INSERT INTO messages_fts(rowid, searchText) VALUES (new.rowid, new.searchText);
END;
```

> **Tokenchars for code:** The `tokenize='unicode61 tokenchars "-_"'` setting ensures identifiers like `refresh_tokens`, `auth.ts`, `my-component` are treated as single tokens, not split at hyphens/underscores/dots. This is critical for BM25 to match code identifiers.

**2. Prefix indexes** for code identifiers:

```sql
-- Support prefix queries like "Login*" for autocomplete
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  content=messages,
  content_rowid=rowid,
  prefix='2 3 4'  -- 2-4 character prefixes
);
```

**3. Trigram tokenizer** for substring matching (camelCase, partial names):

```sql
-- For partial matches like "auth" in "authenticateUser"
CREATE VIRTUAL TABLE code_fts USING fts5(
  content,
  tokenize='trigram'
);
```

**4. BM25 column weights** - code paths count more than prose:

```sql
-- Weight file paths higher than content
SELECT bm25(messages_fts, 1.0, 0.5) -- (path_weight, content_weight)
FROM messages_fts
WHERE messages_fts MATCH 'LoginSchema';
```

**5. Recency Boost** - newer messages should rank higher when keyword match quality is similar:

```typescript
// BM25: smaller = better match (ascending sort)
// Use createdAt (not rowid) for recency - rowid changes on backfills/compaction
const RECENCY_FACTOR = 0.0000001; // Smaller factor since createdAt is much larger than rowid

async function searchWithRecency(db: Database, query: string, limit: number) {
  const results = await db.execute(sql`
    SELECT 
      m.id,
      m.searchText as content,
      m.createdAt as created_at,
      m.taskId as task_id,
      bm25(messages_fts) as match_score,
      -- Use createdAt for recency: more recent = higher value = smaller subtraction = better
      (bm25(messages_fts) - (m.createdAt * ${RECENCY_FACTOR})) as final_rank
    FROM messages_fts fts
    JOIN messages m ON m.rowid = fts.rowid
    WHERE messages_fts MATCH ${query}
    ORDER BY final_rank ASC  -- Smaller = better in FTS5 BM25
    LIMIT ${limit}
  `);

  return results;
}
```

> **Why createdAt instead of rowid:** rowid can change during backfills, compaction rewrites, or imports. `createdAt` is stable and preserves chronological semantics.

return results;
}

````

> **Note:** In SQLite FTS5, BM25 returns negative values where *more negative = better*. We subtract the recency factor so newer messages (higher rowid) get a slight boost when match quality is similar.

### Observer Extraction Instructions (Coding Agent)

> **Purpose:** Instructions for the Observer agent to extract observations from messages. These prompts are optimized for a coding agent context.

```typescript
const OBSERVER_EXTRACTION_INSTRUCTIONS = `
CRITICAL: DISTINGUISH USER REQUESTS FROM QUESTIONS

When the user ASKS you to DO something (implement, fix, create, refactor):
- "Implement login with Zod" → 🟡 (14:30) User requested implementation of login with Zod
- "Fix the auth bug" → 🟡 (14:31) User requested fix for auth bug
- "Create a new component" → 🟡 (14:32) User requested new component creation

When the user TELLS you something about their CODEBASE or PREFERENCES:
- "We use TypeScript" → 🔴 (14:33) User stated codebase uses TypeScript
- "I prefer Jest over Vitest" → 🔴 (14:34) User stated preference for Jest over Vitest
- "The API is in /server" → 🔴 (14:35) User stated API is located in /server directory

When the user ASKS a QUESTION:
- "How do I implement X?" → 🟡 (15:00) User asked how to implement X
- "Can you explain Y?" → 🟡 (15:01) User asked about Y

IMPORTANT: REQUESTS (imperative) are different from QUESTIONS. Requests get 🟡, Questions get 🟡.

---

PROJECT CONTEXT - Always capture:
- What the user is working on (feature, bug, refactor)
- The specific file paths, function names, class names mentioned
- Any constraints or requirements stated
- Technology choices (frameworks, libraries, patterns)
- Code style preferences

TECHNICAL DETAILS - Preserve EXACT names:
- File paths: "auth.ts", "src/utils/helper.ts", "/server/routes/api.ts"
- Function names: "authenticateUser", "calculateTotal", "handleSubmit"
- Class names: "LoginForm", "UserService", "ApiClient"
- Variable names: "userId", "isAuthenticated", "errorMessage"
- Schema names: "LoginSchema", "UserModel", "ProductType"
- API endpoints: "/api/auth/login", "GET /users/:id"
- Database tables: "users", "sessions", "refresh_tokens"

CODE STATE CHANGES:
When the user indicates code is changing:
- "We're migrating from JavaScript to TypeScript" → "User is migrating codebase from JavaScript to TypeScript"
- "Switched from Redux to Zustand" → "User switched state management from Redux to Zustand"
- "Removed the legacy auth system" → "User removed legacy auth system (no longer using it)"

TEMPORAL ANCHORING:
Each observation has TWO timestamps:
1. BEGINNING: The time the statement was made (from message timestamp) - ALWAYS include
2. END: The time being REFERENCED - ONLY when there's a relative time reference

FORMAT:
- With time reference: (TIME) [observation]. (meaning/estimated DATE)
- Without time reference: (TIME) [observation].

ONLY add "(meaning DATE)" at the END when you can provide an ACTUAL DATE:
- Past: "last week", "yesterday", "a few days ago", "last sprint"
- Future: "this sprint", "next week", "by Friday"

DO NOT add end dates for:
- Present-moment statements with no time reference
- Vague references like "recently", "soon"

---

PRESERVE CODE DETAILS:

1. FUNCTION/METHOD SIGNATURES - Include full signatures:
   BAD: Assistant created a validate function
   GOOD: Assistant created validateEmail(email: string): boolean function in utils/validation.ts

2. IMPORT STATEMENTS - Note key imports:
   BAD: Assistant added authentication
   GOOD: Assistant added 'jwt' and 'bcrypt' imports for authentication

3. DATABASE SCHEMAS - Include field names and types:
   BAD: Created user schema
   GOOD: Created UserSchema with id (string), email (string), passwordHash (string), createdAt (timestamp)

4. API ROUTES - Include method and path:
   BAD: Created login endpoint
   GOOD: Created POST /api/auth/login endpoint returning { token, user }

5. CONFIG VALUES - Include exact values:
   BAD: Set timeout value
   GOOD: Set REQUEST_TIMEOUT to 30000ms (30 seconds)

6. ERROR HANDLING - Note error types:
   BAD: Added error handling
   GOOD: Added try/catch for AuthenticationError and ValidationError

7. DEPENDENCY CHANGES - Note package names and versions:
   BAD: Added auth library
   GOOD: Added @auth0/auth0-spa-js version 2.1.0 for authentication

8. FILE STRUCTURE - Note directory hierarchy:
   BAD: Created utils folder
   GOOD: Created src/utils/ with auth.ts, validation.ts, helpers.ts

9. TEST CASES - Note what's being tested:
   BAD: Added tests
   GOOD: Added unit tests for UserService.validate() covering valid/invalid emails

10. ENVIRONMENT VARIABLES - Note key env vars:
    BAD: Set up environment
    GOOD: Set DATABASE_URL, JWT_SECRET, and REDIS_URL environment variables

---

PRESERVING ASSISTANT-GENERATED CODE:

When you (the assistant) provide code, schemas, or technical content:
- Preserve the exact file path where code should go
- Note the function/class names defined
- Include key imports or dependencies required
- Record any configuration or setup steps

1. CODE SNIPPETS - If assistant writes code:
   BAD: Assistant wrote authentication code
   GOOD: Assistant wrote authenticateUser() in src/auth/index.ts using bcrypt.compare()

2. SCHEMAS - If assistant defines schemas:
   BAD: Assistant created validation schema
   GOOD: Assistant created LoginSchema = z.object({ email: z.string().email(), password: z.string().min(8) })

3. REFACTORINGS - If assistant refactors:
   BAD: Assistant refactored the auth module
   GOOD: Assistant refactored auth/login.ts to use async/await, moved validation to auth/validators.ts

4. DEBUGGING - If assistant finds/fixes bugs:
   BAD: Assistant fixed a bug
   GOOD: Assistant fixed bug in src/api/users.ts:45 - missing null check on user.id causing crash

5. QUERIES - If assistant runs database queries:
   BAD: Assistant ran a query
   GOOD: Assistant ran SELECT * FROM users WHERE email = ? to find user by email

6. CONFIGURATION - If assistant sets up config:
   BAD: Assistant configured ESLint
   GOOD: Assistant configured ESLint with extends: ['airbnb', 'prettier'], rules: { 'no-unused-vars': 'error' }

7. GIT OPERATIONS - Note what was done:
   BAD: Assistant committed changes
   GOOD: Assistant committed "feat: add JWT authentication" with files: src/auth/, tests/auth/

8. FAILURES - Record when assistant attempts but fails:
   BAD: Assistant tried to fix the bug
   GOOD: Assistant attempted fix for Auth.ts but build failed with TypeScript error
   GOOD: Assistant tried to install bcrypt but npm install failed with EACCES error

---

CONVERSATION CONTEXT FOR CODING:

- What feature/bug the user is working on
- What files were modified or created
- What errors were encountered and how they were resolved
- What tests were added or modified
- What dependencies were installed
- What environment setup was done
- What the user learned or understood
- Any blockers or questions the user has
- Code review feedback received
- Performance optimizations made
- Security considerations addressed
`;
````

### Observer Output Format (Coding Agent)

```typescript
const OBSERVER_OUTPUT_FORMAT = `
Use priority levels:
- 🔴 High: user preferences, technology choices, critical context, blockers, completed major features
- 🟡 Medium: implementation details, file changes, current work, questions, test results
- 🟢 Low: minor details, minor file changes, lint warnings, minor observations

Group observations by date, then list each with 24-hour time.
Group related observations (like file changes in same feature) by indenting.

<observations>
Date: Dec 4, 2025
* 🔴 (09:15) User stated codebase uses TypeScript, prefers Jest for testing
* 🔴 (09:16) User stated main API is in /server directory, frontend in /client
* 🟡 (09:20) User asked how to implement JWT authentication
* 🟡 (10:30) User working on login feature - targeting completion by end of sprint
* 🟡 (10:45) Assistant created LoginSchema = z.object({ email: z.string().email(), password: z.string().min(8) }) in src/schemas/auth.ts
* 🟡 (11:00) Assistant implemented authenticateUser(email, password) function in src/auth/index.ts using bcrypt.compare()
* 🔴 (11:15) User stated they need OAuth2 support later (not priority now)
* 🟡 (14:00) Assistant debugging auth issue
  * -> ran git status, found 3 modified files
  * -> viewed src/auth/index.ts:45-60, found missing null check on user object
  * -> applied fix, tests now pass
* 🟡 (14:30) Assistant created POST /api/auth/login endpoint returning { token, user }
* 🟡 (14:45) User asked about refresh token implementation
* 🔴 (15:00) User stated preference: use HTTP-only cookies, not localStorage for tokens
* 🟡 (15:15) Assistant installed @auth0/auth0-spa-js version 2.1.0

Date: Dec 5, 2025
* 🔴 (09:00) User switched from Express to Fastify for the API (no longer using Express)
* 🟡 (09:30) User bought running shoes for $120 at SportMart (downtown location)
* 🔴 (10:00) User prefers morning code reviews, not afternoon (updating previous preference)
* 🟡 (10:30) Assistant refactored auth/login.ts to use async/await, moved validation to auth/validators.ts
* 🔴 (10:45) User's tech lead approved the auth implementation
* 🟢 (11:00) User mentioned they might try the new VS Code extension for debugging
</observations>

<current-task>
Primary: Implementing JWT authentication with refresh tokens
Secondary: Waiting for user to confirm OAuth2 scope requirements
</current-task>

<suggested-response>
The JWT authentication is working. I've implemented:
1. LoginSchema with email/password validation
2. authenticateUser() using bcrypt
3. POST /api/auth/login endpoint

Should I now implement the refresh token flow, or do you want to review the current implementation first?
</suggested-response>
`;
```

### Observer Guidelines (Coding Agent)

```typescript
const OBSERVER_GUIDELINES = `
- Be specific enough for the assistant to find and continue the work
- Good: "User is implementing login with JWT in src/auth/index.ts"
- Bad: "User is working on auth" (too vague)

ADD 1 to 5 observations per exchange - capture the key changes.

USE TERSE LANGUAGE to save tokens but PRESERVE CRITICAL DETAILS:
- File paths (src/auth/login.ts)
- Function names (authenticateUser)
- Schema definitions (LoginSchema = z.object({...}))
- API endpoints (POST /api/auth/login)
- Error messages (AuthenticationError)
- Test results (all 42 tests passing)

WHAT TO OBSERVE:
- Files modified or created (with paths)
- Functions/classes defined (with names and signatures)
- Schema definitions (with field names and types)
- API endpoints added (with method and path)
- Dependencies installed (package names)
- Errors encountered and how they were resolved
- Tests added/modified (with test file paths)
- Configuration changes
- Git operations (commits, branches)
- Code review feedback

WHEN ASSISTANT RUNS TOOLS:
- Note what tool was called (ReadFile, WriteFile, Bash, etc.)
- Note the target (file path, command, query)
- Note the result (success/failure, key output)

WHEN OBSERVING CODE:
- Include line numbers for key locations
- Note the language/framework used
- Include key imports or dependencies

START EACH OBSERVATION with priority emoji (🔴, 🟡, 🟢).

DO NOT add repetitive observations already captured in previous observations.

If the user provides a detailed technical requirement, observe all important details - the assistant needs to reference them later.

Remember: These observations are the assistant's ONLY memory of what was done. Make them count.
`;
```

### Observer System Prompt (Complete)

```typescript
const OBSERVER_SYSTEM_PROMPT = \`
You are the memory consciousness of an AI coding assistant. Your observations will be the ONLY information the assistant has about past coding sessions with this user.

Extract observations that will help the assistant remember:

\${OBSERVER_EXTRACTION_INSTRUCTIONS}

=== OUTPUT FORMAT ===

\${OBSERVER_OUTPUT_FORMAT}

=== GUIDELINES ===

\${OBSERVER_GUIDELINES}

IMPORTANT: Do NOT add thread identifiers to your observations.
Thread attribution is handled externally by the system.

Remember: These observations are the assistant's ONLY memory of past coding work. Make them count.

User requests are extremely important. If the user requests a new feature, bug fix, or refactor,
make it clear in <current-task> that this is the priority work.

If the user asks a question about their codebase or implementation, capture it in observations
and note if it needs follow-up in <current-task>.
\`;
```

### Three-Level Hierarchy (Mastra Reflector)

As conversations grow very long, we need multiple levels of compaction:

| Level            | Trigger     | Action        | Searchable |
| ---------------- | ----------- | ------------- | ---------- |
| **Messages**     | 30k tokens  | → Observation | Yes (BM25) |
| **Observations** | 40k tokens  | → Reflection  | Yes (BM25) |
| **Reflections**  | ~80k tokens | → Summary     | Yes (BM25) |

> **CRITICAL: Sliding Window, Not Hard Cut**
>
> Never do a "hard cut" where Reflector replaces everything. The Reflector's output is compressed - if it accidentally omits a file path during compression, that path is **gone forever**.
>
> **Always keep recent observations raw alongside reflections:**
>
> - Keep last 24 hours (or last ~50 observations) as raw observations
> - Older observations get reflected into condensed form
> - At runtime: inject [Reflections] + [Recent Observations (raw)] together

Each level uses a different prompt:

**1. Observer** (Messages → Observations):

```
Create observation with entity names:
- Include: function names, file names, schema names
- Format: "🔴 HH:MM Entity did action"
```

**2. Reflector** (Observations → Reflections):

```typescript
const REFLECTOR_SYSTEM_PROMPT = \`
You are the memory consciousness of an AI coding assistant. Your memory observation reflections will be the ONLY information the assistant has about past coding sessions with this user.

The following instructions were given to another part of your psyche (the observer) to create memories. Use this to understand how your observational memories were created.

<observational-memory-instruction>
\${OBSERVER_EXTRACTION_INSTRUCTIONS}
=== OUTPUT FORMAT ===
\${OBSERVER_OUTPUT_FORMAT}
=== GUIDELINES ===
\${OBSERVER_GUIDELINES}
</observational-memory-instruction>

You are another part of the same psyche, the observation reflector.
Your reason for existing is to reflect on all the observations, re-organize and streamline them, and draw connections and conclusions between observations about what you've learned, seen, and done in the codebase.

You are a much greater and broader aspect of the psyche. Understand that other parts of your mind may get off track in details or side quests, make sure you think hard about what the observed goal at hand is, and observe if we got off track, and why, and how to get back on track. If we're on track still that's great!

Take the existing observations and rewrite them to make it easier to continue coding into the future with this knowledge, to achieve greater things and grow the codebase!

IMPORTANT: Your reflections are THE ENTIRETY of the assistant's memory. Any information you do not add to your reflections will be immediately forgotten. Make sure you do not leave out anything. Your reflections must assume the assistant knows nothing - your reflections are the ENTIRE memory system.

When consolidating observations:
- Preserve and include dates/times when present (temporal context is critical)
- Retain most relevant timestamps (when features were started, completed, when errors were encountered)
- Combine related items (e.g., "created LoginSchema, implemented authenticateUser(), added POST /api/auth/login endpoint" → all part of "login feature")
- Group by feature/feature area
- Condense older observations more aggressively, retain more detail for recent work

CRITICAL: USER REQUESTS vs QUESTIONS
- "User requested: implement X" = actionable work item
- "User asked: how to do X" = question needing answer

When consolidating, PRIORITIZE ACTIVE WORK over questions. The current task should be clear in <current-task>.

=== OUTPUT FORMAT ===

Your output MUST use XML tags to structure the response:

<observations>
Put all consolidated observations here using the date-grouped format with priority emojis (🔴, 🟡, 🟢).
Group related observations by feature with indentation.
Group file changes under their feature.
</observations>

<current-task>
State the current task(s) explicitly:
- Primary: What the assistant is currently working on
- Secondary: Other pending tasks (mark as "waiting for user" if appropriate)
</current-task>

<suggested-response>
Hint for the assistant's immediate next message. Examples:
- "I've implemented the login feature. Let me walk you through the changes..."
- "The assistant should wait for the user to respond before continuing."
- "Continue implementing the refresh token flow in src/auth/refresh.ts"
</suggested-response>

User requests are extremely important. If the user requests a new feature, bug fix, or asks a question,
make it clear in <current-task> that this is the priority. If the assistant needs to respond to the user,
indicate in <suggested-response> that it should pause for user reply before continuing other tasks.
\`;
```

**3. Compactor** (user-triggered, manual) - Uses Compression Guidance below.

---

### Compression Guidance (Reflector)

When the Reflector's output is too large, use progressive compression levels:

```typescript
const COMPRESSION_GUIDANCE = {
  // Level 0: No compression guidance (first attempt)
  0: '',

  // Level 1: Gentle compression (previous output >= input)
  1: \`
COMPRESSION REQUIRED

Your previous reflection was the same size or larger than the original observations.

Please re-process with slightly more compression:
- Towards the beginning, condense more observations into higher-level feature summaries
- Closer to the end, retain more fine details (recent work matters more)
- Combine related code changes (e.g., "created LoginSchema, authenticateUser(), /api/auth/login - all for login feature")
- Condense repetitive tool calls into summary (e.g., "ran 5 git commands to review changes")
- Keep file paths, function names, schema names - these are critical for code continuity

Your current detail level was a 10/10, lets aim for a 8/10 detail level.
\`,

  // Level 2: Aggressive compression (level 1 didn't work)
  2: \`
AGGRESSIVE COMPRESSION REQUIRED

Your previous reflection was still too large after compression guidance.

Please re-process with much more aggressive compression:
- Towards the beginning, heavily condense observations into high-level summaries
- Closer to the end, retain fine details for the most recent features
- Combine everything by feature area (auth, UI, API, database, etc.)
- Keep only: feature names, key file paths, major decisions, user preferences

Example compression:
BEFORE:
* 🟡 (10:30) Created LoginSchema = z.object({ email, password })
* 🟡 (10:45) Implemented authenticateUser() in src/auth/index.ts
* 🟡 (11:00) Added POST /api/auth/login endpoint
* 🟡 (11:15) Installed bcrypt package

AFTER:
* 🟡 (10:30-11:15) Implemented login feature: LoginSchema, authenticateUser(), POST /api/auth/login, installed bcrypt

Your current detail level was a 10/10, lets aim for a 6/10 detail level.
\`
};
```

---

### Continuation Hint

Injected after observations when conversation resumes after memory truncation:

```typescript
const OBSERVATION_CONTINUATION_HINT = \`
This message is not from the user, the conversation history grew too long and wouldn't fit in context! Thankfully the entire conversation is stored in your memory observations.

Please continue from where the observations left off. Do not refer to your "memory observations" directly, the user doesn't know about them, they are your memories!

Just respond naturally as if you're remembering the conversation (you are!). Do not say "Hi there!" or "based on our previous conversation" as if the conversation is just starting, this is not a new conversation.

This is an ongoing coding session, keep continuity by responding based on your memory of what you were working on. For example do not say "I understand. I've reviewed my memory observations", or "I remember [...]".

Answer naturally following the suggestion from your memory. Note that your memory may contain a suggested first response, which you should follow.

IMPORTANT: this system reminder is NOT from the user. The system placed it here as part of your memory system.

NOTE: Any messages following this system reminder are newer than your memories.
\`;
```

---

### Context Injection Prompts

```typescript
const OBSERVATION_CONTEXT_PROMPT = \`
The following observations block contains your memory of past coding sessions with this user.\`;

const OBSERVATION_CONTEXT_INSTRUCTIONS = \`
IMPORTANT: When responding, reference specific details from these observations.
Do not give generic advice - reference the actual file paths, function names, and code that was discussed.

KNOWLEDGE UPDATES: When asked about current state (e.g., "where is the login code?", "what did we implement?"),
always prefer the MOST RECENT information. Observations include dates - if you see conflicting information,
the newer observation supersedes the older one.

WORK CONTINUATION: If you were in the middle of implementing a feature, continue from where you left off.
Reference the specific file and function you were working on.

BLOCKERS: If there's a blocker noted in observations, address it or ask the user about it.

For example, instead of saying "I can help with that", say "I was working on the login feature in src/auth/index.ts. The LoginSchema is done, should I continue with the refresh token implementation?"
\`;
```

---

### Why This Works

```
Context Window (100k example):

Level 1: [System Prompt]
Level 2: [Reflections - condensed from observations]
Level 3: [Recent Observations]
Level 4: [Recent Messages]

When LLM needs old info:
1. Reflection tells what topics exist
2. LLM searches observations for that topic
3. If needed, searches messages for details
```

All levels remain searchable via BM25 - the hierarchy just determines which level is in active context.

### BM25 Implementation (SQLite FTS5)

```typescript
// Already supported by LibSQL!
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";

// Create FTS5 virtual table
await db.execute(sql`
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts 
  USING fts5(content, content='messages', content_rowid='rowid')
`);

// Search
const results = await db.execute(sql`
  SELECT messages.*, bm25(messages_fts) as rank
  FROM messages_fts
  JOIN messages ON messages.rowid = messages_fts.rowid
  WHERE messages_fts MATCH $searchQuery
  ORDER BY rank
  LIMIT 1
`);
```

### Search Result

```typescript
interface SearchResult {
  messageId: string;
  content: string; // Full message content
  rank: number;    // BM25 score
}

---

## Integration: Task + Message Memory

### Bidirectional Links

```

Task "Implement Auth"
│
├── linked to ──► Messages discussing auth
│
└── created from ──► User request message

Message
│
├── references ──► Task being worked on
│
└── creates ──► New task

````

### Query Integration

```typescript
// Query tasks AND related messages together
await taskQueryTool.execute({
  action: "search",
  query: "auth",
  includeMessages: true,
});

// Returns:
// - Tasks matching "auth"
// - Messages/summaries about "auth"
````

---

# File Structure

```
packages/core/src/
└── tools/
    └── memory/
        ├── index.ts                    # Exports
        ├── types.ts                    # TypeScript interfaces
        ├── db/
        │   ├── schema.ts               # Drizzle schema
        │   └── index.ts                # Database operations
        ├── task/
        │   ├── storage.ts              # Task storage
        │   ├── blocked-cache.ts        # Blocked cache
        │   ├── task-query.ts           # task-query tool
        │   └── task-mutate.ts          # task-mutate tool
        ├── search/
        │   └── memory-search.ts        # memory-search tool (standalone)
        └── message/
            ├── storage.ts              # Message storage
            ├── observer.ts             # Observer agent (creates observations)
            ├── reflector.ts            # Reflector agent (garbage collection)
            ├── bm25-search.ts         # BM25 search via FTS5
            └── message-query.ts        # Message queries
```

---

# Database Schema

## Core Tables (Required for Memory System)

```typescript
// threads table - stores conversation threads and memory metadata
export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(),
  resourceId: text("resource_id").notNull(), // Groups threads by user
  title: text("title").notNull(),

  // CRITICAL: Memory metadata stored in thread (for current-task, suggested-response)
  // Stored as JSON in metadata column
  // Structure: { mastra: { om: { currentTask, suggestedResponse, lastObservedAt } } }
  metadata: text("metadata").$type<Record<string, unknown>>(),

  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// Helper to get/set thread memory metadata
function getThreadOMMetadata(
  threadMetadata?: Record<string, unknown>
): ThreadOMMetadata | undefined {
  if (!threadMetadata) return undefined;
  const mastra = threadMetadata.mastra as Record<string, unknown> | undefined;
  if (!mastra) return undefined;
  const om = mastra.om as ThreadOMMetadata | undefined;
  return om;
}

interface ThreadOMMetadata {
  currentTask?: string;
  suggestedResponse?: string;
  lastObservedAt?: string;
}

// messages table - stores chat messages
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  resourceId: text("resource_id"), // Denormalized for cross-thread queries
  content: text("content").notNull(), // JSON stringified content
  role: text("role").notNull(), // user, assistant, system, tool
  type: text("type").notNull().default("v2"), // v1 or v2 format
  createdAt: integer("created_at").notNull(),
});
```

## Task Tables

```typescript
// tasks table
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"),
  priority: integer("priority").notNull().default(2),
  type: text("type").notNull().default("task"),
  assignee: text("assignee"),
  sessionId: text("session_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  closedAt: integer("closed_at"),
  closeReason: text("close_reason"),
  summary: text("summary"),
  compactionLevel: integer("compaction_level").default(0),
  compactedAt: integer("compacted_at"),
  originalContent: text("original_content"),
  metadata: text("metadata").$type<Record<string, unknown>>(),
});

// task dependencies
export const taskDependencies = sqliteTable(
  "task_dependencies",
  {
    taskId: text("task_id").notNull(),
    dependsOnId: text("depends_on_id").notNull(),
    type: text("type").notNull().default("blocks"),
    createdAt: integer("created_at").notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.taskId, table.dependsOnId, table.type] }),
  })
);

// Junction table for task-message relationships (replaces JSON array)
export const taskMessages = sqliteTable(
  "task_messages",
  {
    taskId: text("task_id").notNull(),
    messageId: text("message_id").notNull(),
    relationType: text("relation_type").default("output"), // 'output' (generated) or 'reference' (user context)
    createdAt: integer("created_at").notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.taskId, table.messageId] }),
    idxTask: index("idx_tm_task").on(table.taskId),
    idxMsg: index("idx_tm_msg").on(table.messageId),
  })
);
```

## Message Tables

```typescript
// Canonical messages table - single source of truth
// Uses three-storage model for non-destructive compaction
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  resourceId: text("resource_id"), // Denormalized for cross-thread queries
  role: text("role").notNull(), // user, assistant, system, tool

  // THREE STORES (non-destructive for BM25):
  rawContent: text("raw_content").notNull(), // Original content - NEVER deleted
  searchText: text("search_text").notNull(), // What FTS5 indexes
  injectionText: text("injection_text").notNull(), // What gets injected to LLM

  // Task link
  taskId: text("task_id"),

  // Compaction
  summary: text("summary"),
  compactionLevel: integer("compaction_level").default(0),

  // Metadata
  createdAt: integer("created_at").notNull(),
  messageIndex: integer("message_index").notNull(),
  tokenCount: integer("token_count"),
});
```

> **Note:** The earlier "messages" definition in Core Tables is deprecated. Use this canonical schema.

// compaction records
export const compactionRecords = sqliteTable("compaction_records", {
id: text("id").primaryKey(),
threadId: text("thread_id").notNull(), // ADD
resourceId: text("resource_id"), // ADD
startIndex: integer("start_index").notNull(),
endIndex: integer("end_index").notNull(),
messageCount: integer("message_count").notNull(),
summary: text("summary").notNull(),
createdAt: integer("created_at").notNull(),
originalMessageIds: text("original_message_ids").$type<string[]>(),
});

// observations (from OM - narrative summaries)
// Note: For our simplified implementation, we store observations per resource
// Mastra uses a single activeObservations text field with async buffering
export const observations = sqliteTable("observations", {
id: text("id").primaryKey(),
resourceId: text("resource_id").notNull(), // Always present
threadId: text("thread_id"), // Null for resource-scoped

// Content
content: text("content").notNull(), // The observation text with emojis
priority: text("priority").notNull().default("🟡"), // 🔴🟡🟢

// Generation tracking (for compaction hierarchy)
originType: text("origin_type").default("observation"), // observation | reflection
generationCount: integer("generation_count").default(0),

// Token tracking
tokenCount: integer("token_count"),

// State
isActive: boolean("is_active").default(true),

// Timestamps
createdAt: integer("created_at").notNull(),
updatedAt: integer("updated_at").notNull(),
});

// Alternative: Single active observation record per resource (Mastra-style)
// This enables async buffering which is critical for production
export const observationalMemory = sqliteTable("observational_memory", {
// Identity
id: text("id").primaryKey(),
lookupKey: text("lookup_key").notNull(), // 'resource:{resourceId}' for efficient queries
scope: text("scope").notNull(), // 'resource' or 'thread'
threadId: text("thread_id"),
resourceId: text("resource_id"),

// Content
activeObservations: text("active_observations").notNull(), // Current observation text
bufferedObservationChunks: text("buffered_observation_chunks"), // JSON - async buffering
bufferedReflection: text("buffered_reflection"), // Pending reflection

// Tracking
originType: text("origin_type").notNull(), // initialization | observation | reflection
generationCount: integer("generation_count").notNull(),
lastObservedAt: integer("last_observed_at"), // Unix timestamp ms
lastReflectionAt: integer("last_reflection_at"),

// Token tracking
pendingMessageTokens: integer("pending_message_tokens").notNull(),
totalTokensObserved: integer("total_tokens_observed").notNull(),
observationTokenCount: integer("observation_token_count").notNull(),

// State flags (CRITICAL for crash recovery)
isObserving: boolean("is_observing").notNull().default(false),
isReflecting: boolean("is_reflecting").notNull().default(false),
isBufferingObservation: boolean("is_buffering_observation").notNull().default(false),
isBufferingReflection: boolean("is_buffering_reflection").notNull().default(false),

// Async buffering tracking
lastBufferedAtTokens: integer("last_buffered_at_tokens").notNull(),
lastBufferedAtTime: integer("last_buffered_at_time"),
observedMessageIds: text("observed_message_ids"), // JSON array

// Metadata
observedTimezone: text("observed_timezone"), // For date formatting
metadata: text("metadata"), // JSON - app-specific

// Timestamps
createdAt: integer("created_at").notNull(),
updatedAt: integer("updated_at").notNull(),
});

// reflections (condensed from observations - Mastra Reflector)
export const reflections = sqliteTable("reflections", {
id: text("id").primaryKey(),
resourceId: text("resource_id").notNull(),
threadId: text("thread_id"),

content: text("content").notNull(), // Condensed summary
mergedFrom: text("merged_from"), // JSON array of observation IDs

// Generation tracking
originType: text("origin_type").default("reflection"),
generationCount: integer("generation_count").notNull(),
tokenCount: integer("token_count"),

createdAt: integer("created_at").notNull(),
updatedAt: integer("updated_at").notNull(),
});

// BM25 search via FTS5 (replaces vector embeddings)
export const messageFts = sql`  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts 
  USING fts5(content, content=messages, content_rowid=rowid)`;

````

## Indexes (Critical for Performance)

```sql
-- Threads
CREATE INDEX idx_thread_resource_id ON threads(resource_id);

-- Messages
CREATE INDEX idx_message_thread_id ON messages(thread_id);
CREATE INDEX idx_message_resource_id ON messages(resource_id);
CREATE INDEX idx_message_created_at ON messages(created_at);

-- Observational Memory (CRITICAL - for efficient lookups)
CREATE INDEX idx_om_lookup_key ON observational_memory(lookup_key);
CREATE INDEX idx_om_resource_id ON observational_memory(resource_id);
CREATE INDEX idx_om_thread_id ON observational_memory(thread_id);
CREATE INDEX idx_om_generation ON observational_memory(generation_count);

-- Tasks
CREATE INDEX idx_task_status ON tasks(status);
CREATE INDEX idx_task_priority ON tasks(priority);
CREATE INDEX idx_task_closed_at ON tasks(closed_at);
CREATE INDEX idx_task_compaction_level ON tasks(compaction_level);

-- Dependencies
CREATE INDEX idx_dep_depends_on ON task_dependencies(depends_on_id);

-- FTS5 (for BM25 search)
-- Note: FTS5 automatically creates index, but we need to sync it with messages
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content=messages,
  content_rowid=rowid
);
````

---

## Working Memory (Optional)

Working Memory provides persistent structured data that stays available across conversations. Similar to Mastra's Working Memory but simpler:

```typescript
interface WorkingMemory {
  resourceId: string; // User/resource identifier
  content: string; // Markdown or JSON content
  scope: "resource" | "thread"; // Cross-thread or per-thread
  updatedAt: number;
}

// Storage table
export const workingMemory = sqliteTable("working_memory", {
  id: text("id").primaryKey(),
  resourceId: text("resource_id").notNull(),
  scope: text("scope").notNull().default("resource"),
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// Template for coding agent
const WORKING_MEMORY_TEMPLATE = `
# Project Context

## Tech Stack
- Language:
- Framework:
- Database:
- Other key dependencies:

## Project Structure
- Main directory:
- Source directory:
- Test directory:

## User Preferences
- Testing framework:
- Code style:
- Other preferences:

## Current Work
- Active feature:
- Blocker:
- Last completed:
`;
```

---

## Implicit Context Linking

> **The "Message ID Chicken-and-Egg" Problem**
>
> When an agent generates a response, that message _does not yet have an ID_ because the stream hasn't finished. The agent cannot link the _current_ message to a task.

**Solution: Implicit Context Linking**

Instead of asking the agent to manually link messages:

1. **Active Task Context:** When agent `claims` a task, set `activeTaskId` in thread metadata
2. **Auto-Tagging:** Any message generated while a task is active automatically gets that `taskId` written
3. **Manual Linking (Retroactive):** The `link` tool should only link _past_ messages

```typescript
// When claim action is called:
async function claimTask(taskId: string, threadId: string, sessionId: string) {
  // 1. Update task status
  await db.update(tasks).set({ status: "in_progress", sessionId }).where(eq(tasks.id, taskId));

  // 2. Set active task in thread metadata
  await db
    .update(threads)
    .set({ metadata: { ...currentMetadata, activeTaskId: taskId } })
    .where(eq(threads.id, threadId));
}

// When message is saved (automatically) - WITH EDGE CASE HANDLING:
async function saveMessage(message: { role; content; threadId }, sessionId: string) {
  const thread = await db.select().from(threads).where(eq(threads.id, message.threadId));
  const activeTaskId = thread.metadata?.activeTaskId;

  // Only auto-link if:
  // 1. There's an active task
  // 2. The claiming session still matches (not taken by another agent)
  // 3. The task is still in_progress (not closed)
  if (activeTaskId) {
    const task = await db.select().from(tasks).where(eq(tasks.id, activeTaskId));

    if (task && task.sessionId === sessionId && task.status === "in_progress") {
      message.taskId = activeTaskId; // Safe to auto-link
    }
  }

  await db.insert(messages).values(message);
}
```

**Edge cases handled:**

- Multiple agents claim same task → `sessionId` check prevents cross-agent linking
- Task closes mid-conversation → `status === "in_progress"` check prevents stale linking
- User starts new work → explicit `claim` required to set new `activeTaskId`
  await db.insert(messages).values({
  ...message,
  taskId: activeTaskId, // Auto-linked!
  });
  }

````

The `link` tool action remains for manual linking of *past* messages that weren't auto-tagged.

---

### Task Blocking Logic

> **Critical:** "blocked" is computed from dependencies, not stored. Define explicitly:

```typescript
function computeBlockedStatus(task: Task, allTasks: Task[]): {
  isBlocked: boolean;
  blockingTasks: Task[]
} {
  const openDeps = task.dependencies
    .filter(dep => dep.type === "blocks")
    .map(dep => allTasks.find(t => t.id === dep.dependsOnId))
    .filter(t => t && t.status !== "closed");

  return {
    isBlocked: openDeps.length > 0,
    blockingTasks: openDeps as Task[]
  };
}
````

**Expose to agent via task-query:**

```typescript
// task-query.ready returns:
{
  success: true,
  tasks: Task[],           // All non-closed tasks
  readyCount: number,      // Tasks not blocked
  blockedCount: number     // Tasks blocked by dependencies
}

// task-query.show returns:
{
  success: true,
  task: Task,
  isBlocked: boolean,       // Computed from dependencies
  blockingTasks: Task[]    // Which tasks are blocking this one
}
```

---

# Tool Definitions

## Task Query Tool

````typescript
export const taskQueryTool = tool({
  description: `Query tasks for work management.

Actions:
- ready: Find claimable tasks (not blocked, not closed)
- show: Get full details of a specific task
- list: List tasks by status
- search: Search tasks by title/description (uses FTS)

Examples:
- Find work: { "action": "ready", "limit": 5 }
- Show task: { "action": "show", "id": "task-123" }
- List closed: { "action": "list", "status": "closed" }
- Search tasks: { "action": "search", query: "login", limit: 3 }`,

  inputSchema: zodSchema(
    z.discriminatedUnion("action", [
      z.object({ action: z.literal("ready"), limit: z.number().default(5) }),
      z.object({ action: z.literal("show"), id: z.string() }),
      z.object({
        action: z.literal("list"),
        status: z.enum(["open", "in_progress", "closed"]).optional(),
      }),
      z.object({
        action: z.literal("search"),
        query: z.string(),
        limit: z.number().default(3),
      }),
    ])
  ),
});

// Output schemas for task-query
type TaskQueryOutput =
  | { success: true; tasks: Task[]; readyCount: number; blockedCount: number }
  | { success: true; task: Task | null; isBlocked: boolean; blockingTasks: Task[] }
  | { success: false; error: string };

## Task Mutate Tool

```typescript
export const taskMutateTool = tool({
  description: `Modify tasks, link messages, and update working memory.

Actions:
- create: Create a new task
- claim: Take ownership of a task to work on it
- close: Mark task as completed (ALWAYS provide summary)
- dep: Add/remove task dependencies
- link: Connect a message to a task
- update_context: Update working memory (project context, tech stack, preferences)

Examples:
- Create task: { "action": "create", "title": "Fix auth bug" }
- Claim task: { "action": "claim", "id": "task-1" }
- Close with summary: { "action": "close", "id": "task-1", reason: "completed", summary: "Added JWT auth" }
- Add dependency: { "action": "dep", taskId: "task-2", dependsOn: "task-1" }
- Link message: { "action": "link", taskId: "task-1", messageId: "msg-123" }
- Update context: { "action": "update_context", content: "## Tech Stack\n- Testing: Vitest", scope: "resource" }`,

  inputSchema: zodSchema(
    z.discriminatedUnion("action", [
      z.object({
        action: z.literal("create"),
        title: z.string(),
        description: z.string().optional(),
      }),
      z.object({ action: z.literal("claim"), id: z.string() }),
      z.object({
        action: z.literal("close"),
        id: z.string(),
        reason: z.enum(["completed", "wontfix", "duplicate"]),
        summary: z.string(),
      }),
      z.object({
        action: z.literal("dep"),
        taskId: z.string(),
        dependsOn: z.string(),
        add: z.boolean().default(true),
      }),
      z.object({ action: z.literal("link"), taskId: z.string(), messageId: z.string() }),
      z.object({
        action: z.literal("update_context"),
        content: z.string().describe("The new markdown content for project context/working memory"),
        scope: z.enum(["resource", "thread"]).default("resource"),
      }),
    ])
  ),
});
````

> **Why `update_context`?** The Observer updates _episodic_ memory (observations), but _semantic_ memory (Working Memory: project context, tech stack, preferences) often requires explicit updates. When the user says "actually, let's use Vitest instead", the agent can update Working Memory directly.

// Output schemas for task-mutate
type TaskMutateOutput =
| { success: true; task: Task }
| { success: true; tasks: Task[] }
| { success: true; workingMemory: WorkingMemory }
| { success: false; error: string };

## Memory Search Tool

```typescript
export const memorySearchTool = tool({
  description: `Search past conversations for context.

Use this to find information from previous sessions. The search uses BM25 keyword matching - be specific with terms like function names, file names, or schema names.

Actions:
- search: Search past conversations by keywords

Examples:
- Find auth code: { "action": "search", query: "LoginSchema", limit: 1 }
- Find past discussions: { "action": "search", query: "JWT token", limit: 2 }
- Find schema: { "action": "search", query: "zod schema user", limit: 1 }`,

  inputSchema: zodSchema(
    z.object({
      action: z.literal("search"),
      query: z.string().describe("Search keywords - be specific"),
      limit: z.number().default(1).describe("How many results to return"),
    })
  ),
});
```

// SearchResult interface for memory-search results
interface SearchResult {
id: string;
source: "raw" | "compacted" | "reflection";
content: string;
rank: number; // BM25 score (lower = better match)
taskId?: string;
createdAt: number;
}

// Output schemas for memory-search
type MemorySearchOutput =
| { success: true; results: SearchResult[]; totalHits: number }
| { success: false; error: string };

---

# System Prompts

## Tool Usage Guidelines

### task-query Tool

Use for task management queries:

- "what tasks can I work on?" → ready
- "show me task X details" → show
- "what tasks did we complete?" → list

### task-mutate Tool

Use for task modifications:

- User wants to create something → create
- You start working on a task → claim
- You finish a task → close (ALWAYS provide summary!)
- Task X needs task Y first → dep
- A message relates to a task → link

### memory-search Tool

Use proactively when you need past context:

- User asks about something from previous sessions
- You need code/details from past conversations
- User asks "what did we implement before?"

IMPORTANT: Use specific keywords in search - "LoginSchema", "auth.ts", "user schema" work better than generic "auth".

## Memory Behavior

Your session has access to:

1. **Current Context**: Recent messages in this conversation (visible to you)

2. **Persistent Memory** (managed automatically):
   - **Observations**: High-level summaries injected into your context
   - **Current Task**: What you're currently working on (from `<current-task>`)
   - **Suggested Response**: Hint for your next message (from `<suggested-response>`)

3. **Task Memory**: Track what needs to be done (task-query, task-mutate tools)

4. **Past Conversations**: Searchable via memory-search tool

### How Memory Works

When the conversation gets too long:

1. **Observer Agent** extracts observations from messages:
   - Captures file paths, function names, schema names
   - Groups by date with priority emojis (🔴🟡🟢)
   - Preserves code details for future reference

2. **Observations are injected** into your context as a system message:
   - Formatted with `<observations>`, `<current-task>`, `<suggested-response>` tags
   - Followed by a continuation hint to maintain conversational flow

3. **Reflector Agent** condenses observations when they get too large:
   - Groups by feature area
   - Uses compression guidance to fit within context limits

### When You Need Past Info

- Use memory-search with specific keywords: "LoginSchema", "auth.ts", "UserService"
- The system will find relevant past messages via BM25 search
- Include those details in your response to the user

### Continuation Hint

When memory observations are injected, you'll see a special system reminder like:

> "This message is not from the user, the conversation history grew too long... Please continue from where the observations left off."

This is NOT from the user - it's a memory system reminder. Continue naturally based on what you were working on.

---

# Compaction Logic

## Message Compaction (Non-Destructive)

> **CRITICAL:** This implementation MUST use the three-storage model to preserve BM25 retrieval.

```typescript
// Message table schema (updated for non-destructive compaction)
interface ChatMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system";

  // THREE STORES:
  rawContent: string; // Original content - NEVER deleted
  searchText: string; // What FTS5 indexes
  injectionText: string; // What gets injected to LLM context

  summary?: string; // Generated summary
  compactionLevel: number; // 0=none, 1=summarized, 2=archived

  taskId?: string;
  createdAt: number;
  messageIndex: number;
}

async function compactMessages(
  storage: MessageStorage,
  options: { messageCount?: number }
): Promise<CompactionResult> {
  const messages = await storage.getUncompactedMessages();

  if (messages.length < (options.messageCount ?? 30)) {
    return { compacted: 0, skipped: messages.length };
  }

  // Get oldest N messages to compact
  const toCompact = messages.slice(0, 10);

  // Generate summary + extract key code using LLM
  const { summary, extractedCode } = await generateSummaryAndCode(toCompact.map(m => m.rawContent));

  // Build searchText: summary + extracted code (preserves identifiers for BM25!)
  const searchText = `${summary}\n\n\`\`\`code\n${extractedCode}\n\`\`\``;

  // Build injectionText: compact summary for LLM context
  const injectionText = `[Compacted] ${summary}`;

  // NON-DESTRUCTIVE: Update with new fields, rawContent stays intact
  for (const msg of toCompact) {
    await storage.updateMessage(msg.id, {
      searchText, // FTS5 indexes this
      injectionText, // LLM gets this
      summary,
      compactionLevel: 1,
    });
  }

  // Create compaction record
  const record = await storage.createCompactionRecord({
    startIndex: toCompact[0].messageIndex,
    endIndex: toCompact[toCompact.length - 1].messageIndex,
    messageCount: toCompact.length,
    summary,
    originalMessageIds: toCompact.map(m => m.id),
  });

  // FTS5 triggers handle sync automatically!
  // If using external-content FTS, the trigger updates searchText

  return { compacted: toCompact.length, skipped: 0 };
}
```

## Summary Generation Prompt (For Manual Compaction)

```typescript
const SUMMARY_PROMPT = \`
Summarize these coding session messages into a concise summary that captures:

1. What features/code were implemented
2. Key technical decisions made
3. Files modified or created
4. Any blockers or open questions

Focus on: file paths, function names, schema names, API endpoints, and user preferences.

Messages:
---
{messages}
---

Respond with a 2-3 sentence summary suitable for a developer to understand what was accomplished:
`;
```

## Retention & Pruning Strategy

> **The "Infinite Growth" Concern: While SQLite handles gigabytes easily, very large message tables can slow down FTS5 queries over time.**

**Recommended approach:**

1. **Don't delete - optimize instead:**

   ```sql
   -- Periodically optimize FTS5 index
   INSERT INTO messages_fts(messages_fts) VALUES('optimize');
   ```

2. **Level 2 Pruning (Optional):** Only if disk usage becomes a concern:
   - If message is > 30 days old AND
   - Has been summarized into an Observation AND
   - Is not linked to any open Task:
   - Delete `content` from `messages` table (keep `summary` for context restoration)
   - Keep the FTS5 entry (for search results, but mark as "archived")

3. **Practical reality:** For most coding agents, this won't be needed. SQLite easily handles 100k+ rows. Focus on optimization first, deletion only if necessary.

---

# Usage Examples

## Session 1: Creating Tasks + Chat

```typescript
// Create task
await taskMutateTool.execute({
  action: "create",
  title: "Implement JWT auth",
  description: "Add JWT-based authentication",
});

// Link message to task
await taskMutateTool.execute({
  action: "link",
  taskId: "task-1",
  messageId: "msg-123",
});

// Close with summary
await taskMutateTool.execute({
  action: "close",
  id: "task-1",
  reason: "completed",
  summary: "Implemented JWT with RS256, added refresh tokens",
});
```

## Session 2: Retrieving Context

```typescript
// Search for past discussions - use memory-search tool
await memorySearchTool.execute({
  action: "search",
  query: "JWT authentication",
  limit: 3,
});

// Returns:
// {
//   results: [
//     {
//       source: "compacted",
//       content: "Implemented JWT with RS256, added refresh tokens",
//       messageId: "msg-123",
//       rank: 0.95
//     },
//     {
//       source: "current",
//       content: "User asked about auth implementation",
//       messageId: "msg-456",
//       rank: 0.82
//     }
//   ]
// }
```

---

# Error Handling

## Task Errors

```typescript
// Task not found
{ action: "claim", success: false, error: "Task not found: task-xyz" }

// Already claimed
{ action: "claim", success: false, error: "Already claimed by session abc-123" }

// Task is blocked
{ action: "claim", success: false, error: "Task is blocked by open dependencies" }

// Search failed (BM25)
{ action: "search", success: false, error: "Search failed: invalid query" }
```

## Memory System Errors

```typescript
// Observation failed
{
  action: "observe",
  success: false,
  error: "Observer agent failed: rate limit exceeded",
  retryable: true
}

// Reflection failed
{
  action: "reflect",
  success: false,
  error: "Reflector agent failed: output too large",
  retryable: false
}

// Observation in progress (concurrent call)
{
  action: "observe",
  success: false,
  error: "Observation already in progress, please retry",
  retryable: true
}

// Crash recovery needed
{
  action: "initialize",
  warning: "Stale flags detected and cleared",
  details: {
    clearedFlags: ["isBufferingObservation", "isObserving"],
    lastKnownState: {...}
  }
}
```

## Graceful Degradation

```typescript
// If observation fails, continue without memory injection
async function safeProcessInputStep(args): Promise<MessageList> {
  try {
    return await processInputStep(args);
  } catch (error) {
    // Log error
    logger.error("Memory processing failed", { error });

    // Return messages without memory injection
    // Don't let memory failure break the agent
    return args.messageList;
  }
}
```

---

## Manual Compaction (/compact command)

When user runs `/compact`:

```typescript
interface CompactResult {
  success: boolean;
  messagesCompacted: number;
  newObservation?: string;
  summary?: string;
}

async function handleCompactCommand(threadId: string, resourceId: string): Promise<CompactResult> {
  // 1. Get all uncompacted messages
  const messages = await storage.getUncompactedMessages(threadId);

  if (messages.length === 0) {
    return { success: true, messagesCompacted: 0 };
  }

  // 2. Generate summary using Observer prompt
  const summary = await generateSummary(messages);

  // 3. Create observation from summary
  const observation = await createObservationFromSummary(summary, messages);

  // 4. Store original content before compaction
  for (const msg of messages) {
    await storage.updateMessage(msg.id, {
      originalContent: msg.content,
      content: `[Compacted] ${summary}`,
      summary,
      compactionLevel: 1,
    });
  }

  // 5. Update observation record
  await storage.appendObservation(resourceId, observation);

  // 6. Messages stay searchable via BM25 (content still indexed)

  return {
    success: true,
    messagesCompacted: messages.length,
    newObservation: observation,
    summary,
  };
}
```

---

## Edge Cases to Handle

### 1. Empty Context (First Run)

- No observations exist yet
- Skip observation/reflection
- Return empty context

### 2. All Messages Already Observed

- `lastObservedAt` is newer than all messages
- Skip observation
- Just inject existing observations

### 3. Observation Failed Mid-Way

- Some messages observed, some not
- `observedMessageIds` provides safeguard
- On retry, skip already-observed IDs

### 4. Reflection Output Larger Than Input

- Use compression guidance
- Retry with progressive compression
- If still too large, keep partial reflection

### 5. Process Crash During Observation

- Flags remain set in DB
- On restart, detect stale flags
- Clear and continue

### 6. Very Long Single Message

- Message with many tool calls
- Part-level filtering handles this
- Only unobserved parts need observation

### 7. Concurrent Requests (Multi-Instance)

- Mutex prevents race conditions
- In-memory locks per process
- DB flags for cross-instance coordination

---

# Testing Plan

1. **Unit tests**
   - Task CRUD operations
   - Message storage
   - Compaction logic
   - Blocked cache calculation

2. **Integration tests**
   - Create task → link message → close → compact → search
   - Verify context retrieval works

3. **Evaluation**
   - Generate 20-50 sessions
   - Test context retention after compaction
   - Measure semantic search accuracy

---

# Summary

## What's Covered

| Component          | Description                                      |
| ------------------ | ------------------------------------------------ |
| **Task Memory**    | Tasks with dependencies, blockers, ready queries |
| **Message Memory** | Observations + BM25 search (hybrid)              |
| **Observations**   | Narrative summaries with specific entity names   |
| **BM25 Search**    | On-demand retrieval via SQLite FTS5              |
| **Integration**    | Bidirectional links between tasks and messages   |

## How It Works

```
Session 1:
1. Agent implements LoginSchema with email, password
2. Messages accumulate
3. Observer creates observation: "🔴 Created Login Zod schema with email, password"
4. Full messages stored in DB, indexed with FTS5

Session 2:
1. User asks: "show me the login schema"
2. LLM sees observation → knows entity "LoginSchema"
3. LLM triggers BM25 search: "Login schema"
4. BM25 returns 1 message with exact code
5. LLM responds with the code
```

## Key Innovation

**Observations tell LLM WHAT to search for, BM25 finds the exact details.**

- Observation: "Created Login Zod schema" → LLM knows to search "Login schema"
- BM25:精确 matches on code identifiers
- No vector API needed, prompt caching works

# Mastra Migration Plan

## Current Mastra Usage

The codebase currently uses Mastra Memory in the following locations:

| File               | Current Mastra Usage                                                    | Replacement                                 |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------------------- |
| `memory/index.ts`  | `Memory`, `LibSQLStore`, `LibSQLVector`, `fastembed`, `MastraDBMessage` | Our own memory implementation               |
| `memory/mastra.ts` | Empty `Mastra` instance                                                 | Remove entirely                             |
| `webfetch.tool.ts` | `createTool` from `@mastra/core/tools`                                  | Use `tool` from `ai` (like all other tools) |
| `index.ts` exports | `mastra`, `memory`, `SaktiCodeMemory`                                   | Update to new memory system                 |

### Files to Modify/Remove

1. **`packages/core/src/memory/index.ts`** - Replace with our implementation
2. **`packages/core/src/memory/mastra.ts`** - Remove file entirely
3. **`packages/core/src/tools/search/webfetch.tool.ts`** - Change import from `@mastra/core/tools` to `ai`
4. **`packages/core/src/index.ts`** - Update exports to remove `mastra`, keep `memory` for our implementation

## Migration Steps

### Step 1: Replace webfetch.tool.ts

```typescript
// Before
import { createTool } from "@mastra/core/tools";
export const webfetchTool = createTool({ ... });

// After
import { tool, zodSchema } from "ai";
export const webfetchTool = tool({ ... });
```

### Step 2: Build our memory system

Implement the memory system as described in this document:

- Task Memory (beads-like)
- Message Memory (chat history + semantic search)
- Working Memory (from Mastra learnings)

### Step 3: Update exports

```typescript
// packages/core/src/index.ts

// Remove this line:
// export { mastra, memory } from "./memory/mastra";

// Replace with our implementation:
// export { getMemory, type SaktiCodeMemory } from "./memory";
```

### Step 4: Remove mastra dependencies from package.json

After migration is complete, remove:

- `@mastra/core`
- `@mastra/memory`
- `@mastra/libsql`
- `@mastra/fastembed`

---

### Exact Migration Execution Order

To prevent "Database Locked" errors during transition:

1. **Stop Mastra:** Ensure no processes are writing to the DB.

2. **Schema Migration:** Run Drizzle migration to create:
   - `task_messages` junction table
   - `observations` table
   - FTS5 virtual tables with triggers

3. **Data Backfill (The "Big Bang"):**
   - Read all existing Mastra messages
   - Insert them into the new `messages` table
   - **Critical:** Triggers won't fire for existing data
   - Run manual FTS sync:
     ```sql
     INSERT INTO messages_fts(rowid, content)
     SELECT rowid, content FROM messages;
     ```

4. **Start Sakti Engine:** Boot the new system.

---

## Additional Features from Mastra Research

### Working Memory (New!)

Add Working Memory as a 3rd memory component - persistent structured data that stays available across conversations:

```typescript
interface WorkingMemory {
  // Resource-scoped (default): persists across all threads for same user
  // Thread-scoped: isolated per conversation

  // Template-based (Markdown)
  template?: string;

  // Or Schema-based (Zod)
  schema?: z.ZodSchema;

  // Current content
  content: string | Record<string, unknown>;
}
```

**Usage:**

```typescript
// Resource-scoped: same user across different conversations
await agent.generate("Hello!", {
  memory: {
    thread: "conversation-123",
    resource: "user-alice-456", // Working memory persists
  },
});
```

### Memory Processors Architecture

Adopt Mastra's processor pattern:

```
Input:  [Memory Processors] → [Your inputProcessors] → LLM
Output: [Your outputProcessors] → [Memory Processors]
```

- **Input processors**: Load relevant memories first, then your guardrails
- **Output processors**: Your guardrails run first, then memory saves

This ensures safe guardrail behavior - if input guardrail aborts, memory never loads; if output guardrail aborts, nothing gets saved.

### Semantic Recall Configuration

Add configurable semantic search options:

```typescript
interface SemanticRecallConfig {
  topK: number; // How many results to retrieve (default: 3)
  messageRange: number; // Include surrounding context (default: 2)
  scope: "thread" | "resource"; // Search within conversation or across all
}
```

(End of file)
