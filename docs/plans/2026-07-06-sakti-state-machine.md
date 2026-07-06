# Sakti State Machine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate comet's phase state machine into sakti — state fields written automatically by `sakti new change`, plus a `sakti state` command group for reading/writing/transitional phase updates.

**Architecture:** Extend `ChangeMetadataSchema` (the `.sakti.yaml` schema) with phase/workflow/build-decision fields and defaults. Wire `createChange()` to write initial state on creation (replacing comet's separate `comet-state init` step). Add a `commands/state.ts` module with `get`/`set`/`transition` subcommands (replacing comet's `comet-state.sh`). No guard enforcement yet — just safe, validated state mutations.

**Tech Stack:** TypeScript, Zod 4, commander, vitest, yaml package. Monorepo uses `vp` (vite-plus) for build/test.

---

## Reference: comet state machine (what we're porting)

- Phases: `open → design → build → verify → archive`
- Workflows: `full` (design+build+verify), `hotfix` (skip design), `tweak` (skip design + full plan)
- `.comet.yaml` has ~20 fields; we port the core set, skip comet-specific handoff fields (`handoff_context`, `handoff_hash`, `context_compression`, `build_command`, `verify_command`)
- Transitions validate: phase matches expected, evidence exists (artifacts/design_doc/report). NOT build-passes or guard checks.

## File map

| Action | Path                                                                              |
| ------ | --------------------------------------------------------------------------------- |
| Modify | `packages/sakti/src/sdd/core/change-metadata/schema.ts`                           |
| Create | `packages/sakti/src/sdd/core/change-metadata/workflow-defaults.ts`                |
| Modify | `packages/sakti/src/sdd/utils/change-utils.ts`                                    |
| Modify | `packages/sakti/src/sdd/commands/workflow/new-change.ts`                          |
| Modify | `packages/sakti/src/sdd/program.ts`                                               |
| Create | `packages/sakti/src/sdd/commands/state.ts`                                        |
| Create | `packages/sakti/src/sdd/core/change-metadata/__tests__/schema-state.test.ts`      |
| Create | `packages/sakti/src/sdd/core/change-metadata/__tests__/workflow-defaults.test.ts` |
| Modify | `packages/sakti/src/sdd/utils/__tests__/change-utils.test.ts` (or new test file)  |
| Create | `packages/sakti/src/sdd/commands/__tests__/state.test.ts`                         |

**Test command:** `vp run '@sakti-code/sakti#test'` (runs vitest in this package)

---

## Task 1: Extend ChangeMetadataSchema with state fields

**Files:**

- Modify: `packages/sakti/src/sdd/core/change-metadata/schema.ts`
- Test: `packages/sakti/src/sdd/core/change-metadata/__tests__/schema-state.test.ts`

### Step 1: Write the failing test

Create `packages/sakti/src/sdd/core/change-metadata/__tests__/schema-state.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ChangeMetadataSchema } from "../schema.js";

describe("ChangeMetadataSchema state machine fields", () => {
  describe("defaults", () => {
    it("applies full-workflow defaults when only schema is provided", () => {
      const result = ChangeMetadataSchema.safeParse({ schema: "spec-driven" });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.workflow).toBe("full");
      expect(result.data.phase).toBe("open");
      expect(result.data.auto_transition).toBe(true);
      expect(result.data.verify_result).toBe("pending");
      expect(result.data.branch_status).toBe("pending");
      expect(result.data.archived).toBe(false);
      expect(result.data.direct_override).toBe(false);
      expect(result.data.build_mode).toBeNull();
      expect(result.data.tdd_mode).toBeNull();
      expect(result.data.isolation).toBeNull();
      expect(result.data.design_doc).toBeNull();
      expect(result.data.base_ref).toBeNull();
    });
  });

  describe("enum validation", () => {
    it("rejects invalid workflow", () => {
      const result = ChangeMetadataSchema.safeParse({
        schema: "spec-driven",
        workflow: "bogus",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid phase", () => {
      const result = ChangeMetadataSchema.safeParse({
        schema: "spec-driven",
        phase: "middle",
      });
      expect(result.success).toBe(false);
    });

    it("accepts all valid phases", () => {
      for (const phase of ["open", "design", "build", "verify", "archive"] as const) {
        const result = ChangeMetadataSchema.safeParse({
          schema: "spec-driven",
          phase,
        });
        expect(result.success).toBe(true);
      }
    });

    it("accepts all valid build_mode values", () => {
      for (const mode of ["subagent-driven-development", "executing-plans", "direct"] as const) {
        const result = ChangeMetadataSchema.safeParse({
          schema: "spec-driven",
          build_mode: mode,
        });
        expect(result.success).toBe(true);
      }
    });

    it("accepts null for nullable fields", () => {
      const result = ChangeMetadataSchema.safeParse({
        schema: "spec-driven",
        build_mode: null,
        design_doc: null,
        tdd_mode: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("backward compatibility", () => {
    it("still accepts existing metadata without state fields", () => {
      const result = ChangeMetadataSchema.safeParse({
        schema: "spec-driven",
        created: "2025-01-05",
        goal: "ship it",
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.created).toBe("2025-01-05");
      expect(result.data.goal).toBe("ship it");
    });
  });
});
```

### Step 2: Run test to verify it fails

