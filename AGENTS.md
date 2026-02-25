# Repository Guidelines

## Project Structure & Module Organization

This repository is a `pnpm` monorepo managed with Turbo.

- `apps/desktop`: Electron/SolidJS desktop UI (main markdown migration surface).
- `apps/electron`, `apps/preload`: Electron process and preload layers.
- `packages/core`: shared domain logic and chat/server contracts.
- `packages/server`: backend/runtime services, DB schema, and model snapshot tooling.
- `packages/shared`, `packages/zai`, `packages/memorable-name`: shared utilities and supporting libs.
- `docs/`: architecture notes and implementation plans.
- `scripts/`: repo-level automation (fixtures, migration checks, model snapshot updates).

## Build, Test, and Development Commands

Run from repository root unless noted.

- `pnpm dev`: starts local development orchestration.
- `pnpm dev:p`: runs package `dev` tasks in parallel via Turbo.
- `pnpm build`: builds all packages/apps.
- `pnpm test`: runs tests across workspaces where present.
- `pnpm lint`: runs ESLint across workspaces.
- `pnpm typecheck`: runs TypeScript checks across workspaces.

Desktop-focused examples:

- `pnpm --filter @sakti-code/desktop test:ui`
- `pnpm --filter @sakti-code/desktop markdown:migration:health`

## Coding Style & Naming Conventions

- Language: TypeScript (`.ts`/`.tsx`), ESM modules.
- Formatting: Prettier (`pnpm format` / `pnpm format:check`).
- Linting: ESLint (`eslint.config.js`) with `@typescript-eslint`.
- Unused variables: prefix intentionally unused names with `_`.
- Use path aliases where configured (for example `@/` in desktop tests); avoid deep relative imports blocked by lint rules.
- Follow existing naming patterns: `kebab-case` files, `PascalCase` components, `camelCase` functions.

## Testing Guidelines

- Framework: Vitest (workspace-specific configs like `apps/desktop/vitest.config.ts`).
- Keep tests near source in `__tests__` and integration tests under `tests/integration`.
- Naming: `*.test.ts` / `*.test.tsx`.
- Prefer behavior-driven assertions over implementation coupling.
- For desktop, validate all three projects when relevant: `test:unit`, `test:ui`, `test:integration`.

## Commit & Pull Request Guidelines

- Use Conventional Commit style seen in history: `feat(desktop): ...`, `test(desktop): ...`, `chore(desktop): ...`.
- Keep commits scoped to one logical change.
- PRs should include:
- what changed and why
- affected packages/apps
- verification commands run (for example `pnpm lint`, `pnpm typecheck`, targeted Vitest commands)
- screenshots/GIFs for UI changes in `apps/desktop`

## Git Safety Rules

- Never use `rm -rf` for repo cleanup.
- Before any reset/restore/cleanup, run `git status --porcelain` and identify `M` (modified) vs `A`/`??` (new or untracked).
- Treat `A` and `??` files as user work unless created in this session.
- If cleanup/reset is necessary, create a named stash first (for example `git stash push -m "safety backup before cleanup"`), inform the user it was stashed, and never use `git stash pop` or `git stash drop`; only use `git stash apply` to restore.
- Revert only targeted tracked-file edits with `git restore <file>`/`git checkout -- <file>`.
- Do not run `git clean -fd`, broad resets, or delete untracked files without explicit user approval.
- If anything is uncertain, stop and ask.
- Reference: `.claude/GIT_SAFETY_RULES.md`.

# AI-DLC and Spec-Driven Development

Kiro-style Spec Driven Development implementation on AI-DLC (AI Development Life Cycle)

## Project Context

### Paths

- Steering: `.kiro/steering/`
- Specs: `.kiro/specs/`

### Steering vs Specification

**Steering** (`.kiro/steering/`) - Guide AI with project-wide rules and context
**Specs** (`.kiro/specs/`) - Formalize development process for individual features

### Active Specifications

- Check `.kiro/specs/` for active specifications
- Use `/kiro-spec-status [feature-name]` to check progress

## Development Guidelines

- Think in English, generate responses in English. All Markdown content written to project files (e.g., requirements.md, design.md, tasks.md, research.md, validation reports) MUST be written in the target language configured for this specification (see spec.json.language).

## Minimal Workflow

- Phase 0 (optional): `/kiro-steering`, `/kiro-steering-custom`
- Phase 1 (Specification):
  - `/kiro-spec-init "description"`
  - `/kiro-spec-requirements {feature}`
  - `/kiro-validate-gap {feature}` (optional: for existing codebase)
  - `/kiro-spec-design {feature} [-y]`
  - `/kiro-validate-design {feature}` (optional: design review)
  - `/kiro-spec-tasks {feature} [-y]`
