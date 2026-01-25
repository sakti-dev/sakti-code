# ekacode Development Roadmap

## Overview

This roadmap outlines the development path for **ekacode** - an offline-first AI coding agent desktop app - to achieve feature parity with **OpenCode** while maintaining our unique architecture based on the PRD specifications.

## Current Progress (2025-01-25)

**✅ Completed:**

- **Phase 0**: Foundation (monorepo, Electron bootstrap, dev infrastructure)
- **Phase 1**: Server & Agent Core (Hono server, Mastra instance, Permission system, Desktop IPC integration)
- **Phase 2.1**: Tool Infrastructure (Zod validation, tool context, truncation, registry)
- **Phase 2.2**: Filesystem Tools (all 7 tools: read, write, edit, multiedit, apply_patch, ls, glob)

**🚧 In Progress:**

- **Phase 1.3**: Protocol Bridge (Mastra → TanStack)
  - 1.3.1: `@tanstack-ai-mastra` adapter package
  - 1.3.2: `/api/chat` SSE endpoint

**📋 Next Up:**

- **Phase 2.3**: Shell Tool
- **Phase 2.4**: Search Tools (grep, codesearch, websearch, webfetch)

---

**Technology Stack Differences:**
| Component | OpenCode | ekacode (PRD) |
|-----------|----------|---------------|
| Shell | Bun | Node.js |
| Desktop | Tauri (Rust) | Electron |
| UI Framework | SolidJS + OpenTUI | SolidJS + TanStack AI |
| Agent Orchestration | Custom | Mastra |
| Server | Hono (Bun) | Hono (Node) |
| Memory | Drizzle (PostgreSQL) | libSQL OR stdio Python+Chroma |
| LLM SDK | Vercel AI SDK | Vercel AI SDK + Mastra |

---

## Phase 0: Foundation (Weeks 1-2)

### 0.1 Project Setup

- [x] Initialize monorepo with Turborepo
- [x] Set up package structure:
  ```
  packages/
    main/          # Electron main process
    preload/       # Electron preload bridge
    renderer/      # SolidJS UI
    server/        # Hono server (shared)
    ekacode/       # main coding agent
    shared/        # Shared types/utilities
  ```
- [x] Configure TypeScript (ESM, strict mode)
- [x] Set up ESLint, Prettier, Husky
- [x] Configure `electron-vite` or custom Vite setup

### 0.2 Electron Bootstrap

- [x] Create main process with secure defaults:
  - `contextIsolation: true`
  - `nodeIntegration: false`
  - `sandbox: true`
- [x] Create preload bridge with `contextBridge`
- [x] Implement window creation with proper security
- [x] Add hot-reload for development

### 0.3 Development Infrastructure

- [x] Set up build pipeline (Vite for renderer, electron-builder for packaging)
- [x] Configure environment variable handling
- [x] Set up local development workflow
- [x] Add basic logging infrastructure

**Acceptance Criteria:**

- Electron window opens with renderer running
- Renderer cannot access Node APIs
- Hot-reload works in development
- Clean build produces working executable

---

## Phase 1: Server & Agent Core (Weeks 3-5)

### 1.1 Hono Server in Main Process

- [x] Start Hono server on random port (127.0.0.1 only)
- [x] Generate ephemeral bearer token at startup
- [x] Implement auth middleware (Bearer token validation)
- [x] Add CORS configuration for localhost
- [x] Implement graceful shutdown

**API Endpoints:**

```typescript
GET  /system/status      // Server health check
GET  /path               // Get workspace paths
GET  /vcs                // VCS info (git branch)
GET  /agent              // List available agents
GET  /skill              // List available skills
POST /auth/:providerID   // Set credentials
GET  /event              // SSE event stream
```

### 1.2 Mastra Integration

- [x] Install and configure `@mastra/core`
- [x] Create Mastra instance with default configuration
- [x] Define base agents (build, plan, general)
- [x] Set up model provider routing (OpenAI, Anthropic, etc.)
- [x] Configure streaming with Vercel AI SDK

### 1.3 Protocol Bridge (Mastra → TanStack)

#### 1.3.1 TanStack AI Adapter Package

**Create `@tanstack-ai-mastra` package** - Adapter bridging Mastra's gateway system with TanStack AI

**Package Structure:**

```
packages/tanstack-ai-mastra/
├── src/
│   ├── index.ts              # Main exports
│   ├── adapters/
│   │   └── text.ts           # MastraTextAdapter implementation
│   ├── types.ts              # Type definitions
│   ├── stream.ts             # Stream transformation utilities
│   ├── convert.ts            # Message/tool conversion
│   └── structured-output.ts  # Structured output strategies
├── package.json
└── README.md
```

**Implementation Checklist:**

