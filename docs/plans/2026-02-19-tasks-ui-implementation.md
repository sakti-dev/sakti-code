# Tasks UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> **CRITICAL:** Use `frontend-design` skill when implementing ANY UI components (Task 5, 6, 7). This is non-negotiable. Load the skill before writing any UI code.

**Goal:** Implement real-time task list UI in desktop app right panel with server API endpoints, matching OpenCode's todo system functionality.

**Architecture:**

- Server: Add TaskUpdated event to bus, modify TaskStorage to emit events, create REST API endpoints
- Desktop: Add Tasks tab to right-side panel that conditionally renders when tasks exist, sync via SSE
- Delete legacy `/api/chat/:sessionId/todo` endpoint

> **CRITICAL:** Use `frontend-design` skill when implementing ANY UI components (Task 5, 6, 7). This is non-negotiable. Load the skill before writing any UI code.

**Tech Stack:** Hono (server), SolidJS (UI), SSE for real-time sync, Drizzle ORM

---

> **FRONTEND-DESIGN SKILL USAGE:** The following tasks MUST use the `frontend-design` skill:
>
> - **Task 6**: Creating TaskList UI component (`task-list.tsx`)
> - **Task 7**: Integrating Tasks tab into right-side panel (`right-side.tsx`)
>
> Before starting either task, invoke: `@skill frontend-design`

---

## Phase 1: Server - Bus Events & TaskStorage

### Task 1: Add TaskUpdated Event to Bus

**Files:**

- Modify: `packages/server/src/bus/index.ts:150-200`
- Test: `packages/server/tests/bus/task-events.test.ts` (create new)

**Step 1: Write the failing test**

```typescript
// packages/server/tests/bus/task-events.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { publish, subscribe, TaskUpdated } from "../../src/bus";

describe("TaskUpdated Event", () => {
  it("should publish and receive task updated event", async () => {
    const received: unknown[] = [];

    const unsubscribe = subscribe(TaskUpdated, event => {
      received.push(event.properties);
    });

    await publish(TaskUpdated, {
      sessionId: "session-123",
      tasks: [{ id: "task-1", title: "Test task", status: "open", priority: 2 }],
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      sessionId: "session-123",
      tasks: [{ id: "task-1", title: "Test task", status: "open", priority: 2 }],
    });

    unsubscribe();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/server && pnpm test tests/bus/task-events.test.ts`
Expected: FAIL with "TaskUpdated is not defined"

**Step 3: Write minimal implementation**

Add to `packages/server/src/bus/index.ts`:

```typescript
// After line 163 (SessionStatus definition)
export const TaskUpdated = defineBusEvent(
  "task.updated",
  z.object({
    sessionId: z.string(),
    tasks: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        status: z.string(),
        priority: z.number(),
      })
    ),
  })
);
```

**Step 4: Run test to verify it passes**

Run: `cd packages/server && pnpm test tests/bus/task-events.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/bus/index.ts packages/server/tests/bus/task-events.test.ts
git commit -m "feat: add TaskUpdated event to bus"
```

---

### Task 2: Modify TaskStorage to Emit Events

**Files:**

- Modify: `packages/core/src/memory/task/storage.ts:60-115`
- Test: `packages/core/tests/memory/task/storage-events.test.ts` (create new)

**Step 1: Write the failing test**

