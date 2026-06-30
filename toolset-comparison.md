# Toolset Cross-Comparison: sakti-code vs opencode

> **sakti**: `packages/tools/src/` — 6 coding tools + propose-session
> **opencode**: `openspec/references/opencode/packages/core/src/tool/` — 12 builtin tools

---

## 1. Architecture & Framework

| Aspect              | sakti                                                                         | opencode                                                                      |
| ------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Runtime**         | Plain TypeScript, `child_process`, `fs/promises`                              | Effect-TS ecosystem (`effect` package)                                        |
| **Tool type**       | `AgentTool<TSchema, TDetails>` interface (name, params, execute, permissions) | Opaque `Tool.make({...})` value with `WeakMap`-hidden runtime                 |
| **Schema**          | TypeBox (`@sinclair/typebox`)                                                 | Effect Schema (`Schema.Struct`, `Schema.String`, etc.)                        |
| **Registration**    | Standalone `create*Tool(cwd, options)` factory functions                      | Self-registering `Layer.effectDiscard` that calls `Tools.Service.register()`  |
| **Services**        | No service layer; imports tools directly                                      | Full DI via `yield* Service` — `FSUtil.Service`, `PermissionV2.Service`, etc. |
| **Path resolution** | `resolveToCwd()` in `path-utils.ts`                                           | `LocationMutation.Service.resolve()` + `Location.Service`                     |
| **Error model**     | Thrown `Error` instances                                                      | `ToolFailure` tagged errors (`Effect.mapError`)                               |

---

## 2. Tool Inventory

### sakti (`packages/tools/src/`)

| Tool              | File                       | What it does                                                                                                                             |
| ----------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `bash`            | `bash/index.ts`            | Shell exec via `child_process.spawn()`, throttled streaming, temp file output                                                            |
| `edit`            | `edit/index.ts`            | 2 modes: **replace** (oldText/newText) and **hashline** (content-addressed line-anchored edits)                                          |
| `find`            | `find/index.ts`            | Glob search via bundled `rg --files`; `--no-ignore` (reaches gitignored content); excludes `.git`/`node_modules`; bare-fragment dispatch |
| `grep`            | `grep/index.ts`            | Regex search via bundled `rg`; single-pass `--json` match+context (no separate read); `--smart-case`; `--no-ignore`                      |
| `read`            | `read/index.ts`            | Text reading (offset/limit), image reading (photon resize), hashline mode, **directory listing**                                         |
| `write`           | `write/index.ts`           | Write file with parent dir creation, hashline snapshot                                                                                   |
| `propose-session` | `propose-session/index.ts` | Terminates agent turn with a self-contained task brief                                                                                   |

### opencode (`openspec/references/opencode/packages/core/src/tool/`)

| Tool          | File             | What it does                                                                        |
| ------------- | ---------------- | ----------------------------------------------------------------------------------- |
| `bash`        | `bash.ts`        | Shell exec via `AppProcess.Service`; permission-gated + external directory approval |
| `edit`        | `edit.ts`        | Exact string replace with normalization (BOM, line endings, fuzzy count)            |
| `apply_patch` | `apply-patch.ts` | Multi-file patch (add/update/delete) with sequential application                    |
| `glob`        | `glob.ts`        | Glob search via `Ripgrep.Service`, relative to Location                             |
| `grep`        | `grep.ts`        | Regex search via `Ripgrep.Service` with file/directory targeting                    |
| `read`        | `read.ts`        | Text paging, image detection, binary detection via `ReadToolFileSystem.Service`     |
| `write`       | `write.ts`       | Write with BOM preservation, stale-content detection                                |
| `question`    | `question.ts`    | Ask user questions with typed prompts + answers                                     |
| `skill`       | `skill.ts`       | Load skill by name, list directory files, return formatted output                   |
| `todowrite`   | `todowrite.ts`   | Create/update structured task list for a session                                    |
| `webfetch`    | `webfetch.ts`    | HTTP fetch with HTML→markdown conversion (Turndown), size-bounded                   |
| `websearch`   | `websearch.ts`   | Web search via Exa/Parallel MCP backends                                            |

---

## 3. Detailed Per-Tool Comparison

### 3.1 Bash

