# Agent Context & Permissions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give sakti-code the "chat input context" features (slash commands, `@` file search, `@` switchable agents) backed by a real per-tool permission engine wired into every tool — ported faithfully from the opencode reference, adapted to sakti-code's Node/Hono/SolidJS stack.

**Architecture:** Three concerns, split across the existing package seam. (1) **Pure loaders + types + engine** live in `packages/agent` (env-abstracted, no FS/DB — same status as the existing `loadSkills`). (2) **Per-tool permission declarations** live in `packages/tools`. (3) **Dir enumeration, builtins, HTTP endpoints, WS messages** live in `apps/server`. Agent switching rides the harness's existing `setModel`/`setTools`/`setResources`/`setThinkingLevel` primitives. The permission engine evaluates centrally in the agent loop's existing `beforeToolCall` path.

**Tech Stack:** TypeScript, vitest (TDD), typebox, Hono (`@hono/node-server`), `yaml` (frontmatter — already a dep via the skill loader), `@ff-labs/fff-node` (file search), SolidJS (deferred UI).

---

## PORTING DISCIPLINE (STRICT RULE — READ BEFORE EVERY TASK)

This plan ports heavily from the opencode reference at `openspec/references/opencode/`. **Do not invent code from memory.** Every task is tagged to enforce this:

- **`[PORT]`** — the logic exists in opencode. **Read the cited opencode file at its exact path/lines, copy the logic, then adapt** to sakti conventions. Adaptations are always one or more of:
  - Effect/`Schema.*` → plain TS types (sakti agent package is Effect-free)
  - `gray-matter` → sakti's existing `yaml`-based `parseFrontmatter` (see `packages/agent/src/harness/skills.ts:411`) for frontmatter consistency
  - opencode's per-instance Effect services → plain functions/classes with injected `ExecutionEnv`
  - `Bun.*` → `node:*`
- **`[NEW]`** — no direct opencode equivalent. **Cross-compare** against the closest opencode file (cited), state the decision and why it's best for sakti, then implement test-first.

**Verification gate per task:** before writing implementation, open the cited opencode source and confirm the logic matches what the test asserts. If the opencode source differs from the plan's description, **the opencode source wins** — update the task note, do not hand-wave.

**Anti-hallulination checklist (per `[PORT]` task):**
1. Read the cited opencode file fully.
2. Write the sakti test asserting the ported behavior.
3. Watch it fail.
4. Port the code (copy → adapt).
5. Watch it pass.
6. `pnpm run fix` + `pnpm run typecheck` (or per-package) before commit.

---

## Conventions Reference

- **Tests:** vitest, colocated `__tests__/` dirs. Run per-package: `cd <pkg> && pnpm run test`.
- **Typecheck:** `pnpm run typecheck` (turbo, all packages) — run the affected package's `pnpm run typecheck` during a task for speed.
- **Lint/format:** `pnpm run fix` before every commit.
- **`exactOptionalPropertyTypes: true` is ON** — spread conditionally, never pass `undefined`.
- **Frontmatter parsing:** reuse `parseFrontmatter` from `packages/agent/src/harness/skills.ts:411-432` (uses `yaml`). Do NOT introduce `gray-matter`.
- **Effect:** the sakti `packages/agent` is Effect-free. Never import `effect` there.
- **TDD:** every task is RED → verify-fail → GREEN → verify-pass → REFACTOR → commit. No production code before a failing test.

---

## Architecture & Package Layering

```
packages/agent/src/
  harness/
    skills.ts            (EXISTS — loadSkills via ExecutionEnv)
    types.ts             (MODIFY — add Agent, PromptTemplate EXISTS, PermissionRequest, AgentTool.permissions)
    agents.ts            (NEW — loadAgents, port config/agent.ts pattern)
    commands.ts          (NEW — loadCommands → PromptTemplate[], port config/command.ts pattern)
    permission/
      rule.ts            (NEW [PORT] — Rule, Ruleset, evaluate, fromConfig, merge)
  loop/
    agent-loop.ts        (MODIFY :844 — evaluate tool.permissions() in beforeToolCall path)
  index.ts               (MODIFY — re-export new loaders/types/engine)

packages/tools/src/
  tools/{read,write,edit,grep,find,ls,bash}.ts   (MODIFY — add permissions() declarator each)
  lib/command-scan.ts    (NEW [PORT] — bash command→directory extractor, from opencode tool/shell.ts)

apps/server/src/
  lib/config-dirs.ts     (MODIFY — add configDirEnumerator: walk-up .agents + global ~/.sakti/agent)
  lib/permission-store.ts (NEW — session permission state + Phase-2 ask channel stub)
  routes/
    commands.ts          (NEW — GET /api/commands)
    agents.ts            (NEW — GET /api/agents)
    projects/search-files.ts (MODIFY — back with @ff-labs/fff-node, keep fd/find fallback)
  agent/
    runner.ts            (MODIFY — load agents/commands/skills, pass to harness, wire permission ruleset)
    builtin-agents.ts    (NEW — build/plan/explore/general with rulesets)
  app.ts                 (MODIFY — mount new routes)
```

