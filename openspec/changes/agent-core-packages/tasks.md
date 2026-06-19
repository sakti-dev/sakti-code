## 1. Monorepo Setup

- [x] 1.1 Create `packages/agent/package.json` with name `@sakti-code/agent`, type module, main/types pointing to dist, add `@earendil-works/pi-ai` as dependency
- [x] 1.2 Create `packages/db/package.json` with name `@sakti-code/db`, type module, add `drizzle-orm` and `drizzle-kit` as dependencies, add `@sakti-code/agent` as workspace dependency
- [x] 1.3 Create `packages/tools/package.json` with name `@sakti-code/tools`, type module, no workspace dependencies (independent package)
- [x] 1.4 Update root `package.json` workspaces from `["apps/*"]` to `["apps/*", "packages/*"]`
- [x] 1.5 Create shared `tsconfig.base.json` at root with strict mode, ESNext target, bundler module resolution, noEmit, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`
- [x] 1.6 Create `packages/agent/tsconfig.json` extending base, include `src/`, outDir `dist/`, add composite:true and references
- [x] 1.7 Create `packages/db/tsconfig.json` extending base, include `src/`, outDir `dist/`, add composite:true and references
- [x] 1.8 Create `packages/tools/tsconfig.json` extending base, include `src/`, outDir `dist/`, add composite:true and references
- [x] 1.9 Update root `turbo.json` to add `build` pipeline for packages with `dependsOn: ["^build"]`
- [x] 1.10 Run `bun install` and verify all workspace packages resolve correctly

## 2. Agent Types (`packages/agent`)

- [x] 2.1 TDD: Write failing test for `AgentMessage` type — verify discriminated union: user message (role + content), assistant message (role + content + optional toolCalls + usage), tool result message (role + toolCallId + content + optional isError)
- [x] 2.2 Implement `AgentMessage` type as discriminated union in `src/types.ts`, export it, verify test passes
- [x] 2.3 TDD: Write failing test for `AgentTool` interface — verify it has: name, description, parameters schema, execute function returning Promise of `AgentToolResult`
- [x] 2.4 Implement `AgentTool` and `AgentToolResult` interfaces in `src/types.ts`, export them, verify test passes
- [x] 2.5 TDD: Write failing test for `AgentEvent` discriminated union — verify all event types: agent_start, agent_end, turn_start, turn_end, message_start, message_update (with text_delta, thinking_delta, toolcall_start/delta/end subtypes), message_end, tool_execution_start, tool_execution_update, tool_execution_end, error, compaction_start, compaction_end, retry
- [x] 2.6 Implement `AgentEvent` type as discriminated union in `src/types.ts`, verify test passes
- [x] 2.7 TDD: Write failing test for `AgentConfig` type — verify it has: model (Model from pi-ai), tools (AgentTool[]), store (SessionStore), toolExecutionMode ("sequential"|"parallel"), maxRetries (number), retryBaseDelayMs (number), reserveTokens (number), keepRecentTokens (number)
- [x] 2.8 Implement `AgentConfig` type in `src/types.ts`, verify test passes
- [x] 2.9 Create `src/index.ts` that re-exports all types from `src/types.ts`

## 3. SessionStore Interface (`packages/agent`)

- [x] 3.1 TDD: Write failing test that defines a mock SessionStore implementing the interface — verify `loadMessages()` returns AgentMessage[], `appendMessage()` persists one message, `replaceMessages()` atomically replaces all messages
- [x] 3.2 Define `SessionStore` interface in `src/types.ts` with methods: loadMessages(sessionId: string): Promise<AgentMessage[]>, appendMessage(sessionId: string, message: AgentMessage): Promise<void>, replaceMessages(sessionId: string, messages: AgentMessage[]): Promise<void>
- [x] 3.3 Verify mock implementation satisfies the interface (TypeScript compilation), verify test passes
- [x] 3.4 Export `SessionStore` from `src/index.ts`

## 4. Agent Loop (`packages/agent`)

- [x] 4.1 TDD: Write failing test — agent receives a simple prompt, LLM returns plain text (mock pi-ai streamSimple), agent yields text_delta events then done, appends user and assistant messages to store
- [x] 4.2 Implement `AgentLoop.prompt()` in `src/loop.ts` — accepts message string, builds AgentMessage[], calls pi-ai streamSimple, yields AgentEvents, appends messages to store. Verify test passes
- [x] 4.3 TDD: Write failing test — LLM returns a tool call, tool executes successfully, result is appended, LLM then returns text. Verify full event sequence: agent_start → turn_start → message_start → toolcall events → message_end → tool_execution events → turn_start → message_start → text_delta → done → message_end → turn_end → agent_end
- [x] 4.4 Implement tool execution in `src/loop.ts` — after toolcall_done, execute tool, append tool result message, call pi-ai again with tool results. Verify test passes
- [x] 4.5 TDD: Write failing test — LLM returns multiple tool calls, mode is parallel, all tools execute concurrently, all results sent back together
- [x] 4.6 Implement parallel tool execution using `Promise.all()` in `src/loop.ts`. Verify test passes
- [x] 4.7 TDD: Write failing test — LLM returns multiple tool calls, mode is sequential, tools execute one at a time
- [x] 4.8 Implement sequential tool execution in `src/loop.ts`. Verify test passes
- [x] 4.9 TDD: Write failing test — tool execution throws an error, agent appends error result (isError: true), loop continues to LLM
- [x] 4.10 Implement error handling in tool execution — catch errors, create error tool result message, continue loop. Verify test passes
- [x] 4.11 TDD: Write failing test — tool result has terminate: true, agent stops loop without sending results back to LLM
- [x] 4.12 Implement terminate check in tool execution — if all results have terminate, stop inner loop. Verify test passes
- [x] 4.13 TDD: Write failing test — tool calls onUpdate callback, agent yields tool_execution_update events with accumulated partial result
- [x] 4.13 Implement tool progress streaming — wire onUpdate from tool execute to tool_execution_update events. Verify test passes
- [x] 4.14 Export `AgentLoop` from `src/index.ts`

## 5. Agent Retry (`packages/agent`)

- [x] 5.1 TDD: Write failing test — LLM returns 429 error, agent retries with backoff, second attempt succeeds, yields retry event
- [x] 5.2 Implement retry logic in `src/loop.ts` — catch retryable errors (429, 5xx), wait with exponential backoff, re-call pi-ai. Verify test passes
- [x] 5.3 TDD: Write failing test — LLM fails 3 times with retryable errors, agent yields error event and stops
- [x] 5.4 Implement max retry limit check. Verify test passes
- [x] 5.5 TDD: Write failing test — LLM returns context overflow error, agent does NOT retry (compaction handles this instead)
- [x] 5.6 Add context overflow to non-retryable error list. Verify test passes

## 6. Agent Compaction (`packages/agent`)

- [x] 6.1 TDD: Write failing test for `shouldCompact()` — returns true when tokens > contextWindow - reserveTokens, returns false when within budget
- [x] 6.2 Implement `shouldCompact()` as exported function in `src/compaction.ts`. Verify test passes
- [x] 6.3 TDD: Write failing test — messages exceed budget, agent calls store.replaceMessages() with summary + recent messages, yields compaction_start and compaction_end events
- [x] 6.4 Implement compaction in `src/compaction.ts` — take messages, split into old (to summarize) and recent (keep ~20k tokens), call pi-ai to summarize old messages, call store.replaceMessages(). Verify test passes
- [x] 6.5 TDD: Write failing test — compaction handles turn boundary correctly when cut point splits a multi-message turn (generates turn prefix summary)
- [x] 6.6 Implement turn-boundary-aware compaction. Verify test passes
- [x] 6.7 Wire compaction check into the agent loop — after each LLM done event, check shouldCompact, trigger compaction if needed
- [x] 6.8 Export compaction functions from `src/index.ts`

## 7. Agent Abort (`packages/agent`)

- [x] 7.1 TDD: Write failing test — abort signal fires during LLM streaming, agent stops and yields agent_end
- [x] 7.2 Implement AbortSignal support in `src/loop.ts` — pass signal to pi-ai stream, check between iterations. Verify test passes
- [x] 7.3 TDD: Write failing test — abort signal fires during tool execution, agent cancels tool and yields agent_end
- [x] 7.4 Implement tool execution cancellation on abort. Verify test passes

## 8. Database Schema (`packages/db`)

- [x] 8.1 Create `src/schema.ts` with Drizzle `sqliteTable()` definitions for: projects, sessions, messages, toolExecutions, costs, settings, modelConfigs — all columns matching the spec
- [x] 8.2 TDD: Write failing test — initDatabase() creates a new SQLite file, creates all tables, enables WAL mode and foreign keys
- [x] 8.3 Implement `src/init.ts` — `initDatabase(dbPath)` opens bun:sqlite with WAL mode, runs Drizzle migrations (create tables), returns Drizzle instance. Verify test passes
- [x] 8.4 Create `drizzle.config.ts` at root for Drizzle Kit (schema path, dialect, out folder)
- [x] 8.5 Export schema and init function from `src/index.ts`

## 9. Database Repos (`packages/db`)

- [ ] 9.1 TDD: Write failing test — ProjectRepo.create() inserts a project, findById() retrieves it, findByCwd() finds by cwd, list() returns all projects ordered by createdAt desc
- [ ] 9.2 Implement `src/repos/project.ts` — ProjectRepo class with create, findById, findByCwd, list, update, delete methods using Drizzle queries. Verify test passes
- [ ] 9.3 TDD: Write failing test — SessionRepo.create() inserts a session linked to project, listByProject() returns sessions ordered by date
- [ ] 9.4 Implement `src/repos/session.ts` — SessionRepo class. Verify test passes
- [ ] 9.5 TDD: Write failing test — MessageRepo.append() inserts a message, loadBySession() returns messages in chronological order, replaceForSession() atomically swaps messages in a transaction
- [ ] 9.6 Implement `src/repos/message.ts` — MessageRepo class with transaction support for replaceForSession. Verify test passes
- [ ] 9.7 TDD: Write failing test — CostRepo.record() persists a cost row, aggregateByProject() sums tokens and costs correctly
- [ ] 9.8 Implement `src/repos/cost.ts`. Verify test passes
- [ ] 9.9 TDD: Write failing test — SettingsRepo.set() upserts a key-value pair, get() retrieves it, get() returns null for missing key
- [ ] 9.10 Implement `src/repos/settings.ts`. Verify test passes
- [ ] 9.11 TDD: Write failing test — ModelConfigRepo.set() creates a config, getForProject() returns project config or falls back to global default
- [ ] 9.12 Implement `src/repos/model-config.ts`. Verify test passes
- [ ] 9.13 Create `src/repos/index.ts` re-exporting all repos

## 10. SqliteSessionStore (`packages/db`)

- [ ] 10.1 TDD: Write failing test — SqliteSessionStore.loadMessages() returns AgentMessage[] mapped from database rows, preserving chronological order
- [ ] 10.2 Implement `src/session-store.ts` — SqliteSessionStore class, loadMessages maps DB rows to AgentMessage discriminated union (user → content, assistant → content + toolCalls + usage, tool → toolCallId + content + isError). Verify test passes
- [ ] 10.3 TDD: Write failing test — SqliteSessionStore.appendMessage() maps AgentMessage to DB row (role, content, JSON fields) and persists via MessageRepo
- [ ] 10.4 Implement appendMessage — map each AgentMessage variant to the correct DB row format. Verify test passes
- [ ] 10.5 TDD: Write failing test — SqliteSessionStore.replaceMessages() maps AgentMessage[] to rows and calls MessageRepo.replaceForSession() atomically
- [ ] 10.6 Implement replaceMessages. Verify test passes
- [ ] 10.7 TDD: Write failing test — SqliteSessionStore has no runtime dependency on pi-ai (only imports SessionStore type from @sakti-code/agent)
- [ ] 10.8 Verify package.json has no pi-ai dependency, only @sakti-code/agent. Verify test passes
- [ ] 10.9 Export SqliteSessionStore from `src/index.ts`

## 11. Coding Tools (`packages/tools`)

- [ ] 11.1 TDD: Write failing test — createReadTool(cwd) returns a tool that reads a file and returns content
- [ ] 11.2 Implement `src/read.ts` — factory function, read file relative to cwd, truncate to 2000 lines / 50KB, return text content. Verify test passes
- [ ] 11.3 TDD: Write failing test — read tool with offset and limit returns correct line range
- [ ] 11.4 Implement offset/limit support in read tool. Verify test passes
- [ ] 11.5 TDD: Write failing test — read tool returns error for missing file
- [ ] 11.6 Implement error handling for missing files. Verify test passes
- [ ] 11.7 TDD: Write failing test — createWriteTool(cwd) returns a tool that writes content to a file
- [ ] 11.8 Implement `src/write.ts` — factory function, write file relative to cwd, create parent dirs with recursive mkdir. Verify test passes
- [ ] 11.9 TDD: Write failing test — write tool overwrites existing file
- [ ] 11.10 Implement overwrite behavior (write already creates/overwrites). Verify test passes
- [ ] 11.11 TDD: Write failing test — createEditTool(cwd) returns a tool that replaces exact text in a file
- [ ] 11.12 Implement `src/edit.ts` — factory function, read file, apply all edits (oldText → newText), write back. Atomic: all edits must match or none applied. Verify test passes
- [ ] 11.13 TDD: Write failing test — edit tool fails if oldText not found, returns error, file unchanged
- [ ] 11.14 Implement validation: check all oldText matches before applying, return error if any not found. Verify test passes
- [ ] 11.15 TDD: Write failing test — createBashTool(cwd) returns a tool that executes a command and returns output
- [ ] 11.16 Implement `src/bash.ts` — factory function, spawn shell in cwd, collect stdout/stderr, support timeout (default 30s, SIGTERM then SIGKILL). Verify test passes
- [ ] 11.17 TDD: Write failing test — bash tool kills process on timeout, returns partial output
- [ ] 11.18 Implement timeout handling. Verify test passes
- [ ] 11.19 TDD: Write failing test — bash tool returns error on non-zero exit code
- [ ] 11.20 Implement exit code error handling. Verify test passes
- [ ] 11.21 TDD: Write failing test — createGrepTool(cwd) returns a tool that searches with ripgrep and returns matches
- [ ] 11.22 Implement `src/grep.ts` — factory function, spawn `rg --json`, parse JSON output, format as `file:line: text`, limit 100. Verify test passes
- [ ] 11.23 TDD: Write failing test — grep tool supports ignoreCase and path parameters
- [ ] 11.24 Implement ignoreCase and path support. Verify test passes
- [ ] 11.25 TDD: Write failing test — createFindTool(cwd) returns a tool that locates files with fd
- [ ] 11.26 Implement `src/find.ts` — factory function, spawn `fd --glob --hidden --no-require-git`, return relative paths, limit 1000. Verify test passes
- [ ] 11.27 TDD: Write failing test — createLsTool(cwd) returns a tool that lists directory contents
- [ ] 11.28 Implement `src/ls.ts` — factory function, fs.readdir + fs.stat, sorted, `/` suffix for dirs, limit 500. Verify test passes
- [ ] 11.29 TDD: Write failing test — ls tool lists subdirectory when path parameter is provided
- [ ] 11.30 Implement subdirectory listing. Verify test passes
- [ ] 11.31 Create `src/index.ts` re-exporting all tool factory functions

## 12. Integration Verification

- [ ] 12.1 TDD: Write failing test — create AgentLoop with SqliteSessionStore + coding tools, send a prompt that triggers read + edit tools, verify full cycle: messages persisted to SQLite, events yielded correctly
- [ ] 12.2 Set up integration test using real SqliteSessionStore and real tools (with temp directories). Verify test passes
- [ ] 12.3 Run `bun run typecheck` across all packages — verify zero errors
- [ ] 12.4 Run all tests across all packages — verify 100% pass rate
