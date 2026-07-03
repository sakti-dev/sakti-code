# Tool Registry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor `apps/desktop/src/components/chat-area/tools` into a registry-based, modular architecture (one file per tool) and align the UI tool registry with the server's 9 real tools, folding in read's directory detection.

**Architecture:** Three layers mirroring `stores/session`: `store.tsx` (mechanics + generic fallback), self-contained descriptors in `registry/*.tsx`, and `index.ts` (composition root with idempotent `ensureToolsRegistered`/`resetToolRegistry`). Consumers collapse to a single 3-line flow: `toToolPartData(part)` → `getToolDescriptor(normalizeToolName(...))` → `descriptor.summary(pd)` / `<descriptor.icon part={pd}/>`.

**Tech Stack:** SolidJS, TypeScript, vitest (jsdom for renderer tests), `solid-icons/fi`, `@sakti-code/tools`. Commands: `vp test run <path>` (per-package workdir), `vp run -r test` (all), `vp check` (format + lint + typecheck).

**Design doc:** `docs/plans/2026-07-04-tool-registry-design.md` (read this for rationale).

**Strategy:** Parallel change — build the new registry alongside the old code (Phases 1–3), switch consumers one at a time (Phase 4), then delete the old code (Phase 5). Existing consumer tests are the safety net for the refactor; new behavior gets new tests.

---

## Phase 1 — Foundations (new, nothing wired)

### Task 1: `store.tsx` — types, mechanics, generic fallback

**Files:**

- Create: `apps/desktop/src/components/chat-area/tools/store.tsx`
- Test: `apps/desktop/src/components/chat-area/tools/__tests__/store.test.ts`

> Note: the file is `.tsx` (not `.ts`) because the generic fallback descriptor owns a default icon component (JSX). It still holds all the pure mechanics.

**Step 1: Write the failing test.**

```ts
// __tests__/store.test.ts
import { describe, expect, it, beforeEach } from "vite-plus/test";
import {
  clearToolRegistry,
  getToolDescriptor,
  isExploreTool,
  normalizeToolName,
  registerTool,
  type ToolDescriptor,
} from "../store.tsx";

describe("tool registry mechanics", () => {
  beforeEach(() => clearToolRegistry());

  it("registerTool throws without a canonical name", () => {
    expect(() =>
      registerTool({ names: [], icon: () => null as never, summary: () => "" } as ToolDescriptor),
    ).toThrow();
  });

  it("normalizeToolName resolves aliases to canonical", () => {
    registerTool({
      names: ["read", "file_read", "view_file"],
      group: "explore",
      icon: () => null as never,
      summary: () => "",
    });
    expect(normalizeToolName("read")).toBe("read");
    expect(normalizeToolName("file_read")).toBe("read");
    expect(normalizeToolName("view_file")).toBe("read");
  });

  it("normalizeToolName returns raw for unknown, 'unknown' for undefined", () => {
    expect(normalizeToolName("mystery")).toBe("mystery");
    expect(normalizeToolName(undefined)).toBe("unknown");
  });

  it("getToolDescriptor returns the match", () => {
    const d: ToolDescriptor = { names: ["bash"], icon: () => null as never, summary: () => "x" };
    registerTool(d);
    expect(getToolDescriptor("bash")).toBe(d);
  });

  it("getToolDescriptor returns the generic fallback (never undefined) for unknown", () => {
    const d = getToolDescriptor("nope");
    expect(d).toBeDefined();
    expect(typeof d.summary).toBe("function");
    expect(d.summary({ tool: "nope", args: {} })).toBe("Used nope");
  });

  it("isExploreTool reads descriptor.group", () => {
    registerTool({
      names: ["grep"],
      group: "explore",
      icon: () => null as never,
      summary: () => "",
    });
    registerTool({ names: ["bash"], icon: () => null as never, summary: () => "" });
    expect(isExploreTool("grep")).toBe(true);
    expect(isExploreTool("bash")).toBe(false);
    expect(isExploreTool("unknown")).toBe(false);
  });

  it("clearToolRegistry empties the registry", () => {
    registerTool({ names: ["bash"], icon: () => null as never, summary: () => "" });
    expect(normalizeToolName("bash")).toBe("bash");
    clearToolRegistry();
    expect(normalizeToolName("bash")).toBe("bash"); // raw again, not registered
  });
});
```

**Step 2: Run, verify RED.**

```bash
vp test run src/components/chat-area/tools/__tests__/store.test.ts
```

Workdir: `apps/desktop`. Expected: FAIL — cannot find module `../store.tsx`.

**Step 3: Implement `store.tsx`.**

```tsx
// store.tsx
import { FiCircle } from "solid-icons/fi";
import { type Component } from "solid-js";

export type ToolIconCmp = Component<{ part: ToolPartData }>;

export interface ToolPartData {
  tool: string;
  args?: Record<string, unknown>;
  output?: unknown;
  details?: unknown;
}

export interface ToolDescriptor {
  /** Canonical name first, then aliases. Drives normalizeToolName. */
  names: string[];
  /** "explore" tools merge into the ExploreStep run. */
  group?: "explore";
  /** Owns its icon; receives part for dynamic cases (read dir/file). */
  icon: ToolIconCmp;
  summary: (part: ToolPartData) => string;
}

export const TOOL_ICON_CLASS = "h-4 w-4 shrink-0 text-muted-foreground";

const entries = new Map<string, { canonical: string; descriptor: ToolDescriptor }>();

// ---- generic fallback (self-contained; for unknown / legacy tools) ----
function humanize(name: string): string {
  return name.replaceAll(/[_-]+/g, " ").replaceAll(/\s+/g, " ").trim();
}
function extractTargetPath(args: Record<string, unknown>): string | undefined {
  for (const key of ["filePath", "path", "dirPath", "AbsolutePath", "TargetFile"]) {
    const v = args[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  if (Array.isArray(args.files) && args.files.length > 0) {
    const first = args.files[0] as Record<string, unknown> | undefined;
    if (first && typeof first.filePath === "string") return first.filePath;
  }
  return undefined;
}
const genericDescriptor: ToolDescriptor = {
  names: [],
  icon: () => <FiCircle class={TOOL_ICON_CLASS} />,
  summary: (part) => {
    const name = humanize(part.tool || "unknown");
    const args = part.args ?? {};
    const target = extractTargetPath(args);
    if (target) return `${name} ${target}`;
    const command = args.command;
    if (typeof command === "string" && command.length > 0) {
      return `${name}: ${command.length > 60 ? `${command.slice(0, 57)}...` : command}`;
    }
    return `Used ${name}`;
  },
};

// ---- mechanics ----
export function registerTool(descriptor: ToolDescriptor): void {
  const [canonical] = descriptor.names;
  if (!canonical) throw new Error("ToolDescriptor.names requires a canonical name");
  for (const name of descriptor.names) {
    entries.set(name, { canonical, descriptor });
  }
}

export function normalizeToolName(raw: string | undefined): string {
  if (!raw) return "unknown";
  return entries.get(raw)?.canonical ?? raw;
}

export function getToolDescriptor(name: string): ToolDescriptor {
  return entries.get(name)?.descriptor ?? genericDescriptor;
}

export function isExploreTool(name: string): boolean {
  return getToolDescriptor(name).group === "explore";
}

export function clearToolRegistry(): void {
  entries.clear();
}
```