| Aspect           | sakti                                                                                                | opencode                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Execution**    | `child_process.spawn()` with shell                                                                   | `AppProcess.Service.run(ChildProcess)`                     |
| **Timeout**      | `setTimeout` + `SIGKILL`                                                                             | `Duration` + `forceKillAfter`                              |
| **Output**       | `OutputAccumulator` (rolling buffer, temp file fallback)                                             | `AppProcess.run()` bounded capture `maxOutputBytes: 1MB`   |
| **Throttling**   | 100ms update snapshots via `onUpdate` callback                                                       | N/A (runs to completion)                                   |
| **Streaming**    | Yes, incremental updates                                                                             | No                                                         |
| **Permission**   | `permissions()` emits `bash` (every command) + `external_directory` when a path resolves outside cwd | `PermissionV2.assert()` for command + external directories |
| **Command scan** | `command-scan.ts` — lightweight tokenizer for external paths                                         | Inline `shellTokens()` + `externalCommandDirectories()`    |
| **CWD default**  | Injected at tool creation                                                                            | Active Location (workspace-based)                          |
| **Shell config** | OS default (`/bin/sh` or `cmd.exe`)                                                                  | Configurable via `Config.Service`                          |

### 3.2 Edit

| Aspect              | sakti                                                                                                     | opencode                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Modes**           | **Replace** (oldText/newText) + **Hashline** (content-addressed)                                          | **Replace only** (oldString/newString)                                            |
| **Diff generation** | `edit-diff.ts`: unified diff (`diff` lib), numbered diff format                                           | Built into `toModelOutput()` — simple +/- preview lines                           |
| **Fuzzy matching**  | `fuzzyFindText()`: NFKC normalization, smart quotes, trim                                                 | None — **exact match only**                                                       |
| **Hashline**        | Full subsystem: `patcher.ts`, `apply.ts`, `parser.ts`, `tokenizer.ts`, `recovery.ts`, `block-resolver.ts` | Not present                                                                       |
| **Block editing**   | JSX-aware `BlockResolver` (native via `@sakti-code/pi-natives`)                                           | Not present                                                                       |
| **Boundary repair** | `repairReplacementBoundaries()` — echo detection, delimiter balance                                       | Not present                                                                       |
| **Noop guard**      | `NoopLoopGuard` — 3 identical noops → escalate                                                            | Not present                                                                       |
| **Stale detection** | Hashline: hash mismatch → recovery strategies                                                             | `FileMutation.writeIfUnchecked()` — compare expected bytes                        |
| **Snapshots**       | `InMemorySnapshotStore` (LRU, 100 paths, 10 versions/path)                                                | Not present                                                                       |
| **BOM handling**    | `stripBom()` in hashline-utils                                                                            | `splitBom()`/`joinBom()` inline                                                   |
| **Line endings**    | `detectLineEnding`/`normalizeToLF`/`restoreLineEndings`                                                   | Same pattern inline                                                               |
| **Permissions**     | Declares `edit` permission (`permissions()` → `{ permission: "edit", patterns: [path] }`)                 | `Tool.withPermission(tool, "edit")` — shares "edit" action with write/apply_patch |
| **Validation**      | Hash verification, noop detection, overlap detection                                                      | OldString count, identical-string check, empty-oldString check                    |

### 3.3 Read

| Aspect                | sakti                                                                                  | opencode                                                        |
| --------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Image detection**   | Magic bytes (JPEG, PNG, GIF, WebP) + EXIF orientation                                  | Magic bytes (same formats)                                      |
| **Image resize**      | `photon.ts` (WASM) — iterative quality/size reduction                                  | `Image.Service.normalize()`                                     |
| **EXIF**              | `exif-orientation.ts` — all 8 orientations via photon                                  | Not in tool; handled by `Image.Service`                         |
| **Text paging**       | `offset`/`limit` slicing + `truncateHead`                                              | `ReadToolFileSystem.Service.read()` with line-by-line streaming |
| **Binary detection**  | N/A (separate tool not needed)                                                         | Extension-based + null-byte + printable-ratio check             |
| **Hashline mode**     | Optional: computes hash, formats `[path#HASH]` header                                  | Not present                                                     |
| **Read root**         | CWD-based                                                                              | `Location.directory` with `FSUtil.contains()` escape guard      |
| **Page output**       | Truncated text with offset continuation notice                                         | `TextPage`/`ListPage` class with `next`, `truncated`, `offset`  |
| **Directory listing** | `read` dispatches on `inspect()` → `"directory"`, returns paged listing (offset/limit) | Same — `read` returns `ListPage` for directories                |

### 3.4 Write

