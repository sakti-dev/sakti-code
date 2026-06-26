# Slash (`/`) & At (`@`) Context Menus Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let the user type `/` (at caret 0) or `@` (anywhere) in the chat input to open a `CommandDialog` listing commands+skills or project files; picking an item inserts a text token (`/name`, `skill:name`, `@path`) that a server-side preprocessor resolves at prompt time.

**Architecture:** Two menus share one `CommandDialog` + a shared `useListNavigation` hook (extracted from `model-seletor/hooks.ts`). All picks insert **text tokens** — the chat textarea stays a plain string. A server-side **prompt preprocessor** (`apps/server/src/agent/prompt-preprocessor.ts`) parses leading `/name`/`skill:name` tokens → dispatches to `harness.promptFromTemplate` / `harness.skill`, and scans for inline `@path` tokens → inlines file content. The harness gets `resources: { skills, promptTemplates: commands }` wired in. The three catalog endpoints (`/commands`, `/agents`) collapse into one `GET /api/projects/:id/context` returning `{ commands, skills, agents }`; `/files` stays separate (frecency search).

**Tech Stack:** TypeScript, vitest, SolidJS, Hono (`@hono/node-server`), `@sakti-code/agent` (harness `promptFromTemplate`/`skill`/resources), node:fs.

**TDD discipline:** Every task writes the failing test FIRST, watches it fail, implements minimal code, watches it pass. No production code without a failing test. Run `pnpm run fix` before committing; `pnpm run typecheck` must stay green (7 tasks).

**Key locations:**
- Chat input: `apps/desktop/src/components/chat-input/chat-input.tsx:107` (`handleKeyDown`, Enter-only), `:188` (`onInput`), `:28` (`value` signal).
- Command UI: `apps/desktop/src/components/ui/command.tsx` (no built-in nav — `CommandItem` is `onClick`/`onPick` only, l.142).
- Reference palette: `apps/desktop/src/components/commands/model-seletor/{index.tsx,hooks.ts}` (dialog + hand-rolled nav + `createResource` fetch).
- Catalog route: `apps/server/src/routes/projects/context.ts` (has `/commands` + `/agents`; add `/context`, remove the two).
- Loader: `apps/server/src/lib/context-loader.ts:40` `loadAgentContext` → `{ commands, skills, agents, diagnostics }`.
- Harness build: `apps/server/src/agent/runner.ts:358` (no `resources:` today).
- Prompt send: `apps/server/src/agent/runner.ts:458` (`harness.prompt(message)` raw).
- Harness methods: `agent-harness.ts:970` `promptFromTemplate(name,args)`, `:938` `skill(name,instructions?)`, constructor `:246` takes `resources: { skills?, promptTemplates? }`.

**Token semantics (refined from design):**
- `/name [args]` and `skill:name [args]` are detected **only when leading** (start of trimmed message) — since `/` triggers at caret 0, these tokens are always leading. Unknown names fall through to a plain prompt (robust: a literal `/foo` that isn't a command just becomes text).
- `@path` is scanned **anywhere**; only expanded when the path resolves to a readable file under the project `cwd` (so emails are naturally skipped).

---

### Task 1: Consolidate catalog into `GET /api/projects/:id/context`

**Files:**
- Modify: `apps/server/src/routes/projects/context.ts` (replace the two `.get`s with one)
- Modify: `apps/server/src/__tests__/context-routes.test.ts` (migrate tests)

**Step 1: Write the failing tests.** Replace the two existing `it(...)` blocks (l.19, l.46) and the 404 test's URL (l.72) with a single `/context` test that asserts all three fields, plus a skills fixture.

```ts
// apps/server/src/__tests__/context-routes.test.ts  (rewrite the three its)
it("GET /api/projects/:id/context returns commands, skills, and agents", async () => {
  process.env.SAKTI_AGENT_DIR = mkdtempSync(join(tmpdir(), "sakti-ctx-g-"));
  const { ctx } = await makeContext();
  const projectDir = mkdtempSync(join(tmpdir(), "sakti-ctx-p-"));
  mkdirSync(join(projectDir, ".agents", "commands"), { recursive: true });
  writeFileSync(
    join(projectDir, ".agents", "commands", "commit.md"),
    "---\ndescription: commit and push\n---\ncommit body"
  );
  mkdirSync(join(projectDir, ".agents", "skills"), { recursive: true });
  mkdirSync(join(projectDir, ".agents", "skills", "lint"), { recursive: true });
  writeFileSync(
    join(projectDir, ".agents", "skills", "lint", "SKILL.md"),
    "---\ndescription: lint the repo\n---\nlint body"
  );
  mkdirSync(join(projectDir, ".agents", "agents"), { recursive: true });
  writeFileSync(
    join(projectDir, ".agents", "agents", "scout.md"),
    "---\nmode: subagent\ndescription: scout\n---\nscout prompt"
  );
  const project = await ctx.repos.projects.create("p", projectDir);

  const app = buildApp(ctx);
  const res = await app.request(
    `http://localhost:3001/api/projects/${project.id}/context`
  );
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.commands.map((c: { name: string }) => c.name)).toEqual(["commit"]);
  expect(body.skills.map((s: { name: string }) => s.name)).toEqual(["lint"]);
  expect(body.agents.map((a: { name: string }) => a.name)).toEqual(["scout"]);
});