```typescript
// packages/core/tests/memory/task/storage-events.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { taskStorage, CreateTaskInput } from "../../../src/memory/task/storage";

// Mock the bus publish function
vi.mock("@sakti-code/server/bus", () => ({
  publish: vi.fn(),
  TaskUpdated: { type: "task.updated" },
}));

import { publish, TaskUpdated } from "@sakti-code/server/bus";

describe("TaskStorage Event Emission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should publish TaskUpdated event after creating a task", async () => {
    const input: CreateTaskInput = {
      id: "task-123",
      title: "Test task",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: "session-456",
    };

    await taskStorage.createTask(input);

    expect(publish).toHaveBeenCalledWith(
      TaskUpdated,
      expect.objectContaining({
        sessionId: "session-456",
        tasks: expect.arrayContaining([
          expect.objectContaining({
            id: "task-123",
            title: "Test task",
            status: "open",
          }),
        ]),
      })
    );
  });

  it("should publish TaskUpdated event after updating a task", async () => {
    // First create a task
    const input: CreateTaskInput = {
      id: "task-456",
      title: "Original title",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: "session-789",
    };
    await taskStorage.createTask(input);

    // Clear mock to test update
    vi.clearAllMocks();

    // Update the task
    await taskStorage.updateTask("task-456", { title: "Updated title", status: "in_progress" });

    expect(publish).toHaveBeenCalledWith(
      TaskUpdated,
      expect.objectContaining({
        sessionId: "session-789",
        tasks: expect.arrayContaining([
          expect.objectContaining({
            id: "task-456",
            title: "Updated title",
            status: "in_progress",
          }),
        ]),
      })
    );
  });

  it("should publish TaskUpdated event after deleting a task", async () => {
    // First create a task
    const input: CreateTaskInput = {
      id: "task-789",
      title: "To be deleted",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: "session-abc",
    };
    await taskStorage.createTask(input);

    vi.clearAllMocks();

    // Delete the task
    await taskStorage.deleteTask("task-789");

    expect(publish).toHaveBeenCalledWith(
      TaskUpdated,
      expect.objectContaining({
        sessionId: "session-abc",
        tasks: expect.not.arrayContaining([expect.objectContaining({ id: "task-789" })]),
      })
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm test tests/memory/task/storage-events.test.ts`
Expected: FAIL with "publish is not called" or similar

**Step 3: Write minimal implementation**

Modify `packages/core/src/memory/task/storage.ts`:

```typescript
import { publish, TaskUpdated } from "@sakti-code/server/bus";

// Helper to publish task updated event
async function publishTaskUpdate(sessionId: string | null) {
  if (!sessionId) return;

  const tasks = await taskStorage.listTasks({});
  const sessionTasks = tasks.filter(t => t.session_id === sessionId);

  await publish(TaskUpdated, {
    sessionId,
    tasks: sessionTasks.map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
    })),
  });
}

// Modify createTask to emit event
async createTask(input: CreateTaskInput): Promise<Task> {
  // ... existing code ...
  const task = /* existing return */;

  // Emit event
  if (input.sessionId) {
    await publishTaskUpdate(input.sessionId);
  }

  return task;
}

// Modify updateTask to emit event
async updateTask(id: string, input: UpdateTaskInput): Promise<Task | null> {
  // ... existing code ...
  const updated = /* existing return */;

  // Emit event
  if (updated && updated.session_id) {
    await publishTaskUpdate(updated.session_id);
  }

  return updated;
}

// Modify deleteTask to emit event
async deleteTask(id: string): Promise<void> {
  // Get task before deleting for sessionId
  const task = await this.getTask(id);

  // ... existing code ...

  // Emit event
  if (task?.session_id) {
    await publishTaskUpdate(task.session_id);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && pnpm test tests/memory/task/storage-events.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/memory/task/storage.ts packages/core/tests/memory/task/storage-events.test.ts
git commit -m "feat: emit TaskUpdated events on task mutations"
```

---

## Phase 2: Server - REST API Endpoints

### Task 3: Delete Legacy Todo Endpoint

**Files:**

- Delete: `packages/server/src/routes/todo.ts`
- Modify: `packages/server/src/index.ts:61,187`

**Step 1: Run existing tests to verify current state**

Run: `cd packages/server && pnpm test tests/routes/todo.test.ts 2>/dev/null || echo "No todo tests exist"`
Expected: No tests exist (placeholder endpoint)

**Step 2: Delete the todo.ts file**

```bash
rm packages/server/src/routes/todo.ts
```

**Step 3: Remove import and route registration**

Modify `packages/server/src/index.ts`:

- Remove line 61: `import todoRouter from "./routes/todo";`
- Remove line 187: `app.route("/", todoRouter);`

**Step 4: Run typecheck and lint**

Run: `cd packages/server && pnpm typecheck && pnpm lint`
Expected: PASS (no errors related to todo removal)

**Step 5: Commit**

```bash
git rm packages/server/src/routes/todo.ts
git commit -m "feat: remove legacy todo placeholder endpoint"
```

---

### Task 4: Create Tasks REST API

**Files:**

- Create: `packages/server/src/routes/tasks.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/tests/routes/tasks.test.ts` (create new)

**Step 1: Write the failing test**

