# XState + Vercel AI SDK Integration: Hierarchical 2-Agent RLM Architecture

> A comprehensive integration guide for building an autonomous coding agent using XState v5 for state management and Vercel AI SDK as the LLM abstraction layer with a hierarchical 2-agent system (Plan + Build), state-dependent tool routing, and doom loop detection.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Technology Stack](#technology-stack)
4. [Agent Loop Strategies](#agent-loop-strategies)
5. [XState v5 State Machine Design](#xstate-v5-state-machine-design)
6. [TanStack AI Integration](#tanstack-ai-integration)
7. [Frontend Integration](#frontend-integration)
8. [Tool System](#tool-system)
9. [Agent Configuration](#agent-configuration)
10. [Doom Loop Detection](#doom-loop-detection)
11. [Implementation](#implementation)
12. [Project Structure](#project-structure)
13. [Quick Reference](#quick-reference)

---

## Executive Summary

### The Architecture

**Vercel AI SDK** serves as the **LLM abstraction layer** - it handles provider abstraction, tool execution, and streaming. **XState v5** orchestrates the entire workflow. Frontend integration uses direct streaming or `@ai-sdk/react` for real-time chat UI.

```
Frontend (Solid.js) → Workflow (XState) → Server (Node.js) → Vercel AI SDK → LLM Providers
```

### Key Insights from Analysis

| Aspect                    | Finding                                       | Solution                                        |
| ------------------------- | --------------------------------------------- | ----------------------------------------------- |
| **State-Dependent Tools** | Vercel AI SDK uses static tool arrays         | Filter tools before each streamText() call      |
| **Multi-Agent Hierarchy** | Vercel AI SDK is single-call focused          | XState orchestrates, Vercel AI SDK executes     |
| **Loop Requirements**     | All phases need multi-turn loops              | Intent-based looping via XState control flow    |
| **Sequential Thinking**   | Requires multi-turn agent loop                | Intent-based with 100-iteration safety limit    |
| **Research Tools**        | webSearch/docsLookup need multiple iterations | Intent-based with 100-iteration safety limit    |
| **Message Ownership**     | Vercel AI SDK requires messages array         | XState context as source of truth               |
| **Frontend Streaming**    | Need real-time UI updates                     | Direct streaming or @ai-sdk/react useChat hook  |
| **Agent Autonomy**        | Hard iteration limits cut off work            | Use `finishReason === 'stop'` as primary signal |

### The Solution Stack

| Component               | Technology                                  | Purpose                                                  |
| ----------------------- | ------------------------------------------- | -------------------------------------------------------- |
| **Frontend**            | Solid.js + Direct streaming / @ai-sdk/react | Chat UI, real-time streaming                             |
| **Orchestration**       | XState v5                                   | Hierarchical state machine with loop control             |
| **LLM Layer**           | Vercel AI SDK                               | Provider abstraction, tools, streaming                   |
| **Plan Agent**          | GPT-4o                                      | analyze_code → research → design (all intent-based)      |
| **Research Loop**       | GPT-4o                                      | webSearch, docsLookup, sequentialThinking (intent-based) |
| **Design Loop**         | GPT-4o                                      | sequentialThinking, createPlan (intent-based)            |
| **Explore Subagent**    | GPT-4o-mini                                 | Cost-effective codebase exploration (intent-based)       |
| **Build Agent**         | Claude 3.5 Sonnet                           | implement ⇄ validate (intent-based)                      |
| **Doom Loop Detection** | XState guards                               | Prevent infinite fix loops (safety only)                 |

---

## Architecture Overview

### System Layers

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Solid.js)                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Frontend Streaming (Direct / @ai-sdk/react)                   │   │
│  │  - Real-time streaming updates via SSE                          │   │
│  │  - Tool call visualization                                      │   │
│  │  - Message history UI                                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────────┘
                             │ SSE / WebSocket
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      WORKFLOW (XState Machine)                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Hierarchical RLM Orchestrator                                  │   │
│  │  - State management (plan.analyze → build.implement)            │   │
│  │  - Doom loop detection (guards)                                 │   │
│  │  - Tool routing (plan-only vs build-only)                        │   │
│  │  - Message filtering & caching                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────────┘
                             │ chat() calls
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   VERCEL AI SDK (LLM Layer)                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  streamText({ model, tools, messages })                        │   │
│  │  - Provider abstraction (OpenAI/Anthropic via providers)       │   │
│  │  - Tool execution (tool() definitions)                          │   │
│  │  - Streaming (AsyncIterable<StreamPart>)                        │   │
│  │  - Type safety (Zod schemas)                                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTP
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       LLM Providers                                     │
│     OpenAI (gpt-4o)     Anthropic (claude-3.5)     OpenAI (gpt-4o-mini) │
└─────────────────────────────────────────────────────────────────────────┘
```

### Why This Architecture Works

| Layer                 | Responsibility         | Benefit                                                        |
| --------------------- | ---------------------- | -------------------------------------------------------------- |
| **Solid + Streaming** | UI & real-time updates | Direct SSE streaming or @ai-sdk/react hooks                    |
| **XState**            | Workflow orchestration | Hierarchical states, guards, loop control, doom loop detection |
| **Vercel AI SDK**     | LLM abstraction        | Provider-agnostic via providers, type-safe tools, streaming    |
| **LLM Providers**     | Model inference        | Switch between OpenAI/Anthropic seamlessly                     |

---

## Technology Stack

### XState v5

**Key Concepts:**

- `createMachine()` - Define state machines
- `createActor()` - Spawn running instances
- Hierarchical states - Parent/child relationships
- Context - Shared state across machine
- Guards - Conditional transition logic
- `fromPromise()` - Create actors from async functions

### Vercel AI SDK

**Key Concepts:**

- `streamText()` - Main streaming function
- Providers - `openai()`, `anthropic()`
- `tool()` - Type-safe tool definitions
- `tool().execute()` - Server-side tool implementations
- `experimental_continueSteps` / custom control - Multi-step tool roundtrips
- `AsyncIterable<StreamPart>` - Streaming output
- Loop control via XState (no built-in agent loop strategies)

### Frontend Integration Options

**Key Concepts:**

- Direct SSE streaming - Use `streamText()` with server-side events
- `@ai-sdk/react` - React hooks (`useChat`, `useCompletion`)
- Framework-agnostic - Works with any frontend via streaming

---

## Agent Loop Strategies

### Critical Understanding

**All phases use multi-turn loops controlled by XState with intent-based completion.** Since Vercel AI SDK doesn't have built-in agent loop strategies, XState handles the loop control logic. Hard iteration caps are only safety nets - the agent naturally stops when done via `finishReason`. Even `analyze_code` needs multiple turns to think through the request before spawning the explore subagent.

### Why Each Phase Needs Its Loop Strategy

| Phase            | Loop?               | Reason                                                 | Tools Requiring Iteration                         |
| ---------------- | ------------------- | ------------------------------------------------------ | ------------------------------------------------- |
| **analyze_code** | ✅ Yes (5 iter)     | Needs to think through request before spawning explore | sequentialThinking, then spawnExplore             |
| **research**     | ✅ Yes (100 safety) | Multiple web searches, docs lookups                    | webSearch, docsLookup, gitLog, sequentialThinking |
| **design**       | ✅ Yes (100 safety) | Sequential thinking requires multi-turn                | sequentialThinking, createPlan, validatePlan      |
| **implement**    | ✅ Yes (50 safety)  | Standard implementation loop                           | editFile, generateCode, formatCode                |
| **validate**     | ✅ Yes (recursive)  | Recursive validation until clean                       | typescriptCheck, eslintCheck, lspDiagnostics      |

### Implementation

```typescript
// ============================================================================
// AGENT LOOP STRATEGIES (XState-based control)
// ============================================================================
//
// KEY PRINCIPLE: The agent naturally stops when it's done.
// - finishReason === 'stop' → Agent is done (no more tools needed)
// - finishReason === 'tool-calls' → Agent wants to continue (has more work)
// - finishReason === null → Still streaming/thinking
//
// Hard iteration caps are ONLY for doom loop protection (safety net).
// Agents should rarely hit these limits if working correctly.
//
// NOTE: Vercel AI SDK doesn't have built-in agent loop strategies.
// Loop control is handled by XState services checking finishReason.
// ============================================================================

// Loop control function for use in XState services
type LoopControlResult = { shouldContinue: boolean; reason?: string };

function checkLoopControl(params: {
  iterationCount: number;
  finishReason: string | null | undefined;
  safetyLimit: number;
  phaseName: string;
}): LoopControlResult {
  const { iterationCount, finishReason, safetyLimit, phaseName } = params;

  // Primary: Let agent decide when done via finishReason
  if (finishReason === "stop") {
    return { shouldContinue: false, reason: "Agent signaled completion" };
  }
  if (finishReason === "tool-calls") {
    return { shouldContinue: true, reason: "Agent has more tool calls" };
  }
  if (finishReason === null || finishReason === undefined) {
    return { shouldContinue: true, reason: "Still streaming" };
  }

  // Safety: Doom loop protection (should rarely hit this)
  if (iterationCount >= safetyLimit) {
    console.warn(`⚠️ ${phaseName} hit safety limit (${safetyLimit}), possible doom loop`);
    return { shouldContinue: false, reason: "Safety limit reached" };
  }

  // Default: Continue if no finish reason yet
  return { shouldContinue: true, reason: "No finish reason yet" };
}

// Safety limits for each phase
const PHASE_SAFETY_LIMITS: Record<PlanPhase | BuildPhase, number> = {
  // Plan phases
  analyze_code: 5, // Small loop for planning before spawning explore
  research: 100, // Intent-based with large safety net
  design: 100, // Intent-based with large safety net

  // Build phases
  implement: 50, // Implementation loop
  validate: 100, // Recursive validation
};

// XState service wrapper for multi-turn execution
async function executeMultiTurnAgent<T>(params: {
  phase: PlanPhase | BuildPhase;
  messages: Array<Message>;
  tools: Record<string, Tool>;
  model: LanguageModel;
  systemPrompt: string;
  maxIterations?: number;
}): Promise<{ messages: Array<Message>; finishReason: string | null | undefined }> {
  const { phase, messages, tools, model, systemPrompt, maxIterations } = params;
  const safetyLimit = maxIterations ?? PHASE_SAFETY_LIMITS[phase];

  let currentMessages = [...messages, { role: "system", content: systemPrompt }];
  let iterationCount = 0;
  let finishReason: string | null | undefined = null;

  while (iterationCount < safetyLimit) {
    iterationCount++;

    const result = await streamText({
      model,
      messages: currentMessages,
      tools,
      temperature: phase === "design" ? 0.7 : 0.3,
    });

    // Consume the stream and collect response
    const response = await consumeStream(result);
    currentMessages = response.messages;
    finishReason = response.finishReason;

    // Check if we should continue
    const control = checkLoopControl({
      iterationCount,
      finishReason,
      safetyLimit,
      phaseName: phase,
    });

    if (!control.shouldContinue) {
      console.log(`[${phase}] Loop stopping: ${control.reason} (${iterationCount} iterations)`);
      break;
    }
  }

  return { messages: currentMessages, finishReason };
}

// Helper to consume stream and collect messages
async function consumeStream(
  result: ReturnType<ReturnType<typeof streamText>["toReadableStream"]>
): Promise<{ messages: Array<Message>; finishReason: string | null | undefined }> {
  // Consume the stream and extract messages and finishReason
  // Implementation depends on how you want to handle streaming
  // This is a simplified version
  const reader = result.toReadableStream().getReader();
  let finishReason: string | null | undefined = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // Process stream chunks
    if (value.type === "finish") {
      finishReason = value.finishReason;
    }
  }

  return { messages: [], finishReason };
}
```

### Intent-Based vs Iteration-Limited Looping

**Why Intent-Based?**

| Approach              | Problem                                            | Solution                                            |
| --------------------- | -------------------------------------------------- | --------------------------------------------------- |
| **Iteration-Limited** | Agent cut off mid-task at arbitrary limits         | ❌ "Research stopped at 15 searches, but needed 16" |
| **Intent-Based**      | Agent naturally stops when done via `finishReason` | ✅ Agent runs until it signals completion           |

**How It Works:**

```typescript
// Vercel AI SDK provides finishReason from the LLM:
finishReason: "tool-calls" | "stop" | "length" | "content-filter" | null;

// 'tool-calls' = "I have more work to do" → CONTINUE
// 'stop' = "I'm done, no more tools needed" → STOP
// null = "Still thinking/streaming" → CONTINUE
```

**Example Flow:**

```
Research Phase:
  Iteration 1: webSearch("React hooks") → finishReason='tool-calls' → CONTINUE
  Iteration 2: docsLookup("useEffect") → finishReason='tool-calls' → CONTINUE
  Iteration 3: sequentialThinking("Synthesize...") → finishReason='tool-calls' → CONTINUE
  Iteration 4: (no tools) → finishReason='stop' → STOP
  → Total: 4 iterations (agent decided when done)

With iteration limit (old approach):
  Would need to predict: 15? 20? 50?
  Too low: cut off mid-task ❌
  Too high: waste money on doom loops ❌
```

**Safety Limits Are Only for Doom Loops:**

The iteration counts (5, 100, 50) are **safety nets**, not normal flow control:

- Agents should rarely hit these limits
- If hit, it indicates a potential bug or doom loop
- Logged as warnings for investigation

### Sequential Thinking Tool Integration

The sequential thinking tool requires multiple iterations because it builds a chain of thoughts:

```typescript
// Example sequential thinking flow:
// Iteration 1: thought="Analyze requirements" → nextThoughtNeeded=true
// Iteration 2: thought="Identify key components" → nextThoughtNeeded=true
// Iteration 3: thought="Propose architecture" → isRevision=true, revisesThought=2
// Iteration 4: thought="Verify design" → nextThoughtNeeded=false (DONE)

import { tool } from "ai";
import { z } from "zod";

const sequentialThinkingTool = tool({
  description: "Multi-step reasoning for complex analysis",
  parameters: z.object({
    thought: z.string(),
    thoughtNumber: z.number(),
    totalThoughts: z.number(),
    nextThoughtNeeded: z.boolean(),
    isRevision: z.boolean().optional(),
    revisesThought: z.number().optional(),
  }),
  execute: async args => {
    // Process thought and return whether to continue
    console.log(
      `[Sequential Thinking] Thought ${args.thoughtNumber}/${args.totalThoughts}: ${args.thought}`
    );

    return {
      thoughtNumber: args.thoughtNumber + 1,
      totalThoughts: args.totalThoughts,
      nextThoughtNeeded: args.nextThoughtNeeded,
    };
  },
});
```

---

## XState v5 State Machine Design

### Hierarchical State Structure

```typescript
// ============================================================================
// HIERARCHICAL STATE TYPES
// ============================================================================

type AgentMode = "plan" | "build";
type PlanPhase = "analyze_code" | "research" | "design";
type BuildPhase = "implement" | "validate";
type TerminalState = "done" | "failed";

type HierarchicalState =
  | { mode: "plan"; phase: PlanPhase }
  | { mode: "build"; phase: BuildPhase }
  | TerminalState;

// ============================================================================
// XSTATE CONTEXT
// ============================================================================

interface RLMMachineContext {
  messages: Array<Message>;
  goal: string;
  iterationCount: number;
  recentStates: Array<{ state: HierarchicalState; timestamp: number }>;
  lastState: string | null;
  toolExecutionCount: number;
  errorCounts: Record<string, number>;
  spawnExploreAgentResult?: string;
}

// ============================================================================
// XSTATE EVENTS
// ============================================================================

type RLMMachineEvent =
  | { type: "SPAWN_EXPLORE_COMPLETE"; result: string }
  | { type: "PLAN_AGENT_COMPLETE"; phase: PlanPhase; content: string }
  | { type: "BUILD_AGENT_COMPLETE"; phase: BuildPhase; content: string }
  | { type: "DOOM_LOOP_DETECTED" }
  | { type: "COMPLETE" }
  | { type: "FAIL"; error: string };
```

### State Transition Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│              XSTATE HIERARCHICAL STATE MACHINE                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  PARENT: plan                                                        │   │
│  │  ┌────────────┐    ┌────────────┐    ┌──────────────┐             │   │
│  │  │analyze_code│───→│  research   │───→│    design     │             │   │
│  │  │(MULTI-TURN)│    │ (MULTI-TURN)│    │ (MULTI-TURN)  │             │   │
│  │  │invoke:     │    │ invoke:     │    │invoke:       │             │   │
│  │  │spawnExplore│    │runPlanAgent│    │runPlanAgent  │             │   │
│  │  │(gpt-4o-m) │    │(gpt-4o)    │    │(gpt-4o)     │             │   │
│  │  │5 iter safe │    │100 iter safe│    │100 iter safe│             │   │
│  │  │intent-based│    │intent-based│    │intent-based  │             │   │
│  │  └────────────┘    └────────────┘    │───┬───────────┘             │   │
│  │                                              ↓               │   │
│  │                                         spawnExploreAgent │   │
│  │                                         done             │   │
│  └────────────────────────────────────────┴─────────────────┘   │
│                                              ↓                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  PARENT: build                                                       │   │
│  │  ┌──────────────┐              ┌──────────────┐                      │   │
│  │  │  implement   │←─────────────→│   validate   │                      │   │
│  │  │              │              │              │                      │   │
│  │  │invoke:     │   always:     │invoke:       │                      │   │
│  │  │runBuildAgent │   check guard │runBuildAgent │                      │   │
│  │  │(claude-3.5) │   →implement  │(claude-3.5) │                      │   │
│  │  │50 iter safe │   if errors   │              │                      │   │
│  │  │intent-based│               │              │                      │   │
│  │  └──────────────┘              └──────────────┘                      │   │
│  │                                                                         │   │
│  │  ┌───────────────────────────────────────────────────────────────┐ │   │
│  │  │ doomLoopDetector: Guard checks doom loop conditions          │ │   │
│  │  │ 1. Oscillation: implement → validate (5+ times)             │ │   │
│  │  │ 2. No progress: Error count not decreasing                  │ │   │
│  │  │ 3. Time threshold: >10 minutes in build mode              │ │   │
│  │  └───────────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key Change**: All phases now use **intent-based looping** where the agent naturally stops via `finishReason === 'stop'`. The iteration limits shown are only **safety nets** for doom loop protection - agents should rarely hit these limits when working correctly.

### XState Machine Implementation

```typescript
// ============================================================================
// XSTATE HIERARCHICAL RLM MACHINE
// ============================================================================

import { createMachine, assign, fromPromise, setup, type ActorRefFrom } from "xstate";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import type { Message, Tool } from "ai";
import type { LanguageModel } from "ai";

export const rlmMachine = createMachine<RLMMachineContext, RLMMachineEvent>({
  id: "rlm",
  initial: "plan",
  context: {
    messages: [],
    goal: "",
    iterationCount: 0,
    recentStates: [],
    lastState: null,
    toolExecutionCount: 0,
    errorCounts: {},
  },
  states: {
    // ==========================================================================
    // PLAN AGENT (Linear Progression)
    // ==========================================================================
    plan: {
      initial: "analyze_code",
      states: {
        // ------------------------------------------------------------------------
        // PHASE 1: Analyze code (spawn explore subagent)
        // ------------------------------------------------------------------------
        analyze_code: {
          entry: assign({
            lastState: () => JSON.stringify({ mode: "plan", phase: "analyze_code" }),
          }),
          invoke: {
            src: "spawnExploreAgent",
            input: ({ context }) => ({ messages: context.messages }),
            onDone: {
              target: "research",
              actions: [
                assign({
                  spawnExploreAgentResult: (_ctx, event) => event.output,
                }),
                assign({
                  messages: context => [
                    ...context.messages,
                    {
                      role: "system",
                      content: `## EXPLORE SUBAGENT FINDINGS\n\n${event.output}`,
                    },
                  ],
                }),
              ],
            },
          },
        },

        // ------------------------------------------------------------------------
        // PHASE 2: Research (MULTI-TURN for web search + docs lookup)
        // ------------------------------------------------------------------------
        research: {
          entry: assign({
            lastState: () => JSON.stringify({ mode: "plan", phase: "research" }),
          }),
          invoke: {
            src: "runPlanAgent",
            input: ({ context }) => ({
              messages: context.messages,
              phase: "research",
            }),
            onDone: {
              target: "design",
              actions: assign({
                messages: (context, event) => [
                  ...context.messages,
                  { role: "assistant", content: event.output },
                ],
              }),
            },
          },
        },

        // ------------------------------------------------------------------------
        // PHASE 3: Design (MULTI-TURN for sequential thinking)
        // ------------------------------------------------------------------------
        design: {
          entry: assign({
            lastState: () => JSON.stringify({ mode: "plan", phase: "design" }),
          }),
          invoke: {
            src: "runPlanAgent",
            input: ({ context }) => ({
              messages: context.messages,
              phase: "design",
            }),
            onDone: {
              target: "build",
              actions: assign({
                messages: (context, event) => [
                  ...context.messages,
                  {
                    role: "system",
                    content: `## HANDOVER: PLAN → BUILD\n\nThe planning phase is complete. You are now in BUILD mode.\nYou have the execution plan from the plan agent.\nYour job: Implement and validate until LSP checks pass.`,
                  },
                  { role: "assistant", content: event.output },
                ],
              }),
            },
          },
        },
      },
    },

    // ==========================================================================
    // BUILD AGENT (Recursive Loop with Doom Loop Detection)
    // ==========================================================================
    build: {
      initial: "implement",
      states: {
        // ------------------------------------------------------------------------
        // PHASE 1: Implement (run build agent)
        // ------------------------------------------------------------------------
        implement: {
          entry: assign({
            lastState: () => JSON.stringify({ mode: "build", phase: "implement" }),
          }),
          invoke: {
            src: "runBuildAgent",
            input: ({ context }) => ({
              messages: context.messages,
              phase: "implement",
            }),
            onDone: {
              target: "validate",
              actions: [
                assign({
                  messages: (context, event) => [
                    ...context.messages,
                    { role: "assistant", content: event.output },
                  ],
                }),
                assign({
                  iterationCount: context => context.iterationCount + 1,
                }),
              ],
            },
          },
        },

        // ------------------------------------------------------------------------
        // PHASE 2: Validate (run build agent with LSP tools)
        // ------------------------------------------------------------------------
        validate: {
          entry: assign({
            lastState: () => JSON.stringify({ mode: "build", phase: "validate" }),
          }),
          invoke: {
            src: "runBuildAgent",
            input: ({ context }) => ({
              messages: context.messages,
              phase: "validate",
            }),
            onDone: {
              target: "validate",
              actions: [
                assign({
                  messages: (context, event) => [
                    ...context.messages,
                    { role: "assistant", content: event.output },
                  ],
                }),
                assign({
                  toolExecutionCount: context => context.toolExecutionCount + 1,
                }),
              ],
            },
          },
          always: [
            {
              target: "implement",
              guard: "hasValidationErrors",
            },
            {
              target: "done",
              guard: "isBuildClean",
            },
          ],
        },
      },
    },

    // ==========================================================================
    // TERMINAL STATES
    // ==========================================================================
    done: {
      type: "final",
      entry: () => console.log("✅ RLM workflow completed successfully"),
    },
    failed: {
      type: "final",
      entry: (_context, event) => console.error(`❌ RLM workflow failed: ${event.error}`),
    },
  },
});
```

---

## Vercel AI SDK Integration

### LLM Provider Setup

```typescript
// ============================================================================
// VERCEL AI SDK PROVIDER SETUP
// ============================================================================

import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";

// Plan agent model
export const planModel: LanguageModel = openai("gpt-4o", {
  temperature: 0.7,
});

// Build agent model
export const buildModel: LanguageModel = anthropic("claude-3-5-sonnet-20241022", {
  temperature: 0.3,
});

// Explore subagent model (cheaper)
export const exploreModel: LanguageModel = openai("gpt-4o-mini", {
  temperature: 0.3,
});
```

### XState Actor Implementations

```typescript
// ============================================================================
// XSTATE ACTOR IMPLEMENTATIONS WITH VERCEL AI SDK
// ============================================================================

// Helper function to execute multi-turn agent with loop control
async function executeAgent(params: {
  model: LanguageModel;
  messages: Array<Message>;
  tools: Record<string, Tool>;
  systemPrompt: string;
  safetyLimit: number;
  phaseName: string;
}): Promise<string> {
  let currentMessages = [...messages, { role: "system" as const, content: systemPrompt }];
  let iterationCount = 0;
  let finishReason: string | null | undefined = null;
  let fullResponse = "";

  while (iterationCount < params.safetyLimit) {
    iterationCount++;

    const result = streamText({
      model: params.model,
      messages: currentMessages,
      tools: params.tools,
    });

    // Collect response from stream
    for await (const chunk of result.textStream) {
      fullResponse += chunk;
    }

    // Get final response metadata
    const response = await result;
    currentMessages = response.messages;
    finishReason = response.finishReason;

    // Check loop control
    if (finishReason === "stop") {
      console.log(`[${params.phaseName}] Agent complete (${iterationCount} iterations)`);
      break;
    }
    if (finishReason === "tool-calls") {
      // Continue to next iteration
      continue;
    }
  }

  return fullResponse;
}

// Explore subagent actor
const spawnExploreAgent = fromPromise(async ({ input }: { messages: Array<Message> }) => {
  return executeAgent({
    model: exploreModel,
    messages: input.messages,
    tools: Object.fromEntries(
      [grepTool, globTool, readFileTool, listFilesTool].map(t => [t.description, t])
    ),
    systemPrompt: "## 🔍 EXPLORE SUBAGENT\n\nSPAWNED BY: Plan agent during analyze_code phase",
    safetyLimit: PHASE_SAFETY_LIMITS.analyze_code,
    phaseName: "explore",
  });
});

// Plan agent actor (phase-specific)
const runPlanAgent = fromPromise(
  async ({ input }: { messages: Array<Message>; phase: PlanPhase }) => {
    return executeAgent({
      model: planModel,
      messages: input.messages,
      tools: Object.fromEntries(getPlanTools(input.phase).map(t => [t.description, t])),
      systemPrompt: PLAN_PHASE_NOTICES[input.phase],
      safetyLimit: PHASE_SAFETY_LIMITS[input.phase],
      phaseName: input.phase,
    });
  }
);

// Build agent actor
const runBuildAgent = fromPromise(
  async ({ input }: { messages: Array<Message>; phase: BuildPhase }) => {
    return executeAgent({
      model: buildModel,
      messages: input.messages,
      tools: Object.fromEntries(getBuildTools(input.phase).map(t => [t.description, t])),
      systemPrompt: BUILD_PHASE_NOTICES[input.phase],
      safetyLimit: PHASE_SAFETY_LIMITS[input.phase],
      phaseName: input.phase,
    });
  }
);
```

---

## Frontend Integration

### Solid.js with Direct Streaming

```typescript
// ============================================================================
// FRONTEND: SOLID.JS INTEGRATION WITH DIRECT SSE STREAMING
// ============================================================================

import { createSignal, createEffect, For, Show } from 'solid-js';

interface ToolCall {
  name: string;
  arguments: string;
}

interface StreamMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCall[];
}

function AgentChat() {
  const [messages, setMessages] = createSignal<StreamMessage[]>([]);
  const [input, setInput] = createSignal('');
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [currentState, setCurrentState] = createSignal<string>('');

  async function submit() {
    const userMessage = input();
    if (!userMessage.trim()) return;

    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setInput('');
    setIsStreaming(true);

    try {
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: userMessage }),
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentMessage: StreamMessage | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'state') {
              setCurrentState(JSON.stringify(data.value));
            } else if (data.type === 'message') {
              if (!currentMessage) {
                currentMessage = { role: data.role, content: '', toolCalls: [] };
                setMessages(prev => [...prev, currentMessage]);
              }
              if (data.content) {
                currentMessage.content += data.content;
                setMessages(prev => [...prev.slice(0, -1), { ...currentMessage! }]);
              }
              if (data.toolCalls) {
                currentMessage.toolCalls = data.toolCalls;
              }
            } else if (data.type === 'tool-call') {
              if (currentMessage) {
                currentMessage.toolCalls = currentMessage.toolCalls || [];
                currentMessage.toolCalls.push(data);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Streaming error:', error);
      setMessages(prev => [...prev, {
        role: 'system',
        content: `Error: ${error.message}`,
      }]);
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <div class="chat-container">
      <div class="state-indicator">
        Current State: {currentState()}
      </div>

      <div class="messages">
        <For each={messages()}>
          {(message) => (
            <div class={`message message-${message.role}`}>
              <Show when={message.toolCalls && message.toolCalls.length > 0}>
                <div class="tool-calls">
                  <For each={message.toolCalls!}>
                    {(toolCall) => (
                      <div class="tool-call">
                        <span class="tool-name">{toolCall.name}</span>
                        <span class="tool-args">{toolCall.arguments}</span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              <div class="content">
                {message.content}
              </div>
            </div>
          )}
        </For>
      </div>

      <div class="input-area">
        <input
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          onKeyPress={(e) => e.key === 'Enter' && submit()}
          disabled={isStreaming()}
        />
        <button onClick={submit} disabled={isStreaming()}>
          {isStreaming() ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
```

### Server-Side Streaming Proxy

```typescript
// ============================================================================
// SERVER: STREAMING ENDPOINT
// ============================================================================

import { createActor } from "xstate";
import { rlmMachine } from "./machine";

export async function POST({ request }: { request: Request }) {
  const { goal } = await request.json();

  // Create XState actor
  const actor = createActor(rlmMachine, {
    input: { goal },
  });

  // Start the actor
  actor.start();

  // Create readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const subscription = actor.subscribe({
        next: snapshot => {
          // Send state updates
          controller.enqueue(
            encoder.encode(
              `event: state\ndata: ${JSON.stringify({
                value: snapshot.value,
                context: snapshot.context,
              })}\n\n`
            )
          );

          // Stream messages as they're added
          const messages = snapshot.context.messages;
          if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1];

            // Convert Vercel AI SDK message format to stream format
            controller.enqueue(
              encoder.encode(
                `event: message\ndata: ${JSON.stringify({
                  role: lastMessage.role,
                  content: lastMessage.content,
                  toolCalls: lastMessage.toolCalls?.map(tc => ({
                    name: tc.toolName,
                    arguments: JSON.stringify(tc.args),
                  })),
                })}\n\n`
              )
            );
          }

          // Check if done
          if (snapshot.matches("done") || snapshot.matches("failed")) {
            subscription.unsubscribe();
            controller.close();
          }
        },
        error: error => {
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify({
                message: error.message,
              })}\n\n`
            )
          );
          controller.close();
        },
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

---

## Tool System

### Dynamic Tool Filtering

```typescript
// ============================================================================
// TOOL REGISTRY BY AGENT AND PHASE
// ============================================================================

interface ToolConfig {
  enable: string[];
  disable: string[];
}

const PHASE_TOOLS: Record<PlanPhase | BuildPhase, ToolConfig> = {
  // Plan agent phases
  analyze_code: {
    enable: ["readFile", "grep", "glob", "listFiles", "astParse"],
    disable: ["editFile", "generateCode", "typescriptCheck"],
  },
  research: {
    enable: ["readFile", "webSearch", "docsLookup", "gitLog", "sequentialThinking", "astParse"],
    disable: ["editFile", "generateCode", "typescriptCheck", "listFiles", "grep"],
  },
  design: {
    enable: ["readFile", "sequentialThinking", "createPlan", "validatePlan", "astParse"],
    disable: ["editFile", "generateCode", "typescriptCheck", "webSearch"],
  },

  // Build agent phases
  implement: {
    enable: ["editFile", "generateCode", "formatCode", "astParse", "readFile"],
    disable: ["typescriptCheck", "eslintCheck", "lspDiagnostics"],
  },
  validate: {
    enable: [
      "typescriptCheck",
      "eslintCheck",
      "lspDiagnostics",
      "readFile",
      "webSearch",
      "docsLookup",
    ],
    disable: ["editFile", "generateCode", "formatCode"],
  },
};

// ============================================================================
// GET TOOLS FOR PHASE
// ============================================================================

function getPlanTools(phase: PlanPhase): Record<string, Tool> {
  const config = PHASE_TOOLS[phase];

  const toolMap: Record<string, Tool> = {
    // Read tools
    readFile: readFileTool,
    grep: grepTool,
    glob: globTool,
    listFiles: listFilesTool,
    astParse: astParseTool,

    // Research tools
    webSearch: webSearchTool,
    docsLookup: docsLookupTool,
    gitLog: gitLogTool,

    // Planning tools
    sequentialThinking: sequentialThinkingTool,
    createPlan: createPlanTool,
    validatePlan: validatePlanTool,
  };

  // Convert array to record for Vercel AI SDK
  return Object.fromEntries(
    config.enable.map(name => [name, toolMap[name]]).filter(([_, tool]) => tool !== undefined)
  );
}

function getBuildTools(phase: BuildPhase): Record<string, Tool> {
  const config = PHASE_TOOLS[phase];

  const toolMap: Record<string, Tool> = {
    // Write tools
    editFile: editFileTool,
    generateCode: generateCodeTool,
    formatCode: formatCodeTool,

    // Read tools (emergency)
    readFile: readFileTool,
    astParse: astParseTool,

    // Validation tools
    typescriptCheck: typescriptCheckTool,
    eslintCheck: eslintCheckTool,
    lspDiagnostics: lspDiagnosticsTool,

    // Emergency research
    webSearch: webSearchTool,
    docsLookup: docsLookupTool,
  };

  // Convert array to record for Vercel AI SDK
  return Object.fromEntries(
    config.enable.map(name => [name, toolMap[name]]).filter(([_, tool]) => tool !== undefined)
  );
}

function getExploreTools(): Record<string, Tool> {
  return Object.fromEntries([
    ["readFile", readFileTool],
    ["grep", grepTool],
    ["glob", globTool],
    ["listFiles", listFilesTool],
    ["astParse", astParseTool],
  ]);
}
```

### Sequential Thinking Tool

```typescript
// ============================================================================
// SEQUENTIAL THINKING TOOL (Requires Multi-Turn Loop)
// ============================================================================

import { tool } from "ai";
import { z } from "zod";

export const sequentialThinkingTool = tool({
  description: `Multi-step reasoning tool for complex analysis.

This tool helps break down complex problems through iterative thinking.
Each thought can build on, question, or revise previous insights.

Key features:
- Adjust totalThoughts up or down as you progress
- Question or revise previous thoughts
- Branch into alternative approaches
- Generate and verify hypotheses
- Express uncertainty when present

Parameters:
- thought: Your current thinking step
- thoughtNumber: Current number in sequence (1, 2, 3, ...)
- totalThoughts: Estimated total thoughts needed (can adjust)
- nextThoughtNeeded: True if more thinking is needed
- isRevision: Whether this revises previous thinking
- revisesThought: If isRevision, which thought number is being reconsidered`,
  parameters: z.object({
    thought: z.string().describe("Your current thinking step"),
    nextThoughtNeeded: z.boolean().describe("Whether another thought step is needed"),
    thoughtNumber: z.number().int().min(1).describe("Current thought number"),
    totalThoughts: z.number().int().min(1).describe("Estimated total thoughts"),
    isRevision: z.boolean().optional().describe("Whether this revises previous thinking"),
    revisesThought: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Which thought is being reconsidered"),
  }),
  execute: async args => {
    // Process the thought and return updated state
    console.log(
      `[Sequential Thinking] Thought ${args.thoughtNumber}/${args.totalThoughts}: ${args.thought}`
    );

    return {
      thoughtNumber: args.thoughtNumber + 1,
      totalThoughts: args.totalThoughts,
      nextThoughtNeeded: args.nextThoughtNeeded,
      branches: [],
      thoughtHistoryLength: args.thoughtNumber,
    };
  },
});
```

---

## Agent Configuration

### Phase-Specific System Prompts

```typescript
// ============================================================================
// PHASE-SPECIFIC SYSTEM PROMPTS
// ============================================================================

const PLAN_PHASE_NOTICES: Record<PlanPhase, string> = {
  analyze_code: `## 🔍 PLAN AGENT → ANALYZE CODE PHASE

Understanding codebase structure.
SPAWNING: EXPLORE subagent (gpt-4o-mini) for cost-efficient exploration.
LOOP: Single-shot (just spawns explore)
You cannot modify any files.
Explore: grep, glob, readFile, astParse`,

  research: `## 🔬 PLAN AGENT → RESEARCH PHASE

Researching best practices and patterns.
LOOP: Multi-turn (up to 15 iterations) for comprehensive research.

Research workflow:
1. Initial web search → Get overview
2. Analyze results → Identify gaps
3. Follow-up searches → Deep dive
4. Docs lookup → API references
5. Sequential thinking → Synthesize findings

Available: webSearch, docsLookup, gitLog, sequentialThinking
You cannot modify any files.`,

  design: `## 🎨 PLAN AGENT → DESIGN PHASE

Creating detailed implementation plan.
LOOP: Multi-turn (up to 20 iterations) for sequential thinking.

Use sequentialThinking for:
- Breaking down complex architecture decisions
- Revising previous thoughts (isRevision=true)
- Branching into alternative approaches
- Generating and verifying hypotheses

Output: Structured plan for BUILD agent.
Available: sequentialThinking, createPlan, validatePlan
You cannot modify any files.`,
};

const BUILD_PHASE_NOTICES: Record<BuildPhase, string> = {
  implement: `## 🔨 BUILD AGENT → IMPLEMENT PHASE

Executing the plan with task management.
LOOP: Multi-turn (up to 10 iterations) for implementation.

Track progress systematically.
If stuck: Use webSearch/docsLookup for error documentation.
Write: editFile, generateCode, formatCode
Validate: typescriptCheck, eslintCheck, lspDiagnostics`,

  validate: `## ✅ BUILD AGENT → VALIDATE PHASE

Running LSP checks (TypeScript, ESLint).
LOOP: Recursive until clean or doom loop detected.

If errors found:
1. Research documentation (webSearch/docsLookup)
2. Apply fix from documentation
3. Validate again

Emergency: webSearch, docsLookup available for error research.
Validate: typescriptCheck, eslintCheck, lspDiagnostics`,
};
```

---

## Doom Loop Detection

### XState Guards

```typescript
// ============================================================================
// DOOM LOOP DETECTION GUARDS
// ============================================================================

import type { Guard } from "xstate";

/**
 * Guard: Detect doom loop patterns in build agent
 */
export const doomLoopGuard: Guard<RLMMachineContext, RLMMachineEvent> = context => {
  const currentState = context.lastState;
  if (!currentState) return false;

  const state = JSON.parse(currentState) as HierarchicalState;

  // Only check in build mode
  if (state.mode !== "build") return false;

  // Update recent states tracking
  context.recentStates.push({ state, timestamp: Date.now() });

  // Keep last 10 states
  while (context.recentStates.length > 10) {
    context.recentStates.shift();
  }

  // CHECK 1: State oscillation
  const oscillationCount = countBuildOscillations(context.recentStates);
  if (oscillationCount > 5) {
    console.warn(`⚠️ Doom loop detected: ${oscillationCount} oscillations`);
    return true;
  }

  // CHECK 2: Time threshold (10 minutes)
  const buildStateCount = context.recentStates.filter(s => s.state.mode === "build").length;

  if (buildStateCount > 60) {
    console.warn("⚠️ Doom loop detected: Time threshold exceeded");
    return true;
  }

  // CHECK 3: Error progress
  const totalErrors = Object.values(context.errorCounts).reduce((sum, count) => sum + count, 0);

  if (context.toolExecutionCount > 20 && totalErrors > 10) {
    const recentErrorCount = context.errorCounts["typescriptCheck"] || 0;
    const prevErrorCount = context.errorCounts["typescriptCheck_prev"] || 0;

    if (recentErrorCount >= prevErrorCount) {
      console.warn(`⚠️ Doom loop detected: Errors not decreasing (${totalErrors} total)`);
      return true;
    }

    // Store previous error count for next comparison
    context.errorCounts["typescriptCheck_prev"] = recentErrorCount;
  }

  return false;
};

/**
 * Guard: Check if build agent has validation errors
 */
export const hasValidationErrors: Guard<RLMMachineContext, RLMMachineEvent> = context => {
  const lastMessage = context.messages[context.messages.length - 1];
  const content = lastMessage?.content?.toLowerCase() || "";

  const errorIndicators = [
    "error:",
    "errors found",
    "typescript error",
    "eslint error",
    "failed",
    "×",
  ];

  const hasErrors = errorIndicators.some(indicator => content.includes(indicator));

  // Update error counts
  if (hasErrors) {
    const toolCalls = lastMessage?.toolCalls || [];
    toolCalls.forEach(toolCall => {
      const toolName = toolCall.function.name;
      context.errorCounts[toolName] = (context.errorCounts[toolName] || 0) + 1;
    });
  }

  return hasErrors;
};

/**
 * Guard: Check if build agent is clean
 */
export const isBuildClean: Guard<RLMMachineContext, RLMMachineEvent> = context => {
  const lastMessage = context.messages[context.messages.length - 1];
  const content = lastMessage?.content?.toLowerCase() || "";

  const successIndicators = [
    "validation passed",
    "no errors found",
    "all checks passed",
    "lsp clean",
    "✅",
  ];

  return successIndicators.some(indicator => content.includes(indicator));
};

/**
 * Count build state oscillations
 */
function countBuildOscillations(
  states: Array<{ state: HierarchicalState; timestamp: number }>
): number {
  let count = 0;
  let lastPhase: BuildPhase | null = null;

  for (const { state } of states) {
    if (state.mode === "build") {
      const currentPhase = state.phase;

      if (lastPhase && lastPhase !== currentPhase) {
        count++;
      }

      lastPhase = currentPhase;
    }
  }

  return count;
}
```

---

## Implementation

### Complete Workflow

```typescript
// ============================================================================
// COMPLETE RLM WORKFLOW
// ============================================================================

export function createRLMActor(config: {
  goal: string;
  workspace: string;
}): ActorRefFrom<typeof rlmMachine> {
  const actor = createActor(rlmMachine, {
    input: {
      goal: config.goal,
      messages: [{ role: "user", content: config.goal }],
      iterationCount: 0,
      recentStates: [],
      lastState: null,
      toolExecutionCount: 0,
      errorCounts: {},
    },
  });

  return actor;
}

export async function runRLMWorkflow(config: { goal: string; workspace: string }): Promise<{
  success: boolean;
  finalState: HierarchicalState | "done" | "failed";
  messages: Array<ModelMessage>;
}> {
  const actor = createRLMActor(config);

  return new Promise((resolve, reject) => {
    const subscription = actor.subscribe({
      next: snapshot => {
        if (snapshot.matches("done")) {
          subscription.unsubscribe();
          resolve({
            success: true,
            finalState: "done",
            messages: snapshot.context.messages,
          });
        }

        if (snapshot.matches("failed")) {
          subscription.unsubscribe();
          reject(new Error("RLM workflow failed"));
        }
      },
    });
  });
}
```

---

## Project Structure

### Recommended Directory Structure

```
packages/ekacode/src/
├── rlm/                                    # XState + Vercel AI SDK integration
│   ├── machine.ts                             # XState hierarchical machine
│   ├── actors/                               # XState actor implementations
│   │   ├── explore-agent.ts                  # Explore subagent
│   │   ├── plan-agent.ts                     # Plan agent (phase-specific loops)
│   │   └── build-agent.ts                    # Build agent
│   ├── guards/                               # XState guards
│   │   └── doom-loop.ts                       # Doom loop detection
│   ├── tools/                                # Vercel AI SDK tool definitions
│   │   ├── read.ts                            # Read tools
│   │   ├── write.ts                           # Write tools
│   │   ├── validation.ts                      # LSP validation
│   │   ├── research.ts                        # webSearch, docsLookup
│   │   └── planning.ts                        # sequentialThinking, createPlan
│   ├── models/                               # Provider configurations
│   │   └── index.ts                           # OpenAI/Anthropic models
│   ├── loop-control/                         # XState-based loop control
│   │   └── index.ts                           # Loop control logic
│   └── index.ts                               # RLM exports
│
├── server/                                   # Server-side streaming
│   ├── routes/
│   │   └── agent-chat.ts                     # SSE endpoint for frontend
│   └── stream-handler.ts                     # XState → SSE streaming
│
└── frontend/                                 # Solid.js frontend
    ├── components/
    │   ├── Chat.tsx                         # Main chat component
    │   ├── MessageList.tsx                   # Message display
    │   └── ToolCallView.tsx                  # Tool call visualization
    └── hooks/
        └── useAgentStream.ts                 # SSE stream management
```

---

## Quick Reference

### Loop Strategy Summary

| Phase            | Loop Control                | Safety Limit | Primary Signal            | Tools                                             |
| ---------------- | --------------------------- | ------------ | ------------------------- | ------------------------------------------------- |
| **analyze_code** | XState `checkLoopControl()` | 5            | `finishReason === 'stop'` | sequentialThinking, spawnExplore                  |
| **research**     | XState `checkLoopControl()` | 100          | `finishReason === 'stop'` | webSearch, docsLookup, gitLog, sequentialThinking |
| **design**       | XState `checkLoopControl()` | 100          | `finishReason === 'stop'` | sequentialThinking, createPlan                    |
| **implement**    | XState `checkLoopControl()` | 50           | `finishReason === 'stop'` | editFile, generateCode, formatCode                |
| **validate**     | XState `checkLoopControl()` | 100          | `has errors`              | typescriptCheck, eslintCheck                      |

**Key**: Safety limits are only doom loop protection. Agents stop naturally via `finishReason === 'stop'`. Loop control is handled by XState services.

### Tool Access Matrix

| Tool                 | analyze_code | research | design | implement | validate | explore |
| -------------------- | ------------ | -------- | ------ | --------- | -------- | ------- |
| **Read Tools**       |
| readFile             | ✅           | ✅       | ✅     | ✅        | ✅       | ✅      |
| grep                 | ✅           | ❌       | ❌     | ❌        | ❌       | ✅      |
| glob                 | ✅           | ❌       | ❌     | ❌        | ❌       | ✅      |
| listFiles            | ✅           | ❌       | ❌     | ❌        | ❌       | ✅      |
| astParse             | ✅           | ✅       | ✅     | ✅        | ❌       | ✅      |
| **Write Tools**      |
| editFile             | ❌           | ❌       | ❌     | ✅        | ❌       | ❌      |
| generateCode         | ❌           | ❌       | ❌     | ✅        | ❌       | ❌      |
| formatCode           | ❌           | ❌       | ❌     | ✅        | ❌       | ❌      |
| **Validation Tools** |
| typescriptCheck      | ❌           | ❌       | ❌     | ❌        | ✅       | ❌      |
| eslintCheck          | ❌           | ❌       | ❌     | ❌        | ✅       | ❌      |
| lspDiagnostics       | ❌           | ❌       | ❌     | ❌        | ✅       | ❌      |
| **Research Tools**   |
| webSearch            | ❌           | ✅       | ❌     | ❌        | ✅       | ❌      |
| docsLookup           | ❌           | ✅       | ❌     | ❌        | ✅       | ❌      |
| gitLog               | ❌           | ✅       | ❌     | ❌        | ❌       | ❌      |
| **Planning Tools**   |
| sequentialThinking   | ✅           | ✅       | ✅     | ❌        | ❌       | ❌      |
| createPlan           | ❌           | ❌       | ✅     | ❌        | ❌       | ❌      |
| validatePlan         | ❌           | ❌       | ✅     | ❌        | ❌       | ❌      |

### Model Selection

| Agent               | Provider      | Model       | Temp | Safety Limit    |
| ------------------- | ------------- | ----------- | ---- | --------------- |
| Plan (analyze_code) | `openai()`    | gpt-4o      | 0.7  | 5 (doom loop)   |
| Plan (research)     | `openai()`    | gpt-4o      | 0.7  | 100 (doom loop) |
| Plan (design)       | `openai()`    | gpt-4o      | 0.7  | 100 (doom loop) |
| Build               | `anthropic()` | claude-3.5  | 0.3  | 50 (doom loop)  |
| Explore             | `openai()`    | gpt-4o-mini | 0.3  | 50 (doom loop)  |

**Note**: Agents stop naturally via `finishReason === 'stop'`. Safety limits are only for doom loop protection. Loop control is handled by XState, not Vercel AI SDK.

### Implementation Checklist

- [ ] Install dependencies: `pnpm add xstate ai @ai-sdk/openai @ai-sdk/anthropic zod`
- [ ] Create XState machine with hierarchical states
- [ ] Implement **intent-based** loop control via XState (check `finishReason` as primary signal)
- [ ] Define tools using `tool()` from Vercel AI SDK
- [ ] Implement doom loop guards (as safety nets, not primary control)
- [ ] Create server-side SSE endpoint with streaming
- [ ] Set up frontend with direct SSE streaming or `@ai-sdk/react`
- [ ] Test **intent-based** research phase (agent decides when done)
- [ ] Test **intent-based** design phase with sequential thinking
- [ ] Test doom loop detection (should rarely trigger)

---

## Summary

### Key Insights

1. **Vercel AI SDK = LLM Abstraction**: Provider abstraction via providers, tool execution, streaming only
2. **XState = Orchestration**: All state management, transitions, loop control, guards
3. **Intent-Based Looping**: Agents naturally stop via `finishReason === 'stop'`, controlled by XState
4. **Safety Limits Only**: Iteration caps (5, 100, 50) are doom loop protection, not normal flow control
5. **Sequential Thinking**: Multi-turn tool that requires intent-based looping
6. **Research Tools**: Multi-turn tools that require intent-based looping
7. **Frontend Streaming**: Direct SSE streaming or @ai-sdk/react hooks for real-time UI
8. **Doom Loop Detection**: XState guards prevent infinite loops (should rarely trigger)

### Integration Benefits

| Benefit                    | Description                                                  |
| -------------------------- | ------------------------------------------------------------ |
| **Type Safety**            | XState v5 + TypeScript + Zod schemas                         |
| **Separation of Concerns** | State (XState) vs LLM (Vercel AI SDK) vs UI (Solid/React)    |
| **Testability**            | Mock XState services, test phases independently              |
| **Observability**          | XState Inspector for state machine debugging                 |
| **Flexibility**            | Easy to add phases, transitions, tools                       |
| **Real-time Updates**      | Streaming to frontend via SSE                                |
| **Cost Optimization**      | Cheaper models for exploration                               |
| **Agent Autonomy**         | Intent-based looping via XState lets agents decide when done |
| **No Arbitrary Cutoffs**   | Agents not limited by hard iteration caps (only safety nets) |

This integration provides a robust, type-safe foundation for building autonomous coding agents with Vercel AI SDK serving as the LLM abstraction layer, XState controlling the workflow and loop management, and **intent-based looping** that lets agents decide when they're done, rather than being cut off by arbitrary iteration limits.