**Step 4: Run, verify GREEN.** `vp test run src/components/chat-area/tools/__tests__/store.test.ts` → PASS.

**Step 5: Commit.** `feat(tools): add tool registry store (mechanics + generic fallback)`

---

### Task 2: `shared.ts` — helpers + reactive adapter

**Files:**

- Create: `apps/desktop/src/components/chat-area/tools/shared.ts`
- Test: `apps/desktop/src/components/chat-area/tools/__tests__/shared.test.ts`

**Step 1: Write the failing test.**

```ts
// __tests__/shared.test.ts
import { describe, expect, it } from "vite-plus/test";
import { toToolPartData, extractPath, extractHashlinePath } from "../shared.ts";
import type { ToolCallPart } from "../shared.ts";

const part = (over: Partial<ToolCallPart> = {}): ToolCallPart => ({
  type: "tool_call",
  toolCallId: "tc1",
  toolName: "read",
  input: { path: "/a/b.ts" },
  status: "done",
  result: "file content",
  details: { kind: "file" },
  ...over,
});

describe("toToolPartData", () => {
  it("maps input→args, result→output, details→details, toolName→normalized tool", () => {
    const pd = toToolPartData(part());
    expect(pd.args).toEqual({ path: "/a/b.ts" });
    expect(pd.output).toBe("file content");
    expect(pd.details).toEqual({ kind: "file" });
    expect(pd.tool).toBe("read");
  });

  it("forwards reads live (getter), so later mutations are visible", () => {
    const p = part();
    const pd = toToolPartData(p);
    p.result = "changed";
    p.details = { kind: "directory" };
    expect(pd.output).toBe("changed");
    expect(pd.details).toEqual({ kind: "directory" });
  });

  it("normalizes aliases on the tool field", () => {
    const pd = toToolPartData(part({ toolName: "file_read" }));
    expect(pd.tool).toBe("read"); // alias resolved (after registry init in other tests)
  });
});

describe("extractPath", () => {
  it("reads filePath then path", () => {
    expect(extractPath({ tool: "read", args: { filePath: "/x" } })).toBe("/x");
    expect(extractPath({ tool: "read", args: { path: "/y" } })).toBe("/y");
    expect(extractPath({ tool: "read", args: {} })).toBeUndefined();
  });
});

describe("extractHashlinePath", () => {
  it("pulls the path out of [path#HASH] headers", () => {
    expect(extractHashlinePath("[src/foo.ts#1A2B]\nDEL 5")).toBe("src/foo.ts");
    expect(extractHashlinePath("no header here")).toBeUndefined();
  });
});
```

> The alias test (`file_read → read`) requires the registry to contain `read`. Since `shared.ts` imports the raw `normalizeToolName` from `store.tsx`, register a read descriptor in that test's setup, or assert the raw-name fallback. Simpler: register a minimal descriptor in the test. Add at top of the alias `it`: `registerTool({ names: ["read","file_read"], icon: () => null as never, summary: () => "" });` (import `registerTool`, `clearToolRegistry` from store; clear in `beforeEach`).

**Step 2: Run, verify RED.** Cannot find `../shared.ts`.

**Step 3: Implement `shared.ts`.**

```ts
// shared.ts
import type { MessagePart } from "~/stores/types.ts";
import { normalizeToolName } from "./store.tsx";

export const PATH_MAX_LENGTH = 50;

const HASHLINE_PATH_RE = /^\[([^\]]+?)#[0-9A-Fa-f]{4}\]/m;

export type ToolCallPart = Extract<MessagePart, { type: "tool_call" }>;

export function getArgs(part: { args?: Record<string, unknown> }): Record<string, unknown> {
  return part.args ?? {};
}

/** Extract a filePath/path from a part's args (read, write, edit standard mode). */
export function extractPath(part: { args?: Record<string, unknown> }): string | undefined {
  const args = getArgs(part);
  return (
    (typeof args.filePath === "string" ? args.filePath : undefined) ??
    (typeof args.path === "string" ? args.path : undefined)
  );
}

export function extractHashlinePath(input: string): string | undefined {
  return HASHLINE_PATH_RE.exec(input)?.[1];
}

/**
 * Adapter from a store ToolCallPart proxy to the formatter-friendly ToolPartData
 * shape. Uses getters so reads of part.result/part.details stay reactive (Solid
 * tracks property access on the store proxy) — a single instance updates on
 * completion without remount.
 */
export function toToolPartData(part: ToolCallPart): {
  tool: string;
  args?: Record<string, unknown>;
  output?: unknown;
  details?: unknown;
} {
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

**Step 4: Run, verify GREEN.** `vp test run src/components/chat-area/tools/__tests__/shared.test.ts` → PASS.

**Step 5: Commit.** `feat(tools): add shared helpers + reactive toToolPartData adapter`

---

### Task 3: read tool emits `kind` signal (`packages/tools`)

**Files:**

- Modify: `packages/tools/src/read/index.ts` (lines 36–38 `ReadToolDetails`; line ~208 dir return; line ~298 file return)
- Test: `packages/tools/src/__tests__/tools.test.ts` (add to the `"ReadTool directory listing"` describe)

**Step 1: Write the failing test** (append inside the `describe("ReadTool directory listing", ...)` block):

```ts
it("reports directory kind in details", async () => {
  const tool = createReadTool(tmpDir);
  const result = await tool.execute("tc_1", { path: "." });
  expect((result as { details?: { kind?: string } }).details?.kind).toBe("directory");
});

