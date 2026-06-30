# agent-effect Tier 5+ Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port the remaining 15 modules (loaders, session, compaction pipeline, agent loop, agent, harness) from `packages/agent` to `packages/agent-effect`, matching all 157 existing tests exactly.

**Architecture:** Copy each module and its test file verbatim. No Effect patterns applied to business logic yet — this is a structural port to establish the dependency graph in the new package. Effect-native refactoring is a future phase (see "Future Effect-native Phases" at end).

**Tech Stack:**

- TypeScript, vitest, biome (via ultracite)
- `effect@^3.21.4` (already installed) — dependency only, not used in business logic yet
- `@sakti-code/llm`, `@sakti-code/logger`, `typebox`, `uuid` (already installed)
- `yaml` — needs to be added as a dependency for `harness/loader-shared.ts`
- Available but NOT used yet (future): `@effect/vitest@0.29.0`, `@effect/platform@0.96.2`

---

## Dependency Order (topological)

```
types.ts (foundation, zero internal deps)
  ↑
harness/types.ts (depends on types.ts, permission.ts — already ported)
  ↑
  ├── harness/loader-shared.ts  (harness/types.ts, yaml)
  │     ↑
  │     ├── harness/commands.ts (loader-shared, harness/types.ts, config-entry-name)
  │     ├── harness/agents.ts   (loader-shared, harness/types.ts, config-entry-name)
  │     ├── harness/prompt-templates.ts (loader-shared, harness/types.ts)
  │     └── harness/skills.ts   (loader-shared, harness/types.ts)
  │
  ├── harness/session.ts        (types.ts, harness/messages, harness/types.ts)
  ├── harness/builtin-agents.ts (permission, harness/types.ts)
  │
  ├── compaction.ts             (compaction/utils, harness/messages, harness/session, harness/types, types, @sakti-code/llm)
  │     ↑
  │     ├── auto-compaction.ts  (compaction.ts, harness/session, harness/types, types, @sakti-code/llm)
  │     └── branch-summarization.ts (compaction.ts, harness/messages, harness/types, types, compaction/utils, @sakti-code/llm)
  │
  ├── loop/agent-loop.ts        (types.ts, event-stream, validation, @sakti-code/llm)
  ├── retry-loop.ts             (auto-compaction, types, @sakti-code/llm, logger)
  ├── agent.ts                  (agent-loop, types, @sakti-code/llm)
  └── harness/agent-harness.ts  (branch-summarization, compaction, agent-loop, types,
                                 build-stream-request, messages, prompt-templates, skills, harness/types,
                                 @sakti-code/llm, logger)
```

---

## Phase 0: Type Foundation

### Task 0a: Port `src/types.ts` (652 lines → ~45 currently)

**Files:**

- Modify: `packages/agent-effect/src/types.ts`

**Scope:** Currently has `CustomMessage`, `BashExecutionMessage`, `BranchSummaryMessage`, `CompactionSummaryMessage`, `AgentMessage`. Must add all types from original `packages/agent/src/types.ts`:

- `StreamFn`, `ToolExecutionMode`, `QueueMode`, `AgentToolCall`, `BeforeToolCallResult`, `AfterToolCallResult`, `BeforeToolCallContext`, `AfterToolCallContext`, `ShouldStopAfterTurnContext`, `AgentLoopTurnUpdate`, `PrepareNextTurnContext`, `AgentLoopConfig`, `ThinkingLevel`, `AgentState`, `AgentToolResult<T>`, `PermissionRequest`, `PermissionAskRequest`, `PermissionReply`, `AgentToolUpdateCallback`, `AgentTool<TParams, TDetails>`, `AgentContext`, `AgentEvent`

**Exact imports for this file:**

```
@/sakti-code/llm: AssistantMessage, ImageContent, Message, Model, StreamRequest, StreamResult, TextContent, Tool, ToolResultMessage
@sakti-code/logger: Logger
typebox: Static, TSchema
```

**Step 1:** Write barrel test (`__tests__/types.test.ts`) that re-exports all types and verifies compilation
**Step 2:** Copy all type exports from original `packages/agent/src/types.ts`
**Step 3:** Run `pnpm exec tsc --noEmit` — GREEN
**Step 4:** Run `pnpm run test` — GREEN
**Step 5:** `git commit -m "feat(agent-effect): port root types.ts (all 652 lines)"`

