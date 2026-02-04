# Complete Integration Plan: Phases 1-11 Unification

**Status**: As of 2026-01-30, Phases 1-11 are implemented but have critical integration gaps that prevent the system from working end-to-end.

**Objective**: This plan addresses all identified issues and creates a unified, working system ready for Phase 12 (Solid UI).

---

## Table of Contents

1. [Critical Issues Summary](#critical-issues-summary)
2. [Integration Architecture](#integration-architecture)
3. [Phase-by-Phase Integration Tasks](#phase-by-phase-integration-tasks)
4. [End-to-End Testing Strategy](#end-to-end-testing-strategy)
5. [Deployment Checklist](#deployment-checklist)

---

## Critical Issues Summary

### Issue 1: Chat Route Not Connected to Agent (CRITICAL)

**Location**: `packages/server/src/routes/chat.ts`
**Status**: Echo mode only - does not invoke actual agents
**Impact**: Users cannot interact with the AI system

**Root Cause**: The chat route was implemented as a placeholder/echo but never integrated with the XState RLM machine.

### Issue 2: search_docs Tools Not Exported (HIGH)

**Location**: `packages/core/src/tools/index.ts`
**Status**: Tools implemented but not in registry
**Impact**: Agents cannot access code research capabilities

**Root Cause**: The search-docs tool stack was added but exports weren't updated.

### Issue 3: rlmMachine Not Exported (HIGH)

**Location**: `packages/core/src/state/`
**Status**: Machine defined but not accessible externally
**Impact**: Server cannot create agent instances

**Root Cause**: Export oversight during state machine implementation.

### Issue 4: Sequential Thinking Using In-Memory Storage (MEDIUM)

**Location**: `packages/core/src/tools/sequential-thinking.ts`
**Status**: Uses Map instead of Drizzle tool_sessions
**Impact**: Sessions lost on restart, doesn't match cohesion plan

**Root Cause**: Implementation convenience vs. architectural alignment.

### Issue 5: Missing Integration Tests (HIGH)

**Status**: No end-to-end tests for agent workflows
**Impact**: Cannot verify system works correctly

---

## Integration Architecture

### Current State Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CURRENT (BROKEN)                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   ┌─────────────┐    ┌──────────────┐    ┌──────────────────┐      │
│   │ Solid UI     │───▶│ Chat Route   │───▶│   ECHO MODE     │      │
│   │ (Phase 12)  │    │ /api/chat    │    │   (returns)     │      │
│   └─────────────┘    └──────────────┘    └──────────────────┘      │
│                                    │                             │
│                                    ▼                             │
│                          ┌──────────────────┐                            │
│                          │  XState Agents  │◀─── NOT CONNECTED      │
│                          │  (isolated)    │                            │
│                          └──────────────────┘                            │
│                                                                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Target State Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         TARGET (WORKING)                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   ┌─────────────┐    ┌──────────────┐    ┌──────────────────┐      │
│   │ Solid UI     │───▶│ Chat Route   │───▶│  XState RLM     │      │
│   │ (Phase 12)  │    │ /api/chat    │    │  Machine        │      │
│   └─────────────┘    └──────────────┘    │  - Plan Agent   │      │
│                                               │  - Build Agent  │      │
│                                               └────────┬─────────┘      │
│                                                        │              │
│                                                        ▼              │
│                                         ┌──────────────────────────┐    │
│                                         │  All Tools Available     │    │
│                                         │  - filesystem          │    │
│                                         │  - search-docs         │    │
│                                         │  - sequential-thinking │    │
│                                         │  - hybrid (vision)     │    │
│                                         └──────────────────────────┘    │
│                                                                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow (Target)

```
User Message (Solid UI)
    │
    ▼
POST /api/chat (with session cookie)
    │
    ├─▶ Session Bridge Middleware
    │   ├─ Extract session ID or create UUIDv7
    │   ├─ Load session from Drizzle
    │   └─ Call Instance.provide({ directory, session })
    │
    ├─▶ Chat Route Handler
    │   ├─ Create XState actor from rlmMachine
    │   ├─ Initialize with user message
    │   └─ Start state machine
    │
    ├─▶ XState Machine Execution
    │   ├─ Plan Agent (analyze_code → research → design)
    │   │   ├─ Spawn Explore Agent (codebase exploration)
    │   │   ├─ Use search-docs tools (ast_query, grep, file_read)
    │   │   └─ Use sequential-thinking for complex reasoning
    │   │
    │   └─ Build Agent (implement ⇄ validate)
    │       ├─ Use filesystem tools (read, write, edit)
    │       ├─ Use bash tool for commands
    │       └─ Recursive validation until clean
    │
    └─▶ UIMessage Stream (SSE)
        ├─ state updates (current agent, phase, iteration)
        ├─ tool calls (tool name, arguments, results)
        ├─ text deltas (streaming response)
        └─ finish (completion with metadata)
```

---

## Phase-by-Phase Integration Tasks

### Phase 1: Fix Core Exports (Foundation)

**Priority**: CRITICAL
**Estimated Time**: 1 hour

#### Task 1.1: Export rlmMachine and Integration APIs

**File**: `packages/core/src/state/index.ts`

**Add exports**:
```typescript
// Core state machine exports
export { rlmMachine } from './machine';
export { machineSetup } from './machine-setup';

// Integration entry points
export {
  createRLMActor,
  runRLMWorkflow
} from './integration/hybrid-agent';

// Loop control utilities
export {
  checkLoopControl,
  type LoopControlResult,
  PHASE_SAFETY_LIMITS
} from './loop-control';

// Actors
export {
  spawnExploreAgent,
  runPlanAgent,
  runBuildAgent
} from './actors';
```

**Verification**: Server can import `createRLMActor` from `@ekacode/core/state`

---

#### Task 1.2: Export State Machine Types

**File**: `packages/core/src/state/types.ts` (new file)

**Create**:
```typescript
// Re-export all state machine types for external use
export type {
  HierarchicalState,
  RLMMachineContext,
  RLMMachineEvent,
  PlanPhase,
  BuildPhase
} from './machine';
```

---

### Phase 2: Integrate Chat Route with Agent System

**Priority**: CRITICAL
**Estimated Time**: 3 hours

#### Task 2.1: Replace Chat Route with Real Agent Invocation

**File**: `packages/server/src/routes/chat.ts`

**Current implementation** (echo mode - WRONG):
```typescript
// Lines 58-60: REMOVE THIS
writer.write({
  type: "text-delta",
  id: messageId,
  delta: `Echo: You said "${message}"`
});
```

**Target implementation**:
```typescript
import { createRLMActor } from "@ekacode/core/state";
import type { CoreMessage } from "@ekacode/core";

app.post("/api/chat", async (c) => {
  const { session, message } = await c.req.json();

  // Get current context
  const directory = Instance.directory;
  const sessionId = session?.sessionId;

  // Validate
  if (!directory) {
    return c.json({ error: "No workspace directory" }, 400);
  }

  // Create XState actor
  const actor = createRLMActor({
    goal: message,
    workspace: directory,
    sessionId,
  });

  // Subscribe to state changes
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const messages: CoreMessage[] = [
        { role: "user", content: message }
      ];

      const subscription = actor.subscribe({
        next: (snapshot) => {
          // Write state updates
          writer.write({
            type: "state",
            id: messageId,
            data: {
              value: snapshot.value,
              context: {
                iterationCount: snapshot.context.iterationCount,
                lastPhase: snapshot.context.lastState,
              }
            }
          });

          // Extract assistant messages and tool calls
          const lastMessage = snapshot.context.messages[snapshot.context.messages.length - 1];
          if (lastMessage?.role === "assistant") {
            writer.write({
              type: "text-delta",
              id: messageId,
              delta: lastMessage.content || "",
            });

            // Write tool calls
            if (lastMessage.toolCalls && lastMessage.toolCalls.length > 0) {
              writer.write({
                type: "tool-call",
                id: messageId,
                data: lastMessage.toolCalls.map(tc => ({
                  toolName: tc.toolName,
                  args: JSON.stringify(tc.args),
                })),
              });
            }
          }

          // Check for completion
          if (snapshot.matches("done") || snapshot.matches("failed")) {
            subscription.unsubscribe();
            writer.write({
              type: "finish",
              id: messageId,
              data: {
                reason: snapshot.matches("done") ? "complete" : "error",
                value: snapshot.value,
              }
            });
            writer.close();
          }
        },
        error: (error) => {
          subscription.unsubscribe();
          writer.write({
            type: "error",
            id: messageId,
            data: { error: error.message }
          });
          writer.close();
        },
      });

      actor.start();

      // Wait for completion (timeout: 10 minutes)
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          subscription.unsubscribe();
          actor.stop();
          reject(new Error("Agent execution timeout"));
        }, 10 * 60 * 1000);

        subscription.onDone(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    },
  });

  return stream;
});
```

**Verification**:
- Sending `POST /api/chat` with a message returns streamed AI responses
- Tool calls are properly formatted in the stream
- State transitions (plan → build → done) are visible

---

#### Task 2.2: Add Message History Support

**File**: `packages/server/src/routes/chat.ts`

**Add support for conversation history**:
```typescript
// Accept messages array for conversation context
const chatSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
  history: z.array(z.object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.string(),
  })).optional(),
});

// In route handler:
const messages: CoreMessage[] = input.history || [
  { role: "user", content: input.message }
];

// Pass to actor:
const actor = createRLMActor({
  goal: input.message,
  workspace: directory,
  sessionId,
  initialMessages: messages,
});
```

---

### Phase 3: Export and Integrate search-docs Tools

**Priority**: HIGH
**Estimated Time**: 2 hours

#### Task 3.1: Export search-docs Components

**File**: `packages/core/src/tools/index.ts`

**Add exports**:
```typescript
// Search docs tool stack
export { searchDocs, createSearchDocsTool } from "./search-docs/search-docs";
export { astQuery, createAstQueryTool } from "./search-docs/ast-query";
export { grepSearch, createGrepSearchTool } from "./search-docs/grep-search";
export { fileRead, createFileReadTool } from "./search-docs/file-read";

// Supporting infrastructure
export {
  getSessionStore,
  type DocSession,
  type ClonedRepo
} from "./search-docs/session-store";

export {
  getSubAgentManager,
  resetSubAgentManager,
  type CodeResearchAgent
} from "./search-docs/sub-agent";

export {
  GitManager,
  gitManager,
  type GitError,
  type CloneOptions,
  type CloneResult
} from "./search-docs/git-manager";

export {
  registryLookup,
  gitProbe,
  gitClone,
  importMapLookup,
  type RegistryEntry
} from "./search-docs/discovery-tools";
```

---

#### Task 3.2: Register search-docs in Tool Registry

**File**: `packages/core/src/tools/registry.ts`

**Add to TOOL_REGISTRY**:
```typescript
import {
  searchDocs,
  astQuery,
  grepSearch,
  fileRead,
} from "./index";

export const TOOL_REGISTRY = {
  // ... existing tools ...

  // Code research tools
  "search-docs": searchDocs,
  "ast-query": astQuery,
  "grep-search": grepSearch,
  "file-read-docs": fileRead, // Use distinct name to avoid conflict
} as const;
```

---

#### Task 3.3: Add search-docs to Plan Agent Tools

**File**: `packages/core/src/state/actors/plan-agent.ts`

**Update plan tools map**:
```typescript
import { astQuery, grepSearch, fileRead } from "@ekacode/core/tools";

const PLAN_TOOLS: Record<PlanPhase, Record<string, Tool>> = {
  analyze_code: {
    "read": readTool,
    "grep": grepTool,
    "glob": globTool,
    "ast-query": astQuery,
  },

  research: {
    "read": readTool,
    "web-search": webSearchTool, // If implemented
    "ast-query": astQuery,
    "grep-search": grepSearch,
    "file-read-docs": fileRead,
    "sequential-thinking": sequentialThinkingTool,
  },

  design: {
    "sequential-thinking": sequentialThinkingTool,
    "create-plan": createPlanTool, // If implemented
  },
};
```

---

#### Task 3.4: Test search-docs Integration

**File**: `packages/core/tests/integration/search-docs-integration.test.ts` (new)

**Create integration test**:
```typescript
import { describe, it, expect } from "vitest";
import { generateText } from "ai";
import { createZai } from "@ai-sdk/zai";
import { searchDocs } from "@ekacode/core/tools";

describe("search-docs integration", () => {
  it("should research code from external repository", async () => {
    const zai = createZai({ apiKey: process.env.ZAI_API_KEY });

    const result = await generateText({
      model: zai("glm-4.7"),
      tools: {
        "search-docs": searchDocs,
      },
      messages: [
        {
          role: "user",
          content: "How do I use streamText from Vercel AI SDK?",
        },
      ],
      maxSteps: 10,
    });

    // Should have called search-docs tool
    const toolCalls = result.toolCalls.filter(tc => tc.toolName === "search-docs");
    expect(toolCalls.length).toBeGreaterThan(0);

    // Should return useful information
    expect(result.text).toContain("streamText");
  }, 30000);
});
```

---

### Phase 4: Migrate Sequential Thinking to Drizzle Storage

**Priority**: MEDIUM
**Estimated Time**: 2 hours

#### Task 4.1: Create Drizzle Schema for Sequential Thinking

**File**: `packages/server/db/schema.ts`

**Add table**:
```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const sequentialThinkingSessions = sqliteTable("sequential_thinking_sessions", {
  id: text("id").primaryKey(), // UUIDv7
  sessionId: text("session_id").notNull(), // Links to main session
  createdAt: integer("created_at").notNull(),
  lastAccessed: integer("last_accessed").notNull(),
  thoughtCount: integer("thought_count").notNull().default(0),
  branches: text("branches"), // JSON array of branch IDs
});

export const sequentialThoughts = sqliteTable("sequential_thoughts", {
  id: text("id").primaryKey(), // UUIDv7 per thought
  sessionId: text("session_id").notNull(), // Links to sequential_thinking_sessions.id
  thoughtNumber: integer("thought_number").notNull(),
  thought: text("thought").notNull(),
  totalThoughts: integer("total_thoughts").notNull(),
  nextThoughtNeeded: integer("next_thought_needed").notNull(), // 0 or 1
  isRevision: integer("is_revision").notNull().default(0), // 0 or 1
  revisesThought: integer("revises_thought"), // Optional
  branchFromThought: integer("branch_from_thought"), // Optional
  branchId: text("branch_id"), // Optional
  timestamp: integer("timestamp").notNull(),
});

// Foreign key relationship
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  // ... existing fields
});
```

---

#### Task 4.2: Update Sequential Thinking Tool to Use Drizzle

**File**: `packages/core/src/tools/sequential-thinking.ts`

**Replace in-memory storage**:
```typescript
import { db } from "@ekacode/server/db";
import { sequentialThinkingSessions, sequentialThoughts } from "@ekacode/server/db/schema";
import { eq, and } from "drizzle-orm";

// Remove: const sessions = new Map<string, Session>();

// Add DB operations
async function getSession(sessionId: string): Promise<Session> {
  const result = await db
    .select()
    .from(sequentialThinkingSessions)
    .where(eq(sequentialThinkingSessions.id, sessionId))
    .get();

  if (!result) {
    // Create new session
    await db.insert(sequentialThinkingSessions).values({
      id: sessionId,
      sessionId: sessionId, // Could be linked to main session
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      thoughtCount: 0,
      branches: "[]",
    });

    return {
      id: sessionId,
      createdAt: Date.now(),
      thoughts: [],
      branches: new Set(),
    };
  }

  // Load thoughts
  const thoughts = await db
    .select()
    .from(sequentialThoughts)
    .where(eq(sequentialThoughts.sessionId, sessionId))
    .orderBy(sequentialThoughts.thoughtNumber);

  return {
    id: result.id,
    createdAt: result.createdAt,
    lastAccessed: result.lastAccessed,
    thoughts: thoughts.map(t => ({
      thoughtNumber: t.thoughtNumber,
      thought: t.thought,
      totalThoughts: t.totalThoughts,
      nextThoughtNeeded: t.nextThoughtNeeded === 1,
      isRevision: t.isRevision === 1,
      revisesThought: t.revisesThought,
      branchFromThought: t.branchFromThought,
      branchId: t.branchId,
      timestamp: t.timestamp,
    })),
    branches: new Set(JSON.parse(result.branches || "[]")),
  };
}

async function saveThought(sessionId: string, thought: ThoughtEntry): Promise<void> {
  await db.insert(sequentialThoughts).values({
    id: crypto.randomUUID(),
    sessionId,
    thoughtNumber: thought.thoughtNumber,
    thought: thought.thought,
    totalThoughts: thought.totalThoughts,
    nextThoughtNeeded: thought.nextThoughtNeeded ? 1 : 0,
    isRevision: thought.isRevision ? 1 : 0,
    revisesThought: thought.revisesThought,
    branchFromThought: thought.branchFromThought,
    branchId: thought.branchId,
    timestamp: thought.timestamp,
  });

  // Update session
  await db
    .update(sequentialThinkingSessions)
    .set({
      lastAccessed: Date.now(),
      thoughtCount: sql`coalesce(${sequentialThinkingSessions.thoughtCount} + 1, 1)`,
    })
    .where(eq(sequentialThinkingSessions.id, sessionId));
}
```

---

#### Task 4.3: Update Migration

**File**: Generate new migration

**Run**:
```bash
pnpm --filter @ekacode/server drizzle:generate
```

---

### Phase 5: Integrate HybridAgent for Multimodal Support

**Priority**: MEDIUM
**Estimated Time**: 2 hours

#### Task 5.1: Verify HybridAgent Routing

**File**: `packages/core/src/state/integration/hybrid-agent.ts`

**Ensure vision routing works**:
```typescript
// Check that HybridAgent properly detects image URLs
// and routes to vision models when needed

// In plan agent:
if (messageHasImage(message)) {
  // Should use vision model
  const visionModel = zai("glm-4.6v");
  return generateText({ model: visionModel, messages });
}
```

---

#### Task 5.2: Add Image Support to Chat Route

**File**: `packages/server/src/routes/chat.ts`

**Accept image inputs**:
```typescript
const chatSchema = z.object({
  message: z.string(),
  sessionId: z.string().optional(),
  history: z.array(z.object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.union([z.string(), z.object({
      type: z.literal("image"),
      url: z.string().url(),
    })]),
  })).optional(),
});

// When processing messages:
const coreMessages: CoreMessage[] = input.history.map(msg => ({
  role: msg.role,
  content: typeof msg.content === "string"
    ? msg.content
    : [{ type: "image", image: new URL(msg.content.url) }],
}));
```

---

### Phase 6: Add Missing Tool Exports

**Priority**: MEDIUM
**Estimated Time**: 1 hour

#### Task 6.1: Export All Tools from Index

**File**: `packages/core/src/tools/index.ts`

**Comprehensive export**:
```typescript
// Filesystem tools
export { readTool, readFileContent } from "./filesystem/read";
export { writeTool, writeFileContent } from "./filesystem/write";
export { editTool, editFile } from "./filesystem/edit";
export { globTool, globFiles } from "./filesystem/glob";

// Shell tools
export { bashTool, executeCommand } from "./shell/bash";

// Sequential thinking
export {
  sequentialThinking,
  clearSession,
  clearAllSessions,
  getSession,
  getAllSessions,
} from "./sequential-thinking";

// Search docs tools
export {
  searchDocs,
  createSearchDocsTool,
  astQuery,
  createAstQueryTool,
  grepSearch,
  createGrepSearchTool,
  fileRead,
  createFileReadTool,
} from "./search-docs";

// Supporting infrastructure
export {
  getSessionStore,
  type DocSession,
  type ClonedRepo,
} from "./search-docs/session-store";

export {
  getSubAgentManager,
  resetSubAgentManager,
  type CodeResearchAgent,
} from "./search-docs/sub-agent";

export {
  GitManager,
  gitManager,
  type GitError,
  type CloneOptions,
  type CloneResult,
} from "./search-docs/git-manager";

export {
  registryLookup,
  gitProbe,
  gitClone,
  importMapLookup,
  type RegistryEntry,
} from "./search-docs/discovery-tools";

// Tool registry
export { TOOL_REGISTRY } from "./registry";
export type { ToolName } from "./registry";

// Factory function
export { createTools, getDefaultTools } from "./registry";
```

---

### Phase 7: Implement Doom Loop Detection Guards

**Priority**: MEDIUM
**Estimated Time**: 1 hour

#### Task 7.1: Verify Guard Implementation

**File**: `packages/core/src/state/machine.ts`

**Ensure guards are properly wired**:
```typescript
// In validate state:
always: [
  {
    target: "#rlm.done",
    guard: "isBuildClean",
    description: "All validations passed",
  },
  {
    target: "#rlm.failed",
    guard: "doomLoopDetected",
    description: "Doom loop detected - too many oscillations",
  },
  {
    target: "implement",
    guard: "hasValidationErrors",
    description: "Validation failed - fix and retry",
  },
],
```

---

#### Task 7.2: Add Doom Loop Monitoring

**File**: `packages/core/src/state/machine.ts`

**Add tracking**:
```typescript
// In context:
interface RLMMachineContext {
  messages: Array<Message>;
  goal: string;
  iterationCount: number;
  recentStates: Array<{ state: HierarchicalState; timestamp: number }>;
  lastState: string | null;
  toolExecutionCount: number;
  errorCounts: Record<string, number>;

  // NEW: Doom loop tracking
  buildOscillationCount: number;  // Track implement→validate transitions
  startTime: number;              // Track total build time
}
```

---

### Phase 8: Add Comprehensive Integration Tests

**Priority**: HIGH
**Estimated Time**: 4 hours

#### Task 8.1: End-to-End Agent Test

**File**: `packages/core/tests/integration/e2e-agent.test.ts`

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { generateText } from "ai";
import { createZai } from "@ai-sdk/zai";
import { createTools } from "@ekacode/core/tools";

describe("E2E: Agent with tools", () => {
  it("should complete a simple coding task", { async () => {
    const zai = createZai({ apiKey: process.env.ZAI_API_KEY });
    const tools = createTools(["read", "write", "bash"]);

    const result = await generateText({
      model: zai("glm-4.7"),
      tools,
      messages: [
        {
          role: "system",
          content: "You are a coding assistant. Make code changes as requested.",
        },
        {
          role: "user",
          content: "Create a file named test.txt with content 'Hello, World!'",
        },
      ],
      maxSteps: 10,
    });

    // Should have called write tool
    const writeCalls = result.toolCalls.filter(tc => tc.toolName === "write");
    expect(writeCalls.length).toBeGreaterThan(0);

    // Should confirm the write
    expect(result.text).toMatch(/wrote.*test.txt/);
  }, 30000);
});
```

---

#### Task 8.2: Chat Route Integration Test

**File**: `packages/server/tests/routes/chat.test.ts`

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { testing } from "vitest";
import { server } from "@ekacode/server/src/index";

describe("Chat route integration", () => {
  it("should stream agent responses", { async () => {
    const response = await server.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "What files are in this directory?",
        sessionId: "test-session-123",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    // Parse stream
    const reader = response.body.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    // Should have state updates
    const hasStateUpdate = chunks.some(chunk =>
      chunk.toString().includes('"type":"state"')
    );
    expect(hasStateUpdate).toBe(true);

    // Should have text delta
    const hasTextDelta = chunks.some(chunk =>
      chunk.toString().includes('"type":"text-delta"')
    );
    expect(hasTextDelta).toBe(true);
  }, 30000);
});
```

---

#### Task 8.3: search-docs Integration Test

**File**: `packages/core/tests/integration/search-docs-integration.test.ts`

```typescript
describe("search-docs: code research integration", () => {
  it("should research external repository", async () => {
    const zai = createZai({ apiKey: process.env.ZAI_API_KEY });

    const result = await generateText({
      model: zai("glm-4.7"),
      tools: { "search-docs": searchDocs },
      messages: [
        {
          role: "user",
          content: "How do I implement a custom tool in AI SDK v6?",
        },
      ],
      maxSteps: 10,
    });

    const toolCalls = result.toolCalls.filter(tc => tc.toolName === "search-docs");
    expect(toolCalls.length).toBeGreaterThan(0);

    const searchResult = JSON.parse(toolCalls[0].args);
    expect(searchResult.sessionId).toBeDefined();
  }, 60000);
});
```

---

### Phase 9: Fix Tool Context Access Patterns

**Priority**: LOW
**Estimated Time**: 1 hour

#### Task 9.1: Verify All Tools Use Instance.directory

**Checklist**:
- [ ] `packages/core/src/tools/filesystem/read.ts` uses `Instance.directory`
- [ ] `packages/core/src/tools/filesystem/write.ts` uses `Instance.directory`
- [ ] `packages/core/src/tools/filesystem/edit.ts` uses `Instance.directory`
- [ ] `packages/core/src/tools/shell/bash.tool.ts` uses `Instance.directory`
- [ ] `packages/core/src/tools/search-docs/git-manager.ts` uses `Instance.directory` for cache path

**Fix pattern**:
```typescript
// WRONG:
const fullPath = path.join(process.cwd(), relativePath);

// CORRECT:
const directory = Instance.directory; // Throws if not in context
const fullPath = path.join(directory, relativePath);
```

---

### Phase 10: Add Performance Optimizations

**Priority**: LOW
**Estimated Time**: 2 hours

#### Task 10.1: Add Response Caching

**File**: `packages/server/src/middleware/cache.ts` (new)

```typescript
import { LRUCache } from "lru-cache";

const responseCache = new LRUCache<string, string>({
  max: 100,
  ttl: 1000 * 60 * 5, // 5 minutes
});

export function cacheMiddleware() {
  return async (c: Context, next: Next) => {
    const cacheKey = c.req.url;

    // Check cache
    const cached = responseCache.get(cacheKey);
    if (cached) {
      return c.json(JSON.parse(cached));
    }

    await next();

    // Cache successful GET responses
    if (c.req.method === "GET" && c.res.status === 200) {
      responseCache.set(cacheKey, await c.res.text());
    }
  };
}
```

---

#### Task 10.2: Add Request Rate Limiting

**File**: `packages/server/src/middleware/rate-limit.ts` (new)

```typescript
import { rateLimit } from "express-rate-limit";

export const rateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  standardHeaders: true,
  message: "Too many requests from this IP, please try again later.",
});
```

---

### Phase 11: Documentation and Examples

**Priority**: MEDIUM
**Estimated Time**: 2 hours

#### Task 11.1: Create Integration Examples

**File**: `docs/integration-examples.md` (new)

```markdown
# Integration Examples

## Using the Chat API

```bash
curl -X POST http://localhost:4096/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic <base64>" \
  -d '{
    "message": "Create a function that adds two numbers",
    "sessionId": "optional-session-id"
  }'
```

## Using search_docs Tool

```typescript
import { generateText } from "ai";
import { createZai } from "@ai-sdk/zai";
import { searchDocs } from "@ekacode/core/tools";

const result = await generateText({
  model: createZai("glm-4.7"),
  tools: { "search-docs": searchDocs },
  messages: [
    { role: "user", content: "How do I use streamText?" }
  ],
});
```

## Starting the RLM Machine

```typescript
import { createRLMActor } from "@ekacode/core/state";

const actor = createRLMActor({
  goal: "Implement a REST API for user management",
  workspace: "/path/to/project",
});

actor.subscribe({
  next: (snapshot) => {
    console.log("State:", snapshot.value);
    console.log("Messages:", snapshot.context.messages);
  },
});

actor.start();
```
```

---

## End-to-End Testing Strategy

### Test Matrix

| Test Category | Tests | Priority |
|---------------|-------|----------|
| **Unit Tests** | Tool execution, DB operations, context propagation | HIGH |
| **Integration Tests** | Chat route → Agent, Tool → DB, Sequential thinking → Drizzle | HIGH |
| **E2E Tests** | Full workflow: UI → Chat → Agent → Tools → Files | HIGH |
| **Performance Tests** | Concurrent requests, large repos, long sessions | MEDIUM |
| **Security Tests** | Path traversal, auth bypass, tool access control | HIGH |

### Test Execution Order

1. **Phase 1**: Unit tests for individual components
2. **Phase 2**: Integration tests for each phase
3. **Phase 3**: Cross-phase integration tests
4. **Phase 4**: End-to-end workflow tests
5. **Phase 5**: Performance and stress tests
6. **Phase 6**: Security penetration tests

### Continuous Integration

**Add to CI pipeline**:
```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - name: Install dependencies
        run: pnpm install
      - name: Run unit tests
        run: pnpm test
      - name: Run integration tests
        run: pnpm test:integration
      - name: Run E2E tests
        run: pnpm test:e2e
```

---

## Deployment Checklist

### Pre-Deployment

- [ ] All tests passing (unit, integration, E2E)
- [ ] TypeScript compilation successful
- [ ] No ESLint errors
- [ ] No console errors or warnings
- [ ] Database migrations applied
- [ ] Environment variables configured
- [ ] Performance baselines established

### Deployment Steps

1. **Database Setup**:
   ```bash
   pnpm --filter @ekacode/server drizzle:push
   ```

2. **Build Desktop App**:
   ```bash
   pnpm --filter @ekacode/desktop build
   ```

3. **Start Server**:
   ```bash
   pnpm --filter @ekacode/server start
   ```

4. **Launch Desktop**:
   ```bash
   pnpm --filter @ekacode/desktop start
   ```

### Post-Deployment Verification

- [ ] Health check returns 200 OK
- [ ] Chat endpoint streams responses correctly
- [ ] All tools accessible through agent
- [ ] Sequential thinking persists across restarts
- [ ] search-docs can clone and research repositories
- [ ] Desktop app can connect to server

---

## Rollback Plan

If critical issues are found:

1. **Revert chat route changes**:
   ```bash
   git revert <commit-hash>
   ```

2. **Restore previous tool exports**:
   ```bash
   git checkout HEAD~1 -- packages/core/src/tools/index.ts
   ```

3. **Database migration rollback**:
   ```bash
   pnpm --filter @ekacode/server drizzle:rollback
   ```

---

## Success Criteria

The integration is considered complete when:

1. ✅ **Chat Endpoint Works**: `POST /api/chat` returns streamed AI responses
2. ✅ **All Tools Accessible**: Agent can use filesystem, search-docs, sequential-thinking
3. ✅ **XState Workflow**: Plan → Build → Done transitions work correctly
4. ✅ **Session Persistence**: Sessions and tool sessions survive server restart
5. ✅ **Multimodal Support**: Image URLs trigger vision model routing
6. ✅ **Error Recovery**: Graceful handling of failures and doom loops
7. ✅ **Performance**: Response time < 5s for simple queries
8. ✅ **Security**: No unauthorized tool execution or path traversal

---

## Appendix: File Changes Summary

### New Files to Create

1. `packages/core/src/state/types.ts` - State machine type exports
2. `packages/server/db/schema.ts` - Add sequential thinking tables
3. `packages/core/tests/integration/e2e-agent.test.ts` - E2E agent tests
4. `packages/server/tests/routes/chat.test.ts` - Chat route tests
5. `packages/core/tests/integration/search-docs-integration.test.ts` - search-docs tests
6. `docs/integration-examples.md` - Usage documentation

### Files to Modify

1. `packages/core/src/state/index.ts` - Add exports
2. `packages/core/src/tools/index.ts` - Export search-docs
3. `packages/core/src/tools/registry.ts` - Register tools
4. `packages/core/src/tools/sequential-thinking.ts` - Use Drizzle
5. `packages/server/src/routes/chat.ts` - Connect to agent
6. `packages/core/src/state/actors/plan-agent.ts` - Add search-docs tools
7. `packages/server/db/schema.ts` - Add sequential thinking schema

---

## Estimated Timeline

| Phase | Tasks | Time Estimate |
|-------|-------|---------------|
| 1 | Core Exports | 1 hour |
| 2 | Chat Route Integration | 3 hours |
| 3 | search-docs Integration | 2 hours |
| 4 | Sequential Thinking Drizzle | 2 hours |
| 5 | HybridAgent Verification | 2 hours |
| 6 | Tool Exports | 1 hour |
| 7 | Doom Loop Guards | 1 hour |
| 8 | Integration Tests | 4 hours |
| 9 | Tool Context Access | 1 hour |
| 10 | Performance | 2 hours |
| 11 | Documentation | 2 hours |
| **Total** | **11 phases** | **21 hours** |

---

## Next Steps

1. **Review this plan** with stakeholders
2. **Create GitHub issues** for each phase
3. **Assign priorities** to issues
4. **Begin implementation** with Phase 1 (Core Exports)
5. **Progress through phases sequentially**
6. **Test after each phase completion**
7. **Update ROADMAP.md** as items are completed

---

## Contact & Support

For questions or clarifications about this integration plan, refer to:
- Original cohesion plan: `00-cohesion-summary.md`
- Architecture plan: `new-architecture-plan.md`
- Integration plan: `new-integration.md`
- Sequential thinking: `new-sequential-thinking.md`
- Better context: `new-better-context.md`

**Last Updated**: 2026-01-30
**Version**: 1.0