| Aspect              | sakti                                                                                     | opencode                                                |
| ------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Parent dirs**     | Auto `mkdir({ recursive: true })`                                                         | Via `FileMutation.Service`                              |
| **Hashline**        | Records snapshot, returns `[path#HASH]`                                                   | Not present                                             |
| **BOM**             | Not explicitly handled                                                                    | `writeTextPreservingBom()`                              |
| **Stale detection** | Not present                                                                               | `writeIfUnchanged()` — compare expected vs actual bytes |
| **Permission**      | Declares `edit` permission (`permissions()` → `{ permission: "edit", patterns: [path] }`) | `externalDirectory` approval + `"edit"` action          |
| **Byte count**      | Returns `bytes` written                                                                   | Returns `operation`, `target`, `resource`, `existed`    |

### 3.5 Find / Glob

| Aspect                | sakti (`find`)                                                                                                                        | opencode (`glob`)                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Engine**            | Bundled `rg --files` via `@vscode/ripgrep` (absolute path injected); custom glob via DI seam                                          | `Ripgrep.Service.glob()`                   |
| **Defaults**          | `--no-ignore` (reaches gitignored content so it never falsely reports empty); excludes `.git`/`node_modules`                          | No built-in exclude                        |
| **Fragment dispatch** | Bare name fragment (`Button`) → `**/*Button*` substring glob; real glob passthrough                                                   | Pattern passed through verbatim            |
| **Limit**             | Default 1000                                                                                                                          | No default (uses `MAX_SAFE_INTEGER`)       |
| **Operations API**    | `FindOperations` interface (DI seam) for testing                                                                                      | No test abstraction (uses Effect services) |
| **Permission**        | Declares `glob` permission with dispatched glob (`permissions()` → `{ permission: "glob", patterns: [resolveGlobPattern(pattern)] }`) | `PermissionV2.assert()` + metadata         |

### 3.6 Grep

| Aspect              | sakti                                                                                                    | opencode                        |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **Engine**          | Bundled `rg` via `@vscode/ripgrep`; `--json` + `--smart-case` + `--no-ignore`                            | `Ripgrep.Service.grep()`        |
| **Context**         | Single-pass from rg's own `context` JSON records (no separate `readFile` — that was the garbling source) | Not in tool (just match + line) |
| **Line truncation** | 500 chars max, tool-side (`--max-columns` ignored under `--json`)                                        | Not explicitly in this tool     |
| **Dedup**           | Match vs context separators (`:` vs `-`) in one stream                                                   | No dedup (raw matches)          |
| **Operations API**  | None — `GrepOperations` removed (the separate-read seam was the bug)                                     | No test abstraction             |

### 3.7 Directory listing

| Aspect             | sakti (in `read`)                            | opencode (in `read`)                              |
| ------------------ | -------------------------------------------- | ------------------------------------------------- |
| **Separate tool?** | No — `read` handles `"directory"` type       | No — `read` handles `"directory"` type            |
| **Output format**  | Sorted case-insensitive, `/` suffix for dirs | `ListPage` class with sorted entries (dirs first) |
| **Concurrency**    | Sequential stat                              | 16-way concurrent stat via `Effect.forEach`       |

> Note: sakti previously exposed a standalone `ls` tool; it was removed and its behavior folded into `read` (which dispatches on `inspect()` → `"directory"` to return a paged listing).

---

## 4. Registry & Lifecycle

### sakti

Tools are **created at call-time** via factory functions:

```ts
const tool = createBashTool(cwd, { autoResizeImages: true });
// Later:
tool.execute({ command: "ls" }, { signal, onUpdate });
```

No central registry — tools are used directly by the agent loop.

### opencode

Tools are **self-registering layers** in a two-tier registry:

```
ApplicationTools.Service (process-scoped)
  ← user calls opencode.tools.register({ name: tool })

ToolRegistry.Service (Location-scoped)
  ← builtins register via layer composition
  ← overlays Location registrations over Application registrations
  → materialize() produces { definitions[], settle() }
```

Registration is scope-managed: closing a Scope removes that registration and reveals the prior one. Location registrations take precedence over application registrations. A materialized snapshot captures the effective tool once settlement starts.

---

## 5. Permissions

### sakti

Each `AgentTool` optionally declares the permissions a call would touch:

```ts
permissions?: (params: unknown) => PermissionRequest[] | undefined
// where PermissionRequest = { permission: string; patterns: string[] }
```

Tools emit one or more permission tags per call — e.g. `bash` emits `{ permission: "bash", patterns: [command] }` on every command plus `{ permission: "external_directory", patterns: [...] }` when a referenced path resolves outside cwd; `edit`/`write` emit `{ permission: "edit", patterns: [path] }`; `read` emits `{ permission: "read", ... }`; `find` emits `glob`; `grep` emits `grep`.