**Future migration path:** `ThinkingLevel` can become an Effect `Schema.Literal`. `AgentLoopConfig` callback fields (like `afterToolCall`, `beforeToolCall`, `shouldStopAfterTurn`) can become Effect `Layer`-provided services. `AgentEvent` type union can become a `Data.TaggedError`/`Schema.TaggedError` pattern for type-safe event handlers.

### Task 0b: Expand `src/harness/types.ts` (~169 lines → 963 lines)

**Files:**

- Modify: `packages/agent-effect/src/harness/types.ts`

**Exact imports for this file:**

```
@/sakti-code/llm: ImageContent, Model, TextContent
@sakti-code/logger: Logger
../types.ts: AgentEvent, AgentMessage, AgentTool, QueueMode, StreamFn, ThinkingLevel (type-only, plus re-export ThinkingLevel)
./permission.ts: PermissionRuleset (type-only)
```

**Scope — add these groups:**

**Utility types:** `toError` function

**Entity types:** `PromptTemplate`, `AgentMode`, `AgentDefinition`, `AgentHarnessResources`, `AgentHarnessStreamOptions`, `AgentHarnessStreamOptionsPatch`

**Error types:**

```
FileKind, FileErrorCode, FileError
ExecutionErrorCode, ExecutionError
CompactionErrorCode, CompactionError
BranchSummaryErrorCode, BranchSummaryError
AgentHarnessErrorCode, AgentHarnessError
```

These are all `class extends Error { code: ... }` — keep as-is for now.

**Infrastructure interfaces:**

```
FileInfo, ExecutionEnvExecOptions
FileSystem (~30 methods: absolutePath, appendFile, canonicalPath, cleanup, createDir, createTempDir,
  createTempFile, cwd, exists, fileInfo, joinPath, listDir, readBinaryFile, readTextFile,
  readTextLines, remove, writeFile)
Shell (cleanup, exec)
ExecutionEnv = FileSystem & Shell  (interface merge, not type intersection)
```

**Session types:** `SessionContext`, `SessionCreateOptions`, `SessionForkOptions`, `SessionRepo`, `JsonlSessionMetadata`, `JsonlSessionCreateOptions`, `JsonlSessionListOptions`, `JsonlSessionRepoApi`

**Harness types:** `AgentHarnessPhase`, `PendingSessionWrite`

**Event types (~30 interfaces):**

```
QueueUpdateEvent, SavePointEvent, AbortEvent, SettledEvent
BeforeAgentStartEvent<TSkill, TPromptTemplate>
ContextEvent, BeforeProviderRequestEvent, BeforeProviderPayloadEvent
AfterProviderResponseEvent, ToolCallEvent, ToolResultEvent
SessionBeforeCompactEvent, SessionCompactEvent
SessionBeforeTreeEvent, SessionTreeEvent
ModelUpdateEvent, ThinkingLevelUpdateEvent, ToolsUpdateEvent, ResourcesUpdateEvent
AgentHarnessOwnEvent (union of all above), AgentHarnessEvent (AgentEvent | AgentHarnessOwnEvent)
```

**Result types:**

```
BeforeAgentStartResult, ContextResult, BeforeProviderRequestResult, BeforeProviderPayloadResult
ToolCallResult, ToolResultPatch, SessionBeforeCompactResult, SessionBeforeTreeResult
AgentHarnessEventResultMap (mapped type)
```

**Configuration types:**

```
AgentHarnessPromptOptions, AbortResult, CompactResult, NavigateTreeResult
CompactionSettings, CompactionPreparation, FileOperations, TreePreparation
GenerateBranchSummaryOptions, BranchSummaryResult
AgentHarnessOptions<TSkill, TPromptTemplate, TTool>  (~25 fields)
```

**Re-exports (added after those modules exist):**

- `export type { ThinkingLevel } from "../types.ts"` — add now
- `export type { Session } from "./session.ts"` — add in Phase 2
- `export type { AgentHarness } from "./agent-harness.ts"` — add in Phase 4

**Step 1:** Write barrel test
**Step 2:** Port all types
**Step 3:** Typecheck + test — GREEN
**Step 4:** Commit

**Future migration path:**

