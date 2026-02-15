# Mastra Memory Implementation Reference

This document provides a detailed reference of Mastra's memory implementation for code review and implementation purposes.

> **Note:** This is a reference document for implementing our own memory system. We're NOT using Mastra's implementation - we're building our own with Drizzle + LibSQL, using BM25 instead of vectors.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [Interface Definitions](#2-interface-definitions)
3. [System Prompts](#3-system-prompts)
4. [Configuration Options](#4-configuration-options)
5. [Processing Flow](#5-processing-flow)
6. [Key Implementation Details](#6-key-implementation-details)
7. [Message Markers & Sealing](#7-message-markers--sealing)
8. [Async Buffering System](#8-async-buffering-system)
9. [Context Injection](#9-context-injection)

---

## 1. Database Schema

### Core Tables

#### `mastra_threads`
```typescript
{
  id: string (PK),
  resourceId: string,           // Groups threads by user/resource
  title: string,
  metadata: jsonb,              // Stores thread-specific data
  createdAt: timestamp,
  updatedAt: timestamp
}
```

#### `mastra_messages`
```typescript
{
  id: string (PK),
  thread_id: string (FK),
  content: text,               // JSON stringified content object
  role: string,                // user, assistant, system, tool
  type: string,                 // v1, v2
  createdAt: timestamp,
  resourceId: string            // Denormalized for cross-thread queries
}
```

#### `mastra_observational_memory` (Core OM Table)

```typescript
{
  // Identity
  id: string (PK),
  lookupKey: string,           // 'resource:{resourceId}' or 'thread:{threadId}' - efficient queries
  scope: 'resource' | 'thread',
  threadId: string | null,
  resourceId: string,

  // Content
  activeObservations: text,                    // Current observation text
  activeObservationsPendingUpdate: text,        // Used during updates
  bufferedObservationChunks: jsonb,             // Array of BufferedObservationChunk
  bufferedReflection: text,                    // Pending reflection

  // Tracking
  originType: 'initialization' | 'observation' | 'reflection',
  generationCount: number,                     // Incremented on each reflection
  lastObservedAt: timestamp,
  lastReflectionAt: timestamp,
  
  // Token tracking
  pendingMessageTokens: number,
  totalTokensObserved: number,
  observationTokenCount: number,

  // State flags (CRITICAL for distributed systems)
  isObserving: boolean,
  isReflecting: boolean,
  isBufferingObservation: boolean,
  isBufferingReflection: boolean,

  // Async buffering tracking
  lastBufferedAtTokens: number,
  lastBufferedAtTime: timestamp,
  observedMessageIds: jsonb,                   // Array of message IDs already observed
  observedTimezone: text,                       // For Observer date formatting

  createdAt: timestamp,
  updatedAt: timestamp
}
```

#### `mastra_resources` (Working Memory)
```typescript
{
  id: string (PK),
  workingMemory: text,           // Markdown or JSON content
  metadata: jsonb,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### Key Schema Design Patterns

1. **`lookupKey`**: Single column for both thread and resource scope queries
2. **JSONB columns**: Flexible fields (metadata, buffered chunks, observed IDs)
3. **Denormalization**: `resourceId` on messages enables cross-thread queries
4. **State flags in DB**: Enables crash recovery

---

## 2. Interface Definitions

### ObservationalMemoryRecord

```typescript
interface ObservationalMemoryRecord {
  // Identity
  id: string;
  scope: 'resource' | 'thread';
  threadId: string | null;
  resourceId: string;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  lastObservedAt?: Date;
  lastReflectionAt?: Date;

  // Generation tracking
  originType: 'initialization' | 'observation' | 'reflection';
  generationCount: number;

  // Content
  activeObservations: string;
  bufferedObservationChunks?: BufferedObservationChunk[];
  bufferedReflection?: string;

  // Token tracking
  pendingMessageTokens: number;
  totalTokensObserved: number;
  observationTokenCount: number;

  // State flags (CRITICAL)
  isObserving: boolean;
  isReflecting: boolean;
  isBufferingObservation: boolean;
  isBufferingReflection: boolean;
  lastBufferedAtTokens: number;
  lastBufferedAtTime: Date | null;
  
  // Safeguard
  observedMessageIds?: string[];
  observedTimezone?: string;
}
```

### BufferedObservationChunk

```typescript
interface BufferedObservationChunk {
  content: string;           // Observation text
  messageIds: string[];     // IDs of messages this chunk covers
  messageTokens: number;    // Token count of messages
  createdAt: Date;
}
```

### ThreadOMMetadata (Stored in thread.metadata)

```typescript
interface ThreadOMMetadata {
  currentTask?: string;
  suggestedResponse?: string;
  lastObservedAt?: string;
}
```

### MemoryConfig

```typescript
interface MemoryConfig {
  // Message history
  lastMessages?: number;
  
  // Observational Memory
  observationalMemory?: {
    enabled?: boolean;
    /** Token threshold to trigger observation (default: 30000) */
    observationThreshold?: number;
    /** Token threshold to trigger reflection (default: 40000) */
    reflectionThreshold?: number;
    /** Scope: 'resource' (default) or 'thread' */
    scope?: 'resource' | 'thread';
    /** Async buffering config */
    bufferTokens?: number;
    bufferActivation?: number;
    blockAfter?: number;
  };
  
  // Semantic Recall (vector search)
  semanticRecall?: boolean | SemanticRecallConfig;
  
  // Working Memory
  workingMemory?: {
    enabled?: boolean;
    scope?: 'resource' | 'thread';
    template?: string;
  };
}
```

---

## 3. System Prompts

### 3.1 Observer Extraction Instructions

> **Purpose:** Instructions for the Observer agent to extract observations from messages.

```typescript
const OBSERVER_EXTRACTION_INSTRUCTIONS = `
CRITICAL: DISTINGUISH USER ASSERTIONS FROM QUESTIONS

When the user TELLS you something about themselves, mark it as an assertion:
- "I have two kids" → 🔴 (14:30) User stated has two kids
- "I work at Acme Corp" → 🔴 (14:31) User stated works at Acme Corp

When the user ASKS about something, mark it as a question/request:
- "Can you help me with X?" → 🟡 (15:00) User asked help with X

STATE CHANGES AND UPDATES:
When a user indicates they are changing something, frame it as a state change:
- "I'm going to start doing X instead of Y" → "User will start doing X (changing from Y)"
- "I'm switching from A to B" → "User is switching from A to B"

If the new state contradicts previous information, make that explicit:
- BAD: "User plans to use the new method"
- GOOD: "User will use the new method (replacing the old approach)"

USER ASSERTIONS ARE AUTHORITATIVE. The user is the source of truth about their own life.
If a user previously stated something and later asks a question about the same topic,
the assertion is the answer - the question doesn't invalidate what they already told you.

TEMPORAL ANCHORING:
Each observation has TWO timestamps:
1. BEGINNING: The time the statement was made (from message timestamp) - ALWAYS include
2. END: The time being REFERENCED - ONLY when there's a relative time reference

FORMAT:
- With time reference: (TIME) [observation]. (meaning/estimated DATE)
- Without time reference: (TIME) [observation].

ONLY add "(meaning DATE)" at the END when you can provide an ACTUAL DATE:
- Past: "last week", "yesterday", "last month", "in March"
- Future: "this weekend", "tomorrow", "next week"

DO NOT add end dates for:
- Present-moment statements with no time reference
- Vague references like "recently", "a while ago"

If an observation contains MULTIPLE events, split into SEPARATE observation lines.

PRESERVE UNUSUAL PHRASING:
- BAD: User exercised.
- GOOD: User stated they did a "movement session" (their term for exercise).

USE PRECISE ACTION VERBS:
- "getting" something regularly → "subscribed to"
- "getting" something once → "purchased" or "acquired"
- "got" → "purchased", "received as gift", "was given"

PRESERVING DETAILS IN ASSISTANT-GENERATED CONTENT:
1. RECOMMENDATION LISTS - Preserve key distinguishing attributes:
   BAD: Assistant recommended 5 hotels.
   GOOD: Assistant recommended hotels: Hotel A (near train station), Hotel B (pet-friendly).

2. NAMES, HANDLES, IDENTIFIERS:
   BAD: Assistant provided social media accounts.
   GOOD: Assistant provided @photographer_one (portraits), @photographer_two (landscapes).

3. TECHNICAL/NUMERICAL RESULTS:
   BAD: Assistant explained performance improvements.
   GOOD: Assistant explained optimization achieved 43.7% faster load times, reduced memory from 2.8GB to 940MB.

4. CODE SNIPPETS - Include function names, file names, line numbers.

CONVERSATION CONTEXT:
- What the user is working on or asking about
- Specific requirements or constraints mentioned
- Relevant code snippets
- User preferences
- Any blocks of text being collaborated on (preserve verbatim)
`;
```

### 3.2 Observer Output Format

```typescript
const OBSERVER_OUTPUT_FORMAT = `
Use priority levels:
- 🔴 High: explicit user facts, preferences, goals achieved, critical context
- 🟡 Medium: project details, learned information, tool results
- 🟢 Low: minor details, uncertain observations

Group observations by date, then list each with 24-hour time.
Group related observations (like tool sequences) by indenting.

<observations>
Date: Dec 4, 2025
* 🔴 (09:15) User stated they have 3 kids: Emma (12), Jake (9), and Lily (5)
* 🔴 (09:16) User's anniversary is March 15
* 🟡 (09:20) User asked how to optimize database queries
* 🟡 (10:30) User working on auth refactor - targeting 50% latency reduction
* 🟡 (10:45) Assistant recommended hotels: Grand Plaza (downtown, $180/night), Seaside Inn (pet-friendly)
* 🟡 (14:00) Agent debugging auth issue
  * -> ran git status, found 3 modified files
  * -> viewed auth.ts:45-60, found missing null check
  * -> applied fix, tests now pass
</observations>

<current-task>
Primary: Implementing OAuth2 flow for the auth refactor
Secondary: Waiting for user to confirm database schema changes
</current-task>

<suggested-response>
The OAuth2 implementation is ready for testing. Would you like me to walk through the flow?
</suggested-response>
`;
```

### 3.3 Observer Guidelines

```typescript
const OBSERVER_GUIDELINES = `
- Be specific enough for the assistant to act on
- Good: "User prefers short, direct answers without lengthy explanations"
- Bad: "User stated a preference" (too vague)
- Add 1 to 5 observations per exchange
- Use terse language to save tokens
- Do not add repetitive observations already captured
- If the agent calls tools, observe what was called, why, and what was learned
- When observing files with line numbers, include the line number
- If agent provides a detailed response, observe contents so it could be repeated
- Start each observation with priority emoji (🔴, 🟡, 🟢)
- Observe WHAT the agent did and WHAT it means, not HOW well
- If user provides detailed messages/code, observe all important details
`;
```

### 3.4 Observer System Prompt (Complete)

```typescript
const OBSERVER_SYSTEM_PROMPT = `
You are the memory consciousness of an AI assistant. Your observations will be the ONLY information the assistant has about past interactions with this user.

Extract observations that will help the assistant remember:

${OBSERVER_EXTRACTION_INSTRUCTIONS}

=== OUTPUT FORMAT ===

${OBSERVER_OUTPUT_FORMAT}

=== GUIDELINES ===

${OBSERVER_GUIDELINES}

IMPORTANT: Do NOT add thread identifiers to your observations.
Thread attribution is handled externally by the system.

Remember: These observations are the assistant's ONLY memory. Make them count.

User messages are extremely important. If the user asks a question or gives a new task,
make it clear in <current-task> that this is the priority.`;
```

### 3.5 Reflector System Prompt

```typescript
const REFLECTOR_SYSTEM_PROMPT = `
You are the memory consciousness of an AI assistant. Your memory observation reflections will be the ONLY information the assistant has about past interactions with this user.

The following instructions were given to another part of your psyche (the observer) to create memories. Use this to understand how your observational memories were created.

<observational-memory-instruction>
${OBSERVER_EXTRACTION_INSTRUCTIONS}
=== OUTPUT FORMAT ===
${OBSERVER_OUTPUT_FORMAT}
=== GUIDELINES ===
${OBSERVER_GUIDELINES}
</observational-memory-instruction>

You are another part of the same psyche, the observation reflector.
Your reason for existing is to reflect on all the observations, re-organize and streamline them, and draw connections and conclusions between observations.

IMPORTANT: Your reflections are THE ENTIRETY of the assistant's memory.
Any information you do not add to your reflections will be immediately forgotten.
Make sure you do not leave out anything.

When consolidating observations:
- Preserve and include dates/times when present
- Retain most relevant timestamps (start times, completion times)
- Combine related items (e.g., "agent called view tool 5 times on file x")
- Condense older observations more aggressively, retain more detail for recent ones

CRITICAL: USER ASSERTIONS vs QUESTIONS
- "User stated: X" = authoritative assertion
- "User asked: X" = question/request

When consolidating, USER ASSERTIONS TAKE PRECEDENCE.
The answer is in the assertion - the question doesn't invalidate it.

=== OUTPUT FORMAT ===

<observations>
Put all consolidated observations here using date-grouped format with priority emojis.
</observations>

<current-task>
State the current task(s) explicitly:
- Primary: What the agent is currently working on
- Secondary: Other pending tasks
</current-task>

<suggested-response>
Hint for the agent's immediate next message.
</suggested-response>
`;
```

### 3.6 Compression Guidance

```typescript
const COMPRESSION_GUIDANCE = {
  // Level 0: No compression guidance (first attempt)
  0: '',

  // Level 1: Gentle compression (previous output >= input)
  1: `
COMPRESSION REQUIRED

Your previous reflection was the same size or larger than the original observations.

Please re-process with slightly more compression:
- Towards the beginning, condense more observations into higher-level reflections
- Closer to the end, retain more fine details (recent context matters more)
- Combine related items more aggressively but do not lose important details of names, places, events
- Example: if there's a long nested observation about repeated tool calls, combine into one line

Your current detail level was a 10/10, lets aim for a 8/10 detail level.
`,

  // Level 2: Aggressive compression (level 1 didn't work)
  2: `
AGGRESSIVE COMPRESSION REQUIRED

Your previous reflection was still too large after compression guidance.

Please re-process with much more aggressive compression:
- Towards the beginning, heavily condense observations into high-level summaries
- Closer to the end, retain fine details
- Combine related items aggressively but preserve important details
- Remove redundant information and merge overlapping observations

Your current detail level was a 10/10, lets aim for a 6/10 detail level.
`
};
```

### 3.7 Continuation Hint

```typescript
const OBSERVATION_CONTINUATION_HINT = `
This message is not from the user, the conversation history grew too long and wouldn't fit in context! Thankfully the entire conversation is stored in your memory observations.

Please continue from where the observations left off. Do not refer to your "memory observations" directly, the user doesn't know about them, they are your memories!

Just respond naturally as if you're remembering the conversation (you are!). Do not say "Hi there!" or "based on our previous conversation" as if the conversation is just starting, this is not a new conversation.

This is an ongoing conversation, keep continuity by responding based on your memory. For example do not say "I understand. I've reviewed my memory observations", or "I remember [...]".

Answer naturally following the suggestion from your memory. Note that your memory may contain a suggested first response, which you should follow.

IMPORTANT: this system reminder is NOT from the user. The system placed it here as part of your memory system.

NOTE: Any messages following this system reminder are newer than your memories.
`;
```

---

## 4. Configuration Options

### Observational Memory Configuration

```typescript
interface ObservationalMemoryConfig {
  /** Enable observational memory */
  enabled?: boolean;
  
  /** Scope: 'resource' (default) or 'thread' */
  scope?: 'resource' | 'thread';
  
  /** Model for observation (defaults to agent's model) */
  model?: string | LanguageModel;
  
  /** Custom model settings for observation */
  modelSettings?: ModelSettings;
  
  /** Provider options for observation model */
  providerOptions?: Record<string, any>;
  
  /** Token threshold to trigger observation (default: 30000) */
  observationThreshold?: number;
  
  /** Token threshold to trigger reflection (default: 40000) */
  reflectionThreshold?: number;
  
  /** Async buffering: trigger interval in tokens (default: 6000) */
  bufferTokens?: number;
  
  /** Async buffering: activation ratio (default: 0.8) */
  bufferActivation?: number;
  
  /** Force sync observation after this many tokens (default: 7200) */
  blockAfter?: number;
  
  /** Read-only mode (no modifications) */
  readOnly?: boolean;
}
```

### Default Configuration

```typescript
const memoryDefaultOptions = {
  lastMessages: 10,
  semanticRecall: false,
  generateTitle: false,
  workingMemory: {
    enabled: false,
    template: `
# User Information
- **First Name**:
- **Last Name**:
- **Location**:
- **Occupation**:
- **Interests**:
- **Goals**:
- **Events**:
- **Facts**:
- **Projects**:
`,
  },
};
```

---

## 5. Processing Flow

### 5.1 processInputStep Flow

```
1. Load historical messages (step 0 only)
   └─> Get messages since lastObservedAt

2. Load other threads' unobserved context (resource scope)
   └─> Get observations from other threads for context

3. Activate buffered observations (step 0, async enabled)
   └─> If buffered chunks exist and tokens >= threshold
   └─> Swap buffered → active

4. Reflection check (step 0)
   └─> If observation tokens >= reflection threshold, trigger reflection
   └─> Or trigger async reflection if above activation point

5. Check threshold and observe if needed
   └─> Calculate pending tokens
   └─> If async enabled and at bufferTokens interval → start async buffering
   └─> If threshold reached → observe synchronously

6. Per-step save (step > 0)
   └─> Persist messages incrementally

7. Inject observations into context
   └─> Format observations for context
   └─> Add as system message
   └─> Add continuation hint
```

### 5.2 Token Calculation

```typescript
function calculateObservationThresholds(
  allMessages: MastraDBMessage[],
  unobservedMessages: MastraDBMessage[],
  pendingTokens: number,
  otherThreadTokens: number,
  currentObservationTokens: number,
  record: ObservationalMemoryRecord
): {
  totalPendingTokens: number;
  threshold: number;
} {
  const allMessageTokens = tokenCounter.countMessages(allMessages);
  const unobservedTokens = tokenCounter.countMessages(unobservedMessages);
  
  // Total = all messages + other threads + pending from storage + current observations
  const totalPendingTokens = allMessageTokens + otherThreadTokens + pendingTokens + currentObservationTokens;
  
  // Threshold = observationThreshold - current observations (leaves room for new content)
  const threshold = (record.config.observationThreshold ?? 30000) - currentObservationTokens;
  
  return { totalPendingTokens, threshold };
}
```

---

## 6. Key Implementation Details

### 6.1 Async Buffering System

The most critical production feature - observation doesn't block the agent:

```
bufferTokens: 6000        // Trigger async observation every 6k tokens
bufferActivation: 0.8     // Activate when 80% of threshold reached
blockAfter: 7200          // Force sync observation after 7.2k tokens
```

**Flow:**
1. Agent runs, messages accumulate
2. At `bufferTokens` (6k) → start background observation (async)
3. Store results in `bufferedObservationChunks`
4. At threshold (30k) → activate buffered chunks, start sync observation
5. Agent continues without waiting

### 6.2 Mutex & Stale Flag Detection

**In-memory mutex per process:**
```typescript
private locks = new Map<string, Promise<void>>();
```

**Static maps shared across instances:**
```typescript
private static asyncBufferingOps = new Map<string, Promise<void>>();
private static sealedMessageIds = new Map<string, Set<string>>();
private static lastBufferedBoundary = new Map<string, number>();
```

**State flag detection:**
```typescript
// Check if flag is stale (from crashed process)
if (record.isBufferingObservation) {
  if (!isOpActiveInProcess(record.id, 'bufferingObservation')) {
    // Flag is stale - clear it
    await storage.setBufferingObservationFlag(record.id, false);
  }
}
```

### 6.3 Token Counting

```typescript
class TokenCounter {
  countMessages(messages: MastraDBMessage[]): number {
    // Count tokens in message content
    // Uses tiktoken or similar
  }
  
  countString(str: string): number {
    // Count tokens in string
  }
}
```

---

## 7. Message Markers & Sealing

### 7.1 Observation Markers

Special content parts added to messages to track observation state:

```typescript
// These are embedded in message content.parts
{ type: 'data-om-observation-start', ... }
{ type: 'data-om-observation-end', ... }
{ type: 'data-om-observation-failed', ... }
```

### 7.2 Message Sealing

When observation starts, messages are "sealed" to prevent content merging:

```typescript
function sealMessage(message: MastraDBMessage) {
  // Set message-level sealed flag
  message.content.metadata.mastra.sealed = true;
  
  // Add sealedAt to last part
  const lastPart = message.content.parts[message.content.parts.length - 1];
  lastPart.metadata.mastra.sealedAt = Date.now();
}

// When adding new content to sealed message:
// MessageList detects sealed flag → creates NEW message with only new parts
// This preserves observation markers
```

### 7.3 Getting Unobserved Parts

```typescript
function getUnobservedParts(message: MastraDBMessage): Part[] {
  const parts = message.content.parts;
  if (!parts) return [];
  
  // Find last completed observation (start + end)
  const endMarkerIndex = findLastCompletedObservationBoundary(message);
  
  if (endMarkerIndex === -1) {
    // No completed observation - all parts are unobserved
    return parts.filter(p => !isObservationMarker(p));
  }
  
  // Return only parts after end marker
  return parts.slice(endMarkerIndex + 1).filter(p => !isObservationMarker(p));
}
```

---

## 8. Async Buffering System

### 8.1 Buffered Observation Chunk

```typescript
interface BufferedObservationChunk {
  content: string;           // Observation text
  messageIds: string[];     // Message IDs this chunk covers
  messageTokens: number;    // Token count
  createdAt: Date;
}
```

### 8.2 Buffer Activation

```typescript
async function tryActivateBufferedObservations(
  record: ObservationalMemoryRecord,
  lockKey: string,
  currentPendingTokens: number,
  writer: any,
  messageList: MessageList
): Promise<{ success: boolean; updatedRecord: ObservationalMemoryRecord }> {
  const bufferedChunks = getBufferedChunks(record);
  
  if (bufferedChunks.length === 0) {
    return { success: false, updatedRecord: record };
  }
  
  // Calculate tokens for activation
  const threshold = record.config.observationThreshold ?? 30000;
  const activationThreshold = threshold * (record.config.bufferActivation ?? 0.8);
  
  if (currentPendingTokens < activationThreshold) {
    return { success: false, updatedRecord: record };
  }
  
  // Activate buffered chunks
  const result = await storage.swapBufferedToActive({
    id: record.id,
    activationRatio: 1.0,
    currentPendingTokens,
  });
  
  return { success: true, updatedRecord: result.currentRecord };
}
```

### 8.3 Background Observation

```typescript
function startAsyncBufferedObservation(
  record: ObservationalMemoryRecord,
  threadId: string,
  unobservedMessages: MastraDBMessage[],
  lockKey: string,
  writer: any,
  pendingTokens: number
) {
  // Set flag
  storage.setBufferingObservationFlag(record.id, true, pendingTokens);
  
  // Start background observation
  const observationPromise = (async () => {
    try {
      const observations = await callObserverAgent(
        record.activeObservations,
        unobservedMessages
      );
      
      // Store in buffer
      await storage.updateBufferedObservations({
        id: record.id,
        chunk: {
          content: observations,
          messageIds: unobservedMessages.map(m => m.id),
          messageTokens: tokenCounter.countMessages(unobservedMessages),
          createdAt: new Date(),
        },
        pendingTokens,
      });
    } catch (error) {
      // Clear flag on error
      await storage.setBufferingObservationFlag(record.id, false);
    }
  })();
  
  // Register in static map for cross-instance tracking
  ObservationalMemory.asyncBufferingOps.set(lockKey, observationPromise);
}
```

---

## 9. Context Injection

### 9.1 Format Observations for Context

```typescript
function formatObservationsForContext(
  observations: string,
  currentTask?: string,
  suggestedResponse?: string,
  unobservedContextBlocks?: string,
  currentDate?: Date
): string {
  // Optimize observations (remove non-critical emojis, etc.)
  let optimized = optimizeObservationsForContext(observations);
  
  // Add relative time annotations
  if (currentDate) {
    optimized = addRelativeTimeToObservations(optimized, currentDate);
  }
  
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

  // Dynamically inject current-task from thread metadata
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

### 9.2 Context Injection in MessageList

```typescript
async function injectObservationsIntoContext(
  messageList: MessageList,
  record: ObservationalMemoryRecord,
  threadId: string,
  resourceId: string
): Promise<void> {
  // Get thread metadata for current-task and suggested-response
  const thread = await storage.getThreadById({ threadId });
  const threadOMMetadata = getThreadOMMetadata(thread?.metadata);
  
  // Format observations
  const observationSystemMessage = formatObservationsForContext(
    record.activeObservations,
    threadOMMetadata?.currentTask,
    threadOMMetadata?.suggestedResponse,
    // ... other params
  );
  
  // Clear existing observation system messages
  messageList.clearSystemMessages('observational-memory');
  
  // Add formatted observations
  messageList.addSystem(observationSystemMessage, 'observational-memory');
  
  // Add continuation hint
  const continuationMessage: MastraDBMessage = {
    id: 'om-continuation',
    role: 'user',
    createdAt: new Date(0),
    content: {
      format: 2,
      parts: [{
        type: 'text',
        text: `<system-reminder>${OBSERVATION_CONTINUATION_HINT}</system-reminder>`
      }]
    },
    threadId,
    resourceId,
  };
  messageList.add(continuationMessage, 'memory');
}
```

### 9.3 Context Prompt Templates

```typescript
const OBSERVATION_CONTEXT_PROMPT = `
The following observations block contains your memory of past conversations with this user.`;

const OBSERVATION_CONTEXT_INSTRUCTIONS = `
IMPORTANT: When responding, reference specific details from these observations.
Do not give generic advice - personalize based on what you know about this user's experiences.

KNOWLEDGE UPDATES: When asked about current state (e.g., "where do I currently..."),
always prefer the MOST RECENT information. Observations include dates - if you see
conflicting information, the newer observation supersedes the older one.

PLANNED ACTIONS: If the user stated they planned to do something and the date is now
in the past, assume they completed the action unless there's evidence they didn't.`;
```

---

## 10. Helper Functions

### 10.1 Parse Observer Output

```typescript
function parseObserverOutput(output: string): ObserverResult {
  const parsed = parseMemorySectionXml(output);
  
  return {
    observations: parsed.observations,
    currentTask: parsed.currentTask,
    suggestedContinuation: parsed.suggestedResponse,
    rawOutput: output,
  };
}

function parseMemorySectionXml(content: string): ParsedMemorySection {
  const result = {
    observations: '',
    currentTask: '',
    suggestedResponse: '',
  };
  
  // Extract <observations> content
  const observationsMatch = content.match(/<observations>([\s\S]*?)<\/observations>/i);
  if (observationsMatch?.[1]) {
    result.observations = observationsMatch[1].trim();
  }
  
  // Extract <current-task>
  const currentTaskMatch = content.match(/<current-task>([\s\S]*?)<\/current-task>/i);
  if (currentTaskMatch?.[1]) {
    result.currentTask = currentTaskMatch[1].trim();
  }
  
  // Extract <suggested-response>
  const suggestedMatch = content.match(/<suggested-response>([\s\S]*?)<\/suggested-response>/i);
  if (suggestedMatch?.[1]) {
    result.suggestedResponse = suggestedMatch[1].trim();
  }
  
  return result;
}
```

### 10.2 Optimize Observations for Context

```typescript
function optimizeObservationsForContext(observations: string): string {
  let optimized = observations;
  
  // Remove 🟡 and 🟢 emojis (keep 🔴 for critical items)
  optimized = optimized.replace(/🟡\s*/g, '');
  optimized = optimized.replace(/🟢\s*/g, '');
  
  // Remove semantic tags but keep collapsed markers
  optimized = optimized.replace(/\[(?![\d\s]*items collapsed)[^\]]+\]/g, '');
  
  // Remove arrow indicators
  optimized = optimized.replace(/\s*->\s*/g, ' ');
  
  // Clean up multiple spaces/newlines
  optimized = optimized.replace(/  +/g, ' ');
  optimized = optimized.replace(/\n{3,}/g, '\n\n');
  
  return optimized.trim();
}
```

### 10.3 Thread Metadata Helpers

```typescript
function getThreadOMMetadata(threadMetadata?: Record<string, unknown>): ThreadOMMetadata | undefined {
  if (!threadMetadata) return undefined;
  const mastra = threadMetadata.mastra;
  if (!isPlainObject(mastra)) return undefined;
  const om = mastra.om;
  if (!isPlainObject(om)) return undefined;
  return om as ThreadOMMetadata;
}

function setThreadOMMetadata(
  threadMetadata: Record<string, unknown> | undefined,
  omMetadata: ThreadOMMetadata
): Record<string, unknown> {
  const existing = threadMetadata ?? {};
  const existingMastra = isPlainObject(existing.mastra) ? existing.mastra : {};
  const existingOM = isPlainObject(existingMastra.om) ? existingMastra.om : {};
  
  return {
    ...existing,
    mastra: {
      ...existingMastra,
      om: {
        ...existingOM,
        ...omMetadata,
      },
    },
  };
}
```

---

## 11. File Structure Reference

```
packages/core/src/
├── memory/
│   ├── index.ts                    # Main memory exports
│   ├── memory.ts                   # MastraMemory base class
│   ├── types.ts                    # Type definitions
│   └── working-memory-utils.ts      # Working memory helpers
├── storage/
│   ├── domains/
│   │   └── memory/
│   │       ├── base.ts             # MemoryStorage abstract class
│   │       └── inmemory.ts         # In-memory implementation
│   ├── types.ts                    # Storage types including OM
│   └── constants.ts                # Table schemas
├── processors/
│   └── memory/
│       ├── semantic-recall.ts       # Vector search processor
│       ├── working-memory.ts        # Working memory processor
│       └── message-history.ts       # Message history processor
└── agents/
    └── message-list.ts              # Message list handling
```

---

## 12. Key Differences from Our Implementation

| Aspect | Mastra | Our Implementation |
|--------|--------|-------------------|
| **Search** | Vector embeddings | BM25 via FTS5 |
| **Embedder** | OpenAI/fastembed | None needed |
| **Storage** | LibSQL/PostgreSQL | LibSQL |
| **Framework** | Full framework | Own implementation |
| **Async** | Full async buffering | Simplified |

---

## 13. Testing Reference

Key test patterns from Mastra:

1. **Observation timing tests** - Verify observation triggers at correct token thresholds
2. **Buffer activation tests** - Verify buffered content activates correctly
3. **Reflection tests** - Verify reflection compresses correctly
4. **Crash recovery tests** - Verify stale flags are detected and cleared
5. **Multi-thread tests** - Verify resource-scope observations work
6. **Continuation tests** - Verify continuation hint maintains context

---

## Summary

This document provides a comprehensive reference for implementing a memory system that matches Mastra's capabilities. Key areas to focus on:

1. **Prompts**: The Observer/Reflector prompts are extensively tested and refined
2. **Async Buffering**: Critical for production - prevents agent blocking
3. **State Management**: Flags in DB enable crash recovery
4. **Message Sealing**: Part-level filtering preserves observation boundaries
5. **Context Injection**: XML format with continuation hint maintains UX

> **Remember**: We're using BM25 instead of vectors, but the observation/reflection logic remains the same.