These declarations **gate execution**, not just inform the UI. The runner (`apps/server/src/agent/runner.ts`) wires a centralized evaluator:

```ts
harness.setPermissionEvaluator((permission, pattern) =>
  permissionChannel.evaluate(permission, pattern, agentRuleset),
);
harness.setPermissionAskResolver((req) => permissionChannel.ask(req));
```

- Each agent carries a `PermissionRuleset` (built via `fromConfig()` in `apps/server/src/agent/config/server-agents.ts`) — e.g. `build` is `*: allow` (with `external_directory` and `.env` reads gated to `ask`); `intake` gates `rm *`, `git push*`, `git reset --hard*` to `ask`; `explore` is read-only (`*: deny` except read/grep/glob/bash).
- `evaluate()` (`packages/agent/src/agents/permission.ts`) does last-match-wins glob matching over `permission` + `pattern`; no matching rule defaults to `ask`.
- The `PermissionChannel` (`apps/server/src/lib/permission-channel.ts`) bridges to the WS approval strip: `ask()` prompts the user, `"always"` replies persists a grant for the session, grants are merged on top of the base ruleset so prior approvals auto-allow.
- Cwd is only consulted for the `external_directory` permission (via `command-scan.ts`); the `bash` permission matches the raw command text and is cwd-independent.

### opencode

Elaborate permission system via `PermissionV2.Service`:

```ts
yield *
  permission.assert({
    action: "edit",
    resources: ["src/file.ts"],
    save: ["*"],
    sessionID: context.sessionID,
    agent: context.agent,
    source: { type: "tool", messageID, callID },
  });
```

- Tools declare a permission action (default: tool name; edit/write/apply_patch: `"edit"`)
- `whollyDisabled()` checks if permission rules deny all access
- External directories require separate `external_directory` approval first
- `save` field persists approved permissions for future use

---

## 6. Output & Truncation

### sakti

- `truncateHead()` / `truncateTail()` — line + byte budget with continuation notices
- `truncateLine()` — 500-char line truncation with `... [truncated]`
- UTF-8-safe byte counting via `Buffer.byteLength`

### opencode

- `ToolOutputStore.Service.bound()` — generic output bounding with managed retention paths
- Builtins return complete validated domain output
- Registry-level `settle()` is the single bounding boundary
- Producer-level limits are separate (e.g., `AppProcess.maxOutputBytes`) and accurately reported

---

## 7. Key Design Differences Summary

| Concept                  | sakti                                                                               | opencode                                                   |
| ------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Framework**            | Plain TS + TypeBox + `child_process`                                                | Effect-TS (services, layers, schemas)                      |
| **Testability**          | `Operations` interfaces (DI via constructor)                                        | Effect service substitution via layers                     |
| **Edit sophistication**  | High — hashline with recovery, block-edit, noop guard                               | Low — exact replace only (fuzzy deferred)                  |
| **Permission**           | Per-tool declarations + centralized evaluator (`PermissionChannel`, agent rulesets) | Full — centralized `PermissionV2` with assertions          |
| **Registry**             | None (standalone tools)                                                             | Two-tier (Application + Location) with scope management    |
| **Image handling**       | photon WASM (in-process)                                                            | `Image.Service` (service abstraction)                      |
| **Bash complexity**      | High — streaming, throttling, temp files, command scanning                          | Moderate — bounded capture, permission-gated               |
| **Web tools**            | None                                                                                | `webfetch` + `websearch` (Exa/Parallel)                    |
| **Interaction**          | None                                                                                | `question` (ask user) + `todowrite` (task list) + `skill`  |
| **Monorepo integration** | Tight — imports `@sakti-code/agent` types                                           | Tight — imports `@opencode-ai/llm`, has `Location.Service` |
| **Error handling**       | Thrown errors, try/catch                                                            | `ToolFailure` tagged errors, `Effect.mapError`             |
| **Stale file detection** | Hashline hash comparison                                                            | `FileMutation.writeIfUnchanged()` byte comparison          |
| **BOM support**          | Separate `stripBom()` utility                                                       | Integrated into decode/write pipeline                      |
| **Line ending handling** | Detect → normalize → apply → restore                                                | Same pattern inline per tool                               |
| **Output management**    | Inline truncation utilities                                                         | `ToolOutputStore` with managed retention + output paths    |
