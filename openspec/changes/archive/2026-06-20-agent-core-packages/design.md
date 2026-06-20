## Context

sakti-code is an Electrobun desktop coding agent app (Bun + SolidJS) that currently consists of a starter scaffold. The goal is to build three core packages (`agent`, `db`, `tools`) that power a multi-project coding agent. These packages are dependencies of the desktop app — they don't form a standalone product.

We have two reference codebases:
- **Pi** (`openspec/references/pi`) — an AI coding agent framework providing `@earendil-works/pi-ai` (LLM streaming, 35+ providers) and the `pi-agent-core` agent loop implementation
- **PiBun** (`openspec/references/pibun`) — a desktop GUI for Pi showing how to wire an agent to a UI via WebSocket, with multi-session management patterns

Key constraint: Pi's `@earendil-works/pi-ai` is a published npm package (MIT, v0.79.8) providing the LLM provider abstraction. We use it directly instead of writing our own.

## Goals / Non-Goals

**Goals:**
- Build a pure agent loop that can run multiple independent instances (one per project), each with its own message history and tool set
- Provide a SQLite-backed persistence layer with type-safe queries via Drizzle ORM
- Define coding tools scoped to a project working directory
- Follow TDD — every function has a failing test before implementation
- Use deep modules (fewer files, richer interfaces) — PiBun's agent-first philosophy

**Non-Goals:**
- UI, server, or desktop app changes (future change)
- Extension/plugin system (future)
- Skills or prompt templates (future)
- Vector search/embeddings (future — sqlite-vec loaded later)
- Multi-window desktop support
- Cross-project tool access (each agent is sandboxed to its cwd)
- Session branching/forking (Pi's tree structure — add later if needed)

## Decisions

### 1. LLM streaming: use `@earendil-works/pi-ai` directly

**Choice**: Import `@earendil-works/pi-ai` as a dependency. Use its `streamSimple()` for LLM calls and its type system (`Message`, `Model`, `ToolCall`, `AssistantMessageEvent`, etc.).

**Alternatives considered**:
- Write our own provider abstraction → duplicated effort, 35+ providers to implement
- Fork Pi's ai package → maintenance burden, Pi is actively developed

**Rationale**: Published, MIT, battle-tested. Gives us every LLM provider out of the box. Our agent loop just calls its streaming API and handles tool calls.

### 2. Agent loop: own implementation, not Pi's SDK

**Choice**: Build our own agent loop in `packages/agent` that calls `pi-ai`'s streaming. Don't use Pi's `AgentHarness` or `AgentSession`.

**Alternatives considered**:
- Use `@earendil-works/pi-agent-core` → carries JSONL session persistence, jiti skill loading, extension lifecycle, tree branching — all things we don't want
- Use `@earendil-works/pi-coding-agent` SDK → pulls in entire coding agent CLI, session manager, system prompt — massive overkill

**Rationale**: Our agent loop is ~300 lines. Pi's harness is ~1500 lines with assumptions (JSONL sessions, extension hooks, tree branching, skill loading) that don't match our architecture. We want a tight loop: `messages → pi-ai stream → tool execution → append → repeat`. The interface is the same (stream events, tool calls), but the orchestration is ours.

### 3. Persistence: Drizzle ORM + bun:sqlite, agent defines interface

**Choice**: `packages/db` implements a `SessionStore` interface defined in `packages/agent`. Agent doesn't know about SQLite — it calls `store.loadMessages()`, `store.appendMessage()`, `store.replaceMessages()`.

**Alternatives considered**:
- Raw bun:sqlite in agent → agent becomes coupled to storage
- libsql (Turso) → no advantage for local desktop app, bun:sqlite is faster
- Agent owns persistence (like Pi) → can't do cross-project queries from app

**Rationale**: Clean dependency inversion. `agent → SessionStore interface ← db`. The app composes them. Drizzle gives type-safe queries. bun:sqlite is the fastest SQLite for Bun. WAL mode handles concurrent access from multiple agents.

### 4. Session storage: append-as-we-go

**Choice**: Every message (user, assistant, tool result) is written to SQLite immediately via `store.appendMessage()`. Partial turns are detectable by checking the last message sequence.

**Alternatives considered**:
- Flush at end of turn (Pi's approach) → crash loses entire turn
- Explicit turn markers → extra schema complexity

**Rationale**: Crash-safe with negligible write overhead (INSERTs are microseconds vs LLM calls taking seconds). Recovery is simple: check for sessions whose last message is a tool_result without a following assistant message.

### 5. Compaction: agent-owned flow, store executes

**Choice**: The agent decides when to compact (token budget exceeded) and what to compact (LLM summarizes old messages). The agent calls `store.replaceMessages(sessionId, [summary, ...recent])` to atomically replace old messages. The store handles the transaction.

**Rationale**: Compaction needs the LLM (agent concern) and needs to write to DB (store concern). The agent orchestrates, the store executes. Keeps the interface thin.

### 6. Retry: agent-internal, exponential backoff

**Choice**: The agent loop catches retryable errors (429, 5xx) and retries with exponential backoff. Emits retry events so the UI can show status. Max 3 retries by default.

**Alternatives considered**:
- Server orchestrates retry → more complex, server needs to understand LLM errors
- No retry → poor UX on transient failures

**Rationale**: Retry is an LLM concern. The server shouldn't need to know about rate limits. Pi does this internally and it works well.

### 7. Tools: separate package, cwd-scoped, pure functions

**Choice**: `packages/tools` exports factory functions (`createReadTool(cwd)`, `createBashTool(cwd)`, etc.) that return tool definitions conforming to the agent's `AgentTool` interface. Each tool is constructed with a fixed `cwd`.

**Alternatives considered**:
- Tools inside agent package → harder to test independently, can't have different tool sets
- Tools inside db package → wrong concern

**Rationale**: Tools are independent — they don't know about the agent loop or database. Keeping them separate allows testing in isolation and creating different tool sets for different agent types in the future.

### 8. Monorepo: 3 new packages + shared tsconfig.base.json

**Choice**: Add `packages/*` to workspace glob. Create `tsconfig.base.json` with strict TypeScript settings shared across all packages.

**Rationale**: Each package has its own `tsconfig.json` extending the base. Turbo orchestrates builds. Packages depend on each other via workspace references.

## Risks / Trade-offs

- **[pi-ai breaking changes]** → Pi is actively developed. Pin exact version in package.json. The `pi-ai` types are stable (Message, Model, streaming events) but internal APIs may change. We only use the public streaming API.
- **[bun:sqlite extension loading on macOS]** → Apple's built-in SQLite disables extensions. If we add sqlite-vec later, desktop builds need Homebrew SQLite linked via `Database.setCustomSQLite()`. Document in setup. Not a v1 concern.
- **[Deep coupling to pi-ai types]** → Our agent message types wrap or re-export pi-ai types. If pi-ai changes its message format, we need to adapt. Mitigation: our `AgentMessage` type is a superset — we own the wrapper, pi-ai types are in leaf positions.
- **[Concurrent SQLite writes]** → Multiple agents writing to one DB in WAL mode. bun:sqlite handles WAL locking internally. Writes are serialized but take microseconds — no practical bottleneck since agents are I/O-bound waiting for LLM responses.
- **[Tool execution safety]** → Bash tool runs arbitrary commands within cwd. No sandbox for v1. The LLM is trusted to not run destructive commands. Sandboxing (chroot, namespace) is a future enhancement.
