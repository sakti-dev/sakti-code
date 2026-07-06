# Phase Workflow & Skill Injection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the 5 phase skills (sakti-plan/design/build/verify/archive) into the agent runtime so each phase automatically (1) routes to the correct agent, (2) injects the phase's SKILL.md as an ephemeral assistant-side tool-result, and (3) excludes that skill content from the observational-memory observer input. Plus restructure the mission lifecycle so build→verify forces an OM observe (bias reduction) and verify→merged is a new explicit handoff.

**Architecture:**

- **Skill source location**: `apps/server/src/agent/config/builtin-skills/sakti-{plan,design,build,verify,archive}/` (co-located with the server config that consumes them — markdown is static content, not code, so it doesn't belong in `packages/sakti/`).
- **Skill runtime location**: `~/.sakti/agent/skills/sakti-{plan,...}/` (where `loadAgentContext` already scans). Server installs/syncs from source at startup (always overwrite — small markdown trees, idempotent).
- **Agents**: 3 primary (`plan`, `build`, `verify`) + 2 subagent-metadata-only (`explore`, `general`). `verify` is edit-denied (structural enforcement). `spec` is removed — `build` now covers the design phase.
- **Skill injection**: ephemeral, rebuilt every run from `phase → skill name` lookup. Implemented as synthetic `read(SKILL.md)` tool-call + tool-result prepended via a new `initialMessages` field on `AgentRunDeps` and a new `harness.injectMessages()` method. Never persisted to DB.
- **Observer filter**: path-based, configured via a new `skillFilterRoot?: string` field on `ObservationalMemoryDeps`. The engine's `loadUnobservedMessageEntries` drops any tool-result whose associated `read` call had a path starting with `skillFilterRoot`. `skillFilterRoot` points at the runtime dir (`~/.sakti/agent/skills`). Filter ON by default for main sessions in plan/design/build/verify; OFF for archive phase and (future) subagents.
- **Lifecycle**: `specifying → building → review → merged`. `review` already exists as a status value but is currently skipped — we wire it in. `ask({kind:"completion"})` now flips to `review` (was `merged`) and forces OM observe first. New `ask({kind:"verify-complete"})` flips `review → merged`.

**Tech Stack:** TypeScript, Effect, Hono, vitest, node:sqlite.

---

## Part 0: Move Builtin Skills to Server Config

Relocate the 5 phase skills from `packages/sakti/src/sdd/skills/` to `apps/server/src/agent/config/builtin-skills/`. Markdown is static content, not code — exporting it from a TypeScript package via `package.json` exports was awkward. Co-locating with server config makes ownership clear and gives us a stable source path for the install-at-boot sync.

### Task 0.1: Move skill directories

**Files:**

- Move: `packages/sakti/src/sdd/skills/sakti-plan/` → `apps/server/src/agent/config/builtin-skills/sakti-plan/`
- Move: `packages/sakti/src/sdd/skills/sakti-design/` → `apps/server/src/agent/config/builtin-skills/sakti-design/`
- Move: `packages/sakti/src/sdd/skills/sakti-build/` → `apps/server/src/agent/config/builtin-skills/sakti-build/`
- Move: `packages/sakti/src/sdd/skills/sakti-verify/` → `apps/server/src/agent/config/builtin-skills/sakti-verify/`
- Move: `packages/sakti/src/sdd/skills/sakti-archive/` → `apps/server/src/agent/config/builtin-skills/sakti-archive/`

Each skill directory contains `SKILL.md` plus any `references/*.md` files. Move the entire subtree preserving structure.

**Step 1: Verify current state**

```bash
ls packages/sakti/src/sdd/skills/
```

Expected output (exactly 5):

```
sakti-archive
sakti-build
sakti-design
sakti-plan
sakti-verify
```

**Step 2: Create destination and move**

```bash
mkdir -p apps/server/src/agent/config/builtin-skills
git mv packages/sakti/src/sdd/skills/sakti-plan    apps/server/src/agent/config/builtin-skills/sakti-plan
git mv packages/sakti/src/sdd/skills/sakti-design  apps/server/src/agent/config/builtin-skills/sakti-design
git mv packages/sakti/src/sdd/skills/sakti-build   apps/server/src/agent/config/builtin-skills/sakti-build
git mv packages/sakti/src/sdd/skills/sakti-verify  apps/server/src/agent/config/builtin-skills/sakti-verify
git mv packages/sakti/src/sdd/skills/sakti-archive apps/server/src/agent/config/builtin-skills/sakti-archive
```

If `packages/sakti/src/sdd/skills/` is now empty, remove the parent directory:

```bash
rmdir packages/sakti/src/sdd/skills/  # only if empty
```

**Step 3: Search for stale references to the old path**

```bash
rg 'packages/sakti/src/sdd/skills|sdd/skills/sakti-' --type-add 'doc:*.md' --type ts --type doc
```

Update any documentation, imports, or test fixtures that reference the old path. Likely candidates:

- `packages/sakti/schemas/spec-driven/schema.yaml` (if it references skill source paths — it shouldn't, but verify)
- `docs/plans/*.md` (historical plans — leave alone; they document past state)
- Any test that loads skills from a hardcoded path

**Step 4: Run full test suite**

```bash
vp run -r test
```

Expected: PASS — no tests should reference the old source path (skills are loaded from runtime location `~/.sakti/agent/skills/`, not from source).

**Step 5: Run check**

```bash
vp check
```

Expected: 0 warnings, 0 errors.

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: move builtin skills to apps/server/src/agent/config/builtin-skills

Markdown is static content, not code — co-locate with server config
that consumes them. Source path is now stable for install-at-boot sync.
Runtime location (~/.sakti/agent/skills/) is unchanged."
```

---

### Task 0.2: Add install-at-boot sync

Server boots → syncs builtin skills from source to runtime dir (`~/.sakti/agent/skills/`). Always overwrite (small trees, idempotent, source is canonical).

**Files:**

- Create: `apps/server/src/agent/config/install-builtin-skills.ts`
- Modify: server bootstrap (find where `loadAgentContext` is first invoked; sync before that)
- Test: `apps/server/src/agent/config/__tests__/install-builtin-skills.test.ts`

**Step 1: Find the SAKTI_AGENT_DIR resolution**

```bash
rg 'SAKTI_AGENT_DIR|\.sakti/agent' apps/server/src/ --type ts
```

Note where `~/.sakti/agent/` is resolved (likely in `apps/server/src/context.ts` or `apps/server/src/lib/paths.ts`). Use the same helper here.

**Step 2: Write failing test**

Create `apps/server/src/agent/config/__tests__/install-builtin-skills.test.ts`:

```ts
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { installBuiltinSkills, BUILTIN_SKILL_NAMES } from "../install-builtin-skills.ts";

describe("installBuiltinSkills", () => {
  let runtimeDir: string;

  beforeEach(async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), "sakti-skills-test-"));
  });

  afterEach(async () => {
    await rm(runtimeDir, { recursive: true, force: true });
  });

  it("creates the runtime dir if it does not exist", async () => {
    const missing = join(runtimeDir, "nested", "skills");
    await installBuiltinSkills(missing);
    const info = await stat(missing);
    expect(info.isDirectory()).toBe(true);
  });

  it("copies all 5 builtin skills to the runtime dir", async () => {
    await installBuiltinSkills(runtimeDir);
    for (const name of BUILTIN_SKILL_NAMES) {
      const skillMd = await readFile(join(runtimeDir, name, "SKILL.md"), "utf8");
      expect(skillMd).toContain("---"); // frontmatter present
      expect(skillMd).toContain(`name: ${name}`);
    }
  });

  it("copies reference subdirectories", async () => {
    await installBuiltinSkills(runtimeDir);
    // sakti-build has references/execution-guide.md, tdd-guide.md, debugging-guide.md
    const ref = await readFile(
      join(runtimeDir, "sakti-build", "references", "execution-guide.md"),
      "utf8",
    );
    expect(ref.length).toBeGreaterThan(0);
  });

  it("overwrites existing files (idempotent)", async () => {
    await installBuiltinSkills(runtimeDir);
    // Corrupt one file
    const target = join(runtimeDir, "sakti-plan", "SKILL.md");
    await writeFile(target, "CORRUPTED");
    // Re-install
    await installBuiltinSkills(runtimeDir);
    const content = await readFile(target, "utf8");
    expect(content).not.toBe("CORRUPTED");
    expect(content).toContain("name: sakti-plan");
  });
});
```

**Step 3: Run test to verify it fails**

```bash
vp run '@sakti-code/server#test' -- install-builtin-skills.test
```

Expected: FAIL — module not found.

**Step 4: Implement install-builtin-skills.ts**

Create `apps/server/src/agent/config/install-builtin-skills.ts`:

```ts
import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_SKILL_NAMES } from "./phase-skills.ts";
import { SAKTI_AGENT_DIR } from "../../lib/paths.ts"; // wherever ~/.sakti/agent resolves

/**
 * Absolute path to the builtin skills source directory (co-located with this
 * module). Skills are markdown trees, not code — kept here as static content
 * owned by the server config.
 */
export const BUILTIN_SKILLS_SOURCE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "builtin-skills",
);

/**
 * Runtime dir where loadAgentContext scans for skills. Same dir the
 * install-at-boot sync writes to. Re-exported here as the single source of
 * truth for "where builtin skills live at runtime" — also used by
 * resolveOmConfig to compute skillFilterRoot.
 */
export const BUILTIN_SKILLS_RUNTIME_DIR = join(SAKTI_AGENT_DIR, "skills");

/**
 * Install (sync) builtin skills from source to the runtime dir.
 *
 * Runtime dir is `~/.sakti/agent/skills/` (BUILTIN_SKILLS_RUNTIME_DIR) — where
 * `loadAgentContext` scans. Always overwrites: skills are small markdown trees,
 * source is canonical, idempotent re-runs are safe.
 *
 * Called at server bootstrap, before any `loadAgentContext` invocation.
 */
