# Task-First Workflow Documentation

## Overview

The task-first workflow replaces the traditional session-first workspace UX with a homepage-driven approach that supports research, spec selection, and parallel task session execution.

**Key Architectural Shifts:**

- **Server:** Migrated from `sessions` table to `task_sessions` table with workflow-aware fields
- **Desktop:** Split UI into Homepage (task creation/progress) and Task Session views (3-panel chat)
- **Integration:** Hard-cut migration - no temporary compatibility layers
- **Behavior Control:** Single source of truth: `runtimeMode` (`intake` | `plan` | `build`)

---

## Database Schema

### task_sessions Table

```sql
-- Renamed from sessions table
CREATE TABLE task_sessions (
  session_id TEXT PRIMARY KEY,
  resource_id TEXT,
  thread_id TEXT,
  parent_id TEXT,
  workspace_id TEXT,
  title TEXT,
  summary TEXT,
  share_url TEXT,
  created_at INTEGER,
  last_accessed INTEGER,  -- Kept for migration compatibility
  status TEXT NOT NULL DEFAULT 'researching',  -- researching | specifying | implementing | completed | failed
  spec_type TEXT,  -- comprehensive | quick | null
  session_kind TEXT NOT NULL DEFAULT 'task',  -- intake | task
  last_activity_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
```

### project_keypoints Table

```sql
CREATE TABLE project_keypoints (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_session_id TEXT NOT NULL,
  task_title TEXT NOT NULL,
  milestone TEXT NOT NULL,  -- started | completed
  completed_at INTEGER,
  summary TEXT,
  artifacts TEXT,  -- JSON array
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (task_session_id) REFERENCES task_sessions(session_id) ON DELETE CASCADE
);
```

---

## API Contract

### Task Session Endpoints

| Method | Path                                | Description                                               |
| ------ | ----------------------------------- | --------------------------------------------------------- |
| GET    | `/api/task-sessions`                | List task sessions (filter by `workspaceId`, `kind`)      |
| GET    | `/api/task-sessions/latest`         | Get latest task session (filter by `workspaceId`, `kind`) |
| GET    | `/api/task-sessions/:taskSessionId` | Get specific task session                                 |
| POST   | `/api/task-sessions`                | Create new task session                                   |
| PATCH  | `/api/task-sessions/:taskSessionId` | Update task session fields                                |
| DELETE | `/api/task-sessions/:taskSessionId` | Delete task session                                       |

### Keypoints Endpoints

| Method | Path                     | Description                              |
| ------ | ------------------------ | ---------------------------------------- |
| GET    | `/api/project-keypoints` | List keypoints (filter by `workspaceId`) |
| POST   | `/api/project-keypoints` | Create new keypoint                      |

### Header Requirements

**Critical:** All requests to session-bridged routes (chat, workspace, project) must include:

```
X-Task-Session-ID: <task-session-id>
```

The `session-bridge` middleware automatically creates task sessions if the header is missing, but explicit headers are recommended for clarity.

---

## Runtime Mode System

### Canonical Runtime Modes

| Mode     | Purpose                           | Tool/Model Policies                                   |
| -------- | --------------------------------- | ----------------------------------------------------- |
| `intake` | Homepage research and decisioning | Read/research tools only                              |
| `plan`   | Spec refinement and planning      | Spec/planning tools enabled; no implementation writes |
| `build`  | Implementation and delivery       | Full toolset enabled                                  |

### Mode Transitions

```
intake -> plan    : User confirms spec creation from homepage
plan -> build     : User approves implementation start
build -> plan      : User explicitly requests returning to planning
```

**Constraints:**

- No direct `intake -> build` transition
- No automatic `intake` transition from `plan`/`build` in same task session

### UI State vs Runtime Mode

- `homepage` vs `task-session` view is derived from `activeTaskSessionId`
- `runtimeMode` drives tool/model behavior and permission boundaries
- `session_kind` drives list visibility:
  - Homepage intake scratch sessions: `session_kind=intake`
  - User-visible task sessions: `session_kind=task`

---

