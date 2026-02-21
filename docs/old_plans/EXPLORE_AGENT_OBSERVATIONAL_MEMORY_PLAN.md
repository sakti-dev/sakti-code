# Explore Agent Observational Memory Implementation Plan

## Problem Statement

When spawning explore sub-agents in Plan mode, the current observational memory system applies the same aggressive compaction logic as Build mode. This causes:

1. **Lossy Observations**: Every ~30k tokens, messages get compacted into narrative summaries
2. **Hallucinated Synthesis**: Explore agent returns "synthesized knowledge" based on compressed (potentially inaccurate) observations
3. **Parent Agent Mistrusts Results**: Main agent receives exploration findings as facts, but they're based on degraded context

**The Core Issue**: Explore agents return synthesized knowledge (not raw observations), so any compaction error compounds when the parent trusts the synthesis as ground truth.

---

## Solution: Task-Driven Exploration Memory

The key insight is that **exploration is task-driven, not continuous**:

1. **Parent provides context**: "Find login form schema and interface"
2. **Explore agent knows the goal**: Observations capture exactly what was asked
3. **Precision over compression**: Capture exact details, not summarized narratives

This is fundamentally different from Build mode where the agent is actively implementing and needs to remember everything.

---

## Design Principles

| Aspect          | Default (Build) Mode   | Task-Driven Modes                 |
| --------------- | ---------------------- | --------------------------------- |
| **Trigger**     | Token threshold (~30k) | Mode-specific threshold           |
| **Focus**       | Capture everything     | Capture what's relevant to task   |
| **Priority**    | Brevity                | Task-dependent                    |
| **Compression** | Aggressive (summarize) | Mode-specific (explore = minimal) |
| **Output**      | Narrative observations | Mode-specific format              |
| **Storage**     | Same normalized schema | Same normalized schema            |

### Mode Comparison

| Mode        | Threshold | Focus                     | Compression Level |
| ----------- | --------- | ------------------------- | ----------------- |
| default     | 30k       | Everything                | Aggressive        |
| explore     | 60k       | Findings + gaps           | Minimal           |
| bug_fixing  | 40k       | Errors + root cause       | Minimal           |
| refactoring | 50k       | Interfaces + dependencies | Moderate          |
| testing     | 40k       | Tests + coverage          | Minimal           |
| debugging   | 40k       | Symptoms + variables      | Minimal           |
| research    | 60k       | Findings + sources        | Minimal           |

---

## Implementation Scope

### Phase 1: Explore Agent Prompts (This Plan)

- Define all specialized prompts for explore agent
- Implement task-driven extraction
- Configure higher thresholds

### Phase 2: Integration with Planner

- Wire explore agent spawning with task context injection
- Handle exploration result flow back to parent

### Phase 3: Optional Enhancements