export async function installBuiltinSkills(
  runtimeDir: string = BUILTIN_SKILLS_RUNTIME_DIR,
): Promise<void> {
  await mkdir(runtimeDir, { recursive: true });
  for (const name of BUILTIN_SKILL_NAMES) {
    const src = join(BUILTIN_SKILLS_SOURCE_DIR, name);
    const dest = join(runtimeDir, name);
    // force: overwrite existing files. recursive: copy references/ subtrees.
    await cp(src, dest, { recursive: true, force: true });
  }
}
```

**Step 5: Wire into server bootstrap**

Find the server bootstrap (`apps/server/src/server.ts` or wherever `createServer` is called). Add the install call before the server starts listening — specifically, before any code path that could invoke `loadAgentContext`:

```ts
import { installBuiltinSkills } from "./agent/config/install-builtin-skills.ts";

// Before server.listen / before first loadAgentContext:
// No args needed — defaults to BUILTIN_SKILLS_RUNTIME_DIR (~/.sakti/agent/skills).
await installBuiltinSkills();
```

If the bootstrap is Effect-based or async-init, slot the call in the appropriate phase. The key invariant: `loadAgentContext` must not run before this completes.

**Step 6: Run test to verify it passes**

```bash
vp run '@sakti-code/server#test' -- install-builtin-skills.test
```

Expected: PASS.

**Step 7: Run full check**

```bash
vp check
```

Expected: 0 warnings, 0 errors.

**Step 8: Commit**

```bash
git add apps/server/src/agent/config/install-builtin-skills.ts apps/server/src/agent/config/__tests__/install-builtin-skills.test.ts apps/server/src/server.ts
git commit -m "feat(server): install builtin skills at boot (sync source → ~/.sakti)"
```

---

## Part 1: Verify Agent

Add a new `verify` primary agent that is structurally edit-denied. Remove the `spec` agent (its role is absorbed by `build` + the sakti-design skill injection).

### Task 1.1: Add VERIFY_PROMPT constant

**Files:**

- Modify: `apps/server/src/agent/config/prompts.ts`
- Test: `apps/server/src/agent/config/__tests__/prompts.test.ts` (create if absent)

**Step 1: Write the failing test**

Create `apps/server/src/agent/config/__tests__/prompts.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { BASE_PROMPT, BUILD_PROMPT, SPEC_PROMPT, VERIFY_PROMPT } from "../prompts.ts";