## Desktop Architecture

### View Hierarchy

```
AppProvider
├── HomepageView (when activeTaskSessionId is null)
│   ├── WelcomePanel
│   ├── WorkspaceCard list
│   ├── SearchBar
│   └── New Workspace dialog
└── TaskSessionView (when activeTaskSessionId is set)
    ├── TopToolbar (back to home, runtime mode display)
    ├── LeftPanel (task sessions, keypoints)
    ├── ChatArea (spec, messages)
    └── RightPanel (agent tasks)
```

### Key State Providers

| Provider                  | Key State                                      | Purpose                                      |
| ------------------------- | ---------------------------------------------- | -------------------------------------------- |
| `workspace-chat-provider` | `activeTaskSessionId`, `activeTaskRuntimeMode` | Manages active task session and runtime mode |
| `app-provider`            | `workspaceId`                                  | Manages current workspace context            |
| `message-context`         | `messages`, `turns`                            | Chat message state                           |
| `session-context`         | `threadId`                                     | Thread tracking                              |

### Session Mode Transitions

When user selects a spec action from homepage research output:

```typescript
// Trigger spec creation and transition to task-session view
await transitionSessionMode("plan", "spec");
// Creates new task session with session_kind=task
// Sets activeTaskSessionId in workspace-chat-provider
// Sets activeTaskRuntimeMode="plan"
// Navigates to TaskSessionView
```

When task status changes:

```typescript
// Auto-create keypoint milestone
useEffect(() => {
  if (taskStatus === "implementing" && !keypointExists("started")) {
    createKeypoint("started", taskTitle);
  }
  if ((taskStatus === "completed" || taskStatus === "failed") && !keypointExists("completed")) {
    createKeypoint("completed", taskTitle, summary, artifacts);
  }
}, [taskStatus]);
```

---

## Server Architecture

### Route Structure

```
/app
├── health (public)
├── /api
│   ├── permissions (auth)
│   ├── questions (auth)
│   ├── chat (session-bridged)
│   ├── task-sessions (session-bridged)
│   ├── project-keypoints (session-bridged)
│   ├── project (session-bridged)
│   ├── workspace (session-bridged)
│   ├── workspaces
│   ├── bootstrap
│   ├── agent-tasks (memory tasks)
│   ├── files
│   ├── vcs
│   ├── lsp
│   ├── diff
│   ├── events (SSE)
│   ├── event (SSE)
│   ├── command
│   └── rules
```

### Session Bridge Middleware

All session-bridged routes require `X-Task-Session-ID` header:

```typescript
// middleware/session-bridge.ts
export const sessionBridge = async (c: Context<Env>, next: Next) => {
  const taskSessionId = c.req.header("X-Task-Session-ID");

  if (!taskSessionId) {
    // Auto-create task session
    const newSession = await createTaskSession({
      session_id: generateId(),
      status: "researching",
      session_kind: "intake",
    });
    c.set("session", newSession);
  } else {
    // Fetch existing task session
    const session = await getTaskSession(taskSessionId);
    c.set("session", session);
  }

  return next();
};
```

### Event Contracts

Task sessions publish `task-session.updated` events:

```typescript
// Event structure
interface TaskSessionUpdatedEvent {
  type: "task-session.updated";
  data: {
    taskSessionId: string;
    status: string;
    specType: string | null;
    sessionKind: "intake" | "task";
    lastActivityAt: number;
  };
}
```

Desktop listeners update task session list without full refetch:

```typescript
useEffect(() => {
  const unsubscribe = bus.subscribe("task-session.updated", event => {
    updateTaskSessionInList(event.data.taskSessionId, event.data);
  });
  return unsubscribe;
}, []);
```

---

## Migration Notes

### Hard-Cut Approach

This implementation used a hard-cut migration strategy:

- No temporary compatibility layers
- Direct rename: `/api/sessions` → `/api/task-sessions`
- Direct header rename: `X-Session-ID` → `X-Task-Session-ID`
- Direct context rename: `activeSessionId` → `activeTaskSessionId`

### Files Modified

