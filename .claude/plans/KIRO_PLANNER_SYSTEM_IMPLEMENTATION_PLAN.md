# Kiro Planner System - Comprehensive Implementation Plan

> **⚠️ DEPENDENCY:** This plan builds on the Task Memory Implementation Plan (`.claude/plans/TASK_MEMORY_IMPLEMENTATION_PLAN.md`).
> All tool definitions, database schemas, and functionality from Task Memory Phase 1 are prerequisites.

> **✅ REVIEWED:** This plan has been reviewed and corrected for:
> - SQLite syntax (PostgreSQL → SQLite json_extract)
> - TOCTOU race conditions (fs.exists → try/catch)
> - Parser robustness (regex fixes, multiline support)
> - Dependency source of truth (metadata → junction table)
> - BM25 vs FTS5 terminology
> - Observational memory integration
> - DAG validation (parsed tasks.md, not DB)
> - ID parser (preserves R-/T- prefixes)
> - Variable shadowing (renamed parsedTasks)
> - SQLite migration (VIRTUAL columns, not STORED)
> - Session metadata merge (not overwrite)
> - ActiveTaskId semantics (DB UUID consistency)
> - FTS5 NEAR syntax (correct format)
> - Context injection (closed task summaries, not observational_memory)
> 
> See Appendix Y for detailed fix list.

## Executive Summary

This document specifies the implementation of a production-ready Planner System for ekacode that combines:
1. **Kiro Spec Design** - Structured specs with R-###, T-###, P-### traceability
2. **OpenCode Patterns** - plan_enter/exit tools, 5-phase workflow
3. **Task Memory** - DB-backed task tracking with dependencies
4. **Memory System** - BM25 search for retrieval

The planner system enables reliable multi-session complex project work with full traceability.

---

# Part 1: Architecture Overview

