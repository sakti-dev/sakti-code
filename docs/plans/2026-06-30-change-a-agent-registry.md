# Change A — Agent Registry Extraction (TDD Plan)

**Status:** Ready to execute after design approval.
**Design:** `docs/plans/2026-06-30-agent-content-extraction-design.md`
**Scope:** Move builtin-agent catalog + prompts from `packages/agent` to `apps/server`. Kill the three `isIntake` branches. Add intake as a first-class agent entry.

**Baseline:** agent 375/375, db 36/36, server 313/315 (2 pre-existing API-key failures), desktop 402/402.

## Goals

1. `packages/agent` no longer exports `BUILTIN_AGENTS`, `DEFAULT_AGENT_NAME`, `resolveBuiltinAgent`, `INTAKE_SYSTEM_PROMPT`, `BUILD_PROMPT`, `EXPLORE_PROMPT`, `PLAN_PROMPT`, `GENERAL_PROMPT`, `DEFAULT_SYSTEM_PROMPT`.
2. New `apps/server/src/agents/` folder owns the catalog (`SERVER_AGENTS`), the prompt strings, the intake entry, and the `resolveAgentByName` helper.
3. New `defineAgent(builder)` helper in `packages/agent` for constructing validated `AgentDefinition` objects (consumers use it to build their catalogs).
4. `apps/server/src/agent/runner.ts` no longer has `isIntake` branches. Intake resolves through the normal `switchAgentEffect` path.
5. Intake has its own permission ruleset (read-mostly + propose_session) and tool allowlist.
6. All baseline tests still pass; one test count change in server (+1 new test asserting intake permissions differ from build).

## Non-goals