- `Result<TValue, TError>` → `Either<E, A>` from `effect/Either`. The `ok`/`err` helpers map directly to `Either.right`/`Either.left`.
- Error classes (`SessionError`, `CompactionError`, `FileError`, `ExecutionError`, `BranchSummaryError`, `AgentHarnessError`) → `Data.TaggedError` with `_tag` discriminant. Example future pattern:
  ```ts
  class SessionError extends Data.TaggedError("SessionError")<{
    code: SessionErrorCode;
    message: string;
    cause?: Error;
  }> {}
  ```
  This enables `Effect.catchTag("SessionError", ...)` at call sites.
- `FileSystem` interface → `@effect/platform/FileSystem` which provides the same operations as `Effect<A, PlatformError>` instead of `Promise<Result<A, FileError>>`.
- `Shell` / `ExecutionEnv.exec` → `@effect/platform/Command` + `CommandExecutor`.
- `AgentHarnessEvent` union + `AgentHarnessEventResultMap` → Effect `Channel` / `Stream` + `Schema.TaggedError` for serializabile typed events.

---

## Phase 1: Loader + Entity Loaders

All modules in this phase are pure parsing/formatting functions with no IO. Copy as-is.

### Task 1a: `harness/loader-shared.ts`

**Files:**

- Create: `packages/agent-effect/src/harness/loader-shared.ts`
- Modify: `packages/agent-effect/package.json` — add `"yaml": "^2"` to dependencies

**Exact imports:**

```
yaml: parse
./types.ts: type ExecutionEnv, type FileInfo, type Result, toError
```

**Exports:** `LoaderDiagnostic`, `parseFrontmatter`, `resolveKind`, `basenameEnvPath`, `dirnameEnvPath`

**Step 1:** Add `yaml` dep: `pnpm add yaml`
**Step 2:** Copy source
**Step 3:** Typecheck
**Step 4:** Commit

**Note:** No direct test file — tested through commands/agents/prompt-templates/skills tests.

**Future migration path:** `yaml.parse` call can become `Effect.try({ try: () => yaml.parse(s), catch: (e) => new YAMLError(...) })`. `LoaderDiagnostic` becomes a tagged union of expected parse failures.

### Task 1b: `harness/commands.ts`

**Files:**

- Create: `packages/agent-effect/src/harness/commands.ts`
- Create: `packages/agent-effect/src/harness/__tests__/commands.test.ts`

**Original test:** `packages/agent/src/__tests__/harness/commands.test.ts` (3 tests)

**Step 1:** Copy source module
**Step 2:** Copy test file, colocating it (change import paths to `../../../harness/...` → `../../...`)
**Step 3:** `pnpm run test` — GREEN
**Step 4:** Commit

**Future migration path:** File-system operations inside tests currently use `node:fs` + `createTempDir` pattern. Future: `@effect/platform` `FileSystem` with scoped temp dirs (`makeTempDirectoryScoped`), tests use `it.scoped`.

### Task 1c: `harness/agents.ts`

**Files:**

- Create: `packages/agent-effect/src/harness/agents.ts`
- Create: `packages/agent-effect/src/harness/__tests__/agents.test.ts`

**Original test:** `packages/agent/src/__tests__/harness/agents.test.ts` (3 tests)

**Step 1:** Copy source module
**Step 2:** Copy test file, colocating it
**Step 3:** `pnpm run test` — GREEN
**Step 4:** Commit

### Task 1d: `harness/prompt-templates.ts`

**Files:**

- Create: `packages/agent-effect/src/harness/prompt-templates.ts`
- Create: `packages/agent-effect/src/harness/__tests__/prompt-templates.test.ts`

**Original test:** `packages/agent/src/__tests__/harness/prompt-templates.test.ts` (5 tests)

**Step 1:** Copy source module
**Step 2:** Copy test file, colocating it
**Step 3:** `pnpm run test` — GREEN
**Step 4:** Commit

### Task 1e: `harness/skills.ts`

**Files:**

- Create: `packages/agent-effect/src/harness/skills.ts`
- Create: `packages/agent-effect/src/harness/__tests__/skills.test.ts`

**Original test:** `packages/agent/src/__tests__/harness/skills.test.ts` (6 tests)

**Step 1:** Copy source module
**Step 2:** Copy test file, colocating it
**Step 3:** `pnpm run test` — GREEN
**Step 4:** Commit

---

## Phase 2: Session + Builtin Agents

### Task 2a: `harness/session.ts`

**Files:**

