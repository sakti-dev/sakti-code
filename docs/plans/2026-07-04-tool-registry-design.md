# Tool Registry — Design

**Goal:** Refactor `apps/desktop/src/components/chat-area/tools` into a registry-based, modular architecture so adding a tool = creating one descriptor file + one import line. Align the UI registry with the server's tool registry (9 real tools). Fold in read's directory detection via a proper signal.

**Status:** Approved 2026-07-04.

---

## Why

Today, per-tool logic is scattered across **6 files**, so adding one tool means editing 4–5 of them:

| File                               | Per-tool hardcoding                             |
| ---------------------------------- | ----------------------------------------------- |
| `tools/tool-summary-formatters.ts` | 12 `format*Summary` fns in one central file     |
| `tools/tool-name.ts`               | `TOOL_NAME_ALIASES` map                         |
| `timeline/timeline-renderer.tsx`   | `TOOL_ICON_MAP` + `formatToolSummary` switch    |
| `timeline/explore-step.tsx`        | `TOOL_ICON_MAP` + `formatExploreSummary` switch |
| `parts/tool-part.tsx`              | `TOOL_ICON_MAP` + `summary()` switch            |
| `timeline/timeline-grouping.ts`    | `EXPLORE_TOOLS` set                             |

The admired pattern is the session store: `event-handler.ts` (mechanics) ↔ `handlers/*.ts` (self-contained modules) ↔ composition root with `ensureHandlersRegistered`/`resetHandlerRegistry`.

---

## Architecture — three layers

Mirrors the session split: **mechanics** (no knowledge of concrete tools) ↔ **self-contained tool modules** (each owns everything about one tool) ↔ **composition root** (wires them, owns lifecycle).

```
tools/
  store.ts              MECHANICS + types + generic fallback ("the engine")
  shared.ts             path helpers + toToolPartData adapter
  index.ts              COMPOSITION ROOT — imports registry/*, lifecycle, public barrel
  tool-summary-row.tsx  RENDERER (icon prop becomes a component)
  registry/             ← "create a new tool here, then register it in index.ts"
    read.tsx  write.tsx  edit.tsx  bash.tsx
    find.tsx  grep.tsx  webfetch.tsx  websearch.tsx  propose-session.tsx
    __tests__/
  __tests__/
    store.test.ts  shared.test.ts  tool-summary-row.test.tsx
```

**Mental model:** `registry/` is the drop zone. Everything else (`store.ts`, `shared.ts`, `index.ts`, renderer) is infrastructure at `tools/` level. Adding a tool = new file in `registry/` + one import line in `index.ts`.

---

## The contract

**`store.ts`** (pure mechanics — no concrete-tool imports → open/closed):

```ts
export type ToolIconCmp = Component<{ part: ToolPartData }>;

export interface ToolDescriptor {
  names: string[];            // canonical first, then aliases → drives normalizeToolName
  group?: "explore";          // "explore" tools merge into the ExploreStep run
  icon: ToolIconCmp;          // owns its icon; receives part for dynamic cases (read dir/file)
  summary: (part: ToolPartData) => string;
}

export interface ToolPartData {
  tool: string;               // normalized name
  args?: Record<string, unknown>;
  output?: unknown;
  details?: unknown;          // tool-result details (e.g. read { kind: "file" | "directory" })
}

export const TOOL_ICON_CLASS = "h-4 w-4 shrink-0 text-muted-foreground"; // shared → no styling drift

// mechanics
registerTool(d: ToolDescriptor): void
normalizeToolName(raw: string | undefined): string   // alias→canonical via descriptors; "unknown" fallback
getToolDescriptor(name: string): ToolDescriptor      // match OR generic fallback (never undefined)
isExploreTool(name: string): boolean                  // descriptor.group === "explore"
clearToolRegistry(): void                             // clears the Map (test infra)
```

**`index.ts`** (composition — the only file touched when adding a tool):

```ts
import { readTool } from "./registry/read.tsx";
// ... one import per tool
const ALL = [readTool, writeTool, /* ...9 total */];
let init = false;
ensureToolsRegistered(): void   // idempotent; ALL.forEach(registerTool)
resetToolRegistry(): void       // clearToolRegistry() + init=false (tests re-init)
// public getters auto-init on first use:
getToolDescriptor(name) { ensureToolsRegistered(); return _get(name); }   // + normalizeToolName, isExploreTool
```

**Lazy init:** public getters call `ensureToolsRegistered()` (idempotent boolean) on first use, so consumers and component tests auto-init by importing the barrel. `store.ts` is testable in isolation with synthetic descriptors.

---

## Consumer data flow (all 4 collapse to this)

```
ToolCallPart (store proxy)
  → toToolPartData(part)                                  // shared.ts — getter-based adapter
  → getToolDescriptor(normalizeToolName(part.toolName))   // → ToolDescriptor (or generic)
  → d.summary(pd)  /  <d.icon part={pd} />                 // reads part.result/details LIVE → reactive
```

**Reactivity-preserving adapter** (`shared.ts`) — getters forward to the store proxy so a single instance stays reactive (no snapshot, no remount):

```ts
export function toToolPartData(part: ToolCallPart): ToolPartData {
  return {
    get tool() {
      return normalizeToolName(part.toolName);
    },
    get args() {
      return (part.input ?? {}) as Record<string, unknown>;
    },
    get output() {
      return part.result;
    },
    get details() {
      return part.details;
    },
  };
}
```

**Per-consumer deletions:**

