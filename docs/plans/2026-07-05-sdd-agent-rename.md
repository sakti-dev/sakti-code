# SDD Agent Rename: `intake`→`plan`, `plan`→`spec` — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename the pre-mission chat agent from `intake` to `plan`, and the mission planning agent from `plan` to `spec`, across the entire codebase (agents, prompts, DB, API, UI, config).

**Architecture:** A two-phase swap rename. Phase 1 frees the `plan` name by renaming the current mission-planning agent `plan`→`spec`. Phase 2 takes the freed `plan` name for the pre-mission agent `intake`→`plan`. Each layer (server config, DB, API, stores, components) is updated in dependency order. Existing data is migrated via a Drizzle SQL migration (kind/status backfill) and a one-time profiles.json key-rename migration.

**Tech Stack:** TypeScript, Hono, Drizzle ORM (node:sqlite), SolidJS, Electron, vitest, pnpm/vite-plus.

**Critical constraint:** The rename MUST happen in order — `plan`→`spec` FIRST, then `intake`→`plan`. Doing it in reverse causes name collisions (two things named `plan`).

**Test commands:**

- Server single file: `vp run '@sakti-code/server#test' src/path/to/test.test.ts`
- Server all: `vp run '@sakti-code/server#test'`
- Agent all: `vp run '@sakti-code/agent#test'`
- DB all: `vp run '@sakti-code/db#test'`
- Desktop single file: `vp run desktop#test src/path/to/test.test.tsx`
- Desktop all: `vp run desktop#test`
- Everything: `vp run -r test`
- Lint+typecheck: `vp check --fix`

---

## Phase 1: Rename mission planner `plan` → `spec`

This frees the name `plan` so Phase 2 can claim it.

### Task 1: Rename `PLAN_PROMPT` → `SPEC_PROMPT` and update the spec agent definition

**Files:**

- Modify: `apps/server/src/agent/config/prompts.ts:57-60`
- Modify: `apps/server/src/agent/config/server-agents.ts:8,43-50,100-108`
- Modify: `apps/server/src/agent/config/index.ts:11`
- Test: `apps/server/src/agent/__tests__/system-prompt-composition.test.ts`

**Step 1: Update the prompt**

In `prompts.ts`, rename the export and update the role text:

```ts
export const SPEC_PROMPT = withBase(`# Your role: Spec agent
You research the codebase thoroughly, then produce a detailed specification: numbered steps, file-level touch points, risks, and a test plan. You must not make any edits — your permission ruleset denies them. Read, search, and run commands freely to inform the spec.