- Create: `packages/agent-effect/src/harness/session.ts`
- Create: `packages/agent-effect/src/harness/__tests__/session.test.ts`
- Modify: `packages/agent-effect/src/harness/types.ts` — add `export type { Session } from "./session.ts"`

**Exact imports:**

```
@sakti-code/llm: type ImageContent, type TextContent
../types.ts: type AgentMessage
./messages.ts: createBranchSummaryMessage, createCompactionSummaryMessage, createCustomMessage
./types.ts: type ActiveToolsChangeEntry, BranchSummaryEntry, CompactionEntry, CustomEntry,
  CustomMessageEntry, LabelEntry, MessageEntry, ModelChangeEntry, SessionContext,
  SessionInfoEntry, SessionStorage, SessionTreeEntry, ThinkingLevelChangeEntry, SessionError
```

**Exports:** `buildSessionContext` function, `Session<TMetadata>` class (296 lines)

**Original test:** `packages/agent/src/__tests__/harness/session.test.ts` (10 tests)

**Step 1:** Copy test file
**Step 2:** Copy source module
**Step 3:** Update `types.ts` re-export
**Step 4:** `pnpm run test` — GREEN
**Step 5:** Commit

**Future migration path:** `Session` class is currently a thin wrapper around `SessionStorage` — pure delegation methods (`getMetadata`, `getLeafId`, `getEntry`, etc.) and helper methods (`appendMessage`, `appendCompaction`, `moveTo`). Future: `Session` becomes an Effect `Service`:

```ts
class Session extends Effect.Service<Session>()("Session", {
  effect: Effect.gen(function* () {
    const storage = yield* SessionStorage
    return {
      getBranch: (fromId?: string) => // ...
      buildContext: () => // ...
      appendMessage: (msg: AgentMessage) => // ...
      // ...
    }
  }),
  dependencies: [SessionStorage.Default]
}) {}
```

This would change all `Session` method signatures from `Promise<T>` to `Effect<T, SessionError>`, and every module that injects `Session` would declare it as a requirement instead of receiving a constructed instance.

### Task 2b: `harness/builtin-agents.ts`

**Files:**

- Create: `packages/agent-effect/src/harness/builtin-agents.ts`
- Create: `packages/agent-effect/src/harness/__tests__/builtin-agents.test.ts`

**Original test:** `packages/agent/src/__tests__/harness/builtin-agents.test.ts` (6 tests)

**Step 1:** Copy source module
**Step 2:** Copy test file, colocating it
**Step 3:** `pnpm run test` — GREEN
**Step 4:** Commit

---

## Phase 3: Compaction Pipeline

### Task 3a: `compaction.ts` (root-level, 886 lines)

**Files:**

- Create: `packages/agent-effect/src/compaction.ts`
- Create: `packages/agent-effect/src/__tests__/compaction.test.ts`

**Exact imports:**

```
@sakti-code/llm: type AssistantMessage, type ImageContent, type Model, type TextContent, type Usage, complete
./compaction/utils.ts: computeFileLists, createFileOps, extractFileOpsFromMessage, type FileOperations,
  formatFileOperations, serializeConversation
./harness/messages.ts: convertToLlm, createBranchSummaryMessage, createCompactionSummaryMessage, createCustomMessage
./harness/session.ts: buildSessionContext
./harness/types.ts: type CompactionEntry, CompactionError, err, ok, type Result, type SessionTreeEntry
./types.ts: type AgentMessage, type ThinkingLevel
```

**Exports:** `CompactionDetails`, `DEFAULT_COMPACTION_SETTINGS`, `calculateContextTokens`, `compact`, `estimateContextTokens`, `estimateTokens`, `prepareCompaction`, `shouldCompact`, `SUMMARIZATION_SYSTEM_PROMPT`, `serializeConversation` (re-export from utils)

**Original test:** `packages/agent/src/__tests__/harness/compaction.test.ts` (20 tests)

- Tests mocks `complete` from `@sakti-code/llm` with `vi.mock(...)` — port the same mock setup.
- `prepareCompaction` and `compact` return `Result<...>` — test both `ok` and `err` paths.

**Step 1:** Copy test file
**Step 2:** Copy source module
**Step 3:** `pnpm run test` — GREEN
**Step 4:** Commit

**Future migration path:** Key refactors:

