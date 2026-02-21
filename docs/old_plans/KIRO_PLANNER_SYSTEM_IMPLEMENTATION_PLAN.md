# Kiro Planner System - Implementation Plan v2.1

> **📋 STATUS:** Updated Feb 17, 2026 - v2.1 Restored Implementation Details
>
> **✅ COMPLETED:** Task Memory Phase 1 (see Current State section)
> **📋 TO BUILD:** Spec system (plan_enter/exit, parser, compiler, context injection)

---

## Current State (As of Feb 17, 2026)

### ✅ Already Implemented (Task Memory Phase 1 - Complete)

| Component            | File                                           | Status     |
| -------------------- | ---------------------------------------------- | ---------- |
| **task-query tool**  | `packages/core/src/memory/task/task-query.ts`  | ✅ Done    |
| **task-mutate tool** | `packages/core/src/memory/task/task-mutate.ts` | ✅ Done    |
| **memory-search**    | `packages/core/src/memory/search.ts`           | ✅ Done    |
| **TaskStorage**      | `packages/core/src/memory/task/storage.ts`     | ✅ Done    |
| **DB Schema**        | `packages/server/db/schema.ts`                 | ✅ Done    |
| **Basic Planner**    | `packages/core/src/agent/planner.ts`           | ✅ Minimal |

**Database Tables (Already Exist):**

- `tasks` - with metadata JSON column
- `task_dependencies` - junction for blocking relationships
- `task_messages` - junction for task-message linking

### ❌ Missing Components (To Be Implemented)

| Component              | Description                            | Priority |
| ---------------------- | -------------------------------------- | -------- |
| **plan_enter tool**    | Create spec, set active spec           | High     |
| **plan_exit tool**     | Validate, compile, request approval    | High     |
| **Spec helpers**       | getActiveSpec, updateSessionSpec, etc. | High     |
| **Spec templates**     | Write initial spec files               | Medium   |
| **tasks.md parser**    | Parse T-###, R-###, dependencies       | High     |
| **Spec compiler**      | tasks.md → DB tasks with metadata      | High     |
| **Spec injector**      | Context injection in agent prompts     | Medium   |
| **Full Planner Agent** | Kiro 5-phase workflow                  | Medium   |

---

## Implementation Sections (Restored from Original Plan)

### Part 1: Plan Control Tools

