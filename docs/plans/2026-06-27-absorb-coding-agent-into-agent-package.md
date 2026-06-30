# Absorb coding-agent logic into `packages/agent` — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the pure / interface-bound coding-agent logic that currently lives in `apps/server/src/agent/` down into `packages/agent/`, so `apps/server` shrinks to a thin transport + config + DB layer (REST/WS, model/auth resolution, tools, persistence).

**Architecture:** We followed pi's split of "generic agent loop" (`packages/agent`) vs "coding-agent app" (pi's separate `coding-agent` package) by collapsing the latter into `apps/server/src/agent/`. That dir grew large. The AGENTS.md boundary for `packages/agent` is **"no persistence, no DB"** (it talks to storage via the `SessionStorage` interface), _not_ "no coding logic." By that rule, five modules are misplaced — they are pure or interface-bound with no app config:

| Module                                   | Why it can move                                                                                                                                   |
| :--------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| `system-prompt.ts` (`appendSkillsBlock`) | Pure string composition; its sibling `formatSkillsForSystemPrompt` is **already** in `packages/agent/src/harness/system-prompt.ts`.               |
| `prompt-preprocessor.ts`                 | `parseLeadingInvocation` is pure; `expandFileMentions` only needs a `readFile` callback injected to become pure.                                  |
| `builtin-agents.ts`                      | Pure `AgentDefinition[]` + helper; zero I/O.                                                                                                      |
| `auto-compaction.ts`                     | Compaction is an AGENTS.md-listed `packages/agent` responsibility; persists via `deps.session` (`SessionStorage`), not DB; model/apiKey injected. |
| `retry-loop.ts`                          | Pure decision helpers + a dep-injected orchestrator (`emit`, `runTurn`, etc. are callbacks); no direct I/O.                                       |

**Stays in `apps/server/src/agent/`** (genuine I/O / config / transport): `runner.ts`, `model-resolver.ts`, `execution-env.ts`, `tools-builder.ts`, `ws.ts`, `ws-handler.ts`, `replay-runner.ts`.

**Decision (already made):** absorb into `packages/agent` (no new package). Reassess whether a separate `packages/coding-agent` is warranted only if the server is still heavy after this.

**Key facts verified during planning (do not re-verify):**

- `packages/agent` already depends on `@sakti-code/llm`, `@sakti-code/logger`, `typebox`. **No new dependency is introduced by any task.**
- `apps/server/src/agent/runner.ts` is the **only** production importer of all five modules.
- `apps/server/src/agent/__tests__/switch-agent.test.ts` also imports `resolveBuiltinAgent` from `./builtin-agents.ts`.
- `retry-loop.ts` has **no dedicated unit test**; it is exercised via `runner.test.ts` (e2e). Moving it is pure relocation.
- `packages/agent/src/__tests__/barrel.test.ts` only asserts `buildSessionContext` + `Session` — adding exports will **not** break it.
- Internal type homes in `packages/agent`: `AgentDefinition`/`SessionTreeEntry`/`ThinkingLevel`/`PermissionRuleset`(type) → `src/harness/types.ts`; `fromConfig`/`evaluate`/`PermissionRuleset`(value) → `src/harness/permission.ts`; `Session` class → `src/harness/session.ts`; compaction primitives → `src/compaction.ts`; `AgentEvent`/`AgentMessage` → `src/types.ts`.

**Tech Stack:** TypeScript (monorepo, pnpm + turbo), vitest, `@sakti-code/agent` + `@sakti-code/llm` + `@sakti-code/logger` workspace packages, Biome (Ultracite) for lint/format.

**Conventions to honor (from AGENTS.md):**

- `exactOptionalPropertyTypes: true` → spread conditionally (`...(x !== undefined ? { x } : {})`), never pass `undefined`.
- `noUncheckedIndexedAccess: true` → guard indexed access (`arr[i]` is `T | undefined`).
- Biome: no non-null `!`; regex only at module top level; `readonly T[]` over `ReadonlyArray<T>`; `for...of` over `.forEach`; arrow callbacks; `class`/`for` in SolidJS (N/A here).
- Run `npx @biomejs/biome check --write <files>` on touched files before committing (repo-wide `pnpm run fix` has an unrelated pre-existing `packages/velomark/biome.jsonc` error — do not let it block you).

**Task ordering:** Tasks are independent and each ends green, **except Task 5 (retry-loop) depends on Task 4 (auto-compaction)** being in place, because `retry-loop.ts` imports `CompactionDecision`/`RunCompactionOutcome` from it. Do Task 4 before Task 5.

---

### Task 1: Move `appendSkillsBlock` into `packages/agent`

The simplest move — `appendSkillsBlock` wraps `formatSkillsForSystemPrompt`, which already lives in the target file.

**Files:**

- Modify: `packages/agent/src/harness/system-prompt.ts` (append function)
- Modify: `packages/agent/src/index.ts:53` (export it)
- Modify: `packages/agent/src/__tests__/harness/system-prompt.test.ts` (merge 3 tests)
- Modify: `apps/server/src/agent/runner.ts:37` (re-import from `@sakti-code/agent`)
- Delete: `apps/server/src/agent/system-prompt.ts`
- Delete: `apps/server/src/agent/__tests__/system-prompt.test.ts`

**Step 1: Add `appendSkillsBlock` to the agent-package source**

In `packages/agent/src/harness/system-prompt.ts`, append after the existing `escapeXml` function (the `Skill` type is already imported at the top — no new import):