**Active ruleset resolution** (mirrors opencode `session/tools.ts:84`): `activeRuleset = merge(currentAgent.permission, sessionPermission)`. Even the default `build` agent carries a ruleset, so every tool call flows through the engine.

---

# PHASE 1 — Context Discovery (UI-light, unblocks autocomplete)

> Outcome: `GET /api/commands`, `GET /api/agents`, and fff-backed file search exist. Skills already load via `loadSkills`; this phase adds command + agent loaders and the endpoints.

## Task 1.1: Port `configEntryNameFromPath` helper `[PORT]`

Derives a config entry name (slash trigger / agent name) from a file path by stripping a known prefix and extension.

**PORT source:** `openspec/references/opencode/packages/opencode/src/config/entry-name.ts:1-19` (plain TS, 19 lines).

**Files:**
- Create: `packages/agent/src/harness/config-entry-name.ts`
- Test: `packages/agent/src/harness/__tests__/config-entry-name.test.ts`

**Step 1 (RED):** Write failing tests covering: strips `command/` prefix + `.md` ext (`command/git/commit.md` → `git/commit`); strips `agents/` plural; falls back to basename when no prefix matches; handles no extension.

```ts
// packages/agent/src/harness/__tests__/config-entry-name.test.ts
import { describe, it, expect } from "vitest";
import { configEntryNameFromPath } from "../config-entry-name.ts";

describe("configEntryNameFromPath", () => {
  it("strips command/ prefix and extension", () => {
    expect(configEntryNameFromPath("command/commit.md", ["command/", "commands/"])).toBe("commit");
  });
  it("strips plural commands/ prefix", () => {
    expect(configEntryNameFromPath("commands/foo/bar.md", ["command/", "commands/"])).toBe("foo/bar");
  });
  it("falls back to basename when no prefix matches", () => {
    expect(configEntryNameFromPath("agents/triage.md", ["command/", "commands/"])).toBe("triage");
  });
  it("handles paths with no extension", () => {
    expect(configEntryNameFromPath("command/README", ["command/", "commands/"])).toBe("README");
  });
  it("normalizes backslashes", () => {
    expect(configEntryNameFromPath("command\\sub\\x.md", ["command/", "commands/"])).toBe("sub/x");
  });
});
```

**Step 2 (verify RED):** `cd packages/agent && pnpm run test src/harness/__tests__/config-entry-name.test.ts` → FAIL (module not found).

**Step 3 (GREEN, PORT):** Read opencode `entry-name.ts:1-19`; copy verbatim into `config-entry-name.ts` (it is plain TS, no Effect). Adapt: none needed. Export `configEntryNameFromPath`.

**Step 4 (verify GREEN):** rerun → PASS.

**Step 5:** `pnpm run fix` (from repo root) + `cd packages/agent && pnpm run typecheck`.

**Step 6 (commit):** `feat(agent): port configEntryNameFromPath helper`

---

## Task 1.2: `loadCommands` — command loader `[PORT]`

Loads `{command,commands}/**/*.md` → `PromptTemplate[]` (the `PromptTemplate` type already exists in `harness/types.ts:82-90`).

**PORT source:** `openspec/references/opencode/packages/opencode/src/config/command.ts:13-39` (the glob+parse+assemble loop).

**Cross-compare decision `[NEW]`-ish adaptation:** opencode uses `Glob.scan` + `ConfigMarkdown.parse` (gray-matter). sakti has no glob util in the agent package and must stay FS-abstract. **Decision:** take an `ExecutionEnv` + a list of already-resolved directory paths (the server enumerates dirs — see Task 1.5), walk each dir via `env.listDir` for `.md` files under `command/`|`commands/`, parse with the **existing `parseFrontmatter`** from `skills.ts:411` (not gray-matter). This keeps the agent package Effect-free and consistent with `loadSkills`.