- [ ] Create package with dependencies: `@mastra/core`, `@tanstack/ai`
- [ ] Implement `MastraTextAdapter` extending `BaseTextAdapter`
- [ ] Create `mastraText(modelId, config?)` factory function
- [ ] Implement `convertToAISDKMessages()` for message transformation
- [ ] Implement `convertToolsToAISDK()` for tool schema conversion
- [ ] Create `transformMastraStreamToTanStack()` for stream mapping:
  ```
  text-delta        → content
  reasoning-delta   → thinking
  tool-call         → tool_call
  tool-result       → tool_result
  finish            → done
  error             → error
  ```
- [ ] Implement `ToolCallAccumulator` for streaming tool call buffering
- [ ] Add `structuredOutput()` with provider detection:
  - NATIVE_JSON_SCHEMA (OpenAI, Gemini)
  - TOOL_BASED (Anthropic)
  - CONSTRAINED_DECODING (Mistral)
  - INSTRUCTION_ONLY (fallback)
- [ ] Add comprehensive error handling and edge case management

**Type Safety:**

- [ ] Export `MastraTextModelId = ModelRouterModelId`
- [ ] Export `MastraTextProviderOptions`
- [ ] Export `MastraInputModalities` and metadata types

**Testing:**

- [ ] Unit tests for message/tool conversion
- [ ] Stream transformation tests
- [ ] Tool call accumulation tests
- [ ] Structured output parsing tests
- [ ] Multi-provider integration tests (openai, anthropic, google)

#### 1.3.2 SSE Endpoint

- [ ] Create `/api/chat` SSE endpoint using `MastraTextAdapter`
- [ ] Implement TanStack `fetchServerSentEvents` compatibility
- [ ] Handle AbortSignal for cancellation
- [ ] Implement reconnection support with backoff
- [ ] Add auth middleware (Bearer token validation)

### 1.4 Permission System

- [x] Define permission rules schema
- [x] Implement permission evaluation engine (PermissionManager)
- [x] Create event-based approval system
- [x] Add external directory detection
- [x] Implement question/answer flow for approvals

**Acceptance Criteria:**

- Server starts on random loopback port ✅
- `@tanstack-ai-mastra` adapter implements TanStack `BaseTextAdapter` interface
- Adapter transforms Mastra streams to TanStack `StreamChunk` format
- `/api/chat` SSE endpoint streams TanStack-compatible chunks
- Structured output works across multiple providers (OpenAI, Anthropic, Gemini)
- Agent can generate and stream responses ✅
- Permission system blocks unauthorized operations ✅

---

## Phase 2: Core Tools (Weeks 6-8)

### 2.1 Tool Infrastructure

- [x] Define `Tool.Info` interface with Zod validation
- [x] Create `Tool.define()` helper (via Mastra `createTool`)
- [x] Implement tool context (sessionID, abort, metadata, ask)
- [x] Add output truncation for large results
- [x] Create tool registry

### 2.2 Filesystem Tools

| Tool          | Status | Description                   |
| ------------- | ------ | ----------------------------- |
| `read`        | ✅     | Read file contents            |
| `write`       | ✅     | Write file with diff preview  |
| `edit`        | ✅     | Edit file with search/replace |
| `multiedit`   | ✅     | Batch edit multiple files     |
| `apply_patch` | ✅     | Apply unified diff            |
| `ls`          | ✅     | List directory                |
| `glob`        | ✅     | Glob pattern matching         |

**Features:**

- [x] Workspace sandboxing (path canonicalization)
- [x] External directory detection
- [x] Truncation for large files
- [ ] Streaming output for large reads (future)

### 2.3 Shell Tool

- [ ] Implement `bash` tool with:
  - Command parsing with tree-sitter-bash
  - Working directory support
  - Timeout configuration
  - Stream output capture
  - Exit code handling
- [ ] Add path traversal detection
- [ ] Implement shell process tree killing on abort
- [ ] Add command permission checking

### 2.4 Search Tools

| Tool         | Description           |
| ------------ | --------------------- |
| `grep`       | Search file contents  |
| `codesearch` | Semantic code search  |
| `websearch`  | Web search capability |
| `webfetch`   | Fetch web content     |

### 2.5 LSP Tool (Optional for v1)

- [ ] Integrate `vscode-languageserver-types`
- [ ] Create LSP client wrapper
- [ ] Support basic LSP features:
  - Go to definition
  - Find references
  - Document symbols
  - Diagnostics

### 2.6 Plan Tools

- [ ] `plan_enter` - Switch to plan mode
- [ ] `plan_exit` - Exit plan mode with approval
- [ ] Plan file management (.opencode/plans/\*.md)

**Acceptance Criteria:**

- All basic tools (read, write, bash, ls, glob, grep) working
- Workspace sandboxing enforced
- Tool approvals flow operational
- Large outputs properly truncated