| Consumer                | Before                                                       | After                                                                            |
| ----------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `timeline-grouping.ts`  | `EXPLORE_TOOLS` set                                          | `isExploreTool(name)` from registry                                              |
| `timeline-renderer.tsx` | `TOOL_ICON_MAP` + `ToolIconCmp` + `formatToolSummary` switch | `const d = getToolDescriptor(name); <TimelineStep icon={<d.icon part={pd}/>}>…`  |
| `explore-step.tsx`      | `TOOL_ICON_MAP` + `formatExploreSummary` switch              | same 3-line flow per grouped part                                                |
| `parts/tool-part.tsx`   | `TOOL_ICON_MAP` + `summary()` switch                         | same 3-line flow                                                                 |
| `tool-summary-row.tsx`  | `icon: ToolIcon` enum + `ToolIcon_` switch                   | `icon: ToolIconCmp` + new `part` prop; renders `<props.icon part={props.part}/>` |
| `tools/tool-name.ts`    | alias map                                                    | **deleted** — `normalizeToolName` moves to `store.ts`                            |

**Behavior side-effect (improvement):** previously `ls` hit _generic_ in `timeline-renderer` but `formatLsSummary` in explore; after, all tools use their descriptor uniformly.

---

## Tool inventory — UI ⇄ server aligned

The UI registry mirrors the server's `TOOL_FACTORIES` (9 real tools). `glob`, `ls`, `TaskCreate`, `TaskUpdate`, `vscode_get_diagnostics` are **stale** (no backing tool, in no agent's `activeToolNames`) → removed; generic fallback covers old hydrated data.

| names (canonical + aliases)                                                 | group   | icon                            | summary                           |
| --------------------------------------------------------------------------- | ------- | ------------------------------- | --------------------------------- |
| `read`, `file_read`, `read_file`, `view_file`                               | explore | `FiFileText` / `FiFolder` (dir) | `Read`/`List <path>`              |
| `write`, `write_to_file`                                                    | —       | `FiFileText`                    | `Created <path>`                  |
| `edit`, `apply_patch`, `multi_replace_file_content`, `replace_file_content` | —       | `FiFileText`                    | `Edited <path>`                   |
| `bash`, `run_command`, `shell`                                              | —       | `FiTerminal`                    | `Executed: <cmd>`                 |
| `grep`, `grep_search`                                                       | explore | `FiSearch`                      | `Searched "<pattern>" using Grep` |
| `find`, `find_by_name`                                                      | explore | `FiFolder`                      | `Found files matching <pattern>`  |
| `webfetch`                                                                  | —       | `FiLink`                        | `Fetched <domain>`                |
| `websearch`                                                                 | —       | `FiGlobe`                       | `Searched the web: "<query>"`     |
| `propose_session`                                                           | —       | `FiShare`                       | `Proposed session: <title>`       |

**Decisions:**

- **explore group = `read`, `grep`, `find`** (glob/ls gone; web tools don't group into "Explored N files").
- **Legacy alias remap:** `find_by_name` (was →`ls`) now →`find`, its successor.
- **Two new descriptors** use real arg shapes: `websearch` `{ query, numResults? }`; `propose_session` `{ title, message }`.

---

## Read-dir signal (folded in)

The paused task folds in here. `packages/tools/src/read/index.ts` adds `kind: "file" | "directory"` to `ReadToolDetails`, populated in `execute` (it already calls `inspect()`). The signal flows the existing `details` pipe (tool → WS → store `part.details` → hydrate) — confirmed end-to-end including persistence. The read UI descriptor reads `part.details?.kind === "directory"` → folder icon + `List` summary. No UI output-sniffing.

**Streaming caveat:** before `completeToolCall`, `details` is undefined, so a directory read briefly shows "Read"/file, then flips to "List"/folder reactively on completion. Inherent to the signal arriving at completion; acceptable.

---

## Test strategy

| File                                         | Covers                                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/__tests__/store.test.ts`              | mechanics with synthetic descriptors: register/normalize/get/isExplore/clear/generic-fallback                                                       |
| `tools/__tests__/shared.test.ts`             | `toToolPartData` field mapping (input→args, result→output, details, toolName→normalized)                                                            |
| `tools/registry/__tests__/index.test.ts`     | integration: 9 canonicals resolve, aliases (incl. find_by_name→find), explore={read,grep,find}, generic fallback for glob/ls/unknown, reset→re-init |
| `tools/registry/__tests__/<tool>.test.tsx`   | per-tool `summary()` for representative args; read adds Read/List split on details.kind                                                             |
| `tools/__tests__/tool-summary-row.test.tsx`  | updated: icon as component + part prop; showIcon toggle                                                                                             |
| `packages/tools/src/__tests__/tools.test.ts` | read execute returns details.kind "directory"/"file"                                                                                                |

**Existing tests touched:**

- `tool-summary-formatters.test.ts` → deleted (cases migrate to per-tool files).
- `timeline-grouping.test.ts` → "mixed explore (read + grep + **glob**)" becomes `read + grep + find`.
- Component tests import getters from the barrel (auto-init); existing assertions hold.

Reactivity (getter-based adapter updating on completion) is verified by existing component tests + manual run.

---

## Decisions log

- **Icon strategy = per-tool component** (not fixed enum): each tool module owns its icon JSX. Maximizes modularity for upcoming tools with exotic icons; trade-off is `.tsx` modules + distributed styling (mitigated by shared `TOOL_ICON_CLASS`).
- **Generic fallback lives in `store.ts`** (not its own module): `getToolDescriptor` always returns a descriptor; consumers never handle `undefined`.
- **`store.ts` outside `registry/`**: so the developer knows `registry/` is the drop zone for new tools; infrastructure sits outside.
- **Explicit import array in `index.ts`** (not side-effect `registerTool` calls, not `import.meta.glob`): transparent, no magic, and `resetToolRegistry()` can clear + re-init for tests.
- **Big refactor on main, no compat shims** (consistent with prior decisions).