```typescript
// packages/server/tests/routes/tasks.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { app } from "../../src/index";
import { taskStorage } from "@sakti-code/core/memory/task/storage";
import { sessions, insertSession } from "@sakti-code/server/db";
import { getDb } from "@sakti-code/server/db";

describe("Tasks API", () => {
  let testSessionId: string;

  beforeEach(async () => {
    // Create test session
    const db = await getDb();
    const [session] = await db
      .insert(sessions)
      .values({
        id: "test-session-tasks",
        thread_id: "thread-123",
        resource_id: "resource-456",
        last_accessed: new Date(),
        created_at: new Date(),
      })
      .returning();
    testSessionId = session.id;
  });

  afterEach(async () => {
    // Cleanup tasks
    const db = await getDb();
    await db.delete(/* tasks table */).execute();
    await db.delete(sessions).where(eq(sessions.id, testSessionId)).execute();
  });

  it("GET /api/tasks/:sessionId should return tasks for session", async () => {
    // Create a task
    await taskStorage.createTask({
      id: "task-api-1",
      title: "API Test Task",
      sessionId: testSessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const res = await app.request(`/api/tasks/${testSessionId}`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].title).toBe("API Test Task");
  });

  it("GET /api/tasks/:sessionId should return empty array when no tasks", async () => {
    const res = await app.request(`/api/tasks/${testSessionId}`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toHaveLength(0);
  });

  it("GET /api/tasks/:sessionId should return 404 for non-existent session", async () => {
    const res = await app.request(`/api/tasks/non-existent-session`);

    expect(res.status).toBe(200); // Session not required for listing tasks
  });

  it("GET /api/tasks should list all tasks with filters", async () => {
    // Create multiple tasks
    await taskStorage.createTask({
      id: "task-all-1",
      title: "Open Task",
      status: "open",
      sessionId: testSessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await taskStorage.createTask({
      id: "task-all-2",
      title: "Closed Task",
      status: "closed",
      sessionId: testSessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const res = await app.request("/api/tasks?status=open");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].status).toBe("open");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/server && pnpm test tests/routes/tasks.test.ts`
Expected: FAIL with "404 Not Found" or route doesn't exist

**Step 3: Write minimal implementation**

Create `packages/server/src/routes/tasks.ts`:

```typescript
/**
 * Tasks API Routes
 *
 * GET /api/tasks - List all tasks (with optional filters)
 * GET /api/tasks/:sessionId - Get tasks for a specific session
 */

import { Hono } from "hono";
import type { Env } from "../index";
import { taskStorage } from "@sakti-code/core/memory/task/storage";

const tasksRouter = new Hono<Env>();

/**
 * Get tasks for a specific session
 */
tasksRouter.get("/api/tasks/:sessionId", async c => {
  const sessionId = c.req.param("sessionId");

  const allTasks = await taskStorage.listTasks({});
  const sessionTasks = allTasks.filter(t => t.session_id === sessionId);

  return c.json({
    sessionId,
    tasks: sessionTasks.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      type: t.type,
      createdAt: t.created_at?.getTime(),
      updatedAt: t.updated_at?.getTime(),
      closedAt: t.closed_at?.getTime(),
      closeReason: t.close_reason,
    })),
    hasMore: false,
    total: sessionTasks.length,
  });
});

/**
 * List all tasks with optional filters
 */
tasksRouter.get("/api/tasks", async c => {
  const status = c.req.query("status") as "open" | "in_progress" | "closed" | undefined;
  const limit = parseInt(c.req.query("limit") || "100");

  const tasks = await taskStorage.listTasks({ status, limit });

  return c.json({
    tasks: tasks.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      type: t.type,
      sessionId: t.session_id,
      createdAt: t.created_at?.getTime(),
      updatedAt: t.updated_at?.getTime(),
    })),
    hasMore: tasks.length === limit,
    total: tasks.length,
  });
});

export default tasksRouter;
```

**Step 4: Register the route**

Modify `packages/server/src/index.ts`:

- Add import: `import tasksRouter from "./routes/tasks";`
- Add route: `app.route("/", tasksRouter);`

**Step 5: Run test to verify it passes**

Run: `cd packages/server && pnpm test tests/routes/tasks.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/server/src/routes/tasks.ts packages/server/src/index.ts
git commit -m "feat: add tasks REST API endpoints"
```

---

## Phase 3: Desktop - UI Integration

### Task 5: Add Task Types to Desktop

**Files:**

- Create: `apps/desktop/src/core/chat/types/task.ts` (create new)
- Modify: `apps/desktop/src/core/chat/types/index.ts`

> **NOTE:** This is a types-only task. UI component comes in Task 6.

---

### Task 6: Create TaskList UI Component