#### plan_enter Tool

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
    spec_slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/)
      .describe("URL-friendly slug for the spec (e.g., 'user-auth', 'api-v2')"),
    description: z.string().min(1).max(500).describe("Brief description of what to plan"),
  }),

  execute: async (params, context) => {
    const { spec_slug, description } = params;
    const instanceContext = Instance.context;

    // Validate spec slug format
    if (!/^[a-z0-9-]+$/.test(spec_slug)) {
      throw new Error("spec_slug must be lowercase alphanumeric with dashes only");
    }

    // Create spec directory structure
    const specDir = path.join(instanceContext.directory, ".kiro", "specs", spec_slug);
    await fs.mkdir(specDir, { recursive: true });

    // Create initial spec files with templates
    await writeSpecTemplate(specDir, spec_slug, description);

    // Update session/thread with active spec
    await updateSessionSpec(instanceContext.sessionID, spec_slug);

    return {
      spec_slug,
      spec_path: specDir,
      status:
        "Plan mode activated. Use explore agents to understand the codebase, then create requirements.md, design.md, and tasks.md",
    };
  },
});
```

#### plan_exit Tool

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
    summary: z.string().max(2000).describe("Brief summary of the plan for user review"),
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
    const specDir = path.join(instanceContext.directory, ".kiro", "specs", specSlug);
    const tasksFile = path.join(specDir, "tasks.md");

    let tasks;
    try {
      // Attempt to read and parse tasks.md directly
      tasks = await parseTasksMd(tasksFile);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error("tasks.md not found. Create it before exiting plan mode.");
      }
      throw err; // Re-throw other errors
    }

    if (tasks.length === 0) {
      throw new Error("No tasks found in tasks.md. Add at least one T-### task.");
    }

    // Validate all T-### have R-### mappings
    const unmapped = tasks.filter(t => !t.requirements || t.requirements.length === 0);
    if (unmapped.length > 0) {
      throw new Error(`Tasks without R-### mapping: ${unmapped.map(t => t.id).join(", ")}`);
    }

    // Validate DAG (no cycles) from PARSED tasks.md - NOT from DB (spec not compiled yet!)
    const dagValidation = validateTaskDagFromParsed(tasks);
    if (!dagValidation.valid) {
      throw new Error(
        `Task dependencies form cycles: ${dagValidation.cycles.map(c => c.join(" → ")).join(", ")}`
      );
    }

    // Ask user for approval
    const approved = await askUserApproval({
      title: "Plan Ready for Review",
      message: summary + `\n\n✅ DAG validated: no cycles\n📋 ${tasks.length} tasks ready`,
      options: [
        { label: "Approve & Build", description: "Switch to build and start implementing" },
        { label: "Keep Planning", description: "Continue refining the plan" },
      ],
    });

    if (!approved) {
      return { status: "Planning continued", message: "User chose to keep planning" };
    }

    // Switch to build mode
    await updateSessionAgent(instanceContext.sessionID, "build");

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
        : "All tasks have dependencies - no ready tasks",
    };
  },
});
```

---

### Part 2: Task Memory Tools (Already Implemented ✅)

> These are already in the codebase at the listed locations.

#### task-query Tool

**Location:** `packages/core/src/memory/task/task-query.ts`

```typescript
// Already implemented - query tool for tasks
export const taskQueryTool = tool({
  description: `Query tasks for work management.

Actions:
- ready: Find claimable tasks (not blocked, not closed)
- show: Get full details of a specific task
- list: List tasks by status
- search: Search tasks by title/description (uses FTS)`,
  // ... implementation
});
```

#### task-mutate Tool

**Location:** `packages/core/src/memory/task/task-mutate.ts`

```typescript
// Already implemented - mutate tool for tasks
export const taskMutateTool = tool({
  description: `Modify tasks, link messages, and update working memory.

Actions:
- create: Create a new task
- claim: Take ownership of a task to work on it
- close: Mark task as completed (ALWAYS provide summary)
- dep: Add/remove task dependencies
- link: Connect a message to a task
- update_context: Update working memory`,
  // ... implementation
});
```

#### memory-search Tool

**Location:** `packages/core/src/memory/search.ts`

```typescript
// Already implemented - BM25 + recency search
export const memorySearchTool = tool({
  description: `Search past conversations using BM25 + recency ranking.
  // ... implementation
});
```

---

### Part 3: Spec Helpers

Required helper functions for spec management:

```typescript
// packages/core/src/spec/helpers.ts

/**
 * Get the active spec slug for a session
 */
export async function getActiveSpec(sessionId: string): Promise<string | null> {
  // Implementation: query sessions.metadata.activeSpecSlug
}

/**
 * Update the active spec for a session (merges with existing metadata)
 */
export async function updateSessionSpec(sessionId: string, specSlug: string): Promise<void> {
  // Implementation: merge metadata, set activeSpecSlug
}

/**
 * Get task by spec slug and task ID (e.g., "user-login", "T-001")
 */
export async function getTaskBySpecAndId(specSlug: string, taskId: string): Promise<Task | null> {
  // Implementation: query by metadata.spec.slug and metadata.spec.taskId
}

/**
 * List all tasks for a spec
 */
export async function listTasksBySpec(specSlug: string): Promise<Task[]> {
  // Implementation: filter tasks by metadata.spec.slug
}

/**
 * Get tasks that are ready to work on (no unclosed blocking dependencies)
 */
export async function getReadyTasks(specSlug: string): Promise<Task[]> {
  // Implementation: filter by status=open and no open blocking deps
}
```

---

### Part 4: tasks.md Parser

```typescript
// packages/core/src/spec/parser.ts

interface ParsedTask {
  id: string; // "T-001"
  title: string;
  requirements: string[]; // ["R-001", "R-002"]
  dependencies: string[]; // ["T-002"]
  outcome: string;
  notes: string;
  subtasks: string[];
}

/**
 * Parse tasks.md file
 */
export async function parseTasksMd(tasksFilePath: string): Promise<ParsedTask[]> {
  const content = await readFile(tasksFilePath, "utf-8");

  // Split by task headers (## T-###)
  const taskBlocks = content.split(/^##\s+(T-\d+)\s*[—–-]\s+(.+)$/m);

  const tasks: ParsedTask[] = [];

  for (let i = 1; i < taskBlocks.length; i += 3) {
    const id = taskBlocks[i];
    const title = taskBlocks[i + 1]?.trim();
    const body = taskBlocks[i + 2] || "";

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
    outcome: "",
    notes: "",
    subtasks: [],
  };

  // Parse requirements - FIXED: escaped dash in character class
  const reqMatch = body.match(/\*\*Maps? to (?:requirements?|R-###):\*\*\s*([\d,\sR\-]+)/i);
  if (reqMatch) {
    task.requirements = parseIdList(reqMatch[1], "R-");
  }

  // Parse dependencies
  const depMatch = body.match(/\*\*Dependencies:\*\*\s*([\d,\sT\-]+)/i);
  if (depMatch) {
    task.dependencies = parseIdList(depMatch[1], "T-");
  }

  // Parse outcome - multiline support
  const outcomeMatch = body.match(/\*\*Outcome.*?\*\*\s*\n?([\s\S]*?)(?=\n## |\n\*\*|$)/i);
  if (outcomeMatch) {
    task.outcome = outcomeMatch[1].trim();
  }

  // Parse subtasks: - [ ] subtask
  const subtaskMatches = body.matchAll(/^-\s*\[\s*\]\s+(.+)$/gm);
  for (const match of subtaskMatches) {
    task.subtasks.push(match[1].trim());
  }

  return task;
}

function parseIdList(text: string, prefix: string): string[] {
  const regex = new RegExp(`${prefix}(\\d+)`, "g");
  const ids: string[] = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    ids.push(`${prefix}${match[1]}`);
  }

  return ids;
}

/**
 * Validate DAG from parsed tasks.md (BEFORE DB compilation)
 */
export function validateTaskDagFromParsed(tasks: ParsedTask[]): {
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

  // Compute ready tasks (no dependencies)
  const ready = tasks.filter(t => !t.dependencies || t.dependencies.length === 0).map(t => t.id);

  return {
    valid: cycles.length === 0,
    cycles,
    ready,
  };
}
```

---

### Part 5: Spec Compiler

```typescript
// packages/core/src/spec/compiler.ts

/**
 * Compile spec to Task Memory DB
 * Idempotent - safe to run multiple times
 */
export async function compileSpecToDb(
  specDir: string,
  specSlug: string
): Promise<{
  created: number;
  updated: number;
  errors: string[];
}> {
  const tasksFile = path.join(specDir, "tasks.md");
  const parsedTasks = await parseTasksMd(tasksFile);

  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  // Validate: All R-### must exist in requirements.md
  const requirementsFile = path.join(specDir, "requirements.md");
  const requirementsContent = await readFile(requirementsFile, "utf-8");
  const validRequirements = extractIds(requirementsContent, "R-");

  for (const task of parsedTasks) {
    // Validate requirements exist
    const invalidReqs = task.requirements.filter(r => !validRequirements.includes(r));
    if (invalidReqs.length > 0) {
      errors.push(`${task.id}: Invalid requirements: ${invalidReqs.join(", ")}`);
      continue;
    }

    // Validate dependencies exist
    const taskIds = parsedTasks.map(t => t.id);
    const invalidDeps = task.dependencies.filter(d => !taskIds.includes(d));
    if (invalidDeps.length > 0) {
      errors.push(`${task.id}: Invalid dependencies: ${invalidDeps.join(", ")}`);
      continue;
    }

    // Upsert task
    const existing = await getTaskBySpecAndId(specSlug, task.id);

    if (existing) {
      // Update
      await db
        .update(tasks)
        .set({
          title: task.title,
          description: task.outcome,
          metadata: {
            ...existing.metadata,
            spec: {
              slug: specSlug,
              taskId: task.id,
              requirements: task.requirements,
            },
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
        status: "open",
        priority: 3,
        type: "feature",
        metadata: {
          spec: {
            slug: specSlug,
            taskId: task.id,
            requirements: task.requirements,
          },
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
 */
export async function validateTaskDependencies(specSlug: string): Promise<{
  valid: boolean;
  cycles: string[][];
  ready: string[];
}> {
  const tasks = await listTasksBySpec(specSlug);

  // Query junction table for dependencies (authoritative source)
  const depsFromDb = await db
    .select({
      taskId: task_dependencies.task_id,
      dependsOnId: task_dependencies.depends_on_id,
      type: task_dependencies.type,
    })
    .from(task_dependencies)
    .where(
      inArray(
        task_dependencies.task_id,
        tasks.map(t => t.id)
      )
    );

  // Build adjacency list from junction table
  const deps: Map<string, string[]> = new Map();
  for (const task of tasks) {
    const taskSpecId = task.metadata.spec.taskId;
    const taskDeps = depsFromDb
      .filter(d => d.taskId === task.id && d.type === "blocks")
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

  // Compute ready tasks
  const ready: string[] = [];
  for (const task of tasks) {
    const taskSpecId = task.metadata.spec.taskId;
    const blockingDeps = deps.get(taskSpecId) || [];

    const allDepsClosed = blockingDeps.every(depSpecId => {
      const depTask = tasks.find(t => t.metadata.spec.taskId === depSpecId);
      return depTask?.status === "closed";
    });

    if (allDepsClosed && task.status === "open") {
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

### Part 6: Planner Agent (Needs Update)

**Current:** `packages/core/src/agent/planner.ts` (minimal)

**Needs:** Full Kiro instructions with 5-phase workflow

```typescript
// packages/core/src/agent/planner.ts (UPDATE THIS)

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

## What You CANNOT Do
- Edit code files (only spec files in .kiro/specs/)
- Run implementation commands
- Claim tasks - that's the executor's job

---

${OPENCODE_PHASE_PROMPT}
`;
```

---

### Part 7: Spec Context Injection

```typescript
// packages/core/src/agent/spec-injector.ts

/**
 * Injects spec context with observational memory integration
 * CRITICAL: Injects AFTER observational memory chain (continuation hint is user message)
 */
export async function injectSpecContext(
  messages: Message[],
  sessionId: string
): Promise<Message[]> {
  // Get active spec and current task
  const activeSpec = await getActiveSpec(sessionId);
  const currentTaskId = await getCurrentTask(sessionId);

  if (!activeSpec) {
    return messages; // No spec, no injection
  }

  // Build spec context content
  let specContext = "";

  // Current Task Context (FULL - deterministic)
  if (currentTaskId) {
    const task = await getTaskBySpecAndId(activeSpec, currentTaskId);
    if (task) {
      specContext += `## Current Task: ${task.metadata.spec.taskId}\n`;
      specContext += `**Title:** ${task.title}\n`;

      // Include full requirement text (not just IDs)
      if (task.metadata.spec.requirements?.length > 0) {
        specContext += `**Requirements:**\n`;
        for (const reqId of task.metadata.spec.requirements) {
          const reqText = await getRequirementText(activeSpec, reqId);
          specContext += `- ${reqId}: ${reqText}\n`;
        }
        specContext += `\n`;
      }

      if (task.description) {
        specContext += `**Outcome:** ${task.description}\n\n`;
      }

      // Task index (what else exists in the spec)
      const taskIndex = await listTasksBySpec(activeSpec);
      if (taskIndex.length > 0) {
        specContext += `**Spec Task Index:**\n`;
        for (const t of taskIndex) {
          const status = t.status === "closed" ? "✓" : t.status === "in_progress" ? "→" : "○";
          specContext += `${status} ${t.metadata.spec.taskId}: ${t.title}\n`;
        }
        specContext += `\n`;
      }
    }
  }

  // Add memory search hint
  specContext += `**Memory Search:** Use memory-search tool to retrieve exact details from previous work.\n`;

  // Inject as system message AFTER observational memory chain
  const specMessage: Message = {
    role: "system",
    content: specContext,
    metadata: { type: "spec-context", specSlug: activeSpec },
  };

  // Find position after base system prompt and continuation hint (if present)
  const continuationHintIndex = messages.findIndex(
    m => m.role === "user" && m.metadata?.type === "memory-continuation"
  );

  if (continuationHintIndex >= 0) {
    messages.splice(continuationHintIndex + 1, 0, specMessage);
  } else {
    const baseSystemIndex = messages.findIndex(m => m.role === "system");
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
 */
async function getRequirementText(specSlug: string, reqId: string): Promise<string> {
  const specDir = path.join(getWorkspaceDir(), ".kiro", "specs", specSlug);
  const reqFile = path.join(specDir, "requirements.md");

  try {
    const content = await readFile(reqFile, "utf-8");
    const reqMatch = content.match(
      new RegExp(`- ${reqId}\\s*\\n?\\s*WHEN.*?THE SYSTEM SHALL.*?(?=\\n- R-|$)`, "is")
    );
    return reqMatch ? reqMatch[0].replace(/\n/g, " ").trim() : reqId;
  } catch {
    return reqId;
  }
}
```

---

### Part 8: File Structure

```
packages/core/
├── src/
│   ├── agent/
│   │   ├── planner.ts              # UPDATE: Full Kiro instructions
│   │   ├── registry.ts             # Add planner to registry
│   │   └── spec-injector.ts        # NEW: Spec context injection
│   │
│   ├── tools/
│   │   ├── plan.ts                 # NEW: plan_enter, plan_exit
│   │   ├── task-query.ts           # EXISTS ✅
│   │   ├── task-mutate.ts          # EXISTS ✅
│   │   ├── memory-search.ts        # EXISTS ✅
│   │   └── registry.ts             # Add plan tools
│   │
│   ├── spec/
│   │   ├── compiler.ts             # NEW: tasks.md → DB
│   │   ├── parser.ts               # NEW: Parse spec files
│   │   ├── templates.ts            # NEW: Spec file templates
│   │   ├── helpers.ts              # NEW: Session spec helpers
│   │   └── validator.ts            # NEW: Validate spec integrity
│   │
│   └── memory/task/
│       ├── storage.ts               # EXISTS ✅
│       ├── task-query.ts           # EXISTS ✅
│       └── task-mutate.ts          # EXISTS ✅

.kiro/specs/<slug>/                 # NEW: Runtime spec directory
├── requirements.md                   # R-### acceptance criteria
├── design.md                        # Architecture decisions
├── tasks.md                        # T-### implementation tasks
└── correctness.md                   # P-### properties (optional)
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1)