it("reports file kind in details", async () => {
  const tool = createReadTool(tmpDir);
  const result = await tool.execute("tc_1", { path: "hello.txt" });
  expect((result as { details?: { kind?: string } }).details?.kind).toBe("file");
});
```

**Step 2: Run, verify RED.**

```bash
vp test run src/__tests__/tools.test.ts -t "reports directory kind"
```

Workdir: `packages/tools`. Expected: FAIL — `details` is `undefined`.

**Step 3: Implement.**

- `ReadToolDetails` interface: add required `kind`:
  ```ts
  export interface ReadToolDetails {
    kind: "file" | "directory";
    truncation?: TruncationResult;
  }
  ```
- Directory return (the `if (type === "directory")` branch, currently `details: undefined`):
  ```ts
  details: { kind: "directory" },
  ```
- File return (final `return { content, details: undefined };`):
  ```ts
  return { content, details: { kind: "file" } };
  ```

**Step 4: Run, verify GREEN.** `vp test run src/__tests__/tools.test.ts` → PASS (all read tests).

**Step 5: Commit.** `feat(tools): read tool emits file/directory kind in details`

---

## Phase 2 — Tool descriptors (new, not wired)

> Each descriptor is a `.tsx` in `registry/`. Pattern per task: write a failing summary test → implement the descriptor → green → commit. The icon component is exercised by the summary test only indirectly (it's a component); icon rendering is covered later by `tool-summary-row.test.tsx`. Keep summary tests behavior-focused.

### Task 4: `registry/read.tsx` (dynamic icon + dir detection)

**Files:**

- Create: `apps/desktop/src/components/chat-area/tools/registry/read.tsx`
- Test: `apps/desktop/src/components/chat-area/tools/registry/__tests__/read.test.ts`

**Step 1: Write the failing test.**

```ts
// registry/__tests__/read.test.ts
import { describe, expect, it } from "vite-plus/test";
import { readTool } from "../read.tsx";

describe("readTool descriptor", () => {
  it("summarizes a file read", () => {
    expect(readTool.summary({ tool: "read", args: { path: "/a/b.ts" } })).toBe("Read /a/b.ts");
  });
  it("summarizes a directory read as List", () => {
    expect(
      readTool.summary({ tool: "read", args: { path: "/a/b" }, details: { kind: "directory" } }),
    ).toBe("List /a/b");
  });
  it("falls back to unknown path", () => {
    expect(readTool.summary({ tool: "read", args: {} })).toBe("Read unknown");
  });
  it("declares explore group + aliases", () => {
    expect(readTool.group).toBe("explore");
    expect(readTool.names).toContain("file_read");
  });
});
```

**Step 2: Run, verify RED.** Cannot find `../read.tsx`.

**Step 3: Implement `registry/read.tsx`.**

```tsx
import { FiFileText, FiFolder } from "solid-icons/fi";
import { Show } from "solid-js";
import { middleEllipsisPath } from "~/lib/utils/path-utils";
import {
  TOOL_ICON_CLASS,
  type ToolDescriptor,
  type ToolIconCmp,
  type ToolPartData,
} from "../store.tsx";
import { extractPath, PATH_MAX_LENGTH } from "../shared.ts";

const isDir = (p: ToolPartData): boolean =>
  (p.details as { kind?: string } | undefined)?.kind === "directory";

const ReadIcon: ToolIconCmp = (props) => (
  <Show when={isDir(props.part)} fallback={<FiFileText class={TOOL_ICON_CLASS} />}>
    <FiFolder class={TOOL_ICON_CLASS} />
  </Show>
);

export const readTool: ToolDescriptor = {
  names: ["read", "file_read", "read_file", "view_file"],
  group: "explore",
  icon: ReadIcon,
  summary: (p) =>
    `${isDir(p) ? "List" : "Read"} ${middleEllipsisPath(extractPath(p) ?? "unknown", PATH_MAX_LENGTH)}`,
};
```

**Step 4: Run, verify GREEN.** `vp test run src/components/chat-area/tools/registry/__tests__/read.test.ts` → PASS.

**Step 5: Commit.** `feat(tools): read tool descriptor (dynamic dir/file icon)`

---

### Task 5: `registry/write.tsx` + `registry/edit.tsx`

**Files:**

- Create: `registry/write.tsx`, `registry/edit.tsx`
- Test: `registry/__tests__/write-edit.test.ts`

**Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vite-plus/test";
import { writeTool } from "../write.tsx";
import { editTool } from "../edit.tsx";

describe("writeTool", () => {
  it("summarizes as Created <path>", () => {
    expect(writeTool.summary({ tool: "write", args: { path: "/x.ts" } })).toBe("Created /x.ts");
  });
});

describe("editTool", () => {
  it("extracts path from standard args.path", () => {
    expect(editTool.summary({ tool: "edit", args: { path: "/src/index.ts" } })).toContain(
      "index.ts",
    );
  });
  it("extracts path from hashline input [path#HASH]", () => {
    expect(
      editTool.summary({
        tool: "edit",
        args: { input: "[src/foo.ts#1A2B]\nSWAP 1.=2:\n+old\n+new" },
      }),
    ).toContain("foo.ts");
  });
  it("falls back to 'Edited file' when no path", () => {
    expect(editTool.summary({ tool: "edit", args: {} })).toBe("Edited file");
  });
});
```

**Step 2: Run, verify RED.**

**Step 3: Implement.**