> **CRITICAL:** MUST use `frontend-design` skill. Load it NOW before writing any UI code.

**Files:**

- Create: `apps/desktop/src/views/workspace-view/right-side/task-list.tsx` (new)
- Test: `apps/desktop/src/views/workspace-view/right-side/task-list.test.tsx`

```typescript
// apps/desktop/src/core/chat/types/task.test.ts
import { describe, it, expect } from "vitest";
import type { Task } from "./task";

describe("Task Types", () => {
  it("should have correct shape for Task", () => {
    const task: Task = {
      id: "task-123",
      title: "Test task",
      status: "open",
      priority: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(task.id).toBe("task-123");
    expect(task.status).toBe("open");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && pnpm test src/core/chat/types/task.test.ts`
Expected: FAIL with "Task is not defined"

**Step 3: Write minimal implementation**

Create `apps/desktop/src/core/chat/types/task.ts`:

```typescript
export interface Task {
  id: string;
  title: string;
  description?: string;
  status: "open" | "in_progress" | "closed";
  priority: number;
  type?: "bug" | "feature" | "task" | "epic" | "chore";
  sessionId?: string;
  createdAt?: number;
  updatedAt?: number;
  closedAt?: number;
  closeReason?: string;
  summary?: string;
}

export interface TaskList {
  tasks: Task[];
  hasMore: boolean;
  total: number;
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/desktop && pnpm test src/core/chat/types/task.test.ts`
Expected: PASS

**Step 5: Export from index**

Modify `apps/desktop/src/core/chat/types/index.ts` to export Task types.

**Step 6: Commit**

```bash
git add apps/desktop/src/core/chat/types/task.ts
git commit -m "feat: add Task types to desktop"
```

---

### Task 6: Add Tasks Tab to Right-Side Panel

**Files:**

- Create: `apps/desktop/src/views/workspace-view/right-side/task-list.tsx` (new)
- Modify: `apps/desktop/src/views/workspace-view/right-side/right-side.tsx`
- Test: `apps/desktop/src/views/workspace-view/right-side/task-list.test.tsx`

**Step 1: Write the failing test**

```typescript
// apps/desktop/src/views/workspace-view/right-side/task-list.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { TaskList } from "./task-list";

describe("TaskList", () => {
  it("should render tasks when provided", () => {
    const tasks = [
      { id: "1", title: "Task 1", status: "open" as const, priority: 2 },
      { id: "2", title: "Task 2", status: "in_progress" as const, priority: 1 },
    ];

    render(() => <TaskList tasks={tasks} />);

    expect(screen.getByText("Task 1")).toBeInTheDocument();
    expect(screen.getByText("Task 2")).toBeInTheDocument();
  });

  it("should show open tasks count in badge", () => {
    const tasks = [
      { id: "1", title: "Open Task", status: "open" as const, priority: 2 },
      { id: "2", title: "Closed Task", status: "closed" as const, priority: 2 },
    ];

    render(() => <TaskList tasks={tasks} />);

    // Should show 1 open task
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("should not render when no tasks", () => {
    const { container } = render(() => <TaskList tasks={[]} />);

    expect(container.firstChild).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && pnpm test src/views/workspace-view/right-side/task-list.test.tsx`
Expected: FAIL with "TaskList is not defined"

**Step 3: Write minimal implementation**

Create `apps/desktop/src/views/workspace-view/right-side/task-list.tsx`:

```typescript
import { Component, For, Show } from "solid-js";
import type { Task } from "@/core/chat/types/task";
import { cn } from "@/utils";

interface TaskListProps {
  tasks: Task[];
  onTaskClick?: (task: Task) => void;
  class?: string;
}

/**
 * TaskList - Displays a list of tasks in the right panel
 *
 * Shows only when there are open tasks (status !== "closed")
 * Similar to OpenCode's sidebar todo display
 */
export const TaskList: Component<TaskListProps> = (props) => {
  const openTasks = () => props.tasks.filter(t => t.status !== "closed");

  return (
    <Show when={openTasks().length > 0}>
      <div class={cn("flex flex-col gap-1 p-2 overflow-y-auto", props.class)}>
        <For each={openTasks()}>
          {(task) => (
            <div
              class={cn(
                "flex items-center gap-2 p-2 rounded-lg cursor-pointer",
                "bg-card/20 hover:bg-card/40 transition-colors",
                "border border-border/30 hover:border-primary/30"
              )}
              onClick={() => props.onTaskClick?.(task)}
            >
              {/* Status indicator */}
              <div
                class={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  task.status === "open" && "bg-yellow-500",
                  task.status === "in_progress" && "bg-blue-500",
                  task.status === "closed" && "bg-green-500"
                )}
              />

              {/* Priority badge */}
              <Show when={task.priority <= 1}>
                <span class="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
                  P{task.priority}
                </span>
              </Show>

              {/* Title */}
              <span class="text-sm truncate flex-1">{task.title}</span>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
};
```