- `complete()` call → `Effect.tryPromise({ try: () => complete(...), catch: (e) => new CompactionError("summarization_failed", ...) })`, then composed with `Effect.retry(Schedule.exponential(...))`.
- `Result<CompactResult, CompactionError>` → `Effect<CompactResult, CompactionError>` — callers use `Effect.catchTag("CompactionError", ...)` instead of `if (!result.ok)`.
- `estimateTokens` is a pure function; fine as-is or wrapped in `Effect.sync`.

### Task 3b: `compaction/auto-compaction.ts`

**Files:**

- Create: `packages/agent-effect/src/compaction/auto-compaction.ts`
- Create: `packages/agent-effect/src/compaction/__tests__/auto-compaction.test.ts`

**Exact imports:**

```
@sakti-code/llm: type AssistantMessage, isContextOverflow, type Model
../compaction.ts: type CompactionSettings, calculateContextTokens, compact, estimateContextTokens,
  prepareCompaction, shouldCompact
../harness/session.ts: type Session
../harness/types.ts: type SessionTreeEntry, type ThinkingLevel
../types.ts: type AgentMessage
```

**Exports:** `CompactionDecision`, `RunCompactionOutcome`, `evaluateCompaction`, `runCompaction`

**Original test:** `packages/agent/src/__tests__/compaction/auto-compaction.test.ts` (14 tests)

**Step 1:** Copy test file
**Step 2:** Copy source module
**Step 3:** `pnpm run test` — GREEN
**Step 4:** Commit

**Future migration path:** `Session` used as a constructed instance (dependency injection). Convert to `Session` as Effect service (see Task 2a). The auto-compaction decisions become a `Layer`-provided service.

### Task 3c: `compaction/branch-summarization.ts`

**Files:**

- Create: `packages/agent-effect/src/compaction/branch-summarization.ts`

**Exact imports:**

```
@sakti-code/llm: type Model, complete
../compaction.ts: estimateTokens, SUMMARIZATION_SYSTEM_PROMPT
../harness/messages.ts: convertToLlm, createBranchSummaryMessage, createCompactionSummaryMessage, createCustomMessage
../harness/types.ts: type BranchSummaryResult, type Session, type SessionTreeEntry, BranchSummaryError, err, ok, type Result, SessionError
../types.ts: type AgentMessage
./utils.ts: computeFileLists, createFileOps, extractFileOpsFromMessage, type FileOperations, formatFileOperations, serializeConversation
```

**Exports:** `collectEntriesForBranchSummary`, `generateBranchSummary`

**Note:** No direct test file — tested through harness tests.

**Step 1:** Copy source module
**Step 2:** Typecheck
**Step 3:** Commit

**Future migration path:** Same as compaction.ts — `complete()` → `Effect.tryPromise` + retry, `Result` → `Effect`.

---

## Phase 4: Agent Loop + Harness (most complex)

### Task 4a: `loop/agent-loop.ts`

**Files:**

- Create: `packages/agent-effect/src/loop/agent-loop.ts`
- Create: `packages/agent-effect/src/loop/__tests__/agent-loop.test.ts`

**Exact imports:**

```
@sakti-code/llm: type AssistantMessage, type TextContent, type ThinkingContent, type ToolCall,
  type ToolResultMessage, type Usage, stream
../types.ts: type AgentContext, type AgentEvent, type AgentLoopConfig, type AgentMessage,
  type AgentTool, type AgentToolCall, type AgentToolResult, type PermissionAskRequest, type StreamFn
../utils/event-stream.ts: EventStream
../utils/validation.ts: validateToolArguments
```

**Exports:** `runAgentLoop`, `runAgentLoopContinue`

**Key complexity:** This is the core loop — ~likes 500+. It orchestrates: LLM stream → tool preflight → tool execution → permission checking → event emission → follow-up/steering → loop decision. The `stream()` import from `@sakti-code/llm` is a lazy dynamic import (`() => import(...)`) in `defaultStreamFn`.

**Original test:** `packages/agent/src/__tests__/agent-loop.test.ts` (27 tests)

- Tests create `mockStreamFn` that yields fake stream parts.
- Tests create `AgentLoopConfig` with mock `stream.start`/`stream.update`/`stream.end` hooks.
- Tests verify event sequence: tool_call → tool_result → turn_end → agent_end.

**Step 1:** Copy test file
**Step 2:** Copy source module
**Step 3:** `pnpm run test` — GREEN
**Step 4:** Commit