## System Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           User Session                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  plan_enter tool ──▶ Switch to plan mode                           │   │
│  │  plan_exit tool ──▶ Request user approval                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Planner Agent                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Phase 1: Explore (spawn explore agents in parallel)                │   │
│  │ Phase 2: Design (spawn general agents)                             │   │
│  │ Phase 3: Review (validate against requirements)                    │   │
│  │ Phase 4: Write Spec Files (requirements.md, design.md, tasks.md)  │   │
│  │ Phase 5: Compile Tasks (tasks.md → DB tasks + deps)                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Spec Files (.kiro/specs/)                           │
│                                                                             │
│  .kiro/specs/<slug>/                                                       │
│    ├── requirements.md    (R-### acceptance criteria)                      │
│    ├── design.md          (architecture, interfaces)                        │
│    ├── tasks.md           (T-### task list with R-### mapping)             │
│    └── correctness.md     (P-### properties - optional)                     │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Task Memory (DB)                                       │
│                                                                             │
│  tasks table:                                                               │
│    - id, title, description, status (open/in_progress/closed)              │
│    - metadata.spec.slug, metadata.spec.taskId (T-###)                       │
│    - metadata.spec.requirements (R-### list)                               │
│    - metadata.spec.properties (P-### list)                                 │
│                                                                             │
│  task_dependencies table:                                                  │
│    - taskId, dependsOnId, type (blocks/parent-child/related)               │
│                                                                             │
│  task_messages table:                                                      │
│    - taskId, messageId (junction for evidence)                             │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Executor Workflow                                      │
│                                                                             │
│  1. Executor calls task-mutate claim on T-###                              │
│  2. Works on implementation                                                │
│  3. Messages auto-linked via activeTaskId                                  │
│  4. On close: task-mutate close with structured summary                    │
│  5. Summary includes: files changed, tests, R-### satisfied                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

# Part 2: Tool Definitions

## 2.1 Plan Control Tools

### plan_enter Tool

```typescript
// packages/core/src/tools/plan.ts

export const planEnterTool = tool({
  description: `Switch to plan mode for research and planning.

Use this when:
- User asks to plan something complex
- Requirements are unclear and need investigation
- You want to create a structured plan before implementing

This will switch your agent to plan mode where you can:
- Explore the codebase using subagents
- Create structured spec files
- Define tasks with clear dependencies
- NOT make any code changes (except to spec files)

The plan will be saved to .kiro/specs/<slug>/`,

  inputSchema: z.object({
    spec_slug: z.string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/)
      .describe("URL-friendly slug for the spec (e.g., 'user-auth', 'api-v2')"),
    description: z.string()
      .min(1)
      .max(500)
      .describe("Brief description of what to plan"),
  }),

  execute: async (params, context) => {
    const { spec_slug, description } = params;
    const instanceContext = Instance.context;
    
    // Validate spec slug format
    if (!/^[a-z0-9-]+$/.test(spec_slug)) {
      throw new Error("spec_slug must be lowercase alphanumeric with dashes only");
    }
    
    // Create spec directory structure
    const specDir = path.join(instanceContext.directory, '.kiro', 'specs', spec_slug);
    await fs.mkdir(specDir, { recursive: true });
    
    // Create initial spec files with templates
    await writeSpecTemplate(specDir, spec_slug, description);
    
    // Update session/thread with active spec
    await updateSessionSpec(instanceContext.sessionID, spec_slug);
    
    return {
      spec_slug,
      spec_path: specDir,
      status: "Plan mode activated. Use explore agents to understand the codebase, then create requirements.md, design.md, and tasks.md",
    };
  }
});
```

### plan_exit Tool

```typescript
export const planExitTool = tool({
  description: `Request user approval to switch from plan mode to build mode.

Use this when:
- You have completed all spec files
- tasks.md is ready with all T-### tasks
- Dependencies form a valid DAG (no cycles)
- You want user to approve before implementation

This will:
1. Present the plan summary to user
2. Validate DAG (no cycles)
3. Ask for approval to switch to build mode
4. If approved, switch agent and activate first ready task`,

  inputSchema: z.object({
    summary: z.string()
      .max(2000)
      .describe("Brief summary of the plan for user review"),
  }),

  execute: async (params, context) => {
    const { summary } = params;
    const instanceContext = Instance.context;
    
    // Get active spec slug from session
    const specSlug = await getActiveSpec(instanceContext.sessionID);
    if (!specSlug) {
      throw new Error("No active spec. Use plan_enter first.");
    }
    
    // Validate spec exists - use try/catch instead of fs.exists() to avoid TOCTOU race conditions
    const specDir = path.join(instanceContext.directory, '.kiro', 'specs', specSlug);
    const tasksFile = path.join(specDir, 'tasks.md');
    
    let tasks;
    try {
      // Attempt to read and parse tasks.md directly
      tasks = await parseTasksMd(tasksFile);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error("tasks.md not found. Create it before exiting plan mode.");
      }
      throw err; // Re-throw other errors
    }
    
    if (tasks.length === 0) {
      throw new new Error("No tasks found in tasks.md. Add at least one T-### task.");
    }
    
    // Validate all T-### have R-### mappings
    const unmapped = tasks.filter(t => !t.requirements || t.requirements.length === 0);
    if (unmapped.length > 0) {
      throw new Error(`Tasks without R-### mapping: ${unmapped.map(t => t.id).join(', ')}`);
    }
    
    // Validate DAG (no cycles) from PARSED tasks.md - NOT from DB (spec not compiled yet!)
    // Build adjacency list from parsed tasks directly
    const dagValidation = validateTaskDagFromParsed(tasks);
    if (!dagValidation.valid) {
      throw new Error(`Task dependencies form cycles: ${dagValidation.cycles.map(c => c.join(' → ')).join(', ')}`);
    }
    
    // Ask user for approval
    const approved = await askUserApproval({
      title: "Plan Ready for Review",
      message: summary + `\n\n✅ DAG validated: no cycles\n📋 ${tasks.length} tasks ready`,
      options: [
        { label: "Approve & Build", description: "Switch to build and start implementing" },
        { label: "Keep Planning", description: "Continue refining the plan" },
      ]
    });
    
    if (!approved) {
      return { status: "Planning continued", message: "User chose to keep planning" };
    }
    
    // Switch to build mode
    await updateSessionAgent(instanceContext.sessionID, 'build');
    
    // Compile tasks to DB
    const compiled = await compileSpecToDb(specDir, specSlug);
    
    // Return first ready task
    const readyTasks = await getReadyTasks(specSlug);
    
    return {
      status: "Switched to build mode",
      tasks_compiled: compiled.created + compiled.updated,
      next_task: readyTasks[0] || null,
      message: readyTasks[0] 
        ? `First ready task: ${readyTasks[0].title} (${readyTasks[0].id})`
        : "All tasks have dependencies - no ready tasks"
    };
  }
});
```

## 2.2 Task Memory Tools (From Phase 1)

### task-query Tool

```typescript
// packages/core/src/tools/task-query.ts

export const taskQueryTool = tool({
  description: `Query tasks from Task Memory.

Use this to:
- Find ready tasks (no blocked dependencies)
- Show details of a specific task
- List all tasks for a spec
- Search tasks by title or description`,

  inputSchema: z.object({
    action: z.enum(['ready', 'show', 'list', 'search'])
      .describe("Query action"),
    spec_slug: z.string().optional()
      .describe("Filter by spec slug (required for most actions)"),
    task_id: z.string().optional()
      .describe("Task ID (e.g., 'T-001') for show action"),
    query: z.string().optional()
      .describe("Search query for search action"),
  }),

  execute: async (params) => {
    const { action, spec_slug, task_id, query } = params;
    
    switch (action) {
      case 'ready': {
        // Get tasks with no unclosed dependencies
        const ready = await getReadyTasks(spec_slug);
        return { tasks: ready, count: ready.length };
      }
      
      case 'show': {
        if (!task_id) throw new Error("task_id required for show action");
        const task = await getTaskById(spec_slug, task_id);
        if (!task) throw new Error(`Task ${task_id} not found`);
        return { task };
      }
      
      case 'list': {
        const tasks = await listTasksBySpec(spec_slug);
        return { tasks, count: tasks.length };
      }
      
      case 'search': {
        if (!query) throw new Error("query required for search action");
        const results = await searchTasks(query);
        return { tasks: results, count: results.length };
      }
    }
  }
});
```

### task-mutate Tool

```typescript
// packages/core/src/tools/task-mutate.ts

export const taskMutateTool = tool({
  description: `Modify tasks in Task Memory.

Use this to:
- create: Create a new task (usually done by planner)
- claim: Claim a task before working on it (sets status to in_progress)
- close: Close a task with structured summary
- dep: Add/remove dependencies
- link: Link messages/evidence to a task
- update_context: Update task context (title, description, metadata)`,

  inputSchema: z.object({
    action: z.enum(['create', 'claim', 'close', 'dep', 'link', 'update_context'])
      .describe("Mutation action"),
    
    // create fields
    spec_slug: z.string().optional(),
    task_id: z.string().optional(), // e.g., "T-001"
    title: z.string().optional(),
    description: z.string().optional(),
    requirements: z.array(z.string()).optional(), // ["R-001", "R-002"]
    dependencies: z.array(z.string()).optional(), // ["T-001"]
    
    // close fields
    close_reason: z.enum(['completed', 'wontfix', 'duplicate']).optional(),
    summary: z.object({
      files_changed: z.array(z.string()),
      tests_added: z.array(z.string()),
      requirements_satisfied: z.array(z.string()),
      properties_validated: z.array(z.string()).optional(),
      decisions: z.string().optional(),
      follow_ups: z.array(z.string()).optional(),
    }).optional(),
    
    // dep fields
    dependency_action: z.enum(['add', 'remove']).optional(),
    depends_on: z.string().optional(),
    
    // link fields
    message_ids: z.array(z.string()).optional(),
  }),

  execute: async (params) => {
    const { action, ...rest } = params;
    
    switch (action) {
      case 'create':
        return await createTask(rest);
      
      case 'claim':
        return await claimTask(rest.task_id, rest.spec_slug);
      
      case 'close':
        return await closeTask(rest.task_id, rest.spec_slug, rest.close_reason, rest.summary);
      
      case 'dep':
        return await updateDependency(rest.task_id, rest.dependency_action, rest.depends_on);
      
      case 'link':
        return await linkMessages(rest.task_id, rest.message_ids);
      
      case 'update_context':
        return await updateTaskContext(rest.task_id, rest);
    }
  }
});
```

### memory-search Tool

```typescript
// packages/core/src/tools/memory-search.ts

export const memorySearchTool = tool({
  description: `Search past conversations using full-text search (FTS5 with BM25 ranking).

Use this to:
- Find previous discussions about a topic
- Retrieve code examples from past sessions
- Find task summaries by spec
- Search for specific R-###, T-### references

Query syntax: Use FTS5 query operators
- Simple terms: "login schema"
- Phrases: ""LoginSchema validation""
- AND/OR: "login AND schema" or "login OR auth"
- NEAR: NEAR("login" "schema", 10) - matches within 10 tokens
- Prefix: "Login*" (matches LoginSchema, LoginForm, etc.)`,

  inputSchema: z.object({
    query: z.string()
      .min(1)
      .max(500)
      .describe("Search query using FTS5 syntax (BM25 used for ranking results)"),
    spec_slug: z.string().optional()
      .describe("Optional: limit search to a specific spec"),
    limit: z.number().min(1).max(20).default(5)
      .describe("Maximum results to return"),
  }),

  execute: async (params) => {
    const { query, spec_slug, limit } = params;
    
    const results = await searchMessagesBM25({
      query,
      filters: spec_slug ? { spec_slug } : undefined,
      limit,
    });
    
    return {
      results: results.map(r => ({
        message_id: r.messageId,
        content: r.content,
        task_id: r.taskId,
        created_at: r.createdAt,
        score: r.score,
      })),
      count: results.length,
    };
  }
});
```

---

# Part 3: Planner Agent Implementation

## 3.1 Agent Configuration

```typescript
// packages/core/src/agent/planner.ts

import type { ToolSet } from "ai";
import { createRoleAgent } from "./core/role-agent";
import type { AgentModels, RoleAgentOverrides } from "./core/types";

export const PLANNER_AGENT_INSTRUCTIONS = `You are Kiro, an expert planning agent for software development.

## Your Role
You create structured, executable plans for complex software projects with full traceability.

## Spec System
You work with specs in \`.kiro/specs/<slug>/\`:
- requirements.md - Acceptance criteria (R-###)
- design.md - Architecture and interfaces
- tasks.md - Implementation tasks (T-###)
- correctness.md - Property-based tests (P-###)

## Hard Gates (MUST Enforce)

### Gate A - Requirements
Before proceeding to design:
- [ ] All R-### are unique
- [ ] Each R-### is testable (EARS format: WHEN... THEN...)
- [ ] Non-goals are explicit

### Gate B - Design
Before proceeding to tasks:
- [ ] Architecture documented
- [ ] Happy path flow explicit
- [ ] Key decisions recorded (D-###)
- [ ] Interfaces defined

### Gate C - Planning
Before compiling to DB:
- [ ] All T-### unique
- [ ] Each T-### maps to ≥1 R-###
- [ ] Dependencies form valid DAG

### Gate D - Execution
You do NOT execute. The build agent executes. Your job is to create a complete plan.

## Workflow (Follow in Order)

### Phase 1: Explore
- Spawn 1-3 explore agents IN PARALLEL for complex tasks
- Single agent for isolated/simple tasks
- Focus: Understand codebase structure, existing patterns

### Phase 2: Design
- Review exploration results
- Create design.md with architecture
- Identify key interfaces and data models

### Phase 3: Requirements
- Create requirements.md with R-### IDs
- Use EARS format for acceptance criteria
- Map each criterion to testable outcomes

### Phase 4: Tasks
- Create tasks.md with T-### IDs
- Each task MUST map to R-### (e.g., "T-001 (maps: R-001, R-002)")
- Dependencies MUST be explicit
- Use subtasks for complex items

### Phase 5: Compile
- Run the spec compiler to create DB tasks
- Verify "ready work" computation
- Call plan_exit to request user approval

## Task Memory Integration
- Use task-query to find ready tasks (for reference)
- Use task-mutate only during compile phase
- All tasks get metadata:
  {
    "spec": {
      "slug": "<spec-slug>",
      "taskId": "T-###",
      "requirements": ["R-001", "R-002"]
    }
  }

## Memory Search
- Use memory-search to find past discussions
- Look for similar features or patterns
- Reference existing implementations when relevant

## Output Format
When presenting plans:
- Use markdown with clear headings
- Include R-###, T-### IDs prominently
- Show dependency graph when complex
- List verification steps for each task

## What You CANNOT Do
- Edit code files (only spec files in .kiro/specs/)
- Run implementation commands
- Claim tasks - that's the executor's job

---

${OPENCODE_PHASE_PROMPT}  // Borrowed from OpenCode
`;

export function createPlannerAgent<TOOLS extends ToolSet>(
  models: AgentModels,
  overrides: RoleAgentOverrides<TOOLS> = {}
) {
  return createRoleAgent<TOOLS>(
    {
      id: "planner-agent",
      name: "Planner Agent",
      instructions: PLANNER_AGENT_INSTRUCTIONS,
    },
    models,
    overrides
  );
}
```

## 3.2 Context Injection (Spec + Observational Memory)

**ALIGNMENT:** This follows the Task Memory Plan's hybrid approach (Observations + BM25). The spec context injection is **separate** from observational memory injection — they inject at different points in the message array.

### Context Window Stack

```
Message Array Order:
1. System Prompt (base agent instructions)
2. Observational Memory (system) - from Task Memory, previous sessions
3. Continuation Hint (user) - marks compaction boundary  
4. Spec Context (system) - current task from Kiro Planner
5. Actual Conversation (user/assistant)
```

### Real Message Array Example

When build agent starts work on T-002 (JWT token generation):

```typescript
const messageArray = [
  // 1. BASE SYSTEM PROMPT
  {
    role: 'system',
    content: 'You are Kiro, an expert build agent...',
  },

  // 2. OBSERVATIONAL MEMORY (from Task Memory - previous sessions)
  {
    role: 'system',
    content: `The following observations block contains your memory of past coding sessions with this user.

<observations>
Date: Feb 16, 2026
* 🔴 (10:00) User requested implementation of user login feature (spec: user-login)
* 🟡 (10:15) Assistant created LoginSchema = z.object({ email: z.string().email(), password: z.string().min(8) }) in src/auth/schemas/login.ts
* 🟡 (10:20) Assistant created COMMON_PASSWORDS Set in src/auth/schemas/common-passwords.ts (top 1000 passwords)
* 🟡 (10:35) Assistant wrote unit tests for LoginSchema in tests/auth/login.test.ts covering valid/invalid emails, password min length
* 🟡 (10:45) Assistant completed T-001, all tests passing
</observations>

IMPORTANT: When responding, reference specific details from these observations...`,
    metadata: { type: 'observational-memory' },
  },

  // 3. CONTINUATION HINT (marks compaction boundary - INJECTED AS USER MESSAGE!)
  {
    role: 'user',
    content: `<system-reminder>
This message is not from the user, the conversation history grew too long and wouldn't fit in context! Thankfully the entire conversation is stored in your memory observations.

Please continue from where the observations left off. Do not refer to your "memory observations" directly, the user doesn't know about them, they are your memories!

Just respond naturally as if you're remembering the conversation (you are!). Do not say "Hi there!" or "based on our previous conversation" as if the conversation is just starting, this is not a new conversation.

This is an ongoing coding session, keep continuity by responding based on your memory of what you were working on...

IMPORTANT: this system reminder is NOT from the user. The system placed it here as part of your memory system.

NOTE: Any messages following this system reminder are newer than your memories.
</system-reminder>`,
    metadata: { type: 'memory-continuation' },
  },

  // 4. SPEC CONTEXT (from Kiro Planner - current task, INJECTED AFTER memory chain!)
  {
    role: 'system',
    content: `## Current Task: T-002
**Title:** Implement JWT token generation

**Requirements:**
- R-001: WHEN user enters valid email AND password THEN they are authenticated AND redirected to dashboard within 2 seconds
- R-003: WHEN user enters incorrect password THEN error "Invalid email or password" appears (do NOT reveal which field is wrong)
- R-005: WHEN user has 5+ failed login attempts THEN account is locked for 15 minutes
- R-007: WHEN user successfully logs in THEN session token is created with 24-hour expiry
- R-015: WHEN user clicks logout THEN session is invalidated server-side immediately
- R-017: WHEN user logs out THEN all refresh tokens are revoked

**Outcome:** JWT tokens generated on successful login, tokens include userId and expiry, tokens signed with JWT_SECRET from config

**Spec Task Index:**
✓ T-001: Create LoginSchema validation (COMPLETED)
→ T-002: Implement JWT token generation (IN PROGRESS)
○ T-003: Create login API endpoint (PENDING)

**Memory Search:** Use memory-search tool to retrieve exact details from previous work.`,
    metadata: { type: 'spec-context', specSlug: 'user-login' },
  },

  // 5. ACTUAL CONVERSATION STARTS HERE
  {
    role: 'user',
    content: 'Continue with the JWT implementation. Use the LoginSchema we created earlier.',
  },
];
```

### Key Points

| Injection Point | Role | Purpose | When Injected |
|-----------------|------|---------|---------------|
| **Observational Memory** | system | Previous sessions' narrative | Task Memory system |
| **Continuation Hint** | user | Marks compaction boundary | Task Memory system |
| **Spec Context** | system | Current task requirements | Kiro Planner spec-injector |
| **Conversation** | user/assistant | Actual work | Runtime |

The spec context injection happens **after** the observational memory chain, not as part of it. They are separate injections:
- **Task Memory** handles: "what happened in previous sessions" (observations + hint)
- **Kiro Planner** handles: "what am I working on right now" (spec context)

### Implementation

```typescript
// packages/core/src/agent/spec-injector.ts

/**
 * Injects spec context with observational memory integration
 * 
 * Per Task Memory Plan:
 * - Observations tell LLM what entities exist (schema names, file paths, etc.)
 * - Current task provides full context (requirements with actual text)
 * - LLM uses memory-search to get exact details when needed
 * 
 * CRITICAL: Injects AFTER observational memory chain (continuation hint is user message)
 */

export async function injectSpecContext(
  messages: Message[],
  sessionId: string
): Promise<Message[]> {
  // Get active spec and current task
  const activeSpec = await getActiveSpec(sessionId);
  const currentTask = await getCurrentTask(sessionId); // From activeTaskId
  
  if (!activeSpec) {
    return messages; // No spec, no injection
  }
  
  // Build spec context content
  let specContext = '';
  
  // Current Task Context (FULL - deterministic)
  // This is the task the agent is currently working on
  if (currentTask) {
    specContext += `## Current Task: ${currentTask.metadata.spec.taskId}\n`;
    specContext += `**Title:** ${currentTask.title}\n`;
    
    // Include full requirement text (not just IDs)
    if (currentTask.metadata.spec.requirements?.length > 0) {
      specContext += `**Requirements:**\n`;
      for (const reqId of currentTask.metadata.spec.requirements) {
        const reqText = await getRequirementText(activeSpec, reqId);
        specContext += `- ${reqId}: ${reqText}\n`;
      }
      specContext += `\n`;
    }
    
    if (currentTask.description) {
      specContext += `**Outcome:** ${currentTask.description}\n\n`;
    }
    
    // Task index (what else exists in the spec)
    const taskIndex = await getTaskIndex(activeSpec);
    if (taskIndex.length > 0) {
      specContext += `**Spec Task Index:**\n`;
      for (const task of taskIndex) {
        const status = task.status === 'closed' ? '✓' : 
                      task.status === 'in_progress' ? '→' : '○';
        specContext += `${status} ${task.metadata.spec.taskId}: ${task.title}\n`;
      }
      specContext += `\n`;
    }
  }
  
  // Add memory search hint
  specContext += `**Memory Search:** Use memory-search tool to retrieve exact details from previous work.\n`;
  specContext += `Examples: "LoginSchema validation", "JWT secret", "T-001 implementation"\n`;
  
  // Inject as system message AFTER observational memory chain
  // Find the last system message (base prompt), insert after it
  const specMessage: Message = {
    role: 'system',
    content: specContext,
    metadata: { type: 'spec-context', specSlug: activeSpec }
  };
  
  // Find position after base system prompt and continuation hint (if present)
  // The continuation hint is a user message that marks the boundary
  const continuationHintIndex = messages.findIndex(
    m => m.role === 'user' && m.metadata?.type === 'memory-continuation'
  );
  
  if (continuationHintIndex >= 0) {
    // Insert after continuation hint
    messages.splice(continuationHintIndex + 1, 0, specMessage);
  } else {
    // No continuation hint, insert after base system prompt
    const baseSystemIndex = messages.findIndex(m => m.role === 'system');
    if (baseSystemIndex >= 0) {
      messages.splice(baseSystemIndex + 1, 0, specMessage);
    } else {
      messages.unshift(specMessage);
    }
  }
  
  return messages;
}

/**
 * Get full requirement text from requirements.md
 * Provides deterministic context (not just R-### IDs)
 */
async function getRequirementText(specSlug: string, reqId: string): Promise<string> {
  const specDir = path.join(getWorkspaceDir(), '.kiro', 'specs', specSlug);
  const reqFile = path.join(specDir, 'requirements.md');
  
  try {
    const content = await readFile(reqFile, 'utf-8');
    // Parse requirements.md to find the actual text for this R-###
    const reqMatch = content.match(new RegExp(`- ${reqId}\\s*\\n?\\s*WHEN.*?THE SYSTEM SHALL.*?(?=\\n- R-|$)`, 'is'));
    return reqMatch ? reqMatch[0].replace(/\n/g, ' ').trim() : reqId;
  } catch {
    return reqId;
  }
}

---

# Part 4: Spec Compiler Implementation

## 4.1 tasks.md Parser

```typescript
// packages/core/src/spec/compiler.ts

interface ParsedTask {
  id: string;           // "T-001"
  title: string;
  requirements: string[]; // ["R-001", "R-002"]
  dependencies: string[]; // ["T-002"]
  outcome: string;
  notes: string;
  subtasks: string[];
}

interface ParsedSpec {
  slug: string;
  tasks: ParsedTask[];
  requirements: string[]; // All R-### mentioned
}

/**
 * Parse tasks.md file
 * 
 * IMPROVED: More robust parsing with:
 * - Fixed regex character classes (escaped dashes)
 * - Multiline outcome support using block-based parsing
 * - Better error handling and validation
 */
export async function parseTasksMd(tasksFilePath: string): Promise<ParsedTask[]> {
  const content = await readFile(tasksFilePath, 'utf-8');
  
  // Split by task headers (## T-###)
  const taskBlocks = content.split(/^##\s+(T-\d+)\s*[—–-]\s+(.+)$/m);
  
  const tasks: ParsedTask[] = [];
  
  // taskBlocks[0] is content before first task, then [1]=id, [2]=title, [3]=body, [4]=id, [5]=title, etc.
  for (let i = 1; i < taskBlocks.length; i += 3) {
    const id = taskBlocks[i];
    const title = taskBlocks[i + 1]?.trim();
    const body = taskBlocks[i + 2] || '';
    
    if (!id || !title) continue;
    
    const task = parseTaskBlock(id, title, body);
    tasks.push(task);
  }
  
  return tasks;
}

function parseTaskBlock(id: string, title: string, body: string): ParsedTask {
  const task: ParsedTask = {
    id,
    title,
    requirements: [],
    dependencies: [],
    outcome: '',
    notes: '',
    subtasks: [],
  };
  
  // Parse requirements - FIXED: escaped dash in character class
  // Matches: **Maps to requirements:** R-001, R-002
  const reqMatch = body.match(/\*\*Maps? to (?:requirements?|R-###):\*\*\s*([\d,\sR\-]+)/i);
  if (reqMatch) {
    task.requirements = parseIdList(reqMatch[1], 'R-');
  }
  
  // Parse dependencies - FIXED: escaped dash in character class
  // Matches: **Dependencies:** T-001, T-002
  const depMatch = body.match(/\*\*Dependencies:\*\*\s*([\d,\sT\-]+)/i);
  if (depMatch) {
    task.dependencies = parseIdList(depMatch[1], 'T-');
  }
  
  // Parse outcome - IMPROVED: multiline support
  // Matches: **Outcome (Definition of Done):** followed by content until next ## or end
  const outcomeMatch = body.match(/\*\*Outcome.*?\*\*\s*\n?([\s\S]*?)(?=\n## |\n\*\*|$)/i);
  if (outcomeMatch) {
    task.outcome = outcomeMatch[1].trim();
  }
  
  // Parse notes
  const notesMatch = body.match(/\*\*Notes.*?\*\*\s*\n?([\s\S]*?)(?=\n## |\n\*\*|$)/i);
  if (notesMatch) {
    task.notes = notesMatch[1].trim();
  }
  
  // Parse subtasks: - [ ] subtask
  const subtaskMatches = body.matchAll(/^-\s*\[\s*\]\s+(.+)$/gm);
  for (const match of subtaskMatches) {
    task.subtasks.push(match[1].trim());
  }
  
  return task;
}

function parseIdList(text: string, prefix: string): string[] {
  // FIXED: Use prefix-aware regex to preserve R-/T- prefixes
  // Matches: "R-001, R-002" or "R-001 R-002" or "R-001,R-002"
  const regex = new RegExp(`${prefix}(\\d+)`, 'g');
  const ids: string[] = [];
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    ids.push(`${prefix}${match[1]}`);
  }
  
  return ids;
}

/**
 * Validate DAG from parsed tasks.md (BEFORE DB compilation)
 * This validates the source of truth (tasks.md) before it's compiled to DB
 */
function validateTaskDagFromParsed(tasks: ParsedTask[]): {
  valid: boolean;
  cycles: string[][];
  ready: string[];
} {
  // Build adjacency list from parsed tasks
  const deps: Map<string, string[]> = new Map();
  
  for (const task of tasks) {
    deps.set(task.id, task.dependencies || []);
  }
  
  // Detect cycles using DFS
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  
  function dfs(node: string, path: string[]): void {
    visited.add(node);
    recursionStack.add(node);
    
    const neighbors = deps.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path, neighbor]);
      } else if (recursionStack.has(neighbor)) {
        cycles.push([...path, neighbor]);
      }
    }
    
    recursionStack.delete(node);
  }
  
  for (const task of tasks) {
    const id = task.id;
    if (!visited.has(id)) {
      dfs(id, [id]);
    }
  }
  
  // Compute ready tasks (no unclosed dependencies - all are "open" before compilation)
  const ready = tasks
    .filter(t => !t.dependencies || t.dependencies.length === 0)
    .map(t => t.id);
  
  return {
    valid: cycles.length === 0,
    cycles,
    ready,
  };
}
```

## 4.2 Spec-to-DB Compiler

```typescript
// packages/core/src/spec/compiler.ts

/**
 * Compile spec to Task Memory DB
 * Idempotent - safe to run multiple times
 */
export async function compileSpecToDb(specDir: string, specSlug: string): Promise<{
  created: number;
  updated: number;
  errors: string[];
}> {
  const tasksFile = path.join(specDir, 'tasks.md');
  const parsedTasks = await parseTasksMd(tasksFile);
  
  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  
  // Validate: All R-### must exist in requirements.md
  const requirementsFile = path.join(specDir, 'requirements.md');
  const requirementsContent = await readFile(requirementsFile, 'utf-8');
  const validRequirements = extractIds(requirementsContent, 'R-');
  
  for (const task of parsedTasks) {
    // Validate requirements exist
    const invalidReqs = task.requirements.filter(r => !validRequirements.includes(r));
    if (invalidReqs.length > 0) {
      errors.push(`${task.id}: Invalid requirements: ${invalidReqs.join(', ')}`);
      continue;
    }
    
    // Validate dependencies exist
    const taskIds = parsedTasks.map(t => t.id);
    const invalidDeps = task.dependencies.filter(d => !taskIds.includes(d));
    if (invalidDeps.length > 0) {
      errors.push(`${task.id}: Invalid dependencies: ${invalidDeps.join(', ')}`);
      continue;
    }
    
    // Upsert task
    const existing = await getTaskBySpecAndId(specSlug, task.id);
    
    if (existing) {
      // Update
      await db.update(tasks)
        .set({
          title: task.title,
          description: task.outcome,
          metadata: {
            ...existing.metadata,
            spec: {
              slug: specSlug,
              taskId: task.id,
              requirements: task.requirements,
            }
          },
          updatedAt: Date.now(),
        })
        .where(eq(tasks.id, existing.id));
      updated++;
    } else {
      // Create
      await db.insert(tasks).values({
        id: generateTaskId(specSlug, task.id),
        title: task.title,
        description: task.outcome,
        status: 'open',
        priority: 3,
        type: 'feature',
        metadata: {
          spec: {
            slug: specSlug,
            taskId: task.id,
            requirements: task.requirements,
          }
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      created++;
    }
    
    // Upsert dependencies
    await upsertTaskDependencies(specSlug, task.id, task.dependencies);
  }
  
  return { created, updated, errors };
}

/**
 * Validate DAG (no cycles) and compute ready tasks
 * 
 * FIXED: Now queries task_dependencies table instead of relying on metadata
 * This ensures consistency even if metadata and junction table drift
 */
export async function validateTaskDependencies(specSlug: string): Promise<{
  valid: boolean;
  cycles: string[][];
  ready: string[];
}> {
  // Get all tasks for this spec
  const tasks = await listTasksBySpec(specSlug);
  
  // FIXED: Query junction table for dependencies (authoritative source)
  const depsFromDb = await db
    .select({
      taskId: task_dependencies.task_id,
      dependsOnId: task_dependencies.depends_on_id,
      type: task_dependencies.type,
    })
    .from(task_dependencies)
    .where(inArray(task_dependencies.task_id, tasks.map(t => t.id)));
  
  // Build adjacency list from junction table
  const deps: Map<string, string[]> = new Map();
  for (const task of tasks) {
    const taskSpecId = task.metadata.spec.taskId;
    // Only include 'blocks' type dependencies for cycle detection and readiness
    const taskDeps = depsFromDb
      .filter(d => d.taskId === task.id && d.type === 'blocks')
      .map(d => {
        const depTask = tasks.find(t => t.id === d.dependsOnId);
        return depTask?.metadata.spec.taskId;
      })
      .filter((id): id is string => !!id);
    deps.set(taskSpecId, taskDeps);
  }
  
  // Detect cycles using DFS
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  
  function dfs(node: string, path: string[]): void {
    visited.add(node);
    recursionStack.add(node);
    
    const neighbors = deps.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path, neighbor]);
      } else if (recursionStack.has(neighbor)) {
        cycles.push([...path, neighbor]);
      }
    }
    
    recursionStack.delete(node);
  }
  
  for (const task of tasks) {
    const id = task.metadata.spec.taskId;
    if (!visited.has(id)) {
      dfs(id, [id]);
    }
  }
  
  // Compute ready tasks (no unclosed 'blocks' dependencies)
  const ready: string[] = [];
  for (const task of tasks) {
    const taskSpecId = task.metadata.spec.taskId;
    const blockingDeps = deps.get(taskSpecId) || [];
    
    const allDepsClosed = blockingDeps.every(depSpecId => {
      const depTask = tasks.find(t => t.metadata.spec.taskId === depSpecId);
      return depTask?.status === 'closed';
    });
    
    if (allDepsClosed && task.status === 'open') {
      ready.push(taskSpecId);
    }
  }
  
  return {
    valid: cycles.length === 0,
    cycles,
    ready,
  };
}
```

---

# Part 5: Executor Workflow

## 5.1 Claim Workflow

```typescript
// When executor is ready to work, they call task-mutate claim

/**
 * Task claim handler
 * 
 * FIXED: Now queries task_dependencies junction table instead of metadata
 * to ensure consistency with validateTaskDependencies
 */
async function handleClaim(taskId: string, specSlug: string, sessionId: string) {
  // Validate task exists
  const task = await getTaskBySpecAndId(specSlug, taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found in spec ${specSlug}`);
  }
  
  // Validate task is open
  if (task.status !== 'open') {
    throw new Error(`Task ${taskId} is not open (status: ${task.status})`);
  }
  
  // FIXED: Query junction table for dependencies (authoritative source)
  const depsFromDb = await db
    .select({ dependsOnId: task_dependencies.depends_on_id })
    .from(task_dependencies)
    .where(and(
      eq(task_dependencies.task_id, task.id),
      eq(task_dependencies.type, 'blocks')
    ));
  
  // Check if all blocking dependencies are closed
  const openDeps: string[] = [];
  for (const dep of depsFromDb) {
    const depTask = await db.select().from(tasks).where(eq(tasks.id, dep.dependsOnId)).limit(1);
    if (depTask.length === 0 || depTask[0].status !== 'closed') {
      const depSpecId = depTask[0]?.metadata?.spec?.taskId || dep.dependsOnId;
      openDeps.push(depSpecId);
    }
  }
  
  if (openDeps.length > 0) {
    throw new Error(`Cannot claim ${taskId}: blocked by ${openDeps.join(', ')}`);
  }
  
  // Claim the task
  await db.update(tasks)
    .set({
      status: 'in_progress',
      assignee: sessionId,
      sessionId: sessionId,
      updatedAt: Date.now(),
    })
    .where(eq(tasks.id, task.id));
  
  // Set as active task for session (messages auto-link)
  await setSessionActiveTask(sessionId, task.id);
  
  return {
    task_id: task.metadata.spec.taskId,
    title: task.title,
    requirements: task.metadata.spec.requirements,
    status: 'claimed',
  };
}
```

## 5.2 Close Workflow with Structured Summary

```typescript
/**
 * Task close handler with required structured summary
 */