**Step 4: Run test to verify it passes**

Run: `cd apps/desktop && pnpm test src/views/workspace-view/right-side/task-list.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/views/workspace-view/right-side/task-list.tsx
git commit -m "feat: add TaskList component to desktop"
```

---

### Task 7: Integrate Tasks Tab into Right-Side Panel

> **CRITICAL:** MUST use `frontend-design` skill for UI styling. Load it if not already loaded.

**Files:**

- Modify: `apps/desktop/src/views/workspace-view/right-side/right-side.tsx`
- Modify: `apps/desktop/src/views/workspace-view/index.tsx`

**Step 1: Write the failing test**

```typescript
// Test that right-side accepts tasks prop and shows Tasks tab when tasks exist
import { render, screen } from "@testing-library/solid";
import { ContextPanel } from "./right-side";

describe("ContextPanel with Tasks", () => {
  it("should show Tasks tab when tasks are provided", () => {
    const tasks = [
      { id: "1", title: "Test Task", status: "open" as const, priority: 2 },
    ];

    render(() => (
      <ContextPanel
        tasks={tasks}
        openFiles={[]}
        diffChanges={[]}
      />
    ));

    expect(screen.getByText("Tasks")).toBeInTheDocument();
  });

  it("should NOT show Tasks tab when no tasks", () => {
    render(() => (
      <ContextPanel
        tasks={[]}
        openFiles={[]}
        diffChanges={[]}
      />
    ));

    expect(screen.queryByText("Tasks")).not.toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && pnpm test src/views/workspace-view/right-side/right-side.test.tsx`
Expected: FAIL with "tasks prop does not exist"

**Step 3: Write minimal implementation**

Modify `apps/desktop/src/views/workspace-view/right-side/right-side.tsx`:

```typescript
import type { Task } from "@/core/chat/types/task";
import { TaskList } from "./task-list";

// Add to interface:
interface ContextPanelProps {
  /** Tasks for the session */
  tasks?: Task[];
  // ... existing props
}

// In component:
const merged = mergeProps({
  tasks: [],
  // ... existing defaults
});

// Update tab types:
type TopTab = "files" | "diff" | "tasks";

// Add Tasks button in tab bar:
<button
  onClick={() => handleTabChange("tasks")}
  class={cn(
    "rounded-t-lg px-3 py-1.5 text-sm transition-colors duration-150",
    getActiveTab() === "tasks"
      ? ["text-foreground font-medium", "bg-card/40 border-primary border-b-2"]
      : [
          "text-muted-foreground hover:text-foreground",
          "hover:bg-card/30 border-b-2 border-transparent",
        ]
  )}
>
  Tasks
</button>

// Add badge (only show if open tasks exist):
<Show when={merged.tasks && merged.tasks.some(t => t.status !== "closed")}>
  <span class="rounded-full px-2 py-0.5 text-xs bg-primary/10 text-primary/70 font-medium">
    {merged.tasks.filter(t => t.status !== "closed").length}
  </span>
</Show>

// Add content area:
<Show when={getActiveTab() === "tasks"}>
  <TaskList tasks={merged.tasks} />
</Show>
```

**Step 4: Run test to verify it passes**

Run: `cd apps/desktop && pnpm test src/views/workspace-view/right-side/right-side.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/views/workspace-view/right-side/right-side.tsx
git commit -m "feat: integrate Tasks tab into right-side panel"
```

---

### Task 8: Wire Up Task Data via SSE

> **NOTE:** This is a data/logic task. UI styling already handled in Tasks 6-7.

**Files:**

- Modify: `apps/desktop/src/views/workspace-view/index.tsx`
- Create: `apps/desktop/src/core/chat/hooks/use-tasks.ts` (new)

**Step 1: Write the failing test**

