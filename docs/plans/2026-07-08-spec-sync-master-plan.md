# OpenSpec Full Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring all OpenSpec main specs (`openspec/specs/`) in sync with the actual codebase, organized by package, bottom-up through the dependency graph.

**Architecture:** Process one package at a time, reading the actual code as source of truth. Each package produces one spec per tool/capability (not one spec per package). Use MCP knowledge graph for code discovery; `./docs/plans/` is optional context only (non-authoritative). Existing specs are updated in-place; new specs are created following the format inferred from existing ones.

**Tech Stack:** codebase-memory-mcp (knowledge graph), TypeScript codebase, OpenSpec markdown format

---

## Progress Checklist

> **After completing each package (all its capability specs), update this checklist by changing `[ ]` to `[x]` and noting the date/session.**

- [x] `@sakti-code/logger` — 8 capability specs (2026-07-08)
- [x] `@sakti-code/sakti` — 9 capability specs (2026-07-08)
- [x] `@sakti-code/tools` — 10 capability specs (2026-07-08)
- [x] `@sakti-code/db` — 4 capability specs (3 updated + 1 new OM, 2026-07-08)
- [x] `@sakti-code/llm` — 2 capability specs (2026-07-08)
- [x] `@sakti-code/agent` — 7 capability specs (3 updated + 4 new, 2026-07-08)
- [x] `apps/server` — 4 capability specs (1 rewritten + 3 new, 2026-07-08)
- [x] `apps/desktop` — 7 capability specs (1 updated + 6 new, 2026-07-08)

---

## Prerequisites

- MCP index is fresh (re-index with `moderate` mode if stale)
- Work through packages in dependency order: logger → sakti → tools → db → llm → agent → apps/server → apps/desktop

---

## Per-Package Workflow

For each package, the engineer executing this plan must follow these steps:

### Step 1: Map the package

Use `get_architecture(path=<package>)` to understand modules, exports, public surface, and clusters. Identify the distinct capabilities/tools within the package — each will get its own spec.

**Example:**

```
packages/tools/src/ has: bash/, edit/, find/, grep/, read/, write/, webfetch/, websearch/, transition/, lib/
→ Capabilities: read, write, edit, bash, grep, find, webfetch, websearch, transition
```

### Step 2: Check existing specs

- List specs in `openspec/specs/` that relate to this package
- Check `openspec/changes/*/specs/` for any unsynced delta specs
- Note: existing specs may be stale — read them for format reference, not as source of truth

### Step 3: Gather context (optional)

Skim `./docs/plans/` for any relevant design docs about this package. This is reference only — the code is the source of truth.

### Step 4: Deep-read the code

For each capability/tool identified in Step 1:

1. Use `search_graph` to find the main exports and factory functions
2. Use `get_code_snippet` to read full implementations
3. Use `trace_path` to understand call relationships and data flow
4. Read `__tests__/` to understand edge cases and expected behavior

Focus on:

- Public API (exported functions, their params and return types)
- Contracts and invariants
- Error handling
- Edge cases ( timeouts, missing files, invalid input )
- Configuration options
- Dependencies on other packages

### Step 5: Write/update the spec

For each capability, write or update `openspec/specs/<capability>/spec.md`:

**Format** (inferred from existing specs):

```markdown
## Purpose

[2-3 sentences describing what this capability does and where it fits]

## Requirements

### Requirement: [Name]

[Description of the requirement]

#### Scenario: [Name]

- **WHEN** [condition]
- **THEN** [expected result]

#### Scenario: [Edge case]

- **WHEN** [condition]
- **THEN** [expected result]
```

**Rules:**

- One spec per capability/tool (e.g., `openspec/specs/tool-read/spec.md`, not `openspec/specs/coding-tools/spec.md`)
- Scenario-level depth (WHEN/THEN) for all important behaviors including edge cases
- Source of truth is the code — if code behavior differs from existing spec, code wins
- Preserve the existing spec's format conventions exactly
- If a capability has no existing spec, create it with Purpose + Requirements sections
- **Describe the contract from the caller's perspective** — use "the system SHALL", "the tool SHALL", "the logger SHALL", not "the `createXxx` function SHALL"
- **No internal implementation function names in scenarios** — don't reference internal function names like `describeError`, `inferDomain`, `mergeContext`, `safeStringify`, factory names, etc. These are implementation details. Describe the behavior instead.
- **No implementation logic in requirement descriptions** — describe WHAT (contract, output, side effects), not HOW (internal processing steps, regex patterns, data flow through functions)
- Backtick formatting for parameter shapes and example values is OK — existing specs do this (e.g., `{ path, offset?, limit? }`)