---

## Phase 3: Memory Layer (Weeks 9-10)

### 3.1 Memory Backend (Choose One)

#### Option A: libSQL (Recommended for ekacode)

- [ ] Set up `@libsql/client`
- [ ] Create schema:

  ```sql
  CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,           -- best_practice | anti_pattern | gotcha
    topic TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    confidence REAL NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    scope TEXT NOT NULL,          -- global | project
    project_id TEXT,
    source TEXT,
    deprecated INTEGER DEFAULT 0
  );

  CREATE TABLE memory_tags (
    memory_id TEXT,
    tag TEXT,
    PRIMARY KEY (memory_id, tag)
  );

  CREATE TABLE memory_embeddings (
    memory_id TEXT PRIMARY KEY,
    embedding BLOB NOT NULL
  );
  ```

- [ ] Implement embedding generation in Node.js
- [ ] Create memory repository with CRUD operations

#### Option B: Stdio Python + Chroma

- [ ] Create Python stdio script
- [ ] Implement NDJSON protocol
- [ ] Set up Chroma with fast-embed
- [ ] Create Node.js stdio wrapper
- [ ] Implement graceful process management

### 3.2 Memory Features

- [ ] `recall_best_practices` tool
- [ ] Confidence-weighted retrieval
- [ ] Topic filtering
- [ ] Scope filtering (global/project)
- [ ] Memory types (best_practice, anti_pattern, gotcha, heuristic, example)

### 3.3 Memory Management

- [ ] Add memory to agent system prompt
- [ ] Implement confidence decay (optional v1)
- [ ] Create memory review UI (future)

**Acceptance Criteria:**

- Memory retrieval returns relevant best practices
- Agent uses memory in responses
- Memory can be added/managed
- Confidence and topic filtering work

---

## Phase 4: Renderer UI (Weeks 11-14)

### 4.1 TanStack AI Integration

- [ ] Install `@tanstack-ai/react` and `@tanstack-ai-mastra`
- [ ] Set up `useChat` with `fetchServerSentEvents`
- [ ] Configure auth headers from preload
- [ ] Implement streaming message rendering using `@tanstack-ai-mastra` adapter
- [ ] Add stop/cancel functionality with AbortSignal
- [ ] Connect to `/api/chat` SSE endpoint from Phase 1.3.2

### 4.2 Core UI Components

- [ ] Chat message list with virtual scrolling
- [ ] Message input composer
- [ ] Code block rendering with syntax highlighting
- [ ] Tool call display with expandable output
- [ ] Approval request UI (Approve/Deny buttons)
- [ ] Agent switcher (Tab to switch agents)

### 4.3 Layout & Navigation

- [ ] Sidebar with:
  - Thread history
  - Agent selector
  - Settings button
- [ ] Main chat area
- [ ] Tool output panel (collapsible)
- [ ] Status bar (connection, agent, model)
- [ ] Settings modal

### 4.4 Settings UI

- [ ] Model selection (provider + model)
- [ ] Temperature, max tokens configuration
- [ ] Workspace path picker
- [ ] Telemetry toggle (default off)
- [ ] Permission rules editor (optional v1)

### 4.5 File Operations UI

- [ ] Diff preview for file edits
- [ ] Apply/diff confirmation dialog
- [ ] External directory approval prompt
- [ ] Plan mode indicator

**Acceptance Criteria:**

- Messages stream in real-time
- Code blocks render with syntax highlighting
- Tool approvals work with Approve/Deny
- Settings persist and load correctly
- Agent switching works seamlessly

---

## Phase 5: Desktop Integration (Weeks 15-16)

### 5.1 IPC Bridge

- [x] Implement main process handlers:
  - `get-server-config` - Return URL + token ✅
  - `permission:response` - Permission approval responses ✅
  - `fs:watch-start` - File watcher start (stub)
  - `fs:watch-stop` - File watcher stop (stub)
- [ ] Define IPC channel constants in `shared/ipc.ts`
- [ ] Implement `pick-directory` - Native directory picker
- [ ] Implement `pick-file` - Native file picker
- [ ] Implement `fs-event` - File watcher events
- [ ] Expose typed API via preload `contextBridge`

### 5.2 File Watching

- [ ] Set up Chokidar watch on workspace
- [ ] Emit IPC events for file changes
- [ ] Subscribe to events in renderer
- [ ] Update UI on external file changes

### 5.3 Native Features

- [ ] File/folder pickers (Electron dialog API)
- [ ] System tray (optional v1)
- [ ] Notification support (optional v1)
- [ ] Window state persistence (size, position)

### 5.4 Server Management