**Future migration path:** The entire agent loop is the most natural candidate for Effect conversion:

- `EventStream` class → Effect `Queue` + `Stream` for typed event emission.
- `stream()` call → `Effect.tryPromise` wrapping the lazy import.
- `AgentLoopConfig` callbacks (`beforeToolCall`, `afterToolCall`, `getFollowUpMessages`, etc.) → Effect services provided via `Layer`.
- The main loop becomes an `Effect.gen` with `while` + `Queue.take` for incoming messages.

### Task 4b: `retry-loop.ts`

**Files:**

- Create: `packages/agent-effect/src/retry-loop.ts`
- Create: `packages/agent-effect/src/__tests__/retry-loop.test.ts`

**Note:** This is root-level (`src/retry-loop.ts`), NOT under `loop/`.

**Exact imports:**

```
@sakti-code/llm: type AssistantMessage, isRetryableAssistantError
@sakti-code/logger: type Logger
./compaction/auto-compaction.ts: type CompactionDecision, type RunCompactionOutcome
./types.ts: type AgentEvent
```

**Exports:** `runWithRetry` (wraps agent loop with retry + auto-compaction logic)

**Original test:** `packages/agent/src/__tests__/retry-loop.test.ts` (24 tests)

**Step 1:** Copy test file
**Step 2:** Copy source module
**Step 3:** `pnpm run test` — GREEN
**Step 4:** Commit

**Future migration path:** The retry loop's backoff logic is a natural fit for Effect's `Schedule`:

```ts
// Current: manual setTimeout + counter
// Future:
Effect.retry(agentLoop, {
  while: (e) => isRetryableAssistantError(e),
  schedule: Schedule.exponential("1 second").pipe(Schedule.compose(Schedule.recurs(3))),
});
```

The `isRetryableAssistantError` check maps directly to `while`. The `auto_retry_start` / `auto_retry_end` events become `Effect.tap` on the retry schedule.

### Task 4c: `agent.ts`

**Files:**

- Create: `packages/agent-effect/src/agent.ts`
- Create: `packages/agent-effect/src/__tests__/agent.test.ts`

**Exact imports:**

```
@sakti-code/llm: type ImageContent, type Message, type Model, type TextContent
./loop/agent-loop.ts: runAgentLoop, runAgentLoopContinue
./types.ts: type AfterToolCallContext, AfterToolCallResult, AgentContext, AgentEvent,
  AgentLoopConfig, AgentLoopTurnUpdate, AgentMessage, AgentState, AgentTool,
  BeforeToolCallContext, BeforeToolCallResult, QueueMode, StreamFn, ToolExecutionMode
```

**Exports:** `Agent` class (wraps `AgentLoopConfig`, `AgentState`, event subscription)

**Original test:** `packages/agent/src/__tests__/agent.test.ts` (18 tests)

**Step 1:** Copy test file
**Step 2:** Copy source module
**Step 3:** `pnpm run test` — GREEN
**Step 4:** Commit

**Future migration path:** `Agent` class with `subscribe`/`start`/`continue`/`stop` methods becomes:

- `Agent` as an Effect `Service` (requirements: `AgentLoopConfig`, `Logger`).
- `subscribe()` → `Stream` of `AgentEvent` (subscribers consume via `Stream.runForEach`).
- `start()` / `continue()` → `Effect<void, AgentError>` with `Fork` for lifecycle management.
- `stop()` → `Fiber.interrupt` with resource cleanup via `Scope`.

### Task 4d: `harness/agent-harness.ts`

**Files:**

- Create: `packages/agent-effect/src/harness/agent-harness.ts`
- Create: `packages/agent-effect/src/harness/__tests__/agent-harness.test.ts`
- Create: `packages/agent-effect/src/harness/__tests__/agent-harness-continue.test.ts`
- Create: `packages/agent-effect/src/harness/__tests__/agent-switch.test.ts`
- Create: `packages/agent-effect/src/harness/__tests__/agent-type.test.ts`
- Modify: `packages/agent-effect/src/harness/types.ts` — add `export type { AgentHarness } from "./agent-harness.ts"`

**Exact imports (largest set in project):**