### Step 6: Verify

After writing/updating all specs for a package:

- Review each spec against the code one more time
- Ensure all exported functions are covered
- Ensure all error paths have scenarios
- No orphaned or redundant requirements

---

## Package Task List

### Task 1: `@sakti-code/logger`

**Source:** `packages/logger/src/` (13 files, 46 functions)

**Capabilities to spec (per sub-module):**

| Capability        | Spec path                                      | Source files                        | Notes                                                                                                            |
| ----------------- | ---------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| console-logger    | `openspec/specs/logger-console/spec.md`        | `console.ts`                        | `createLogger`, `createDomainLogger`, `createConsoleLogger`, `createBaseLogger`, log level filtering, formatting |
| pino-logger       | `openspec/specs/logger-pino/spec.md`           | `node/pino.ts`, `node/pino-args.ts` | `createPinoLogger`, Node.js server-side logging                                                                  |
| describe-error    | `openspec/specs/logger-describe-error/spec.md` | `describe-error.ts`                 | `describeError` — structured error descriptions                                                                  |
| error-fields      | `openspec/specs/logger-error-fields/spec.md`   | `error-fields.ts`                   | `extractErrorFields`                                                                                             |
| forwarding-logger | `openspec/specs/logger-forwarding/spec.md`     | `forwarding.ts`                     | `createForwardingLogger` — proxy logger                                                                          |
| infer-domain      | `openspec/specs/logger-infer-domain/spec.md`   | `infer-domain.ts`                   | `inferDomain`                                                                                                    |
| noop-logger       | `openspec/specs/logger-noop/spec.md`           | `noop.ts`                           | `createNoopLogger`                                                                                               |
| logger-types      | `openspec/specs/logger-types/spec.md`          | `types.ts`, `index.ts`              | Shared types, `LogLevel`, `LogEntry`, etc.                                                                       |

**Existing specs:** None — all new.

**Context docs:** `./docs/plans/` may have logging-related plans.

---

### Task 2: `@sakti-code/sakti`

**Source:** `packages/sakti/src/` (62+ files, 152 functions, 107 methods)

**Capabilities to spec (grouped by domain):**

| Capability            | Spec path                                      | Source area                | Notes                                                                |
| --------------------- | ---------------------------------------------- | -------------------------- | -------------------------------------------------------------------- |
| sdd-workflow          | `openspec/specs/sdd-workflow/spec.md`          | `sdd/commands/workflow/`   | new-change, status, continue, ff, archive, verify commands           |
| sdd-doctor            | `openspec/specs/sdd-doctor/spec.md`            | `sdd/commands/doctor.ts`   | Health check / validation                                            |
| sdd-spec              | `openspec/specs/sdd-spec/spec.md`              | `sdd/commands/spec.ts`     | Spec operations                                                      |
| sdd-state             | `openspec/specs/sdd-state/spec.md`             | `sdd/commands/state.ts`    | `stateGet`, `stateSet`, `stateTransition`                            |
| sdd-spec-validation   | `openspec/specs/sdd-spec-validation/spec.md`   | `sdd/core/validators/`     | Spec validation rules                                                |
| sdd-spec-parsers      | `openspec/specs/sdd-spec-parsers/spec.md`      | `sdd/core/parsers/`        | Markdown spec parsing, delta spec parsing, requirement block parsing |
| sdd-artifact-graph    | `openspec/specs/sdd-artifact-graph/spec.md`    | `sdd/core/artifact-graph/` | Schema, artifact graph, resolution                                   |
| sdd-change-management | `openspec/specs/sdd-change-management/spec.md` | `sdd/core/change-` files   | Change creation, metadata, task progress                             |
| sdd-root-selection    | `openspec/specs/sdd-root-selection/spec.md`    | `sdd/core/root-selection/` | `toRootOutput`, `resolveRootForCommand`                              |
| sdd-file-utils        | `openspec/specs/sdd-file-utils/spec.md`        | `sdd/utils/file-system/`   | `FileSystemUtils` — readFile, writeFile, canonicalize, etc.          |
| sdd-cli               | `openspec/specs/sdd-cli/spec.md`               | Top-level CLI entry        | `buildSddProgram`, command registration                              |