```tsx
// registry/write.tsx
import { FiFileText } from "solid-icons/fi";
import { middleEllipsisPath } from "~/lib/utils/path-utils";
import { TOOL_ICON_CLASS, type ToolDescriptor, type ToolIconCmp } from "../store.tsx";
import { extractPath, PATH_MAX_LENGTH } from "../shared.ts";

const WriteIcon: ToolIconCmp = () => <FiFileText class={TOOL_ICON_CLASS} />;

export const writeTool: ToolDescriptor = {
  names: ["write", "write_to_file"],
  icon: WriteIcon,
  summary: (p) => `Created ${middleEllipsisPath(extractPath(p) ?? "unknown", PATH_MAX_LENGTH)}`,
};
```

```tsx
// registry/edit.tsx
import { FiFileText } from "solid-icons/fi";
import { middleEllipsisPath } from "~/lib/utils/path-utils";
import {
  TOOL_ICON_CLASS,
  type ToolDescriptor,
  type ToolIconCmp,
  type ToolPartData,
} from "../store.tsx";
import { extractHashlinePath, extractPath, getArgs, PATH_MAX_LENGTH } from "../shared.ts";

const EditIcon: ToolIconCmp = () => <FiFileText class={TOOL_ICON_CLASS} />;

function editedPath(part: ToolPartData): string | undefined {
  const direct = extractPath(part);
  if (direct) return direct;
  const input = getArgs(part).input;
  return typeof input === "string" ? extractHashlinePath(input) : undefined;
}

export const editTool: ToolDescriptor = {
  names: ["edit", "apply_patch", "multi_replace_file_content", "replace_file_content"],
  icon: EditIcon,
  summary: (p) => {
    const path = editedPath(p);
    return path ? `Edited ${middleEllipsisPath(path, PATH_MAX_LENGTH)}` : "Edited file";
  },
};
```

**Step 4: Run, verify GREEN.** **Step 5: Commit.** `feat(tools): write + edit tool descriptors`

---

### Task 6: `registry/bash.tsx`

**Files:** Create `registry/bash.tsx` · Test: `registry/__tests__/bash.test.ts`

**Step 1: Failing test.**

```ts
import { describe, expect, it } from "vite-plus/test";
import { bashTool } from "../bash.tsx";

describe("bashTool", () => {
  it("prefers description", () => {
    expect(
      bashTool.summary({ tool: "bash", args: { command: "ls", description: "list files" } }),
    ).toBe("Executed: list files");
  });
  it("truncates long commands", () => {
    const long = "x".repeat(100);
    expect(bashTool.summary({ tool: "bash", args: { command: long } })).toBe(
      `Executed: ${"x".repeat(57)}...`,
    );
  });
  it("uses unknown command fallback", () => {
    expect(bashTool.summary({ tool: "bash", args: {} })).toBe("Executed: unknown command");
  });
});
```

**Step 2: RED.** **Step 3: Implement.**

```tsx
// registry/bash.tsx
import { FiTerminal } from "solid-icons/fi";
import { TOOL_ICON_CLASS, type ToolDescriptor, type ToolIconCmp } from "../store.tsx";
import { getArgs } from "../shared.ts";

const BashIcon: ToolIconCmp = () => <FiTerminal class={TOOL_ICON_CLASS} />;

export const bashTool: ToolDescriptor = {
  names: ["bash", "run_command", "shell"],
  icon: BashIcon,
  summary: (p) => {
    const args = getArgs(p);
    const description = args.description;
    const command = typeof args.command === "string" ? args.command : "unknown command";
    const text =
      typeof description === "string" && description
        ? description
        : command.length > 60
          ? `${command.slice(0, 57)}...`
          : command;
    return `Executed: ${text}`;
  },
};
```

**Step 4: GREEN.** **Step 5: Commit.** `feat(tools): bash tool descriptor`

---

### Task 7: `registry/grep.tsx` + `registry/find.tsx`

**Files:** Create `registry/grep.tsx`, `registry/find.tsx` · Test: `registry/__tests__/grep-find.test.ts`

**Step 1: Failing test.**

```ts
import { describe, expect, it } from "vite-plus/test";
import { grepTool } from "../grep.tsx";
import { findTool } from "../find.tsx";

describe("grepTool", () => {
  it("summarizes pattern + optional path", () => {
    expect(grepTool.summary({ tool: "grep", args: { pattern: "foo" } })).toBe(
      'Searched "foo" using Grep',
    );
    expect(grepTool.summary({ tool: "grep", args: { pattern: "foo", path: "src" } })).toBe(
      'Searched "foo" using Grep in src',
    );
  });
});

describe("findTool", () => {
  it("uses pattern, falls back to glob, then '*'", () => {
    expect(findTool.summary({ tool: "find", args: { pattern: "**/*.ts" } })).toBe(
      "Found files matching **/*.ts",
    );
    expect(findTool.summary({ tool: "find", args: { glob: "**/*.tsx" } })).toBe(
      "Found files matching **/*.tsx",
    );
    expect(findTool.summary({ tool: "find", args: {} })).toBe("Found files matching *");
  });
  it("remaps find_by_name alias and declares explore", () => {
    expect(findTool.names).toEqual(["find", "find_by_name"]);
    expect(findTool.group).toBe("explore");
  });
});
```

**Step 2: RED.** **Step 3: Implement.**

```tsx
// registry/grep.tsx
import { FiSearch } from "solid-icons/fi";
import { TOOL_ICON_CLASS, type ToolDescriptor, type ToolIconCmp } from "../store.tsx";
import { getArgs } from "../shared.ts";

const GrepIcon: ToolIconCmp = () => <FiSearch class={TOOL_ICON_CLASS} />;

export const grepTool: ToolDescriptor = {
  names: ["grep", "grep_search"],
  group: "explore",
  icon: GrepIcon,
  summary: (p) => {
    const args = getArgs(p);
    const pattern = typeof args.pattern === "string" ? args.pattern : "unknown";
    const path = typeof args.path === "string" ? args.path : undefined;
    return `Searched "${pattern}" using Grep${path ? ` in ${path}` : ""}`;
  },
};
```