Run: `vp run '@sakti-code/sakti#test' -- schema-state`
Expected: FAIL — `result.data.workflow` is `undefined`, not `"full"` (fields don't exist yet)

### Step 3: Implement — add state fields to schema

Modify `packages/sakti/src/sdd/core/change-metadata/schema.ts`. Add the exported enums and extend `ChangeMetadataSchema`:

```typescript
import { z } from "zod";
import { isKebabId } from "../id.js";

export { isKebabId } from "../id.js";

const KebabIdentifierSchema = (label: string): z.ZodString =>
  z.string().superRefine((value, ctx) => {
    if (!isKebabId(value)) {
      ctx.addIssue({
        code: "custom",
        message: `${label} must be kebab-case with lowercase letters, numbers, and single hyphen separators`,
      });
    }
  });

export const InitiativeLinkSchema = z
  .object({
    store: KebabIdentifierSchema("Store id"),
    id: KebabIdentifierSchema("Initiative id"),
  })
  .strict();

export type InitiativeLink = z.infer<typeof InitiativeLinkSchema>;

// ── State machine enums ──────────────────────────────────────────

export const WorkflowSchema = z.enum(["full", "hotfix", "tweak"]);
export type Workflow = z.infer<typeof WorkflowSchema>;

export const PhaseSchema = z.enum(["open", "design", "build", "verify", "archive"]);
export type Phase = z.infer<typeof PhaseSchema>;

export const StateTransitionEventSchema = z.enum([
  "open-complete",
  "design-complete",
  "build-complete",
  "verify-pass",
  "verify-fail",
  "archive-reopen",
  "archived",
]);
export type StateTransitionEvent = z.infer<typeof StateTransitionEventSchema>;

// ── Per-change metadata schema ───────────────────────────────────

export const ChangeMetadataSchema = z.object({
  schema: z.string().min(1, { message: "schema is required" }),
  created: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: "created must be YYYY-MM-DD format",
    })
    .optional(),
  goal: z.string().min(1).optional(),
  affected_areas: z.array(z.string().min(1)).optional(),
  initiative: InitiativeLinkSchema.optional(),

  // State machine — core
  workflow: WorkflowSchema.default("full"),
  phase: PhaseSchema.default("open"),
  auto_transition: z.boolean().default(true),

  // State machine — build decisions (null until user chooses)
  build_mode: z
    .enum(["subagent-driven-development", "executing-plans", "direct"])
    .nullable()
    .default(null),
  build_pause: z.enum(["plan-ready"]).nullable().default(null),
  subagent_dispatch: z.enum(["confirmed"]).nullable().default(null),
  tdd_mode: z.enum(["tdd", "direct"]).nullable().default(null),
  review_mode: z.enum(["off", "standard", "thorough"]).nullable().default(null),
  isolation: z.enum(["branch", "worktree"]).nullable().default(null),
  direct_override: z.boolean().default(false),

  // State machine — verify
  verify_mode: z.enum(["light", "full"]).nullable().default(null),
  verify_result: z.enum(["pending", "pass", "fail"]).default("pending"),
  verification_report: z.string().nullable().default(null),
  branch_status: z.enum(["pending", "handled"]).default("pending"),

  // State machine — links
  design_doc: z.string().nullable().default(null),
  plan: z.string().nullable().default(null),
  base_ref: z.string().nullable().default(null),
  verified_at: z.string().nullable().default(null),
  archived: z.boolean().default(false),
});

export type ChangeMetadata = z.infer<typeof ChangeMetadataSchema>;
```

### Step 4: Run test to verify it passes

Run: `vp run '@sakti-code/sakti#test' -- schema-state`
Expected: PASS

Also run the full suite to confirm backward compat: `vp run '@sakti-code/sakti#test'`
Expected: All existing tests still pass.

### Step 5: Commit

```bash
git add packages/sakti/src/sdd/core/change-metadata/schema.ts \
        packages/sakti/src/sdd/core/change-metadata/__tests__/schema-state.test.ts
git commit -m "feat(sakti): add state machine fields to ChangeMetadataSchema"
```

---

## Task 2: Add workflow-defaults generator

**Files:**

- Create: `packages/sakti/src/sdd/core/change-metadata/workflow-defaults.ts`
- Test: `packages/sakti/src/sdd/core/change-metadata/__tests__/workflow-defaults.test.ts`

### Step 1: Write the failing test

Create `packages/sakti/src/sdd/core/change-metadata/__tests__/workflow-defaults.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getStateDefaultsForWorkflow } from "../workflow-defaults.js";

describe("getStateDefaultsForWorkflow", () => {
  it("returns full-workflow defaults with null build decisions", () => {
    const defaults = getStateDefaultsForWorkflow("full");
    expect(defaults.workflow).toBe("full");
    expect(defaults.phase).toBe("open");
    expect(defaults.build_mode).toBeNull();
    expect(defaults.tdd_mode).toBeNull();
    expect(defaults.review_mode).toBeNull();
    expect(defaults.isolation).toBeNull();
    expect(defaults.verify_mode).toBeNull();
  });

  it("returns hotfix defaults with direct build mode", () => {
    const defaults = getStateDefaultsForWorkflow("hotfix");
    expect(defaults.workflow).toBe("hotfix");
    expect(defaults.phase).toBe("open");
    expect(defaults.build_mode).toBe("direct");
    expect(defaults.tdd_mode).toBe("direct");
    expect(defaults.review_mode).toBe("off");
    expect(defaults.isolation).toBe("branch");
    expect(defaults.verify_mode).toBe("light");
  });

  it("returns tweak defaults matching hotfix build decisions", () => {
    const defaults = getStateDefaultsForWorkflow("tweak");
    expect(defaults.workflow).toBe("tweak");
    expect(defaults.build_mode).toBe("direct");
    expect(defaults.tdd_mode).toBe("direct");
    expect(defaults.isolation).toBe("branch");
    expect(defaults.verify_mode).toBe("light");
  });
});
```

### Step 2: Run test to verify it fails

Run: `vp run '@sakti-code/sakti#test' -- workflow-defaults`
Expected: FAIL — module not found

### Step 3: Implement

Create `packages/sakti/src/sdd/core/change-metadata/workflow-defaults.ts`:

```typescript
import type { ChangeMetadata, Workflow } from "./schema.js";

/**
 * Returns the initial state-machine field values for a given workflow type.
 *
 * - `full`: build decisions stay null until the user selects them in build phase
 * - `hotfix`/`tweak`: preset to `direct` execution, `branch` isolation, `light` verify
 *
 * Fields not listed here (auto_transition, verify_result, branch_status, etc.)
 * use their schema defaults via ChangeMetadataSchema.
 */
export function getStateDefaultsForWorkflow(workflow: Workflow): Partial<ChangeMetadata> {
  const base = {
    workflow,
    phase: "open" as const,
  };

  switch (workflow) {
    case "full":
      return {
        ...base,
        build_mode: null,
        tdd_mode: null,
        review_mode: null,
        isolation: null,
        verify_mode: null,
      };
    case "hotfix":
    case "tweak":
      return {
        ...base,
        build_mode: "direct",
        tdd_mode: "direct",
        review_mode: "off",
        isolation: "branch",
        verify_mode: "light",
      };
  }
}
```

### Step 4: Run test to verify it passes

Run: `vp run '@sakti-code/sakti#test' -- workflow-defaults`
Expected: PASS

### Step 5: Commit

```bash
git add packages/sakti/src/sdd/core/change-metadata/workflow-defaults.ts \
        packages/sakti/src/sdd/core/change-metadata/__tests__/workflow-defaults.test.ts
git commit -m "feat(sakti): add getStateDefaultsForWorkflow helper"
```

---

## Task 3: Wire state defaults into createChange + capture base_ref

**Files:**

- Modify: `packages/sakti/src/sdd/utils/change-utils.ts`
- Modify: `packages/sakti/src/sdd/utils/__tests__/change-utils.test.ts` (or create new test file if it doesn't exist: `packages/sakti/src/sdd/utils/__tests__/change-utils-state.test.ts`)

### Step 0: Check if change-utils tests exist

Run: `ls packages/sakti/src/sdd/utils/__tests__/change-utils*.test.ts`
If no change-utils test file exists, create `packages/sakti/src/sdd/utils/__tests__/change-utils-state.test.ts`. Otherwise add to the existing file.

### Step 1: Write the failing test

Create `packages/sakti/src/sdd/utils/__tests__/change-utils-state.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import * as yaml from "yaml";
import { createChange } from "../change-utils.js";
import { execSync } from "child_process";

describe("createChange state machine integration", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `sakti-test-${randomUUID()}`);
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes full-workflow state defaults to .sakti.yaml", async () => {
    // Need a git repo for base_ref capture
    execSync("git init", { cwd: tmpDir });
    execSync("git config user.email test@test.com", { cwd: tmpDir });
    execSync("git config user.name test", { cwd: tmpDir });

    const result = await createChange(tmpDir, "add-auth", { workflow: "full" });
    const metaPath = path.join(result.changeDir, ".sakti.yaml");
    const content = await fs.readFile(metaPath, "utf-8");
    const parsed = yaml.parse(content);

    expect(parsed.workflow).toBe("full");
    expect(parsed.phase).toBe("open");
    expect(parsed.auto_transition).toBe(true);
    expect(parsed.build_mode).toBeNull();
    expect(parsed.verify_result).toBe("pending");
    expect(parsed.archived).toBe(false);
  });

  it("writes hotfix state defaults when workflow is hotfix", async () => {
    execSync("git init", { cwd: tmpDir });
    execSync("git config user.email test@test.com", { cwd: tmpDir });
    execSync("git config user.name test", { cwd: tmpDir });

    const result = await createChange(tmpDir, "fix-typo", { workflow: "hotfix" });
    const metaPath = path.join(result.changeDir, ".sakti.yaml");
    const content = await fs.readFile(metaPath, "utf-8");
    const parsed = yaml.parse(content);

    expect(parsed.workflow).toBe("hotfix");
    expect(parsed.build_mode).toBe("direct");
    expect(parsed.tdd_mode).toBe("direct");
    expect(parsed.isolation).toBe("branch");
    expect(parsed.verify_mode).toBe("light");
  });

  it("defaults to full workflow when no workflow specified", async () => {
    execSync("git init", { cwd: tmpDir });
    execSync("git config user.email test@test.com", { cwd: tmpDir });
    execSync("git config user.name test", { cwd: tmpDir });

    const result = await createChange(tmpDir, "add-feature");
    const metaPath = path.join(result.changeDir, ".sakti.yaml");
    const content = await fs.readFile(metaPath, "utf-8");
    const parsed = yaml.parse(content);

    expect(parsed.workflow).toBe("full");
  });

  it("captures base_ref as current git HEAD SHA", async () => {
    execSync("git init", { cwd: tmpDir });
    execSync("git config user.email test@test.com", { cwd: tmpDir });
    execSync("git config user.name test", { cwd: tmpDir });
    await fs.writeFile(path.join(tmpDir, "README.md"), "init");
    execSync("git add .", { cwd: tmpDir });
    execSync("git commit -m init", { cwd: tmpDir });
    const headSha = execSync("git rev-parse HEAD", { cwd: tmpDir }).toString().trim();

    const result = await createChange(tmpDir, "add-auth", { workflow: "full" });
    const metaPath = path.join(result.changeDir, ".sakti.yaml");
    const content = await fs.readFile(metaPath, "utf-8");
    const parsed = yaml.parse(content);

    expect(parsed.base_ref).toBe(headSha);
  });

  it("sets base_ref to null when not in a git repo", async () => {
    const result = await createChange(tmpDir, "add-auth", { workflow: "full" });
    const metaPath = path.join(result.changeDir, ".sakti.yaml");
    const content = await fs.readFile(metaPath, "utf-8");
    const parsed = yaml.parse(content);

    expect(parsed.base_ref).toBeNull();
  });
});
```

### Step 2: Run test to verify it fails

Run: `vp run '@sakti-code/sakti#test' -- change-utils-state`
Expected: FAIL — `createChange` doesn't accept a `workflow` option or write state fields

### Step 3: Implement

Modify `packages/sakti/src/sdd/utils/change-utils.ts`:

1. Add `workflow` to `CreateChangeOptions`:

```typescript
import { getStateDefaultsForWorkflow } from "../core/change-metadata/workflow-defaults.js";
import type { Workflow } from "../core/change-metadata/index.js";
import { execSync } from "child_process";

export interface CreateChangeOptions {
  schema?: string;
  defaultSchema?: string;
  changesDir?: string;
  metadata?: Partial<Pick<ChangeMetadata, "goal" | "affected_areas" | "initiative">>;
  workflow?: Workflow;
}
```

2. Inside `createChange`, after the existing `writeChangeMetadata` call section, build and merge state defaults. Replace the metadata-writing block (around lines 193-203) with:

```typescript
// Write metadata file with schema, creation date, and state machine defaults
const today = new Date().toISOString().split("T")[0];
const workflow = options.workflow ?? "full";
const stateDefaults = getStateDefaultsForWorkflow(workflow);
const baseRef = resolveBaseRef(projectRoot);

writeChangeMetadata(
  changeDir,
  {
    schema: schemaName,
    created: today,
    ...options.metadata,
    ...stateDefaults,
    base_ref: baseRef,
  },
  projectRoot,
);
```

3. Add the `resolveBaseRef` helper at the bottom of the file:

```typescript
/**
 * Resolves the current git HEAD SHA for use as base_ref, or null if not a git repo.
 */
function resolveBaseRef(projectRoot: string): string | null {
  try {
    const sha = execSync("git rev-parse HEAD", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    return sha || null;
  } catch {
    return null;
  }
}
```

### Step 4: Run test to verify it passes

Run: `vp run '@sakti-code/sakti#test' -- change-utils-state`
Expected: PASS

Run full suite: `vp run '@sakti-code/sakti#test'`
Expected: All pass (existing tests don't pass `workflow`, so default `"full"` applies)

### Step 5: Commit

```bash
git add packages/sakti/src/sdd/utils/change-utils.ts \
        packages/sakti/src/sdd/utils/__tests__/change-utils-state.test.ts
git commit -m "feat(sakti): write state machine defaults on createChange + capture base_ref"
```

---

## Task 4: Add --workflow flag to `sakti new change`

**Files:**

- Modify: `packages/sakti/src/sdd/commands/workflow/new-change.ts`
- Modify: `packages/sakti/src/sdd/program.ts`

### Step 1: Write the failing test

Add to `packages/sakti/src/sdd/commands/__tests__/change-command.list.test.ts` or create a new test file. Simplest: a unit test on the option plumbing.

Create `packages/sakti/src/sdd/commands/__tests__/new-change-workflow.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { NewChangeOptions } from "../../commands/workflow/new-change.js";

describe("NewChangeOptions workflow field", () => {
  it("accepts workflow option", () => {
    const opts: NewChangeOptions = { workflow: "hotfix" };
    expect(opts.workflow).toBe("hotfix");
  });

  it("workflow is optional (defaults to full in createChange)", () => {
    const opts: NewChangeOptions = {};
    expect(opts.workflow).toBeUndefined();
  });
});
```

### Step 2: Run test to verify it fails

Run: `vp run '@sakti-code/sakti#test' -- new-change-workflow`
Expected: FAIL — `workflow` not in `NewChangeOptions`

### Step 3: Implement

Modify `packages/sakti/src/sdd/commands/workflow/new-change.ts`:

1. Add to `NewChangeOptions`:

```typescript
import type { Workflow } from "../../core/change-metadata/index.js";

export interface NewChangeOptions {
  description?: string;
  goal?: string;
  schema?: string;
  workflow?: Workflow;
  initiative?: string;
  areas?: string;
  json?: boolean;
}
```

2. In `newChangeCommand`, pass `workflow` to `createChange`. Change the `createChange` call (around line 116):

```typescript
const result = await createChange(projectRoot, name, {
  schema: options.schema,
  defaultSchema: root.defaultSchema,
  changesDir: root.changesDir,
  metadata: options.goal ? { goal: options.goal } : {},
  workflow: options.workflow,
});
```

Modify `packages/sakti/src/sdd/program.ts` — add the `--workflow` option to the `new change` command (around line 321):

```typescript
  newCmd
    .command("change <name>")
    .description("Create a new change directory")
    .option("--description <text>", "Description to add to README.md")
    .option("--goal <text>", "Optional goal metadata to store with the change")
    .option("--schema <name>", `Workflow schema to use (default: ${DEFAULT_SCHEMA})`)
    .option(
      "--workflow <type>",
      "State machine preset: full (default), hotfix, or tweak",
    )
    .option("--json", "Output as JSON")
    .addOption(new Option("--initiative <id>", "No longer supported").hideHelp())
    .addOption(new Option("--areas <names>", "No longer supported").hideHelp())
    .action(async (name: string, options: NewChangeOptions) => {
```

### Step 4: Run test to verify it passes

Run: `vp run '@sakti-code/sakti#test' -- new-change-workflow`
Expected: PASS

### Step 5: Commit

```bash
git add packages/sakti/src/sdd/commands/workflow/new-change.ts \
        packages/sakti/src/sdd/program.ts \
        packages/sakti/src/sdd/commands/__tests__/new-change-workflow.test.ts
git commit -m "feat(sakti): add --workflow flag to sakti new change"
```

---

## Task 5: Add `sakti state get` command

**Files:**

- Create: `packages/sakti/src/sdd/commands/state.ts`
- Create: `packages/sakti/src/sdd/commands/__tests__/state.test.ts`

### Step 1: Write the failing test

Create `packages/sakti/src/sdd/commands/__tests__/state.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import * as yaml from "yaml";
import { writeChangeMetadata } from "../../utils/change-metadata.js";
import { stateGet } from "../state.js";

describe("stateGet", () => {
  let tmpDir: string;
  let changeDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `sakti-state-${randomUUID()}`);
    changeDir = path.join(tmpDir, ".sakti", "changes", "test-change");
    await fs.mkdir(changeDir, { recursive: true });
    writeChangeMetadata(
      changeDir,
      { schema: "spec-driven", created: "2026-07-06", workflow: "full", phase: "open" },
      tmpDir,
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("reads an existing field value", async () => {
    const value = await stateGet(changeDir, "phase");
    expect(value).toBe("open");
  });

  it("reads workflow field", async () => {
    const value = await stateGet(changeDir, "workflow");
    expect(value).toBe("full");
  });

  it("throws on unknown field", async () => {
    await expect(stateGet(changeDir, "bogus_field")).rejects.toThrow(/unknown field/i);
  });
});
```

### Step 2: Run test to verify it fails

Run: `vp run '@sakti-code/sakti#test' -- state`
Expected: FAIL — `../state.js` module not found

### Step 3: Implement

Create `packages/sakti/src/sdd/commands/state.ts`:

```typescript
/**
 * State Command
 *
 * Reads and updates the state-machine fields in a change's .sakti.yaml.
 * Subcommands: get, set, transition.
 */
import type { ChangeMetadata } from "../core/change-metadata/index.js";

// Fields that may be read or written via `sakti state`.
export const STATE_FIELDS = [
  "workflow",
  "phase",
  "auto_transition",
  "build_mode",
  "build_pause",
  "subagent_dispatch",
  "tdd_mode",
  "review_mode",
  "isolation",
  "direct_override",
  "verify_mode",
  "verify_result",
  "verification_report",
  "branch_status",
  "design_doc",
  "plan",
  "base_ref",
  "verified_at",
  "archived",
] as const;

export type StateField = (typeof STATE_FIELDS)[number];

function assertKnownField(field: string): asserts field is StateField {
  if (!STATE_FIELDS.includes(field as StateField)) {
    throw new Error(`Unknown field '${field}'. Valid fields: ${STATE_FIELDS.join(", ")}`);
  }
}

/**
 * Reads a single state field from a change's .sakti.yaml.
 * Returns the value as a string (or "null"/"true"/"false" for scalars).
 */
export async function stateGet(changeDir: string, field: string): Promise<string> {
  assertKnownField(field);
  const { readChangeMetadata } = await import("../utils/change-metadata.js");
  const metadata = readChangeMetadata(changeDir);
  if (!metadata) {
    throw new Error(`No .sakti.yaml found in ${changeDir}`);
  }
  const value = metadata[field];
  if (value === null || value === undefined) {
    return "null";
  }
  return String(value);
}
```

### Step 4: Run test to verify it passes

Run: `vp run '@sakti-code/sakti#test' -- state`
Expected: PASS

### Step 5: Commit

```bash
git add packages/sakti/src/sdd/commands/state.ts \
        packages/sakti/src/sdd/commands/__tests__/state.test.ts
git commit -m "feat(sakti): add stateGet command for reading state fields"
```

---

## Task 6: Add `sakti state set` command

**Files:**

- Modify: `packages/sakti/src/sdd/commands/state.ts`
- Modify: `packages/sakti/src/sdd/commands/__tests__/state.test.ts`

### Step 1: Write the failing test

Append to `packages/sakti/src/sdd/commands/__tests__/state.test.ts`:

```typescript
import { stateSet } from "../state.js";

describe("stateSet", () => {
  let tmpDir: string;
  let changeDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `sakti-state-set-${randomUUID()}`);
    changeDir = path.join(tmpDir, ".sakti", "changes", "test-change");
    await fs.mkdir(changeDir, { recursive: true });
    writeChangeMetadata(
      changeDir,
      { schema: "spec-driven", created: "2026-07-06", workflow: "full", phase: "open" },
      tmpDir,
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes a field value and persists to .sakti.yaml", async () => {
    await stateSet(changeDir, "build_mode", "direct", { projectRoot: tmpDir });
    const metaPath = path.join(changeDir, ".sakti.yaml");
    const parsed = yaml.parse(await fs.readFile(metaPath, "utf-8"));
    expect(parsed.build_mode).toBe("direct");
  });

  it("validates enum values — rejects invalid build_mode", async () => {
    await expect(
      stateSet(changeDir, "build_mode", "bogus", { projectRoot: tmpDir }),
    ).rejects.toThrow();
  });

  it("blocks direct phase writes without --force", async () => {
    await expect(stateSet(changeDir, "phase", "build", { projectRoot: tmpDir })).rejects.toThrow(
      /transition/i,
    );
  });

  it("allows direct phase writes with force flag", async () => {
    await stateSet(changeDir, "phase", "build", { projectRoot: tmpDir, force: true });
    const metaPath = path.join(changeDir, ".sakti.yaml");
    const parsed = yaml.parse(await fs.readFile(metaPath, "utf-8"));
    expect(parsed.phase).toBe("build");
  });

  it("sets nullable field to null when value is 'null'", async () => {
    await stateSet(changeDir, "build_pause", "plan-ready", { projectRoot: tmpDir });
    await stateSet(changeDir, "build_pause", "null", { projectRoot: tmpDir });
    const metaPath = path.join(changeDir, ".sakti.yaml");
    const parsed = yaml.parse(await fs.readFile(metaPath, "utf-8"));
    expect(parsed.build_pause).toBeNull();
  });
});
```

### Step 2: Run test to verify it fails

Run: `vp run '@sakti-code/sakti#test' -- state`
Expected: FAIL — `stateSet` not exported

### Step 3: Implement

Add to `packages/sakti/src/sdd/commands/state.ts`:

```typescript
export interface StateSetOptions {
  projectRoot?: string;
  force?: boolean;
}

/**
 * Updates a single state field in a change's .sakti.yaml with validation.
 *
 * Direct `phase` writes are blocked — use `stateTransition` instead.
 * Pass `force: true` to override (repair escape hatch, mirrors comet's COMET_FORCE_PHASE).
 */
export async function stateSet(
  changeDir: string,
  field: string,
  value: string,
  options: StateSetOptions = {},
): Promise<void> {
  assertKnownField(field);

  if (field === "phase" && !options.force) {
    throw new Error(
      "Setting 'phase' directly is not allowed; use 'sakti state transition' for validated phase advances. " +
        "Repair escape hatch: pass force: true.",
    );
  }

  const { readChangeMetadata, writeChangeMetadata } = await import("../utils/change-metadata.js");
  const metadata = readChangeMetadata(changeDir, options.projectRoot);
  if (!metadata) {
    throw new Error(`No .sakti.yaml found in ${changeDir}`);
  }

  const parsedValue = coerceValue(field, value);

  const updated: ChangeMetadata = {
    ...metadata,
    [field]: parsedValue,
  };

  writeChangeMetadata(changeDir, updated, options.projectRoot);
}

/**
 * Coerces a string CLI value into the correct type for the field.
 * Relies on ChangeMetadataSchema (Zod) to reject invalid enum values.
 */
function coerceValue(field: StateField, value: string): unknown {
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}
```

### Step 4: Run test to verify it passes

Run: `vp run '@sakti-code/sakti#test' -- state`
Expected: PASS

### Step 5: Commit

```bash
git add packages/sakti/src/sdd/commands/state.ts \
        packages/sakti/src/sdd/commands/__tests__/state.test.ts
git commit -m "feat(sakti): add stateSet command with enum validation and phase guard"
```

---

## Task 7: Add `sakti state transition` command

**Files:**

- Modify: `packages/sakti/src/sdd/commands/state.ts`
- Modify: `packages/sakti/src/sdd/commands/__tests__/state.test.ts`

### Step 1: Write the failing test

Append to `packages/sakti/src/sdd/commands/__tests__/state.test.ts`:

```typescript
import { stateTransition } from "../state.js";

describe("stateTransition", () => {
  let tmpDir: string;
  let changeDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `sakti-transition-${randomUUID()}`);
    changeDir = path.join(tmpDir, ".sakti", "changes", "test-change");
    await fs.mkdir(changeDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function seed(workflow: "full" | "hotfix" | "tweak", phase: string, extra?: object) {
    writeChangeMetadata(
      changeDir,
      { schema: "spec-driven", created: "2026-07-06", workflow, phase, ...extra } as any,
      tmpDir,
    );
  }

  async function readField(field: string): Promise<string> {
    const metaPath = path.join(changeDir, ".sakti.yaml");
    const parsed = yaml.parse(await fs.readFile(metaPath, "utf-8"));
    return parsed[field];
  }

  it("open-complete advances to design for full workflow when artifacts exist", async () => {
    seed("full", "open");
    // create minimal artifacts so the transition's existence check passes
    await fs.writeFile(path.join(changeDir, "proposal.md"), "# proposal");
    await fs.writeFile(path.join(changeDir, "design.md"), "# design");
    await fs.writeFile(path.join(changeDir, "tasks.md"), "# tasks");

    await stateTransition(changeDir, "open-complete", { projectRoot: tmpDir });
    expect(await readField("phase")).toBe("design");
  });

  it("open-complete advances to build for hotfix workflow", async () => {
    seed("hotfix", "open");
    await fs.writeFile(path.join(changeDir, "proposal.md"), "# proposal");
    await fs.writeFile(path.join(changeDir, "tasks.md"), "# tasks");

    await stateTransition(changeDir, "open-complete", { projectRoot: tmpDir });
    expect(await readField("phase")).toBe("build");
  });

  it("open-complete fails when artifacts are missing", async () => {
    seed("full", "open");
    await expect(
      stateTransition(changeDir, "open-complete", { projectRoot: tmpDir }),
    ).rejects.toThrow(/proposal|design|tasks/i);
  });

  it("open-complete fails when phase is not open", async () => {
    seed("full", "design");
    await expect(
      stateTransition(changeDir, "open-complete", { projectRoot: tmpDir }),
    ).rejects.toThrow(/phase/i);
  });

  it("design-complete requires design_doc", async () => {
    seed("full", "design");
    await expect(
      stateTransition(changeDir, "design-complete", { projectRoot: tmpDir }),
    ).rejects.toThrow(/design_doc/i);
  });

  it("design-complete advances to build when design_doc is set", async () => {
    seed("full", "design", { design_doc: "docs/design.md" });
    await stateTransition(changeDir, "design-complete", { projectRoot: tmpDir });
    expect(await readField("phase")).toBe("build");
  });

  it("build-complete advances to verify", async () => {
    seed("full", "build");
    await stateTransition(changeDir, "build-complete", { projectRoot: tmpDir });
    expect(await readField("phase")).toBe("verify");
    expect(await readField("verify_result")).toBe("pending");
  });

  it("verify-pass requires verification_report and branch_status=handled", async () => {
    seed("full", "verify");
    await expect(
      stateTransition(changeDir, "verify-pass", { projectRoot: tmpDir }),
    ).rejects.toThrow(/verification_report|branch_status/i);
  });

  it("verify-pass advances to archive when evidence present", async () => {
    seed("full", "verify", {
      verification_report: "reports/v.md",
      branch_status: "handled",
    });
    await stateTransition(changeDir, "verify-pass", { projectRoot: tmpDir });
    expect(await readField("phase")).toBe("archive");
    expect(await readField("verify_result")).toBe("pass");
  });

  it("verify-fail rolls back to build", async () => {
    seed("full", "verify");
    await stateTransition(changeDir, "verify-fail", { projectRoot: tmpDir });
    expect(await readField("phase")).toBe("build");
    expect(await readField("verify_result")).toBe("fail");
  });

  it("archived requires verify_result=pass", async () => {
    seed("full", "archive", { verify_result: "pending" });
    await expect(stateTransition(changeDir, "archived", { projectRoot: tmpDir })).rejects.toThrow(
      /verify_result/i,
    );
  });

  it("archived sets archived=true when verify_result=pass", async () => {
    seed("full", "archive", { verify_result: "pass" });
    await stateTransition(changeDir, "archived", { projectRoot: tmpDir });
    expect(await readField("archived")).toBe(true);
  });
});
```

### Step 2: Run test to verify it fails

Run: `vp run '@sakti-code/sakti#test' -- state`
Expected: FAIL — `stateTransition` not exported

### Step 3: Implement

Add to `packages/sakti/src/sdd/commands/state.ts`:

```typescript
import type {
  StateTransitionEvent,
  Workflow,
  ChangeMetadata,
} from "../core/change-metadata/index.js";

export interface StateTransitionOptions {
  projectRoot?: string;
}

/**
 * Applies a validated phase transition.
 *
 * Validates: current phase matches the event's expected source phase, and any
 * required evidence (artifacts, design_doc, verification_report) exists.
 * Does NOT run build commands or deep content checks — that's the guard's job.
 */
export async function stateTransition(
  changeDir: string,
  event: StateTransitionEvent,
  options: StateTransitionOptions = {},
): Promise<void> {
  const { readChangeMetadata, writeChangeMetadata } = await import("../utils/change-metadata.js");
  const { promises: fs } = await import("fs");
  const path = await import("path");

  const metadata = readChangeMetadata(changeDir, options.projectRoot);
  if (!metadata) {
    throw new Error(`No .sakti.yaml found in ${changeDir}`);
  }

  const requirePhase = (expected: string): void => {
    if (metadata.phase !== expected) {
      throw new Error(
        `Cannot transition '${event}': expected phase ${expected}, got ${metadata.phase}`,
      );
    }
  };

  const fileExists = async (relativePath: string | null): Promise<boolean> => {
    if (!relativePath) return false;
    try {
      await fs.access(path.join(changeDir, "..", "..", "..", relativePath));
      return true;
    } catch {
      // also try relative to changeDir itself
      try {
        await fs.access(path.resolve(changeDir, relativePath));
        return true;
      } catch {
        return false;
      }
    }
  };

  const apply = (changes: Partial<ChangeMetadata>): void => {
    writeChangeMetadata(changeDir, { ...metadata, ...changes }, options.projectRoot);
  };

  switch (event) {
    case "open-complete": {
      requirePhase("open");
      // Check artifacts exist (relative to changeDir)
      const artifacts =
        metadata.workflow === "full"
          ? ["proposal.md", "design.md", "tasks.md"]
          : ["proposal.md", "tasks.md"];
      for (const artifact of artifacts) {
        try {
          await fs.access(path.join(changeDir, artifact));
        } catch {
          throw new Error(
            `Cannot transition 'open-complete': ${artifact} must exist and be non-empty before leaving open`,
          );
        }
      }
      const nextPhase = metadata.workflow === "full" ? "design" : "build";
      apply({ phase: nextPhase as ChangeMetadata["phase"] });
      break;
    }

    case "design-complete": {
      requirePhase("design");
      if (!metadata.design_doc || metadata.design_doc === "null") {
        throw new Error(
          "Cannot transition 'design-complete': design_doc must point to an existing Design Doc before leaving design",
        );
      }
      apply({ phase: "build" });
      break;
    }

    case "build-complete": {
      requirePhase("build");
      const previousResult = metadata.verify_result;
      apply({ phase: "verify", verify_result: "pending" });
      // Preserve verification evidence on re-verify
      if (previousResult !== "fail") {
        apply({ verification_report: null, branch_status: "pending" });
      }
      break;
    }

    case "verify-pass": {
      requirePhase("verify");
      if (!metadata.verification_report) {
        throw new Error(
          "Cannot transition 'verify-pass': verification_report must point to an existing report file",
        );
      }
      if (metadata.branch_status !== "handled") {
        throw new Error("Cannot transition 'verify-pass': branch_status must be handled");
      }
      const today = new Date().toISOString().split("T")[0];
      apply({
        verify_result: "pass",
        phase: "archive",
        verified_at: today,
      });
      break;
    }

    case "verify-fail": {
      requirePhase("verify");
      apply({ verify_result: "fail", phase: "build" });
      break;
    }

    case "archive-reopen": {
      requirePhase("archive");
      if (metadata.archived) {
        throw new Error("Cannot transition 'archive-reopen': already archived");
      }
      apply({ verify_result: "pending", phase: "verify", verified_at: null });
      break;
    }

    case "archived": {
      requirePhase("archive");
      if (metadata.verify_result !== "pass") {
        throw new Error(
          "Cannot transition 'archived': verify_result must be pass before archiving",
        );
      }
      apply({ archived: true });
      break;
    }
  }
}
```

### Step 4: Run test to verify it passes

Run: `vp run '@sakti-code/sakti#test' -- state`
Expected: PASS

### Step 5: Commit

```bash
git add packages/sakti/src/sdd/commands/state.ts \
        packages/sakti/src/sdd/commands/__tests__/state.test.ts
git commit -m "feat(sakti): add stateTransition with validated phase transitions"
```

---

## Task 8: Register `sakti state` command group in program.ts

**Files:**

- Modify: `packages/sakti/src/sdd/program.ts`

### Step 1: Write the failing test

Create `packages/sakti/src/sdd/commands/__tests__/state-command-registration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { buildSddProgram } from "../../program.js";

describe("sakti state command registration", () => {
  it("registers the state command group", () => {
    const program = buildSddProgram("0.0.0-test");
    const commands = program.commands.map((c) => c.name());
    expect(commands).toContain("state");
  });

  it("state has get, set, transition subcommands", () => {
    const program = buildSddProgram("0.0.0-test");
    const stateCmd = program.commands.find((c) => c.name() === "state");
    expect(stateCmd).toBeDefined();
    const subcommands = stateCmd!.commands.map((c) => c.name());
    expect(subcommands).toEqual(expect.arrayContaining(["get", "set", "transition"]));
  });
});
```

### Step 2: Run test to verify it fails

Run: `vp run '@sakti-code/sakti#test' -- state-command-registration`
Expected: FAIL — no `state` command registered

### Step 3: Implement

Modify `packages/sakti/src/sdd/program.ts` — add import and register the command group. Add the import near the other command imports:

```typescript
import { stateGet, stateSet, stateTransition } from "./commands/state.js";
```

Add the command registration before `return program;` (after the `new change` command block, around line 338):

```typescript
// ═══════════════════════════════════════════════════════════
// State Machine Commands
// ═══════════════════════════════════════════════════════════

const stateCmd = program
  .command("state")
  .description("Read and update change state-machine fields");

stateCmd
  .command("get <change> <field>")
  .description("Read a state field from .sakti.yaml")
  .option("--json", "Output as JSON")
  .action(async (change: string, field: string, options?: { json?: boolean }) => {
    try {
      const root = await resolveRootForCommand({ json: options?.json });
      if (!root) return;
      const changeDir = path.join(root.changesDir, change);
      const value = await stateGet(changeDir, field);
      if (options?.json) {
        console.log(JSON.stringify({ change, field, value }));
      } else {
        console.log(value);
      }
    } catch (error) {
      failWithError(error, { enabled: options?.json, fallbackCode: "state_get_error" });
      process.exit(1);
    }
  });

stateCmd
  .command("set <change> <field> <value>")
  .description("Write a state field (validates enum; blocks direct phase writes)")
  .option("--force", "Allow writing phase directly (repair escape hatch)")
  .option("--json", "Output as JSON")
  .action(
    async (
      change: string,
      field: string,
      value: string,
      options?: { force?: boolean; json?: boolean },
    ) => {
      try {
        const root = await resolveRootForCommand({ json: options?.json });
        if (!root) return;
        const changeDir = path.join(root.changesDir, change);
        await stateSet(changeDir, field, value, {
          projectRoot: root.path,
          force: options?.force,
        });
        if (options?.json) {
          console.log(JSON.stringify({ change, field, value, status: "ok" }));
        } else {
          console.log(`[SET] ${field}=${value}`);
        }
      } catch (error) {
        failWithError(error, { enabled: options?.json, fallbackCode: "state_set_error" });
        process.exit(1);
      }
    },
  );

stateCmd
  .command("transition <change> <event>")
  .description("Apply a validated phase transition")
  .option("--json", "Output as JSON")
  .action(async (change: string, event: string, options?: { json?: boolean }) => {
    try {
      const root = await resolveRootForCommand({ json: options?.json });
      if (!root) return;
      const changeDir = path.join(root.changesDir, change);
      await stateTransition(changeDir, event as any, { projectRoot: root.path });
      if (options?.json) {
        console.log(JSON.stringify({ change, event, status: "ok" }));
      } else {
        console.log(`[TRANSITION] ${event}`);
      }
    } catch (error) {
      failWithError(error, {
        enabled: options?.json,
        fallbackCode: "state_transition_error",
      });
      process.exit(1);
    }
  });
```

Note: add `import path from "path";` at the top of program.ts if not already imported.

### Step 4: Run test to verify it passes

Run: `vp run '@sakti-code/sakti#test' -- state-command-registration`
Expected: PASS

Run the full suite to confirm nothing broke: `vp run '@sakti-code/sakti#test'`
Expected: All pass

### Step 5: Commit

```bash
git add packages/sakti/src/sdd/program.ts \
        packages/sakti/src/sdd/commands/__tests__/state-command-registration.test.ts
git commit -m "feat(sakti): register sakti state command group (get/set/transition)"
```

---

## Final verification

After all 8 tasks:

```bash
vp run '@sakti-code/sakti#test'                    # full test suite green
vp run '@sakti-code/sakti#build'                   # build succeeds
vp check                                           # lint + format + typecheck
```

Manual smoke test:

```bash
# Create a change with state machine
sakti new change test-state --workflow full
cat .sakti/changes/test-state/.sakti.yaml          # see full state defaults

# Read and write state
sakti state get test-state phase                   # → open
sakti state set test-state build_mode direct       # → [SET] build_mode=direct
sakti state set test-state phase build             # → ERROR: use transition
sakti state set test-state phase build --force     # → [SET] phase=build (repair)

# Transitions
sakti state transition test-state open-complete    # → phase=design (after artifacts exist)
```