it("returns 404 for an unknown project", async () => {
  process.env.SAKTI_AGENT_DIR = mkdtempSync(join(tmpdir(), "sakti-ctx-g3-"));
  const { ctx } = await makeContext();
  const app = buildApp(ctx);
  const res = await app.request("http://localhost:3001/api/projects/nope/context");
  expect(res.status).toBe(404);
});
```

**Step 2: Run to verify RED.**
```bash
cd apps/server && pnpm run test src/__tests__/context-routes.test.ts
```
Expected: FAIL — `GET /:id/context` returns 404 (route doesn't exist).

**Step 3: Implement.** Rewrite `context.ts` to expose one route returning the full catalog:

```ts
// apps/server/src/routes/projects/context.ts
import { Hono } from "hono";
import { getCtx } from "../../context.ts";
import { loadAgentContext } from "../../lib/context-loader.ts";

/**
 * Project-scoped agent context for the autocomplete: slash commands, skills,
 * and `@`-mentionable agents in a single fetch (one `loadAgentContext` call).
 * Files stay on `/projects/:id/files` (frecency search, query-essential).
 */
export const contextRoutes = new Hono()
  .basePath("/projects")
  .get("/:id/context", async (c) => {
    const ctx = getCtx(c);
    const project = await ctx.repos.projects.findById(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Not found" }, 404);
    }
    const loaded = await loadAgentContext(project.cwd);
    return c.json({
      commands: loaded.commands,
      skills: loaded.skills,
      agents: loaded.agents,
    });
  });

export type ContextRoutes = typeof contextRoutes;
```

**Step 4: Run to verify GREEN.**
```bash
cd apps/server && pnpm run test src/__tests__/context-routes.test.ts
```
Expected: PASS (2 tests). Grep to confirm no stale `/commands` or `/agents` consumers remain:
```bash
rg -n "/(commands|agents)" apps/server/src apps/desktop/src --glob '!*.test.ts'
```
Expected: no matches referencing the removed routes (the desktop doesn't consume them yet).

**Step 5: Commit.**
```bash
git add apps/server/src/routes/projects/context.ts apps/server/src/__tests__/context-routes.test.ts
git commit -m "feat(server): consolidate catalog routes into GET /projects/:id/context"
```

---

### Task 2: Prompt preprocessor — `parseLeadingInvocation` (pure, with tests)

**Files:**
- Create: `apps/server/src/agent/prompt-preprocessor.ts`
- Test: `apps/server/src/agent/__tests__/prompt-preprocessor.test.ts`

**Step 1: Write the failing tests.**

```ts
// apps/server/src/agent/__tests__/prompt-preprocessor.test.ts
import { describe, expect, it } from "vitest";
import { parseLeadingInvocation } from "../prompt-preprocessor.ts";

const skills = [{ name: "graphify", description: "g", content: "c" }];
const templates = [{ name: "commit", description: "c", content: "c" }];

describe("parseLeadingInvocation", () => {
  it("detects a leading /command with args", () => {
    expect(parseLeadingInvocation("/commit feat: foo", { skills, templates })).toEqual({
      kind: "template",
      name: "commit",
      args: "feat: foo",
    });
  });

  it("detects a leading skill: invocation with instructions", () => {
    expect(parseLeadingInvocation("skill:graphify do the thing", { skills, templates })).toEqual({
      kind: "skill",
      name: "graphify",
      args: "do the thing",
    });
  });

  it("matches template/skill with no args (empty string)", () => {
    expect(parseLeadingInvocation("/commit", { skills, templates })).toEqual({
      kind: "template",
      name: "commit",
      args: "",
    });
  });

  it("falls back to prompt when /name is not a known template", () => {
    expect(parseLeadingInvocation("/unknown x", { skills, templates })).toEqual({
      kind: "prompt",
    });
  });

  it("falls back to prompt when skill:name is not a known skill", () => {
    expect(parseLeadingInvocation("skill:nope", { skills, templates })).toEqual({
      kind: "prompt",
    });
  });

  it("returns prompt for ordinary text", () => {
    expect(parseLeadingInvocation("hello world", { skills, templates })).toEqual({
      kind: "prompt",
    });
  });

  it("ignores / and skill: that are not at the start", () => {
    expect(parseLeadingInvocation("see /commit later", { skills, templates })).toEqual({
      kind: "prompt",
    });
  });
});
```

**Step 2: Run to verify RED.**
```bash
cd apps/server && pnpm run test src/agent/__tests__/prompt-preprocessor.test.ts
```
Expected: FAIL — module not found.

**Step 3: Implement.**

```ts
// apps/server/src/agent/prompt-preprocessor.ts
import type { PromptTemplate, Skill } from "@sakti-code/agent";

export type LeadingInvocation =
  | { kind: "template"; name: string; args: string }
  | { kind: "skill"; name: string; args: string }
  | { kind: "prompt" };