```tsx
// registry/find.tsx
import { FiFolder } from "solid-icons/fi";
import { TOOL_ICON_CLASS, type ToolDescriptor, type ToolIconCmp } from "../store.tsx";
import { getArgs } from "../shared.ts";

const FindIcon: ToolIconCmp = () => <FiFolder class={TOOL_ICON_CLASS} />;

export const findTool: ToolDescriptor = {
  names: ["find", "find_by_name"],
  group: "explore",
  icon: FindIcon,
  summary: (p) => {
    const args = getArgs(p);
    const pattern =
      (typeof args.pattern === "string" ? args.pattern : undefined) ??
      (typeof args.glob === "string" ? args.glob : undefined) ??
      "*";
    const path = typeof args.path === "string" ? args.path : undefined;
    return `Found files matching ${pattern}${path ? ` in ${path}` : ""}`;
  },
};
```

**Step 4: GREEN.** **Step 5: Commit.** `feat(tools): grep + find tool descriptors`

---

### Task 8: `registry/webfetch.tsx` + `registry/websearch.tsx`

**Files:** Create `registry/webfetch.tsx`, `registry/websearch.tsx` · Test: `registry/__tests__/web.test.ts`

**Step 1: Failing test.**

```ts
import { describe, expect, it } from "vite-plus/test";
import { webfetchTool } from "../webfetch.tsx";
import { websearchTool } from "../websearch.tsx";

describe("webfetchTool", () => {
  it("shows domain", () => {
    expect(
      webfetchTool.summary({ tool: "webfetch", args: { url: "https://example.com/page" } }),
    ).toBe("Fetched example.com");
  });
  it("falls back when url invalid", () => {
    expect(webfetchTool.summary({ tool: "webfetch", args: { url: "not a url" } })).toBe(
      "Fetched URL",
    );
  });
});

describe("websearchTool", () => {
  it("shows the query", () => {
    expect(
      websearchTool.summary({ tool: "websearch", args: { query: "solidjs reactivity" } }),
    ).toBe('Searched the web: "solidjs reactivity"');
  });
});
```

**Step 2: RED.** **Step 3: Implement.**

```tsx
// registry/webfetch.tsx
import { FiLink } from "solid-icons/fi";
import { TOOL_ICON_CLASS, type ToolDescriptor, type ToolIconCmp } from "../store.tsx";
import { getArgs } from "../shared.ts";

const WebfetchIcon: ToolIconCmp = () => <FiLink class={TOOL_ICON_CLASS} />;

export const webfetchTool: ToolDescriptor = {
  names: ["webfetch"],
  icon: WebfetchIcon,
  summary: (p) => {
    const url = typeof getArgs(p).url === "string" ? (getArgs(p).url as string) : "";
    try {
      return `Fetched ${new URL(url).hostname}`;
    } catch {
      return "Fetched URL";
    }
  },
};
```

```tsx
// registry/websearch.tsx
import { FiGlobe } from "solid-icons/fi";
import { TOOL_ICON_CLASS, type ToolDescriptor, type ToolIconCmp } from "../store.tsx";
import { getArgs } from "../shared.ts";

const WebsearchIcon: ToolIconCmp = () => <FiGlobe class={TOOL_ICON_CLASS} />;

export const websearchTool: ToolDescriptor = {
  names: ["websearch"],
  icon: WebsearchIcon,
  summary: (p) => {
    const query = typeof getArgs(p).query === "string" ? (getArgs(p).query as string) : "";
    return `Searched the web: "${query}"`;
  },
};
```

**Step 4: GREEN.** **Step 5: Commit.** `feat(tools): webfetch + websearch tool descriptors`

---

### Task 9: `registry/propose-session.tsx`

**Files:** Create `registry/propose-session.tsx` · Test: `registry/__tests__/propose-session.test.ts`

**Step 1: Failing test.**

```ts
import { describe, expect, it } from "vite-plus/test";
import { proposeSessionTool } from "../propose-session.tsx";

describe("proposeSessionTool", () => {
  it("shows the title", () => {
    expect(
      proposeSessionTool.summary({ tool: "propose_session", args: { title: "Add auth" } }),
    ).toBe("Proposed session: Add auth");
  });
  it("defaults to untitled", () => {
    expect(proposeSessionTool.summary({ tool: "propose_session", args: {} })).toBe(
      "Proposed session: untitled",
    );
  });
});
```

**Step 2: RED.** **Step 3: Implement.**

```tsx
// registry/propose-session.tsx
import { FiShare } from "solid-icons/fi";
import { TOOL_ICON_CLASS, type ToolDescriptor, type ToolIconCmp } from "../store.tsx";
import { getArgs } from "../shared.ts";

const ProposeSessionIcon: ToolIconCmp = () => <FiShare class={TOOL_ICON_CLASS} />;

export const proposeSessionTool: ToolDescriptor = {
  names: ["propose_session"],
  icon: ProposeSessionIcon,
  summary: (p) => {
    const title = typeof getArgs(p).title === "string" ? (getArgs(p).title as string) : "untitled";
    return `Proposed session: ${title}`;
  },
};
```

**Step 4: GREEN.** **Step 5: Commit.** `feat(tools): propose_session tool descriptor`

---

## Phase 3 — Composition root

### Task 10: `index.ts` — wire all descriptors + lifecycle

**Files:**

- Create: `apps/desktop/src/components/chat-area/tools/index.ts`
- Test: `apps/desktop/src/components/chat-area/tools/__tests__/index.test.ts`

**Step 1: Write the failing test.**

```ts
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  ensureToolsRegistered,
  getToolDescriptor,
  isExploreTool,
  normalizeToolName,
  resetToolRegistry,
} from "../index.ts";

describe("tool registry composition", () => {
  beforeEach(() => resetToolRegistry());

  it("resolves all 9 canonical names", () => {
    ensureToolsRegistered();
    for (const name of [
      "read",
      "write",
      "edit",
      "bash",
      "grep",
      "find",
      "webfetch",
      "websearch",
      "propose_session",
    ]) {
      const d = getToolDescriptor(name);
      expect(d.names[0]).toBe(name);
    }
  });

  it("resolves aliases (incl. find_by_name → find)", () => {
    ensureToolsRegistered();
    expect(normalizeToolName("file_read")).toBe("read");
    expect(normalizeToolName("find_by_name")).toBe("find");
    expect(normalizeToolName("apply_patch")).toBe("edit");
    expect(normalizeToolName("run_command")).toBe("bash");
  });

  it("explore group = read, grep, find only", () => {
    ensureToolsRegistered();
    expect(isExploreTool("read")).toBe(true);
    expect(isExploreTool("grep")).toBe(true);
    expect(isExploreTool("find")).toBe(true);
    expect(isExploreTool("bash")).toBe(false);
    expect(isExploreTool("websearch")).toBe(false);
  });

  it("generic fallback for removed/legacy tools", () => {
    ensureToolsRegistered();
    const glob = getToolDescriptor("glob");
    expect(glob.names).toEqual([]); // generic fallback marker
    expect(glob.summary({ tool: "glob", args: {} })).toBe("Used glob");
  });

  it("resetToolRegistry allows re-init", () => {
    ensureToolsRegistered();
    resetToolRegistry();
    ensureToolsRegistered();
    expect(getToolDescriptor("read").names[0]).toBe("read");
  });

  it("getToolDescriptor auto-inits (no explicit ensure needed)", () => {
    // after the beforeEach reset, calling getToolDescriptor alone should still work
    expect(getToolDescriptor("read").names[0]).toBe("read");
  });
});
```

