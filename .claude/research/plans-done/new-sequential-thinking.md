# Sequential Thinking Tool - Native AI SDK v6 Implementation (Z.ai-first)

## Cohesion Addendum (2026-01-28)
Aligned to `00-cohesion-summary.md`.

Key overrides:
- Session ownership: XState owns `sessionId`; tool sessions stored in Drizzle `tool_sessions`.
- IDs: UUIDv7 for session + tool sessions.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Decision](#architecture-decision)
3. [Complete Implementation](#complete-implementation)
4. [Usage Examples](#usage-examples)
5. [Integration with Agent Loops](#integration-with-agent-loops)
6. [Session Management](#session-management)
7. [Testing Guide](#testing-guide)
8. [Migration from MCP](#migration-from-mcp)

---

## Overview

The Sequential Thinking tool provides a **multi-turn reasoning capability** for AI agents built on Vercel AI SDK v6. Z.ai is the default provider (while keeping the tool provider-agnostic). It enables agents to break down complex problems into structured thoughts, with support for revision, branching, and iterative refinement.

### Key Features

| Feature                  | Description                                                       |
| ------------------------ | ----------------------------------------------------------------- |
| **Multi-turn reasoning** | Agents can iterate through 20+ thoughts in a single session       |
| **Revision support**     | Revisit and revise previous thoughts (isRevision, revisesThought) |
| **Branching**            | Explore alternative reasoning paths (branchFromThought, branchId) |
| **Dynamic adjustment**   | Adjust totalThoughts estimate up/down as understanding evolves    |
| **Session isolation**    | Each agent gets its own session, no shared state pollution        |
| **Pluggable**            | Works with XState, sub-agents, external systems                   |

### Use Cases

- **Design Phase**: System architecture, API design, component planning
- **Research Phase**: Multi-source analysis, synthesis, validation
- **Debugging**: Root cause analysis, hypothesis testing, verification
- **Planning**: Task breakdown, dependency mapping, risk assessment

---

## Architecture Decision

### Why Session Pattern?

| Approach                         | Pros                                                              | Cons                                               |
| -------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| **Stateful (XState-owned)**      | Convenient for single agent                                       | ❌ Not pluggable to sub-agents, ❌ XState coupling |
| **Factory (isolated instances)** | Clean isolation                                                   | ❌ Agent must manage tool instance lifecycle       |
| **Stateless (LLM history)**      | Zero state, maximum portability                                   | ❌ Large prompts with full history replay          |
| **Session Pattern** ✅           | ✅ Pluggable anywhere, ✅ Agent owns lifecycle, ✅ Portable state |

### Session Pattern Benefits

```
┌─────────────────────────────────────────────────────────────────┐
│                     AGENT LAYER (Any)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  XState     │  │  Sub-Agent  │  │  External   │             │
│  │  Plan Agent │  │  Explorer   │  │  System     │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│         └────────────────┴────────────────┘                     │
│                          │                                      │
│                    Tracks sessionId                             │
└──────────────────────────┼──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   SEQUENTIAL THINKING TOOL                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Session Store (Map<sessionId, Session>)                 │  │
│  │  - Isolated per agent                                   │  │
│  │  - Auto-cleanup TTL (30min)                             │  │
│  │  - Returns thoughtHistory for LLM context               │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Decision**: Agent owns `sessionId`, not the tool. This makes the tool pluggable to any orchestration layer.

---

## Complete Implementation

```typescript
// tools/sequential-thinking.ts
import { z } from "zod";
import { tool } from "ai";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================
type ThoughtEntry = {
  thoughtNumber: number;
  thought: string;
  totalThoughts: number;
  nextThoughtNeeded: boolean;
  isRevision?: boolean;
  revisesThought?: number;
  branchFromThought?: number;
  branchId?: string;
  needsMoreThoughts?: boolean;
  timestamp: number;
};

type Session = {
  id: string;
  createdAt: number;
  thoughts: ThoughtEntry[];
  branches: Set<string>;
};

// ============================================================================
// SESSION STORE (In-memory, replaceable with Redis/DB/etc)
// ============================================================================
const sessions = new Map<string, Session>();

// Auto-cleanup old sessions (30 minute TTL)
const SESSION_TTL_MS = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}, SESSION_TTL_MS);

// ============================================================================
// TOOL DEFINITION
// ============================================================================
const sequentialThinkingOutputSchema = z.object({
  sessionId: z.string().describe("Session ID for next call"),
  thoughtNumber: z.number(),
  totalThoughts: z.number(),
  nextThoughtNeeded: z.boolean(),
  thoughtHistory: z
    .array(
      z.object({
        thoughtNumber: z.number(),
        thought: z.string(),
        isRevision: z.boolean().optional(),
      })
    )
    .describe("Full thought history for context"),
  branches: z.array(z.string()).describe("Active branch IDs"),
  thoughtHistoryLength: z.number().describe("Total thoughts in session"),
  summary: z.string().optional().describe("Optional summary of thinking so far"),
});

export const createSequentialThinkingTool = (options: { sessionId?: string } = {}) =>
  tool({
    description: `A detailed tool for dynamic and reflective problem-solving through thoughts.
This tool helps analyze problems through a flexible thinking process that can adapt and evolve.
Each thought can build on, question, or revise previous insights as understanding deepens.

When to use this tool:
- Breaking down complex problems into steps
- Planning and design with room for revision
- Analysis that might need course correction
- Problems where the full scope might not be clear initially
- Problems that require a multi-step solution
- Tasks that need to maintain context over multiple steps
- Situations where irrelevant information needs to be filtered out

Key features:
- You can adjust totalThoughts up or down as you progress
- You can question or revise previous thoughts
- You can add more thoughts even after reaching what seemed like the end
- You can express uncertainty and explore alternative approaches
- Not every thought needs to build linearly - you can branch or backtrack

Parameters explained:
- thought: Your current thinking step
- nextThoughtNeeded: True if you need more thinking
- thoughtNumber: Current number in sequence (can go beyond initial total)
- totalThoughts: Current estimate (can be adjusted up/down)
- sessionId: Pass existing session ID to continue, or omit for new session
- isRevision, revisesThought, branchFromThought, branchId: Optional branching/revision
- clearSession: Set true to reset and start fresh

You should:
1. Start with an initial estimate of needed thoughts, but be ready to adjust
2. Feel free to question or revise previous thoughts
3. Don't hesitate to add more thoughts if needed, even at the "end"
4. Express uncertainty when present
5. Mark thoughts that revise previous thinking or branch into new paths
6. Ignore information that is irrelevant to the current step
7. Only set nextThoughtNeeded to false when truly done`,

    parameters: z.object({
      thought: z.string().describe("Your current thinking step"),
      nextThoughtNeeded: z.boolean().describe("Whether another thought step is needed"),
      thoughtNumber: z.number().int().min(1).describe("Current thought number (e.g., 1, 2, 3)"),
      totalThoughts: z
        .number()
        .int()
        .min(1)
        .describe("Estimated total thoughts needed (e.g., 5, 10)"),
      sessionId: z
        .string()
        .optional()
        .describe("Pass existing session ID to continue, or omit for new session"),
      isRevision: z.boolean().optional().describe("Whether this revises previous thinking"),
      revisesThought: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Which thought number is being reconsidered"),
      branchFromThought: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Branching point thought number"),
      branchId: z.string().optional().describe("Branch identifier"),
      needsMoreThoughts: z.boolean().optional().describe("If more thoughts are needed"),
      clearSession: z.boolean().optional().describe("Set true to reset and start fresh"),
    }),

    execute: async args => {
      const requestedSessionId = options.sessionId ?? args.sessionId;

      // Clear session if requested
      if (args.clearSession && requestedSessionId) {
        sessions.delete(requestedSessionId);
      }

      // Get or create session
      let sessionId = requestedSessionId;
      let session: Session;

      if (sessionId && sessions.has(sessionId)) {
        session = sessions.get(sessionId)!;
      } else {
        sessionId = crypto.randomUUID();
        session = {
          id: sessionId,
          createdAt: Date.now(),
          thoughts: [],
          branches: new Set(),
        };
        sessions.set(sessionId, session);
      }

      // Track branches
      if (args.branchId && !session.branches.has(args.branchId)) {
        session.branches.add(args.branchId);
      }

      // Add thought to history
      const thoughtEntry: ThoughtEntry = {
        thoughtNumber: args.thoughtNumber,
        thought: args.thought,
        totalThoughts: args.totalThoughts,
        nextThoughtNeeded: args.nextThoughtNeeded,
        isRevision: args.isRevision,
        revisesThought: args.revisesThought,
        branchFromThought: args.branchFromThought,
        branchId: args.branchId,
        needsMoreThoughts: args.needsMoreThoughts,
        timestamp: Date.now(),
      };
      session.thoughts.push(thoughtEntry);

      // Generate summary if session is complete
      let summary: string | undefined;
      if (!args.nextThoughtNeeded) {
        summary = `Sequential thinking complete: ${session.thoughts.length} thoughts processed across ${session.branches.size} branches.`;
      }

      // Return session state + history for LLM context
      return sequentialThinkingOutputSchema.parse({
        sessionId,
        thoughtNumber: args.thoughtNumber,
        totalThoughts: args.totalThoughts,
        nextThoughtNeeded: args.nextThoughtNeeded,
        thoughtHistory: session.thoughts.map(t => ({
          thoughtNumber: t.thoughtNumber,
          thought: t.thought,
          isRevision: t.isRevision,
        })),
        branches: Array.from(session.branches),
        thoughtHistoryLength: session.thoughts.length,
        summary,
      });
    },
  });

export const sequentialThinking = createSequentialThinkingTool();

// ============================================================================
// CLEANUP UTILITIES
// ============================================================================
export function clearSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function clearAllSessions(): void {
  sessions.clear();
}

export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

export function getAllSessions(): Map<string, Session> {
  return new Map(sessions);
}
```

---

## Usage Examples

### Example 1: XState Plan Agent (Design Phase)

```typescript
import { generateText } from "ai";
import type { CoreMessage } from "ai";
import type { CoreMessage } from "ai";
import { createZai } from "@ai-sdk/zai";
import { createToolLoopAgent } from "./agents/tool-loop-agent";
import { createSequentialThinkingTool } from "./tools/sequential-thinking";

const zai = createZai({ apiKey: process.env.ZAI_API_KEY });
const sequentialThinking = createSequentialThinkingTool();

// XState context
interface PlanAgentContext {
  sessionId?: string;
  messages: CoreMessage[];
  phase: "analyze_code" | "research" | "design";
}

// Design phase state
const designPhase = {
  invoke: {
    src: async (ctx: PlanAgentContext) => {
      const result = await generateText({
        model: zai("glm-4.7"),
        tools: { sequentialthinking: sequentialThinking /* ...other tools */ },
        messages: ctx.messages,
        maxSteps: 20,
      });

      const toolSessionId = result.toolResults?.find(
        item => item.toolName === "sequentialthinking"
      )?.result?.sessionId;
      ctx.sessionId = toolSessionId ?? ctx.sessionId;

      return result;
    },
    onDone: "transition_to_build",
    onError: "handle_error",
  },
};
```

### Example 2: Explore Sub-Agent (Independent Session)

```typescript
import { generateText } from "ai";
import { createZai } from "@ai-sdk/zai";
import { createSequentialThinkingTool } from "./tools/sequential-thinking";

const zai = createZai({ apiKey: process.env.ZAI_API_KEY });

// Sub-agent creates its own session, no parent context needed
const exploreAgent = async (query: string) => {
  return await generateText({
    model: zai("glm-4.7"),
    tools: {
      sequentialthinking: createSequentialThinkingTool(), // Gets its own sessionId
      code_search: codeSearch,
      grep,
      file_read: readFile,
    },
    messages: [{ role: "user", content: `Analyze: ${query}` }],
    maxSteps: 5,
  });

  // No sessionId tracking needed - agent owns it
};
```

### Example 3: External Agent (Non-XState)

```typescript
import { generateText } from "ai";
import { createZai } from "@ai-sdk/zai";
import { createSequentialThinkingTool } from "./tools/sequential-thinking";

const zai = createZai({ apiKey: process.env.ZAI_API_KEY });

// Works with ANY agent system, no XState dependency
class MyCustomAgent {
  private sessionId?: string;

  async think(problem: string) {
    const result = await generateText({
      model: zai("glm-4.7"),
      tools: {
        sequentialthinking: createSequentialThinkingTool({ sessionId: this.sessionId }),
      },
      messages: [{ role: "user", content: problem }],
      maxSteps: 10,
    });

    const toolSessionId = result.toolResults?.find(
      item => item.toolName === "sequentialthinking"
    )?.result?.sessionId;
    this.sessionId = toolSessionId ?? this.sessionId;

    return result.text;
  }

  async continueThinking(thought: string) {
    const result = await generateText({
      model: zai("glm-4.7"),
      tools: {
        sequentialthinking: createSequentialThinkingTool({ sessionId: this.sessionId }),
      },
      messages: [{ role: "user", content: thought }],
      maxSteps: 10,
    });

    const toolSessionId = result.toolResults?.find(
      item => item.toolName === "sequentialthinking"
    )?.result?.sessionId;
    this.sessionId = toolSessionId ?? this.sessionId;

    return result.text;
  }
}
```

### Example 4: Multi-Agent System

```typescript
import { createZai } from "@ai-sdk/zai";
import { createSequentialThinkingTool } from "./tools/sequential-thinking";

const zai = createZai({ apiKey: process.env.ZAI_API_KEY });

// Multiple agents, each with own session
const agents = {
  architect: createToolLoopAgent({
    name: "architect",
    model: zai("glm-4.7"),
    tools: { sequentialthinking: createSequentialThinkingTool() },
    maxSteps: 10,
  }),
  planner: createToolLoopAgent({
    name: "planner",
    model: zai("glm-4.7"),
    tools: { sequentialthinking: createSequentialThinkingTool() },
    maxSteps: 10,
  }),
  validator: createToolLoopAgent({
    name: "validator",
    model: zai("glm-4.7"),
    tools: { sequentialthinking: createSequentialThinkingTool() },
    maxSteps: 10,
  }),

  // Sessions don't interfere - complete isolation
};

// Each agent uses sequentialThinking independently
await Promise.all([
  agents.architect.run({ messages: [{ role: "user", content: "Design API..." }] }),
  agents.planner.run({ messages: [{ role: "user", content: "Plan tasks..." }] }),
  agents.validator.run({ messages: [{ role: "user", content: "Review PR..." }] }),
]);
```

---

## Integration with Agent Loops

### Phase-Specific Loop Settings (AI SDK v6)

```typescript
// Design phase: allow up to 20 tool steps
const designPhase = { maxSteps: 20 };

// Research phase: allow up to 15 tool steps
const researchPhase = { maxSteps: 15 };

// Analyze code: single-shot
const singleShot = { maxSteps: 1 };

await generateText({
  model: zai("glm-4.7"),
  tools: { sequentialthinking: sequentialThinking },
  messages,
  maxSteps: designPhase.maxSteps,
});
```

### XState Integration Pattern

```typescript
import { generateText } from "ai";
import type { CoreMessage } from "ai";
import { createZai } from "@ai-sdk/zai";

const zai = createZai({ apiKey: process.env.ZAI_API_KEY });

const planAgentMachine = setup({
  types: {
    context: {} as {
      sessionId?: string;
      messages: CoreMessage[];
      phase: PlanPhase;
    },
    events: {} as
      | { type: "design.complete" }
      | { type: "research.complete" }
      | { type: "analyze.complete" },
  },
  actors: {
    runDesignPhase: fromPromise(async ({ input: ctx }) => {
      return await generateText({
        model: zai("glm-4.7"),
        tools: { sequentialthinking: sequentialThinking },
        maxSteps: 20,
        messages: ctx.messages,
      });
    }),
  },
}).createMachine({
  initial: "analyze_code",
  states: {
    analyze_code: {
      invoke: {
        src: "runAnalyzeCodePhase",
        onDone: "research",
      },
    },
    research: {
      invoke: {
        src: "runResearchPhase",
        onDone: "design",
      },
    },
    design: {
      invoke: {
        src: "runDesignPhase",
        onDone: "plan_complete",
      },
    },
    plan_complete: { type: "final" },
  },
});
```

---

## Session Management

### Session Lifecycle

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   CREATE    │ -> │   UPDATE    │ -> │   UPDATE    │ -> │  EXPIRE    │
│ (no sessionId)│   │(with sessionId)│   │(with sessionId)│   │(TTL or clear)│
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
      │                  │                  │                  │
      ▼                  ▼                  ▼                  ▼
 crypto.randomUUID()  sessions.get()    sessions.set()    sessions.delete()
 sessions.set()      sessions.set()
```

### Session State Structure

```typescript
type Session = {
  id: string; // UUID
  createdAt: number; // Timestamp
  thoughts: ThoughtEntry[]; // All thoughts in order
  branches: Set<string>; // Active branch IDs
};

type ThoughtEntry = {
  thoughtNumber: number;
  thought: string;
  totalThoughts: number;
  nextThoughtNeeded: boolean;
  isRevision?: boolean;
  revisesThought?: number;
  branchFromThought?: number;
  branchId?: string;
  needsMoreThoughts?: boolean;
  timestamp: number;
};
```

### Manual Session Control

```typescript
import { clearSession, clearAllSessions, getSession } from "./tools/sequential-thinking";

// Clear specific session
clearSession("abc-123-session-id");

// Clear all sessions (e.g., between tests)
clearAllSessions();

// Inspect session state
const session = getSession("abc-123-session-id");
console.log("Thoughts:", session?.thoughts.length);
console.log("Branches:", session?.branches.size);
```

### Auto-Cleanup TTL

```typescript
// Default: 30 minutes
const SESSION_TTL_MS = 30 * 60 * 1000;

// Customize for different environments
const PRODUCTION_TTL = 60 * 60 * 1000; // 1 hour
const TESTING_TTL = 5 * 60 * 1000; // 5 minutes
const DEVELOPMENT_TTL = 30 * 60 * 1000; // 30 minutes
```

---

## Testing Guide

### Unit Testing

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { sequentialThinking, clearAllSessions } from "./sequential-thinking";

describe("sequentialThinking tool", () => {
  beforeEach(() => {
    clearAllSessions(); // Isolate each test
  });

  it("creates new session on first call", async () => {
    const result = await sequentialThinking.execute({
      thought: "First thought",
      thoughtNumber: 1,
      totalThoughts: 5,
      nextThoughtNeeded: true,
    });

    expect(result.sessionId).toBeDefined();
    expect(result.thoughtHistoryLength).toBe(1);
  });

  it("continues session with existing sessionId", async () => {
    const first = await sequentialThinking.execute({
      thought: "First",
      thoughtNumber: 1,
      totalThoughts: 3,
      nextThoughtNeeded: true,
    });

    const second = await sequentialThinking.execute({
      thought: "Second",
      thoughtNumber: 2,
      totalThoughts: 3,
      nextThoughtNeeded: false,
      sessionId: first.sessionId,
    });

    expect(second.sessionId).toBe(first.sessionId);
    expect(second.thoughtHistoryLength).toBe(2);
  });

  it("supports revision", async () => {
    const first = await sequentialThinking.execute({
      thought: "Initial assumption",
      thoughtNumber: 1,
      totalThoughts: 3,
      nextThoughtNeeded: true,
    });

    const revision = await sequentialThinking.execute({
      thought: "Revised: Actually, the assumption was wrong",
      thoughtNumber: 2,
      totalThoughts: 3,
      nextThoughtNeeded: false,
      sessionId: first.sessionId,
      isRevision: true,
      revisesThought: 1,
    });

    expect(revision.thoughtHistory[1].isRevision).toBe(true);
  });

  it("clears session when requested", async () => {
    const first = await sequentialThinking.execute({
      thought: "First",
      thoughtNumber: 1,
      totalThoughts: 3,
      nextThoughtNeeded: true,
    });

    const cleared = await sequentialThinking.execute({
      thought: "Fresh start",
      thoughtNumber: 1,
      totalThoughts: 5,
      nextThoughtNeeded: true,
      sessionId: first.sessionId,
      clearSession: true,
    });

    expect(cleared.thoughtHistoryLength).toBe(1); // Reset
    expect(cleared.sessionId).not.toBe(first.sessionId); // New ID
  });
});
```

### Integration Testing

```typescript
import { describe, it, expect } from "vitest";
import { generateText } from "ai";
import { createZai } from "@ai-sdk/zai";
import { sequentialThinking } from "./sequential-thinking";

describe("sequentialThinking in agent loop", () => {
  it("completes multi-turn reasoning", async () => {
    const zai = createZai({ apiKey: process.env.ZAI_API_KEY });
    const messages: CoreMessage[] = [
      {
        role: "user",
        content: "Design a REST API for user management",
      },
    ];

    const result = await generateText({
      model: zai("glm-4.7"),
      tools: { sequentialthinking: sequentialThinking },
      messages,
      maxSteps: 20,
    });

    const sessionId = result.toolResults?.find(
      item => item.toolName === "sequentialthinking"
    )?.result?.sessionId;

    expect(sessionId).toBeDefined();
  });
});
```

---

## Migration from MCP

### MCP vs Native AI SDK v6

| Aspect           | MCP Server                     | Native Tool                 |
| ---------------- | ------------------------------ | --------------------------- |
| **Transport**    | stdio (separate process)       | Direct function call        |
| **State**        | SequentialThinkingServer class | Session store Map           |
| **Registration** | `server.registerTool()`        | `tool({ description, parameters, execute })` |
| **Response**     | `CallToolResult` + JSON parse  | Plain typed return          |
| **Pluggability** | MCP client required            | Works anywhere              |

### MCP Code (Before)

```typescript
// MCP server - separate process
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SequentialThinkingServer } from "./lib.js";

const server = new McpServer({ name: "sequential-thinking-server" });
const thinkingServer = new SequentialThinkingServer();

server.registerTool(
  "sequentialthinking",
  {
    inputSchema: {
      /* Zod schemas */
    },
    outputSchema: {
      /* Zod schemas */
    },
  },
  async args => {
    const result = thinkingServer.processThought(args);
    const parsedContent = JSON.parse(result.content[0].text);
    return { content: result.content, structuredContent: parsedContent };
  }
);
```

### Native Tool (After)

```typescript
// Native AI SDK v6 tool - in-process
import { tool } from "ai";
import { z } from "zod";

export const sequentialThinking = tool({
  description: "Sequential thinking tool",
  parameters: z.object({
    /* ... */
  }),
  execute: async args => {
  // Session-based state management
  const sessionId = args.sessionId ?? crypto.randomUUID();
  // ... process thought
  return { sessionId, thoughtHistory /* ... */ };
  },
});
```

### Migration Benefits

- ✅ **No separate process** - runs in same Node.js runtime
- ✅ **Type-safe** - full TypeScript inference
- ✅ **Pluggable** - works with any agent system
- ✅ **Simpler** - no MCP SDK dependency
- ✅ **Faster** - no stdio serialization overhead

---

## Quick Reference

### Input Schema

```typescript
{
  thought: string;              // Required: Current thinking step
  nextThoughtNeeded: boolean;   // Required: Continue?
  thoughtNumber: number;        // Required: Current step (1, 2, 3...)
  totalThoughts: number;        // Required: Estimated total
  sessionId?: string;           // Optional: Continue existing session
  isRevision?: boolean;         // Optional: Is this a revision?
  revisesThought?: number;      // Optional: Which thought to revise
  branchFromThought?: number;   // Optional: Branching point
  branchId?: string;            // Optional: Branch identifier
  needsMoreThoughts?: boolean;  // Optional: Need more?
  clearSession?: boolean;       // Optional: Reset session
}
```

### Output Schema

```typescript
{
  sessionId: string;            // Session ID for next call
  thoughtNumber: number;        // Echoed from input
  totalThoughts: number;        // Echoed from input
  nextThoughtNeeded: boolean;   // Echoed from input
  thoughtHistory: Array<{       // Full history for LLM context
    thoughtNumber: number;
    thought: string;
    isRevision?: boolean;
  }>;
  branches: string[];           // Active branch IDs
  thoughtHistoryLength: number; // Total thoughts in session
  summary?: string;             // Completion summary
}
```

### Best Practices

1. **Always track sessionId** - Store in agent context between tool calls
2. **Use clearSession for reset** - Don't manually delete during active session
3. **Set nextThoughtNeeded=false** - Signals completion, generates summary
4. **Pass thoughtHistory to LLM** - Included in response for context
5. **Test in isolation** - Use `clearAllSessions()` in beforeEach

---

## Summary

The Sequential Thinking tool provides **pluggable, session-based multi-turn reasoning** for AI agents. Key takeaways:

- **Session Pattern**: Agent owns `sessionId`, tool is stateless between calls
- **Pluggable**: Works with XState, sub-agents, external systems
- **Isolated**: Each agent gets its own session, no shared state pollution
- **Loop Integration**: Designed for 20-iteration design phase, 15-iteration research phase
- **Migration Ready**: Drop-in replacement for MCP server implementation

The tool is ready to integrate into the RLM architecture as documented in `new-integration.md`.