**Existing specs:** None — all new.

**Note:** This is the largest package. Consider splitting across multiple sessions.

---

### Task 3: `@sakti-code/tools`

**Source:** `packages/tools/src/` (subdirectories: bash/, edit/, find/, grep/, read/, write/, webfetch/, websearch/, transition/, lib/)

**Capabilities to spec:**

| Capability      | Spec path                                | Existing spec                       | Notes                                                          |
| --------------- | ---------------------------------------- | ----------------------------------- | -------------------------------------------------------------- |
| tool-read       | `openspec/specs/tool-read/spec.md`       | Partially in `coding-tools/spec.md` | File/directory reading, offset/limit, truncation               |
| tool-write      | `openspec/specs/tool-write/spec.md`      | Partially in `coding-tools/spec.md` | File creation/overwrite, parent dir creation                   |
| tool-edit       | `openspec/specs/tool-edit/spec.md`       | Partially in `coding-tools/spec.md` | Exact text replacement, atomic edits, replaceAll               |
| tool-bash       | `openspec/specs/tool-bash/spec.md`       | Partially in `coding-tools/spec.md` | Shell execution, timeout, streaming, abort                     |
| tool-grep       | `openspec/specs/tool-grep/spec.md`       | Partially in `coding-tools/spec.md` | ripgrep wrapper, smart-case, context lines, limits             |
| tool-find       | `openspec/specs/tool-find/spec.md`       | Partially in `coding-tools/spec.md` | File pattern search, bare name fragments, glob                 |
| tool-webfetch   | `openspec/specs/tool-webfetch/spec.md`   | New                                 | Web content fetching                                           |
| tool-websearch  | `openspec/specs/tool-websearch/spec.md`  | New                                 | Web search                                                     |
| tool-transition | `openspec/specs/tool-transition/spec.md` | New                                 | Transition tool                                                |
| tool-factory    | `openspec/specs/tool-factory/spec.md`    | New                                 | Common tool creation patterns, AgentTool interface conformance |

**Existing specs:** `openspec/specs/coding-tools/spec.md` — currently a monolithic spec covering all tools. Will be superseded by per-tool specs. **Do NOT delete `coding-tools/spec.md`** — it will be deprecated naturally once per-tool specs exist.

**Context docs:** Check `./docs/plans/` for tool design docs.

---

### Task 4: `@sakti-code/db`

**Source:** `packages/db/src/`

**Capabilities to spec:**

| Capability           | Spec path                                     | Existing spec | Notes                                 |
| -------------------- | --------------------------------------------- | ------------- | ------------------------------------- |
| database-schema      | `openspec/specs/database-schema/spec.md`      | Yes           | Drizzle ORM schema definitions        |
| database-repos       | `openspec/specs/database-repos/spec.md`       | Yes           | Repository layer                      |
| session-store-sqlite | `openspec/specs/session-store-sqlite/spec.md` | Yes           | SQLite implementation of SessionStore |

**Existing specs:** Three specs exist. Read the code to verify accuracy and update.

---

### Task 5: `@sakti-code/llm`

**Source:** `packages/llm/src/`

**Capabilities to spec:**

| Capability     | Spec path                               | Existing spec | Notes                                  |
| -------------- | --------------------------------------- | ------------- | -------------------------------------- |
| llm-provider   | `openspec/specs/llm-provider/spec.md`   | New           | Provider abstraction, model resolution |
| llm-models-dev | `openspec/specs/llm-models-dev/spec.md` | New           | models.dev data integration            |

**Existing specs:** None — all new.

---

### Task 6: `@sakti-code/agent`

**Source:** `packages/agent/src/`

**Capabilities to spec:**