- Phase 2 (Implementation): `/kiro-spec-impl {feature} [tasks]`
  - `/kiro-validate-impl {feature}` (optional: after implementation)
- Progress check: `/kiro-spec-status {feature}` (use anytime)

## Development Rules

- 3-phase approval workflow: Requirements → Design → Tasks → Implementation
- Human review required each phase; use `-y` only for intentional fast-track
- Keep steering current and verify alignment with `/kiro-spec-status`
- Follow the user's instructions precisely, and within that scope act autonomously: gather the necessary context and complete the requested work end-to-end in this run, asking questions only when essential information is missing or the instructions are critically ambiguous.

## Steering Configuration

- Load entire `.kiro/steering/` as project memory
- Default files: `product.md`, `tech.md`, `structure.md`
- Custom files are supported (managed via `/kiro-steering-custom`)

---

## Task-Session Workflow Architecture

### Overview

The codebase uses a **task-first workflow** that replaces traditional session-first workspace UX with a homepage-driven approach supporting research, spec selection, and parallel task session execution.

**Key Architectural Patterns:**

- **Server Database:** `task_sessions` table (renamed from `sessions`) with workflow-aware fields (`status`, `spec_type`, `session_kind`, `last_activity_at`)
- **Server API:** `/api/task-sessions` endpoints replace legacy `/api/sessions`
- **Header Requirement:** All session-bridged routes require `X-Task-Session-ID` header (not `X-Session-ID`)
- **Desktop State:** `activeTaskSessionId` / `setActiveTaskSessionId` in `workspace-chat-provider` (not `activeSessionId`)
- **Runtime Control:** Single source of truth: `runtimeMode` (`intake` | `plan` | `build`)

### Core Concepts

**Task Sessions:**

- Primary conversation units with workflow state
- Two kinds: `intake` (homepage scratch sessions) and `task` (user-visible sessions)
- Status lifecycle: `researching` → `specifying` → `implementing` → `completed`/`failed`

**Runtime Modes:**

- `intake`: Homepage research and decisioning (read/research tools only)
- `plan`: Spec refinement and planning (spec/planning tools enabled, no implementation writes)
- `build`: Implementation and delivery (full toolset)

**Keypoints:**

- Milestone tracking for task sessions (`started` | `completed`)
- Auto-created when task status changes to `implementing` or `completed`/`failed`
- Stored in `project_keypoints` table with artifact tracking

### Common Patterns

**Creating a Task Session:**

```typescript
const { taskSessionId } = await sdkClient.createTaskSession({
  workspaceId,
  title: "My Task",
  status: "researching",
  specType: "comprehensive",
  sessionKind: "task",
});
```

**Setting Active Task Session:**

```typescript
const { setActiveTaskSessionId, setActiveTaskRuntimeMode } = useWorkspaceChat();
setActiveTaskSessionId(newTaskSessionId);
setActiveTaskRuntimeMode("plan");
```

**Fetching Task Sessions:**

```typescript
const { sessions } = await sdkClient.listTaskSessions({
  workspaceId,
  kind: "task", // Use "intake" for homepage scratch sessions
});
```

**Creating a Keypoint:**

```typescript
await sdkClient.createKeypoint({
  workspaceId,
  taskSessionId,
  taskTitle: "Implement feature X",
  milestone: "started", // or "completed"
  summary: "Key milestone achievement",
  artifacts: ["file1.ts", "file2.ts"],
});
```

### Critical Header Requirements

All requests to session-bridged routes (`/api/chat`, `/api/workspace`, `/api/project`, `/api/task-sessions`) must include:

```typescript
headers: {
  "X-Task-Session-ID": taskSessionId,
}
```

The `session-bridge` middleware auto-creates task sessions if the header is missing, but explicit headers are recommended.

### Event Contracts

Task sessions publish `task-session.updated` events:

```typescript
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

### Migration Notes

This implementation used a **hard-cut migration** strategy:

- No temporary compatibility layers
- Direct renames: `/api/sessions` → `/api/task-sessions`, `X-Session-ID` → `X-Task-Session-ID`
- Direct context renames: `activeSessionId` → `activeTaskSessionId`

**Documentation:** See `docs/TASK_FIRST_WORKFLOW.md` for comprehensive documentation including database schema, API contracts, and architectural patterns.