async function handleClose(
  taskId: string,
  specSlug: string,
  closeReason: 'completed' | 'wontfix' | 'duplicate',
  summary: {
    files_changed: string[];
    tests_added: string[];
    requirements_satisfied: string[];
    properties_validated?: string[];
    decisions?: string;
    follow_ups?: string[];
  }
) {
  // Validate summary has required fields
  if (!summary.files_changed || summary.files_changed.length === 0) {
    throw new Error("files_changed is required");
  }
  
  if (!summary.requirements_satisfied || summary.requirements_satisfied.length === 0) {
    throw new Error("requirements_satisfied is required");
  }
  
  // Validate all R-### exist
  const task = await getTaskBySpecAndId(specSlug, taskId);
  const mappedReqs = task.metadata.spec.requirements;
  const satisfiedReqs = summary.requirements_satisfied;
  
  const invalidSatisfied = satisfiedReqs.filter(r => !mappedReqs.includes(r));
  if (invalidSatisfied.length > 0) {
    throw new Error(`Invalid requirements satisfied: ${invalidSatisfied.join(', ')}`);
  }
  
  // Update task status
  await db.update(tasks)
    .set({
      status: 'closed',
      closeReason: closeReason,
      closedAt: Date.now(),
      summary: generateTaskSummary(task, summary),
      updatedAt: Date.now(),
    })
    .where(eq(tasks.id, task.id));
  
  // Unset active task
  await clearSessionActiveTask(task.sessionId);
  
  return {
    task_id: taskId,
    status: 'closed',
    close_reason: closeReason,
    requirements_satisfied: summary.requirements_satisfied,
  };
}