**Files:**
- Create: `packages/agent/src/harness/commands.ts`
- Test: `packages/agent/src/harness/__tests__/commands.test.ts`

**Step 1 (RED):** Test using the **existing `AgentHarness`/skill-test `ExecutionEnv` fake** (find it under `packages/agent/src/harness/__tests__/` or `packages/agent/src/harness/memory-storage.ts` — reuse the same in-memory env). Seed a fake dir `commands/commit.md` with frontmatter `description: git commit` and body `commit and push`. Assert `loadCommands(env, [dir])` returns one `PromptTemplate` `{ name: "commit", description: "git commit", content: "commit and push" }`.

```ts
// Assert shape (adapt to the real ExecutionEnv fake used by skills.test.ts)
const result = await loadCommands(env, [rootDir]);
expect(result.commands).toHaveLength(1);
expect(result.commands[0]).toMatchObject({ name: "commit", description: "git commit", content: "commit and push" });
expect(result.diagnostics).toEqual([]);
```

Also test: both `command/` and `commands/` roots; nested paths derive compound names; a malformed file yields a diagnostic, not a throw.

**Step 2 (verify RED):** run → FAIL.

**Step 3 (GREEN, PORT):** Read opencode `config/command.ts:13-39`. Port the loop: for each input dir, recursively find `.md` under `command`/`commands` subtrees, `parseFrontmatter`, name via `configEntryNameFromPath(rel, ["command/","commands/"])`, assemble `{ name, description: fm.description, content: body }`. Return `{ commands: PromptTemplate[], diagnostics }` (mirror `loadSkills`' return shape for consistency). Invalid frontmatter → push a diagnostic (do not throw).

**Step 4 (verify GREEN):** rerun → PASS.

**Step 5:** `pnpm run fix` + typecheck.

**Step 6 (commit):** `feat(agent): add loadCommands command loader`

---

## Task 1.3: `Agent` type + builtins `[NEW]` (cross-compare)

opencode's `Agent.Info` (`openspec/references/opencode/packages/opencode/src/agent/agent.ts:35-55`) is heavy (permission ruleset, model struct, color, steps, options). **Decision for sakti Phase 1:** a leaner type — name, mode, hidden, description, systemPrompt, optional model/thinkingLevel, and `activeToolNames?` (placeholder until Phase 2 adds the ruleset). This is the `PromptTemplate`-plus-mode shape. Cross-compare: opencode `mode` literals are `subagent|primary|all` — keep exactly.

**Files:**
- Modify: `packages/agent/src/harness/types.ts` (add `Agent` interface + `AgentMode`)
- Test: `packages/agent/src/harness/__tests__/agent-type.test.ts` (compile/type test + a factory if added)

**Step 1 (RED):** Test that an `Agent` object satisfies the type and `mode` accepts only the three literals (type-level test + a runtime factory `defineAgent`).

```ts
import { describe, it, expect } from "vitest";
import type { Agent, AgentMode } from "../types.ts";

describe("Agent type", () => {
  it("accepts the three modes", () => {
    const modes: AgentMode[] = ["primary", "subagent", "all"];
    expect(modes).toHaveLength(3);
  });
  it("builds a minimal agent", () => {
    const a: Agent = { name: "build", mode: "primary", systemPrompt: "x" };
    expect(a.name).toBe("build");
  });
});
```

**Step 2–4 (RED→GREEN):** add to `types.ts`:
```ts
export type AgentMode = "primary" | "subagent" | "all";
export interface Agent {
  name: string;
  mode: AgentMode;
  hidden?: boolean;
  description?: string;
  systemPrompt: string;
  model?: { providerId: string; modelId: string };  // sakti shape, not opencode's branded IDs
  thinkingLevel?: ThinkingLevel;
  activeToolNames?: string[];       // Phase 1 placeholder; Phase 2 adds `permission?: Ruleset`
}
```

**Step 5:** fix + typecheck. **Step 6 (commit):** `feat(agent): add Agent type and mode literals`

---

## Task 1.4: `loadAgents` — agent loader `[PORT]`

Loads `{agent,agents}/**/*.md` → `Agent[]`.

**PORT source:** `openspec/references/opencode/packages/opencode/src/config/agent.ts:11-32` (load) + `:34-58` (loadMode — legacy `mode/` dirs; **port but mark optional**).

**Adaptation:** same as Task 1.2 — `ExecutionEnv` + dir list, recursive `.md` walk under `agent`/`agents`, `parseFrontmatter`, name via `configEntryNameFromPath(rel, ["agent/","agents/"])`, body → `systemPrompt`, frontmatter → `mode`/`hidden`/`description`/`model`. Default `mode: "all"` for custom agents (matches opencode `agent.ts:276`). Return `{ agents, diagnostics }`.

**Files:**
- Create: `packages/agent/src/harness/agents.ts`
- Test: `packages/agent/src/harness/__tests__/agents.test.ts`

**Step 1 (RED):** seed `agents/triage.md` with frontmatter `mode: primary\nhidden: true` and body `You are triage...`. Assert loaded `Agent` has `mode:"primary"`, `hidden:true`, `systemPrompt` = body, `name:"triage"`. Also: an agent with no `mode` frontmatter defaults to `"all"`.

**Step 2 (verify RED). Step 3 (GREEN, PORT):** port the loop from opencode `config/agent.ts:11-32`. **Step 4 (verify GREEN). Step 5 (fix+typecheck). Step 6 (commit):** `feat(agent): add loadAgents agent loader`.

---

## Task 1.5: Config-dir enumerator (walk-up `.agents` + global) `[PORT]`

**PORT source:** `openspec/references/opencode/packages/core/src/fs-util.ts:151-165` (`up()` walk-up primitive) + `packages/opencode/src/config/paths.ts:23-41` (`directories` assembly).

**Cross-compare decision:** opencode walks up to a git worktree root and scans `~/.config/opencode` + `~/.opencode`. **For sakti:** scan two scopes — global `getAgentDir()` (`~/.sakti/agent/`, already in `apps/server/src/lib/config-dirs.ts:8`) and project `<cwd>/.agents/` (decided in brainstorming). **Defer** the full walk-up-to-worktree until monorepo support is needed — `project.cwd` is the single project scan point for now (noted as a follow-up). This is simpler than opencode and sufficient.

**Files:**
- Modify: `apps/server/src/lib/config-dirs.ts`
- Test: `apps/server/src/lib/__tests__/config-dirs.test.ts`

**Step 1 (RED):** test `enumerateAgentConfigDirs(projectCwd)` returns `[getAgentDir(), join(projectCwd, ".agents")]` deduped, and that a `SAKTI_AGENT_DIR` override changes the global entry.

```ts
it("returns global + project .agents dirs", () => {
  const dirs = enumerateAgentConfigDirs("/proj");
  expect(dirs).toContain(join("/proj", ".agents"));
  expect(dirs.some((d) => d.endsWith(".sakti/agent"))).toBe(true);
});
```

**Step 2–4 (RED→GREEN):** add `enumerateAgentConfigDirs(projectCwd: string): string[]` returning `unique([getAgentDir(), join(projectCwd, ".agents")])`. (Reserve a `walkUp(target, start, stop)` helper — port of opencode `fs-util.ts:151-165` — as a separate follow-up task when worktree support lands; do NOT implement now per YAGNI.)

**Step 5:** fix + `cd apps/server && pnpm run typecheck`. **Step 6 (commit):** `feat(server): enumerate agent config dirs (global + project .agents)`.

---

## Task 1.6: Real `ExecutionEnv` adapter + wire loaders in the server `[NEW]`

`loadSkills`/`loadCommands`/`loadAgents` take an `ExecutionEnv`. The server needs a real-FS `ExecutionEnv` (it has `apps/server/src/agent/execution-env.ts` — check it covers `fileInfo`/`listDir`/`readTextFile`/`canonicalPath`; extend if not).

**Files:**
- Modify: `apps/server/src/agent/execution-env.ts` (ensure all `ExecutionEnv` methods)
- Create: `apps/server/src/lib/context-loader.ts` (loads commands+agents+skills for a project cwd)
- Test: `apps/server/src/lib/__tests__/context-loader.test.ts` (uses a tmpdir fixture)

**Step 1 (RED):** create a tmpdir with `.agents/commands/commit.md` + `.agents/agents/triage.md` + `.agents/skills/foo/SKILL.md`; call `loadContext(env, tmpdir)`; assert it returns `{ commands: [1], agents: [1], skills: [1] }` with correct names.

**Step 2–4 (RED→GREEN):** `loadContext` calls `enumerateAgentConfigDirs(cwd)`, then `loadCommands(env, dirs)`, `loadAgents(env, dirs)`, `loadSkills(env, dirs)`, merges (later dir wins on name conflict — deep-merge per opencode `config.ts:458-460`; for Phase 1 a simple "last wins" per name is acceptable, note it). Return the merged triple.

**Step 5:** fix + typecheck. **Step 6 (commit):** `feat(server): load agent context (commands/agents/skills) per project`.

---

## Task 1.7: `GET /api/commands` + `GET /api/agents` endpoints `[NEW]`

**Files:**
- Create: `apps/server/src/routes/commands.ts`, `apps/server/src/routes/agents.ts`
- Modify: `apps/server/src/app.ts` (mount)
- Test: `apps/server/src/routes/__tests__/commands.test.ts`, `agents.test.ts` (follow the existing route-test pattern — see `apps/server/src/routes/__tests__/` or `sessions` route tests for the Hono test client setup)

**Step 1 (RED):** test `GET /api/commands?projectId=<id>` returns `{ commands: [{name,description,...}] }` loaded from the project's `.agents/commands/`. Same for `/api/agents`.

**Step 2–4 (RED→GREEN):** each route is a `factory.createApp().basePath("/...")` module (per AGENTS.md route convention), reads `project.cwd` via `ctx.repos.projects.findById`, calls `loadContext` (cache per-request for now; memoize later), projects to the wire shape, returns JSON. Register in `app.ts` via `.route("/", commandsRoutes)` etc.

**Step 5:** fix + `cd apps/server && pnpm run test` + typecheck. **Step 6 (commit):** `feat(server): add GET /api/commands and /api/agents`.

---

## Task 1.8: fff-backed file search `[NEW]` (package, not port)

Replace the body of `runFd`/`runFind` with `@ff-labs/fff-node` frecency search, keeping `fd`/`find` as the fallback when `FileFinder.isAvailable()` is false (mirrors opencode `search.ts:232` dispatch).

**Files:**
- Modify: `apps/server/src/routes/projects/search-files.ts`
- Modify: `apps/server/package.json` (add `@ff-labs/fff-node`)
- Test: `apps/server/src/routes/projects/__tests__/search-files.test.ts`

**Step 1 (RED):** test that a query returns frecency-ranked results from a tmpdir; test the fallback path by injecting `available: false`.

**Step 2–4 (RED→GREEN):** `import { FileFinder } from "@ff-labs/fff-node"`. Per project, lazily create `FileFinder.create({ basePath: cwd, aiMode: true })`, `await waitForScan()`, `mixedSearch(query, { pageSize: limit })`. Sort by `score.total` desc (port sort from opencode `search.ts:218-219`). On `!result.ok` or `!FileFinder.isAvailable()` → fall back to existing `runFd`/`runFind`. Confirm glibc at runtime is fine (already verified: GNU libc 2.42 → `gnu` variant auto-selected).

**Step 5:** fix + test + typecheck. **Step 6 (commit):** `feat(server): fff frecency file search with fd/find fallback`.

**Phase 1 done-checkpoint:** `pnpm run typecheck` green across all packages; `cd packages/agent && pnpm run test` + `cd apps/server && pnpm run test` green; endpoints return real data from `.agents/` fixtures.

---

# PHASE 2 — Permission Engine + Tool Instrumentation (no UI)

> Outcome: every tool declares `{ permission, patterns }`; the agent loop evaluates `allow`/`deny` centrally against the active agent's ruleset. `ask` is deferred (Phase 4). Even the default `build` agent flows all tools through the engine.

## Task 2.1: `Rule`, `Ruleset`, `evaluate` `[PORT]`

**PORT source:** `openspec/references/opencode/packages/opencode/src/permission/index.ts:28-38` (`evaluate`) + the `Rule`/`Ruleset`/`Wildcard.match` definitions in `@opencode-ai/schema/permission-v1` (locate via `permission-v1.ts` re-export → `./v1/permission`). Also `Wildcard.match` from `openspec/references/opencode/packages/core/src/util/wildcard.ts`.

**Files:**
- Create: `packages/agent/src/harness/permission/rule.ts` (Rule, Ruleset, PermissionAction, evaluate, wildcard match)
- Test: `packages/agent/src/harness/permission/__tests__/rule.test.ts`

**Step 1 (RED):** port the exact `evaluate` behavior — `findLast` rule where `match(permission, rule.permission) && match(pattern, rule.pattern)`, default `{ action: "ask", permission, pattern: "*" }`. Tests (assert against opencode semantics):
```ts
it("deny wins when matched", () => {
  const rs = [{ permission: "bash", pattern: "*", action: "deny" as const }];
  expect(evaluate("bash", "/tmp/x", rs).action).toBe("deny");
});
it("last matching rule wins", () => {
  const rs = [
    { permission: "read", pattern: "*", action: "deny" as const },
    { permission: "read", pattern: "*.md", action: "allow" as const },
  ];
  expect(evaluate("read", "a.md", rs).action).toBe("allow");
  expect(evaluate("read", "a.txt", rs).action).toBe("deny");
});
it("defaults to ask when nothing matches", () => {
  expect(evaluate("webfetch", "http://x", []).action).toBe("ask");
});
it("glob matches * and ** segments", () => { /* port wildcard cases from opencode wildcard tests */ });
```

**Step 2 (verify RED). Step 3 (GREEN, PORT):** read opencode `permission/index.ts:28-38` + `util/wildcard.ts`; port `evaluate` + `match` verbatim (plain TS; drop Effect). **Step 4 (verify GREEN). Step 5 (fix+typecheck). Step 6 (commit):** `feat(agent): port permission Rule/Ruleset/evaluate`.

---

## Task 2.2: `fromConfig` (nested tree → flat rules) `[PORT]`

**PORT source:** `Permission.fromConfig` in `@opencode-ai/schema/permission-v1` (the nested `{ "*": "allow", read: { "*.env": "ask" } }` → flat `Rule[]` flattener). Locate and read it fully before porting.

**Files:**
- Modify: `packages/agent/src/harness/permission/rule.ts`
- Test: `.../__tests__/rule.test.ts` (add cases)

**Step 1 (RED):** assert the flattening: `fromConfig({ "*": "allow", read: { "*.env": "ask" }, bash: "deny" })` yields rules including `{permission:"*",pattern:"*",action:"allow"}`, `{permission:"read",pattern:"*.env",action:"ask"}`, `{permission:"bash",pattern:"*",action:"deny"}`.

**Step 2–4 (RED→GREEN, PORT):** port `fromConfig`. **Step 5. Step 6 (commit):** `feat(agent): port permission fromConfig tree flattener`.

---

## Task 2.3: `merge` `[PORT]`

**PORT source:** `Permission.merge` (`@opencode-ai/schema/permission-v1`). It concatenates rulesets; `evaluate`'s `findLast` makes later win. Confirm by reading.

**Files:** same as 2.1. **Step 1 (RED):** `merge([rs1],[rs2])` → concatenated; evaluate prefers rs2 on conflict. **Step 2–4 (PORT). Step 5. Step 6 (commit):** `feat(agent): port permission merge`.

---

## Task 2.4: `AgentTool.permissions` declarator + `PermissionRequest` type `[NEW]`

Add the optional declarator to the tool interface.

**Cross-compare:** opencode tools call `permission.ask(...)` *inside* execute (coupling tool → permission service). **Decision for sakti:** a declarative `permissions?(params) → PermissionRequest[]` evaluated *before* execute — keeps tools decoupled from any permission service and maps directly onto the loop's `beforeToolCall`. This is the cleaner seam; bash still works because `permissions(params)` can parse the command param to extract dirs.

**Files:**
- Modify: `packages/agent/src/types.ts` (`AgentTool` interface) — add:
```ts
export interface PermissionRequest { permission: string; patterns: string[] }
// on AgentTool:
permissions?: (params: Static<TParameters>) => PermissionRequest[] | undefined;
```
- Test: `packages/agent/src/__tests__/tool-permissions.test.ts` (type + a stub tool declaring permissions).

**Step 1 (RED):** a stub tool with `permissions: (p) => [{ permission: "read", patterns: [p.path] }]`; assert calling it returns the request. **Step 2–4 (RED→GREEN). Step 5. Step 6 (commit):** `feat(agent): add AgentTool.permissions declarator`.

---

## Task 2.5: Loop permission evaluation (allow/deny) `[PORT]`-guided

Wire evaluation into the existing `beforeToolCall` path at `packages/agent/src/loop/agent-loop.ts:844-870`.

**Cross-compare:** opencode evaluates at both tool-exposure (`session/llm.ts:149`) and execution (`session/processor.ts:544`). **Decision for sakti Phase 2:** execution-time `deny` via `beforeToolCall` (the loop already has it). Tool-exposure filtering (excluding denied tools from the LLM request) is a **follow-up** — note it; do not implement now (keeps Phase 2 focused on the security-critical deny).

**Files:**
- Modify: `packages/agent/src/loop/agent-loop.ts` (insert permission eval between `validateToolArguments` at :843 and the existing `beforeToolCall` at :844)
- Add an optional `config.evaluatePermission?: (req) => "allow"|"deny"|"ask"` to `AgentLoopConfig` (`packages/agent/src/types.ts`) — Phase 2 treats `"ask"` as `"deny"` (no UI yet) and logs it.
- Test: `packages/agent/src/loop/__tests__/permission-eval.test.ts` (use the existing loop test harness — see `packages/agent/src/__tests__/` for the fake-stream pattern)

**Step 1 (RED):** a test where `evaluatePermission` returns `"deny"` for `read` of `/etc/shadow`; run a turn with a read tool call; assert the tool result is an error mentioning "permission"/"denied" and `execute` was never called.

**Step 2 (verify RED). Step 3 (GREEN):** in the loop, after args validated, if `tool.permissions` and `config.evaluatePermission`: collect requests, eval each `(permission, pattern)`; any `deny` → return the same `kind:"immediate"` error result shape used at :861-869. Treat `"ask"` as `"deny"` for now. **Step 4 (verify GREEN). Step 5 (fix + `cd packages/agent && pnpm run typecheck`). Step 6 (commit):** `feat(agent): evaluate tool permissions (allow/deny) in loop`.

---

## Tasks 2.6–2.11: Per-tool `permissions()` declarations `[PORT]`

Each tool declares what it touches. **PORT source per tool:** the `{ permission, patterns }` opencode declares at the cited lines — copy the permission/pattern semantics, adapt to sakti's param names.

| Task | Tool | PORT source (opencode) | Declaration |
|---|---|---|---|
| 2.6 | read | `tool/read.ts:256-257` | `[{ permission:"read", patterns:[relPath] }]` |
| 2.7 | write | `tool/write.ts:55-56` | `[{ permission:"edit", patterns:[relPath] }]` |
| 2.8 | edit | `tool/write.ts:55-56` (edit ≈ write) | `[{ permission:"edit", patterns:[relPath] }]` |
| 2.9 | grep | `tool/grep.ts:40-41` | `[{ permission:"grep", patterns:[pattern] }]` |
| 2.10 | find | `tool/glob.ts:29-30` | `[{ permission:"glob", patterns:[pattern] }]` (+ `ls` → `permission:"list"` from `tool/lsp.ts`-ish; check opencode list tool) |
| 2.11 | bash | `tool/shell.ts:75-285` | `[{ permission:"external_directory", patterns:<dir-globs> }, { permission:"bash", patterns:[...] }]` |

**Per-task TDD steps (same shape):**
1. **RED:** test `createXTool(cwd).permissions?.(params)` returns the expected `PermissionRequest[]` for a representative param (e.g. read of `src/a.ts` → `[{permission:"read",patterns:["src/a.ts"]}]`).
2. verify RED.
3. **GREEN:** add `permissions(params)` to the returned tool object. For bash, **Task 2.11 is the long pole** — see below.
4. verify GREEN. 5. fix+typecheck. 6. commit `feat(tools): declare permissions for <tool>`.

**Task 2.11 (bash) detail — command→directory extractor `[PORT]`:**
- Create `packages/tools/src/lib/command-scan.ts`.
- **PORT source:** `openspec/references/opencode/packages/opencode/src/tool/shell.ts:75-285` (the command scanner that extracts directory globs and detects out-of-cwd access). Read it fully; this is the riskiest port.
- Test first (`packages/tools/src/lib/__tests__/command-scan.test.ts`): `cd /outside && ls` → detects `external_directory: /outside`; `rm src/x.ts` → in-cwd, no external; `cat ../../etc/passwd` → external traversal. Port the cases from opencode's shell tool tests if present.
- Port the scanner (pure string parsing → `{ patterns: Set<string> }`), then `bash.permissions = (params) => buildBashRequests(params.command, cwd)`.

**Phase 2 done-checkpoint:** a turn where the active ruleset denies `read` of `*.env` produces an error tool result without executing; `cd packages/tools && pnpm run test` + `cd packages/agent && pnpm run test` green.

---

# PHASE 3 — Agent Switching (small; primitives exist)

> Outcome: `switchAgent(name)` atomically swaps system prompt + tools + model + thinking; WS message drives it.

## Task 3.1: Harness `switchAgent` `[NEW]`

The harness already has `setModel` (`agent-harness.ts:1281`), `setResources` (`:1425`), `setTools`/`setActiveToolNames` (`ToolsUpdateEvent`), `setThinkingLevel`, and a dynamic `systemPrompt` callback (`types.ts:908`). `switchAgent` is sugar.

**Files:**
- Modify: `packages/agent/src/harness/agent-harness.ts` (add `switchAgent(agent: Agent)`)
- Test: `packages/agent/src/harness/__tests__/agent-switch.test.ts`

**Step 1 (RED):** create a harness with a system-prompt callback that reads `currentAgent`; `switchAgent({name:"explore",...})`; assert `ModelUpdateEvent` + `ToolsUpdateEvent` fire and the next turn's system prompt is explore's. **Step 2–4 (RED→GREEN):** `switchAgent` records the agent, calls `setModel`/`setActiveToolNames`/`setThinkingLevel`/`setResources` and marks current; the system-prompt callback (when present) returns `currentAgent.systemPrompt`. **Step 5. Step 6 (commit):** `feat(agent): harness switchAgent`.

## Task 3.2: Server WS `switchAgent` message + active ruleset `[NEW]`

**Files:**
- Modify: `apps/server/src/agent/ws-handler.ts` (new message type), `apps/server/src/agent/runner.ts` (resolve agent by name, compute `activeRuleset = merge(agent.permission ?? fromActiveToolNames(agent), sessionPermission)`, call `harness.switchAgent`, wire `config.evaluatePermission`).
- Create: `apps/server/src/agent/builtin-agents.ts` (`build`: allow-all + `read *.env: deny`; `explore`: deny-default + read-only set; `plan`/`general`). `[PORT]` the ruleset values from opencode `agent/agent.ts:140-265`.
- Test: `apps/server/src/agent/__tests__/switch-agent.test.ts`.

**Step 1 (RED):** WS `switchAgent { sessionId, name:"explore" }` → harness tools reduced to read-only set; a subsequent `bash` tool call is denied by the engine. **Step 2–6 (RED→GREEN→commit):** `feat(server): switchAgent over WS with permission ruleset`.

**Phase 3 done-checkpoint:** switching to `explore` mid-session denies `write`/`edit` tool calls; default `build` agent denies `read` of `*.env`.

---

# PHASE 4 — Interactive `ask` + UI (DEFERRED)

> Not planned in detail here — UI work is explicitly deferred. Captured as the upgrade contract so Phase 2/3 don't preclude it.

- **Add `"ask"` handling** to the loop's permission eval (Phase 2 treats `ask` as `deny`): instead of denying, publish a `permission.requested` event carrying `{ permission, patterns }`, await a reply.
- **WS channel:** `permission.asked` → client; `permission.reply { allow | deny | always }` → server. Port the Deferred/pending shape from opencode `permission/index.ts:67-120`.
- **UI:** the approve/deny dialog (renderer, SolidJS) — separate plan when UI work begins.
- **Tool-exposure filtering:** exclude `deny`/unapproved tools from the LLM request (opencode `session/llm.ts:149-151`) — port after `ask` lands.

**Non-deferred prerequisite already satisfied:** the `Agent` type reserves a `permission?: Ruleset` field (Task 1.3 note) so Phase 4 enriches rather than restructures.

---

## Final Verification (before any merge)

- [ ] `pnpm run fix` clean across repo
- [ ] `pnpm run typecheck` green (all packages)
- [ ] `cd packages/agent && pnpm run test` green
- [ ] `cd packages/tools && pnpm run test` green
- [ ] `cd apps/server && pnpm run test` green
- [ ] Manual: `.agents/commands/x.md` appears in `GET /api/commands`; `@`-mentioning a file uses fff; switching to `explore` denies writes; `read` of `.env` denied on `build` agent.
- [ ] No `effect` imports added to `packages/agent`; no `gray-matter` added (uses existing `yaml` frontmatter); `exactOptionalPropertyTypes` satisfied.

---

## Open Follow-ups (out of scope, tracked here)

- Worktree walk-up for config dirs (port opencode `fs-util.ts:151-165` `up()`) — when monorepo support needed.
- Tool-exposure filtering at the LLM request boundary (opencode `session/llm.ts:149`).
- External skill sources `~/.agents/skills`, `~/.claude/skills` (opencode `skill/index.ts:21-23`) — cross-tool compat.
- MCP-prompt-as-command (opencode `command/index.ts:104-131`) — needs an MCP client first.
