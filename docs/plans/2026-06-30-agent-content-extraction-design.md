# Agent Content Extraction — Design

**Status:** Approved (Pattern X chosen 2026-06-30)
**Scope:** Two sequential changes (A then B) covered by separate TDD plans.

- Plan A: `docs/plans/2026-06-30-change-a-agent-registry.md`
- Plan B: `docs/plans/2026-06-30-change-b-algorithm-prompts.md`

## Problem

The `@sakti-code/agent` package currently ships two kinds of **content** alongside its algorithms:

1. **Agent identity** — `BUILTIN_AGENTS` array (`build`/`explore`/`plan`/`general`) plus their system prompts in `packages/agent/src/prompts/agents.ts`. Plus the orphan `INTAKE_SYSTEM_PROMPT` (used only by the server).
2. **Algorithm prompts** — `SUMMARIZATION_PROMPT` / `UPDATE_SUMMARIZATION_PROMPT` / `TURN_PREFIX_SUMMARIZATION_PROMPT` / `SUMMARIZATION_SYSTEM_PROMPT` in `prompts/compaction.ts`; `BRANCH_SUMMARY_PREAMBLE` / `BRANCH_SUMMARY_PROMPT` in `prompts/branch-summary.ts`; `SKILLS_INSTRUCTIONS` in `prompts/skills-instructions.ts`.

This causes two concrete problems:

### Problem 1: intake is a side-channel, not an agent

`INTAKE_SYSTEM_PROMPT` is **not** an entry in `BUILTIN_AGENTS`. There is no `intake` agent definition with its own permission ruleset and tool allowlist. The server makes intake work via **three `isIntake` branches** in `apps/server/src/agent/runner.ts:482-599`:

| Line    | Branch                                                                                | What it does                         |
| ------- | ------------------------------------------------------------------------------------- | ------------------------------------ |
| 486-488 | `if (isIntake) tools.push(createProposeSessionTool())`                                | Side-inject the propose_session tool |
| 529-538 | `...(isIntake ? { systemPrompt: composeSystemPrompt(INTAKE_SYSTEM_PROMPT, …) } : {})` | Hand-compose prompt at construction  |
| 572-599 | `if (!isIntake) { …switchAgentEffect… }`                                              | Skip agent switch entirely           |

Concrete consequences:

- Intake inherits `build`'s permission ruleset (`agentRuleset` at line 560 comes from `resolveAgentByName("build")`), so edits/destructive bash are allowed — contradicts the prompt's "do NOT implement features."
- Intake's `thinkingLevel` is never set via `switchAgentEffect`'s `setThinkingLevelEffect`.
- `propose_session` is appended unconditionally rather than enabled via an agent's `activeToolNames` allowlist.
- `resolveAgentByName` + `agentRuleset` runs for intake but the resolved agent is only half-used (ruleset yes, prompt/tools no). Confusing + wasteful.

### Problem 2: the agent package has product opinions

The `## Goal / ## Constraints & Preferences / ## Progress / ## Key Decisions` summary structure is sakti's house style. A different consumer (CLI, test harness, different product) might reasonably want:

- A terse one-paragraph summary (CLI)
- A different section structure (different product)
- A different skills-advertisement wording

The agent package shouldn't have house-style opinions. Currently:

- `compactEffect` / `generateSummaryEffect` hardcode the sakti-style template.
- `generateBranchSummaryEffect` hardcodes `BRANCH_SUMMARY_PROMPT` + `SUMMARIZATION_SYSTEM_PROMPT`.
- `composeSystemPrompt` / `formatSkillsForSystemPrompt` / `stripSkillsBlock` hardcode `SKILLS_INSTRUCTIONS` (and worse, `stripSkillsBlock` uses `SKILLS_INSTRUCTIONS[0]` as a sentinel for re-parsing — meaning the instructions text is part of an algorithmic contract, not just configuration).

`customInstructions` parameters exist in `compact` and `generateBranchSummary` but only let callers **append** focus text, not **replace** the base template.