**Server:**

- `packages/server/db/schema.ts` - Renamed `sessions` → `taskSessions`, added workflow columns
- `packages/server/db/index.ts` - Updated export references
- `packages/server/src/routes/task-sessions.ts` - New route (created)
- `packages/server/src/routes/project-keypoints.ts` - New route (created)
- `packages/server/src/routes/chat.ts` - Updated header handling
- `packages/server/src/middleware/session-bridge.ts` - Updated header names
- `packages/server/src/bus/index.ts` - Added `TaskSessionUpdated` event

**Desktop:**

- `apps/desktop/src/core/services/api/sdk-client.ts` - Updated API methods
- `apps/desktop/src/core/state/providers/workspace-chat-provider.tsx` - Renamed state
- `apps/desktop/src/core/state/contexts/chat-provider.tsx` - Updated context
- Multiple test files - Updated legacy references

**Tests:**

- `apps/desktop/tests/e2e/data-integrity/full-lifecycle.test.ts` - Updated endpoints
- `apps/desktop/tests/integration/data-integrity/session-creation-flow.test.ts` - Updated endpoints
- `apps/desktop/tests/integration/home-workspace-provider-flow.test.tsx` - Updated state names
- `apps/desktop/tests/e2e/homepage-task-session-workflow.test.tsx` - New E2E test (created)

---

## Testing

### Verification Commands

```bash
# Server typecheck
pnpm --filter @sakti-code/server typecheck

# Server tests
pnpm --filter @sakti-code/server test

# Desktop typecheck
pnpm --filter @sakti-code/desktop typecheck

# Desktop unit tests
pnpm --filter @sakti-code/desktop test:unit

# Desktop UI tests
pnpm --filter @sakti-code/desktop test:ui

# Root lint
pnpm lint
```

### Test Results Summary

- **Server:** 405/406 tests passing (1 pre-existing VCS failure unrelated to task-session)
- **Desktop Unit:** 564/564 tests passing
- **Desktop UI:** 366/368 tests passing (2 pre-existing markdown rendering failures)

---

## Common Patterns

### Creating a Task Session

```typescript
// SDK client
const { taskSessionId } = await sdkClient.createTaskSession({
  workspaceId,
  title: "My Task",
  status: "researching",
  specType: "comprehensive",
  sessionKind: "task",
});
```

### Fetching Task Sessions

```typescript
// SDK client
const { sessions } = await sdkClient.listTaskSessions({
  workspaceId,
  kind: "task", // or "intake" for homepage scratch sessions
});
```

### Setting Active Task Session

```typescript
// workspace-chat-provider
const { setActiveTaskSessionId, setActiveTaskRuntimeMode } = useWorkspaceChat();

// When user selects a spec action
setActiveTaskSessionId(newTaskSessionId);
setActiveTaskRuntimeMode("plan");
```

### Creating a Keypoint

```typescript
// SDK client
await sdkClient.createKeypoint({
  workspaceId,
  taskSessionId,
  taskTitle: "Implement feature X",
  milestone: "started", // or "completed"
  summary: "Key milestone achievement",
  artifacts: ["file1.ts", "file2.ts"],
});
```

---

## Troubleshooting

### Common Issues

**Issue:** `Missing X-Task-Session-ID header` error

- **Solution:** Ensure all session-bridged requests include `X-Task-Session-ID` header

**Issue:** Task session not appearing in list

- **Solution:** Verify `session_kind` filter matches (use `kind: "task"` for user-visible sessions)

**Issue:** Runtime mode not changing tool behavior

- **Solution:** Ensure `activeTaskRuntimeMode` is properly set in `workspace-chat-provider`

**Issue:** Keypoints not auto-creating on task completion

- **Solution:** Verify task status is `"completed"` or `"failed"` (not `"implementing"`)

---

## Future Enhancements

Out of scope for this implementation but planned for future:

- Full rename of Core `SessionManager` classes/types
- Re-architecting memory-task storage
- SSE transport protocol enhancements
- Advanced task dependency visualization
- Multi-workspace keypoint aggregation