- Touching compaction/branch/skills prompts — that's Change B.
- Renaming `BUILTIN_AGENTS` to `SERVER_AGENTS` everywhere (cosmetic, do it as part of the move).
- Adding project-level `.sakti/agents/*.md` parsing changes (loadAgents stays as-is).
- Removing the `propose_session` tool factory from `@sakti-code/tools` (still lives there; the intake agent's `activeToolNames` enables it).

## Conventions

- TDD per-phase: RED → GREEN → commit. Each phase leaves workspace green (typecheck + lint + tests).
- `exactOptionalPropertyTypes: true` — use conditional spread `...(x === undefined ? {} : { x })`.
- Effect v4 (no `Effect.catchAll` — use `Effect.exit` + `Exit.isFailure` + `Cause.squash` if needed).
- `pnpm run fix` before each commit. `pnpm run typecheck` after each phase.
- Commit on `main` directly (per project convention — no worktrees, no subagents).

## Phase A1 — `defineAgent` builder in `packages/agent`

**Why first:** decouples catalog construction from where the catalog lives. Builder is the contract the server will use.

### A1.1 RED — failing test

New file `packages/agent/src/agents/__tests__/define-agent.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defineAgent } from "../define-agent.ts";
import { fromConfig } from "../permission.ts";

describe("defineAgent", () => {
  it("returns the agent definition as-is when valid", () => {
    const ruleset = fromConfig({ "*": "allow" });
    const agent = defineAgent({
      name: "test",
      mode: "primary",
      description: "test",
      systemPrompt: "p",
      permission: ruleset,
    });
    expect(agent.name).toBe("test");
    expect(agent.permission).toBe(ruleset);
  });

  it("applies defaults for optional fields", () => {
    const agent = defineAgent({
      name: "test",
      mode: "primary",
      description: "test",
      systemPrompt: "p",
    });
    expect(agent.activeToolNames).toBeUndefined();
    expect(agent.permission).toBeUndefined();
  });

  it("throws on missing name", () => {
    expect(() =>
      defineAgent({
        name: "",
        mode: "primary",
        description: "x",
        systemPrompt: "x",
      })
    ).toThrow(/name/);
  });

  it("throws on missing systemPrompt", () => {
    expect(() =>
      defineAgent({
        name: "x",
        mode: "primary",
        description: "x",
        systemPrompt: "",
      })
    ).toThrow(/systemPrompt/);
  });
});
```

Verify RED: `cd packages/agent && pnpm run test -- define-agent` → fails (file doesn't exist).

### A1.2 GREEN — implement

New file `packages/agent/src/agents/define-agent.ts`:

```ts
import type { AgentDefinition } from "../harness-types.ts";

/**
 * Construct a validated AgentDefinition. Throws on missing required fields
 * (name, systemPrompt). Optional fields (permission, activeToolNames,
 * thinkingLevel) are left undefined if not supplied — callers consuming the
 * agent must handle undefined per AgentDefinition's contract.
 *
 * Used by consumers (server, future CLI) to build their agent catalogs with
 * a consistent shape and clear failure when an entry is malformed.
 */
export function defineAgent(agent: AgentDefinition): AgentDefinition {
  if (!agent.name) {
    throw new Error("defineAgent: name is required");
  }
  if (!agent.systemPrompt) {
    throw new Error("defineAgent: systemPrompt is required");
  }
  return agent;
}
```

Export from `packages/agent/src/index.ts`:

```ts
export { defineAgent } from "./agents/define-agent.ts";
```

Verify GREEN.

### A1.3 Commit

```
feat(agent): add defineAgent builder for consumer-defined agent catalogs
```

## Phase A2 — Move catalog + prompts to `apps/server/src/agents/`

**Why:** Create the server-side home before deleting from the agent package, so imports can be flipped without a broken intermediate state.

### A2.1 New folder layout

```
apps/server/src/agents/
├── __tests__/
│   └── server-agents.test.ts          (moved from packages/agent/src/agents/__tests__/builtin-agents.test.ts)
├── server-agents.ts                   (moved from packages/agent/src/agents/builtin-agents.ts)
├── prompts.ts                         (moved from packages/agent/src/prompts/agents.ts)
├── intake-prompt.ts                   (moved from packages/agent/src/prompts/intake-system-prompt.ts)
└── resolve-agent.ts                   (new — moved from apps/server/src/agent/runner.ts:resolveAgentByName)
```

### A2.2 Move `BUILTIN_AGENTS` → `SERVER_AGENTS`

`apps/server/src/agents/prompts.ts` — verbatim copy of `packages/agent/src/prompts/agents.ts` (BUILD_PROMPT, EXPLORE_PROMPT, PLAN_PROMPT, GENERAL_PROMPT, DEFAULT_SYSTEM_PROMPT).

`apps/server/src/agents/intake-prompt.ts` — verbatim copy of `packages/agent/src/prompts/intake-system-prompt.ts`.

**Tool declarations move into each agent entry (replaces the global `buildTools()` + `activeToolNames` filter pattern).**

New file `apps/server/src/agents/tool-registry.ts`:

```ts
import type { AgentTool } from "@sakti-code/agent";
import {
  createBashTool, createEditTool, createFindTool, createGrepTool,
  createLsTool, createProposeSessionTool, createReadTool, createWriteTool,
  type EditMode, InMemorySnapshotStore, type NoopLoopGuardOwner,
} from "@sakti-code/tools";

export interface ToolContext {
  readonly cwd: string;
  readonly editMode: EditMode;
  readonly snapshotStore: InMemorySnapshotStore;
  readonly noopOwner: NoopLoopGuardOwner;
}

export type ToolFactory = (ctx: ToolContext) => AgentTool;

export const TOOL_FACTORIES: Readonly<Record<string, ToolFactory>> = {
  read:            (ctx) => createReadTool(ctx.cwd, { autoResizeImages: true, snapshotStore: ctx.snapshotStore }),
  write:           (ctx) => createWriteTool(ctx.cwd, { snapshotStore: ctx.snapshotStore }),
  edit:            (ctx) => createEditTool(ctx.cwd, { mode: ctx.editMode, snapshotStore: ctx.snapshotStore, noopOwner: ctx.noopOwner }),
  bash:            (ctx) => createBashTool(ctx.cwd),
  grep:            (ctx) => createGrepTool(ctx.cwd),
  find:            (ctx) => createFindTool(ctx.cwd),
  ls:              (ctx) => createLsTool(ctx.cwd),
  propose_session: () => createProposeSessionTool() as AgentTool,
};

export function buildAgentTools(
  toolNames: readonly string[],
  ctx: ToolContext
): AgentTool[] {
  return toolNames.map((name) => {
    const factory = TOOL_FACTORIES[name];
    if (!factory) {
      throw new Error(
        `Unknown tool "${name}" — not in server registry. Registered: ${Object.keys(TOOL_FACTORIES).join(", ")}`
      );
    }
    return factory(ctx);
  });
}

/** Rebuild a single tool by name (used by the edit-mode swap path). */
export function rebuildTool(name: string, ctx: ToolContext): AgentTool {
  const factory = TOOL_FACTORIES[name];
  if (!factory) {
    throw new Error(`Unknown tool "${name}"`);
  }
  return factory(ctx);
}
```

`apps/server/src/agents/server-agents.ts` — copy of `builtin-agents.ts` with these changes:
- Rename export `BUILTIN_AGENTS` → `SERVER_AGENTS`.
- Rename `resolveBuiltinAgent` → `resolveServerAgent`.
- Update import paths to local (`./prompts.ts`).
- **Each agent declares `toolNames: string[]` explicitly** (replaces the global `buildTools()` + `activeToolNames` filter pattern — each agent is fully self-contained):
- **Add intake entry:**

```ts
export const SERVER_AGENTS: AgentDefinition[] = [
  defineAgent({
    name: "build",
    mode: "primary",
    description: "The default coding agent.",
    systemPrompt: BUILD_PROMPT,
    permission: buildRuleset(),
    toolNames: ["read", "write", "edit", "bash", "grep", "find", "ls"],
  }),
  defineAgent({
    name: "explore",
    mode: "subagent",
    description: "Read-only codebase exploration.",
    systemPrompt: EXPLORE_PROMPT,
    permission: exploreRuleset(),
    toolNames: ["read", "grep", "find", "ls", "bash"],
  }),
  defineAgent({
    name: "plan",
    mode: "primary",
    description: "Planning agent — no edits.",
    systemPrompt: PLAN_PROMPT,
    permission: planRuleset(),
    toolNames: ["read", "grep", "find", "ls", "bash"],
  }),
  defineAgent({
    name: "general",
    mode: "subagent",
    description: "General-purpose subagent.",
    systemPrompt: GENERAL_PROMPT,
    permission: allowAllRuleset(),
    toolNames: ["read", "write", "edit", "bash", "grep", "find", "ls"],
  }),
  defineAgent({
    name: "intake",
    mode: "primary",
    description: "PM-style planning agent for scoping work before implementation.",
    systemPrompt: INTAKE_SYSTEM_PROMPT,
    permission: intakeRuleset(),
    toolNames: ["read", "write", "edit", "bash", "grep", "find", "ls", "propose_session"],
  }),
];
```

- Add `intakeRuleset()`:

```ts
/** Intake: allow research + doc-writing; ask before destructive bash. */
function intakeRuleset(): PermissionRuleset {
  return fromConfig({
    "*": "allow",
    bash: { "rm *": "ask", "git push*": "ask", "git reset --hard*": "ask" },
  });
}
```

**Note:** The intake ruleset is intentionally minimal in v1. The key contract is that it is **not** `buildRuleset()` — intake gets its own ruleset so we can tighten it later without touching build. If you want stricter (deny edits), update intakeRuleset; the resolution path is unaffected.

**Why `toolNames` instead of `activeToolNames` filter:** `activeToolNames` is a filter applied AFTER all tools are built — it's the pattern that produced the original `isIntake` mess (filter-via-allowlist instead of declare-per-agent). `toolNames` flips the relationship: each agent declares what it uses, the server builds exactly that via `buildAgentTools`. No global `buildTools()` returning a fixed list, no post-hoc filtering, no "always register propose_session then filter it out for non-intake agents." Each agent is fully self-contained.

### A2.3 Move `resolveAgentByName`

`apps/server/src/agents/resolve-agent.ts`:

```ts
import type { AgentDefinition } from "@sakti-code/agent";
import { SERVER_AGENTS } from "./server-agents.ts";

/**
 * Resolve an agent by name from the server catalog plus project-loaded agents.
 * A user-defined agent with the same name overrides the server builtin.
 * Falls back to the default (`build`) agent when the name is unknown.
 */
export function resolveAgentByName(
  name: string,
  loadedAgents: AgentDefinition[]
): AgentDefinition {
  const byName = new Map<string, AgentDefinition>();
  for (const agent of SERVER_AGENTS) {
    byName.set(agent.name, agent);
  }
  for (const agent of loadedAgents) {
    byName.set(agent.name, agent);
  }
  const resolved = byName.get(name) ?? byName.get("build");
  if (resolved) {
    return resolved;
  }
  throw new Error(`No agent resolved for "${name}"`);
}
```

The `DEFAULT_AGENT_NAME = "build"` constant lives in `apps/server/src/agents/server-agents.ts` and gets re-exported. Replace the magic string `"build"` with the constant.

### A2.4 Update `apps/server/src/agent/runner.ts`

- Replace import:
  - OLD: `BUILTIN_AGENTS`, `INTAKE_SYSTEM_PROMPT`, `DEFAULT_AGENT_NAME` from `@sakti-code/agent`
  - NEW: import from `../agents/server-agents.ts`, `../agents/intake-prompt.ts`, `../agents/resolve-agent.ts`.
- Replace `resolveAgentByName` definition (lines 346-363) with import from `../agents/resolve-agent.ts`.
- Replace `resolveSessionAgent` (lines 366-372) to call the new local resolver.

### A2.5 Move tests

- `packages/agent/src/agents/__tests__/builtin-agents.test.ts` → `apps/server/src/agents/__tests__/server-agents.test.ts`.
- Update imports + rename `BUILTIN_AGENTS` → `SERVER_AGENTS`.
- **Add a new test asserting intake is in the catalog:**

```ts
it("includes intake as a first-class agent with its own permission ruleset", () => {
  const intake = SERVER_AGENTS.find((a) => a.name === "intake");
  expect(intake).toBeDefined();
  expect(intake!.permission).toBeDefined();
  expect(intake!.activeToolNames).toContain("propose_session");

  const build = SERVER_AGENTS.find((a) => a.name === "build")!;
  // Intake has a distinct ruleset from build (not inheriting).
  expect(intake!.permission).not.toBe(build.permission);
});
```

### A2.6 Verify

- `pnpm run typecheck` — green.
- `cd apps/server && pnpm run test` — server tests pass (313 + 1 new = 314/316; the 2 API-key failures unchanged).
- `cd packages/agent && pnpm run test` — agent tests: `builtin-agents.test.ts` no longer runs here (moved); -3 tests → 372/372.

### A2.7 Commit

```
refactor(server): move builtin-agent catalog + prompts to apps/server (Phase A2)

BUILTIN_AGENTS → SERVER_AGENTS lives in apps/server/src/agents/. The
intake prompt moves alongside (out of packages/agent). resolveAgentByName
moves to the server. No behavior change yet — intake still goes through
the isIntake branches in runner.ts; the intake entry is defined but not
yet used by the runner.
```

## Phase A3 — Kill the `isIntake` branches

**Why now:** the catalog exists server-side with intake as an entry. Wire the runner to use it.

### A3.1 RED — failing test for intake permissions

New test in `apps/server/src/agent/__tests__/runner.test.ts`:

```ts
describe("intake agent resolution", () => {
  it("resolves intake sessions to the intake agent (not build)", () => {
    const { agent } = resolveSessionAgentForKind("intake", []);
    expect(agent.name).toBe("intake");
    expect(agent.activeToolNames).toContain("propose_session");
  });

  it("resolves task sessions to the build agent", () => {
    const { agent } = resolveSessionAgentForKind("task", []);
    expect(agent.name).toBe("build");
  });
});
```

(`resolveSessionAgentForKind` is a new helper extracted from runner — see A3.2.)

Verify RED: helper doesn't exist → fails.

### A3.2 GREEN — extract helper, rewrite runner body

New helper in `apps/server/src/agents/resolve-agent.ts`:

```ts
/**
 * Resolve the agent for a session based on its kind + per-session override.
 * Per-session override wins; otherwise `intake` kind → intake agent,
 * other kinds → build agent (the default).
 */
export function resolveSessionAgentForKind(
  kind: string,
  loadedAgents: AgentDefinition[],
  perSessionOverride?: string
): { agent: AgentDefinition } {
  const name = perSessionOverride ?? defaultAgentNameForKind(kind);
  return { agent: resolveAgentByName(name, loadedAgents) };
}

function defaultAgentNameForKind(kind: string): string {
  return kind === "intake" ? "intake" : DEFAULT_AGENT_NAME;
}
```

### A3.3 Rewrite runner.ts (lines 482-599)

**Delete:**
- Line 482: `const isIntake = session.kind === "intake";`
- Lines 486-488: the `if (isIntake) tools.push(createProposeSessionTool())` block.
- Lines 529-538: the `...(isIntake ? { systemPrompt: … } : {})` block.
- Lines 554-599: the entire `if (!isIntake) { …switchAgentEffect… }` block — including the inline `composeSystemPrompt` call and `resolveAgentByName(settings.agent())`.
- The current `buildTools(project.cwd, editMode)` call and the post-resolution `activeToolNames` filtering.

**Replace with:**

```ts
// Resolve the agent FIRST so we can build its declared tools.
const settings = parseSessionSettings(loadSessionSettings(ctx, sessionId));
const { agent } = resolveSessionAgentForKind(
  session.kind,
  loadedContext.agents,
  settings.agent() === DEFAULT_AGENT_NAME ? undefined : settings.agent()
);

// Build only the agent's declared tools — no global buildTools() + filter.
const editMode = resolveEditMode(ctx, sessionId);
const snapshotStore = new InMemorySnapshotStore();
const noopOwner: NoopLoopGuardOwner = {};
const toolCtx: ToolContext = { cwd: project.cwd, editMode, snapshotStore, noopOwner };
const tools = buildAgentTools(agent.toolNames ?? DEFAULT_TOOL_NAMES, toolCtx);

const harness = new HarnessClass({
  env,
  model,
  session: sessionShape,
  ...(ctx.log === undefined ? {} : { logger: ctx.log.agent, streamLogger: ctx.log.llm }),
  tools,
  followUpMode: settings.followUpMode(),
  steeringMode: settings.steeringMode(),
  thinkingLevel,
  getApiKeyAndHeaders,
  resources: {
    skills: activeSkills,
    promptTemplates: loadedContext.commands,
  },
});
ctx.log?.agent.debug("harness created", { sessionId });

// Wire permission + apply agent (system prompt + thinking level) via the
// normal switchAgentEffect path. No special cases.
const agentRuleset = agent.permission ?? fromConfig({ "*": "allow" });
const permissionChannel = getPermissionChannel(sessionId);
permissionChannel.setSink(permissionAskedSink);
harness.setPermissionEvaluator((permission, pattern) =>
  permissionChannel.evaluate(permission, pattern, agentRuleset)
);
harness.setPermissionAskResolver((req) => permissionChannel.ask(req));

// Compose system prompt with tool inventory + skills. The tool list passed
// here matches what's already on the harness (agent.toolNames).
const hasRead = agent.toolNames?.includes("read") ?? true;
const composedSystemPrompt = composeSystemPrompt(
  agent.systemPrompt,
  tools,
  activeSkills,
  hasRead
);
yield* harness.switchAgentEffect(
  composedSystemPrompt === agent.systemPrompt
    ? agent
    : { ...agent, systemPrompt: composedSystemPrompt }
);
ctx.log?.agent.debug("agent resolved", { sessionId, agent: agent.name });
```

**Behavior changes:**
1. Intake now resolves to the `intake` agent — gets its own `intakeRuleset()` and its declared `toolNames` (including `propose_session`).
2. `explore` and `plan` agents now actually only see their declared tools (today their `activeToolNames` is undefined, so they get everything but rely on the ruleset to deny edits — defense in depth was missing).
3. `propose_session` is built only when an agent declares it in `toolNames` (just intake). No more "always registered, filtered later."
4. `thinkingLevel` still flows through `switchAgentEffect`'s `setThinkingLevelEffect`.

**Per-session override subtlety:** `settings.agent()` defaults to `"build"`. If a user has explicitly selected `"explore"` for a session, we honor it. The check `settings.agent() === DEFAULT_AGENT_NAME ? undefined : settings.agent()` is how we detect "no override" (since the default IS `"build"`, returning `"build"` literally means "no override"). For intake sessions, this means: no per-session override → intake agent; per-session override to anything else → that agent. Reasonable.

### A3.4 Update existing runner tests + edit-mode swap path

Audit `apps/server/src/agent/__tests__/runner.test.ts` for any test that:
- Asserts intake sessions use `INTAKE_SYSTEM_PROMPT` directly — should now go through `resolveSessionAgentForKind`.
- Asserts intake tools include `propose_session` via the old "appended" path — should now assert it via `agent.toolNames`.
- Mocks `BUILTIN_AGENTS` from `@sakti-code/agent` — should now mock `SERVER_AGENTS` from `../agents/server-agents.ts`.

**Edit-mode swap path (currently line 432):** `buildTools(cwd, mode)` → swap edit tool. Replace with `rebuildTool("edit", { cwd, editMode: mode, snapshotStore: <existing>, noopOwner: <existing> })`. The snapshot store must be preserved across the swap (the harness's in-flight edit tracking depends on it) — either expose it from the harness or capture it in the closure when the harness is first built.

### A3.5 Verify

- `pnpm run typecheck` — green.
- `cd apps/server && pnpm run test` — server tests pass (314 + new intake resolution tests).
- `cd packages/agent && pnpm run test` — agent tests still 372/372.
- `cd apps/desktop && pnpm run test` — desktop tests still 402/402.

### A3.6 Commit

```
refactor(server): kill isIntake branches — intake is a first-class agent (Phase A3)

Three isIntake special cases in runner.ts collapse into the normal
switchAgentEffect path. Intake now resolves to the intake agent entry
(own permission ruleset, own tool allowlist including propose_session).
Behavior changes:

1. Intake gets intakeRuleset() instead of inheriting build's. Tightened
   destructive bash operations; edits still allowed (intake writes docs).
2. Intake's activeToolNames filters tools to the 8 declared tools.
3. propose_session is always registered but only enabled via intake's
   activeToolNames. Non-intake agents never see it.
```

## Phase A4 — Delete from `packages/agent`

**Why last:** Once the server no longer imports these symbols, delete the originals.

### A4.1 Delete files

- `packages/agent/src/agents/builtin-agents.ts`
- `packages/agent/src/prompts/agents.ts`
- `packages/agent/src/prompts/intake-system-prompt.ts`
- `packages/agent/src/agents/__tests__/builtin-agents.test.ts` (already moved in A2.5)
- `apps/server/src/agent/tools-builder.ts` (replaced by `apps/server/src/agents/tool-registry.ts`'s `buildAgentTools` + `rebuildTool`)

### A4.2 Update `packages/agent/src/index.ts`

Remove exports:
- `BUILTIN_AGENTS`, `DEFAULT_AGENT_NAME`, `resolveBuiltinAgent` (lines 3-7)
- `INTAKE_SYSTEM_PROMPT` (line 126)

### A4.3 Audit for stragglers

`rg -n "BUILTIN_AGENTS|INTAKE_SYSTEM_PROMPT|BUILD_PROMPT|EXPLORE_PROMPT|PLAN_PROMPT|GENERAL_PROMPT|resolveBuiltinAgent" packages apps` should return zero hits (excluding `dist/`).

### A4.4 Verify

- `pnpm run typecheck` — green across all packages.
- `pnpm run fix` — clean.
- Full test run: agent (372 minus deleted builtin tests), db 36/36, server (314+), desktop 402/402.

### A4.5 Commit

```
refactor(agent): drop builtin-agent catalog and prompt strings (Phase A4)

The agent package ships zero content. BUILTIN_AGENTS, DEFAULT_AGENT_NAME,
resolveBuiltinAgent, INTAKE_SYSTEM_PROMPT, and the agent identity prompts
(BUILD/EXPLORE/PLAN/GENERAL/DEFAULT) are gone. Consumers (apps/server)
own their catalogs and use defineAgent() to construct entries.

Agent package test count drops by 3 (builtin-agents.test.ts moved to
server in Phase A2).
```

## Phase A5 — Final verification

- `pnpm run typecheck` — all packages green.
- `pnpm run fix` — clean.
- Full test sweep:
  - agent: ~372/372 (was 375; -3 from moved builtin-agents test)
  - db: 36/36
  - server: ~315/317 (+2 from intake resolution tests; 2 pre-existing API-key failures unchanged)
  - desktop: 402/402
- No `rg` hits for `isIntake` in `apps/server/src`.
- No `rg` hits for `BUILTIN_AGENTS` or `INTAKE_SYSTEM_PROMPT` outside `apps/server/src/agents/`.

## Risk register

| Risk | Mitigation |
|---|---|
| Project-loaded `.sakti/agents/intake.md` could now collide with builtin intake. | Documented behavior: project override wins (same as before for build/explore/plan). |
| Per-session override interacting with kind-based default is subtle. | Documented in `resolveSessionAgentForKind` JSDoc. Test covers "intake kind + per-session explore override → explore agent". |
| `propose_session` tool now always registered — wasted memory? | Negligible (one tool object per run). Worth the simplification. |
| `intakeRuleset` too permissive — same as build? | v1 is intentionally close to build (intake writes docs). Tighten later via separate change; the resolution path is decoupled. |
| Desktop UI has intake-specific rendering — does it still trigger? | Yes — UI keys off `session.kind === "intake"` (DB field), unchanged. Runner no longer has intake-specific branches but the session kind is still set/persisted as before. |

## Manual smoke test (post-merge)

1. Start desktop app, open a project with no API key configured for the intake model — should see the existing error message.
2. Configure API key, send intake prompt — should call intake agent (verify via dev toolbar logs showing `agent: intake`).
3. Have intake call `propose_session` — should still surface the proposal card.
4. Switch to a task session — should call build agent (verify logs).
5. Mid-intake, disable a skill — should work via the existing removeSkill path (unchanged).