```ts
/**
 * Compose the agent's base system prompt with the available-skills block.
 *
 * Mirrors pi's coding-agent `buildSystemPrompt`: skills are advertised only
 * when the `read` tool is available (skills are loaded by calling `read` on
 * the SKILL.md path), and the block is appended to the base prompt. Returns
 * the base prompt unchanged when `read` is unavailable or there are no
 * model-visible skills (disabled skills are filtered by
 * {@link formatSkillsForSystemPrompt}).
 */
export function appendSkillsBlock(
  baseSystemPrompt: string,
  skills: readonly Skill[],
  hasRead: boolean,
): string {
  if (!hasRead) {
    return baseSystemPrompt;
  }
  const block = formatSkillsForSystemPrompt([...skills]);
  return block ? `${baseSystemPrompt}\n\n${block}` : baseSystemPrompt;
}
```

**Step 2: Export it from the package barrel**

In `packages/agent/src/index.ts`, replace line 53:

```ts
export { formatSkillsForSystemPrompt } from "./harness/system-prompt.ts";
```

with:

```ts
export { appendSkillsBlock, formatSkillsForSystemPrompt } from "./harness/system-prompt.ts";
```

**Step 3: Merge the 3 unit tests into the existing harness test**

In `packages/agent/src/__tests__/harness/system-prompt.test.ts`:

- Update the import (line 2) to also import `appendSkillsBlock`:

```ts
import { appendSkillsBlock, formatSkillsForSystemPrompt } from "../../harness/system-prompt.ts";
```

- Append this `describe` block at the end of the file (after the existing `formatSkillsForSystemPrompt` block):

```ts
describe("appendSkillsBlock", () => {
  const base = "You are a coding agent.";

  const visibleSkill = {
    name: "graphify",
    description: "build a graph",
    content: "graph it",
    filePath: "/skills/graphify/SKILL.md",
  };

  const disabledSkill = {
    name: "hidden",
    description: "Hidden",
    content: "x",
    filePath: "/skills/hidden/SKILL.md",
    disableModelInvocation: true,
  };

  it("appends the available-skills block when read is available", () => {
    const out = appendSkillsBlock(base, [visibleSkill], true);
    expect(out.startsWith(base)).toBe(true);
    expect(out).toContain("<available_skills>");
    expect(out).toContain("<name>graphify</name>");
  });

  it("returns the base unchanged when read is not available", () => {
    expect(appendSkillsBlock(base, [visibleSkill], false)).toBe(base);
  });

  it("returns the base unchanged when there are no model-visible skills", () => {
    expect(appendSkillsBlock(base, [disabledSkill], true)).toBe(base);
    expect(appendSkillsBlock(base, [], true)).toBe(base);
  });
});
```

**Step 4: Re-point the server import**

In `apps/server/src/agent/runner.ts`:

- Delete line 37: `import { appendSkillsBlock } from "./system-prompt.ts";`
- Add `appendSkillsBlock` to the existing `@sakti-code/agent` named-import block (lines 12–18, the value import). Place it alphabetically:

```ts
import {
  appendSkillsBlock,
  evaluate,
  fromConfig,
  AgentHarness as HarnessClass,
  INTAKE_SYSTEM_PROMPT,
  Session as SessionClass,
} from "@sakti-code/agent";
```

**Step 5: Delete the old server files**

```bash
rm apps/server/src/agent/system-prompt.ts apps/server/src/agent/__tests__/system-prompt.test.ts
```

**Step 6: Verify**

Run (both must pass):

```bash
cd packages/agent && pnpm run test -- system-prompt
cd apps/server && pnpm run typecheck
```

Expected: agent `system-prompt` tests pass (now 4 `it`s in the `appendSkillsBlock` describe + the pre-existing `formatSkillsForSystemPrompt` tests); server typecheck clean.

**Step 7: Commit**

```bash
git add packages/agent/src/harness/system-prompt.ts packages/agent/src/index.ts \
  packages/agent/src/__tests__/harness/system-prompt.test.ts \
  apps/server/src/agent/runner.ts \
  apps/server/src/agent/system-prompt.ts apps/server/src/agent/__tests__/system-prompt.test.ts
git commit -m "refactor(agent): move appendSkillsBlock into packages/agent"
```

---

### Task 2: Move `prompt-preprocessor` into `packages/agent` (inject `readFile`)

`parseLeadingInvocation` is pure. `expandFileMentions` does `readFile` — we inject a `ReadFile` callback so the agent package imports **no** `node:fs`. The server supplies the real reader; tests use a fake in-memory reader (no temp dirs).

**Files:**

- Create: `packages/agent/src/harness/prompt-preprocessor.ts`
- Create: `packages/agent/src/__tests__/harness/prompt-preprocessor.test.ts`
- Modify: `packages/agent/src/index.ts` (export symbols)
- Modify: `apps/server/src/agent/runner.ts` (import + pass real reader)
- Delete: `apps/server/src/agent/prompt-preprocessor.ts`
- Delete: `apps/server/src/agent/__tests__/prompt-preprocessor.test.ts`

**Step 1: Write the failing test (at the new path, against the not-yet-created source)**

Create `packages/agent/src/__tests__/harness/prompt-preprocessor.test.ts` with the full content below. It uses a fake in-memory reader keyed by path suffix (no `node:fs`).