interface Resources {
  skills: Skill[];
  templates: PromptTemplate[];
}

/**
 * Detect a leading `/name [args]` or `skill:name [args]` invocation at the
 * start of the (trimmed) message. Since the `/` trigger fires only at caret 0,
 * these tokens are always leading. Unknown names fall through to `prompt`
 * (so a literal `/foo` that isn't a command just becomes ordinary text).
 */
export function parseLeadingInvocation(message: string, resources: Resources): LeadingInvocation {
  const trimmed = message.trimStart();
  const skillMatch = /^skill:([a-z0-9-]+)\s*(.*)$/s.exec(trimmed);
  if (skillMatch && resources.skills.some((s) => s.name === skillMatch[1])) {
    return { kind: "skill", name: skillMatch[1], args: skillMatch[2] };
  }
  const templateMatch = /^\/([^\s/]+)\s*(.*)$/s.exec(trimmed);
  if (templateMatch && resources.templates.some((t) => t.name === templateMatch[1])) {
    return { kind: "template", name: templateMatch[1], args: templateMatch[2] };
  }
  return { kind: "prompt" };
}
```

**Step 4: Run to verify GREEN.**
```bash
cd apps/server && pnpm run test src/agent/__tests__/prompt-preprocessor.test.ts
```
Expected: PASS (7 tests).

**Step 5: Commit.**
```bash
git add apps/server/src/agent/prompt-preprocessor.ts apps/server/src/agent/__tests__/prompt-preprocessor.test.ts
git commit -m "feat(server): parseLeadingInvocation for /command and skill: tokens"
```

---

### Task 3: Prompt preprocessor — `expandFileMentions` (pure, with tests)

**Files:**
- Modify: `apps/server/src/agent/prompt-preprocessor.ts` (add `expandFileMentions`)
- Test: `apps/server/src/agent/__tests__/prompt-preprocessor.test.ts` (add cases)

**Step 1: Write the failing tests.** Append to the existing describe (uses `node:fs` tmpdir).

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandFileMentions } from "../prompt-preprocessor.ts";

describe("expandFileMentions", () => {
  it("inlines an existing file's content for @path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sakti-pp-"));
    writeFileSync(join(dir, "foo.txt"), "hello file");
    const out = await expandFileMentions("see @foo.txt please", dir);
    expect(out).toContain('<file path="foo.txt">');
    expect(out).toContain("hello file");
    expect(out).toContain("please");
  });

  it("resolves nested relative paths", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sakti-pp2-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "a.ts"), "export const x = 1;");
    const out = await expandFileMentions("@src/a.ts", dir);
    expect(out).toContain("export const x = 1;");
  });

  it("leaves non-file @tokens untouched (e.g. emails)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sakti-pp3-"));
    const out = await expandFileMentions("email me@host.com ok", dir);
    expect(out).toBe("email me@host.com ok");
  });

  it("inserts an error note for an unreadable path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sakti-pp4-"));
    const out = await expandFileMentions("@nope/missing.txt", dir);
    expect(out).toContain("[could not read @nope/missing.txt]");
  });

  it("truncates files larger than the byte cap", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sakti-pp5-"));
    writeFileSync(join(dir, "big.txt"), "x".repeat(70_000));
    const out = await expandFileMentions("@big.txt", dir);
    expect(out).toContain("[truncated]");
    expect(out.length).toBeLessThan(70_000);
  });
});
```

**Step 2: Run to verify RED.**
```bash
cd apps/server && pnpm run test src/agent/__tests__/prompt-preprocessor.test.ts
```
Expected: FAIL — `expandFileMentions` not exported.

**Step 3: Implement.** Append to `prompt-preprocessor.ts`:

```ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const FILE_MAX_BYTES = 65_536;

/**
 * Scan for `@path` tokens anywhere in the text and inline the content of any
 * that resolve to a readable file under `cwd` (non-existent paths — including
 * emails — are left untouched). Huge files are truncated to FILE_MAX_BYTES.
 */
export async function expandFileMentions(text: string, cwd: string): Promise<string> {
  const seen = new Set<string>();
  let out = text;
  for (const match of text.matchAll(/@(\S+)/g)) {
    const token = match[1];
    if (seen.has(token)) continue;
    seen.add(token);
    const abs = resolve(cwd, token);
    try {
      const buf = await readFile(abs);
      const total = buf.length;
      const slice = total > FILE_MAX_BYTES ? buf.subarray(0, FILE_MAX_BYTES) : buf;
      const note = total > FILE_MAX_BYTES ? `\n[truncated: ${total} bytes]` : "";
      const inlined = `\n<file path="${token}">\n${slice.toString("utf8")}${note}\n</file>`;
      out = out.replaceAll(`@${token}`, inlined);
    } catch {
      out = out.replaceAll(`@${token}`, `[could not read @${token}]`);
    }
  }
  return out;
}
```

**Step 4: Run to verify GREEN.**
```bash
cd apps/server && pnpm run test src/agent/__tests__/prompt-preprocessor.test.ts
```
Expected: PASS (7 + 5 = 12 tests).