```
@sakti-code/llm: type AssistantMessage, type ImageContent, type Model, type UserMessage, stream, complete
@sakti-code/logger: type Logger
../compaction/branch-summarization.ts: collectEntriesForBranchSummary, generateBranchSummary
../compaction.ts: compact, DEFAULT_COMPACTION_SETTINGS, prepareCompaction
../loop/agent-loop.ts: runAgentLoop, runAgentLoopContinue
../types.ts: type AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, AgentTool,
  PermissionAskRequest, QueueMode, StreamFn, ThinkingLevel
./build-stream-request.ts: buildHarnessStreamRequest
./messages.ts: convertToLlm
./prompt-templates.ts: formatPromptTemplateInvocation
./skills.ts: formatSkillInvocation
./types.ts: type AbortResult, AgentDefinition, AgentHarnessEvent, AgentHarnessEventResultMap,
  AgentHarnessOptions, AgentHarnessOwnEvent, AgentHarnessPhase, AgentHarnessResources,
  AgentHarnessStreamOptions, AgentHarnessStreamOptionsPatch, ExecutionEnv, NavigateTreeResult,
  PendingSessionWrite, PromptTemplate, Session, Skill,
  AgentHarnessError, BranchSummaryError, CompactionError, SessionError, toError
```

**This is the orchestrator — 2000+ lines.** It composes: resource loading → session creation → agent loop wiring → compaction → branch summarization → event forwarding.

**Original tests (4 files, 24 tests total):**

- `packages/agent/src/__tests__/harness/agent-harness.test.ts` (13 tests)
- `packages/agent/src/__tests__/harness/agent-harness-continue.test.ts` (4 tests)
- `packages/agent/src/__tests__/harness/agent-switch.test.ts` (4 tests)
- `packages/agent/src/__tests__/harness/agent-type.test.ts` (3 tests)

**Step 1:** Copy all 4 test files (colocating)
**Step 2:** Copy source module
**Step 3:** Update types.ts re-export
**Step 4:** `pnpm run test` — GREEN
**Step 5:** Commit

**Future migration path:** This is the largest refactoring target. The `AgentHarness` class manages mutable state (phase, session, env, hooks). Future:

- State → `Ref<AgentHarnessPhase>` for phase tracking, `SynchronizedRef` for hooks.
- Each method (`startAgent`, `switchAgent`, `continueAgent`, `compact`, `navigateTree`, `abort`) → independent `Effect` functions, composed via `Effect.gen`.
- `getApiKeyAndHeaders` callback → `Config` / `Context.Tag`-provided service.

---

## Phase 5: Final Verification & Index Update

### Task 5: Everything together

**Step 1:** `pnpm run test` — all ~157 tests pass
**Step 2:** `pnpm exec tsc --noEmit` — clean
**Step 3:** `npx biome check packages/agent-effect/src/` — clean (agent-effect added to biome overrides)
**Step 4:** Update `packages/agent-effect/src/index.ts` to export all new public APIs
**Step 5:** Cross-compare test count with original (157 tests each)
**Step 6:** Commit

---

## Cross-Comparison Summary

| #         | Module                               |  Original tests   | Ported tests | Strategy   |
| --------- | ------------------------------------ | :---------------: | :----------: | ---------- |
| 0a        | `types.ts`                           |      barrel       |    barrel    | Copy as-is |
| 0b        | `harness/types.ts`                   |     type-only     |  type-only   | Copy as-is |
| 1a        | `harness/loader-shared.ts`           |   0 (indirect)    |      0       | Copy as-is |
| 1b        | `harness/commands.ts`                |         3         |      3       | Copy as-is |
| 1c        | `harness/agents.ts`                  |         3         |      3       | Copy as-is |
| 1d        | `harness/prompt-templates.ts`        |         5         |      5       | Copy as-is |
| 1e        | `harness/skills.ts`                  |         6         |      6       | Copy as-is |
| 2a        | `harness/session.ts`                 |        10         |      10      | Copy as-is |
| 2b        | `harness/builtin-agents.ts`          |         6         |      6       | Copy as-is |
| 3a        | `compaction.ts`                      |        20         |      20      | Copy as-is |
| 3b        | `compaction/auto-compaction.ts`      |        14         |      14      | Copy as-is |
| 3c        | `compaction/branch-summarization.ts` |   0 (indirect)    |      0       | Copy as-is |
| 4a        | `loop/agent-loop.ts`                 |        27         |      27      | Copy as-is |
| 4b        | `retry-loop.ts`                      |        24         |      24      | Copy as-is |
| 4c        | `agent.ts`                           |        18         |      18      | Copy as-is |
| 4d        | `harness/agent-harness.ts`           | 24 (4 test files) |      24      | Copy as-is |
| **Total** |                                      |      **157**      |   **157**    |            |