When the spec is complete, call \`ask({ kind: "spec", body })\` with the full spec as \`body\`. The user reviews and approves before the mission moves to the building phase. If you need clarification first, call \`ask\` without a \`kind\`.`);
```

Delete the old `PLAN_PROMPT` export entirely.

**Step 2: Update server-agents.ts**

- Import: `PLAN_PROMPT` → `SPEC_PROMPT` (line 8)
- Rename `planRuleset()` → `specRuleset()` (lines 43-50, function name + all internal references)
- Agent definition (lines 100-108): `name: "plan"` → `name: "spec"`, `description` text update, `systemPrompt: PLAN_PROMPT` → `systemPrompt: SPEC_PROMPT`, `permission: planRuleset()` → `permission: specRuleset()`

**Step 3: Update index.ts re-export**

`PLAN_PROMPT` → `SPEC_PROMPT` in `apps/server/src/agent/config/index.ts:11`.

**Step 4: Update system-prompt-composition tests**

In `apps/server/src/agent/__tests__/system-prompt-composition.test.ts`:

- Import: `PLAN_PROMPT` → `SPEC_PROMPT`
- Test names: `"PLAN_PROMPT starts with BASE_PROMPT"` → `"SPEC_PROMPT starts with BASE_PROMPT"`, etc.
- Assertions: `expect(SPEC_PROMPT...)`, and the `ask({ kind: "spec"` substring check (was `"plan"`)

**Step 5: Run tests**

```bash
vp run '@sakti-code/server#test' src/agent/__tests__/system-prompt-composition.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add apps/server/src/agent/config/prompts.ts apps/server/src/agent/config/server-agents.ts apps/server/src/agent/config/index.ts apps/server/src/agent/__tests__/system-prompt-composition.test.ts
git commit -m "refactor(server): rename PLAN_PROMPT to SPEC_PROMPT, plan agent to spec"
```

---

### Task 2: Rename ask kind `"plan"` → `"spec"`

**Files:**

- Modify: `apps/server/src/agent/config/ask-kinds.ts:29,32,74-95,109`
- Test: `apps/server/src/agent/__tests__/persist-ask.test.ts`
- Test: `apps/server/src/routes/sessions/__tests__/confirm.test.ts`

**Step 1: Update ask-kinds.ts**

- Line 29: `AskCard` type — `"proposed-plan"` → `"proposed-spec"`
- Line 32: `AskKind` type — `"session" | "plan" | "completion"` → `"session" | "spec" | "completion"`
- Lines 74-95: Rename the `plan:` key to `spec:` in the `ASK_KINDS` record. Update `card: "proposed-plan"` → `card: "proposed-spec"`. Update all comments: "plan" → "spec", "planning" → "specifying"
- Line 109: `isKnownAskKind` — `kind === "plan"` → `kind === "spec"`

**Step 2: Update persist-ask tests**

In `apps/server/src/agent/__tests__/persist-ask.test.ts`, replace all `kind: "plan"` with `kind: "spec"` in the test fixtures and assertions (lines ~52, 58, 89).

**Step 3: Update confirm tests**

In `apps/server/src/routes/sessions/__tests__/confirm.test.ts`, replace `{ action: "approve", kind: "plan", body: "the plan" }` with `kind: "spec"` (lines ~17, 81, 99).

**Step 4: Run tests**

```bash
vp run '@sakti-code/server#test' src/agent/__tests__/persist-ask.test.ts src/routes/sessions/__tests__/confirm.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/agent/config/ask-kinds.ts apps/server/src/agent/__tests__/persist-ask.test.ts apps/server/src/routes/sessions/__tests__/confirm.test.ts
git commit -m "refactor(server): rename ask kind plan to spec"
```

---

### Task 3: Update resolve-agent routing (`status: "planning"` → `"specifying"`, `name: "plan"` → `"spec"`)

**Files:**

- Modify: `apps/server/src/agent/config/resolve-agent.ts:29,49-52`
- Test: `apps/server/src/agent/config/__tests__/resolve-agent.test.ts`

**Step 1: Update resolve-agent.ts**

- Line 29 (JSDoc): `planning phase → plan agent` → `specifying phase → spec agent`
- Line 51: `status === "planning"` → `status === "specifying"`
- Line 52: `name = "plan"` → `name = "spec"`

**Step 2: Update resolve-agent tests**

In `apps/server/src/agent/config/__tests__/resolve-agent.test.ts`:

- Test names: `"mission + status='planning' → plan agent"` → `"mission + status='specifying' → spec agent"`
- Fixtures: `resolveSessionAgentForKind("mission", [], undefined, "planning")` → `"specifying"`
- Assertions: `expect(agent.name).toBe("plan")` → `toBe("spec")`

**Step 3: Run tests**

```bash
vp run '@sakti-code/server#test' src/agent/config/__tests__/resolve-agent.test.ts
```

Expected: PASS

**Step 4: Commit**

```bash
git add apps/server/src/agent/config/resolve-agent.ts apps/server/src/agent/config/__tests__/resolve-agent.test.ts
git commit -m "refactor(server): rename planning status to specifying, plan routing to spec"
```

---

### Task 4: Update runner.ts comments and force-reset.ts comments

**Files:**

- Modify: `apps/server/src/agent/runner.ts` (comments referencing "planning"/"plan agent")
- Modify: `apps/server/src/agent/config/force-reset.ts` (comments referencing "plan→build")
- Modify: `apps/server/src/agent/config/ask-kinds.ts` (remaining comments: "planning" → "specifying", "intake graduation" → keep for now, will change in Phase 2)

**Step 1: Search and update comments**

Run: `rg -n "planning|plan agent|plan→build|plan→" apps/server/src/agent/ --type ts`

Update all comments that reference the old agent/status names. Logic (string comparisons) was already updated in Tasks 2-3; this is purely comment cleanup.

**Step 2: Run full server test suite**

```bash
vp run '@sakti-code/server#test'
```

Expected: All pass (no logic changes, just comments)

**Step 3: Commit**

```bash
git add apps/server/src/agent/
git commit -m "refactor(server): update comments for plan→spec, planning→specifying rename"
```

---

## Phase 2: Rename pre-mission agent `intake` → `plan`

### Task 5: Rename `INTAKE_SYSTEM_PROMPT` → `PLAN_PROMPT` and update the plan agent definition

**Files:**

- Modify: `apps/server/src/agent/config/prompts.ts:70-84`
- Modify: `apps/server/src/agent/config/server-agents.ts:7,52-60,118-136`
- Modify: `apps/server/src/agent/config/index.ts:10`
- Test: `apps/server/src/agent/__tests__/system-prompt-composition.test.ts`

**Step 1: Update the prompt**

In `prompts.ts`, rename `INTAKE_SYSTEM_PROMPT` → `PLAN_PROMPT` and update the role text:

```ts
export const PLAN_PROMPT = withBase(`# Your role: Plan agent
You are a product manager who helps users plan work before a mission session is created.

Your role:
- Discuss new features, bug fixes, and improvements with the user
- Research the codebase to understand feasibility and impact
- Write rough change-request documents (markdown) when needed
- When the product plan is agreed, call \`ask({ kind: "session", body })\`

When calling \`ask({ kind: "session", body })\`:
- \`body\` is a self-contained mission brief that a fresh agent can act on with no prior context
- Include: what to build, why, key files/constraints discovered, and the rough plan
- \`body\` becomes the mission's first prompt — make it count

After calling \`ask\`, your turn ends. The user confirms or asks for revisions.`);
```

**Step 2: Update server-agents.ts**

- Import: `INTAKE_SYSTEM_PROMPT` → `PLAN_PROMPT` (line 7)
- Rename `intakeRuleset()` → `planRuleset()` (lines 52-60)
- Agent definition (lines 118-136): `name: "intake"` → `name: "plan"`, `description` text, `systemPrompt: INTAKE_SYSTEM_PROMPT` → `PLAN_PROMPT`, `permission: intakeRuleset()` → `planRuleset()`

**Step 3: Update index.ts re-export**

`INTAKE_SYSTEM_PROMPT` → `PLAN_PROMPT` in `apps/server/src/agent/config/index.ts:10`.

**Step 4: Update system-prompt-composition tests**

- Import: `INTAKE_SYSTEM_PROMPT` → `PLAN_PROMPT`
- Test assertions: `expect(PLAN_PROMPT...)`, substring `"Plan agent"` (was `"Intake agent"`)

**Step 5: Run tests**

```bash
vp run '@sakti-code/server#test' src/agent/__tests__/system-prompt-composition.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add apps/server/src/agent/config/prompts.ts apps/server/src/agent/config/server-agents.ts apps/server/src/agent/config/index.ts apps/server/src/agent/__tests__/system-prompt-composition.test.ts
git commit -m "refactor(server): rename INTAKE_SYSTEM_PROMPT to PLAN_PROMPT, intake agent to plan"
```

---

### Task 6: Update resolve-agent, graduation, confirm, resolve-observational-memory for `intake` → `plan`

**Files:**

- Modify: `apps/server/src/agent/config/resolve-agent.ts:49-50` (`kind === "intake"` → `kind === "plan"`, `name = "intake"` → `name = "plan"`)
- Modify: `apps/server/src/agent/config/resolve-observational-memory.ts:64` (`session.kind === "intake"` → `"plan"`)
- Modify: `apps/server/src/agent/config/graduation.ts` (comments + log messages: "intake graduation" → "plan graduation")
- Modify: `apps/server/src/routes/sessions/confirm.ts:38` (`existing.kind === "intake"` → `"plan"`)
- Modify: `apps/server/src/agent/config/ask-kinds.ts` (comments: "intake" → "plan", log msg "intake graduation" → "plan graduation")
- Test: `apps/server/src/agent/config/__tests__/resolve-agent.test.ts`
- Test: `apps/server/src/agent/__tests__/model-resolver.test.ts`

**Step 1: Update resolve-agent.ts**

- Line 49: `kind === "intake"` → `kind === "plan"`
- Line 50: `name = "intake"` → `name = "plan"`
- Update JSDoc comments (lines 29-38): "intake kind" → "plan kind", "intake agent" → "plan agent"

**Step 2: Update resolve-observational-memory.ts**

- Line 64: `session.kind === "intake"` → `session.kind === "plan"`
- Comments (lines 61-63): "Intake children" → "Plan children", "main intake's memory" → "main plan's memory"

**Step 3: Update graduation.ts**

- Line 38: `"intake graduation: OM not configured, skipping"` → `"plan graduation: OM not configured, skipping"`
- Line 63: `"intake graduation: reflected child into project OM"` → `"plan graduation: reflected child into project OM"`
- Line 68: `"intake graduation failed (continuing)"` → `"plan graduation failed (continuing)"`
- JSDoc (lines 8-24): "intake-graduation" → "plan-graduation", "child intake" → "child plan", "intake sessions" → "plan sessions"

**Step 4: Update confirm.ts**

- Line 35: comment "intake children" → "plan children"
- Line 38: `existing.kind === "intake"` → `existing.kind === "plan"`

**Step 5: Update ask-kinds.ts comments**

- Line 48: "intake hands off" → "plan hands off"
- Line 60: "Graduate the child intake's transcript" → "Graduate the child plan's transcript"
- Line 67: `"intake graduation failed (continuing)"` → `"plan graduation failed (continuing)"`

**Step 6: Update resolve-agent tests**

- `resolveSessionAgentForKind("intake", [])` → `resolveSessionAgentForKind("plan", [])`
- `expect(agent.name).toBe("intake")` → `toBe("plan")`
- Test names: "intake kind" → "plan kind"

**Step 7: Update model-resolver tests**

In `apps/server/src/agent/__tests__/model-resolver.test.ts`:

- `kind: "intake"` → `kind: "plan"` in fixtures
- `"resolves intake model"` → `"resolves plan model"` in test names
- Profile fixtures: `intake: {…}` → `plan: {…}` (this is the profile mode key; will be formally renamed in Task 8 but update here to keep tests passing)

**Step 8: Run server tests**

```bash
vp run '@sakti-code/server#test'
```

Expected: All pass

**Step 9: Commit**

```bash
git add apps/server/src/agent/config/resolve-agent.ts apps/server/src/agent/config/resolve-observational-memory.ts apps/server/src/agent/config/graduation.ts apps/server/src/routes/sessions/confirm.ts apps/server/src/agent/config/ask-kinds.ts apps/server/src/agent/config/__tests__/resolve-agent.test.ts apps/server/src/agent/__tests__/model-resolver.test.ts
git commit -m "refactor(server): rename intake kind to plan across routing, graduation, OM"
```

---

## Phase 3: Profile modes + DB

### Task 7: Rename profile modes (`intake` → `plan`, `plan` → `spec`)

**Files:**

- Modify: `apps/server/src/lib/kind-to-mode.ts:1,10-11`
- Modify: `apps/server/src/lib/profile-resolver.ts:37`
- Modify: `apps/server/src/lib/profiles-store.ts:13-20,54-63`
- Test: `apps/server/src/lib/__tests__/kind-to-mode.test.ts`
- Test: `apps/server/src/agent/__tests__/model-resolver.test.ts` (profile fixtures with mode keys)

**Step 1: Update kind-to-mode.ts**

```ts
export type ProfileMode = "build" | "default" | "plan" | "observe" | "reflect" | "spec";
```

Switch cases:

```ts
case "plan":
  return "plan";
case "spec":
  return "spec";
```

(Old `case "intake": return "intake"` → `case "plan": return "plan"`, old `case "plan": return "plan"` → `case "spec": return "spec"`)

**Step 2: Update profile-resolver.ts**

Line 37: mode param type — `"intake"` → `"plan"`, `"plan"` → `"spec"`

**Step 3: Update profiles-store.ts**

- Schema (lines 13-20): `intake: Type.Optional(...)` → `plan: Type.Optional(...)`, old `plan:` → `spec:`
- Interface (lines 54-63): `intake?: ModelRef` → `plan?: ModelRef`, old `plan?` → `spec?`

**Step 4: Update kind-to-mode tests**

In `apps/server/src/lib/__tests__/kind-to-mode.test.ts`:

- `"maps 'intake' to 'intake'"` → `"maps 'plan' to 'plan'"` with `kindToMode("plan")`
- Add/Update test: `"maps 'spec' to 'spec'"` (if there was a plan→plan test before, it becomes spec→spec)

**Step 5: Update model-resolver tests**

Any remaining profile fixtures with `intake:` or `plan:` mode keys → `plan:` or `spec:` respectively.

**Step 6: Run tests**

```bash
vp run '@sakti-code/server#test' src/lib/__tests__/kind-to-mode.test.ts src/agent/__tests__/model-resolver.test.ts
```

Expected: PASS

**Step 7: Commit**

```bash
git add apps/server/src/lib/kind-to-mode.ts apps/server/src/lib/profile-resolver.ts apps/server/src/lib/profiles-store.ts apps/server/src/lib/__tests__/kind-to-mode.test.ts apps/server/src/agent/__tests__/model-resolver.test.ts
git commit -m "refactor(server): rename profile modes intake→plan, plan→spec"
```

---

### Task 8: DB schema defaults + migration

**Files:**

- Modify: `packages/db/src/schema.ts:22-25`
- Modify: `packages/db/src/repos/index.ts:101-107` (rename `listChildIntakesByProject` → `listChildPlansByProject`, filter `kind: "intake"` → `"plan"`)
- Create: migration SQL (via drizzle-kit generate + manual backfill)
- Test: `packages/db/src/__tests__/sessions-kind.test.ts`
- Test: `packages/db/src/__tests__/sessions-status.test.ts`

**Step 1: Update schema.ts**

```ts
// SDD task lifecycle: specifying → building → review → merged.
// Plan sessions are unaffected; only mission sessions use this column.
status: text("status").notNull().default("specifying"),
```

(Kind default stays `"mission"` — only the comment changes.)

**Step 2: Update repos/index.ts**

Rename method:

```ts
listChildPlansByProject(projectId: string) {
  return this.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.projectId, projectId), eq(sessions.kind, "plan")))
    .orderBy(desc(sessions.createdAt))
    .all();
}
```

**Step 3: Generate Drizzle migration**

```bash
vp run '@sakti-code/db#db:generate'
```

This creates a new migration folder under `packages/db/migrations/` with a SQL file that changes the default. **Open the generated SQL** and append the backfill statements:

```sql
-- Backfill: intake → plan, planning → specifying
UPDATE sessions SET kind = 'plan' WHERE kind = 'intake';
UPDATE sessions SET status = 'specifying' WHERE status = 'planning';
```

**Step 4: Update sessions-kind tests**

In `packages/db/src/__tests__/sessions-kind.test.ts`:

- `kind: "intake"` → `kind: "plan"` in fixtures
- `listChildIntakesByProject` → `listChildPlansByProject`
- Variable names `intakeA`/`intakeB` → `planA`/`planB`

**Step 5: Update sessions-status tests**

In `packages/db/src/__tests__/sessions-status.test.ts`:

- `"planning"` → `"specifying"` in fixtures and assertions

**Step 6: Run DB tests**

```bash
vp run '@sakti-code/db#test'
```

Expected: PASS

**Step 7: Commit**

```bash
git add packages/db/
git commit -m "refactor(db): rename intake→plan kind, planning→specifying status, add migration"
```

---

### Task 9: Config migration for profiles.json key rename

**Files:**

- Create: `apps/server/src/lib/profile-key-migration.ts`
- Create: `apps/server/src/lib/__tests__/profile-key-migration.test.ts`
- Modify: `apps/server/src/lib/config-migration.ts` (call the new migration after seeding profiles)

**Step 1: Write the failing test**

```ts
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vite-plus/test";
import { migrateProfileKeys } from "../profile-key-migration.ts";