**Step 5: Commit.**
```bash
git add apps/server/src/agent/prompt-preprocessor.ts apps/server/src/agent/__tests__/prompt-preprocessor.test.ts
git commit -m "feat(server): expandFileMentions inlines @path file content"
```

---

### Task 4: Wire harness `resources` + preprocessor dispatch into `runner.ts`

**Files:**
- Modify: `apps/server/src/agent/runner.ts` (load full context once, pass `resources`, dispatch on first turn)

**Step 1: Write the failing test.** This is an integration test over `runPrompt`; assert that a `/name` message routes to `promptFromTemplate` and a plain message expands `@path`. Use a fake harness to avoid a real LLM. Place next to existing runner tests; if `runPrompt` isn't unit-tested today (it may require heavy context), instead unit-test a small extracted dispatcher and wire it in. **Preferred:** extract the dispatch decision into a thin helper and test that, leaving the `runner.ts` edit mechanical.

Extract + test `resolveFirstTurn(message, loaded, cwd)` returning a thunk the runner calls:

```ts
// apps/server/src/agent/__tests__/prompt-preprocessor.test.ts (append)
import { planFirstTurn } from "../prompt-preprocessor.ts";

describe("planFirstTurn", () => {
  const loaded = {
    skills: [{ name: "graphify", description: "g", content: "c" }],
    templates: [{ name: "commit", description: "c", content: "c" }],
  };
  const cwd = mkdtempSync(join(tmpdir(), "sakti-plan-"));
  writeFileSync(join(cwd, "f.txt"), "DATA");

  it("plans a template turn for /name", async () => {
    const plan = await planFirstTurn("/commit x", loaded, cwd);
    expect(plan).toEqual({ kind: "template", name: "commit", args: "x" });
  });

  it("plans a prompt turn with expanded @file for ordinary text", async () => {
    const plan = await planFirstTurn("look at @f.txt", loaded, cwd);
    expect(plan.kind).toBe("prompt");
    if (plan.kind === "prompt") {
      expect(plan.text).toContain("DATA");
    }
  });
});
```

**Step 2: Run to verify RED.**
```bash
cd apps/server && pnpm run test src/agent/__tests__/prompt-preprocessor.test.ts
```
Expected: FAIL — `planFirstTurn` not exported.

**Step 3a: Implement `planFirstTurn`.** Append to `prompt-preprocessor.ts`:

```ts
export interface LoadedResources {
  skills: Skill[];
  templates: PromptTemplate[];
}

export type FirstTurnPlan =
  | { kind: "template"; name: string; args: string }
  | { kind: "skill"; name: string; args: string }
  | { kind: "prompt"; text: string };

/** Decide how the first turn runs: leading /name or skill: dispatch, else a
 *  prompt with @file mentions expanded. */
export async function planFirstTurn(
  message: string,
  loaded: LoadedResources,
  cwd: string
): Promise<FirstTurnPlan> {
  const lead = parseLeadingInvocation(message, loaded);
  if (lead.kind === "template" || lead.kind === "skill") {
    return lead;
  }
  return { kind: "prompt", text: await expandFileMentions(message, cwd) };
}
```

**Step 3b: Wire into `runner.ts`.** Two edits:

(1) Load the full context once and pass `resources` into the harness. Replace `apps/server/src/agent/runner.ts:378-379`:
```ts
const agentName = settings.agent ?? DEFAULT_AGENT_NAME;
const agent = await resolveSessionAgent(project.cwd, agentName);
```
with:
```ts
const agentName = settings.agent ?? DEFAULT_AGENT_NAME;
const loadedContext = await loadAgentContext(project.cwd);
const agent = resolveAgentByName(agentName, loadedContext.agents);
```
(`resolveAgentByName` is already exported at `runner.ts:233`; `resolveSessionAgent` becomes unused — delete its definition at l.252-259 if nothing else calls it; grep first.)

Then add `resources` to the harness constructor at l.358-371 — insert before `tools,`:
```ts
    resources: {
      skills: loadedContext.skills,
      promptTemplates: loadedContext.commands,
    },
```
**Note ordering:** `loadedContext` must be computed before the `new HarnessClass({...})` block. Move the `const loadedContext = ...` line above the harness construction (it has no dependency on the harness). Keep `const agent = resolveAgentByName(...)` where `agent` is currently used.

(2) Dispatch the first turn. Replace the `runTurn` first-turn body at l.451-459:
```ts
runTurn: async () => {
  if (firstTurn) {
    firstTurn = false;
    ctx.log?.agent.info("turn prompt", { sessionId, messageLength: message.length });
    return harness.prompt(message);
  }
  ...
```
with:
```ts
runTurn: async () => {
  if (firstTurn) {
    firstTurn = false;
    ctx.log?.agent.info("turn prompt", { sessionId, messageLength: message.length });
    const plan = await planFirstTurn(message, loadedContext, project.cwd);
    if (plan.kind === "template") {
      return harness.promptFromTemplate(plan.name, plan.args);
    }
    if (plan.kind === "skill") {
      return harness.skill(plan.name, plan.args);
    }
    return harness.prompt(plan.text);
  }
  ...
```
Add the import: `import { planFirstTurn } from "./prompt-preprocessor.ts";`