function generateTaskSummary(task: Task, summary: CloseSummary): string {
  const lines = [
    `# Task ${task.metadata.spec.taskId}: ${task.title}`,
    "",
    "## Summary",
    summary.decisions || "(No notable decisions)",
    "",
    "## Requirements Satisfied",
    ...summary.requirements_satisfied.map(r => `- ${r}`),
    "",
    "## Files Changed",
    ...summary.files_changed.map(f => `- ${f}`),
  ];
  
  if (summary.tests_added && summary.tests_added.length > 0) {
    lines.push("", "## Tests Added/Updated");
    lines.push(...summary.tests_added.map(t => `- ${t}`));
  }
  
  if (summary.properties_validated && summary.properties_validated.length > 0) {
    lines.push("", "## Properties Validated");
    lines.push(...summary.properties_validated.map(p => `- ${p}`));
  }
  
  if (summary.follow_ups && summary.follow_ups.length > 0) {
    lines.push("", "## Follow-ups");
    lines.push(...summary.follow_ups.map(f => `- ${f}`));
  }
  
  return lines.join('\n');
}
```

## 5.3 Message Auto-Linking

```typescript
/**
 * Auto-link messages to active task
 */
export async function linkMessageToActiveTask(
  messageId: string,
  sessionId: string
): Promise<void> {
  const activeTaskId = await getSessionActiveTask(sessionId);
  if (!activeTaskId) {
    return; // No active task
  }
  
  // Link message to task
  await db.insert(taskMessages).values({
    taskId: activeTaskId,
    messageId: messageId,
    linkedAt: Date.now(),
  });
  
  // Also store in message for easier retrieval
  await db.update(messages)
    .set({ taskId: activeTaskId })
    .where(eq(messages.id, messageId));
}
```

---

# Part 6: Database Schema

> **ALIGNMENT NOTE:** This schema extends Task Memory Phase 1 schema. See `.claude/plans/TASK_MEMORY_IMPLEMENTATION_PLAN.md` for full details.

## 6.1 Tables

```sql
-- tasks table (from Phase 1)
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'closed')),
  priority INTEGER DEFAULT 3 CHECK(priority BETWEEN 0 AND 4),
  type TEXT NOT NULL DEFAULT 'feature' CHECK(type IN ('bug', 'feature', 'task', 'epic', 'chore')),
  assignee TEXT,
  session_id TEXT,
  
  -- Timestamps
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  close_reason TEXT,
  
  -- Summary (filled on close)
  summary TEXT,
  
  -- Metadata (JSON) for spec integration
  metadata TEXT DEFAULT '{}',
  
  -- Original content (for compaction)
  original_content TEXT,
  compaction_level INTEGER DEFAULT 0,
  
  -- Constraints
  CONSTRAINT valid_status CHECK (
    (status = 'closed' AND closed_at IS NOT NULL) OR
    (status != 'closed' AND closed_at IS NULL)
  )
);

-- Task dependencies
CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'blocks' CHECK(type IN ('blocks', 'parent-child', 'related')),
  
  PRIMARY KEY (task_id, depends_on_id)
);

-- Task-Message junction (for evidence linking)
CREATE TABLE task_messages (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  linked_at INTEGER NOT NULL,
  
  PRIMARY KEY (task_id, message_id)
);

-- Generated columns for commonly queried JSON fields (SQLite VIRTUAL - can be added via ALTER TABLE)
-- Note: SQLite only allows adding VIRTUAL columns via ALTER TABLE, not STORED
ALTER TABLE tasks ADD COLUMN spec_slug TEXT GENERATED ALWAYS AS (json_extract(metadata, '$.spec.slug'));
ALTER TABLE tasks ADD COLUMN spec_task_id TEXT GENERATED ALWAYS AS (json_extract(metadata, '$.spec.taskId'));