| Capability          | Spec path                                    | Existing spec | Notes                                     |
| ------------------- | -------------------------------------------- | ------------- | ----------------------------------------- |
| agent-session-store | `openspec/specs/agent-session-store/spec.md` | Yes           | SessionStore interface                    |
| agent-loop          | `openspec/specs/agent-loop/spec.md`          | Yes           | Core execution loop                       |
| agent-streaming     | `openspec/specs/agent-streaming/spec.md`     | Yes           | Streaming events                          |
| agent-tool-registry | `openspec/specs/agent-tool-registry/spec.md` | New           | Tool registration and dispatch            |
| agent-compaction    | `openspec/specs/agent-compaction/spec.md`    | New           | Context compaction                        |
| agent-policy        | `openspec/specs/agent-policy/spec.md`        | New           | System prompt composition, builtin agents |
| agent-retry         | `openspec/specs/agent-retry/spec.md`         | New           | Retry logic for LLM errors                |

**Existing specs:** Four exist (`agent-session-store`, `agent-loop`, `agent-streaming` — check for more). Need to verify and potentially add new capability specs.

---

### Task 7: `apps/server`

**Source:** `apps/server/src/`

**Capabilities to spec:**

| Capability       | Spec path                                 | Existing spec  | Notes                            |
| ---------------- | ----------------------------------------- | -------------- | -------------------------------- |
| server-rest-api  | `openspec/specs/server-rest-api/spec.md`  | Yes            | Hono REST endpoints              |
| server-websocket | `openspec/specs/server-websocket/spec.md` | New or partial | WS streaming protocol            |
| server-auth      | `openspec/specs/server-auth/spec.md`      | New            | API key management, auth.json    |
| server-context   | `openspec/specs/server-context/spec.md`   | New            | Context injection, ctxMiddleware |

**Existing specs:** `server-rest-api` exists. Others may need creating.

---

### Task 8: `apps/desktop`

**Source:** `apps/desktop/src/` (SolidJS renderer + Electron shell)

**Capabilities to spec:**

| Capability                    | Spec path                                              | Existing spec | Notes                                           |
| ----------------------------- | ------------------------------------------------------ | ------------- | ----------------------------------------------- |
| desktop-electron-app          | `openspec/specs/desktop-electron-app/spec.md`          | Yes           | Electron shell, main process, IPC, build        |
| desktop-preload               | `openspec/specs/desktop-preload/spec.md`               | New           | Preload script, contextBridge, IPC channels     |
| desktop-renderer-app          | `openspec/specs/desktop-renderer-app/spec.md`          | New           | SolidJS app shell, ThemeProvider, StoreProvider |
| desktop-renderer-stores       | `openspec/specs/desktop-renderer-stores/spec.md`       | New           | Store architecture, registries, workspace tabs  |
| desktop-renderer-connectivity | `openspec/specs/desktop-renderer-connectivity/spec.md` | New           | API client, WsClient, Actions facade            |
| desktop-renderer-chat         | `openspec/specs/desktop-renderer-chat/spec.md`         | New           | Chat area, timeline, input, event handlers      |
| desktop-renderer-ui           | `openspec/specs/desktop-renderer-ui/spec.md`           | New           | Layout, views, banners, settings                |

**Existing specs:** `desktop-electron-app` exists (updated). The SolidJS renderer is split into 5 sub-specs by domain.

---

## Session Strategy

This plan will span multiple sessions. Each session should:

1. Pick up from where the last session left off (check `openspec/specs/` for completed work)
2. Complete one full package (all its capability specs)
3. Commit after each capability spec is written/updated
4. At session end, note which package + capability was last completed

**After each package is complete:**

1. Commit all capability specs for that package
2. **Update the Progress Checklist above** — change `[ ]` to `[x]` and append the date (e.g., `[x] @sakti-code/logger — 8 capability specs (2026-07-08)`)

**Recommended commits per capability:**

```
git add openspec/specs/<capability>/
git commit -m "docs(specs): sync <capability> spec with codebase"
```

---

## Key Principles

1. **Code is source of truth** — if existing spec says X but code does Y, the spec is updated to Y
2. **Deep specs** — scenario-level WHEN/THEN covering happy paths AND edge cases
3. **Per-capability granularity** — one spec file per tool/capability, not per package
4. **Format consistency** — follow the exact format of existing specs (Purpose → Requirements → Scenarios)
5. **Optional context** — `./docs/plans/` is for context only, never authoritative
6. **MCP-first discovery** — use knowledge graph tools to map code before reading files
7. **Commit per capability** — small, atomic commits per spec update
8. **Idempotent** — running the workflow twice on the same package should produce the same result