describe("prompts", () => {
  it("VERIFY_PROMPT composes the base prompt with the verify role", () => {
    expect(VERIFY_PROMPT).toContain(BASE_PROMPT);
    expect(VERIFY_PROMPT).toContain("# Your role: Verify agent");
    expect(VERIFY_PROMPT).toContain("edit-denied");
    expect(VERIFY_PROMPT).toContain('ask({ kind: "verify-complete"');
  });

  it("VERIFY_PROMPT lists the three verification dimensions", () => {
    expect(VERIFY_PROMPT).toContain("Completeness");
    expect(VERIFY_PROMPT).toContain("Correctness");
    expect(VERIFY_PROMPT).toContain("Coherence");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
vp run '@sakti-code/server#test' -- prompts.test
```

Expected: FAIL — `VERIFY_PROMPT` is not exported.

**Step 3: Add VERIFY_PROMPT to prompts.ts**

Edit `apps/server/src/agent/config/prompts.ts`. Add after the `SPEC_PROMPT` definition (before `DEFAULT_SYSTEM_PROMPT`):

```ts
export const VERIFY_PROMPT = withBase(`# Your role: Verify agent
You review completed work for bugs, completeness, and coherence. You are edit-denied: report issues, do not fix them. If fixes are needed, the build agent returns to fix them after your report.

Verify three dimensions:
1. **Completeness** — every task in tasks.md is checked off, tests exist for new behavior, edge cases are covered.
2. **Correctness** — code runs, no obvious bugs, follows the repo's existing conventions.
3. **Coherence** — implementation matches the technical design; spec deltas match what was built.

When verification is complete, call \`ask({ kind: "verify-complete", body })\` where \`body\` is the verification report. The user reviews and decides whether to merge or request fixes. If you are blocked or need a decision, call \`ask\` without a \`kind\`.`);
```

**Step 4: Run test to verify it passes**

```bash
vp run '@sakti-code/server#test' -- prompts.test
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/agent/config/prompts.ts apps/server/src/agent/config/__tests__/prompts.test.ts
git commit -m "feat(server): add VERIFY_PROMPT for verify agent"
```

---

### Task 1.2: Add `verify` agent to SERVER_AGENTS

**Files:**

- Modify: `apps/server/src/agent/config/server-agents.ts`
- Test: `apps/server/src/agent/config/__tests__/server-agents.test.ts`

**Step 1: Read the existing test file**

```bash
cat apps/server/src/agent/config/__tests__/server-agents.test.ts
```

Note the existing test patterns (table-driven, asserting on agent properties).

**Step 2: Write the failing test**

Append to `apps/server/src/agent/config/__tests__/server-agents.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { resolveServerAgent, SERVER_AGENTS } from "../server-agents.ts";
import { evaluate } from "@sakti-code/agent";

describe("verify agent", () => {
  it("is registered as a primary agent", () => {
    const agent = resolveServerAgent("verify");
    expect(agent).toBeDefined();
    expect(agent?.mode).toBe("primary");
  });

  it("declares read/grep/find/bash/webfetch/websearch/ask tools (no write/edit)", () => {
    const agent = resolveServerAgent("verify")!;
    expect(agent.activeToolNames).toEqual([
      "read",
      "grep",
      "find",
      "bash",
      "webfetch",
      "websearch",
      "ask",
    ]);
  });

  it("denies edit and write permissions structurally", () => {
    const agent = resolveServerAgent("verify")!;
    const ruleset = agent.permission;
    expect(evaluate("edit", "/any/path.ts", ruleset).action).toBe("deny");
    expect(evaluate("write", "/any/path.ts", ruleset).action).toBe("deny");
  });

  it("allows read, grep, find, bash", () => {
    const agent = resolveServerAgent("verify")!;
    const ruleset = agent.permission;
    expect(evaluate("read", "/any/path.ts", ruleset).action).toBe("allow");
    expect(evaluate("grep", "pattern", ruleset).action).toBe("allow");
    expect(evaluate("find", "pattern", ruleset).action).toBe("allow");
    expect(evaluate("bash", "ls", ruleset).action).toBe("allow");
  });
});
```

**Step 3: Run test to verify it fails**

```bash
vp run '@sakti-code/server#test' -- server-agents.test
```

Expected: FAIL — `resolveServerAgent("verify")` returns undefined.

**Step 4: Add verifyRuleset and verify agent**

Edit `apps/server/src/agent/config/server-agents.ts`:

4a. Add import for `VERIFY_PROMPT`:

```ts
import {
  BUILD_PROMPT,
  EXPLORE_PROMPT,
  GENERAL_PROMPT,
  PLAN_PROMPT,
  SPEC_PROMPT,
  VERIFY_PROMPT,
} from "./prompts.ts";
```

4b. Add `verifyRuleset` function after `specRuleset`:

```ts
/**
 * Verify: read-only review agent. Edit and write are structurally denied so
 * the agent is forced to *report* issues, not silently fix them. This is the
 * structural counterweight to the "compaction-before-verify" bias-reduction
 * move — without it, the agent rationalizes "looks good, let me just fix it."
 */
function verifyRuleset(): PermissionRuleset {
  return fromConfig({
    "*": "allow",
    edit: { "*": "deny" },
    write: { "*": "deny" },
    webfetch: "allow",
    websearch: "allow",
  });
}
```

4c. Add the verify agent to `SERVER_AGENTS` (after the `spec` entry, before `general`):

```ts
defineAgent({
  name: "verify",
  mode: "primary",
  description:
    "Verification agent. Reviews completed work for bugs, completeness, and coherence. Edit-denied: reports issues, does not fix them.",
  systemPrompt: VERIFY_PROMPT,
  permission: verifyRuleset(),
  activeToolNames: ["read", "grep", "find", "bash", "webfetch", "websearch", "ask"],
}),
```

**Step 5: Run test to verify it passes**

```bash
vp run '@sakti-code/server#test' -- server-agents.test
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/server/src/agent/config/server-agents.ts apps/server/src/agent/config/__tests__/server-agents.test.ts
git commit -m "feat(server): add verify agent (edit-denied primary)"
```

---

### Task 1.3: Remove `spec` agent

The `spec` agent's role (structurally edit-denied design phase) is replaced by `build` + sakti-design skill injection. The forced skill content keeps the agent on-task; structural edit-denial during design is sacrificed for catalog simplicity (we keep it for `verify` where bias matters most).

**Files:**

- Modify: `apps/server/src/agent/config/server-agents.ts`
- Modify: `apps/server/src/agent/config/index.ts` (drop `SPEC_PROMPT` from re-exports? — **NO**, keep it; prompt may be referenced elsewhere or useful for tests)
- Modify: `apps/server/src/agent/config/__tests__/server-agents.test.ts` (update any spec assertions)
- Modify: `apps/server/src/agent/config/resolve-agent.ts` (update resolver — covered in Task 2.1)

**Step 1: Search for `spec` agent references**

```bash
rg '"spec"|SPEC_PROMPT|resolveServerAgent\("spec' apps/server/src/ packages/agent/src/ packages/db/src/
```

Document every hit. Known references that need updating:

- `apps/server/src/agent/config/resolve-agent.ts:51` — routes mission+specifying to "spec" (changed in Task 2.1)
- `apps/server/src/agent/config/server-agents.ts` — the spec entry itself (this task)
- Any tests asserting on `spec`

**Step 2: Write the failing test**

Append to `apps/server/src/agent/config/__tests__/server-agents.test.ts`:

```ts
describe("spec agent removal", () => {
  it("does not register a 'spec' agent", () => {
    const agent = resolveServerAgent("spec");
    expect(agent).toBeUndefined();
  });

  it("SERVER_AGENTS contains exactly plan, build, verify, explore, general", () => {
    const names = SERVER_AGENTS.map((a) => a.name).sort();
    expect(names).toEqual(["build", "explore", "general", "plan", "verify"]);
  });
});
```

**Step 3: Run test to verify it fails**

```bash
vp run '@sakti-code/server#test' -- server-agents.test
```

Expected: FAIL — `spec` is still in `SERVER_AGENTS`.

**Step 4: Remove spec entry**

Edit `apps/server/src/agent/config/server-agents.ts`:

4a. Remove the `specRuleset` function (its logic now lives in `verifyRuleset` — but verify denies `write` too; remove spec-specific code entirely).

4b. Remove the `spec` `defineAgent` block from `SERVER_AGENTS`.

4c. Drop `SPEC_PROMPT` from the imports (it's no longer used). **Keep the `SPEC_PROMPT` definition in `prompts.ts`** — it's referenced by tests and may be useful for historical reasons; just don't import it in `server-agents.ts`.

**Step 5: Run all server tests**

```bash
vp run '@sakti-code/server#test'
```

Expected: some tests may fail that referenced `spec` — fix them in this step. Likely candidates:

- `resolve-agent.test.ts` — update routing expectations (Task 2.1 handles this; if it breaks here, write the `build`-routing test now and let Task 2.1 implement)

If `resolve-agent.test.ts` fails, defer to Task 2.1 and mark this commit as "spec removed, resolver update pending."

**Step 6: Commit**

```bash
git add apps/server/src/agent/config/server-agents.ts apps/server/src/agent/config/__tests__/server-agents.test.ts
git commit -m "refactor(server): remove spec agent (absorbed into build + skill injection)"
```

---

## Part 2: Resolver & Mission Lifecycle

Wire the resolver to route `review` status to `verify`, change the completion ask-kind to land in `review` (with forced observe), and add a new `verify-complete` ask-kind.

### Task 2.1: Update resolver — review status → verify agent

**Files:**

- Modify: `apps/server/src/agent/config/resolve-agent.ts`
- Test: `apps/server/src/agent/config/__tests__/resolve-agent.test.ts`

**Step 1: Read existing resolver test**

```bash
cat apps/server/src/agent/config/__tests__/resolve-agent.test.ts
```

Note the existing test patterns.

**Step 2: Write failing tests**

Append to `apps/server/src/agent/config/__tests__/resolve-agent.test.ts`:

```ts
describe("resolveSessionAgentForKind — review status", () => {
  it("routes mission+review to verify agent", () => {
    const { agent } = resolveSessionAgentForKind("mission", [], undefined, "review");
    expect(agent.name).toBe("verify");
  });

  it("per-session override beats review routing", () => {
    const { agent } = resolveSessionAgentForKind("mission", [], "build", "review");
    expect(agent.name).toBe("build");
  });
});

describe("resolveSessionAgentForKind — specifying now routes to build (not spec)", () => {
  it("routes mission+specifying to build agent", () => {
    const { agent } = resolveSessionAgentForKind("mission", [], undefined, "specifying");
    expect(agent.name).toBe("build");
  });
});

describe("resolveSessionAgentForKind — merged routes to build (for archive)", () => {
  it("routes mission+merged to build agent", () => {
    const { agent } = resolveSessionAgentForKind("mission", [], undefined, "merged");
    expect(agent.name).toBe("build");
  });
});
```

Also update any existing test that asserts `mission+specifying → spec` to assert `→ build`.

**Step 3: Run test to verify it fails**

```bash
vp run '@sakti-code/server#test' -- resolve-agent.test
```

Expected: FAIL — `review` is not routed; `specifying` still routes to `spec`.

**Step 4: Update resolver**

Edit `apps/server/src/agent/config/resolve-agent.ts`. Replace the body of `resolveSessionAgentForKind`:

```ts
export function resolveSessionAgentForKind(
  kind: string,
  loadedAgents: AgentDefinition[],
  perSessionOverride?: string,
  status?: string,
): { agent: AgentDefinition } {
  let name: string;
  if (perSessionOverride) {
    name = perSessionOverride;
  } else if (kind === "plan") {
    name = "plan";
  } else if (kind === "mission" && status === "review") {
    name = "verify";
  } else {
    name = DEFAULT_AGENT_NAME;
  }
  return { agent: resolveAgentByName(name, loadedAgents) };
}
```

Note: `mission && status === "specifying"` previously routed to `spec`; now it falls through to `DEFAULT_AGENT_NAME` ("build"). Same for `building` and `merged`.

Also update the JSDoc above the function to reflect the new routing:

```ts
/**
 * Resolve the agent for a session based on its kind + status + per-session
 * override. Per-session override wins; otherwise `plan` kind → plan agent,
 * `mission` kind in the `review` status → verify agent (edit-denied), and
 * all other mission statuses (specifying, building, merged) → build agent.
 *
 * The "specifying → build" routing is intentional: the design phase uses the
 * sakti-design skill (force-injected at run start) to keep the agent on-task
 * instead of a structurally edit-denied spec agent. Edit-denial is preserved
 * for verify (where bias reduction matters most).
 */
```

**Step 5: Run test to verify it passes**

```bash
vp run '@sakti-code/server#test' -- resolve-agent.test
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/server/src/agent/config/resolve-agent.ts apps/server/src/agent/config/__tests__/resolve-agent.test.ts
git commit -m "feat(server): route mission+review to verify agent; specifying→build"
```

---

### Task 2.2: Remove `forceReset` from spec-approve handler

The current `spec` ask-kind approve handler calls `forceReset` (which forces an OM observe). Per the design, we want to preserve the design-phase context in full for the build agent — so this forced observe must be removed.

**Files:**

- Modify: `apps/server/src/agent/config/ask-kinds.ts`
- Test: `apps/server/src/agent/config/__tests__/ask-kinds.test.ts`

**Step 1: Read the existing test**

```bash
cat apps/server/src/agent/config/__tests__/ask-kinds.test.ts
```

**Step 2: Write failing test**

Append to `apps/server/src/agent/config/__tests__/ask-kinds.test.ts`:

```ts
describe("spec ask-kind onApprove", () => {
  it("flips status to building but does NOT call forceReset", async () => {
    const sessions = { update: vi.fn(() => Promise.resolve()) };
    const forceReset = vi.fn(() => Promise.resolve());
    const ctx = { sessions, forceReset };

    await ASK_KINDS.spec.onApprove!("sess-1", "the spec body", ctx);

    expect(sessions.update).toHaveBeenCalledWith("sess-1", { status: "building" });
    expect(forceReset).not.toHaveBeenCalled();
  });
});
```

**Step 3: Run test to verify it fails**

```bash
vp run '@sakti-code/server#test' -- ask-kinds.test
```

Expected: FAIL — `forceReset` IS currently called.

**Step 4: Remove forceReset invocation**

Edit `apps/server/src/agent/config/ask-kinds.ts`. In the `spec.onApprove` handler, remove the `try { await ctx.forceReset?.(id); } catch ...` block. Keep only the status flip:

```ts
spec: {
  card: "proposed-spec",
  onApprove: async (id, _body, ctx) => {
    await ctx.sessions.update(id, { status: "building" });
    // NOTE: forced OM observe removed intentionally. The build agent benefits
    // from the full design-phase context (file maps, decisions, constraints).
    // Cache break from the agent swap is unavoidable but content loss is not.
  },
  onReject: async () => {},
},
```

**Step 5: Run test to verify it passes**

```bash
vp run '@sakti-code/server#test' -- ask-kinds.test
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/server/src/agent/config/ask-kinds.ts apps/server/src/agent/config/__tests__/ask-kinds.test.ts
git commit -m "refactor(server): drop forced observe on spec→build (preserve design context)"
```

---

### Task 2.3: Change `completion` ask-kind → review (was merged)

When the build agent calls `ask({kind:"completion"})`, the user approves → status should flip to `review` (not `merged`). The verify phase runs next.

**Files:**

- Modify: `apps/server/src/agent/config/ask-kinds.ts`
- Test: `apps/server/src/agent/config/__tests__/ask-kinds.test.ts`

**Step 1: Write failing test**

Append to `apps/server/src/agent/config/__tests__/ask-kinds.test.ts`:

```ts
describe("completion ask-kind onApprove", () => {
  it("flips status to review (not merged)", async () => {
    const sessions = { update: vi.fn(() => Promise.resolve()) };
    const ctx = { sessions };

    await ASK_KINDS.completion.onApprove!("sess-1", "what I built", ctx);

    expect(sessions.update).toHaveBeenCalledWith("sess-1", { status: "review" });
  });

  it("onReject flips status back to building", async () => {
    const sessions = { update: vi.fn(() => Promise.resolve()) };
    const ctx = { sessions };

    await ASK_KINDS.completion.onReject!("sess-1", "what I built", ctx);

    expect(sessions.update).toHaveBeenCalledWith("sess-1", { status: "building" });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
vp run '@sakti-code/server#test' -- ask-kinds.test
```

Expected: FAIL — currently completes to `merged`.

**Step 3: Update completion handler**

Edit `apps/server/src/agent/config/ask-kinds.ts`:

```ts
completion: {
  card: "proposed-completion",
  onApprove: async (id, _body, ctx) => {
    await ctx.sessions.update(id, { status: "review" });
  },
  onReject: async (id, _body, ctx) => {
    await ctx.sessions.update(id, { status: "building" });
  },
},
```

**Step 4: Run test to verify it passes**

```bash
vp run '@sakti-code/server#test' -- ask-kinds.test
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/agent/config/ask-kinds.ts apps/server/src/agent/config/__tests__/ask-kinds.test.ts
git commit -m "feat(server): completion approve → review status (verify phase)"
```

---

### Task 2.4: Add `verify-complete` ask-kind → merged

New ask-kind for when the verify agent completes. Approve → merged (ready for archive); reject → building (back to fix).

**Files:**

- Modify: `apps/server/src/agent/config/ask-kinds.ts`
- Test: `apps/server/src/agent/config/__tests__/ask-kinds.test.ts`

**Step 1: Write failing test**

Append to `apps/server/src/agent/config/__tests__/ask-kinds.test.ts`:

```ts
describe("verify-complete ask-kind", () => {
  it("is a known ask kind", () => {
    expect(isKnownAskKind("verify-complete")).toBe(true);
  });

  it("card is proposed-completion", () => {
    expect(ASK_KINDS["verify-complete"].card).toBe("proposed-completion");
  });

  it("onApprove flips status to merged", async () => {
    const sessions = { update: vi.fn(() => Promise.resolve()) };
    const ctx = { sessions };

    await ASK_KINDS["verify-complete"].onApprove!("sess-1", "verify report", ctx);

    expect(sessions.update).toHaveBeenCalledWith("sess-1", { status: "merged" });
  });

  it("onReject flips status to building", async () => {
    const sessions = { update: vi.fn(() => Promise.resolve()) };
    const ctx = { sessions };

    await ASK_KINDS["verify-complete"].onReject!("sess-1", "verify report", ctx);

    expect(sessions.update).toHaveBeenCalledWith("sess-1", { status: "building" });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
vp run '@sakti-code/server#test' -- ask-kinds.test
```

Expected: FAIL — `verify-complete` is not a known kind.

**Step 3: Add verify-complete ask-kind**

Edit `apps/server/src/agent/config/ask-kinds.ts`:

3a. Extend the `AskKind` union:

```ts
export type AskKind = "session" | "spec" | "completion" | "verify-complete";
```

3b. Extend `AskCard` if needed (verify-complete reuses `proposed-completion`):

```ts
export type AskCard = "proposed-session" | "proposed-spec" | "proposed-completion";
```

(No change — `proposed-completion` already exists.)

3c. Add the entry in `ASK_KINDS`:

```ts
export const ASK_KINDS: Record<AskKind, AskKindHandlers> = {
  session: {
    /* ...existing... */
  },
  spec: {
    /* ...existing... */
  },
  completion: {
    /* ...existing... */
  },
  "verify-complete": {
    card: "proposed-completion",
    onApprove: async (id, _body, ctx) => {
      await ctx.sessions.update(id, { status: "merged" });
    },
    onReject: async (id, _body, ctx) => {
      await ctx.sessions.update(id, { status: "building" });
    },
  },
};
```

3d. Update `isKnownAskKind`:

```ts
export function isKnownAskKind(kind: string): kind is AskKind {
  return (
    kind === "session" || kind === "spec" || kind === "completion" || kind === "verify-complete"
  );
}
```

**Step 4: Run test to verify it passes**

```bash
vp run '@sakti-code/server#test' -- ask-kinds.test
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/agent/config/ask-kinds.ts apps/server/src/agent/config/__tests__/ask-kinds.test.ts
git commit -m "feat(server): add verify-complete ask-kind (review → merged)"
```

---

### Task 2.5: Force OM observe at completion-approve (build→verify transition)

The bias-reduction move: when the build agent declares completion, force an OM observe _before_ the status flips to `review`. The verify agent then starts on a compacted, observation-driven context rather than the build agent's full rationalization history.

**Files:**

- Modify: `apps/server/src/agent/config/ask-kinds.ts`
- Modify: `apps/server/src/agent/config/force-reset.ts` (rename or generalize)
- Test: `apps/server/src/agent/config/__tests__/ask-kinds.test.ts`

**Step 1: Write failing test**

Append to `apps/server/src/agent/config/__tests__/ask-kinds.test.ts`:

```ts
describe("completion ask-kind — forced observe", () => {
  it("calls forceReset before flipping status to review", async () => {
    const callOrder: string[] = [];
    const sessions = {
      update: vi.fn(async (id: string, patch: { status: string }) => {
        callOrder.push(`status:${patch.status}`);
      }),
    };
    const forceReset = vi.fn(async () => {
      callOrder.push("forceReset");
    });
    const ctx = { sessions, forceReset };

    await ASK_KINDS.completion.onApprove!("sess-1", "what I built", ctx);

    expect(callOrder).toEqual(["forceReset", "status:review"]);
    expect(forceReset).toHaveBeenCalledWith("sess-1");
  });

  it("continues to status flip if forceReset throws (best-effort)", async () => {
    const sessions = { update: vi.fn(() => Promise.resolve()) };
    const forceReset = vi.fn(() => Promise.reject(new Error("OM failed")));
    const log = { agent: { warn: vi.fn() } };
    const ctx = { sessions, forceReset, log };

    await ASK_KINDS.completion.onApprove!("sess-1", "what I built", ctx);

    expect(sessions.update).toHaveBeenCalledWith("sess-1", { status: "review" });
    expect(log.agent.warn).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
vp run '@sakti-code/server#test' -- ask-kinds.test
```

Expected: FAIL — `completion.onApprove` doesn't call `forceReset`.

**Step 3: Update completion handler to call forceReset**

Edit `apps/server/src/agent/config/ask-kinds.ts`. Update the docstring for `AskCtx.forceReset`:

```ts
export interface AskCtx {
  sessions: Pick<SessionRepo, "update">;
  /**
   * Force a context reset (OM observe). Currently bound only for the
   * completion→review transition (build→verify) — the bias-reduction move
   * so the verify agent starts on a compacted, observation-driven context.
   *
   * Previously wired for spec→build; removed there to preserve design context.
   */
  forceReset?: (sessionId: string) => Promise<void>;
  /* ...rest unchanged... */
}
```

Update the `completion.onApprove` handler:

```ts
completion: {
  card: "proposed-completion",
  onApprove: async (id, _body, ctx) => {
    // Force OM observe BEFORE the status flip — the verify agent must start
    // on a compacted context to avoid inheriting the build agent's biases.
    // Best-effort: a reset failure must not strand the mission — the status
    // flip is the user's durable intent.
    try {
      await ctx.forceReset?.(id);
    } catch (err) {
      ctx.log?.agent?.warn?.("build→verify: forced observe failed (continuing)", {
        sessionId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await ctx.sessions.update(id, { status: "review" });
  },
  onReject: async (id, _body, ctx) => {
    await ctx.sessions.update(id, { status: "building" });
  },
},
```

**Step 4: Update the docstring at the top of ASK_KINDS**

```ts
/**
 * Server wiring for the generic `ask` tool. Each known kind maps to a card
 * and a pair of transition handlers.
 *
 * session           — plan hands off to a new mission session.
 * spec              — a specifying mission's spec is approved → status flips
 *                     to `building`. No forced observe (preserve design context).
 * completion        — a building mission declares completion → forced OM
 *                     observe runs, then status flips to `review` (verify phase).
 * verify-complete   — verify agent declares verification complete → approve
 *                     flips to `merged`; reject returns to `building`.
 */
```

**Step 5: Run test to verify it passes**

```bash
vp run '@sakti-code/server#test' -- ask-kinds.test
```

Expected: PASS.

**Step 6: Update force-reset.ts docstring (rename intent)**

Edit `apps/server/src/agent/config/force-reset.ts`. The function name `buildForceReset` is fine; just update the docstring to reflect the new binding site:

```ts
/**
 * Build the `forceReset` callback: forces an OM observe so the next agent
 * starts on a compacted, observation-driven context. Currently bound only
 * for the completion→review transition (build→verify) — the bias-reduction
 * move so the verify agent doesn't inherit the build agent's rationalizations.
 *
 * Extracted from the confirm route so the OM config resolution is unit-testable.
 *
 * Best-effort: if observe/reflect models aren't configured, the observe is
 * skipped — never strand the mission on a reset failure.
 */
```

**Step 7: Commit**

```bash
git add apps/server/src/agent/config/ask-kinds.ts apps/server/src/agent/config/__tests__/ask-kinds.test.ts apps/server/src/agent/config/force-reset.ts
git commit -m "feat(server): force OM observe at completion→review (bias reduction)"
```

---

## Part 3: Skill Injection Mechanism

The core feature: at run start, read the current phase, look up the corresponding builtin skill, and inject a synthetic `read(SKILL.md)` tool-call + tool-result as ephemeral messages (prepended before the user's first message). Never persisted.

### Task 3.1: Phase → skill name mapping

A pure lookup table. Tested in isolation.

**Files:**

- Create: `apps/server/src/agent/config/phase-skills.ts`
- Test: `apps/server/src/agent/config/__tests__/phase-skills.test.ts`

**Step 1: Write failing test**

Create `apps/server/src/agent/config/__tests__/phase-skills.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import {
  getBuiltinSkillForPhase,
  isBuiltinSkillName,
  BUILTIN_SKILL_NAMES,
} from "../phase-skills.ts";

describe("getBuiltinSkillForPhase", () => {
  it("maps plan phase to sakti-plan skill", () => {
    expect(getBuiltinSkillForPhase("plan")).toBe("sakti-plan");
  });

  it("maps specifying status (design phase) to sakti-design skill", () => {
    expect(getBuiltinSkillForPhase("design")).toBe("sakti-design");
    expect(getBuiltinSkillForPhase("specifying")).toBe("sakti-design");
  });

  it("maps building status to sakti-build skill", () => {
    expect(getBuiltinSkillForPhase("build")).toBe("sakti-build");
    expect(getBuiltinSkillForPhase("building")).toBe("sakti-build");
  });

  it("maps review status (verify phase) to sakti-verify skill", () => {
    expect(getBuiltinSkillForPhase("verify")).toBe("sakti-verify");
    expect(getBuiltinSkillForPhase("review")).toBe("sakti-verify");
  });

  it("maps merged status (archive phase) to sakti-archive skill", () => {
    expect(getBuiltinSkillForPhase("archive")).toBe("sakti-archive");
    expect(getBuiltinSkillForPhase("merged")).toBe("sakti-archive");
  });

  it("returns undefined for unknown phases", () => {
    expect(getBuiltinSkillForPhase("unknown")).toBeUndefined();
    expect(getBuiltinSkillForPhase("")).toBeUndefined();
  });
});

describe("isBuiltinSkillName", () => {
  it("returns true for the 5 phase skills", () => {
    expect(isBuiltinSkillName("sakti-plan")).toBe(true);
    expect(isBuiltinSkillName("sakti-design")).toBe(true);
    expect(isBuiltinSkillName("sakti-build")).toBe(true);
    expect(isBuiltinSkillName("sakti-verify")).toBe(true);
    expect(isBuiltinSkillName("sakti-archive")).toBe(true);
  });

  it("returns false for user-defined skills", () => {
    expect(isBuiltinSkillName("my-custom-skill")).toBe(false);
    expect(isBuiltinSkillName("debugging")).toBe(false);
  });
});

describe("BUILTIN_SKILL_NAMES", () => {
  it("is exactly the 5 phase skills", () => {
    expect(BUILTIN_SKILL_NAMES).toEqual([
      "sakti-plan",
      "sakti-design",
      "sakti-build",
      "sakti-verify",
      "sakti-archive",
    ]);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
vp run '@sakti-code/server#test' -- phase-skills.test
```

Expected: FAIL — module not found.

**Step 3: Implement phase-skills.ts**

Create `apps/server/src/agent/config/phase-skills.ts`:

```ts
/**
 * Builtin SDD phase skills — the closed set shipped with the app. These are
 * non-removable and receive special handling: forced skill injection at run
 * start (ephemeral synthetic tool-result) and observer filtering (excluded
 * from OM observe input so they don't pollute observations).
 *
 * Adding a 6th builtin here automatically opts it into injection + filtering.
 */
export const BUILTIN_SKILL_NAMES = [
  "sakti-plan",
  "sakti-design",
  "sakti-build",
  "sakti-verify",
  "sakti-archive",
] as const;

export type BuiltinSkillName = (typeof BUILTIN_SKILL_NAMES)[number];

const BUILTIN_SKILL_SET: ReadonlySet<string> = new Set(BUILTIN_SKILL_NAMES);

export function isBuiltinSkillName(name: string): boolean {
  return BUILTIN_SKILL_SET.has(name);
}

/**
 * Map a session phase (or equivalently, the DB `status` column) to the
 * builtin skill that should be force-injected at run start. Returns
 * `undefined` when no skill applies (unknown phase).
 *
 * Accepts both phase names (plan, design, build, verify, archive) and the
 * underlying session status values (specifying, building, review, merged).
 */
const PHASE_TO_SKILL: Readonly<Record<string, BuiltinSkillName>> = {
  plan: "sakti-plan",
  design: "sakti-design",
  specifying: "sakti-design",
  build: "sakti-build",
  building: "sakti-build",
  verify: "sakti-verify",
  review: "sakti-verify",
  archive: "sakti-archive",
  merged: "sakti-archive",
};

export function getBuiltinSkillForPhase(phase: string): BuiltinSkillName | undefined {
  return PHASE_TO_SKILL[phase];
}
```

**Step 4: Run test to verify it passes**

```bash
vp run '@sakti-code/server#test' -- phase-skills.test
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/agent/config/phase-skills.ts apps/server/src/agent/config/__tests__/phase-skills.test.ts
git commit -m "feat(server): phase→skill mapping + builtin registry"
```

---

### Task 3.2: Skill injection message builder

A pure function that takes a skill and produces the synthetic `[assistant tool_call, tool_result]` pair. Tested in isolation.

**Files:**

- Create: `apps/server/src/agent/config/skill-injection.ts`
- Test: `apps/server/src/agent/config/__tests__/skill-injection.test.ts`

**Step 1: Investigate the AgentMessage shape**

```bash
rg 'export (type|interface) AgentMessage' packages/agent/src/
```

Note: `AgentMessage` is the union of user/assistant/tool messages used by the harness. Look at how `createUserMessage` is used (`packages/agent/src/agent/agent-harness.ts:899`) and find the corresponding `createAssistantMessage` / `createToolResultMessage` helpers.

**Step 2: Write failing test**

Create `apps/server/src/agent/config/__tests__/skill-injection.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { buildSkillInjectionMessages } from "../skill-injection.ts";
import type { Skill } from "@sakti-code/agent";

const SKILL: Skill = {
  name: "sakti-build",
  description: "Phase 3 build skill.",
  content: "# Sakti Build\n\nExecute the tasks...",
  filePath: "/home/.sakti/agent/skills/sakti-build/SKILL.md",
};

describe("buildSkillInjectionMessages", () => {
  it("returns an empty array when skill is undefined", () => {
    expect(buildSkillInjectionMessages(undefined)).toEqual([]);
  });

  it("returns two messages: assistant tool_call + tool_result", () => {
    const msgs = buildSkillInjectionMessages(SKILL);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe("assistant");
    expect(msgs[1]!.role).toBe("tool");
  });

  it("assistant message contains a read tool_call with the skill filePath", () => {
    const msgs = buildSkillInjectionMessages(SKILL);
    const assistant = msgs[0]! as {
      role: string;
      content: string;
      tool_calls?: Array<{ function: { name: string; arguments: string } }>;
    };
    expect(assistant.tool_calls).toBeDefined();
    expect(assistant.tool_calls).toHaveLength(1);
    const call = assistant.tool_calls![0]!;
    expect(call.function.name).toBe("read");
    const args = JSON.parse(call.function.arguments);
    expect(args.filePath).toBe(SKILL.filePath);
  });

  it("tool_result contains the skill content", () => {
    const msgs = buildSkillInjectionMessages(SKILL);
    const toolMsg = msgs[1]! as { role: string; content: string };
    expect(toolMsg.content).toContain("# Sakti Build");
  });

  it("tool_result references the assistant tool_call id", () => {
    const msgs = buildSkillInjectionMessages(SKILL);
    const assistant = msgs[0]! as { tool_calls?: Array<{ id: string }> };
    const toolMsg = msgs[1]! as { tool_call_id?: string };
    expect(toolMsg.tool_call_id).toBe(assistant.tool_calls![0]!.id);
  });
});
```

**Step 3: Run test to verify it fails**

```bash
vp run '@sakti-code/server#test' -- skill-injection.test
```

Expected: FAIL — module not found.

**Step 4: Implement buildSkillInjectionMessages**

Create `apps/server/src/agent/config/skill-injection.ts`:

```ts
import type { AgentMessage } from "@sakti-code/agent";
import type { Skill } from "@sakti-code/agent";

/**
 * Build the synthetic `[assistant tool_call, tool_result]` pair that
 * force-loads a skill's SKILL.md as if the agent had called `read` itself.
 *
 * The pair is prepended to the user's first message at run start. It is
 * ephemeral (in-memory only, never persisted to DB) — re-built every run
 * from the current phase + on-disk SKILL.md content.
 *
 * The tool_call uses a stable synthetic id (`skill-read:<skillName>`) so the
 * matching tool_result can reference it deterministically.
 */
export function buildSkillInjectionMessages(skill: Skill | undefined): AgentMessage[] {
  if (!skill) return [];

  const toolCallId = `skill-read:${skill.name}`;
  const args = JSON.stringify({ filePath: skill.filePath });

  const assistantMessage = {
    role: "assistant" as const,
    content: "",
    tool_calls: [
      {
        id: toolCallId,
        type: "function" as const,
        function: {
          name: "read",
          arguments: args,
        },
      },
    ],
    timestamp: Date.now(),
  };

  const toolResultMessage = {
    role: "tool" as const,
    tool_call_id: toolCallId,
    content: skill.content,
    timestamp: Date.now() + 1,
  };

  return [assistantMessage, toolResultMessage] as unknown as AgentMessage[];
}
```

**Note:** The exact `AgentMessage` shape may need adjustment based on the actual type definition. During implementation, run `vp check` and adapt the casts to satisfy the type system. The structural intent — assistant tool_call + matching tool_result with skill content — is what matters.

**Step 5: Run test to verify it passes**

```bash
vp run '@sakti-code/server#test' -- skill-injection.test
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/server/src/agent/config/skill-injection.ts apps/server/src/agent/config/__tests__/skill-injection.test.ts
git commit -m "feat(server): buildSkillInjectionMessages — synthetic read(SKILL.md)"
```

---

### Task 3.3: Add `initialMessages` field to AgentRunDeps

Extend the agent-run contract so the server can pass synthetic priming messages that get prepended before the first user message.

**Files:**

- Modify: `packages/agent/src/runner/agent-run.ts`
- Modify: `packages/agent/src/agent/agent-harness.ts` (add `injectMessages` method)
- Test: `packages/agent/src/agent/__tests__/agent-harness-inject.test.ts` (new)

**Step 1: Read existing harness test patterns**

```bash
cat packages/agent/src/agent/__tests__/agent-harness.test.ts | head -100
```

Note how the harness is constructed in tests (mock LLM stream, fake session storage, etc.).

**Step 2: Write failing test**

Create `packages/agent/src/agent/__tests__/agent-harness-inject.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
// Import the harness constructor + fake helpers used in agent-harness.test.ts

describe("AgentHarness.injectMessages", () => {
  it("prepends messages to the next turn via nextTurnQueue", async () => {
    // Build a harness with a mock stream that captures the messages array
    // sent to the LLM. Call injectMessages([...]) then prompt("hi").
    // Assert the LLM received [injectedMsg, userMsg].
  });

  it("is a no-op when messages array is empty", async () => {
    // injectMessages([]) should not alter the next turn.
  });
});
```

(The exact harness setup is non-trivial — copy the bootstrap from `agent-harness.test.ts` and adapt. If too heavy for a unit test, defer to an integration test in Task 5.2 that exercises the full runner.)

**Step 3: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- agent-harness-inject.test
```

Expected: FAIL — method doesn't exist.

**Step 4: Add injectMessages to harness**

Edit `packages/agent/src/agent/agent-harness.ts`. Find the `nextTurn` method (around line 1293) and add a sibling:

```ts
/**
 * Push raw AgentMessages onto the nextTurnQueue. They will be prepended
 * (in order) before the next user message when `executeTurnEffect` runs.
 *
 * Used for ephemeral priming like the forced skill injection (synthetic
 * read(SKILL.md) tool-call + result) — never persisted to DB.
 *
 * Unlike `nextTurn` (which wraps text as a user message), this accepts
 * arbitrary AgentMessage shapes (assistant tool_calls, tool results, etc.).
 */
injectMessages(messages: AgentMessage[]): void {
  for (const msg of messages) {
    this.nextTurnQueue.push(msg);
  }
}
```

**Step 5: Add initialMessages to AgentRunDeps**

Edit `packages/agent/src/runner/agent-run.ts`. Add to the `AgentRunDeps` interface (after `message`):

```ts
/**
 * Ephemeral priming messages prepended to the first turn (via
 * `harness.injectMessages`). Used for forced skill injection: a synthetic
 * `read(SKILL.md)` tool-call + result so the agent starts its first real
 * turn with the phase's skill content already in context.
 *
 * Never persisted to DB — rebuilt every run from the current phase.
 */
readonly initialMessages?: AgentMessage[];
```

**Step 6: Drain initialMessages in runAgentRunEffect**

In `runAgentRunEffect` (`packages/agent/src/runner/agent-run.ts`), after the harness is constructed and before `planFirstTurn` runs, add:

```ts
if (deps.initialMessages && deps.initialMessages.length > 0) {
  harness.injectMessages(deps.initialMessages);
}
```

Place this in the gen body — find the right spot by reading the existing flow. It should be after the OM engine wiring but before the first `promptEffect` call.

**Step 7: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- agent-harness-inject.test
```

Expected: PASS.

**Step 8: Run all agent tests**

```bash
vp run '@sakti-code/agent#test'
```

Expected: PASS — no regressions.

**Step 9: Commit**

```bash
git add packages/agent/src/runner/agent-run.ts packages/agent/src/agent/agent-harness.ts packages/agent/src/agent/__tests__/agent-harness-inject.test.ts
git commit -m "feat(agent): initialMessages on AgentRunDeps + harness.injectMessages"
```

---

### Task 3.4: Server-side skill injection wiring

Tie it together: at `runPromptEffect` time, look up the phase skill, build the injection messages, pass them to `runAgentRunEffect`.

**Files:**

- Modify: `apps/server/src/agent/runner.ts`
- Modify: `apps/server/src/agent/config/index.ts` (re-export new modules)
- Test: `apps/server/src/agent/__tests__/runner.test.ts`

**Step 1: Read runner.test.ts to understand existing test bootstrap**

```bash
cat apps/server/src/agent/__tests__/runner.test.ts | head -100
cat apps/server/src/agent/__tests__/helpers.ts
```

**Step 2: Write failing test**

Add a test that verifies the runner builds and passes `initialMessages` when the session is in a phase with a builtin skill. Since `runPromptEffect` is heavy to test end-to-end, test the _message-building_ step in isolation first, then add an integration smoke test.

Append to `apps/server/src/agent/__tests__/runner.test.ts` (or a new file `runner-skill-injection.test.ts`):

```ts
import { describe, expect, it, vi } from "vite-plus/test";
import { buildSkillInjectionMessages } from "../config/skill-injection.ts";
import { getBuiltinSkillForPhase } from "../config/phase-skills.ts";
import type { Skill } from "@sakti-code/agent";

describe("runner skill injection (unit)", () => {
  it("builds initialMessages for the build phase", () => {
    const skillName = getBuiltinSkillForPhase("building");
    expect(skillName).toBe("sakti-build");

    const skill: Skill = {
      name: "sakti-build",
      description: "...",
      content: "# Sakti Build\n...",
      filePath: "/path/to/sakti-build/SKILL.md",
    };
    const msgs = buildSkillInjectionMessages(skill);
    expect(msgs).toHaveLength(2);
  });

  it("builds empty initialMessages when skill is not found", () => {
    const skill = undefined;
    const msgs = buildSkillInjectionMessages(skill);
    expect(msgs).toEqual([]);
  });

  it("builds empty initialMessages when phase has no builtin skill", () => {
    // For example, a custom phase that doesn't map
    const skillName = getBuiltinSkillForPhase("custom-phase");
    expect(skillName).toBeUndefined();
  });
});
```

**Step 3: Run test to verify it passes (it should — these are pure functions)**

```bash
vp run '@sakti-code/server#test' -- runner-skill-injection.test
```

Expected: PASS (the units are already implemented in Tasks 3.1/3.2). This test documents the integration contract.

**Step 4: Wire into runPromptEffect**

Edit `apps/server/src/agent/runner.ts`. In `runPromptEffect` (line 286+), after `loadedContext` is loaded (around line 344) and the agent is resolved (line 350+), add:

```ts
// Force-inject the phase's builtin skill (ephemeral, never persisted).
// Built by looking up the current phase (from session status / kind) →
// builtin skill name → Skill object from loadedContext.skills.
const phaseKey = session.kind === "plan" ? "plan" : session.status;
const builtinSkillName = getBuiltinSkillForPhase(phaseKey);
const phaseSkill =
  builtinSkillName !== undefined
    ? loadedContext.skills.find((s) => s.name === builtinSkillName)
    : undefined;
const initialMessages = buildSkillInjectionMessages(phaseSkill);
```

Then pass `initialMessages` to `runAgentRunEffect`:

```ts
yield *
  runAgentRunEffect({
    harness,
    sessionShape,
    storage,
    message,
    // ...all existing fields...
    ...(initialMessages.length > 0 ? { initialMessages } : {}),
  });
```

Add the imports at the top:

```ts
import { buildSkillInjectionMessages } from "./config/skill-injection.ts";
import { getBuiltinSkillForPhase } from "./config/phase-skills.ts";
```

And re-export from `config/index.ts`:

```ts
export { buildSkillInjectionMessages } from "./skill-injection.ts";
export {
  BUILTIN_SKILL_NAMES,
  getBuiltinSkillForPhase,
  isBuiltinSkillName,
} from "./phase-skills.ts";
```

**Step 5: Run full server test suite**

```bash
vp run '@sakti-code/server#test'
```

Expected: PASS. Existing tests should not regress (skill injection is additive).

**Step 6: Run typecheck + lint**

```bash
vp check
```

Expected: 0 warnings, 0 errors.

**Step 7: Commit**

```bash
git add apps/server/src/agent/runner.ts apps/server/src/agent/config/index.ts apps/server/src/agent/__tests__/runner-skill-injection.test.ts
git commit -m "feat(server): wire forced skill injection at runPromptEffect start"
```

---

## Part 4: Observer Filter

Exclude skill content (the synthetic read tool-results and any agent-initiated reads of skill files) from the observer's input. The filter is path-based and configurable via a new OM deps field.

### Task 4.1: Skill-content detection helper

A pure predicate that takes a message and the skill root path, returns whether the message is a `read` tool-result whose call targeted a skill file.

**Files:**

- Create: `packages/agent/src/observational-memory/skill-filter.ts`
- Test: `packages/agent/src/observational-memory/__tests__/skill-filter.test.ts`

**Step 1: Investigate AgentMessage shape for tool_calls/tool_result**

```bash
rg 'tool_call_id|tool_calls' packages/agent/src/types.ts packages/agent/src/harness-types.ts
```

Determine: how do we recover the `read` call's `filePath` argument from a tool-result message? The tool_call lives on the preceding assistant message; the tool-result references it by `tool_call_id`. We may need to pass both the assistant message and the tool message, or pre-compute a map.

**Step 2: Write failing test**

Create `packages/agent/src/observational-memory/__tests__/skill-filter.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { isSkillContentMessage } from "../skill-filter.ts";

const SKILL_ROOT = "/home/.sakti/agent/skills";

describe("isSkillContentMessage", () => {
  it("returns false when skillRoot is undefined (filter disabled)", () => {
    const msg = { role: "tool", content: "x", tool_call_id: "abc" };
    expect(isSkillContentMessage(msg, undefined)).toBe(false);
  });

  it("returns false for non-tool messages", () => {
    expect(isSkillContentMessage({ role: "user", content: "hi" }, SKILL_ROOT)).toBe(false);
    expect(isSkillContentMessage({ role: "assistant", content: "hi" }, SKILL_ROOT)).toBe(false);
  });

  it("returns true for a tool-result whose preceding read call targeted skillRoot", () => {
    // Construct a fake tool-result + the preceding assistant tool_call
    // The helper signature may need to accept both — design it accordingly.
    // See Task 4.1 Step 1 investigation.
  });

  it("returns false for a tool-result from a non-skill read", () => {
    // read of /src/file.ts → false
  });
});
```

**Step 3: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- skill-filter.test
```

Expected: FAIL — module not found.

**Step 4: Implement skill-filter.ts**

Create `packages/agent/src/observational-memory/skill-filter.ts`. The exact shape depends on Step 1's investigation. Sketch:

```ts
import type { AgentMessage } from "../harness-types.ts";

/**
 * Returns true when `msg` is a `tool` result whose preceding `read` tool_call
 * targeted a path inside `skillRoot`. Used by the observer to exclude skill
 * content (forced injection + agent-initiated reference reads) from observe
 * input — skill content is structural instruction, not work signal.
 *
 * Returns false when `skillRoot` is undefined (filter disabled — archive
 * phase, subagents).
 *
 * Implementation note: this predicate inspects a single message in isolation.
 * Callers that have the full message list should pre-compute a map of
 * `tool_call_id → read-filePath` from assistant messages and pass it in, OR
 * the helper accepts `(toolMsg, precedingAssistantMsg, skillRoot)`. The
 * exact signature is finalized in Step 4 based on what the observer's call
 * site makes available.
 */
export function isSkillContentMessage(msg: AgentMessage, skillRoot: string | undefined): boolean {
  if (!skillRoot) return false;
  if (msg.role !== "tool") return false;

  // TODO: recover the read-call filePath. This requires either:
  //   (a) the caller to pass a toolCallId → filePath map, OR
  //   (b) the helper to scan the surrounding messages.
  // Option (a) is cleaner — build the map at the call site (engine.ts) by
  // walking the message list once, then test each tool message against it.

  throw new Error("Not implemented — finalize signature in Step 4");
}
```

**Refined design after Step 1 investigation:** the cleanest API is a _list filter_ that takes `messages: AgentMessage[]` + `skillRoot: string | undefined` and returns the filtered list. It walks the messages once, tracks tool_call_id → filePath for `read` calls, then drops tool-results whose source path is inside skillRoot.

```ts
export function filterSkillContent(
  messages: AgentMessage[],
  skillRoot: string | undefined,
): AgentMessage[] {
  if (!skillRoot) return messages;

  // Build tool_call_id → read filePath map from assistant messages.
  const readPaths = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const calls = (
      msg as { tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }
    ).tool_calls;
    if (!calls) continue;
    for (const call of calls) {
      if (call.function.name !== "read") continue;
      try {
        const args = JSON.parse(call.function.arguments) as { filePath?: string };
        if (typeof args.filePath === "string") {
          readPaths.set(call.id, args.filePath);
        }
      } catch {
        // Malformed arguments — skip.
      }
    }
  }

  // Drop tool-results whose read path is inside skillRoot.
  return messages.filter((msg) => {
    if (msg.role !== "tool") return true;
    const toolCallId = (msg as { tool_call_id?: string }).tool_call_id;
    if (!toolCallId) return true;
    const path = readPaths.get(toolCallId);
    if (!path) return true;
    return !path.startsWith(skillRoot);
  });
}
```

Update the test to use `filterSkillContent`:

```ts
import { filterSkillContent } from "../skill-filter.ts";

// Test: filter disabled when skillRoot is undefined
// Test: drops tool-results from skill reads
// Test: keeps tool-results from non-skill reads
// Test: keeps user/assistant messages
```

**Step 5: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- skill-filter.test
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/agent/src/observational-memory/skill-filter.ts packages/agent/src/observational-memory/__tests__/skill-filter.test.ts
git commit -m "feat(agent): filterSkillContent helper for observer input"
```

---

### Task 4.2: Add `skillFilterRoot` to ObservationalMemoryDeps

Add the configuration knob. The filter is opt-in: when `skillFilterRoot` is undefined, observe behaves as today.

**Files:**

- Modify: `packages/agent/src/observational-memory/config.ts`
- Test: `packages/agent/src/observational-memory/__tests__/config.test.ts` (if exists) or inline in engine test

**Step 1: Read OM config types**

```bash
cat packages/agent/src/observational-memory/config.ts
```

Note `ObservationalMemoryDeps` shape.

**Step 2: Write failing test**

Add to a config test (or inline in `engine.test.ts`):

```ts
it("ObservationalMemoryDeps accepts skillFilterRoot", () => {
  const deps: ObservationalMemoryDeps = {
    // ...minimum required fields...
    skillFilterRoot: "/home/.sakti/agent/skills",
  };
  expect(deps.skillFilterRoot).toBe("/home/.sakti/agent/skills");
});

it("skillFilterRoot is optional (filter disabled by default)", () => {
  const deps: ObservationalMemoryDeps = {
    // ...minimum required fields...
  };
  expect(deps.skillFilterRoot).toBeUndefined();
});
```

**Step 3: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- config.test
```

Expected: FAIL — `skillFilterRoot` not on type.

**Step 4: Add the field**

Edit `packages/agent/src/observational-memory/config.ts`. Add to `ObservationalMemoryDeps`:

```ts
/**
 * When set, the observer drops any tool-result messages whose preceding
 * `read` call targeted a path inside this directory. Used to keep builtin
 * skill content (forced injection + agent-initiated reference reads) out of
 * observations — skill content is structural instruction, not work signal.
 *
 * undefined disables the filter (archive phase, subagents).
 */
readonly skillFilterRoot?: string;
```

**Step 5: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- config.test
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/agent/src/observational-memory/config.ts packages/agent/src/observational-memory/__tests__/config.test.ts
git commit -m "feat(agent): skillFilterRoot on ObservationalMemoryDeps"
```

---

### Task 4.3: Apply filter in `loadUnobservedMessageEntries`

Wire the filter into the observer's input pipeline. The cleanest point is `loadUnobservedMessageEntries` in `engine.ts` — it already filters by timestamp; we add a skill-content filter on the result.

**Files:**

- Modify: `packages/agent/src/observational-memory/engine.ts`

**Step 1: Read the current implementation**

```bash
sed -n '120,170p' packages/agent/src/observational-memory/engine.ts
```

Confirm the function shape.

**Step 2: Write failing test**

Add to `packages/agent/src/observational-memory/__tests__/engine.test.ts`:

```ts
describe("ObservationalMemoryEngine — skill filter", () => {
  it("excludes tool-results from skill reads when skillFilterRoot is set", async () => {
    // Build a storage with messages: [user, assistant(read skill), tool(skill content), user, assistant(read src), tool(src content)]
    // Set skillFilterRoot to the skill dir.
    // Run maybeObserve.
    // Assert: the observer's complete() call received only the src tool-result,
    //   not the skill tool-result. (Capture via vi.mocked(complete).mock.calls.)
  });

  it("includes all messages when skillFilterRoot is undefined", async () => {
    // Same storage; no skillFilterRoot.
    // Assert: both tool-results are in the observer input.
  });
});
```

**Step 3: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- engine.test
```

Expected: FAIL — filter not applied; both tool-results passed to observer.

**Step 4: Apply the filter**

Edit `packages/agent/src/observational-memory/engine.ts`. In `loadUnobservedMessageEntries`, after the timestamp filter, apply the skill filter to the result:

```ts
private async loadUnobservedMessageEntries(
  record: ObservationalMemoryRecord,
): Promise<MessageEntry[]> {
  const leafId = await Effect.runPromise(this.sessionStorage.getLeafId());
  const pathEntries = await Effect.runPromise(this.sessionStorage.getPathToRoot(leafId));
  const messageEntries = pathEntries.filter(
    (entry): entry is MessageEntry => entry.type === "message",
  );
  const sinceLastObserve = record.lastObservedAt === undefined
    ? messageEntries
    : messageEntries.filter((entry) => {
        const ts = entry.message.timestamp ? new Date(entry.message.timestamp) : undefined;
        return ts !== undefined && ts > record.lastObservedAt!;
      });

  // Exclude skill content (forced injection + agent reference reads) from
  // observer input. Skill content is structural instruction, not work signal.
  const skillFilterRoot = this.deps.skillFilterRoot;
  if (!skillFilterRoot) return sinceLastObserve;
  return sinceLastObserve.filter(
    (entry) => !isSkillContentEntry(entry, skillFilterRoot),
  );
}
```

Where `isSkillContentEntry` adapts `filterSkillContent`'s logic to a single `MessageEntry` given the surrounding context. **However**, since `filterSkillContent` needs the tool_call → path map (which requires scanning all messages), the cleanest path is:

- Build the map once at `loadUnobservedMessageEntries` entry (from `pathEntries`), then filter individual entries.

Alternative cleaner refactor: change `loadUnobservedMessageEntries` to delegate to a helper:

```ts
private async loadUnobservedMessageEntries(record): Promise<MessageEntry[]> {
  const leafId = await Effect.runPromise(this.sessionStorage.getLeafId());
  const pathEntries = await Effect.runPromise(this.sessionStorage.getPathToRoot(leafId));
  const messageEntries = pathEntries.filter((e): e is MessageEntry => e.type === "message");

  const sinceTs = record.lastObservedAt === undefined
    ? messageEntries
    : messageEntries.filter(byTimestampAfter(record.lastObservedAt));

  const skillRoot = this.deps.skillFilterRoot;
  if (!skillRoot) return sinceTs;

  return filterSkillContentEntries(sinceTs, skillRoot);
}
```

Implement `filterSkillContentEntries` in `skill-filter.ts` (extends Task 4.1's helper to operate on `MessageEntry[]`). Import it.

**Step 5: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- engine.test
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/agent/src/observational-memory/engine.ts packages/agent/src/observational-memory/skill-filter.ts packages/agent/src/observational-memory/__tests__/engine.test.ts
git commit -m "feat(agent): observer excludes skill content via skillFilterRoot"
```

---

### Task 4.4: Server-side filter configuration

Compute `skillFilterRoot` from the project's installed builtin skills location, and pass it to OM deps based on the current phase (off for `merged`/archive; on otherwise).

**Files:**

- Modify: `apps/server/src/agent/config/resolve-observational-memory.ts`
- Modify: `apps/server/src/agent/runner.ts` (pass it through to OM deps)
- Test: `apps/server/src/agent/config/__tests__/resolve-observational-memory.test.ts`

**Step 1: Read resolveOmConfig**

```bash
cat apps/server/src/agent/config/resolve-observational-memory.ts
```

**Step 2: Write failing test**

Append to `apps/server/src/agent/config/__tests__/resolve-observational-memory.test.ts`:

```ts
describe("resolveOmConfig — skillFilterRoot", () => {
  it("sets skillFilterRoot to the builtin skills directory for missions in building", () => {
    const ctx = makeCtx(PROFILES, {}, { getApiKey: () => "sk-test" });
    const result = resolveOmConfig(ctx, { ...SESSION, kind: "mission", status: "building" });
    expect(result?.skillFilterRoot).toBeDefined();
    expect(typeof result!.skillFilterRoot).toBe("string");
  });

  it("omits skillFilterRoot when mission status is merged (archive phase)", () => {
    const ctx = makeCtx(PROFILES, {}, { getApiKey: () => "sk-test" });
    const result = resolveOmConfig(ctx, { ...SESSION, kind: "mission", status: "merged" });
    expect(result?.skillFilterRoot).toBeUndefined();
  });

  it("sets skillFilterRoot for plan sessions", () => {
    const ctx = makeCtx(PROFILES, {}, { getApiKey: () => "sk-test" });
    const result = resolveOmConfig(ctx, { ...SESSION, kind: "plan" });
    expect(result?.skillFilterRoot).toBeDefined();
  });
});
```

**Note on SESSION shape:** `resolveOmConfig` currently takes `{ id, kind, projectId, profileId }` — `status` is not on the input. Extend the input type to include `status?: string` so we can branch on it.

**Step 3: Run test to verify it fails**

```bash
vp run '@sakti-code/server#test' -- resolve-observational-memory.test
```

Expected: FAIL.

**Step 4: Extend resolveOmConfig**

Edit `apps/server/src/agent/config/resolve-observational-memory.ts`:

4a. Extend the input type:

```ts
interface ResolveOmInput {
  id: string;
  kind: string;
  projectId: string;
  profileId: string | null;
  status?: string;
}
```

4b. Compute skillFilterRoot based on phase:

```ts
import { BUILTIN_SKILLS_RUNTIME_DIR } from "./install-builtin-skills.ts";

// Filter ON except for archive phase (status === "merged"). Plan and all
// non-merged mission statuses get the filter.
const skillFilterRoot =
  input.kind === "plan" || (input.kind === "mission" && input.status !== "merged")
    ? BUILTIN_SKILLS_RUNTIME_DIR // ~/.sakti/agent/skills — where loadAgentContext scans
    : undefined;
```

`BUILTIN_SKILLS_RUNTIME_DIR` is the runtime install location (`~/.sakti/agent/skills/`) — the same dir that `installBuiltinSkills` writes to at boot (see Task 0.2). Re-export it from `install-builtin-skills.ts`:

```ts
// apps/server/src/agent/config/install-builtin-skills.ts (add this export)
import { SAKTI_AGENT_DIR } from "../../lib/paths.ts"; // wherever ~/.sakti/agent resolves

export const BUILTIN_SKILLS_RUNTIME_DIR = join(SAKTI_AGENT_DIR, "skills");
```

(The exact import path for `SAKTI_AGENT_DIR` — find it with `rg 'SAKTI_AGENT_DIR' apps/server/src/`. The runtime dir is a single source of truth shared by both the install-at-boot sync and the skillFilterRoot config.)

4c. Pass `skillFilterRoot` into the returned config:

```ts
return {
  ...base,
  skillFilterRoot,
};
```

**Step 5: Pass `status` to resolveOmConfig in runner.ts**

Edit `apps/server/src/agent/runner.ts`. In `runPromptEffect`, update the `resolveOmConfig` call (around line 447):

```ts
const omConfig = resolveOmConfig(ctx, {
  id: sessionId,
  kind: session.kind,
  projectId: session.projectId,
  profileId: session.profileId,
  ...(session.status !== undefined ? { status: session.status } : {}),
});
```

**Step 6: Run test to verify it passes**

```bash
vp run '@sakti-code/server#test' -- resolve-observational-memory.test
```

Expected: PASS.

**Step 7: Commit**

```bash
git add apps/server/src/agent/config/resolve-observational-memory.ts apps/server/src/agent/runner.ts apps/server/src/agent/config/__tests__/resolve-observational-memory.test.ts
git commit -m "feat(server): compute skillFilterRoot from phase; pass to OM deps"
```

---

## Part 5: Integration & Verification

Wire everything together, run full suites, verify no regressions.

### Task 5.1: Update runner.ts to pass initialMessages + skillFilterRoot

Most of this was done in Tasks 3.4 and 4.4. This task is a final consistency pass.

**Files:**

- Modify: `apps/server/src/agent/runner.ts`

**Step 1: Read runner.ts around the runAgentRunEffect call**

```bash
sed -n '480,510p' apps/server/src/agent/runner.ts
```

Confirm `initialMessages` and `skillFilterRoot` are both wired through.

**Step 2: Run full server test suite**

```bash
vp run '@sakti-code/server#test'
```

Expected: PASS.

**Step 3: Run full agent test suite**

```bash
vp run '@sakti-code/agent#test'
```

Expected: PASS.

**Step 4: Run full check**

```bash
vp check
```

Expected: 0 warnings, 0 errors.

**Step 5: Commit (if any cleanup)**

```bash
git add -A
git commit -m "chore: integration pass — initialMessages + skillFilterRoot wired"
```

---

### Task 5.2: End-to-end integration test

A test that exercises the full workflow: phase lookup → skill injection messages built → passed to harness → harness prepends them to nextTurnQueue → executeTurn sees them in order.

**Files:**

- Test: `apps/server/src/agent/__tests__/workflow-integration.test.ts` (new)

**Step 1: Write integration test**

```ts
import { describe, expect, it } from "vite-plus/test";
import { getBuiltinSkillForPhase, isBuiltinSkillName } from "../config/phase-skills.ts";
import { buildSkillInjectionMessages } from "../config/skill-injection.ts";
import type { Skill } from "@sakti-code/agent";

describe("phase workflow integration", () => {
  it("for each phase, the correct skill is mapped and injection messages build correctly", () => {
    const cases: Array<{ phase: string; expectedSkill: string }> = [
      { phase: "plan", expectedSkill: "sakti-plan" },
      { phase: "specifying", expectedSkill: "sakti-design" },
      { phase: "building", expectedSkill: "sakti-build" },
      { phase: "review", expectedSkill: "sakti-verify" },
      { phase: "merged", expectedSkill: "sakti-archive" },
    ];

    for (const { phase, expectedSkill } of cases) {
      const skillName = getBuiltinSkillForPhase(phase);
      expect(skillName).toBe(expectedSkill);
      expect(isBuiltinSkillName(skillName!)).toBe(true);

      const skill: Skill = {
        name: skillName!,
        description: `${skillName} skill`,
        content: `# ${skillName}\nskill body`,
        filePath: `/skills/${skillName}/SKILL.md`,
      };
      const msgs = buildSkillInjectionMessages(skill);
      expect(msgs).toHaveLength(2);
      expect(msgs[0]!.role).toBe("assistant");
      expect(msgs[1]!.role).toBe("tool");
    }
  });

  it("unknown phase yields no injection", () => {
    expect(getBuiltinSkillForPhase("nonexistent")).toBeUndefined();
    expect(buildSkillInjectionMessages(undefined)).toEqual([]);
  });
});
```

**Step 2: Run test**

```bash
vp run '@sakti-code/server#test' -- workflow-integration.test
```

Expected: PASS.

**Step 3: Commit**

```bash
git add apps/server/src/agent/__tests__/workflow-integration.test.ts
git commit -m "test(server): end-to-end phase→skill→injection integration"
```

---

### Task 5.3: Update resolve-observational-memory.test for status field

If Task 4.4 added `status` to the input, any existing tests that construct the input may need updating.

**Files:**

- Modify: `apps/server/src/agent/config/__tests__/resolve-observational-memory.test.ts`

**Step 1: Run the existing test suite**

```bash
vp run '@sakti-code/server#test' -- resolve-observational-memory.test
```

If any tests fail due to the new `status` field, fix them.

**Step 2: Commit (if changes)**

```bash
git add apps/server/src/agent/config/__tests__/resolve-observational-memory.test.ts
git commit -m "test(server): update resolveOmConfig tests for status field"
```

---

### Task 5.4: Final full-suite verification

**Step 1: Run all tests across all packages**

```bash
vp run -r test
```

Expected: ALL PASS.

**Step 2: Run full check**

```bash
vp check
```

Expected: 0 warnings, 0 errors.

**Step 3: Manual smoke test (optional)**

Start the dev server:

```bash
vp run '@sakti-code/server#dev'
```

Create a mission session, observe:

- Build phase: skill injection happens (check via debug log)
- Status transitions: building → review (on completion) → merged (on verify-complete)
- Verify agent is edit-denied

---

## Verification Checklist

After all tasks complete:

- [ ] Builtin skills moved to `apps/server/src/agent/config/builtin-skills/`
- [ ] `packages/sakti/src/sdd/skills/` no longer exists
- [ ] `installBuiltinSkills()` runs at server bootstrap
- [ ] Runtime dir `~/.sakti/agent/skills/` contains all 5 skills after boot
- [ ] `BUILTIN_SKILLS_RUNTIME_DIR` exported and reused by `resolveOmConfig`
- [ ] `verify` agent registered with edit-denied permission
- [ ] `spec` agent removed; resolver routes specifying → build
- [ ] Resolver routes review → verify
- [ ] `ask({kind:"completion"})` approve → status=review (with forced observe)
- [ ] `ask({kind:"verify-complete"})` approve → status=merged
- [ ] spec-approve does NOT call forceReset
- [ ] completion-approve DOES call forceReset before status flip
- [ ] Phase → skill mapping covers plan/design/build/verify/archive
- [ ] Builtin skill registry contains exactly 5 names
- [ ] Skill injection messages built correctly (assistant tool_call + tool_result)
- [ ] `initialMessages` field on AgentRunDeps accepted by runAgentRunEffect
- [ ] `harness.injectMessages()` prepends to nextTurnQueue
- [ ] runner.ts builds and passes initialMessages at runPromptEffect
- [ ] `skillFilterRoot` field on ObservationalMemoryDeps
- [ ] Observer excludes skill content when skillFilterRoot is set
- [ ] skillFilterRoot is undefined for merged/archive phase
- [ ] skillFilterRoot is set for plan/design/build/verify phases
- [ ] All tests pass (`vp run -r test`)
- [ ] Full check clean (`vp check`)

---

## Notes for the Implementer

- **TDD is mandatory.** Every task above follows RED → GREEN → COMMIT. Do not skip the "watch it fail" step.
- **Use `vp check --fix` after each task** to catch formatting/lint issues early.
- **Run the specific package test** during each task (`vp run '@sakti-code/<pkg>#test' -- <pattern>`), then the full suite at the end.
- **Exact code in this plan may need minor adjustments** based on actual type definitions discovered during implementation. The structural intent is canonical; the syntax adapts.
- **When in doubt about a file path or type**, run `rg` to verify before writing the test.
- **Frequent commits.** Each task ends with a commit. Don't batch multiple tasks into one commit.
- **If a test surprisingly passes on first run** (RED didn't fire), you're testing existing behavior. Rethink the test.