**Status:** ⚠️ Partially Complete - Task Memory exists, need spec system

1. **Spec Helpers** (`packages/core/src/spec/helpers.ts`)
   - `getActiveSpec(sessionId)` - get current spec from session metadata
   - `updateSessionSpec(sessionId, specSlug)` - set active spec
   - `getTaskBySpecAndId(specSlug, taskId)` - find task by T-###
   - `listTasksBySpec(specSlug)` - all tasks for a spec

2. **Spec Templates** (`packages/core/src/spec/templates.ts`)
   - `writeSpecTemplate(specDir, slug, description)` - create initial files
   - Templates for requirements.md, design.md, tasks.md, correctness.md

### Phase 2: Parser & Compiler (Week 2)

1. **Parser** (`packages/core/src/spec/parser.ts`)
   - `parseTasksMd(filePath)` → `ParsedTask[]`
   - Extract: T-###, title, requirements (R-###), dependencies (T-###), outcome

2. **Compiler** (`packages/core/src/spec/compiler.ts`)
   - `compileSpecToDb(specDir, specSlug)` - idempotent compilation
   - Validate: all R-### exist in requirements.md
   - Validate: all dependencies reference valid T-###
   - Upsert tasks with spec metadata

3. **DAG Validation** (`packages/core/src/spec/validator.ts`)
   - `validateTaskDagFromParsed(tasks)` - detect cycles before compilation
   - DFS-based cycle detection