**Step 4: Run to verify GREEN + no regressions.**
```bash
cd apps/server && pnpm run test src/agent/__tests__/prompt-preprocessor.test.ts
cd apps/server && pnpm run typecheck
cd apps/server && pnpm run test
```
Expected: preprocessor tests PASS; typecheck clean; full server suite shows only the known pre-existing failures (terminal ×4, compaction-route ×1).

**Step 5: Commit.**
```bash
git add apps/server/src/agent/runner.ts apps/server/src/agent/prompt-preprocessor.ts apps/server/src/agent/__tests__/prompt-preprocessor.test.ts
git commit -m "feat(server): wire harness resources + prompt preprocessor dispatch"
```

---

### Task 5: Desktop — `detectTrigger` (pure, with tests)

**Files:**
- Create: `apps/desktop/src/components/chat-input/detect-trigger.ts`
- Test: `apps/desktop/src/components/chat-input/__tests__/detect-trigger.test.ts`

**Step 1: Write the failing tests.**

```ts
// apps/desktop/src/components/chat-input/__tests__/detect-trigger.test.ts
import { describe, expect, it } from "vitest";
import { detectTrigger } from "../detect-trigger.ts";

describe("detectTrigger", () => {
  it("fires for / typed at caret 0", () => {
    expect(detectTrigger("hello", 0)).toBeNull();
    // After typing "/", value="/" caret=1 — but we detect from the key+caret pre-insert.
    // detectTrigger takes the value AFTER the char was inserted and the caret position.
    expect(detectTrigger("/", 1)).toEqual({ char: "/", index: 0 });
  });

  it("does NOT fire for / not at caret 0", () => {
    expect(detectTrigger("hi /", 4)).toBeNull();
  });

  it("fires for @ at any position", () => {
    expect(detectTrigger("see @", 5)).toEqual({ char: "@", index: 4 });
    expect(detectTrigger("@", 1)).toEqual({ char: "@", index: 0 });
  });

  it("returns null when the char before the caret is not a trigger", () => {
    expect(detectTrigger("abc", 3)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(detectTrigger("", 0)).toBeNull();
  });
});
```

**Step 2: Run to verify RED.**
```bash
cd apps/desktop && pnpm run test src/components/chat-input/__tests__/detect-trigger.test.ts
```
Expected: FAIL — module not found.

**Step 3: Implement.**

```ts
// apps/desktop/src/components/chat-input/detect-trigger.ts
export interface Trigger {
  char: "/" | "@";
  index: number;
}

/**
 * Given the textarea value AFTER an input and the current caret position,
 * return the trigger if the char just typed is a trigger at a valid position:
 * `/` only at index 0, `@` anywhere. Called from chat-input's onInput.
 */
export function detectTrigger(value: string, caret: number): Trigger | null {
  if (caret <= 0) return null;
  const index = caret - 1;
  const char = value[index];
  if (char === "/") {
    return index === 0 ? { char: "/", index: 0 } : null;
  }
  if (char === "@") {
    return { char: "@", index };
  }
  return null;
}
```

**Step 4: Run to verify GREEN.**
```bash
cd apps/desktop && pnpm run test src/components/chat-input/__tests__/detect-trigger.test.ts
```
Expected: PASS (5 tests).

**Step 5: Commit.**
```bash
git add apps/desktop/src/components/chat-input/detect-trigger.ts apps/desktop/src/components/chat-input/__tests__/detect-trigger.test.ts
git commit -m "feat(desktop): detectTrigger for / and @ chars"
```

---

### Task 6: Desktop — `useListNavigation` hook (extracted, with tests)

**Files:**
- Create: `apps/desktop/src/components/chat-input/use-list-navigation.ts`
- Test: `apps/desktop/src/components/chat-input/__tests__/use-list-navigation.test.ts`

This generalizes the keyboard-nav pattern from `model-seletor/hooks.ts:301-339` (ArrowUp/Down wrap, Enter picks, Escape closes, activeIndex, isActive). No virtualization (files capped at 20, catalog is small).

**Step 1: Write the failing tests.** (jsdom — simulate keydown on the returned handler.)

```ts
// apps/desktop/src/components/chat-input/__tests__/use-list-navigation.test.ts
import { renderHook } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { useListNavigation } from "../use-list-navigation.ts";

const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("useListNavigation", () => {
  it("starts at index 0 and moves down with wrap-around", () => {
    const { result } = renderHook(() => useListNavigation(() => items));
    expect(result.activeIndex()).toBe(0);
    result.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(result.activeIndex()).toBe(1);
    result.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    result.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(result.activeIndex()).toBe(0); // wrapped
  });

  it("moves up with wrap-around", () => {
    const { result } = renderHook(() => useListNavigation(() => items));
    result.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(result.activeIndex()).toBe(2); // wrapped from 0 to last
  });

  it("Enter calls onPick with the active item id", () => {
    let picked: string | undefined;
    const { result } = renderHook(() =>
      useListNavigation(() => items, { onPick: (id) => (picked = id) })
    );
    result.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    result.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(picked).toBe("b");
  });

  it("Escape calls onClose", () => {
    let closed = false;
    const { result } = renderHook(() =>
      useListNavigation(() => items, { onClose: () => (closed = true) })
    );
    result.handleKeyDown(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(closed).toBe(true);
  });

  it("ignores keys when the list is empty", () => {
    const { result } = renderHook(() => useListNavigation(() => []));
    expect(() =>
      result.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter" }))
    ).not.toThrow();
  });
});
```