```ts
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ReadFile,
  expandFileMentions,
  parseLeadingInvocation,
  planFirstTurn,
} from "../../harness/prompt-preprocessor.ts";

const enc = new TextEncoder();

/** In-memory reader: returns bytes when the resolved path ends with a known key. */
function readerFor(files: Record<string, Uint8Array>): ReadFile {
  return (path) => {
    const hit = Object.entries(files).find(([k]) => path.endsWith(k));
    return Promise.resolve(hit ? hit[1] : null);
  };
}

const skills = [{ name: "graphify", description: "g", content: "c" }];
const templates = [{ name: "commit", description: "c", content: "c" }];
const resources = { skills, templates };

describe("parseLeadingInvocation", () => {
  it("detects a leading /command with args", () => {
    expect(parseLeadingInvocation("/commit feat: foo", resources)).toEqual({
      kind: "template",
      name: "commit",
      args: "feat: foo",
    });
  });

  it("detects a leading skill: invocation with instructions", () => {
    expect(parseLeadingInvocation("skill:graphify do the thing", resources)).toEqual({
      kind: "skill",
      name: "graphify",
      args: "do the thing",
    });
  });

  it("matches a template with no args (empty string)", () => {
    expect(parseLeadingInvocation("/commit", resources)).toEqual({
      kind: "template",
      name: "commit",
      args: "",
    });
  });

  it("matches a skill with no args (empty string)", () => {
    expect(parseLeadingInvocation("skill:graphify", resources)).toEqual({
      kind: "skill",
      name: "graphify",
      args: "",
    });
  });

  it("falls back to prompt when /name is not a known template", () => {
    expect(parseLeadingInvocation("/unknown x", resources)).toEqual({
      kind: "prompt",
    });
  });

  it("falls back to prompt when skill:name is not a known skill", () => {
    expect(parseLeadingInvocation("skill:nope", resources)).toEqual({
      kind: "prompt",
    });
  });

  it("returns prompt for ordinary text", () => {
    expect(parseLeadingInvocation("hello world", resources)).toEqual({
      kind: "prompt",
    });
  });

  it("ignores / and skill: that are not at the start", () => {
    expect(parseLeadingInvocation("see /commit later", resources)).toEqual({
      kind: "prompt",
    });
    expect(parseLeadingInvocation("run skill:graphify now", resources)).toEqual({ kind: "prompt" });
  });
});

describe("expandFileMentions", () => {
  it("inlines an existing file's content for @path", async () => {
    const out = await expandFileMentions(
      "see @foo.txt please",
      "/proj",
      readerFor({ "foo.txt": enc.encode("hello file") }),
    );
    expect(out).toContain('<file path="foo.txt">');
    expect(out).toContain("hello file");
    expect(out).toContain("please");
  });

  it("resolves nested relative paths", async () => {
    const out = await expandFileMentions(
      "@src/a.ts",
      "/proj",
      readerFor({ "src/a.ts": enc.encode("export const x = 1;") }),
    );
    expect(out).toContain("export const x = 1;");
  });

  it("leaves non-file @tokens untouched (e.g. emails)", async () => {
    const out = await expandFileMentions("email me@host.com ok", "/proj", readerFor({}));
    expect(out).toBe("email me@host.com ok");
  });

  it("leaves a non-existent path untouched (no error note)", async () => {
    const out = await expandFileMentions("@nope/missing.txt", "/proj", readerFor({}));
    expect(out).toBe("@nope/missing.txt");
  });

  it("truncates files larger than the byte cap", async () => {
    const out = await expandFileMentions(
      "@big.txt",
      "/proj",
      readerFor({ "big.txt": enc.encode("x".repeat(70_000)) }),
    );
    expect(out).toContain("[truncated:");
    expect(out.length).toBeLessThan(70_000);
  });
});

describe("planFirstTurn", () => {
  const loaded = {
    skills: [{ name: "graphify", description: "g", content: "c" }],
    templates: [{ name: "commit", description: "c", content: "c" }],
  };

  it("plans a template turn for a leading /name", async () => {
    const plan = await planFirstTurn("/commit feat: x", loaded, "/tmp", readerFor({}));
    expect(plan).toEqual({ kind: "template", name: "commit", args: "feat: x" });
  });

  it("plans a skill turn for a leading skill:name", async () => {
    const plan = await planFirstTurn("skill:graphify go", loaded, "/tmp", readerFor({}));
    expect(plan).toEqual({ kind: "skill", name: "graphify", args: "go" });
  });

  it("plans a prompt turn with @file expanded for ordinary text", async () => {
    const plan = await planFirstTurn(
      "look at @f.txt",
      loaded,
      "/proj",
      readerFor({ "f.txt": enc.encode("DATA") }),
    );
    expect(plan.kind).toBe("prompt");
    if (plan.kind === "prompt") {
      expect(plan.text).toContain("DATA");
    }
  });

  it("plans a prompt turn leaving unknown @tokens untouched", async () => {
    const plan = await planFirstTurn("email me@host.com", loaded, "/tmp", readerFor({}));
    expect(plan.kind).toBe("prompt");
    if (plan.kind === "prompt") {
      expect(plan.text).toBe("email me@host.com");
    }
  });
});
```

**Step 2: Run the test to verify it fails**

```bash
cd packages/agent && pnpm run test -- prompt-preprocessor
```

Expected: FAIL — `Cannot find module '../../harness/prompt-preprocessor.ts'`.

**Step 3: Create the source file**