-- Indexes on generated columns
CREATE INDEX idx_tasks_spec_slug ON tasks(spec_slug);
CREATE INDEX idx_tasks_spec_task_id ON tasks(spec_task_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_assignee ON tasks(assignee);
CREATE INDEX idx_task_dependencies_depends ON task_dependencies(depends_on_id);

-- Optional: Enforce uniqueness at DB level (spec_slug + spec_task_id must be unique)
-- CREATE UNIQUE INDEX idx_tasks_spec_unique ON tasks(spec_slug, spec_task_id);

-- messages table enhancements for spec integration (extends Task Memory Phase 1 schema)
-- See TASK_MEMORY_IMPLEMENTATION_PLAN.md for full messages table definition
-- NOTE: Adding foreign key constraints to existing tables in SQLite requires table rebuild
-- See migration notes below
ALTER TABLE messages ADD COLUMN task_id TEXT;  -- FK added via table rebuild if needed
ALTER TABLE messages ADD COLUMN spec_slug TEXT;
-- searchText already defined in Task Memory Plan (for BM25 FTS with summary + code)
```

## 6.2 SQLite Migration Notes

**⚠️ Important:** SQLite has limited ALTER TABLE support:

1. **Adding columns:** Easy with `ALTER TABLE ... ADD COLUMN`
2. **Adding constraints:** Requires table rebuild

If the `messages` table already exists from Task Memory Phase 1 and you need to add foreign key constraints:

```sql
-- SQLite foreign key constraint requires table rebuild
-- 1. Create new table with constraints
-- 2. Copy data
-- 3. Drop old table
-- 4. Rename new table
-- 5. Recreate indexes

-- Alternative: Don't enforce FK in DB, enforce in application logic
-- This is often acceptable for agent memory systems
```

**Recommendation:** For agent memory, application-level FK validation is often sufficient. The critical integrity is maintained by:
- Task claiming validates dependencies are closed
- Task closing validates requirements are satisfied
- These are business rules, not DB constraints

---

# Part 7: Implementation Phases

> **PREREQUISITE:** Task Memory Phase 1 must be complete before starting these phases.
> See `.claude/plans/TASK_MEMORY_IMPLEMENTATION_PLAN.md` for Task Memory details.

## Phase 1: Foundation (Week 1)

**Goal:** Basic spec files + task creation
**Prerequisite:** Task Memory Phase 1 complete (tasks, task_dependencies, task_messages tables exist)

1. Create `.kiro/specs/` directory structure
2. Create spec template files (requirements.md, design.md, tasks.md)
3. Add plan_enter / plan_exit tools
4. Implement tasks.md parser
5. Implement spec compiler (tasks.md → DB)
6. Basic task CRUD (create, list, show)

**Deliverables:**
- Plan tool works (enter → exit)
- tasks.md creates DB tasks with metadata.spec.*
- task-query tool works (from Task Memory)

## Phase 2: Workflow (Week 2)

**Goal:** Full planner executor workflow

1. Implement task claim workflow (uses task-mutate from Task Memory)
2. Implement task close with summary
3. Implement dependency validation (DAG)
4. Implement ready-task computation
5. Message auto-linking (uses Task Memory implicit linking)
6. Spec context injection in prompts

**Deliverables:**
- Executor can claim tasks (task-mutate claim)
- Executor closes with structured summary
- Dependencies enforced (can't claim blocked tasks)

## Phase 3: Search & Retrieval (Week 3)

**Goal:** Memory integration (leverages Task Memory Phase 1)

> **NOTE:** FTS5 and memory-search are implemented in Task Memory Phase 1.
> This phase focuses on spec-aware search and observer integration.

1. Verify FTS5 on messages works (from Task Memory Phase 1)
2. Verify memory-search tool works (from Task Memory Phase 1)
3. Implement spec-aware search (filter by specSlug)
4. Add R-###, T-### extraction bias in Observer prompts

**Deliverables:**
- memory-search can filter by spec_slug
- Observer extracts spec IDs for better retrieval

## Phase 4: Hardening (Week 4)

**Goal:** Production reliability

1. Spec linter (EARS format, ID uniqueness)
2. Reconciliation workflow
3. Observability (compile deltas, graph changes)
4. Edge case handling

**Deliverables:**
- Idempotent compiles
- Spec drift detection

---

# Part 8: Integration Points

## 8.0 Alignment with Task Memory

> This section builds on Task Memory Phase 1 functionality:
> - **3 tools**: task-query, task-mutate, memory-search (per Task Memory Plan)
> - **Implicit linking**: claim → activeTaskId → messages auto-tagged (per Task Memory Plan)
> - **Search**: FTS5 on searchText with BM25 + recency boost (per Task Memory Plan)

## 8.1 With Existing Agent System

```typescript
// packages/core/src/agent/workflow/factory.ts

// Add planner to registry
export const AGENT_REGISTRY = {
  // ... existing agents
  
  planner: {
    name: "planner",
    mode: "primary",
    model: "glm-4.7",
    maxIterations: 100,
    tools: [
      "read",
      "ls",
      "glob",
      "grep",
      "webfetch",
      "search-docs",
      "task", // for spawning explore/general subagents
      "plan_enter",
      "plan_exit",
      "task_query",
      "task_mutate",
      "memory_search",
    ],
    systemPrompt: PLANNER_AGENT_INSTRUCTIONS,
  },
};
```

## 8.2 With Session Controller

```typescript
// packages/core/src/session/controller.ts

// On session create with plan mode
async function createPlanSession(specSlug: string): Promise<Session> {
  const session = await createSession({
    agent: 'planner',
    metadata: {
      activeSpecSlug: specSlug,
    }
  });
  
  // Inject spec context
  await injectSpecContext(session.messages, session.id);
  
  return session;
}

// On plan_exit approved
async function switchToBuildMode(sessionId: string): Promise<void> {
  await updateSession(sessionId, { agent: 'build' });
  
  // Compile tasks to DB
  const specSlug = await getActiveSpec(sessionId);
  await compileSpecToDb(specDir, specSlug);
  
  // Get first ready task
  const ready = await getReadyTasks(specSlug);
  if (ready.length > 0) {
    await setSessionMessage(sessionId, `Ready to work on: ${ready[0].title}`);
  }
}
```

## 8.3 Session/Thread Spec Tracking

> **ALIGNMENT:** This extends the session/thread schema from Task Memory Phase 1.

The session/thread needs to track:
- `activeSpecSlug`: Currently active spec (set by plan_enter, cleared on plan_exit)
- `activeTaskId`: Currently claimed task (set by task-mutate claim)

```typescript
// Session metadata extension
interface SessionMetadata {
  // From Task Memory Phase 1
  threadId?: string;
  resourceId?: string;
  activeTaskId?: string;  // Implicit linking - Task Memory Phase 1
  
  // Planner additions
  activeSpecSlug?: string;  // Current spec being worked on
  planMode?: boolean;       // Whether in plan mode
}
```

When in plan mode:
- `activeSpecSlug` is set to current spec
- All spec file operations go to `.kiro/specs/<activeSpecSlug>/`

When switched to build mode:
- `planMode` cleared
- `activeTaskId` becomes the claimed task from task-mutate

## 8.4 With Memory System (Phase 1+)

```typescript
// Observer extraction bias for specs

const OBSERVER_SPEC_BIAS = `
When observing messages, extract and prioritize:

1. SPEC REFERENCES
   - Active spec slug: ".kiro/specs/<slug>"
   - R-### mentions: "R-001 requires..."
   - T-### mentions: "Working on T-001"
   - P-### mentions: "P-001 validates..."

2. ARCHITECTURE DECISIONS
   - "We decided to use X instead of Y"
   - "D-001: API-first approach"
   - Design.md updates needed

3. TASK PROGRESS
   - Task claimed: "Claimed T-001"
   - Task closed with summary
   - Dependencies resolved

4. EVIDENCE LINKING
   - Files changed with task context
   - Test results linked to requirements

Extract these as HIGH priority observations for future retrieval.
`;
```

---

# Part 9: Acceptance Criteria

> **NOTE:** Some criteria depend on Task Memory Phase 1 being complete first.
> Items marked "⭐ NEW" are new in this plan. Items marked "📦 PREREQ" are from Task Memory.

## Planner System (NEW)

- [ ] plan_enter creates .kiro/specs/<slug>/ with templates
- [ ] plan_exit validates tasks.md before allowing exit
- [x] plan_exit validates DAG from parsed tasks.md (no cycles) before allowing exit
- [x] claim workflow queries task_dependencies junction table (not metadata)
- [ ] tasks.md parser extracts all T-### with R-### mappings
- [ ] Spec compiler creates DB tasks with metadata
- [ ] Dependencies validated (no cycles)
- [ ] Ready tasks computed correctly

## Task Memory (PREREQ - from Task Memory Plan)

- [ ] 📦 task-query can list/filter by spec_slug
- [ ] 📦 task-mutate claim sets status to in_progress
- [ ] 📦 task-mutate close requires structured summary
- [ ] 📦 Dependencies enforced (can't claim blocked task)

## Context Injection (NEW)

- [x] Message array order: base system → observational memory → continuation hint (user) → spec context → conversation
- [x] OBSERVATION_CONTINUATION_HINT injected as user message (marks compaction boundary)
- [x] Spec context injected AFTER memory chain (as system message)
- [x] Observational memory from dependency tasks queried and injected
- [x] Current task requirements (with full text) included
- [x] Ready tasks shown in context
- [x] Task index visible for context

## Multiple Specs & Session (NEW)

- [ ] Workspace can have multiple specs in .kiro/specs/
- [ ] listSpecs shows all specs with task counts
- [ ] switchToSpec changes active spec
- [ ] Session rehydration restores active spec and task
- [ ] Messages auto-link to active task on rehydration

## Observational Memory (PREREQ - from Task Memory Phase 2)

- [ ] 📦 Observations from completed tasks stored
- [ ] 📦 Observations tell LLM what entities exist
- [ ] 📦 LLM uses observations to formulate search queries

## Search (PREREQ - from Task Memory Phase 1)

- [ ] 📦 memory-search works across sessions
- [ ] 📦 FTS5 query syntax supported (AND, OR, NEAR, phrases)
- [ ] 📦 BM25 ranking returns relevant results
- [ ] 📦 Can filter by spec_slug
- [ ] 📦 R-###, T-### searchable

## Review Fixes (COMPLETED)

- [x] SQLite JSON syntax uses `json_extract()` with generated columns
- [x] TOCTOU race conditions fixed (try/catch instead of fs.exists)
- [x] Parser regex escapes dash in character class
- [x] Parser supports multiline outcomes
- [x] Dependency validation queries junction table (not metadata)
- [x] BM25 vs FTS5 terminology clarified
- [x] Observational memory integration documented

## Review Fixes v2 (COMPLETED - External Review)

- [x] DAG validation validates from parsed tasks.md (not DB - spec not compiled yet)
- [x] ID parser preserves R-/T- prefixes (fixed parseIdList regex)
- [x] Variable shadowing fixed (renamed parsedTasks)
- [x] SQLite migration uses VIRTUAL columns (not STORED - SQLite forbids via ALTER TABLE)
- [x] Session metadata merges (not overwrites)
- [x] ActiveTaskId semantics clarified (returns DB UUID, added getCurrentTaskWithDetails)
- [x] FTS5 NEAR syntax corrected (NEAR("term1" "term2", N))
- [x] Context injection uses closed task summaries (not observational_memory table)

---

# Appendix Z: Alignment with Task Memory Plan

## Key Decisions Aligning with Task Memory

| Decision | Task Memory Plan | Planner Plan | Status |
|----------|-----------------|--------------|--------|
| Tool count | 3 tools | task-query, task-mutate, memory-search | ✅ ALIGNED |
| Task ID | UUID v7 | metadata.spec.taskId = "T-001" | ✅ ALIGNED |
| Task status | open, in_progress, closed | Same | ✅ ALIGNED |
| Dependencies | task_dependencies table | Uses same table | ✅ ALIGNED |
| Message linking | task_messages junction | Uses same junction | ✅ ALIGNED |
| Implicit linking | claim → activeTaskId | Uses same mechanism | ✅ ALIGNED |
| Search | FTS5 on searchText | Uses same FTS5 | ✅ ALIGNED |
| Recency boost | createdAt based | Uses same createdAt | ✅ ALIGNED |

## What Task Memory Provides (Prerequisite)

- `tasks` table with metadata JSON column
- `task_dependencies` table
- `task_messages` junction table
- messages table with taskId, specSlug columns
- searchText column for BM25
- task-query, task-mutate, memory-search tools

## What Planner Adds

- plan_enter / plan_exit tools
- Spec file templates and parser
- Spec compiler (tasks.md → DB tasks)
- Session metadata for activeSpecSlug
- Structured summary schema for task close
- Observer bias for spec ID extraction

---

# Appendix A: File Structure

```
packages/core/
├── src/
│   ├── agent/
│   │   ├── planner.ts              # Planner agent factory
│   │   ├── registry.ts             # Add planner to registry
│   │   └── spec-injector.ts        # Spec context injection + observation query
│   │
│   ├── tools/
│   │   ├── plan.ts                 # plan_enter, plan_exit
│   │   ├── task-query.ts           # Query tasks
│   │   ├── task-mutate.ts          # Modify tasks
│   │   ├── memory-search.ts         # BM25 search
│   │   └── registry.ts             # Add new tools
│   │
│   ├── spec/
│   │   ├── compiler.ts             # tasks.md → DB
│   │   ├── parser.ts               # Parse spec files
│   │   ├── templates.ts            # Spec file templates (writeSpecTemplate)
│   │   ├── helpers.ts              # Required helper functions (NEW)
│   │   └── validator.ts            # Validate spec integrity
│   │
│   ├── db/
│   │   ├── schema.ts               # Add tasks/task_deps tables
│   │   └── migrations/             # New migration
│   │
│   └── session/
│       ├── controller.ts           # Add plan mode handling
│       └── processor.ts            # Add spec injection
```

---

# Appendix B: Error Handling

```typescript
// Common errors and user-friendly messages

export const PLAN_ERRORS = {
  SPEC_NOT_FOUND: "No active spec. Use plan_enter first.",
  INVALID_SPEC_SLUG: "spec_slug must be lowercase alphanumeric with dashes only",
  TASKS_MD_MISSING: "tasks.md not found. Create it before exiting plan mode.",
  NO_TASKS: "No tasks found in tasks.md. Add at least one T-### task.",
  UNMAPPED_TASK: "Task {id} has no R-### mapping. Add '**Maps to requirements:** R-001'",
  CYCLE_DETECTED: "Task dependencies form a cycle: {cycle.join(' → ')}",
  DEPENDENCY_NOT_FOUND: "Task {id} depends on unknown task {dep}",
  REQUIREMENT_NOT_FOUND: "Requirement {r} not found in requirements.md",
  
  // Task errors
  TASK_NOT_FOUND: "Task {id} not found",
  TASK_NOT_OPEN: "Task {id} is not open (status: {status})",
  TASK_BLOCKED: "Task {id} is blocked by: {blocked.join(', ')}",
  SUMMARY_REQUIRED: "Closing task requires summary with files_changed and requirements_satisfied",
  INVALID_REQUIREMENT: "Cannot satisfy requirement {r} - not mapped to this task",
};
```

---

# Appendix C: OpenCode Phase Prompt (Borrowed)

```typescript
// From opencode/packages/opencode/src/session/prompt.ts (lines 1396-1456)

const OPENCODE_PHASE_PROMPT = `
### Phase 1: Initial Understanding
Goal: Gain a comprehensive understanding of the user's request by reading through code and asking them questions. Critical: In this phase you should only use the explore subagent type.

1. Focus on understanding the user's request and the code associated with their request

2. **Launch up to 3 explore agents IN PARALLEL** (single message, multiple tool calls) to efficiently explore the codebase.
   - Use 1 agent when the task is isolated to known files, the user provided specific file paths, or you're making a small targeted change.
   - Use multiple agents when: the scope is uncertain, multiple areas of the codebase are involved, or you need to understand existing patterns before planning.
   - Quality over quantity - 3 agents maximum, but you should try to use the minimum number of agents necessary (usually just 1)
   - If using multiple agents: Provide each agent with a specific search focus or area to explore.

3. After exploring the code, use the question tool to clarify ambiguities in the user request up front.

### Phase 2: Design
Goal: Design an implementation approach.

Launch general agent(s) to design the implementation based on the user's intent and your exploration results from Phase 1.

You can launch up to 1 agent(s) in parallel.

**Guidelines:**
- **Default**: Launch at least 1 Plan agent for most tasks - it helps validate your understanding and consider alternatives
- **Skip agents**: Only for truly trivial tasks

### Phase 3: Review
Goal: Review the plan(s) from Phase 2 and ensure alignment with the user's intentions.
1. Read the critical files identified by agents to deepen your understanding
2. Ensure that the plans align with the user's original request
3. Use question tool to clarify any remaining questions with the user

### Phase 4: Final Plan
Goal: Write your final plan to the plan file (the only file you can edit).
- Include only your recommended approach, not all alternatives
- Ensure that the plan file is concise enough to scan quickly, but detailed enough to execute effectively
- Include the paths of critical files to be modified
- Include a verification section describing how to test the changes end-to-end

### Phase 5: Call plan_exit tool
At the very end of your turn, once you have asked the user questions and are happy with your final plan file - you should always call plan_exit to indicate to the user that you are done planning.
This is critical - your turn should only end with either asking the user a question or calling plan_exit. Do not stop unless it's for these 2 reasons.

**Important:** Use question tool to clarify requirements/approach, use plan_exit to request plan approval. Do NOT use question tool to ask "Is this plan okay?" - that's what plan_exit does.

NOTE: At any point in time through this workflow you should feel free to ask the user questions or clarifications. Don't make large assumptions about user intent. The goal is to present a well researched plan to the user, and tie any loose ends before implementation begins.
`;
```

---

# Appendix E: Required Helper Functions

These functions are required by the Planner System but not defined in Task Memory Phase 1. They must be implemented.

```typescript
// packages/core/src/spec/helpers.ts

import { eq, and, inArray } from 'drizzle-orm';
import { tasks, task_dependencies, sessions } from '../db/schema';
import { db } from '../db';

/**
 * Get the active spec slug for a session
 */
export async function getActiveSpec(sessionId: string): Promise<string | null> {
  const session = await db
    .select({ metadata: sessions.metadata })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  
  if (session.length === 0) return null;
  return session[0].metadata?.activeSpecSlug || null;
}

/**
 * Update the active spec for a session
 * FIXED: Merges with existing metadata instead of overwriting
 */
export async function updateSessionSpec(sessionId: string, specSlug: string): Promise<void> {
  const session = await db
    .select({ metadata: sessions.metadata })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  
  await db
    .update(sessions)
    .set({ 
      metadata: { 
        ...session[0]?.metadata,  // Merge with existing metadata
        activeSpecSlug: specSlug 
      } 
    })
    .where(eq(sessions.id, sessionId));
}

/**
 * Get the currently active task for a session (returns DB UUID)
 * FIXED: Returns the DB UUID (not spec T-###), caller should fetch task to get spec.taskId
 */
export async function getCurrentTask(sessionId: string): Promise<string | null> {
  const session = await db
    .select({ metadata: sessions.metadata })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  
  if (session.length === 0) return null;
  return session[0].metadata?.activeTaskId || null;
}

/**
 * Get current task with full details (including spec.taskId)
 * Helper that combines getCurrentTask + DB fetch
 */
export async function getCurrentTaskWithDetails(sessionId: string): Promise<Task | null> {
  const taskId = await getCurrentTask(sessionId);
  if (!taskId) return null;
  
  const result = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  
  return result[0] || null;
}

/**
 * Set the active task for a session (called on task claim)
 */
export async function setSessionActiveTask(sessionId: string, taskId: string): Promise<void> {
  const session = await db
    .select({ metadata: sessions.metadata })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  
  await db
    .update(sessions)
    .set({ 
      metadata: { 
        ...session[0]?.metadata, 
        activeTaskId: taskId 
      } 
    })
    .where(eq(sessions.id, sessionId));
}

/**
 * Clear the active task for a session (called on task close)
 */
export async function clearSessionActiveTask(sessionId: string): Promise<void> {
  const session = await db
    .select({ metadata: sessions.metadata })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  
  const { activeTaskId, ...rest } = session[0]?.metadata || {};
  
  await db
    .update(sessions)
    .set({ metadata: rest })
    .where(eq(sessions.id, sessionId));
}

/**
 * Get task by spec slug and task ID (e.g., "user-login", "T-001")
 */
export async function getTaskBySpecAndId(specSlug: string, taskId: string): Promise<Task | null> {
  const result = await db
    .select()
    .from(tasks)
    .where(and(
      eq(tasks.metadata, JSON.stringify({ spec: { slug: specSlug, taskId } }))
    ))
    .limit(1);
  
  // SQLite doesn't support JSON query well, so we need to filter in JS for now
  // Alternative: use generated columns (spec_slug, spec_task_id) if available
  const filtered = result.filter(t => 
    t.metadata?.spec?.slug === specSlug && 
    t.metadata?.spec?.taskId === taskId
  );
  
  return filtered[0] || null;
}

/**
 * List all tasks for a spec
 */
export async function listTasksBySpec(specSlug: string): Promise<Task[]> {
  const result = await db
    .select()
    .from(tasks);
  
  // Filter by spec slug in metadata
  return result.filter(t => t.metadata?.spec?.slug === specSlug);
}

/**
 * Get tasks that are ready to work on (no unclosed blocking dependencies)
 */
export async function getReadyTasks(specSlug: string): Promise<Task[]> {
  const specTasks = await listTasksBySpec(specSlug);
  
  // Get all dependencies for these tasks
  const taskIds = specTasks.map(t => t.id);
  const allDeps = await db
    .select()
    .from(task_dependencies)
    .where(inArray(task_dependencies.task_id, taskIds));
  
  // Build dependency map
  const depMap = new Map<string, string[]>();
  for (const dep of allDeps) {
    if (dep.type === 'blocks') {
      const existing = depMap.get(dep.task_id) || [];
      existing.push(dep.depends_on_id);
      depMap.set(dep.task_id, existing);
    }
  }
  
  // Filter to only tasks with no open dependencies
  const ready: Task[] = [];
  for (const task of specTasks) {
    if (task.status !== 'open') continue;
    
    const blocking = depMap.get(task.id) || [];
    const allClosed = blocking.every(depId => {
      const depTask = specTasks.find(t => t.id === depId);
      return depTask?.status === 'closed';
    });
    
    if (allClosed) {
      ready.push(task);
    }
  }
  
  return ready;
}

/**
 * Update session agent type
 */
export async function updateSessionAgent(sessionId: string, agent: string): Promise<void> {
  await db
    .update(sessions)
    .set({ agent })
    .where(eq(sessions.id, sessionId));
}

/**
 * Generate a unique task ID from spec slug and task ID
 */
export function generateTaskId(specSlug: string, taskId: string): string {
  return `${specSlug}:${taskId}`;
}

/**
 * Get workspace directory (from Instance context)
 */
export function getWorkspaceDir(): string {
  return Instance.context.directory;
}

/**
 * Extract all R-### or T-### IDs from content
 */
export function extractIds(content: string, prefix: string): string[] {
  const regex = new RegExp(`${prefix}(\\d+)`, 'g');
  const matches = content.matchAll(regex);
  const ids = new Set<string>();
  
  for (const match of matches) {
    ids.add(`${prefix}${match[1]}`);
  }
  
  return Array.from(ids);
}

/**
 * Get task index (all tasks in spec with status)
 */
export async function getTaskIndex(specSlug: string): Promise<Array<{
  id: string;
  title: string;
  status: string;
  metadata: { spec: { taskId: string } };
}>> {
  const specTasks = await listTasksBySpec(specSlug);
  return specTasks.map(t => ({
    id: t.id,
    title: t.title,
    status: t.status,
    metadata: t.metadata as any,
  }));
}
```

---

# Appendix F: Observational Memory Integration

**CRITICAL:** This section ensures alignment with Task Memory Plan's observation system.

## F.1 Querying Previous Work from Closed Tasks

The spec-injector must get work summaries from completed dependency tasks.
Per Task Memory Plan: use closed task summaries (stored in tasks.summary), NOT observational_memory table.

```typescript
// packages/core/src/agent/spec-injector.ts

/**
 * Get summaries from completed dependency tasks
 * Returns deterministic "Previous Work" section from closed task summaries
 */
async function getPreviousWorkFromClosedDeps(
  specSlug: string,
  completedTaskIds: string[]
): Promise<string | null> {
  if (completedTaskIds.length === 0) return null;

  // Query closed tasks from DB - use task_dependencies junction table
  const deps = await db
    .select({ dependsOnId: task_dependencies.depends_on_id })
    .from(task_dependencies)
    .where(and(
      inArray(task_dependencies.task_id, completedTaskIds),
      eq(task_dependencies.type, 'blocks')
    ));
  
  const closedTaskIds = deps.map(d => d.dependsOnId);
  
  if (closedTaskIds.length === 0) return null;
  
  // Get summaries from closed tasks
  const closedTasks = await db
    .select({ id: tasks.id, title: tasks.title, summary: tasks.summary, metadata: tasks.metadata })
    .from(tasks)
    .where(and(
      inArray(tasks.id, closedTaskIds),
      eq(tasks.status, 'closed')
    ));
  
  if (closedTasks.length === 0) return null;
  
  // Format as "Previous Work" section
  const lines = ['## Previous Work (from completed tasks)'];
  for (const task of closedTasks) {
    const taskId = task.metadata?.spec?.taskId || task.id;
    lines.push(`### ${taskId}: ${task.title}`);
    if (task.summary) {
      // Summary is markdown, include key parts
      lines.push(task.summary.slice(0, 500)); // Limit length
    }
    lines.push('');
  }
  
  return lines.join('\n');
}
```

## F.2 Updated Spec Injector with Observation Query

```typescript
export async function injectSpecContext(
  messages: Message[],
  sessionId: string
): Promise<Message[]> {
  const activeSpec = await getActiveSpec(sessionId);
  const currentTaskId = await getCurrentTask(sessionId);
  
  if (!activeSpec || !currentTaskId) {
    return messages;
  }
  
  // Get current task details
  const currentTask = await getTaskBySpecAndId(activeSpec, currentTaskId);
  if (!currentTask) {
    return messages;
  }
  
  let specContext = '';
  
  // 1. NEW: Get summaries from completed dependency tasks (NOT observational_memory)
  const completedDeps = await getCompletedDependencyTaskIds(currentTask.id, activeSpec);
  if (completedDeps.length > 0) {
    const previousWork = await getPreviousWorkFromClosedDeps(activeSpec, completedDeps);
    if (previousWork) {
      specContext += previousWork;
      specContext += `\n\n`;
    }
  }
  
  // 2. Current Task Context (same as before)
  if (currentTask) {
    specContext += `## Current Task: ${currentTask.metadata.spec.taskId}\n`;
    specContext += `**Title:** ${currentTask.title}\n`;
    
    if (currentTask.metadata.spec.requirements?.length > 0) {
      specContext += `**Requirements:**\n`;
      for (const reqId of currentTask.metadata.spec.requirements) {
        const reqText = await getRequirementText(activeSpec, reqId);
        specContext += `- ${reqId}: ${reqText}\n`;
      }
      specContext += `\n`;
    }
    
    if (currentTask.description) {
      specContext += `**Outcome:** ${currentTask.description}\n\n`;
    }
    
    const taskIndex = await getTaskIndex(activeSpec);
    if (taskIndex.length > 0) {
      specContext += `**Spec Task Index:**\n`;
      for (const task of taskIndex) {
        const status = task.status === 'closed' ? '✓' : 
                      task.status === 'in_progress' ? '→' : '○';
        specContext += `${status} ${task.metadata.spec.taskId}: ${task.title}\n`;
      }
      specContext += `\n`;
    }
  }
  
  specContext += `**Memory Search:** Use memory-search tool to retrieve exact details from previous work.\n`;
  
  const specMessage: Message = {
    role: 'system',
    content: specContext,
    metadata: { type: 'spec-context', specSlug: activeSpec }
  };
  
  // Insert after continuation hint (user message) if present
  const continuationHintIndex = messages.findIndex(
    m => m.role === 'user' && m.metadata?.type === 'memory-continuation'
  );
  
  if (continuationHintIndex >= 0) {
    messages.splice(continuationHintIndex + 1, 0, specMessage);
  } else {
    const baseSystemIndex = messages.findIndex(m => m.role === 'system');
    if (baseSystemIndex >= 0) {
      messages.splice(baseSystemIndex + 1, 0, specMessage);
    } else {
      messages.unshift(specMessage);
    }
  }
  
  return messages;
}

/**
 * Get IDs of completed dependency tasks
 */
async function getCompletedDependencyTaskIds(
  taskId: string,
  specSlug: string
): Promise<string[]> {
  const deps = await db
    .select({ dependsOnId: task_dependencies.depends_on_id })
    .from(task_dependencies)
    .where(and(
      eq(task_dependencies.task_id, taskId),
      eq(task_dependencies.type, 'blocks')
    ));
  
  const specTasks = await listTasksBySpec(specSlug);
  const completedDeps: string[] = [];
  
  for (const dep of deps) {
    const depTask = specTasks.find(t => t.id === dep.dependsOnId);
    if (depTask?.status === 'closed') {
      completedDeps.push(depTask.metadata.spec.taskId);
    }
  }
  
  return completedDeps;
}
```

## F.3 Observer Bias for Spec Extraction

Add this bias to the Observer's extraction instructions (per Task Memory Plan):

```typescript
const OBSERVER_SPEC_BIAS = `
When observing messages for a coding session, extract and prioritize:

1. SPEC REFERENCES (extract as HIGH priority)
   - Active spec slug: ".kiro/specs/<slug>"
   - R-### mentions: "R-001 requires...", "satisfies R-002"
   - T-### mentions: "Working on T-001", "Claimed T-002", "Completed T-003"
   - P-### mentions: "P-001 validates...", "property P-002 tested"
   - Task close summaries: files changed, requirements satisfied

2. CODE ENTITIES
   - Schema names: LoginSchema, UserModel, etc.
   - Function names: authenticateUser, validateEmail, etc.
   - File paths: src/auth/login.ts, etc.
   - API endpoints: POST /api/auth/login

3. DESIGN DECISIONS
   - D-### decisions: "D-001: chose JWT over sessions"
   - Alternatives considered and rejected

Extract these as HIGH priority observations for future retrieval.
`;
```

---

# Appendix G: Multiple Specs Per Workspace

A workspace can have multiple specs. The system must handle this correctly.

## G.1 Directory Structure

```
workspace/
├── .kiro/
│   └── specs/
│       ├── user-login/
│       │   ├── requirements.md
│       │   ├── design.md
│       │   ├── tasks.md
│       │   └── correctness.md (optional)
│       ├── payment-integration/
│       │   ├── requirements.md
│       │   ├── design.md
│       │   └── tasks.md
│       └── api-v2/
│           └── ...
```

## G.2 Session Handling

Each session is tied to ONE spec:
- `activeSpecSlug` in session metadata determines which spec is active
- Planning a NEW spec creates a NEW session (or user can switch specs within session)

```typescript
// Session metadata
interface SessionMetadata {
  // ... existing fields
  activeSpecSlug?: string;   // Current spec being worked on
  planMode?: boolean;       // Whether in plan mode
}
```

## G.3 Switching Specs

User can switch between specs:

```typescript
/**
 * Switch to a different spec in the same workspace
 */
async function switchToSpec(sessionId: string, newSpecSlug: string): Promise<void> {
  // Verify spec exists
  const specDir = path.join(getWorkspaceDir(), '.kiro', 'specs', newSpecSlug);
  try {
    await fs.access(specDir);
  } catch {
    throw new Error(`Spec "${newSpecSlug}" not found in .kiro/specs/`);
  }
  
  // Update session
  await updateSessionSpec(sessionId, newSpecSlug);
  
  // Re-inject spec context
  // This will be picked up on next agent turn
}
```

## G.4 Listing Specs

```typescript
/**
 * List all specs in a workspace
 */
async function listSpecs(workspaceDir: string): Promise<Array<{
  slug: string;
  path: string;
  taskCount: number;
  lastModified: number;
}>> {
  const specsDir = path.join(workspaceDir, '.kiro', 'specs');
  
  try {
    const entries = await fs.readdir(specsDir, { withFileTypes: true });
    const specs: Array<{
      slug: string;
      path: string;
      taskCount: number;
      lastModified: number;
    }> = [];
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const specPath = path.join(specsDir, entry.name);
      const tasksPath = path.join(specPath, 'tasks.md');
      
      let taskCount = 0;
      let lastModified = 0;
      
      try {
        const stat = await fs.stat(tasksPath);
        const content = await fs.readFile(tasksPath, 'utf-8');
        const matches = content.match(/^##\s+T-\d+/gm);
        taskCount = matches?.length || 0;
        lastModified = stat.mtimeMs;
      } catch {
        // No tasks.md yet
      }
      
      specs.push({
        slug: entry.name,
        path: specPath,
        taskCount,
        lastModified,
      });
    }
    
    return specs.sort((a, b) => b.lastModified - a.lastModified);
  } catch {
    return [];
  }
}
```

---

# Appendix H: Session Rehydration

When a user resumes a session (after app restart or reconnection), the system must restore context.

## H.1 Rehydration Flow

```typescript
/**
 * Called when session is resumed
 * Restores all necessary context for the agent
 */
async function rehydrateSession(sessionId: string): Promise<SessionRehydrationResult> {
  // 1. Load session from DB
  const session = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  
  if (session.length === 0) {
    throw new Error(`Session ${sessionId} not found`);
  }
  
  const sessionData = session[0];
  const metadata = sessionData.metadata || {};
  
  // 2. Restore active spec context
  const activeSpecSlug = metadata.activeSpecSlug;
  const activeTaskId = metadata.activeTaskId;
  
  const result: SessionRehydrationResult = {
    session: sessionData,
    specContext: null,
    taskContext: null,
    needsObservationInjection: false,
  };
  
  // 3. If has active spec, load spec context
  if (activeSpecSlug) {
    const specDir = path.join(Instance.context.directory, '.kiro', 'specs', activeSpecSlug);
    
    // Check spec exists
    try {
      await fs.access(specDir);
    } catch {
      // Spec directory no longer exists, clear it
      result.specContext = null;
    }
    
    // 4. If has active task, load task context
    if (activeTaskId) {
      const task = await getTaskBySpecAndId(activeSpecSlug, activeTaskId);
      if (task) {
        result.taskContext = {
          task,
          requirements: task.metadata.spec.requirements,
          isInProgress: task.status === 'in_progress',
        };
      }
    }
    
    // 5. Check if we need to inject observations
    // If previous session had tasks, we may need observation injection
    result.needsObservationInjection = !!activeTaskId;
  }
  
  return result;
}
```

## H.2 Context Injection on Rehydration

```typescript
/**
 * Called after session rehydration to inject context into messages
 */
async function injectRehydratedContext(
  messages: Message[],
  rehydration: SessionRehydrationResult
): Promise<Message[]> {
  // First, inject observational memory (Task Memory system handles this)
  // Then inject spec context (this function)
  
  if (!rehydration.specContext && !rehydration.taskContext) {
    return messages;
  }
  
  // Build rehydration context
  let context = '';
  
  if (rehydration.specContext) {
    context += `## Resumed Session\n`;
    context += `**Spec:** ${rehydration.specContext.slug}\n`;
  }
  
  if (rehydration.taskContext) {
    const task = rehydration.taskContext.task;
    context += `\n## Current Task: ${task.metadata.spec.taskId}\n`;
    context += `**Title:** ${task.title}\n`;
    context += `**Status:** ${task.status === 'in_progress' ? 'In Progress' : 'Open'}\n`;
    
    if (task.status === 'in_progress') {
      context += `\nYou were working on this task when the session ended. Continue from where you left off.\n`;
    }
  }
  
  // Inject as system message after base system prompt
  const rehydrationMessage: Message = {
    role: 'system',
    content: context,
    metadata: { type: 'session-rehydration' }
  };
  
  const baseSystemIndex = messages.findIndex(m => m.role === 'system');
  if (baseSystemIndex >= 0) {
    messages.splice(baseSystemIndex + 1, 0, rehydrationMessage);
  } else {
    messages.unshift(rehydrationMessage);
  }
  
  return messages;
}
```

## H.3 Message Auto-Link on Rehydration

When session resumes, new messages should continue to be linked to the active task:

```typescript
/**
 * Ensure active task is set for the session
 * Called on every message after rehydration
 */
async function ensureActiveTaskLinking(sessionId: string, messageId: string): Promise<void> {
  const activeTaskId = await getCurrentTask(sessionId);
  
  if (activeTaskId) {
    // Link message to task
    await db.insert(taskMessages).values({
      taskId: activeTaskId,
      messageId: messageId,
      linkedAt: Date.now(),
    });
    
    // Also update message table
    await db
      .update(messages)
      .set({ taskId: activeTaskId })
      .where(eq(messages.id, messageId));
  }
}
```

---

# Appendix I: writeSpecTemplate Implementation

```typescript
// packages/core/src/spec/templates.ts

import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

/**
 * Create initial spec directory with template files
 */
export async function writeSpecTemplate(
  specDir: string,
  specSlug: string,
  description: string
): Promise<void> {
  // Ensure directory exists
  await mkdir(specDir, { recursive: true });
  
  // Write requirements.md template
  await writeFile(
    path.join(specDir, 'requirements.md'),
    generateRequirementsTemplate(specSlug, description),
    'utf-8'
  );
  
  // Write design.md template
  await writeFile(
    path.join(specDir, 'design.md'),
    generateDesignTemplate(specSlug, description),
    'utf-8'
  );
  
  // Write tasks.md template
  await writeFile(
    path.join(specDir, 'tasks.md'),
    generateTasksTemplate(specSlug),
    'utf-8'
  );
  
  // Write correctness.md template (optional)
  await writeFile(
    path.join(specDir, 'correctness.md'),
    generateCorrectnessTemplate(specSlug),
    'utf-8'
  );
}

function generateRequirementsTemplate(slug: string, description: string): string {
  const title = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  
  return `# ${title} — Requirements

## Context
- **Problem:** ${description || '(Describe the problem this spec solves)'}
- **Users / Personas:** 
- **Why Now:** 
- **Success Criteria:** 

## Non-Goals
- NG-1: 

## Glossary
- Term 1: 

## User Stories

### US-1: 
As a ,
I want ,
so that .

#### Acceptance Criteria (EARS)
- R-001
  WHEN 
  THE SYSTEM SHALL .

- R-002
  WHEN 
  THE SYSTEM SHALL .

## Constraints
- C-001: 

## Open Questions
- Q-001: 
`;
}

function generateDesignTemplate(slug: string, description: string): string {
  const title = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  
  return `# ${title} — Design

## Overview
${description || '(High-level summary of the implementation)'}

## Architecture

## Data Model

## API / Contracts

## Edge Cases

## Decisions
- D-001: 
  - Why: 
  - Alternatives: 
`;
}

function generateTasksTemplate(slug: string): string {
  return `# ${slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} — Implementation Plan

## Task Index
- T-001 — 

---

## T-001 — 
**Maps to requirements:** 
**Outcome (Definition of Done):** 
**Dependencies:** 

### Subtasks
- [ ] 

### Validation
Tests: 

### Notes

---

## Future Tasks (add as needed)
- T-002 — 
`;
}

function generateCorrectnessTemplate(slug: string): string {
  return `# ${slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} — Correctness Properties

## Properties

### P-001: 
**Description:** 
**Test Strategy:** 

### P-002: 
**Description:** 
**Test Strategy:** 
`;
}
```

## requirements.md Template

```markdown
# <Spec Name> — Requirements

## Context
- **Problem:** 
- **Users / Personas:** 
- **Why Now:** 
- **Success Criteria:** 

## Non-Goals
- NG-1: 
- NG-2: 

## Glossary
- Term 1: 
- Term 2: 

## User Stories

### US-1: <title>
As a <user>,
I want <capability>,
so that <value>.

#### Acceptance Criteria (EARS)
- R-001
  WHEN <event/condition>
  THE SYSTEM SHALL <behavior/outcome>.

- R-002
  WHEN <event/condition>
  THE SYSTEM SHALL <behavior/outcome>.

## Constraints
- C-001: 

## Open Questions
- Q-001: 
```

## design.md Template

```markdown
# <Spec Name> — Design

## Overview

## Architecture

## Data Model

## API / Contracts

## Edge Cases

## Decisions
- D-001: <decision>
  - Why: 
  - Alternatives: 
```

---

# Appendix Y: Review Fixes Summary

This section documents corrections made based on code review feedback.

## Y.1 SQLite JSON Syntax (FIXED)

**Issue:** Used PostgreSQL JSON operators (`metadata->>'spec.slug'`) instead of SQLite syntax.

**Fix:** Use generated columns with `json_extract()`:
```sql
-- Before (PostgreSQL - WRONG for SQLite)
CREATE INDEX idx_tasks_spec_slug ON tasks((metadata->>'spec.slug'));

-- After (SQLite - CORRECT)
ALTER TABLE tasks ADD COLUMN spec_slug TEXT 
  GENERATED ALWAYS AS (json_extract(metadata, '$.spec.slug')) STORED;
CREATE INDEX idx_tasks_spec_slug ON tasks(spec_slug);
```

## Y.2 TOCTOU Race Conditions (FIXED)

**Issue:** Used `fs.exists()` before reading files, creating race conditions.

**Fix:** Use try/catch pattern:
```typescript
// Before
if (!await fs.exists(tasksFile)) {
  throw new Error("tasks.md not found");
}
const tasks = await parseTasksMd(tasksFile);

// After
try {
  tasks = await parseTasksMd(tasksFile);
} catch (err) {
  if (err.code === 'ENOENT') {
    throw new Error("tasks.md not found");
  }
  throw err;
}
```

## Y.3 Parser Robustness (FIXED)

**Issue 1:** Unescaped `-` in regex character class `[<0x3e\d,\sR-]` creates range.
**Fix:** Escape dash: `[\d,\sR\-]`

**Issue 2:** Single-line outcome capture only.
**Fix:** Use block-based parsing with multiline regex `([\s\S]*?)`.

**Issue 3:** Brittle line-by-line parsing.
**Fix:** Split by task headers, parse each block independently.

## Y.4 Dependency Source of Truth (FIXED)

**Issue:** Validation read from `task.metadata.spec.dependencies` instead of junction table.

**Fix:** Query `task_dependencies` table directly:
```typescript
// Before (reads from metadata - may drift)
const taskDeps = task.metadata?.spec?.dependencies || [];

// After (queries junction table - authoritative)
const depsFromDb = await db
  .select({ taskId: task_dependencies.task_id, dependsOnId: task_dependencies.depends_on_id })
  .from(task_dependencies)
  .where(inArray(task_dependencies.task_id, taskIds));
```

## Y.5 SQLite Migration Planning (ADDED)

**Issue:** `ALTER TABLE ADD COLUMN ... REFERENCES` doesn't enforce FK in SQLite.

**Fix:** Documented migration options:
- Option 1: Table rebuild procedure (for strict FK enforcement)
- Option 2: Application-level validation (acceptable for agent memory)

## Y.6 FTS5 vs BM25 Terminology (FIXED)

**Issue:** Described "BM25 operators" - BM25 is ranking, not query syntax.

**Fix:** Clarified distinction:
- **FTS5:** Query syntax (`MATCH 'term AND phrase'`, `NEAR`, etc.)
- **BM25:** Ranking function (`ORDER BY bm25(...)`)

## Y.7 Observational Memory Integration (ADDED)

**Issue:** Context injection didn't explain how observations from previous tasks get included.

**Fix:** Updated Section 3.2 to show:
1. Observational memory from dependency tasks is injected
2. Current task gets FULL context (requirements with actual text)
3. LLM uses observations to know what keywords to search for
4. memory-search retrieves exact details on demand

This aligns with Task Memory Plan's hybrid approach (Observations + BM25).

---

## tasks.md Template

```markdown
# <Spec Name> — Implementation Plan

## Task Index
- T-001 (maps: R-001, R-002) — <title>
- T-002 (maps: R-003) — <title>

---

## T-001 — <title>
**Maps to requirements:** R-001, R-002
**Outcome (Definition of Done):** 
**Dependencies:** <none | T-000>

### Subtasks
- [ ] 

### Validation
Tests: 

### Notes

---

## T-002 — <title>
**Maps to requirements:** R-003
**Outcome:** 
**Dependencies:** T-001
```