describe("migrateProfileKeys", () => {
  it("renames intake→plan and plan→spec in models", () => {
    const dir = mkdtempSync(join(tmpdir(), "sakti-test-"));
    const path = join(dir, "profiles.json");
    writeFileSync(
      path,
      JSON.stringify({
        defaultProfile: "default",
        profiles: {
          default: {
            name: "Default",
            models: {
              default: { provider: "p", model: "m" },
              intake: { provider: "p", model: "i" },
              plan: { provider: "p", model: "pl" },
            },
          },
        },
      }),
    );

    migrateProfileKeys(path);

    const result = JSON.parse(readFileSync(path, "utf-8"));
    expect(result.profiles.default.models.plan).toEqual({ provider: "p", model: "i" });
    expect(result.profiles.default.models.spec).toEqual({ provider: "p", model: "pl" });
    expect(result.profiles.default.models.intake).toBeUndefined();
  });

  it("is idempotent (running twice is safe)", () => {
    const dir = mkdtempSync(join(tmpdir(), "sakti-test-"));
    const path = join(dir, "profiles.json");
    writeFileSync(
      path,
      JSON.stringify({
        defaultProfile: "default",
        profiles: { default: { name: "D", models: { default: { provider: "p", model: "m" } } } },
      }),
    );

    migrateProfileKeys(path);
    migrateProfileKeys(path); // no crash, no change

    const result = JSON.parse(readFileSync(path, "utf-8"));
    expect(result.profiles.default.models.default).toEqual({ provider: "p", model: "m" });
  });

  it("skips when file is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "sakti-test-"));
    expect(() => migrateProfileKeys(join(dir, "nonexistent.json"))).not.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
vp run '@sakti-code/server#test' src/lib/__tests__/profile-key-migration.test.ts
```

Expected: FAIL (module not found)

**Step 3: Implement migrateProfileKeys**

```ts
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

/**
 * One-time migration: rename profile mode keys in profiles.json.
 * `intake` → `plan`, `plan` → `spec` (the old mission-planning mode).
 * Order matters: rename `plan`→`spec` first to avoid collision.
 * Idempotent — safe to call multiple times.
 */
export function migrateProfileKeys(filePath: string): void {
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(content) as {
    profiles: Record<string, { models: Record<string, unknown> }>;
  };

  let changed = false;
  for (const profile of Object.values(parsed.profiles)) {
    const models = profile.models;
    // plan → spec FIRST (frees the "plan" key)
    if ("plan" in models && !("spec" in models)) {
      models.spec = models.plan;
      delete models.plan;
      changed = true;
    }
    // intake → plan
    if ("intake" in models && !("plan" in models)) {
      models.plan = models.intake;
      delete models.intake;
      changed = true;
    }
  }

  if (changed) {
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(parsed, null, 2), "utf-8");
    renameSync(tmp, filePath);
  }
}
```

**Step 4: Run test to verify it passes**

```bash
vp run '@sakti-code/server#test' src/lib/__tests__/profile-key-migration.test.ts
```

Expected: PASS

**Step 5: Wire into config-migration.ts**

In `apps/server/src/lib/config-migration.ts`, after Step 2 (seed profiles), add:

```ts
// Step 2b: migrate profile mode keys (intake→plan, plan→spec)
migrateProfileKeys(deps.profilesPath);
```

Import `migrateProfileKeys` from `./profile-key-migration.ts`. This runs every startup but is idempotent (no-op if already migrated).

**Step 6: Run full server tests**

```bash
vp run '@sakti-code/server#test'
```

Expected: PASS

**Step 7: Commit**

```bash
git add apps/server/src/lib/profile-key-migration.ts apps/server/src/lib/__tests__/profile-key-migration.test.ts apps/server/src/lib/config-migration.ts
git commit -m "feat(server): add profiles.json key migration (intake→plan, plan→spec)"
```

---

## Phase 4: REST API

### Task 10: Rename intake-session routes → plan-session routes

**Files:**

- Rename: `apps/server/src/routes/projects/intake-session.ts` → `apps/server/src/routes/projects/plan-session.ts`
- Modify: `apps/server/src/app.ts:12,36`
- Test: Rename `apps/server/src/__tests__/intake-session.test.ts` → `apps/server/src/__tests__/plan-session.test.ts`

**Step 1: Rename the route file and update contents**

`git mv apps/server/src/routes/projects/intake-session.ts apps/server/src/routes/projects/plan-session.ts`

In the new file:

- `intakeSessionRoutes` → `planSessionRoutes`
- Route paths: `/:id/intake-session` → `/:id/plan-session`, `/:id/intake-sessions` → `/:id/plan-sessions`
- `kind: "intake"` → `kind: "plan"`
- `title: "Intake"` → `title: "Plan"`
- Comments: "child intake" → "child plan"
- `listChildIntakesByProject` → `listChildPlansByProject`

**Step 2: Update app.ts**

- Import: `intakeSessionRoutes` from `./routes/projects/intake-session` → `planSessionRoutes` from `./routes/projects/plan-session`
- Route mount: `.route("/", intakeSessionRoutes)` → `.route("/", planSessionRoutes)`

**Step 3: Rename and update the test file**

`git mv apps/server/src/__tests__/intake-session.test.ts apps/server/src/__tests__/plan-session.test.ts`

Update all references:

- Route paths in test calls
- `kind === "intake"` → `kind === "plan"`
- `title === "Intake"` → `title === "Plan"`

**Step 4: Run tests**

```bash
vp run '@sakti-code/server#test' src/__tests__/plan-session.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/routes/projects/plan-session.ts apps/server/src/app.ts apps/server/src/__tests__/plan-session.test.ts
git commit -m "refactor(server): rename intake-session routes to plan-session"
```

---

### Task 11: Update forking test + runner comments

**Files:**

- Modify: `apps/server/src/__tests__/forking.test.ts:56,60,71` (`kind: "intake"` → `"plan"`)
- Modify: `apps/server/src/agent/runner.ts` (comments referencing "intake")

**Step 1: Update forking test**

Replace `kind: "intake"` → `kind: "plan"` and `expect(forked.kind).toBe("intake")` → `toBe("plan")`.

**Step 2: Update runner.ts comments**

Run: `rg -n "intake|Intake" apps/server/src/agent/runner.ts`

Update all comments. The logic was already updated in previous tasks.

**Step 3: Run full server suite**

```bash
vp run '@sakti-code/server#test'
```

Expected: PASS

**Step 4: Commit**

```bash
git add apps/server/src/__tests__/forking.test.ts apps/server/src/agent/runner.ts
git commit -m "refactor(server): update remaining intake references in tests and comments"
```

---

## Phase 5: Packages/tools

### Task 12: Update ask tool description

**Files:**

- Modify: `packages/tools/src/ask/index.ts:8,13`

**Step 1: Update the tool description**

```ts
// Line 8: "Known kinds (session/spec/completion)…"
// Line 13: "a detailed spec (kind=spec)"
```

Replace all occurrences of `plan` with `spec` in the description text (this is the ask tool's description that tells the LLM what kinds it can use).

**Step 2: Run tools tests**

```bash
vp run '@sakti-code/tools#test'
```

Expected: PASS

**Step 3: Commit**

```bash
git add packages/tools/src/ask/index.ts
git commit -m "refactor(tools): update ask tool description plan→spec"
```

---

## Phase 6: Desktop stores

### Task 13: Update desktop store types and actions

**Files:**

- Modify: `apps/desktop/src/stores/server/server-store.ts:14,17,20`
- Modify: `apps/desktop/src/stores/server/actions.ts:48-49,114-147`
- Modify: `apps/desktop/src/stores/workspace/session-tab-store.ts:3,104,114`
- Modify: `apps/desktop/src/stores/session/session-store.ts:14`
- Modify: `apps/desktop/src/stores/session/handlers/tool-events.ts:15`
- Test: `apps/desktop/src/stores/workspace/__tests__/session-tab-store.test.ts`
- Test: `apps/desktop/src/stores/server/__tests__/actions.test.ts`

**Step 1: Update server-store.ts types**

```ts
// Line 14: kind type
kind: "plan" | "mission";
// Line 17: pendingAskKind type
pendingAskKind: "session" | "spec" | "completion" | null;
// Line 20: status type
status: "specifying" | "building" | "review" | "merged";
```

**Step 2: Update actions.ts**

- `createChildIntake` → `createChildPlan` (function name + all internal refs)
- `listChildIntakes` → `listChildPlans`
- API paths: `["intake-session"]` → `["plan-session"]`, `["intake-sessions"]` → `["plan-sessions"]`
- Error messages: "Failed to create child intake" → "Failed to create child plan", "Failed to list child intakes" → "Failed to list child plans"

**Step 3: Update session-tab-store.ts**

- Line 3: `SessionTabKind = "home" | "intake" | "mission"` → `"home" | "plan" | "mission"`
- Line 104: `openDraftIntakeTab` → `openDraftPlanTab`, `kind: "intake"` → `kind: "plan"`
- Line 114: `promoteDraftIntake` → `promoteDraftPlan`, `tab.kind !== "intake"` → `tab.kind !== "plan"`

**Step 4: Update session-store.ts**

- Line 14: `PendingAsk.kind` — `"session" | "plan" | "completion"` → `"session" | "spec" | "completion"`

**Step 5: Update tool-events.ts**

- Line 15: `kind === "plan"` → `kind === "spec"` (in the ask kind guard)

**Step 6: Update session-tab-store tests**

In `apps/desktop/src/stores/workspace/__tests__/session-tab-store.test.ts`:

- `kind: "intake"` → `kind: "plan"` in all fixtures
- `openDraftIntakeTab` → `openDraftPlanTab`
- `promoteDraftIntake` → `promoteDraftPlan`
- Test names: "intake tab" → "plan tab", "draft intake" → "draft plan"

**Step 7: Update actions tests**

In `apps/desktop/src/stores/server/__tests__/actions.test.ts`:

- `createChildIntake` → `createChildPlan`, `listChildIntakes` → `listChildPlans`
- API path assertions
- `kind: "plan"` in ask confirm fixtures (was `"plan"` ask kind → now `"spec"`)
- Status fixtures: `"planning"` → `"specifying"` where present

**Step 8: Run desktop store tests**

```bash
vp run desktop#test src/stores/
```

Expected: PASS

**Step 9: Commit**

```bash
git add apps/desktop/src/stores/
git commit -m "refactor(desktop): rename intake→plan, plan→spec in stores"
```

---

## Phase 7: Desktop components

### Task 14: Rename onboarding components + update UI labels

**Files:**

- Rename: `apps/desktop/src/components/onboarding/intake-chat.tsx` → `plan-chat.tsx`
- Rename: `apps/desktop/src/components/onboarding/intake-grid.tsx` → `plan-grid.tsx`
- Rename: `apps/desktop/src/components/onboarding/intake-card.tsx` → `plan-card.tsx`
- Rename: `apps/desktop/src/components/onboarding/intake-grid.css` → `plan-grid.css`
- Rename: `apps/desktop/src/components/onboarding/__tests__/intake-chat.test.tsx` → `plan-chat.test.tsx`
- Rename: `apps/desktop/src/components/onboarding/__tests__/intake-grid.test.tsx` → `plan-grid.test.tsx`
- Modify: `apps/desktop/src/components/layout/workspace-layout.tsx`
- Modify: `apps/desktop/src/components/layout/session-tabs/session-tabs.tsx`
- Modify: `apps/desktop/src/components/layout/sidebar/sidebar.tsx`
- Modify: `apps/desktop/src/components/layout/sidebar/mission-row.tsx`
- Modify: `apps/desktop/src/components/chat-area/parts/ask-card.tsx`
- Modify: `apps/desktop/src/components/settings/tabs/models-settings/profile-editor.tsx`

**Step 1: Rename files with git mv**

```bash
git mv apps/desktop/src/components/onboarding/intake-chat.tsx apps/desktop/src/components/onboarding/plan-chat.tsx
git mv apps/desktop/src/components/onboarding/intake-grid.tsx apps/desktop/src/components/onboarding/plan-grid.tsx
git mv apps/desktop/src/components/onboarding/intake-card.tsx apps/desktop/src/components/onboarding/plan-card.tsx
git mv apps/desktop/src/components/onboarding/intake-grid.css apps/desktop/src/components/onboarding/plan-grid.css
git mv apps/desktop/src/components/onboarding/__tests__/intake-chat.test.tsx apps/desktop/src/components/onboarding/__tests__/plan-chat.test.tsx
git mv apps/desktop/src/components/onboarding/__tests__/intake-grid.test.tsx apps/desktop/src/components/onboarding/__tests__/plan-grid.test.tsx
```

**Step 2: Update plan-chat.tsx (was intake-chat.tsx)**

- `IntakeChat` → `PlanChat`, `IntakeChatProps` → `PlanChatProps`
- `createChildIntake` → `createChildPlan`
- `promoteDraftIntake` → `promoteDraftPlan`
- Local var `intakeIdx` → `planIdx`

**Step 3: Update plan-grid.tsx (was intake-grid.tsx)**

- `IntakeGrid` → `PlanGrid`, `IntakeGridProps` → `PlanGridProps`
- `listChildIntakes` → `listChildPlans`
- `handleNewIntake` → `handleNewPlan`
- `openDraftIntakeTab` → `openDraftPlanTab`
- CSS class refs: `intake-*` → `plan-*` (e.g., `intake-fade-up` → `plan-fade-up`)
- UI text: `"Start an intake to scope your next mission..."` → `"Start a plan to scope your next mission..."`, `"New intake"` → `"New plan"`, `aria-label="Start a new intake"` → `"Start a new plan"`

**Step 4: Update plan-card.tsx (was intake-card.tsx)**

- `IntakeCard` → `PlanCard`, `IntakeCardProps` → `PlanCardProps`
- UI text: `"Untitled intake"` → `"Untitled plan"`
- CSS: `intake-pending-dot` → `plan-pending-dot`

**Step 5: Update plan-grid.css (was intake-grid.css)**

Replace all `intake-` class prefixes with `plan-`.

**Step 6: Update workspace-layout.tsx**

- Imports: `IntakeChat` → `PlanChat`, `IntakeGrid` → `PlanGrid`
- `actions.listChildIntakes` → `actions.listChildPlans`
- `kind === "intake"` → `kind === "plan"`
- Component refs in JSX

**Step 7: Update session-tabs.tsx**

- Line 23: `case "intake": return "Intake"` → `case "plan": return "Plan"`
- Close tab aria-label: `"Close Intake tab"` → `"Close Plan tab"`

**Step 8: Update sidebar.tsx**

- `openDraftIntakeTab` → `openDraftPlanTab` (import + usage)

**Step 9: Update mission-row.tsx**

- `STATUS_CLASS` and `STATUS_LABEL`: `planning` key → `specifying` key (lines 14, 21)

**Step 10: Update ask-card.tsx**

- Line 5: `AskKind` type — `"plan"` → `"spec"`
- Line 12: `plan:` key → `spec:`, label `"Proposed Plan"` → `"Proposed Spec"`

**Step 11: Update profile-editor.tsx**

- Line 15: `CORE_MODES` — `"intake"` → `"plan"`, `"plan"` → `"spec"` (order: `["default", "plan", "spec", "build"]`)
- Line 19: Labels — `intake: "Intake"` → `plan: "Plan"`, old `plan: "Plan"` → `spec: "Spec"`

**Step 12: Update test files**

In `plan-chat.test.tsx` (was intake-chat):

- `IntakeChat` → `PlanChat`

In `plan-grid.test.tsx` (was intake-grid):

- `IntakeGrid` → `PlanGrid`
- `listChildIntakes` → `listChildPlans`
- `openDraftIntakeTab` → `openDraftPlanTab`
- `"New intake"` → `"New plan"`
- Test descriptions

In `apps/desktop/src/components/layout/session-tabs/__tests__/session-tabs.test.tsx`:

- `kind: "intake"` → `kind: "plan"`, `getByText("Intake")` → `getByText("Plan")`, `getByLabelText("Close Intake tab")` → `"Close Plan tab"`

In `apps/desktop/src/components/chat-area/parts/__tests__/ask-card.test.tsx`:

- `kind="plan"` → `kind="spec"` in fixtures

In `apps/desktop/src/components/settings/tabs/models-settings/__tests__/profile-editor.test.tsx`:

- `getByText("Intake")` → `getByText("Plan")`

In `apps/desktop/src/components/chat-area/tools/registry/__tests__/ask.test.ts`:

- `args: { kind: "plan", ... }` → `kind: "spec"`

**Step 13: Run desktop tests**

```bash
vp run desktop#test
```

Expected: PASS

**Step 14: Commit**

```bash
git add apps/desktop/src/components/
git commit -m "refactor(desktop): rename intake components to plan, update UI labels"
```

---

## Phase 8: Final cleanup + verification

### Task 15: Update AGENTS.md and remaining references

**Files:**

- Modify: `AGENTS.md:111` (project conventions doc)

**Step 1: Update AGENTS.md**

The line referencing profile modes:

```
A profile maps runtime modes (`default` required; `intake`/`plan`/`build` optional)
```

→

```
A profile maps runtime modes (`default` required; `plan`/`spec`/`build` optional)
```

**Step 2: Search for any remaining references**

```bash
rg -n "intake|INTAKE|Intake" apps/ packages/ --type ts --type tsx -g '!*.test.*' -g '!__tests__/*'
rg -n "\"plan\"" apps/ packages/ --type ts --type tsx -g '!*.test.*' -g '!__tests__/*' | grep -v node_modules
```

Fix any stragglers. Ignore hits in `docs/plans/` and `openspec/changes/archive/` (historical records).

**Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md for plan/spec rename"
```

---

### Task 16: Full verification

**Step 1: Run all tests**

```bash
vp run -r test
```

Expected: All packages pass

**Step 2: Run lint + typecheck**

```bash
vp check --fix
```

Expected: No errors

**Step 3: Verify no stale references remain**

```bash
rg -n "intake|INTAKE|Intake" apps/ packages/ --type ts -g '!*.test.*' | grep -v node_modules | grep -v '__tests__'
rg -n "planning" apps/ packages/ --type ts | grep -v node_modules | grep -v '__tests__' | grep -v 'docs/'
```

Expected: Empty (or only historical docs/plans, openspec references)

**Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: cleanup remaining stale references after rename"
```

---

## Appendix: Files NOT touched (historical records)

These are intentionally left as-is:

- `docs/plans/2026-06-24-intake-session-onboarding.md` and all other `docs/plans/*` files
- `openspec/changes/archive/*`
- `openspec/changes/intake-session-onboarding/` (active spec — will be archived separately)
- `packages/db/src/__tests__/observational-memory-store.test.ts` — raw SQL seeds with `kind="task"` (pre-existing, unrelated)