Create `packages/agent/src/harness/prompt-preprocessor.ts`. Full content (note: `node:path` `resolve` is pure string math and stays; `node:fs` is **gone** — the reader is injected; decoding uses the web-standard `TextDecoder`):

```ts
import { resolve } from "node:path";

export type LeadingInvocation =
  | { kind: "template"; name: string; args: string }
  | { kind: "skill"; name: string; args: string }
  | { kind: "prompt" };

/** Only `name` is read; the full `Skill`/`PromptTemplate` shapes are assignable. */
export interface LoadedResources {
  skills: ReadonlyArray<{ name: string }>;
  templates: ReadonlyArray<{ name: string }>;
}

const SKILL_LEADING = /^skill:([a-z0-9-]+)\s*(.*)$/s;
const TEMPLATE_LEADING = /^\/([^\s/]+)\s*(.*)$/s;

/**
 * Detect a leading `/name [args]` or `skill:name [args]` invocation at the
 * start of the (trimmed) message. Since the `/` trigger fires only at caret 0,
 * these tokens are always leading. Unknown names fall through to `prompt`
 * (so a literal `/foo` that isn't a command just becomes ordinary text).
 */
export function parseLeadingInvocation(
  message: string,
  resources: LoadedResources,
): LeadingInvocation {
  const trimmed = message.trimStart();
  const skillMatch = SKILL_LEADING.exec(trimmed);
  const skillName = skillMatch?.[1];
  if (skillName && resources.skills.some((s) => s.name === skillName)) {
    return { kind: "skill", name: skillName, args: skillMatch?.[2] ?? "" };
  }
  const templateMatch = TEMPLATE_LEADING.exec(trimmed);
  const templateName = templateMatch?.[1];
  if (templateName && resources.templates.some((t) => t.name === templateName)) {
    return {
      kind: "template",
      name: templateName,
      args: templateMatch?.[2] ?? "",
    };
  }
  return { kind: "prompt" };
}

/** Injected file reader: returns the file's bytes, or `null` if unreadable. */
export type ReadFile = (absolutePath: string) => Promise<Uint8Array | null>;

const FILE_MAX_BYTES = 65_536;
const FILE_MENTION = /@(\S+)/g;

/**
 * Scan for `@path` tokens anywhere in the text and inline the content of any
 * that the supplied reader resolves. Tokens the reader returns `null` for
 * (missing paths, emails, etc.) are left untouched — this keeps emails and
 * ordinary prose intact. Huge files are truncated to FILE_MAX_BYTES.
 */
export async function expandFileMentions(
  text: string,
  cwd: string,
  readFile: ReadFile,
): Promise<string> {
  const seen = new Set<string>();
  let out = text;
  for (const match of text.matchAll(FILE_MENTION)) {
    const token = match[1];
    if (token === undefined || seen.has(token)) {
      continue;
    }
    seen.add(token);
    const abs = resolve(cwd, token);
    const bytes = await readFile(abs);
    if (!bytes) {
      continue;
    }
    const total = bytes.byteLength;
    const slice = total > FILE_MAX_BYTES ? bytes.subarray(0, FILE_MAX_BYTES) : bytes;
    const note = total > FILE_MAX_BYTES ? `\n[truncated: ${total} bytes]` : "";
    const inlined = `\n<file path="${token}">\n${new TextDecoder().decode(slice)}${note}\n</file>`;
    out = out.replaceAll(`@${token}`, inlined);
  }
  return out;
}

export type FirstTurnPlan =
  | { kind: "template"; name: string; args: string }
  | { kind: "skill"; name: string; args: string }
  | { kind: "prompt"; text: string };

/**
 * Decide how the first turn runs: a leading `/name` or `skill:name` dispatches
 * to the harness template/skill method; otherwise the message is a prompt with
 * any `@file` mentions expanded. Called once per run before the first turn.
 */
export async function planFirstTurn(
  message: string,
  loaded: LoadedResources,
  cwd: string,
  readFile: ReadFile,
): Promise<FirstTurnPlan> {
  const lead = parseLeadingInvocation(message, loaded);
  if (lead.kind === "template" || lead.kind === "skill") {
    return lead;
  }
  return { kind: "prompt", text: await expandFileMentions(message, cwd, readFile) };
}
```

**Step 4: Run the test to verify it passes**

```bash
cd packages/agent && pnpm run test -- prompt-preprocessor
```

Expected: PASS (all `it`s green).

**Step 5: Export the symbols from the package barrel**

Add to `packages/agent/src/index.ts` (place near the other `harness/` exports, e.g. after the `loadPromptTemplates` block around line 46):

```ts
export {
  expandFileMentions,
  parseLeadingInvocation,
  planFirstTurn,
} from "./harness/prompt-preprocessor.ts";
export type {
  FirstTurnPlan,
  LeadingInvocation,
  LoadedResources,
  ReadFile,
} from "./harness/prompt-preprocessor.ts";
```

**Step 6: Wire the real reader into the server**

In `apps/server/src/agent/runner.ts`:

- Add `readFile` to the existing `node:fs` import on line 1 (which currently imports `readFileSync`):

```ts
import { readFile, readFileSync } from "node:fs";
```

- Add `planFirstTurn` to the `@sakti-code/agent` value import block (lines 12–18). After Task 1 it already holds `appendSkillsBlock`; add `planFirstTurn`:

```ts
import {
  appendSkillsBlock,
  evaluate,
  fromConfig,
  AgentHarness as HarnessClass,
  INTAKE_SYSTEM_PROMPT,
  planFirstTurn,
  Session as SessionClass,
} from "@sakti-code/agent";
```

- Delete line 34: `import { planFirstTurn } from "./prompt-preprocessor.ts";`

- Update the `planFirstTurn(...)` call (lines 490–497) to pass the real reader. `node:fs/promises` `readFile` returns a `Buffer` (a `Uint8Array`), assignable to the `ReadFile` contract; `.catch(() => null)` makes unreadable paths return `null`:

```ts
const plan = await planFirstTurn(
  message,
  {
    skills: loadedContext.skills,
    templates: loadedContext.commands,
  },
  project.cwd,
  (p) => readFile(p).catch(() => null),
);
```

> Note: `readFile` from `node:fs` (callback-style) vs `node:fs/promises` (promise-style). Use the **promises** version. Adjust the import to:
>
> ```ts
> import { readFileSync } from "node:fs";
> import { readFile } from "node:fs/promises";
> ```
>
> (Keep `readFileSync` from `node:fs` for the existing replay path on line 123; add the promise `readFile` separately. Do not mix them into one import.)

**Step 7: Delete the old server files**

```bash
rm apps/server/src/agent/prompt-preprocessor.ts \
   apps/server/src/agent/__tests__/prompt-preprocessor.test.ts
```

**Step 8: Verify**

```bash
cd packages/agent && pnpm run test -- prompt-preprocessor
cd apps/server && pnpm run typecheck
```

Expected: agent tests green; server typecheck clean.

**Step 9: Commit**

```bash
git add packages/agent/src/harness/prompt-preprocessor.ts \
  packages/agent/src/__tests__/harness/prompt-preprocessor.test.ts \
  packages/agent/src/index.ts apps/server/src/agent/runner.ts \
  apps/server/src/agent/prompt-preprocessor.ts \
  apps/server/src/agent/__tests__/prompt-preprocessor.test.ts
git commit -m "refactor(agent): move prompt-preprocessor into packages/agent (inject readFile)"
```

---

### Task 3: Move `builtin-agents` into `packages/agent`

Pure `AgentDefinition[]` + resolver, no I/O. Only adjusts its imports to internal paths.

**Files:**

- Create: `packages/agent/src/harness/builtin-agents.ts`
- Create: `packages/agent/src/__tests__/harness/builtin-agents.test.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `apps/server/src/agent/runner.ts:31`
- Modify: `apps/server/src/agent/__tests__/switch-agent.test.ts:7`
- Delete: `apps/server/src/agent/builtin-agents.ts`
- Delete: `apps/server/src/agent/__tests__/builtin-agents.test.ts`

**Step 1: Create the source at the new path**

Create `packages/agent/src/harness/builtin-agents.ts` with the **exact body** of the current `apps/server/src/agent/builtin-agents.ts`, but change only the top import (lines 1–5) from:

```ts
import { type AgentDefinition, fromConfig, type PermissionRuleset } from "@sakti-code/agent";
```

to internal relative imports:

```ts
import type { AgentDefinition } from "./types.ts";
import { fromConfig, type PermissionRuleset } from "./permission.ts";
```

Keep everything else (the four `*_PROMPT` consts, the four ruleset helpers, `BUILTIN_AGENTS`, `resolveBuiltinAgent`, `DEFAULT_AGENT_NAME`) **byte-for-byte identical**.

**Step 2: Move the test**

Copy `apps/server/src/agent/__tests__/builtin-agents.test.ts` to `packages/agent/src/__tests__/harness/builtin-agents.test.ts` and change its import (line 8) from:

```ts
import { BUILTIN_AGENTS, resolveBuiltinAgent } from "../builtin-agents.ts";
```

to a relative import into the package source:

```ts
import {
  BUILTIN_AGENTS,
  DEFAULT_AGENT_NAME,
  resolveBuiltinAgent,
} from "../../harness/builtin-agents.ts";
```

(If the test does not already import `DEFAULT_AGENT_NAME`, drop it from the import — only import what the test uses. Preserve the rest of the test unchanged.)

**Step 3: Run the test to verify it passes**

```bash
cd packages/agent && pnpm run test -- builtin-agents
```

Expected: PASS.

**Step 4: Export from the package barrel**

Add to `packages/agent/src/index.ts` (near the `loadAgents` exports around line 21):

```ts
export {
  BUILTIN_AGENTS,
  DEFAULT_AGENT_NAME,
  resolveBuiltinAgent,
} from "./harness/builtin-agents.ts";
```

**Step 5: Re-point server imports**

In `apps/server/src/agent/runner.ts`:

- Delete line 31: `import { BUILTIN_AGENTS, DEFAULT_AGENT_NAME } from "./builtin-agents.ts";`
- Add `BUILTIN_AGENTS` and `DEFAULT_AGENT_NAME` to the `@sakti-code/agent` value import (now holding `appendSkillsBlock`, `planFirstTurn`, etc.):

```ts
import {
  appendSkillsBlock,
  BUILTIN_AGENTS,
  DEFAULT_AGENT_NAME,
  evaluate,
  fromConfig,
  AgentHarness as HarnessClass,
  INTAKE_SYSTEM_PROMPT,
  planFirstTurn,
  Session as SessionClass,
} from "@sakti-code/agent";
```

In `apps/server/src/agent/__tests__/switch-agent.test.ts`, change line 7 from:

```ts
import { resolveBuiltinAgent } from "../builtin-agents.ts";
```

to:

```ts
import { resolveBuiltinAgent } from "@sakti-code/agent";
```

**Step 6: Delete the old server files**

```bash
rm apps/server/src/agent/builtin-agents.ts \
   apps/server/src/agent/__tests__/builtin-agents.test.ts