**Step 2: Run to verify RED.**
```bash
cd apps/desktop && pnpm run test src/components/chat-input/__tests__/use-list-navigation.test.ts
```
Expected: FAIL — module not found. (If `@solidjs/testing-library` isn't a dep, check `apps/desktop/package.json` devDeps; the model-selector tests already use it — confirm before relying on `renderHook`.)

**Step 3: Implement.**

```ts
// apps/desktop/src/components/chat-input/use-list-navigation.ts
import { createEffect, createMemo, createSignal } from "solid-js";

export interface ListNavigationOptions<T> {
  onPick?: (item: T) => void;
  onClose?: () => void;
}

export function useListNavigation<T extends { id: string }>(
  items: () => T[],
  options: ListNavigationOptions<T> = {}
) {
  const [activeIndex, setActiveIndex] = createSignal(0);

  // Reset to 0 when the item set changes shape.
  createEffect(() => {
    items();
    setActiveIndex(0);
  });

  const count = createMemo(() => items().length);

  const handleKeyDown = (event: KeyboardEvent) => {
    const n = count();
    if (n === 0) return;
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % n);
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + n) % n);
        break;
      }
      case "Enter": {
        event.preventDefault();
        const item = items()[activeIndex()];
        if (item) options.onPick?.(item);
        break;
      }
      case "Escape": {
        event.preventDefault();
        options.onClose?.();
        break;
      }
    }
  };

  const isActive = (id: string) => items()[activeIndex()]?.id === id;

  return { activeIndex, handleKeyDown, isActive };
}
```

**Step 4: Run to verify GREEN.**
```bash
cd apps/desktop && pnpm run test src/components/chat-input/__tests__/use-list-navigation.test.ts
```
Expected: PASS (5 tests).

**Step 5: Commit.**
```bash
git add apps/desktop/src/components/chat-input/use-list-navigation.ts apps/desktop/src/components/chat-input/__tests__/use-list-navigation.test.ts
git commit -m "feat(desktop): useListNavigation hook for command palettes"
```

---

### Task 7: Desktop — context menu dialog component

**Files:**
- Create: `apps/desktop/src/components/chat-input/context-menu.tsx`
- Test: `apps/desktop/src/components/chat-input/__tests__/context-menu.test.tsx`

A mode-aware `CommandDialog`. `/` mode fetches `GET /api/projects/:id/context` once (cached) and shows Commands + Skills groups, filtered client-side by the dialog query. `@` mode fetches `GET /api/projects/:id/files?query=<q>&limit=20` (debounced) and shows a Files group. On pick → calls `onPick(token)` with `/name`, `skill:name`, or `@relative/path`.

**Step 1: Write the failing tests.** Render the dialog open, assert groups render from mocked fetches, and that picking emits the right token. Mock the RPC via the existing desktop test harness (see how `model-seletor` tests stub `api`). Key behaviors to assert:
- `/` mode renders a Commands group with `/commit` and a Skills group with `skill:graphify` from a mocked `/context` payload.
- `@` mode renders file rows from a mocked `/files` payload, picking emits `@src/a.ts`.
- Typing in the search filters the `/` groups client-side.

(Write the test against the component's props: `{ open, mode, projectId, cwd, onPick, onClose }`. Use `@solidjs/testing-library` `render` + `fireEvent`; mock `useStore().api` the way sibling tests do.)

**Step 2: Run to verify RED.**
```bash
cd apps/desktop && pnpm run test src/components/chat-input/__tests__/context-menu.test.tsx
```
Expected: FAIL — component not found.

**Step 3: Implement.** Skeleton (fill fetch + rendering following `model-seletor/index.tsx`):

```tsx
// apps/desktop/src/components/chat-input/context-menu.tsx
import { createMemo, createResource, createSignal, For, Show, type JSX } from "solid-js";
import {
  CommandDialog,
  CommandDialogHeader,
  CommandDialogTitle,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "~/components/ui/command";
import { useStore } from "~/stores/store-context";
import { useListNavigation } from "./use-list-navigation.ts";

export type ContextMenuMode = "/" | "@";

export interface ContextMenuProps {
  open: boolean;
  mode: ContextMenuMode;
  projectId: string | null;
  cwd: string;
  onPick: (token: string) => void;
  onClose: () => void;
}

interface Row { id: string; label: string; token: string; }

export function ContextMenu(props: ContextMenuProps): JSX.Element {
  const { api } = useStore();
  const [query, setQuery] = createSignal("");

  // Catalog (commands + skills) — one fetch, cached for the dialog's life.
  const [catalog] = createResource(async () => {
    if (!props.projectId) return null;
    const res = await api.api.projects[":id"].context.$get({ param: { id: props.projectId } });
    if (!res.ok) return null;
    return await res.json() as { commands: { name: string; description?: string }[]; skills: { name: string; description?: string }[] };
  });

  // Files — debounced query fetch (/@ mode only).
  const [files, { mutate: setFiles }] = createResource(async (q: string = "") => {
    if (!props.projectId || props.mode !== "@") return [];
    const res = await api.api.projects[":id"].files.$get({ param: { id: props.projectId }, query: { query: q, limit: 20 } });
    if (!res.ok) return [];
    const body = await res.json() as { files: { kind: "file" | "directory"; path: string }[] };
    return body.files;
  });
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const onQueryChange = (v: string) => {
    setQuery(v);
    if (props.mode === "@") {
      clearTimeout(debounce);
      debounce = setTimeout(() => setFiles(v), 120);
    }
  };

  const rows = createMemo<Row[]>(() => {
    const q = query().trim().toLowerCase();
    if (props.mode === "/") {
      const cat = catalog();
      if (!cat) return [];
      const cmd: Row[] = cat.commands
        .filter((c) => !q || `${c.name} ${c.description ?? ""}`.toLowerCase().includes(q))
        .map((c) => ({ id: `cmd:${c.name}`, label: c.name, token: `/${c.name}` }));
      const skl: Row[] = cat.skills
        .filter((s) => !q || `${s.name} ${s.description ?? ""}`.toLowerCase().includes(q))
        .map((s) => ({ id: `skl:${s.name}`, label: s.name, token: `skill:${s.name}` }));
      return [...cmd, ...skl];
    }
    return (files() ?? []).map((f) => ({ id: `file:${f.path}`, label: f.path, token: `@${f.path}` }));
  });

  const nav = useListNavigation(rows, {
    onPick: (row) => { props.onPick(row.token); },
    onClose: () => props.onClose(),
  });

  // Split rows back into groups for headings (derive from id prefix).
  const commandRows = createMemo(() => rows().filter((r) => r.id.startsWith("cmd:")));
  const skillRows = createMemo(() => rows().filter((r) => r.id.startsWith("skl:")));
  const fileRows = createMemo(() => rows().filter((r) => r.id.startsWith("file:")));

  return (
    <CommandDialog open={props.open} onOpenChange={(o) => { if (!o) props.onClose(); }}>
      <CommandDialogHeader>
        <CommandDialogTitle>{props.mode === "/" ? "Commands & Skills" : "Files"}</CommandDialogTitle>
      </CommandDialogHeader>
      <CommandInput onValueChange={onQueryChange} onKeyDown={nav.handleKeyDown} placeholder="Filter…" />
      <CommandList>
        <CommandEmpty>No matches</CommandEmpty>
        <Show when={props.mode === "/"}>
          <CommandGroup heading="Commands">
            <For each={commandRows()}>{(r) => (
              <CommandItem value={r.id} data-active={nav.isActive(r.id)} onPick={() => props.onPick(r.token)}>
                {r.label}
              </CommandItem>
            )}</For>
          </CommandGroup>
          <Show when={skillRows().length > 0}>
            <CommandSeparator />
            <CommandGroup heading="Skills">
              <For each={skillRows()}>{(r) => (
                <CommandItem value={r.id} data-active={nav.isActive(r.id)} onPick={() => props.onPick(r.token)}>
                  {r.label}
                </CommandItem>
              )}</For>
            </CommandGroup>
          </Show>
        </Show>
        <Show when={props.mode === "@"}>
          <CommandGroup heading="Files">
            <For each={fileRows()}>{(r) => (
              <CommandItem value={r.id} data-active={nav.isActive(r.id)} onPick={() => props.onPick(r.token)}>
                {r.label}
              </CommandItem>
            )}</For>
          </CommandGroup>
        </Show>
      </CommandList>
    </CommandDialog>
  );
}
```

> **Implementer note:** the `data-active` attribute is what visually highlights the active row (the global `aria-selected` is for click-focus). If the existing `command.tsx` styling keys off `aria-selected`, add `aria-selected={nav.isActive(r.id)}` instead — verify against `command.tsx:138`. Match `model-seletor`'s styling for the active row.

**Step 4: Run to verify GREEN.**
```bash
cd apps/desktop && pnpm run test src/components/chat-input/__tests__/context-menu.test.tsx
```
Expected: PASS.

**Step 5: Commit.**
```bash
git add apps/desktop/src/components/chat-input/context-menu.tsx apps/desktop/src/components/chat-input/__tests__/context-menu.test.tsx
git commit -m "feat(desktop): context menu dialog (commands/skills/files)"
```

---

### Task 8: Wire the menus into `chat-input.tsx`

**Files:**
- Modify: `apps/desktop/src/components/chat-input/chat-input.tsx`

**Step 1: Write the failing test.** A jsdom test rendering `ChatInput`, simulating typing `/` at caret 0, asserting the `ContextMenu` opens in `/` mode; typing `@` mid-text opens `@` mode; and that picking a token inserts it into the textarea at the trigger index and closes the dialog. Mock `useStore` to provide a session → project mapping and a no-op `actions.sendPrompt`.

**Step 2: Run to verify RED.**
```bash
cd apps/desktop && pnpm run test src/components/chat-input/__tests__/chat-input.test.tsx
```
Expected: FAIL — no menu opens on `/`.

**Step 3: Implement.** Edits to `chat-input.tsx`:

1. Add state + derive project id/cwd:
```ts
import { ContextMenu, type ContextMenuMode } from "./context-menu.tsx";
import { detectTrigger } from "./detect-trigger.ts";

// inside ChatInput():
const [menu, setMenu] = createSignal<{ mode: ContextMenuMode; index: number } | null>(null);
const project = createMemo(() => props.sessionId ? sessions.get(props.sessionId).store.project : null);
```
(Adjust `project` accessor to the real session→project shape in the store; confirm against `server-store.ts` / how `ProfileSelect` resolves the session.)

2. In `onInput`, after `setValue(...)`:
```ts
onInput={(e) => {
  const el = e.currentTarget;
  setValue(el.value);
  autoResize();
  const trig = detectTrigger(el.value, el.selectionStart ?? 0);
  if (trig) setMenu({ mode: trig.char, index: trig.index });
}}
```

3. Render the menu (inside the component's returned JSX, e.g. after the input container):
```tsx
<ContextMenu
  open={menu() !== null}
  mode={menu()?.mode ?? "/"}
  projectId={project()?.id ?? null}
  cwd={project()?.cwd ?? ""}
  onPick={(token) => {
    const m = menu();
    if (!m) return;
    const el = textareaRef;
    if (el) {
      const before = value().slice(0, m.index);
      const after = value().slice(m.index + 1); // drop the trigger char
      const next = `${before}${token} ${after}`;
      setValue(next);
      queueMicrotask(() => {
        const pos = m.index + token.length + 1;
        el.focus();
        el.setSelectionRange(pos, pos);
      });
    }
    setMenu(null);
  }}
  onClose={() => setMenu(null)}
/>
```

4. Stop Enter-from-textarea from sending while the menu is open (optional polish): in `handleKeyDown`, if `menu()` is set, let the menu's input own the keys — the menu's `CommandInput` is focused, so the textarea won't receive Enter anyway. No change needed unless focus leaks.

**Step 4: Run to verify GREEN + full desktop suite.**
```bash
cd apps/desktop && pnpm run test src/components/chat-input/__tests__/chat-input.test.tsx
cd apps/desktop && pnpm run test
```
Expected: chat-input test PASS; full desktop suite green (353 prior + new).

**Step 5: Commit.**
```bash
git add apps/desktop/src/components/chat-input/chat-input.tsx apps/desktop/src/components/chat-input/__tests__/chat-input.test.tsx
git commit -m "feat(desktop): wire / and @ context menus into chat input"
```

---

### Task 9: Final verification

**Step 1:** Typecheck everything.
```bash
pnpm run typecheck   # 7 tasks, all green
```

**Step 2:** Run every package's suite; confirm only known pre-existing server failures (terminal ×4, compaction-route ×1).
```bash
for pkg in llm agent db tools; do (cd packages/$pkg && pnpm run test); done
(cd apps/server && pnpm run test)
(cd apps/desktop && pnpm run test)
```

**Step 3:** Lint + format the touched files.
```bash
pnpm run fix
```

**Step 4:** Sanity-check the RPC typing — the new `api.api.projects[":id"].context.$get(...)` resolves (it's auto-typed from `ContextRoutes`). If TS complains, confirm `contextRoutes` is still mounted in `apps/server/src/app.ts` (it is — l.35) and `export type ContextRoutes` is present.

**Step 5:** Commit any `pnpm run fix` formatting.
```bash
git add -A && git commit -m "chore: format" --allow-empty || true
```

---

## Notes for the implementer

- **TDD is non-negotiable.** Watch every test fail before implementing. If a test passes immediately, you're testing existing behavior — fix the test.
- **`exactOptionalPropertyTypes: true`** — never pass `undefined`; use conditional spread (see `context-menu.tsx` for the pattern).
- **No non-null `!`** (Biome). Guard with `?.` / early returns.
- **SolidJS attrs:** `class`/`for`, not `className`/`htmlFor`.
- **The riskiest piece is Task 4** (runner wiring) — it touches the live agent path. The extracted `planFirstTurn` keeps the logic unit-testable; the `runner.ts` edit itself is mechanical. Run the full server suite after it.
- **`@agent` is deferred** — do NOT add agent rows to the `@` menu. The `/context` payload includes `agents` for the future, but the menu ignores them.
- If `resolveSessionAgent` (runner.ts:252) becomes unused after Task 4, delete it (Biome flags dead code). Grep first: `rg -n "resolveSessionAgent"`.