## Principle

> **The agent package ships zero content.** Types, algorithms, helpers, factories. No prompt strings, no builtin agent registry, no opinionated defaults. The consumer (server, future CLI, future test harness) owns all content.

This is symmetric with the agent-loop-factory refactor (Phases I1-I5): the package owns orchestration shape; the consumer owns I/O and content. Now the same split is applied to prompts + agent catalog.

## Pattern X (chosen over Pattern Y)

When an algorithm needs a prompt, the prompt is a **required parameter** — no fallback default. New consumers must provide prompts explicitly; they can reference `apps/server/src/` as the baseline example.

**Rejected alternative (Pattern Y):** ship minimal placeholder defaults. Ideologically weaker — keeps the package opinionated about what "the boring version" looks like, and creates a confusing two-tier system where consumers must figure out which prompts they're overriding vs inheriting.

## Two-change split

Doing all five moves (agent registry, intake, compaction prompts, branch prompts, skills instructions) in one plan balloons the diff. The actual bug (intake confusion) is fixable in Change A. Change B is pure parameterization with no behavior change.

| #   | Move                                                                                  | Plan | Behavior change?                                  |
| --- | ------------------------------------------------------------------------------------- | ---- | ------------------------------------------------- |
| 1   | `BUILTIN_AGENTS` + `prompts/agents.ts` → server                                       | A    | No (resolution path identical)                    |
| 2   | `INTAKE_SYSTEM_PROMPT` → server; add `intake` agent entry; kill `isIntake` branches   | A    | **Yes — intake becomes a real agent**             |
| 3   | Compaction prompts → server; add `prompts` param to `compact`/`generateSummaryEffect` | B    | No (server passes same strings)                   |
| 4   | Branch summarizer prompts → server; add to `generateBranchSummaryEffect` options      | B    | No                                                |
| 5   | `SKILLS_INSTRUCTIONS` → server; add to `composeSystemPrompt` signature                | B    | Subtle — see "Skills instructions sentinel" below |

## What stays in `packages/agent`

After both changes:

- **Algorithms:** `compactEffect`, `generateSummaryEffect`, `generateBranchSummaryEffect`, `prepareCompaction`, `checkCompaction`, `runAutoCompactionEffect`, retry loop, agent loop.
- **Helpers:** `composeSystemPrompt` (with skills-instructions param), `defineAgent` (new — validates shape), `formatSkillsAddedNotice`, `stripSkillsBlock` (with marker param), `serializeConversation`.
- **Types:** `AgentDefinition`, `AgentHarnessOptions`, `PermissionRuleset`, `CompactionPrompts` (new), `BranchSummaryPrompts` (new), `SkillsInstructions` (new), etc.
- **Factories:** `runAgentRunEffect`, `AgentHarness`, `parseSessionSettings`, `parseRetrySettings`, `parseCompactionSettings`.
- **Loaders:** `loadAgents` (loads `.sakti/agents/*.md` from disk — pure I/O, returns `AgentDefinition[]` with empty prompts if the file doesn't override them).
- **Permission:** `fromConfig`, `evaluate`, `merge`, `match` — pure logic.

**Not shipped:** `BUILTIN_AGENTS`, `DEFAULT_AGENT_NAME` (becomes server-side), `INTAKE_SYSTEM_PROMPT`, `BUILD_PROMPT`/`EXPLORE_PROMPT`/`PLAN_PROMPT`/`GENERAL_PROMPT`/`DEFAULT_SYSTEM_PROMPT`, all four compaction prompt strings, both branch-summary prompt strings, `SKILLS_INSTRUCTIONS`.

## Open questions resolved

**Q: Where do project-loaded agents (`.sakti/agents/*.md`) merge with the catalog?**
A: At the consumer level. The server has `[...SERVER_AGENTS, ...loadedFromProject]`. `loadAgents` stays in the agent package as a pure disk-loader.

**Q: Does `loadAgents` still work if the agent package has no `BUILTIN_AGENTS` to seed validation against?**
A: Yes. `loadAgents` doesn't validate against builtins — it parses markdown files and returns whatever it finds. The server merges with its own catalog. The agent package's `defineAgent` builder validates the AgentDefinition shape, not agent-name uniqueness against a fixed list.

**Q: What about the `DEFAULT_AGENT_NAME = "build"` constant?**
A: Moves to server. `SessionSettings.agent()` already delegates the default to `DEFAULT_AGENT_NAME` — that constant moves to `apps/server/src/agents/defaults.ts` and gets re-exported through `parseSessionSettings` opts (small signature change).

**Q: What happens to `packages/agent/src/agents/__tests__/builtin-agents.test.ts`?**
A: Moves to `apps/server/src/agents/__tests__/` alongside the moved `BUILTIN_AGENTS` array. Same tests, different package.

## Skills instructions sentinel (subtle)

`stripSkillsBlock` in `packages/agent/src/resources/system-prompt.ts:62` uses `SKILLS_INSTRUCTIONS[0]` as a marker to find the boundary between base prompt and skills block:

```ts
const marker = `\n\n${SKILLS_INSTRUCTIONS[0]}`;
const index = composedSystemPrompt.lastIndexOf(marker);
```

This means the skills-instructions text is **part of an algorithmic contract** (re-parsing depends on the exact first line), not just configuration. Two options:

- **Option S1 (chosen):** `composeSystemPrompt` takes a `skillsInstructions: readonly string[]` param. `stripSkillsBlock` takes the same param and uses `skillsInstructions[0]` as the marker. The server owns the constant; both functions stay in the agent package as pure helpers parameterized over the marker.
- Option S2 (rejected): `stripSkillsBlock` becomes a server-side helper. Means duplicating the strip-and-recompose logic across consumers whenever a skill is removed mid-session.

S1 keeps the algorithm (strip-and-recompose) in the package, parameterized over the content (the marker text). Same Pattern X logic.

## Dependency graph

```
Change A: agent-registry
  ├── packages/agent: delete BUILTIN_AGENTS, prompts/agents.ts, INTAKE_SYSTEM_PROMPT
  ├── packages/agent: defineAgent() builder (new)
  ├── apps/server: new src/agents/ folder (catalog + prompts + intake entry)
  ├── apps/server: runner.ts loses three isIntake branches
  └── apps/server: resolveAgentByName moves here

Change B: algorithm-prompts (after A is merged)
  ├── packages/agent: compactEffect + generateSummaryEffect take prompts param
  ├── packages/agent: generateBranchSummaryEffect options include prompts
  ├── packages/agent: composeSystemPrompt + stripSkillsBlock take skillsInstructions
  ├── packages/agent: delete prompts/compaction.ts, branch-summary.ts, skills-instructions.ts
  └── apps/server: new src/compaction/prompts.ts + src/resources/skills-instructions.ts
```

## Verification strategy

Both changes preserve observable behavior (modulo the intake permission fix in Change A):

- **Change A baseline:** agent 375/375, db 36/36, server 313/315 (2 pre-existing API-key failures), desktop 402/402.
- **Change A behavior change:** intake sessions should now resolve to a real `intake` agent entry. Any test asserting intake's permission ruleset inherits from `build` needs to be updated (there are none currently — confirming the bug).
- **Change B baseline:** identical to Change A's end-state. Pure parameterization; no test count change expected.

## Out of scope (future work)

- Replace `PromiseSession` with direct Effect-native SessionShape builder (orthogonal, noted in prior plan).
- Move settings-key-prefix storage helpers to `packages/db` as a typed `SessionSettingsRepo`.
- Project-level agent overrides via `.sakti/agents/*.md` currently merge into the server catalog; if a future consumer wants different merge semantics, that's the consumer's call.
- Promote `runAgentRunEffect` from Approach 1 (thin factory) to Approach 3 (fat factory owning harness construction) if a real second consumer lands.