```

**Step 7: Verify**

```bash
cd packages/agent && pnpm run test -- builtin-agents
cd apps/server && pnpm run typecheck
cd apps/server && pnpm run test -- switch-agent
```

Expected: all green.

**Step 8: Commit**

```bash
git add packages/agent/src/harness/builtin-agents.ts \
  packages/agent/src/__tests__/harness/builtin-agents.test.ts \
  packages/agent/src/index.ts apps/server/src/agent/runner.ts \
  apps/server/src/agent/__tests__/switch-agent.test.ts \
  apps/server/src/agent/builtin-agents.ts \
  apps/server/src/agent/__tests__/builtin-agents.test.ts
git commit -m "refactor(agent): move builtin-agents into packages/agent"
```

---

### Task 4: Move `auto-compaction` into `packages/agent`

Compaction is an AGENTS.md-listed `packages/agent` responsibility; the policy module is pure/interface-bound (persists via `SessionStorage`, model+apiKey injected). It goes next to the primitives in `src/compaction/`.

> **Do this Task before Task 5** — `retry-loop.ts` imports `CompactionDecision`/`RunCompactionOutcome` from here.

**Files:**

- Create: `packages/agent/src/compaction/auto-compaction.ts`
- Create: `packages/agent/src/__tests__/compaction/auto-compaction.test.ts` (new `__tests__/compaction/` dir)
- Modify: `packages/agent/src/index.ts`
- Modify: `apps/server/src/agent/runner.ts:27-30`
- Delete: `apps/server/src/agent/auto-compaction.ts`
- Delete: `apps/server/src/agent/__tests__/auto-compaction.test.ts`

**Step 1: Create the source at the new path**

Create `packages/agent/src/compaction/auto-compaction.ts` with the **exact body** of the current `apps/server/src/agent/auto-compaction.ts`, with these import changes:

Original top imports:

```ts
import type { ThinkingLevel } from "@sakti-code/agent";
import {
  type AgentMessage,
  type CompactionSettings,
  calculateContextTokens,
  compact,
  estimateContextTokens,
  prepareCompaction,
  type Session,
  type SessionTreeEntry,
  shouldCompact,
} from "@sakti-code/agent";
import { type AssistantMessage, isContextOverflow, type Model } from "@sakti-code/llm";
```

New (resolve to internal paths; keep `@sakti-code/llm` as-is):

```ts
import type { AgentMessage } from "../types.ts";
import {
  type CompactionSettings,
  calculateContextTokens,
  compact,
  estimateContextTokens,
  prepareCompaction,
  shouldCompact,
} from "../compaction.ts";
import type { Session, SessionTreeEntry } from "../harness/session.ts";
import type { ThinkingLevel } from "../harness/types.ts";
import { type AssistantMessage, isContextOverflow, type Model } from "@sakti-code/llm";
```

> **Verify `Session`/`SessionTreeEntry` source paths:** `Session` (class) is in `src/harness/session.ts`; `SessionTreeEntry` and `ThinkingLevel` are in `src/harness/types.ts`. If the compiler reports a type-only vs value mismatch, import `Session` as a value (`import { Session } from "../harness/session.ts"`) — but since `auto-compaction.ts` only uses it as a _type_ (`session: Session` in `RunCompactionDeps`), `import type` is correct. Keep everything else in the file identical.

**Also update the module header comment** (lines 19–39): it currently says "Ports pi's … into the server layer. The agent loop deliberately does not compact … the decision + execution live here." Rewrite the opening to reflect the new home, e.g.:

```ts
/**
 * # Auto-compaction policy
 *
 * Ports pi's `_checkCompaction` + `_runAutoCompaction` (from
 * `openspec/references/pi/packages/coding-agent/src/core/agent-session.ts`).
 * The agent loop itself does not compact (neither does pi's); this module
 * supplies the per-turn policy (decide + run) and is hooked into the turn
 * loop by the server via {@link CheckCompactionInput} / {@link RunCompactionDeps}.
 *
 * The pure primitives (`shouldCompact`, `estimateContextTokens`,
 * `calculateContextTokens`, `prepareCompaction`, `compact`) live alongside in
 * `../compaction.ts`; this module supplies the policy that calls them per turn.
 *
 * It owns no I/O of its own: persistence goes through the `Session`
 * (`SessionStorage`) interface, and the model + API key are injected by the
 * caller — so it has no dependency on app config (`profiles.json` / `auth.json`).
 *
 * Known limitation (inherited from pi): … [keep the existing limitation paragraph unchanged]
 */