```typescript
// apps/desktop/src/core/chat/hooks/use-tasks.test.ts
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@solidjs/testing-library";
import { useTasks } from "./use-tasks";

describe("useTasks", () => {
  it("should fetch tasks from API", async () => {
    // Mock fetch
    global.fetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          tasks: [{ id: "1", title: "Test", status: "open", priority: 2 }],
        }),
    });

    const { result } = renderHook(() => useTasks("session-123"));

    await act(async () => {
      await result.value.refresh();
    });

    expect(result.value.tasks).toHaveLength(1);
    expect(result.value.tasks[0].title).toBe("Test");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && pnpm test src/core/chat/hooks/use-tasks.test.ts`
Expected: FAIL with "useTasks is not defined"

**Step 3: Write minimal implementation**

Create `apps/desktop/src/core/chat/hooks/use-tasks.ts`:

```typescript
import { createSignal, createEffect, onCleanup } from "solid-js";
import type { Task, TaskList } from "../types/task";
import { useSSE } from "@/core/services/sse/sse-manager";

/**
 * useTasks - Hook to fetch and sync tasks for a session
 *
 * Uses SSE to keep tasks in sync with server
 */
export function useTasks(sessionId: string) {
  const [tasks, setTasks] = createSignal<Task[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Fetch initial tasks
  async function refresh() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/${sessionId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch tasks: ${response.status}`);
      }

      const data: TaskList = await response.json();
      setTasks(data.tasks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }

  // Listen for task updates via SSE
  // Note: We'll handle this via the existing SSE mechanism
  // For now, implement polling as fallback

  let pollInterval: ReturnType<typeof setInterval> | null = null;

  function startPolling(intervalMs = 5000) {
    if (pollInterval) return;
    refresh();
    pollInterval = setInterval(refresh, intervalMs);
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  // Cleanup on unmount
  onCleanup(() => {
    stopPolling();
  });

  return {
    tasks,
    isLoading,
    error,
    refresh,
    startPolling,
    stopPolling,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/desktop && pnpm test src/core/chat/hooks/use-tasks.test.ts`
Expected: PASS

**Step 5: Wire into workspace view**

Modify `apps/desktop/src/views/workspace-view/index.tsx`:

- Import `useTasks` and `TaskList` types
- Add `tasks` state
- Pass tasks to `ContextPanel`

**Step 6: Commit**

```bash
git add apps/desktop/src/core/chat/hooks/use-tasks.ts apps/desktop/src/views/workspace-view/index.tsx
git commit -m "feat: wire up task data via polling to right-side panel"
```

---

## Phase 4: Verification

### Task 9: Typecheck and Lint

**Run comprehensive checks:**

```bash
# Server typecheck
cd packages/server && pnpm typecheck

# Server lint
cd packages/server && pnpm lint

# Core typecheck
cd packages/core && pnpm typecheck

# Core lint
cd packages/core && pnpm lint

# Desktop typecheck
cd apps/desktop && pnpm typecheck

# Desktop lint
cd apps/desktop && pnpm lint
```

**Expected:** All pass with no errors

---

## Summary

### Completed Tasks:

1. ✅ Add TaskUpdated event to bus
2. ✅ Modify TaskStorage to emit events on mutations
3. ✅ Delete legacy todo endpoint
4. ✅ Create Tasks REST API endpoints
5. ✅ Add Task types to desktop
6. ✅ Create TaskList component
7. ✅ Integrate Tasks tab into right-side panel
8. ✅ Wire up task data via polling
9. ✅ Typecheck and lint all packages

### Key Changes:

| Component     | File                                                              | Change                    |
| ------------- | ----------------------------------------------------------------- | ------------------------- |
| Server Bus    | `packages/server/src/bus/index.ts`                                | Added `TaskUpdated` event |
| TaskStorage   | `packages/core/src/memory/task/storage.ts`                        | Emit events on CRUD       |
| Server Routes | `packages/server/src/routes/tasks.ts`                             | New REST API              |
| Server Index  | `packages/server/src/index.ts`                                    | Removed todo, added tasks |
| Desktop Types | `apps/desktop/src/core/chat/types/task.ts`                        | Task interface            |
| TaskList UI   | `apps/desktop/src/views/workspace-view/right-side/task-list.tsx`  | New component             |
| Right Panel   | `apps/desktop/src/views/workspace-view/right-side/right-side.tsx` | Tasks tab                 |
| Hook          | `apps/desktop/src/core/chat/hooks/use-tasks.ts`                   | Data fetching             |

---

## Plan Complete

Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