**Step 2: Run, verify RED.** Cannot find `../index.ts`.

**Step 3: Implement `index.ts`.**

```ts
// index.ts (composition root + public barrel)
import type { ToolDescriptor } from "./store.tsx";
import { clearToolRegistry, registerTool } from "./store.tsx";
import * as store from "./store.tsx";
import { bashTool } from "./registry/bash.tsx";
import { editTool } from "./registry/edit.tsx";
import { findTool } from "./registry/find.tsx";
import { grepTool } from "./registry/grep.tsx";
import { proposeSessionTool } from "./registry/propose-session.tsx";
import { readTool } from "./registry/read.tsx";
import { webfetchTool } from "./registry/webfetch.tsx";
import { websearchTool } from "./registry/websearch.tsx";
import { writeTool } from "./registry/write.tsx";

const ALL: ToolDescriptor[] = [
  readTool,
  writeTool,
  editTool,
  bashTool,
  grepTool,
  findTool,
  webfetchTool,
  websearchTool,
  proposeSessionTool,
];

let initialized = false;

/** Register every tool descriptor. Idempotent. */
export function ensureToolsRegistered(): void {
  if (initialized) return;
  initialized = true;
  for (const descriptor of ALL) registerTool(descriptor);
}

/** Clear + reset the init flag so the next access re-registers (test infra). */
export function resetToolRegistry(): void {
  clearToolRegistry();
  initialized = false;
}

// Public lookups auto-init on first use, so consumers/tests never think about order.
export function getToolDescriptor(name: string): ToolDescriptor {
  ensureToolsRegistered();
  return store.getToolDescriptor(name);
}
export function normalizeToolName(raw: string | undefined): string {
  ensureToolsRegistered();
  return store.normalizeToolName(raw);
}
export function isExploreTool(name: string): boolean {
  ensureToolsRegistered();
  return store.isExploreTool(name);
}

export type { ToolDescriptor, ToolIconCmp, ToolPartData } from "./store.tsx";
export { TOOL_ICON_CLASS } from "./store.tsx";
export { toToolPartData } from "./shared.ts";
```

**Step 4: Run, verify GREEN.** `vp test run src/components/chat-area/tools/__tests__/index.test.ts` → PASS.

**Step 5: Commit.** `feat(tools): tool registry composition root (9 tools, lifecycle)`

---

## Phase 4 — Switch consumers over

> These are refactors preserving behavior — existing component tests are the safety net. Add/adjust a test only where the contract changes (tool-summary-row icon = component; grouping glob→find). Run the relevant component test after each switch.

### Task 11: `tool-summary-row.tsx` — icon becomes a component

**Files:**

- Modify: `apps/desktop/src/components/chat-area/tools/tool-summary-row.tsx`
- Test: `apps/desktop/src/components/chat-area/tools/__tests__/tool-summary-row.test.tsx`

**Step 1: Update the test to the new contract.**

```tsx
// __tests__/tool-summary-row.test.tsx
import { FiCheck } from "solid-icons/fi";
import { render } from "solid-js/web";
import { describe, expect, it } from "vite-plus/test";
import { ToolSummaryRow } from "../tool-summary-row.tsx";

const IconCmp = () => <FiCheck />;

describe("ToolSummaryRow", () => {
  it("renders the icon when showIcon is not false", () => {
    const root = document.createElement("div");
    render(
      () => (
        <ToolSummaryRow
          icon={IconCmp}
          part={{ tool: "read" }}
          status="completed"
          summary="Read file.ts"
        />
      ),
      root,
    );
    expect(root.querySelector('[data-component="tool-summary-row"]')).toBeTruthy();
    expect(root.querySelector('[data-slot="summary-main"]')?.textContent).toContain("Read file.ts");
  });

  it("hides the icon when showIcon is false", () => {
    const root = document.createElement("div");
    render(
      () => (
        <ToolSummaryRow
          icon={IconCmp}
          part={{ tool: "read" }}
          showIcon={false}
          status="completed"
          summary="Read file.ts"
        />
      ),
      root,
    );
    expect(root.querySelector("svg")).toBeNull();
  });
});
```

**Step 2: Run, verify RED** (old prop signature mismatches: `icon` was a string enum).

**Step 3: Implement** — rewrite `tool-summary-row.tsx`:

```tsx
import { type Component, Show } from "solid-js";
import { cn } from "~/lib/utils";
import type { ToolIconCmp, ToolPartData } from "./store.tsx";

export interface ToolSummaryRowProps {
  class?: string;
  error?: string;
  icon: ToolIconCmp;
  part: ToolPartData;
  /** When false, the leading icon is hidden (used when the icon lives on a parent TimelineStep). */
  showIcon?: boolean;
  status: "running" | "completed" | "error" | "pending";
  summary: string | { main: string; muted?: string };
}

export const ToolSummaryRow: Component<ToolSummaryRowProps> = (props) => {
  const mainText = () => (typeof props.summary === "string" ? props.summary : props.summary.main);
  const mutedText = () => (typeof props.summary === "string" ? undefined : props.summary.muted);

  return (
    <div
      class={cn(
        "flex items-center gap-2 py-1.5 text-sm",
        props.status === "error" && "text-destructive",
        props.class,
      )}
      data-component="tool-summary-row"
      data-status={props.status}
    >
      <Show when={props.showIcon !== false}>
        <props.icon part={props.part} />
      </Show>

      <span class="min-w-0 truncate" data-slot="summary-main">
        {mainText()}
      </span>

      <Show when={mutedText()}>
        <span class="shrink-0 text-muted-foreground text-xs" data-slot="summary-muted">
          {mutedText()}
        </span>
      </Show>

      <Show when={props.error && props.status === "error"}>
        <span class="text-destructive text-xs" data-slot="error-message">
          {props.error}
        </span>
      </Show>
    </div>
  );
};
```

