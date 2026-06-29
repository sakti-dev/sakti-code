# Change B — Algorithm Prompts Extraction (TDD Plan)

**Status:** Ready to execute **after** Change A merges.
**Design:** `docs/plans/2026-06-30-agent-content-extraction-design.md`
**Scope:** Move all algorithm-internal prompt strings (compaction, branch summary, skills instructions) out of `packages/agent`. The algorithms stay; the content leaves. Pattern X throughout — required params, no defaults.

**Baseline (post-Change-A):** agent ~372/372, db 36/36, server ~315/317, desktop 402/402.

## Goals

1. `packages/agent` no longer ships `SUMMARIZATION_PROMPT`, `UPDATE_SUMMARIZATION_PROMPT`, `SUMMARIZATION_SYSTEM_PROMPT`, `TURN_PREFIX_SUMMARIZATION_PROMPT`, `BRANCH_SUMMARY_PREAMBLE`, `BRANCH_SUMMARY_PROMPT`, `SKILLS_INSTRUCTIONS`.
2. New required-parameter contracts:
   - `compactEffect(preparation, model, apiKey, opts: { headers?, customInstructions?, signal?, thinkingLevel?, prompts: CompactionPrompts })`
   - `generateSummaryEffect(messages, model, reserveTokens, apiKey, opts: { headers?, signal?, customInstructions?, previousSummary?, thinkingLevel?, prompts: CompactionPrompts })`
   - `generateBranchSummaryEffect(entries, opts: GenerateBranchSummaryOptions & { prompts: BranchSummaryPrompts })`
   - `composeSystemPrompt(base, tools, skills, hasRead, skillsInstructions: readonly string[])`
   - `formatSkillsForSystemPrompt(skills, skillsInstructions)`
   - `appendSkillsBlock(base, skills, hasRead, skillsInstructions)`
   - `stripSkillsBlock(composed, skillsInstructions)`
3. Server owns the prompt strings in `apps/server/src/compaction/prompts.ts` and `apps/server/src/agents/skills-instructions.ts` (or similar).
4. Zero behavior change — server passes the same strings the package used to embed.

## Non-goals

- Renaming `compactEffect`/`generateSummaryEffect`/etc.
- Changing the compaction algorithm (token math, message selection, merge strategy).
- Adding new prompt variants (e.g. terse-vs-verbose toggle).
- Removing the `customInstructions` parameter (it still exists as an *additional* focus on top of the prompts).

## Conventions

Same as Change A:
- TDD per-phase: RED → GREEN → commit.
- `exactOptionalPropertyTypes: true` — conditional spread for optional fields.
- Effect v4.
- `pnpm run fix` + `pnpm run typecheck` per phase.
- Commit on `main`.

## Phase B1 — Define prompt-bundle types

**Why first:** types give every later phase a stable target.

### B1.1 RED — failing type test

New file `packages/agent/src/compaction/__tests__/prompt-bundles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type {
  BranchSummaryPrompts,
  CompactionPrompts,
  SkillsInstructions,
} from "../prompt-bundles.ts";

describe("prompt bundle types", () => {
  it("CompactionPrompts has all four fields", () => {
    const p: CompactionPrompts = {
      summarizationSystem: "sys",
      summarization: "sum",
      update: "upd",
      turnPrefix: "tp",
    };
    expect(p.summarization).toBe("sum");
  });

  it("BranchSummaryPrompts has preamble + prompt", () => {
    const p: BranchSummaryPrompts = {
      preamble: "pre",
      prompt: "p",
    };
    expect(p.prompt).toBe("p");
  });

  it("SkillsInstructions is a readonly string array", () => {
    const s: SkillsInstructions = ["a", "b"] as const;
    expect(s.length).toBe(2);
  });
});
```

Verify RED.

### B1.2 GREEN — create types

New file `packages/agent/src/compaction/prompt-bundles.ts`:

```ts
/**
 * Required prompt strings for the compaction algorithm.
 * Consumers must provide all four — the algorithm has no defaults.
 *
 * Reference implementation: apps/server/src/compaction/prompts.ts.
 */
export interface CompactionPrompts {
  /** System prompt for the summarization LLM call. */
  readonly summarizationSystem: string;
  /** Initial summarization prompt (no previous summary exists). */
  readonly summarization: string;
  /** Update prompt (previous summary exists, merge new messages). */
  readonly update: string;
  /** Prompt for summarizing the prefix of a split turn. */
  readonly turnPrefix: string;
}

/**
 * Required prompt strings for branch summarization.
 * Consumers must provide both.
 *
 * Reference implementation: apps/server/src/compaction/prompts.ts.
 */
export interface BranchSummaryPrompts {
  /** Preamble prepended to the stored branch summary message. */
  readonly preamble: string;
  /** Base summarization prompt for the branch. */
  readonly prompt: string;
}

/**
 * Required instructions block for advertising skills in the system prompt.
 * The first element is used as a sentinel marker by stripSkillsBlock.
 *
 * Reference implementation: apps/server/src/agents/skills-instructions.ts.
 */
export type SkillsInstructions = readonly string[];
```

Export from `packages/agent/src/index.ts`:

```ts
export type {
  BranchSummaryPrompts,
  CompactionPrompts,
  SkillsInstructions,
} from "./compaction/prompt-bundles.ts";
```

### B1.3 Commit

```
feat(agent): add CompactionPrompts, BranchSummaryPrompts, SkillsInstructions types
```

## Phase B2 — Parameterize compaction functions

### B2.1 RED — failing test

Update `packages/agent/src/compaction/__tests__/compaction.test.ts` (or equivalent):

```ts
it("requires prompts in compactEffect options", () => {
  // Should fail typecheck + runtime without prompts.
  const preparation = makeMinimalPreparation();
  // @ts-expect-error - prompts is required
  const result = compactEffect(preparation, model, "key");
  expect(result).toBeDefined();
});

it("uses provided prompts in the LLM call", () => {
  const preparation = makeMinimalPreparation();
  const prompts: CompactionPrompts = {
    summarizationSystem: "CUSTOM SYS",
    summarization: "CUSTOM SUM",
    update: "CUSTOM UPD",
    turnPrefix: "CUSTOM TP",
  };
  // ... drive compactEffect and capture the LLM call args ...
  // Assert the system prompt was "CUSTOM SYS" and the user prompt contained "CUSTOM SUM".
});
```

Verify RED: typecheck fails on the `prompts: CompactionPrompts` requirement.

### B2.2 GREEN — refactor `compactEffect` + `generateSummaryEffect`

**Current signature:**
```ts
export const compactEffect = (
  preparation: CompactionPreparation,
  model: Model,
  apiKey: string,
  headers?: Record<string, string>,
  customInstructions?: string,
  signal?: AbortSignal,
  thinkingLevel?: ThinkingLevel
): Effect.Effect<Result<CompactionResult, CompactionError>>;
```