## Key Risks & Mitigations

1. **Circular dependency `harness/types.ts` ↔ `session.ts`:** Original uses `type`-only re-exports (`export type { Session }`). Must preserve this exactly. TypeScript handles this correctly with `export type` since type imports are erased at runtime.

2. **agent-harness.ts is 2000+ lines:** Port last. Every dependency must be green first. Make sure tests mock `@sakti-code/llm` (`stream`, `complete`) correctly — the mock patterns from original tests should work since the `@sakti-code/llm` API hasn't changed.

3. **LLM `complete`/`stream` calls are side-effectful:** In compaction and harness modules, these are real network calls. Tests mock them with `vi.mock("@sakti-code/llm", ...)`. In the port, set up the same mock pattern: `mockResolvedValue` for `complete`, `mockReturnValue` for `stream` (returns `{ fullStream: ..., result: ... }`).

4. **`yaml` dependency:** Must be added to `package.json` before `loader-shared.ts` compiles. Run `pnpm add yaml` in the agent-effect package.

5. **`@effect/vitest` not yet added:** Don't add it yet — tests use standard vitest `describe`/`it`/`expect`/`async` to match the original. `@effect/vitest` would be added in a future Effect-native phase.

6. **`node:fs` usage in test utils:** The `session-test-utils.ts` file uses `node:fs` for temp directory creation. This is fine — the port's test runtime is Node.js. Future: `@effect/platform` `FileSystem.makeTempDirectoryScoped` for Effect-native cleanup.

## Future Effect-native Phases (beyond this plan)

After all 157 tests pass, the following refactoring phases are possible:

### Phase A: Error Types → Data.TaggedError

- **Files:** `harness/types.ts`, `types.ts`
- Replace: `class SessionError extends Error { code }` → `class SessionError extends Data.TaggedError("SessionError")<{ code, message, cause? }>`
- Same for: `CompactionError`, `BranchSummaryError`, `FileError`, `ExecutionError`, `AgentHarnessError`
- Impact: Enables `Effect.catchTag("SessionError", ...)` at every call site.

### Phase B: Result<Either> Adoption

- **Files:** `harness/types.ts`, `harness/loader-shared.ts`, `compaction.ts`, `compaction/branch-summarization.ts`
- Replace: `Result<T, E>` pattern → `Either<E, T>` from `effect/Either`
- Replace: `ok(v)` → `Either.right(v)`, `err(e)` → `Either.left(e)`
- Impact: Enables `Effect.fromEither` at adapter boundaries, `Effect.either` for effect composition.

### Phase C: FileSystem → @effect/platform

- **Files:** `harness/types.ts` (swap interface), `harness/agent-harness.ts` (use), all test files
- Replace: Custom `FileSystem`, `Shell`, `ExecutionEnv` → `@effect/platform` `FileSystem`, `Command`, `CommandExecutor`
- Impact: Filesystem operations become `Effect<A, PlatformError>` — composable with retry, timeout, scoped resources.

### Phase D: Agent Loop → Effect-native

- **Files:** `loop/agent-loop.ts`, `agent.ts`, `harness/agent-harness.ts`
- Replace: `EventStream` class → `Queue<AgentEvent>` + `Stream` for typed event emission
- Replace: async `AgentLoopConfig` callbacks → Effect services via `Layer`
- Replace: `runAgentLoop` → `Effect.gen` with `while` loop + `Queue.take`
- Impact: Full composability with Effect concurrency, interruption, and scoping.

### Phase E: Session → Effect Service

- **Files:** `harness/session.ts`
- Convert `Session` class → `Effect.Service<Session>()("Session", { effect: ... })`
- Impact: Every module that uses `Session` declares it as an Effect requirement instead of receiving a constructed instance.

### Phase F: Tests → @effect/vitest

- **Files:** Add `@effect/vitest` as devDependency
- Migrate tests from `it("...", async () => { ... })` to `it.effect("...", () => Effect.gen(function* () { ... }))`
- Impact: Tests gain access to `TestClock`, `TestServices`, fiber supervision, and built-in `Layer` composition.