(Remove the `solid-icons/fi` import block and the `ToolIcon_` switch.)

**Step 4: Run, verify GREEN.** `vp test run src/components/chat-area/tools/__tests__/tool-summary-row.test.tsx` → PASS.

**Step 5: Commit.** `refactor(tools): ToolSummaryRow takes an icon component + part`

---

### Task 12: `timeline-grouping.ts` — registry-driven explore classification

**Files:**

- Modify: `apps/desktop/src/components/chat-area/timeline/timeline-grouping.ts`
- Test: `apps/desktop/src/components/chat-area/timeline/__tests__/timeline-grouping.test.ts`

**Step 1: Update the test** — the "groups mixed explore tools (read + grep + **glob**)" case becomes `read + grep + find` (glob is no longer an explore tool). Rename and swap `glob` → `find` in that test's fixtures.

**Step 2: Run the test, verify it fails** at the glob assertion (or compile error after edit).

**Step 3: Implement** — rewrite `timeline-grouping.ts`:

```ts
import type { MessagePart } from "~/stores/types.ts";
import { isExploreTool, normalizeToolName } from "../tools/index.ts";

export type ToolCallPart = Extract<MessagePart, { type: "tool_call" }>;

function isExplorePart(part: MessagePart): boolean {
  return part.type === "tool_call" && isExploreTool(normalizeToolName(part.toolName));
}

export type TimelineItem =
  | { kind: "single"; part: MessagePart }
  | { kind: "explore"; parts: ToolCallPart[] };

/**
 * Group consecutive explore tools into a single "explore" item when 2+ appear
 * in a row. Other parts break the run and become "single" items. Exact part
 * references are preserved (no cloning).
 */
export function groupTimelineParts(parts: MessagePart[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let i = 0;

  while (i < parts.length) {
    if (isExplorePart(parts[i]!)) {
      const group: ToolCallPart[] = [];
      while (i < parts.length && isExplorePart(parts[i]!)) {
        group.push(parts[i] as ToolCallPart);
        i++;
      }
      if (group.length >= 2) {
        items.push({ kind: "explore", parts: group });
      } else {
        items.push({ kind: "single", part: group[0]! });
      }
    } else {
      items.push({ kind: "single", part: parts[i]! });
      i++;
    }
  }

  return items;
}
```

**Step 4: Run, verify GREEN.** `vp test run src/components/chat-area/timeline/__tests__/timeline-grouping.test.ts` → PASS.

**Step 5: Commit.** `refactor(timeline): explore classification via tool registry`

---

### Task 13: `timeline-renderer.tsx` — registry flow for tool rows

**Files:** Modify: `apps/desktop/src/components/chat-area/timeline/timeline-renderer.tsx`

**Step 1: Test.** Existing `timeline-renderer.test.tsx` covers tool rendering — run it first to confirm it's the safety net:

```bash
vp test run src/components/chat-area/timeline/__tests__/timeline-renderer.test.tsx
```

It should PASS on the old code. (No new test — this is a behavior-preserving refactor.)

**Step 2: Implement.** In `timeline-renderer.tsx`:

- Remove: the local `ToolIcon` type, `TOOL_ICON_MAP`, `ToolIconCmp`, and `formatToolSummary`.
- Remove imports of the `format*` functions from `../tools/tool-summary-formatters.ts`.
- Add import: `import { getToolDescriptor, normalizeToolName, toToolPartData } from "../tools/index.ts";`
- Replace the `if (part.type === "tool_call")` branch with:

```tsx
if (part.type === "tool_call") {
  const pd = toToolPartData(part);
  const d = getToolDescriptor(normalizeToolName(part.toolName));
  return (
    <TimelineStep icon={<d.icon part={pd} />} isLast={isLast()}>
      <ToolSummaryRow
        class="pt-0"
        icon={d.icon}
        part={pd}
        showIcon={false}
        status={
          part.status === "running" ? "running" : part.status === "error" ? "error" : "completed"
        }
        summary={d.summary(pd)}
      />
    </TimelineStep>
  );
}
```

> Reactivity: `d.summary(pd)` is read inline in JSX (Solid wraps it in a getter); `pd` is the getter-based adapter, so reads of `part.result`/`part.details` stay tracked and the row updates on completion without remount. `d.icon` is a stable component reference.

**Step 3: Run, verify GREEN.** `vp test run src/components/chat-area/timeline/__tests__/timeline-renderer.test.tsx` → PASS.

**Step 4: Commit.** `refactor(timeline): render tool rows via tool registry`

---

### Task 14: `explore-step.tsx` — registry flow

**Files:** Modify: `apps/desktop/src/components/chat-area/timeline/explore-step.tsx`

**Step 1: Test.** Run existing explore tests as the safety net: `vp test run src/components/chat-area/timeline/__tests__/explore-step.test.tsx` (confirm green before).

**Step 2: Implement.**

- Remove: local `TOOL_ICON_MAP` and `formatExploreSummary`.
- Remove the `format*` imports from `../tools/tool-summary-formatters.ts`.
- Add import: `import { getToolDescriptor, normalizeToolName, toToolPartData } from "../tools/index.ts";`
- Replace the `<For each={props.parts}>` body:

```tsx
<For each={props.parts}>
  {(part) => {
    const pd = toToolPartData(part);
    const d = getToolDescriptor(normalizeToolName(part.toolName));
    return (
      <ToolSummaryRow
        icon={d.icon}
        part={pd}
        status={part.status === "running" ? "running" : "completed"}
        summary={d.summary(pd)}
      />
    );
  }}
</For>
```