```

(Keep the "Known limitation" paragraph verbatim.)

**Step 2: Move the test**

Create `packages/agent/src/__tests__/compaction/auto-compaction.test.ts` (create the `compaction/` dir) with the **exact body** of `apps/server/src/agent/__tests__/auto-compaction.test.ts`, changing only the imports (lines 1–11):

Original:

```ts
import { type CompactionSettings, DEFAULT_COMPACTION_SETTINGS } from "@sakti-code/agent";
import type { AssistantMessage, Usage } from "@sakti-code/llm";
import { describe, expect, it } from "vitest";
import {
  type CheckCompactionInput,
  checkCompaction,
  parseCompactionSettings,
} from "../auto-compaction.ts";
```

New:

```ts
import { type CompactionSettings, DEFAULT_COMPACTION_SETTINGS } from "../../compaction.ts";
import type { AssistantMessage, Usage } from "@sakti-code/llm";
import { describe, expect, it } from "vitest";
import {
  type CheckCompactionInput,
  checkCompaction,
  parseCompactionSettings,
} from "../../compaction/auto-compaction.ts";
```

Keep every test case unchanged.

**Step 3: Run the test to verify it passes**

```bash
cd packages/agent && pnpm run test -- auto-compaction
```

Expected: PASS.

**Step 4: Export from the package barrel**

Add to `packages/agent/src/index.ts`:

```ts
export {
  checkCompaction,
  parseCompactionSettings,
  runAutoCompaction,
} from "./compaction/auto-compaction.ts";
export type {
  CheckCompactionInput,
  CompactionDecision,
  CompactionReason,
  RunCompactionDeps,
  RunCompactionOutcome,
} from "./compaction/auto-compaction.ts";
```

**Step 5: Re-point the server import**

In `apps/server/src/agent/runner.ts`, delete lines 26–30:

```ts
import { checkCompaction, parseCompactionSettings, runAutoCompaction } from "./auto-compaction.ts";
```

and add `checkCompaction`, `parseCompactionSettings`, `runAutoCompaction` to the growing `@sakti-code/agent` value import.

**Step 6: Delete the old server files**

```bash
rm apps/server/src/agent/auto-compaction.ts \
   apps/server/src/agent/__tests__/auto-compaction.test.ts
```

**Step 7: Verify**

```bash
cd packages/agent && pnpm run test -- auto-compaction
cd apps/server && pnpm run typecheck
```

Expected: green.

**Step 8: Commit**

```bash
git add packages/agent/src/compaction/auto-compaction.ts \
  packages/agent/src/__tests__/compaction/auto-compaction.test.ts \
  packages/agent/src/index.ts apps/server/src/agent/runner.ts \
  apps/server/src/agent/auto-compaction.ts \
  apps/server/src/agent/__tests__/auto-compaction.test.ts
git commit -m "refactor(agent): move auto-compaction policy into packages/agent"
```

---

### Task 5: Move `retry-loop` into `packages/agent`

**Depends on Task 4** (imports `CompactionDecision`/`RunCompactionOutcome` from `auto-compaction`). No dedicated unit test exists — this is pure relocation; correctness is covered by `apps/server` `runner.test.ts`.

**Files:**

- Create: `packages/agent/src/retry-loop.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `apps/server/src/agent/runner.ts:36`
- Delete: `apps/server/src/agent/retry-loop.ts`

**Step 1: Create the source at the new path**

Create `packages/agent/src/retry-loop.ts` with the **exact body** of `apps/server/src/agent/retry-loop.ts`, with these import changes:

Original imports (lines 29–36):

```ts
import type { AgentEvent } from "@sakti-code/agent";
import type { AssistantMessage } from "@sakti-code/llm";
import { isRetryableAssistantError } from "@sakti-code/llm";
import type { Logger } from "@sakti-code/logger";
import type { CompactionDecision, RunCompactionOutcome } from "./auto-compaction.ts";
```

New:

```ts
import type { AgentEvent } from "./types.ts";
import type { AssistantMessage } from "@sakti-code/llm";
import { isRetryableAssistantError } from "@sakti-code/llm";
import type { Logger } from "@sakti-code/logger";
import type { CompactionDecision, RunCompactionOutcome } from "./compaction/auto-compaction.ts";
```

**Update the module header comment** (lines 1–27): it explicitly says "Lives in the server layer (not the agent loop, not the SDK) so that retry state can surface to the user via typed `auto_retry_*` events." Rewrite to reflect that it now lives in the agent package but remains **dep-injected** (the server supplies `emit`/`runTurn`/`rollbackLeaf`/`signal`), so it still owns no transport. Suggested opening:

```ts
/**
 * # Application-level retry loop
 *
 * Wraps a failed LLM turn with classification, exponential backoff, and UI
 * visibility. Lives in the agent package but owns no transport: the server
 * supplies the callbacks (`emit`, `runTurn`, `rollbackLeaf`, `signal`) so retry
 * state surfaces to the user via the same channel the caller chooses (in
 * sakti, typed `auto_retry_*` events on the WS channel).
 *
 * ## Why application-level retry?
 *
 * The SDK (`@sakti-code/llm`) runs with `maxRetries: 0` (fail fast). Retrying
 * at the SDK level hides failures from the user and offers no way to show a
 * "retrying in 4s…" banner or to cancel mid-backoff. Handling retry here gives
 * full control over backoff timing, abort, and UI reporting — matching pi's
 * coding-agent design.
 *
 * ## Flow
 *
 * 1. Run a turn (`runTurn` → harness.prompt first, harness.continue after).
 * 2. If it failed, classify via `shouldRetry` (transient + budget remaining).
 * 3. Emit `auto_retry_start`, roll the session leaf back past the failed
 *    message, sleep with exponential backoff, then re-run the turn.
 * 4. Repeat until success, budget exhaustion, or abort.
 * 5. Emit a single `auto_retry_end` (success or final failure).
 *
 * @see docs/plans/2026-06-25-application-level-retry.md
 */
```