**New signature (opts-bag form — required because we're adding a required param to a function that already has 4 optional ones):**

```ts
export interface CompactEffectOptions {
  readonly headers?: Record<string, string>;
  readonly customInstructions?: string;
  readonly signal?: AbortSignal;
  readonly thinkingLevel?: ThinkingLevel;
  readonly prompts: CompactionPrompts;  // required
}

export const compactEffect = (
  preparation: CompactionPreparation,
  model: Model,
  apiKey: string,
  opts: CompactEffectOptions
): Effect.Effect<Result<CompactionResult, CompactionError>>;
```

Apply the same shape to:
- `generateSummaryEffect` → takes `SummarizeOptions` bag including `prompts: CompactionPrompts`.
- `generateTurnPrefixSummaryEffect` (internal) → takes prompts from caller.
- `compact` (Promise wrapper) → forwards opts.

**Inside the body:**
- Replace `UPDATE_SUMMARIZATION_PROMPT` → `opts.prompts.update`.
- Replace `SUMMARIZATION_PROMPT` → `opts.prompts.summarization`.
- Replace `TURN_PREFIX_SUMMARIZATION_PROMPT` → `opts.prompts.turnPrefix`.
- Replace `SUMMARIZATION_SYSTEM_PROMPT` (the `system:` field in the `complete()` call) → `opts.prompts.summarizationSystem`.
- Delete the import of `../prompts/compaction` from `compaction.ts`.

### B2.3 Migrate internal callers

`auto-compaction.ts` calls `compactEffect` (line 282). Update to pass `prompts` from its own deps. `runAutoCompactionEffect`/`runAutoCompaction` likely need a `prompts: CompactionPrompts` parameter added to their signatures too (forwarded from the outermost caller).

`runAgentRunEffect` (Phase I3 factory) calls `runAutoCompactionEffect` via `RetryRunnerDepsEffect.runCompaction`. Add `prompts` to `AgentRunDeps`. Server provides.

### B2.4 Migrate server callers

`apps/server/src/routes/sessions/compaction.ts:57` calls `compact(preparation, auth.model, auth.apiKey)`. Update to:

```ts
import { COMPACTION_PROMPTS } from "../../compaction/prompts.ts"; // new file
// ...
const result = await compact(preparation, auth.model, auth.apiKey, {
  prompts: COMPACTION_PROMPTS,
});
```

`apps/server/src/agent/runner.ts` calls `runAgentRunEffect({...})`. Add `prompts: COMPACTION_PROMPTS` to the deps.

`apps/server/src/agent/runner.ts` may also reference `runAutoCompactionEffect` directly (audit via `rg runAutoCompactionEffect apps/server/src`).

### B2.5 Create `apps/server/src/compaction/prompts.ts`

```ts
import type { BranchSummaryPrompts, CompactionPrompts } from "@sakti-code/agent";

export const COMPACTION_PROMPTS: CompactionPrompts = {
  summarizationSystem: `You are a context summarization assistant. ...`,
  summarization: `The messages above are a conversation to summarize. ...`,
  update: `The messages above are NEW conversation messages ...`,
  turnPrefix: `This is the PREFIX of a turn that was too large to keep. ...`,
} as const;

export const BRANCH_SUMMARY_PROMPTS: BranchSummaryPrompts = {
  preamble: `The user explored a different conversation branch ...`,
  prompt: `Create a structured summary of this conversation branch ...`,
} as const;
```

**Copy verbatim** from the existing `packages/agent/src/prompts/compaction.ts` and `prompts/branch-summary.ts`. No edits to the text itself.

### B2.6 Delete originals

- `packages/agent/src/prompts/compaction.ts`
- `packages/agent/src/prompts/branch-summary.ts`

### B2.7 Verify

- `pnpm run typecheck` — green.
- All tests pass with same counts (server, agent, db, desktop).

### B2.8 Commit

```
refactor(agent): parameterize compaction + branch-summary prompts (Phase B2)

compactEffect, generateSummaryEffect, generateBranchSummaryEffect now
take required prompt bundles (Pattern X — no defaults). Server owns
COMPACTION_PROMPTS + BRANCH_SUMMARY_PROMPTS in apps/server/src/compaction/prompts.ts.

Algorithm behavior unchanged — same prompts flow through, just via params.

packages/agent/src/prompts/compaction.ts and branch-summary.ts deleted.
```

## Phase B3 — Parameterize branch summarizer

(Largely overlaps with B2 if branch-summary's `SUMMARIZATION_SYSTEM_PROMPT` reuse is the only remaining tie. If B2 already handled it, skip B3.)

### B3.1 Audit branch-summarization.ts imports

After B2, verify `rg -n "from.*prompts/" packages/agent/src/compaction/branch-summarization.ts` returns nothing. If it still imports `BRANCH_SUMMARY_PREAMBLE` / `BRANCH_SUMMARY_PROMPT`, finish the migration here.

### B3.2 Update `generateBranchSummaryEffect` options

Add `prompts: BranchSummaryPrompts` to `GenerateBranchSummaryOptions` (required). Body uses `options.prompts.preamble` / `.prompt` instead of the hardcoded constants.

### B3.3 Migrate callers

`rg generateBranchSummaryEffect apps/server/src` — update each call site to pass `BRANCH_SUMMARY_PROMPTS`.

### B3.4 Verify + commit

Same shape as B2.7/B2.8.

## Phase B4 — Parameterize skills instructions

### B4.1 RED — failing test

Update `packages/agent/src/resources/__tests__/system-prompt.test.ts`:

```ts
it("requires skillsInstructions in composeSystemPrompt", () => {
  // @ts-expect-error - skillsInstructions is required
  composeSystemPrompt("base", [], [], true);
});

it("uses provided skillsInstructions in the skills block", () => {
  const result = composeSystemPrompt("base", [], [skill], true, [
    "MINE INSTRUCTIONS",
  ]);
  expect(result).toContain("MINE INSTRUCTIONS");
  expect(result).toContain("<available_skills>");
});

it("stripSkillsBlock uses skillsInstructions[0] as marker", () => {
  const composed = composeSystemPrompt("base", [], [skill], true, ["MARKER"]);
  const stripped = stripSkillsBlock(composed, ["MARKER"]);
  expect(stripped).toBe("base");
});
```

Verify RED.

### B4.2 GREEN — refactor signatures

`packages/agent/src/resources/system-prompt.ts`:

```ts
import type { SkillsInstructions } from "../compaction/prompt-bundles.ts";

export function formatSkillsForSystemPrompt(
  skills: Skill[],
  skillsInstructions: SkillsInstructions
): string {
  const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation);
  if (visibleSkills.length === 0) {
    return "";
  }
  const lines = [...skillsInstructions, "", "<available_skills>"];
  // ... rest unchanged
}

export function appendSkillsBlock(
  baseSystemPrompt: string,
  skills: readonly Skill[],
  hasRead: boolean,
  skillsInstructions: SkillsInstructions
): string { /* ... */ }

export function stripSkillsBlock(
  composedSystemPrompt: string,
  skillsInstructions: SkillsInstructions
): string {
  const marker = `\n\n${skillsInstructions[0]}`;
  // ... rest unchanged
}

export function composeSystemPrompt(
  baseSystemPrompt: string,
  tools: readonly AgentTool[],
  skills: readonly Skill[],
  hasRead: boolean,
  skillsInstructions: SkillsInstructions
): string { /* ... */ }
```

Delete the import of `../prompts/skills-instructions`.

### B4.3 Create `apps/server/src/agents/skills-instructions.ts`

```ts
import type { SkillsInstructions } from "@sakti-code/agent";

export const SKILLS_INSTRUCTIONS: SkillsInstructions = [
  "The following skills provide specialized instructions for specific tasks.",
  "Read the full skill file when the task matches its description, unless a <skill> block for that skill is already present in the conversation (an explicitly triggered skill is already loaded in full — do not read it again).",
  "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
] as const;
```

(Verbatim copy of the current `packages/agent/src/prompts/skills-instructions.ts`.)

### B4.4 Migrate callers

Audit `rg "composeSystemPrompt\(|appendSkillsBlock\(|stripSkillsBlock\(|formatSkillsForSystemPrompt\(" packages/agent/src apps/server/src`:

- **In `packages/agent`:** anywhere these functions call each other, thread the param through. (Internal callers should be just each other — verify.)
- **In `apps/server`:** `runner.ts` calls `composeSystemPrompt(agent.systemPrompt, activeTools, activeSkills, hasRead)` — add `, SKILLS_INSTRUCTIONS)`.
- **In `packages/agent`'s harness:** if the harness calls `appendSkillsBlock` internally on `setSkills()`/`removeSkill()`, the harness needs a `skillsInstructions` field set at construction. Add to `AgentHarnessOptions.skillsInstructions: SkillsInstructions` (required).

### B4.5 Harness constructor change

`packages/agent/src/agent/agent-harness.ts:312-326` — add:

```ts
this.skillsInstructions = options.skillsInstructions;
```

Add to `AgentHarnessOptions` interface:

```ts
readonly skillsInstructions: SkillsInstructions; // required
```

Update all internal harness uses (`appendSkillsBlock`, `stripSkillsBlock` calls inside the harness) to pass `this.skillsInstructions`.

### B4.6 Delete original

- `packages/agent/src/prompts/skills-instructions.ts`

### B4.7 Verify

- `pnpm run typecheck` — green.
- All tests pass (same counts).

### B4.8 Commit

```
refactor(agent): parameterize skills-instructions (Phase B4)

composeSystemPrompt, appendSkillsBlock, stripSkillsBlock,
formatSkillsForSystemPrompt now take a required SkillsInstructions
param. The first element is the sentinel marker for stripSkillsBlock
(documented contract). Harness takes skillsInstructions at construction
and threads it to internal recomposition.

Server owns SKILLS_INSTRUCTIONS in apps/server/src/agents/skills-instructions.ts.

packages/agent/src/prompts/ folder is now empty and can be deleted.
```

## Phase B5 — Final cleanup + verification

### B5.1 Delete empty folder

`rmdir packages/agent/src/prompts/` (should be empty after B4.6).
Delete `packages/agent/src/prompts/__tests__/intake-system-prompt.test.ts` (already moved with the intake prompt in Change A — verify).

### B5.2 Audit imports

```
rg "from.*prompts/(compaction|branch-summary|skills-instructions|intake-system-prompt|agents)" packages/agent/src apps/server/src
```

Should return zero hits.

### B5.3 Update `packages/agent/src/index.ts`

Verify no exports reference deleted paths. The new exports (`CompactionPrompts`, `BranchSummaryPrompts`, `SkillsInstructions`, `CompactEffectOptions`) are present.

### B5.4 Full verification

- `pnpm run typecheck` — all packages green.
- `pnpm run fix` — clean.
- Full test sweep:
  - agent: same count as post-Change-A (no test count change expected — pure parameterization)
  - db: 36/36
  - server: same as post-Change-A
  - desktop: 402/402
- `ls packages/agent/src/prompts/` → directory does not exist.

### B5.5 Commit

```
chore(agent): remove empty prompts/ folder (Phase B5)

All algorithm-internal prompts now live in apps/server. The agent
package's prompts/ folder is gone. Per the content-extraction design,
the agent package now ships zero content: types, algorithms, helpers,
factories only.
```

## Risk register

| Risk | Mitigation |
|---|---|
| Changing function signatures breaks many callers. | Each function migrated in its own commit; typecheck catches all call sites. |
| `stripSkillsBlock` sentinel contract is subtle. | Documented in JSDoc; test asserts marker-based stripping. |
| Harness constructor change is breaking for any consumer. | Yes — intentional. Per Pattern X philosophy, consumers must opt in to providing content. Server consumer updated in same phase. |
| `auto-compaction.ts`/`runAgentRunEffect` threading is complex. | Phase I3 plan documents the deps chain; this just adds one more required field. Symmetric with how `skills`/`templates` are already passed. |
| Behavior drift from copy-paste errors when moving prompt strings. | B2.5/B3/B4.3 mandate verbatim copies; existing tests asserting prompt content (if any) catch drift. |

## Manual smoke test (post-merge)

1. Trigger compaction manually on a long session (POST `/api/sessions/:id/compact`) — verify summary format unchanged.
2. Run an intake session to auto-compaction threshold — verify auto-compaction still triggers + persists.
3. Fork a session, abandon a branch, switch back — verify branch summary persists with the correct preamble.
4. Add a skill via `.sakti/skills/test/SKILL.md`, restart, send a prompt — verify the skills block appears in the system prompt with the expected instructions header.
5. Disable a skill mid-session via the harness's `removeSkill()` — verify the skills block is correctly recomposed (strip-and-recompose via sentinel).