### Phase 3: Plan Tools (Week 3)

1. **plan_enter Tool** (`packages/core/src/tools/plan.ts`)
   - Create `.kiro/specs/<slug>/` directory
   - Write template files
   - Set `activeSpecSlug` in session metadata

2. **plan_exit Tool** (`packages/core/src/tools/plan.ts`)
   - Validate tasks.md exists
   - Validate all T-### have R-### mappings
   - Validate DAG (no cycles)
   - Request user approval
   - On approval: compile tasks to DB

### Phase 4: Context Injection (Week 4)

1. **Spec Injector** (`packages/core/src/agent/spec-injector.ts`)
   - `injectSpecContext(messages, sessionId)` - adds spec context
   - Query closed dependency tasks for "Previous Work"
   - Include current task requirements (full text)
   - Show task index (✓ completed, → in progress, ○ pending)

### Phase 5: Planner Agent Hardening (Week 5)

1. **Update Planner Agent** (`packages/core/src/agent/planner.ts`)
   - Replace minimal instructions with full Kiro prompt
   - Include 5-phase workflow
   - Hard gates (Gate A-D) for phase progression

---

## Acceptance Criteria

### ✅ Already Complete (Task Memory Phase 1)

- [x] task-query can list/filter tasks
- [x] task-mutate claim sets status to in_progress
- [x] task-mutate close requires summary
- [x] Dependencies enforced (can't claim blocked task)
- [x] memory-search works across messages

### 📋 To Be Implemented

#### Spec System

- [ ] plan_enter creates `.kiro/specs/<slug>/` with templates
- [ ] plan_exit validates tasks.md before allowing exit
- [ ] DAG validation runs on parsed tasks.md (not DB)
- [ ] Spec compiler creates DB tasks with metadata.spec.\*
- [ ] Tasks have T-### IDs in metadata
- [ ] Requirements have R-### IDs in requirements.md

#### Context Injection

- [ ] Message array order: base → observational memory → continuation hint → spec context → conversation
- [ ] Spec context injected after memory chain
- [ ] Current task requirements (full text) included
- [ ] Task index visible (✓ → ○ status indicators)

#### Planner Agent

- [ ] Full Kiro 5-phase workflow instructions
- [ ] Hard gates enforced (Gate A-D)
- [ ] plan_exit integration

---

## Integration Points

### With Existing Task Memory

| Component     | Task Memory (Exists)    | Spec Addition                 |
| ------------- | ----------------------- | ----------------------------- |
| Task ID       | UUIDv7 (primary key)    | T-### in metadata.spec.taskId |
| Task query    | By UUID                 | Add by spec_slug filter       |
| Dependencies  | Junction table          | Same table, spec validates    |
| Status        | open/in_progress/closed | Same                          |
| Close summary | String                  | Structured object option      |

---

**Document Version:** 2.1 (Updated Feb 17, 2026)  
**Original Plan:** KIRO_PLANNER_SYSTEM_IMPLEMENTATION_PLAN.md v1.0  
**Prerequisite Status:** Task Memory Phase 1 ✅ Complete