(Keep the rest of the file — `RetryDecisionInput`, `shouldRetry`, `computeRetryDelay`, `RetrySettings`, `parseRetrySettings`, `abortableSleep`, `RetryRunnerDeps`, `executeWithRetry`, `runCompactionPhase` — byte-for-byte identical.)

**Step 2: Export from the package barrel**

Add to `packages/agent/src/index.ts`:

```ts
export {
  abortableSleep,
  computeRetryDelay,
  executeWithRetry,
  parseRetrySettings,
  shouldRetry,
} from "./retry-loop.ts";
export type { RetryDecisionInput, RetryRunnerDeps, RetrySettings } from "./retry-loop.ts";
```

**Step 3: Re-point the server import**

In `apps/server/src/agent/runner.ts`, delete line 36: `import { executeWithRetry, parseRetrySettings } from "./retry-loop.ts";` and add `executeWithRetry`, `parseRetrySettings` to the `@sakti-code/agent` value import.

**Step 4: Delete the old server file**

```bash
rm apps/server/src/agent/retry-loop.ts
```

**Step 5: Verify**

```bash
cd packages/agent && pnpm run typecheck
cd apps/server && pnpm run typecheck
cd apps/server && pnpm run test -- runner
```

Expected: both typecheck clean; `runner` tests green (this is where `executeWithRetry` is exercised end-to-end).

**Step 6: Commit**

```bash
git add packages/agent/src/retry-loop.ts packages/agent/src/index.ts \
  apps/server/src/agent/runner.ts apps/server/src/agent/retry-loop.ts
git commit -m "refactor(agent): move retry-loop into packages/agent"
```

---

### Task 6: Final sweep — full verification + docs

**Step 1: Confirm no stale local imports remain**

```bash
rg -n "from \"\./(system-prompt|prompt-preprocessor|builtin-agents|auto-compaction|retry-loop)\.ts\"" apps/server/src
```

Expected: **no matches** (all five now come from `@sakti-code/agent`).

**Step 2: Full typecheck (all packages via turbo)**

```bash
pnpm run typecheck
```

Expected: clean across agent, db, tools, server, desktop.

**Step 3: Full test suites**

```bash
cd packages/agent && pnpm run test
cd apps/server && pnpm run test
```

Expected:

- agent: all green (now includes the 5 moved/resident test files).
- server: 321 pass / 6 fail is the known baseline — the 6 are pre-existing (4 terminal/node-pty, 1 compaction-route LLM-needs-key, 1 flaky e2e). **No new failures**, and the moved-module counts moved from server to agent.

**Step 4: Lint/format touched files**

```bash
npx @biomejs/biome check --write \
  packages/agent/src/harness/system-prompt.ts \
  packages/agent/src/harness/prompt-preprocessor.ts \
  packages/agent/src/harness/builtin-agents.ts \
  packages/agent/src/compaction/auto-compaction.ts \
  packages/agent/src/retry-loop.ts packages/agent/src/index.ts \
  packages/agent/src/__tests__/harness/system-prompt.test.ts \
  packages/agent/src/__tests__/harness/prompt-preprocessor.test.ts \
  packages/agent/src/__tests__/harness/builtin-agents.test.ts \
  packages/agent/src/__tests__/compaction/auto-compaction.test.ts \
  apps/server/src/agent/runner.ts \
  apps/server/src/agent/__tests__/switch-agent.test.ts
```

Expected: no remaining diagnostics on these files. (If biome reformats, `git add` the result.)

**Step 5: Update AGENTS.md (accuracy)**

In `AGENTS.md`, the `packages/agent/` bullet currently reads:

> `packages/agent/` — pure agent loop, types, compaction. **No persistence, no DB.** Talks to storage via the `SessionStore` interface.

Append a clause noting it also hosts the coding-agent policy layer:

> `packages/agent/` — pure agent loop, types, compaction, plus the coding-agent policy layer (system-prompt composition, prompt preprocessor, builtin agents, auto-compaction policy, application-level retry). **No persistence, no DB, no app config.** Talks to storage via the `SessionStore` interface; model + API key are injected by the caller.

**Step 6: Commit the sweep**

```bash
git add AGENTS.md
# plus any biome-reformatted files
git commit -m "docs(agent): note coding-agent policy layer lives in packages/agent"
```

---

## Notes & risks

- **No behavior change.** Every move is a relocation + (for `prompt-preprocessor`) a dependency-injection of an already-used I/O. The only intentional semantic shift is `expandFileMentions` decoding via `TextDecoder` instead of `Buffer.toString("utf8")` — equivalent for valid UTF-8; the truncation test still passes (ASCII).
- **`exactOptionalPropertyTypes`** is honored throughout — the moved code already uses conditional spreads for optional fields; do not introduce bare `undefined`.
- **If `pnpm run fix` fails** on `packages/velomark/biome.jsonc` (nested-root config) — that is a pre-existing, unrelated error. Use the targeted `npx @biomejs/biome check --write <files>` in Task 6 Step 4 instead; do not try to "fix" velomark.
- **Reassessment criterion:** after this plan, if `apps/server/src/agent/` still feels heavy, the remaining weight is `runner.ts` (orchestration), `model-resolver.ts` (config), `execution-env.ts`/`tools-builder.ts` (fs/spawn), and the WS transport — all of which genuinely belong in the server. At that point a separate `packages/coding-agent` would only pay off if those I/O pieces also need reuse; until then, do not create it.