- [x] Start Hono server in main process ✅
- [x] Pass server config to renderer via IPC ✅
- [ ] Restart server on settings changes
- [ ] Graceful shutdown on app quit

**Acceptance Criteria:**

- IPC communication works bidirectionally ✅
- File watchers notify renderer of changes
- Native dialogs work correctly
- Server lifecycle managed properly ✅

---

## Phase 6: Advanced Features (Weeks 17-19)

### 6.1 Agent System

- [ ] Multi-agent architecture:
  - `build` - Full access agent
  - `plan` - Read-only planning agent
  - `general` - Research subagent
  - `explore` - Codebase search specialist
- [ ] Agent switching workflow
- [ ] Subagent delegation
- [ ] Custom agent creation (from config)

### 6.2 Workflow Orchestration

- [ ] Implement Mastra vNext workflows
- [ ] Create planning workflow
- [ ] Create coding workflow with self-healing
- [ ] Add TDD enforcement (test → fail → fix → pass)
- [ ] Implement step-by-step execution

### 6.3 Advanced Memory (Optional v1)

- [ ] Query rewriting
- [ ] Hybrid search (vector + metadata filters)
- [ ] Memory extraction from git diffs
- [ ] Confidence reinforcement ("this helped")
- [ ] Project-scoped memory namespaces

### 6.4 MCP Integration

- [ ] Install `@modelcontextprotocol/sdk`
- [ ] Create MCP server registry
- [ ] Implement MCP tool bridge
- [ ] Support stdio MCP servers
- [ ] Add built-in MCP servers:
  - filesystem-mcp-server
  - github-mcp-server (optional)

**Acceptance Criteria:**

- Multiple agents with different permission levels
- Workflows coordinate multi-step tasks
- Memory retrieval is contextually relevant
- MCP servers can be dynamically loaded

---

## Phase 7: Polish & Production (Weeks 20-22)

### 7.1 Error Handling

- [ ] Structured error responses
- [ ] User-friendly error messages
- [ ] Error recovery flows
- [ ] Crash reporting (optional)

### 7.2 Performance

- [ ] Optimize bundle sizes
- [ ] Implement virtual scrolling for long conversations
- [ ] Lazy load code highlighter
- [ ] Cache LSP responses
- [ ] Debounce file watcher events

### 7.3 Testing

- [ ] Unit tests for core modules
- [ ] Integration tests for tools
- [ ] E2E tests with Playwright
- [ ] Agent behavior tests

### 7.4 Documentation

- [ ] User guide
- [ ] Developer documentation
- [ ] API documentation (OpenAPI)
- [ ] Contributing guidelines

### 7.5 Packaging & Distribution

- [ ] Configure electron-builder
- [ ] Code signing (macOS, Windows)
- [ ] Auto-update infrastructure
- [ ] Homebrew formula (optional)
- [ ] Scoop manifest (optional)
- [ ] AUR package (optional)

**Acceptance Criteria:**

- No critical bugs
- Performance meets goals (<200ms token latency)
- Tests pass with >80% coverage
- Documentation is complete
- Distribution works on all platforms

---

## Phase 8: Post-MVP Enhancements

### 8.1 Collaboration Features

- [ ] Multi-user sessions
- [ ] Shared workspaces
- [ ] Team analytics

### 8.2 Advanced AI Features

- [ ] Multi-model routing
- [ ] Cost optimization
- [ ] Custom fine-tuning support

### 8.3 Enterprise Features

- [ ] SSO integration
- [ ] Audit logging
- [ ] Custom tool marketplace

### 8.4 Mobile Client

- [ ] Progressive Web App
- [ ] React Native client
- [ ] Remote server connection

---

## Success Metrics

| Metric                   | Target                |
| ------------------------ | --------------------- |
| First paint time         | <2s                   |
| Chat send to first token | <1s                   |
| Tool output streaming    | <500ms chunk interval |
| Memory retrieval         | <100ms                |
| Bundle size (renderer)   | <2MB                  |
| Test coverage            | >80%                  |
| Crash rate               | <0.1%                 |

---

## Dependencies

This roadmap assumes completion of:

- ✅ PRD finalization
- ✅ Technology stack selection
- ✅ Initial project research

## Risk Mitigation

| Risk                          | Mitigation                          |
| ----------------------------- | ----------------------------------- |
| Mastra vNext API changes      | Pin version, update gradually       |
| Electron security regressions | Automated security audits           |
| SSE connection stability      | Implement reconnection with backoff |
| Large file performance        | Implement streaming and truncation  |
| Memory layer scalability      | Benchmark with 10K+ memories        |

---

_Last Updated: 2026-01-26 (Phase 1 + 2.1 + 2.2 Complete; Phase 1.3 In Progress - added @tanstack-ai-mastra adapter)_
_Based on OpenCode feature analysis and ekacode PRD_