- Parent context sharing (explore agent reads parent's observations)
- Disable compaction entirely for short exploration tasks

---

# Part 1: Explore Agent Prompts

## 1.1 EXPLORER_TASK_CONTEXT

Injected into explore agent to provide the exploration goal:

```typescript
const EXPLORER_TASK_CONTEXT = `
You are exploring the codebase to find information for the parent agent.

YOUR SPECIFIC OBJECTIVE:
${explorationGoal}  // e.g., "Find the login form schema and interface"

Focus your memory on details relevant to this objective. The parent agent needs:
- Exact file paths where relevant code exists
- Interface/type definitions
- Schema definitions
- Function signatures
- "NOT FOUND" results (important to know what's missing)

When creating observations, prioritize accuracy over brevity. The parent will make decisions based on what you remember.
`;
```

**When to use**: Injected as system context when spawning explore agent

---

## 1.2 EXPLORER_EXTRACTION_INSTRUCTIONS

Instructions for extracting observations from exploration messages:

```typescript
const EXPLORER_EXTRACTION_INSTRUCTIONS = `
CRITICAL: Your observations must capture what the parent agent specifically asked for.

The parent agent asked you to find: "${explorationGoal}"

For each message exchange, extract and preserve:

1. WHAT WAS REQUESTED - Note what specific information the parent wanted
2. EXACT FINDINGS - File paths, line numbers, function names, interface definitions
3. SCHEMA DEFINITIONS - Full type definitions, interfaces, Zod schemas
4. FUNCTION SIGNATURES - Parameter types, return types
5. "NOT FOUND" RESULTS - Explicitly note when something doesn't exist
6. SEARCH QUERIES USED - What you searched for

PRESERVE EXACT DETAILS:
- File paths: "src/auth/forms/LoginForm.tsx"
- Line numbers: "interface LoginFormData at line 12"
- Type definitions: "interface LoginFormData { email: string; password: string }"
- Schema: "const loginSchema = z.object({...})"

DO NOT:
- Summarize code into prose
- Skip "not found" results
- Merge different findings together
- Lose line numbers or file paths
`;
```

---

## 1.3 EXPLORER_OUTPUT_FORMAT

Structured format for exploration findings:

```typescript
const EXPLORER_OUTPUT_FORMAT = `
Use this structured format to capture exploration findings:

<findings>
## Query: [what parent wanted]
- FOUND: [exact file path]:[line numbers] - [brief description]
- FOUND: [exact file path]:[line numbers] - [brief description]
- NOT FOUND: [what wasn't found]

## Query: [next thing parent wanted]
...
</findings>

<file_inventory>
[filepath1]: [key exports, interfaces, functions found]
[filepath2]: [key exports, interfaces, functions found]
</file_inventory>

<gaps>
- [Things that exist but weren't fully explored]
- [Things that definitely don't exist]
</gaps>

<current-task>
Primary: [what you're currently searching for]
Status: [in_progress / completed / not_found]
</current-task>
`;
```

**Example Output**:

```xml
<findings>
## Query: login form schema
- FOUND: src/auth/forms/LoginForm.tsx:12-25 - interface LoginFormData { email: string; password: string }
- FOUND: src/schemas/auth.ts:8-15 - const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) })
- NOT FOUND: OAuth2 form schema

## Query: authentication interface
- FOUND: src/auth/types.ts:5-12 - interface AuthUser { id: string; email: string; role: string }
</findings>

<file_inventory>
src/auth/forms/LoginForm.tsx: LoginFormData interface, LoginForm component
src/schemas/auth.ts: loginSchema, registerSchema
src/auth/types.ts: AuthUser interface, Session interface
</file_inventory>

<gaps>
- OAuth2 implementation not found
- Refresh token schema not found
</gaps>

<current-task>
Primary: Find login form schema
Status: completed
</current-task>
```

---

## 1.4 EXPLORER_GUIDELINES

Guidelines emphasizing precision over brevity:

```typescript
const EXPLORER_GUIDELINES = `
PRECISION OVER BREVITY - This is not build mode.

PRIORITY:
1. Exact file paths and line numbers
2. Complete interface/type definitions
3. "NOT FOUND" results (as important as found results)
4. Search queries used

WHAT TO CAPTURE:
- Full interface definitions (not summarized)
- Exact function signatures
- Schema structures
- Import paths
- Line numbers for key definitions

WHEN SOMETHING IS NOT FOUND:
- State explicitly: "NOT FOUND: LoginForm schema"
- This is critical info for parent agent

WHEN FOUND:
- Include file path: "src/auth/LoginForm.tsx"
- Include line number: "line 15-22"
- Include full definition if small, or key parts if large

DO NOT:
- Summarize code into natural language
- Skip details to save space
- Assume parent knows the codebase
`;
```

---

## 1.5 EXPLORER_SYSTEM_PROMPT

Complete system prompt for explore agent:

```typescript
const EXPLORER_SYSTEM_PROMPT = `
You are a precise codebase researcher. Your findings will be used by another agent to make decisions.

YOUR OBJECTIVE: ${explorationGoal}

${EXPLORER_EXTRACTION_INSTRUCTIONS}

=== OUTPUT FORMAT ===

${EXPLORER_OUTPUT_FORMAT}

=== GUIDELINES ===

${EXPLORER_GUIDELINES}

IMPORTANT: You are not implementing code - you are finding information. Be precise.
The parent agent needs exact details to make decisions about the codebase.

Remember: Accuracy > Brevity. Parent agent will act on what you remember.
`;
```

---

## 1.6 EXPLORER_COMPRESSION_GUIDANCE

Minimal compression for explore agent:

```typescript
const EXPLORER_COMPRESSION_GUIDANCE = {
  // Level 0: No compression guidance (first attempt)
  0: "",

  // Level 1: Mild consolidation
  1: `
MILD CONSOLIDATION

Keep ALL findings. Only combine:
- Duplicate file references
- Same search query results

NEVER remove:
- "NOT FOUND" results
- Specific file paths
- Line numbers
- Interface definitions
`,

  // Level 2: Moderate consolidation
  2: `
MODERATE CONSOLIDATION

Keep ALL unique findings. Only remove:
- Exact duplicates of file+line combinations

Keep:
- Every unique file path
- Every "NOT FOUND" result
- Line numbers
- Interface/type definitions
`,
};
```

---

## 1.7 EXPLORER_CONTEXT_INSTRUCTIONS

Instructions for using exploration findings:

```typescript
const EXPLORER_CONTEXT_INSTRUCTIONS = `
Use these exploration findings to answer the parent's question.

For each finding:
- Cite the exact file path and line number
- Include the actual interface/type definition if relevant
- Note if something was "NOT FOUND"

The parent agent is making decisions based on what you found. Be precise.
`;
```

---

## 1.8 OBSERVATION_CONTEXT_PROMPT

**NO CHANGE** - Generic enough to work for both modes:

```typescript
const OBSERVATION_CONTEXT_PROMPT = `
The following observations block contains your memory of past coding sessions with this user.`;
```

---

## 1.9 OBSERVATION_CONTINUATION_HINT

**NO CHANGE** - Works as-is for any agent:

```typescript
const OBSERVATION_CONTINUATION_HINT = `
This message is not from the user, the conversation history grew too long and wouldn't fit in context! Thankfully the entire conversation is stored in your memory observations.

Please continue from where the observations left off. Do not refer to your "memory observations" directly, the user doesn't know about them, they are your memories!

Just respond naturally as if you're remembering the conversation (you are!). Do not say "Hi there!" or "based on our previous conversation" as if the conversation is just starting, this is not a new conversation.

This is an ongoing coding session, keep continuity by responding based on your memory of what you were working on. For example do not say "I understand. I've reviewed my memory observations", or "I remember [...]".

Answer naturally following the suggestion from your memory. Note that your memory may contain a suggested first response, which you should follow.

IMPORTANT: this system reminder is NOT from the user. The system placed it here as part of your memory system.

NOTE: Any messages following this system reminder are newer than your memories.
`;
```

---

# Part 2: Configuration

## 2.1 Threshold Configuration

Higher thresholds for explore agents to reduce compaction frequency:

```typescript
const EXPLORER_MEMORY_CONFIG = {
  // Observation: 60k tokens (double build mode)
  observationThreshold: 60000,

  // Reflection: 80k tokens
  reflectionThreshold: 80000,

  // Buffer every 12k tokens (double build mode)
  bufferTokens: 12000,

  // Activate at 80% of threshold
  bufferActivation: 0.8,

  // Force sync after 14.4k tokens
  blockAfter: 14400,

  // Thread scope for safety
  scope: "thread",

  // Keep more recent messages
  lastMessages: 15,
};

const BUILD_MEMORY_CONFIG = {
  observationThreshold: 30000,
  reflectionThreshold: 40000,
  bufferTokens: 6000,
  bufferActivation: 0.8,
  blockAfter: 7200,
  scope: "thread",
  lastMessages: 10,
};
```

---

## 2.2 Mode Detection

How to determine which config to use:

```typescript
type AgentMode =
  | "default" // General coding (build mode)
  | "explore" // Codebase exploration
  | "bug_fixing" // Bug investigation and fixing
  | "refactoring" // Code refactoring
  | "testing" // Test writing/running
  | "debugging" // Debugging session
  | "research"; // Web research / docs lookup

function getMemoryConfig(agentMode: AgentMode): MemoryConfig {
  const configs: Record<AgentMode, MemoryConfig> = {
    default: DEFAULT_MEMORY_CONFIG,
    explore: EXPLORER_MEMORY_CONFIG,
    bug_fixing: BUGFIXING_MEMORY_CONFIG,
    refactoring: REFACTORING_MEMORY_CONFIG,
    testing: TESTING_MEMORY_CONFIG,
    debugging: DEBUGGING_MEMORY_CONFIG,
    research: RESEARCH_MEMORY_CONFIG,
  };
  return configs[agentMode] ?? DEFAULT_MEMORY_CONFIG;
}

function getObserverPrompts(agentMode: AgentMode): ObserverPrompts {
  const prompts = getModePrompts(agentMode);

  return {
    systemPrompt: prompts.systemPrompt,
    extractionInstructions: prompts.extractionInstructions,
    outputFormat: prompts.outputFormat,
    guidelines: prompts.guidelines,
    compressionGuidance: prompts.compressionGuidance,
    contextInstructions: prompts.contextInstructions,
  };
}
```

---

# Part 3: Integration

## 3.1 Explore Agent Spawn Flow

```
Main Agent (Plan Mode)
        │
        ▼
User: "implement login feature"
        │
        ▼
Main Agent spawns Explore Agent
        │
        ├──► Injects: EXPLORER_TASK_CONTEXT with "Find login form schema"
        │
        ├──► Injects: EXPLORER_SYSTEM_PROMPT
        │
        └──► Sets: EXPLORER_MEMORY_CONFIG (60k threshold)
        │
        ▼
Explore Agent runs
        │
        ├──► Uses exploration-specific prompts
        │
        └──► Creates precise observations (not summarized)
        │
        ▼
Explore Agent returns findings to main agent
        │
        ▼
Main Agent receives structured findings
        │
        └──► Uses findings to inform implementation plan
```

---

## 3.2 Context Injection Implementation

```typescript
interface ExploreAgentSpawnParams {
  explorationGoal: string; // e.g., "Find login form schema and interface"
  parentContext?: {
    activeTask?: string;
    currentFile?: string;
  };
}

async function spawnExploreAgent(
  params: ExploreAgentSpawnParams,
  messageList: MessageList
): Promise<void> {
  const { explorationGoal, parentContext } = params;

  // 1. Get explore-specific prompts and config
  const config = getMemoryConfig("explore");
  const prompts = getObserverPrompts("explore");

  // 2. Build system prompt with task context
  const systemPrompt = buildExploreSystemPrompt(prompts, explorationGoal);

  // 3. Inject exploration context
  messageList.addSystem(systemPrompt, "explore-agent");

  // 4. Inject parent context if available
  if (parentContext?.activeTask) {
    messageList.addSystem(
      `<current-task>${parentContext.activeTask}</current-task>`,
      "explore-parent-context"
    );
  }

  // 5. Initialize explore agent with config
  await initializeObservationalMemory(messageList, config);
}

function buildExploreSystemPrompt(prompts: ObserverPrompts, explorationGoal: string): string {
  return `
${prompts.systemPrompt.replace("${explorationGoal}", explorationGoal)}

=== OUTPUT FORMAT ===

${prompts.outputFormat}

=== GUIDELINES ===

${prompts.guidelines}

=== CONTEXT INSTRUCTIONS ===

${prompts.contextInstructions}
`;
}
```

---

## 3.3 Exploration Result Flow

```typescript
interface ExplorationResult {
  findings: string; // Structured findings from observation
  fileInventory: string; // List of files explored
  gaps: string; // What's missing
  rawMessages?: string[]; // Original messages for reference
}

async function receiveExplorationResult(
  explorationResult: ExplorationResult,
  mainAgentMessageList: MessageList
): Promise<void> {
  // 1. Extract structured findings
  const { findings, fileInventory, gaps } = explorationResult;

  // 2. Inject as context for main agent
  mainAgentMessageList.addSystem(
    `<exploration-results>
${findings}

<file-inventory>
${fileInventory}
</file-inventory>

<gaps>
${gaps}
</gaps>
</exploration-results>`,
    "exploration-results"
  );

  // 3. Optionally store in main agent's memory
  await addToObservationalMemory(mainAgentMessageList, {
    content: `Exploration findings: ${findings}`,
    type: "exploration_result",
    explorationGoal: explorationResult.explorationGoal,
  });
}
```

---

# Part 4: Testing

## 4.1 Prompt Quality Tests

Test that explore agent captures correct details:

```
Scenario: Parent asks explore agent to find "login form schema"

Expected observation:
- File path: src/auth/forms/LoginForm.tsx
- Line numbers: 12-25
- Interface: LoginFormData { email: string; password: string }
- Schema: loginSchema from src/schemas/auth.ts

Test: Verify observation contains:
✓ Exact file path
✓ Line numbers
✓ Complete interface definition
✓ "NOT FOUND" for OAuth schema (if not found)
```

## 4.2 Compression Tests

Test that compression doesn't lose critical information:

```
Scenario: Explore agent has accumulated many findings

Test: After compression
✓ All file paths preserved
✓ All "NOT FOUND" results preserved
✓ Line numbers preserved
✓ Interface definitions preserved

Test: What CAN be consolidated
✓ Duplicate file references merged
✓ Same query results combined
```

## 4.3 Integration Tests

Test explore agent spawning and result flow:

```
Scenario: Main agent spawns explore agent for login schema

Test:
✓ EXPLORER_TASK_CONTEXT injected with correct goal
✓ EXPLORER_MEMORY_CONFIG applied (60k threshold)
✓ Explore agent runs with explore prompts
✓ Findings returned to main agent
✓ Main agent can make decisions based on findings
```

---

# Part 5: Implementation Phases

## Phase 1: Core Prompts - Explore Mode (1-2 days)

- [ ] Define EXPLORER_TASK_CONTEXT
- [ ] Define EXPLORER_EXTRACTION_INSTRUCTIONS
- [ ] Define EXPLORER_OUTPUT_FORMAT
- [ ] Define EXPLORER_GUIDELINES
- [ ] Define EXPLORER_SYSTEM_PROMPT
- [ ] Define EXPLORER_COMPRESSION_GUIDANCE
- [ ] Define EXPLORER_CONTEXT_INSTRUCTIONS
- [ ] Add to prompt library

## Phase 2: Mode System Foundation (1 day)

- [ ] Define AgentMode type with all modes
- [ ] Define normalized Observation schema
- [ ] Define MODE_CONFIGS for all modes
- [ ] Define MODE_PROMPTS for all modes
- [ ] Implement getMemoryConfig() function
- [ ] Implement getObserverPrompts() function
- [ ] Implement getModePrompts() function

## Phase 3: Additional Mode Prompts (2-3 days)

- [ ] Define bug_fixing mode prompts
- [ ] Define refactoring mode prompts
- [ ] Define testing mode prompts
- [ ] Define debugging mode prompts
- [ ] Define research mode prompts
- [ ] Add to MODE_PROMPTS

## Phase 4: Integration (2-3 days)

- [ ] Update planner to inject mode when spawning sub-agents
- [ ] Implement spawnSubAgent() with mode injection
- [ ] Implement receiveSubAgentResult() function
- [ ] Wire into existing agent spawning flow

## Phase 5: Testing (1-2 days)

- [ ] Write prompt quality tests for each mode
- [ ] Write compression tests
- [ ] Write integration tests
- [ ] Manual testing with real scenarios

---

## Implementation Strategy

**Start with Explore mode** (this plan) as proof of concept, then generalize to full mode system:

1. **Ship Explore mode first** - Validates task-driven memory works
2. **Refactor to mode system** - Extract common patterns
3. **Add more modes** - Bug fixing, testing, etc. as needed

---

# Appendix A: Complete Prompt Reference

## A.1 All Prompts Summary

| Prompt                  | Build Mode                       | Explore Mode                     |
| ----------------------- | -------------------------------- | -------------------------------- |
| TASK_CONTEXT            | N/A                              | ✅ (new)                         |
| EXTRACTION_INSTRUCTIONS | OBSERVER_EXTRACTION_INSTRUCTIONS | EXPLORER_EXTRACTION_INSTRUCTIONS |
| OUTPUT_FORMAT           | OBSERVER_OUTPUT_FORMAT           | EXPLORER_OUTPUT_FORMAT           |
| GUIDELINES              | OBSERVER_GUIDELINES              | EXPLORER_GUIDELINES              |
| SYSTEM_PROMPT           | OBSERVER_SYSTEM_PROMPT           | EXPLORER_SYSTEM_PROMPT           |
| COMPRESSION_GUIDANCE    | COMPRESSION_GUIDANCE             | EXPLORER_COMPRESSION_GUIDANCE    |
| CONTEXT_INSTRUCTIONS    | OBSERVATION_CONTEXT_INSTRUCTIONS | EXPLORER_CONTEXT_INSTRUCTIONS    |
| CONTEXT_PROMPT          | OBSERVATION_CONTEXT_PROMPT       | (same)                           |
| CONTINUATION_HINT       | OBSERVATION_CONTINUATION_HINT    | (same)                           |

---

# Appendix B: File Structure

```
packages/core/src/
├── agents/
│   ├── explore/
│   │   ├── index.ts              # Explore agent exports
│   │   ├── prompts/
│   │   │   ├── index.ts         # Prompt exports
│   │   │   ├── task-context.ts  # EXPLORER_TASK_CONTEXT
│   │   │   ├── extraction.ts    # EXPLORER_EXTRACTION_INSTRUCTIONS
│   │   │   ├── output.ts        # EXPLORER_OUTPUT_FORMAT
│   │   │   ├── guidelines.ts    # EXPLORER_GUIDELINES
│   │   │   ├── compression.ts  # EXPLORER_COMPRESSION_GUIDANCE
│   │   │   └── context.ts       # EXPLORER_CONTEXT_INSTRUCTIONS
│   │   └── config.ts           # EXPLORER_MEMORY_CONFIG
│   └── memory/
│       ├── config.ts            # Mode detection
│       └── observer.ts          # Updated for mode support
```

---

# Appendix C: Decision Tree

```
Which memory mode to use?

1. Is this a sub-agent spawned by main agent?
   │
   ├── YES → What type of sub-agent?
   │         ├── explore → Use EXPLORER_MEMORY_CONFIG
   │         ├── bug_fixing → Use BUGFIXING_MEMORY_CONFIG
   │         ├── refactoring → Use REFACTORING_MEMORY_CONFIG
   │         ├── testing → Use TESTING_MEMORY_CONFIG
   │         ├── debugging → Use DEBUGGING_MEMORY_CONFIG
   │         └── research → Use RESEARCH_MEMORY_CONFIG
   │
   └── NO → Is this the main agent doing coding?
            ├── YES → Use DEFAULT_MEMORY_CONFIG (build mode)
            └── NO → Use DEFAULT_MEMORY_CONFIG
```

**Key principle**: Mode is assigned when spawning sub-agent. The spawner decides what mode the sub-agent should use based on what task it's given.

---

# Appendix D: Related Plans

- **TASK_MEMORY_IMPLEMENTATION_PLAN.md** - Base memory system (prerequisite)
- **KIRO_PLANNER_SYSTEM_IMPLEMENTATION_PLAN.md** - Planner with explore agents

---

# Appendix E: Task-Driven Memory Generalization

## The Big Idea

The exploration mode is just ONE instance of a **task-driven memory system**. The key insight is:

1. **Mode = Subagent Assignment** - Different subagents get different modes
2. **Normalize Storage** - All modes store observations the same way
3. **Hierarchy Works Same** - Same reflector/compaction works regardless of mode

This makes task-driven memory practical:

- Mode changes WHAT is captured, NOT how it's stored/processed
- Same reflector works across all modes
- Easy to add new modes

---

## E.1 Mode System

```typescript
type AgentMode =
  | "default" // General coding (build mode)
  | "explore" // Codebase exploration
  | "bug_fixing" // Bug investigation and fixing
  | "refactoring" // Code refactoring
  | "testing" // Test writing/running
  | "debugging" // Debugging session
  | "research"; // Web research / docs lookup
```

**Mode Assignment:**

- Main agent spawns subagent with explicit mode
- Mode is injected as part of agent spawn context
- Mode determines which prompts and thresholds to use

---

## E.2 Normalized Observation Schema

Regardless of mode, ALL observations stored in same format:

```typescript
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

**Key insight**: All modes normalize to same structure. The `mode` field tells the observer what to focus on, but storage/processing is unified.

---

## E.3 Mode-Specific Prompts

### Default Mode (Build Mode)

Uses existing prompts from TASK_MEMORY_IMPLEMENTATION_PLAN.md:

- OBSERVER_EXTRACTION_INSTRUCTIONS
- OBSERVER_OUTPUT_FORMAT
- OBSERVER_GUIDELINES
- COMPRESSION_GUIDANCE

### Explore Mode

Already defined in Part 1 of this plan.

### Bug Fixing Mode

```typescript
const BUGFIXING_TASK_CONTEXT = `
You are investigating and fixing a bug. Your memory will help track the investigation.

YOUR OBJECTIVE:
${bugDescription}  // e.g., "Fix login form not submitting"

Focus on:
- Error messages and stack traces
- Root cause analysis
- What was attempted and what worked
- Files modified during fix
`;

const BUGFIXING_EXTRACTION_INSTRUCTIONS = `
CRITICAL: Capture bug investigation details precisely.

For each message exchange, extract:

1. ERROR DETAILS - Exact error message, stack trace, line numbers
2. ROOT CAUSE - What was identified as the cause
3. ATTEMPTED FIXES - What was success/failure
4 tried,. FILES INVOLVED - Files examined, modified
5. SOLUTION - What finally worked (if found)

PRESERVE EXACT DETAILS:
- Error messages: "TypeError: Cannot read property 'id' of undefined"
- Stack traces: Full trace with file:line
- Root cause: "Missing null check on user object at line 45"
`;

const BUGFIXING_OUTPUT_FORMAT = `
<error_investigation>
## Initial Error
- Error type: [TypeError, ReferenceError, etc.]
- Error message: [exact message]
- Location: [file:line number]
- Stack trace: [key frames]

## Root Cause Analysis
- Suspected cause: [what you think caused it]
- Evidence: [files/lines supporting this]

## Attempted Fixes
- Attempt 1: [what was tried] → [success/failure]
- Attempt 2: [what was tried] → [success/failure]

## Final Solution
- Fix applied: [what worked]
- Files modified: [list]
</error_investigation>

<current-status>
Status: [investigating / fixing / resolved]
Remaining: [any outstanding issues]
</current-status>
`;

const BUGFIXING_GUIDELINES = `
PRIORITY:
1. Exact error messages and stack traces
2. Root cause identification
3. What was attempted and results
4. Files modified

DO NOT:
- Summarize errors away
- Skip failed attempts
- Lose file:line references
`;

const BUGFIXING_MEMORY_CONFIG = {
  observationThreshold: 40000, // Higher - bug fixes need more context
  reflectionThreshold: 60000,
  bufferTokens: 8000,
  bufferActivation: 0.8,
  scope: "thread",
  lastMessages: 12,
};
```

### Refactoring Mode

```typescript
const REFACTORING_TASK_CONTEXT = `
You are refactoring code. Your memory will track what was changed and dependencies.

YOUR OBJECTIVE:
${refactorGoal}  // e.g., "Refactor auth module to use dependency injection"

Focus on:
- Files that need modification
- Interface changes (breaking)
- Test files that need updates
- Dependencies that are affected
`;

const REFACTORING_EXTRACTION_INSTRUCTIONS = `
Capture refactoring details:

1. INTERFACE CHANGES - Function signatures, class APIs that changed
2. FILES AFFECTED - All files touched or needing updates
3. BREAKING CHANGES - Anything that might break dependent code
4. TEST UPDATES - Test files that need modification
5. DEPENDENCIES - What depends on the code being changed
`;

const REFACTORING_OUTPUT_FORMAT = `
<refactoring_plan>
## Target
- What: [what you're refactoring]
- Goal: [why - better design, performance, etc.]

## Changes Required
### Files to Modify
- [file1]: [what changes]
- [file2]: [what changes]

### Interface Changes
- [old signature] → [new signature] (BREAKING?)

### Dependent Files (need updates)
- [file3] uses [old thing]
- [file4] uses [old thing]

### Test Files (need updates)
- [test1]: [what needs change]
</refactoring_plan>
`;

const REFACTORING_MEMORY_CONFIG = {
  observationThreshold: 50000, // High - need to track many files
  reflectionThreshold: 70000,
  bufferTokens: 10000,
  // ...
};
```

### Testing Mode

```typescript
const TESTING_TASK_CONTEXT = `
You are writing or running tests. Your memory tracks test coverage and results.

YOUR OBJECTIVE:
${testingGoal}  // e.g., "Add unit tests for login form"

Focus on:
- Test files created/modified
- Coverage changes
- Test results (pass/fail)
- What is being tested
`;

const TESTING_EXTRACTION_INSTRUCTIONS = `
Capture testing details:

1. TEST FILES - Which files were created/modified
2. COVERAGE - What areas are covered
3. TEST RESULTS - Pass/fail for each test
4. WHAT'S TESTED - Functions/scenarios covered
`;

const TESTING_OUTPUT_FORMAT = `
<test_summary>
## Tests Added/Modified
- [test_file1]: [N tests for X]
- [test_file2]: [N tests for Y]

## Coverage
- Before: [X%]
- After: [Y%]
- New coverage: [areas covered]

## Results
- [test_name]: PASS/FAIL
</test_summary>
`;

const TESTING_MEMORY_CONFIG = {
  observationThreshold: 40000,
  reflectionThreshold: 60000,
  // ...
};
```

### Debugging Mode

```typescript
const DEBUGGING_TASK_CONTEXT = `
You are debugging an issue. Your memory tracks symptoms and investigation.

YOUR OBJECTIVE:
${debugGoal}  // e.g., "Debug why API returns 500 on /users"

Focus on:
- Symptoms observed
- Variables/state at different points
- What was tested/tried
- Findings
`;

const DEBUGGING_OUTPUT_FORMAT = `
<debug_session>
## Symptoms
- Observed: [what's wrong]
- When: [when it occurs]
- Reproducible: [yes/no]

## Investigation
- Checked: [what you looked at]
- Found: [what you discovered]

## Variables/State
- At point A: [state]
- At point B: [state]

## Conclusion
- Root cause: [if found]
- Fix: [if applied]
</debug_session>
`;
```

---

## E.4 Unified Mode Configuration

```typescript
const DEFAULT_MEMORY_CONFIG = {
  observationThreshold: 30000,
  reflectionThreshold: 40000,
  bufferTokens: 6000,
  bufferActivation: 0.8,
  blockAfter: 7200,
  scope: "thread",
  lastMessages: 10,
};

const EXPLORER_MEMORY_CONFIG = {
  observationThreshold: 60000,
  reflectionThreshold: 80000,
  bufferTokens: 12000,
  bufferActivation: 0.8,
  blockAfter: 14400,
  scope: "thread",
  lastMessages: 15,
};

const BUGFIXING_MEMORY_CONFIG = {
  observationThreshold: 40000,
  reflectionThreshold: 60000,
  bufferTokens: 8000,
  bufferActivation: 0.8,
  blockAfter: 9600,
  scope: "thread",
  lastMessages: 12,
};

const REFACTORING_MEMORY_CONFIG = {
  observationThreshold: 50000,
  reflectionThreshold: 70000,
  bufferTokens: 10000,
  bufferActivation: 0.8,
  blockAfter: 12000,
  scope: "thread",
  lastMessages: 12,
};

const TESTING_MEMORY_CONFIG = {
  observationThreshold: 40000,
  reflectionThreshold: 60000,
  bufferTokens: 8000,
  bufferActivation: 0.8,
  blockAfter: 9600,
  scope: "thread",
  lastMessages: 12,
};

const DEBUGGING_MEMORY_CONFIG = {
  observationThreshold: 40000,
  reflectionThreshold: 60000,
  bufferTokens: 8000,
  bufferActivation: 0.8,
  blockAfter: 9600,
  scope: "thread",
  lastMessages: 12,
};

const RESEARCH_MEMORY_CONFIG = {
  observationThreshold: 60000,
  reflectionThreshold: 80000,
  bufferTokens: 12000,
  bufferActivation: 0.8,
  blockAfter: 14400,
  scope: "thread",
  lastMessages: 15,
};

const MODE_CONFIGS: Record<AgentMode, MemoryConfig> = {
  default: DEFAULT_MEMORY_CONFIG,
  explore: EXPLORER_MEMORY_CONFIG,
  bug_fixing: BUGFIXING_MEMORY_CONFIG,
  refactoring: REFACTORING_MEMORY_CONFIG,
  testing: TESTING_MEMORY_CONFIG,
  debugging: DEBUGGING_MEMORY_CONFIG,
  research: RESEARCH_MEMORY_CONFIG,
};

function getMemoryConfig(mode: AgentMode): MemoryConfig {
  return MODE_CONFIGS[mode] ?? DEFAULT_MEMORY_CONFIG;
}
```

---

## E.5 Unified Prompt Selection

```typescript
interface ModePrompts {
  taskContext: string;
  extractionInstructions: string;
  outputFormat: string;
  guidelines: string;
  compressionGuidance: CompressionGuidance;
  contextInstructions: string;
}

const MODE_PROMPTS: Record<AgentMode, ModePrompts> = {
  default: {
    taskContext: "", // Not used in default mode
    extractionInstructions: OBSERVER_EXTRACTION_INSTRUCTIONS,
    outputFormat: OBSERVER_OUTPUT_FORMAT,
    guidelines: OBSERVER_GUIDELINES,
    compressionGuidance: COMPRESSION_GUIDANCE,
    contextInstructions: OBSERVATION_CONTEXT_INSTRUCTIONS,
  },
  explore: {
    taskContext: EXPLORER_TASK_CONTEXT,
    extractionInstructions: EXPLORER_EXTRACTION_INSTRUCTIONS,
    outputFormat: EXPLORER_OUTPUT_FORMAT,
    guidelines: EXPLORER_GUIDELINES,
    compressionGuidance: EXPLORER_COMPRESSION_GUIDANCE,
    contextInstructions: EXPLORER_CONTEXT_INSTRUCTIONS,
  },
  bug_fixing: {
    taskContext: BUGFIXING_TASK_CONTEXT,
    extractionInstructions: BUGFIXING_EXTRACTION_INSTRUCTIONS,
    outputFormat: BUGFIXING_OUTPUT_FORMAT,
    guidelines: BUGFIXING_GUIDELINES,
    compressionGuidance: BUGFIXING_COMPRESSION_GUIDANCE,
    contextInstructions: BUGFIXING_CONTEXT_INSTRUCTIONS,
  },
  // ... other modes
};

function getModePrompts(mode: AgentMode): ModePrompts {
  return MODE_PROMPTS[mode] ?? MODE_PROMPTS.default;
}
```

---

## E.6 Hierarchy Still Works!

The key is that **mode only affects WHAT is captured, NOT how it's processed**:

```
Observation (mode-specific content)
        │
        ▼ Observer extracts → Same normalized format!
        │
        ▼ (30k tokens)   Same reflector works!
  Reflection
        │
        ▼ (40k tokens)   Same compaction works!
  Compaction
```

**The Reflector doesn't care about mode** - it consolidates observations the same way regardless of whether they came from explore, bug_fixing, or default mode.

---

## E.7 Adding New Modes

To add a new mode (e.g., "security_audit"):

1. Add to `AgentMode` type
2. Define mode-specific prompts (taskContext, extractionInstructions, outputFormat, guidelines)
3. Add to `MODE_CONFIGS` with appropriate thresholds
4. Add to `MODE_PROMPTS`

That's it! The storage, reflector, and compaction all work without changes.

---

## E.8 Example: Bug Fix Flow

```
User: "Fix the login bug"

Main Agent spawns Bug Agent
        │
        ├──► mode: "bug_fixing"
        ├──► taskContext: "Fix login form not submitting"
        └──► config: BUGFIXING_MEMORY_CONFIG (40k threshold)

Bug Agent runs
        │
        ├──► Creates observations with:
        │     category: "error_investigation"
        │     modeSpecific.errorType: "TypeError"
        │     modeSpecific.rootCause: "..."
        │
        └──► Returns findings to main agent

Main bug Agent receives investigation
        │
        └──► Uses findings to apply fix
```

---

## E.9 Summary: Why This Works

| Aspect                | How It's Handled                                           |
| --------------------- | ---------------------------------------------------------- |
| **Different prompts** | Each mode has its own taskContext + extractionInstructions |
| **Same storage**      | All modes normalize to same Observation schema             |
| **Same hierarchy**    | Reflector/compaction don't care about mode                 |
| **Easy to extend**    | Add new mode by defining prompts + config                  |
| **Mode switching**    | Main agent spawns with explicit mode                       |

The mode system enables **specialized memory for specialized tasks** while keeping the underlying infrastructure simple.