**Step 3: Run, verify GREEN.** `vp test run src/components/chat-area/timeline/__tests__/explore-step.test.tsx` → PASS.

**Step 4: Commit.** `refactor(timeline): render explore rows via tool registry`

---

### Task 15: `parts/tool-part.tsx` — registry flow

**Files:** Modify: `apps/desktop/src/components/chat-area/parts/tool-part.tsx`

**Step 1: Test.** Run existing tool-part tests as safety net.

**Step 2: Implement.**

- Remove: local `ToolIcon` type, `TOOL_ICON_MAP`, and the `summary()` switch.
- Remove the `format*` imports from `../tools/tool-summary-formatters.ts` and `normalizeToolName` from `../tools/tool-name.ts`.
- Add import: `import { getToolDescriptor, normalizeToolName, toToolPartData } from "../tools/index.ts";` and `import type { ToolCallPart } from "../tools/shared.ts";`
- Replace the component body to use the registry:

```tsx
export const ToolPart: Component<PartProps> = (props) => {
  const isToolCall = (): boolean => props.part.type === "tool_call";
  const descriptor = () =>
    getToolDescriptor(normalizeToolName(isToolCall() ? props.part.toolName : "unknown"));
  const pd = (): ReturnType<typeof toToolPartData> | undefined =>
    isToolCall() ? toToolPartData(props.part as ToolCallPart) : undefined;

  const toolStatus = (): ToolStatus => {
    if (!isToolCall()) return "pending";
    switch (props.part.status) {
      case "running":
        return "running";
      case "done":
        return "completed";
      case "error":
        return "error";
      default:
        return "pending";
    }
  };

  const errorMessage = (): string | undefined => {
    if (!isToolCall() || props.part.status !== "error") return;
    const result = props.part.result;
    if (typeof result !== "string" || result.length === 0) return;
    return result.length > ERROR_TRUNCATION_LENGTH
      ? `${result.slice(0, ERROR_TRUNCATION_LENGTH - 3)}...`
      : result;
  };

  return (
    <Show when={isToolCall() && pd()}>
      {(data) => (
        <div class={cn("tool-part-wrapper")} data-component="tool-part-wrapper">
          <ToolSummaryRow
            error={errorMessage()}
            icon={descriptor().icon}
            part={data()}
            status={toolStatus()}
            summary={descriptor().summary(data())}
          />
        </div>
      )}
    </Show>
  );
};
```

(Keep `mapStatus`/`ToolStatus`/`ERROR_TRUNCATION_LENGTH` if you prefer; the above inlines status mapping. `normalizeToolName` is still used for the `Show`-guarded lookup.)

**Step 3: Run, verify GREEN.** Run any tool-part test + the parts registry tests.

**Step 4: Commit.** `refactor(parts): render tool_part via tool registry`

---

## Phase 5 — Remove the old code

### Task 16: Delete old formatters + alias map

**Files:**

- Delete: `apps/desktop/src/components/chat-area/tools/tool-summary-formatters.ts`
- Delete: `apps/desktop/src/components/chat-area/tools/tool-name.ts`
- Delete: `apps/desktop/src/components/chat-area/tools/__tests__/tool-summary-formatters.test.ts` (cases migrated to per-tool tests in Phase 2)

**Step 1: Verify nothing imports them.**

```bash
rg "tool-summary-formatters|tools/tool-name" apps/desktop/src
```

Expected: no matches (all consumers switched in Phase 4). If any remain, switch them first.

**Step 2: Delete the three files.**

```bash
git rm apps/desktop/src/components/chat-area/tools/tool-summary-formatters.ts \
       apps/desktop/src/components/chat-area/tools/tool-name.ts \
       apps/desktop/src/components/chat-area/tools/__tests__/tool-summary-formatters.test.ts
```

**Step 3: Run the full desktop suite + typecheck.**

```bash
vp test run
vp check
```

Workdir: `apps/desktop`. Expected: all green.

**Step 4: Commit.** `refactor(tools): remove legacy formatters + alias map (superseded by registry)`

---

## Phase 6 — Verify end-to-end

### Task 17: Full workspace check + manual smoke

**Step 1: Full workspace.**

```bash
vp run -r test     # all packages — expect all green
vp check           # format + lint + typecheck
```

**Step 2: Manual smoke (run the app).**

```bash
vp run desktop#dev
```

Check in the UI:

- A `read` of a **file** → "Read <path>" + file icon.
- A `read` of a **directory** → "List <path>" + folder icon (the read-dir signal).
- Consecutive read/grep/find → grouped into "Explored N files".
- A `websearch` → "Searched the web: …" + globe icon.
- A `propose_session` → "Proposed session: …" + share icon.
- An old/unknown tool name → generic fallback summary + neutral icon.

**Step 3: Commit any final fixes.** (No-op commit if everything's clean.)

---

## Done criteria

- [ ] `store.tsx`, `shared.ts`, `index.ts` exist at `tools/` level; 9 descriptors in `tools/registry/`.
- [ ] Adding a hypothetical new tool requires only: new `registry/<name>.tsx` + one import line in `index.ts`.
- [ ] `tool-summary-formatters.ts` and `tool-name.ts` are gone; no consumer references them.
- [ ] UI registry matches the server's 9 tools (`websearch` + `propose_session` added; `glob`/`ls`/`Task*`/`vscode_get_diagnostics` removed).
- [ ] read dir/file detection works end-to-end via `details.kind` (no UI output-sniffing).
- [ ] `vp run -r test` green; `vp check` clean.

---

## Notes for the executor

- **TDD discipline:** every new module has a failing test first. For Phase 4 refactors, the existing component tests are the safety net — run them before and after each switch.
- **Reactivity:** the `toToolPartData` getter-adapter is what keeps tool rows updating on completion without remount. Don't snapshot its fields.
- **`store.tsx` not `store.ts`:** the generic fallback owns a JSX icon component. The mechanics are otherwise plain TS.
- **Icons** are easy to tweak per-descriptor — that's the point. If a `solid-icons/fi` name doesn't exist, pick a neighbor (e.g., `FiShare2`, `FiExternalLink`).
- **Logger rule:** don't remove existing log statements you encounter during the refactor.
