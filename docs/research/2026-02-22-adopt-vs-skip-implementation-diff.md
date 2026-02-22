# Adopt vs Skip Implementation Diff

## Context

This is a concrete patch proposal against current planner/spec files in `ekacode`, derived from the `cc-sdd` comparison.

Goal:

- Adopt high-value workflow improvements from cc-sdd
- Skip low-rigor, prompt-only behaviors that would weaken our runtime guarantees

This document is patch-oriented so it can be implemented incrementally in the next session.

---

## Adopt: Patch Set A (High Priority)

### A1) Add explicit spec state mirror file (`spec.json`) while keeping DB canonical

#### Why adopt

- cc-sdd has strong human-readable workflow state.
- We keep our DB/task/runtime state as source of truth and mirror phase state to file for visibility/recovery.

#### Files

- `packages/core/src/spec/state-file.ts` (new)
- `packages/core/src/tools/plan.ts` (update)

#### Diff

```diff
diff --git a/packages/core/src/spec/state-file.ts b/packages/core/src/spec/state-file.ts
new file mode 100644
--- /dev/null
+++ b/packages/core/src/spec/state-file.ts
@@
+import { promises as fs } from "fs";
+import path from "path";
+
+export type SpecPhase =
+  | "initialized"
+  | "planning"
+  | "compiled"
+  | "build-active";
+
+export interface SpecStateFile {
+  feature_name: string;
+  updated_at: string;
+  phase: SpecPhase;
+  approvals: {
+    requirements: { generated: boolean; approved: boolean };
+    design: { generated: boolean; approved: boolean };
+    tasks: { generated: boolean; approved: boolean };
+  };
+  runtime: {
+    mode: "plan" | "build";
+    current_task: string | null;
+  };
+}
+
+function defaultState(specSlug: string): SpecStateFile {
+  return {
+    feature_name: specSlug,
+    updated_at: new Date().toISOString(),
+    phase: "initialized",
+    approvals: {
+      requirements: { generated: false, approved: false },
+      design: { generated: false, approved: false },
+      tasks: { generated: false, approved: false },
+    },
+    runtime: {
+      mode: "plan",
+      current_task: null,
+    },
+  };
+}
+
+export async function readSpecState(specDir: string, specSlug: string): Promise<SpecStateFile> {
+  const file = path.join(specDir, "spec.json");
+  try {
+    const raw = await fs.readFile(file, "utf-8");
+    const parsed = JSON.parse(raw) as SpecStateFile;
+    return parsed;
+  } catch {
+    return defaultState(specSlug);
+  }
+}
+
+export async function writeSpecState(specDir: string, state: SpecStateFile): Promise<void> {
+  const file = path.join(specDir, "spec.json");
+  const next: SpecStateFile = {
+    ...state,
+    updated_at: new Date().toISOString(),
+  };
+  await fs.writeFile(file, JSON.stringify(next, null, 2) + "\n", "utf-8");
+}
+
+export async function patchSpecState(
+  specDir: string,
+  specSlug: string,
+  patch: Partial<SpecStateFile>
+): Promise<void> {
+  const prev = await readSpecState(specDir, specSlug);
+  const next: SpecStateFile = {
+    ...prev,
+    ...patch,
+    approvals: {
+      ...prev.approvals,
+      ...(patch.approvals ?? {}),
+    },
+    runtime: {
+      ...prev.runtime,
+      ...(patch.runtime ?? {}),
+    },
+  };
+  await writeSpecState(specDir, next);
+}
+
+export function inferTaskApprovalFlags(taskCount: number) {
+  return {
+    generated: taskCount > 0,
+    approved: false,
+  };
+}
```

```diff
diff --git a/packages/core/src/tools/plan.ts b/packages/core/src/tools/plan.ts
--- a/packages/core/src/tools/plan.ts
+++ b/packages/core/src/tools/plan.ts
@@
 import { writeSpecTemplate } from "../spec/templates";
+import { inferTaskApprovalFlags, patchSpecState } from "../spec/state-file";
@@
     await writeSpecTemplate(specDir, spec_slug, description);
+    await patchSpecState(specDir, spec_slug, {
+      phase: "planning",
+      runtime: { mode: "plan", current_task: null },
+    });
@@
     const compiled = await compileSpecToDb(specDir, specSlug);
@@
     const firstReadyTaskId = firstReadyMetadata?.spec?.taskId ?? null;
@@
     await transitionSessionMode({
       sessionId: instanceContext.sessionID,
       from: "plan",
       to: "build",
     });
+
+    await patchSpecState(specDir, specSlug, {
+      phase: "build-active",
+      approvals: {
+        requirements: { generated: true, approved: true },
+        design: { generated: true, approved: true },
+        tasks: inferTaskApprovalFlags(tasks.length),
+      },
+      runtime: {
+        mode: "build",
+        current_task: firstReadyTaskId,
+      },
+    });
```

---

### A2) Parser: support `(P)` marker and optional test subtask marker `- [ ]*`

#### Why adopt

- cc-sdd task semantics include explicit parallel cues and optional deferred test cues.
- We can parse and persist these as metadata without changing core readiness logic yet.

#### Files

- `packages/core/src/spec/parser.ts` (update)

#### Diff

```diff
diff --git a/packages/core/src/spec/parser.ts b/packages/core/src/spec/parser.ts
--- a/packages/core/src/spec/parser.ts
+++ b/packages/core/src/spec/parser.ts
@@
 export interface ParsedTask {
   id: string;
   title: string;
   requirements: string[];
   dependencies: string[];
+  parallel: boolean;
   outcome: string;
   notes: string;
   subtasks: string[];
+  hasOptionalTestSubtasks: boolean;
 }
@@
-function parseTaskBlock(id: string, title: string, body: string): ParsedTask {
+function parseTaskBlock(id: string, title: string, body: string): ParsedTask {
+  const parallel = /\(P\)\s*$/i.test(title);
+  const normalizedTitle = title.replace(/\s*\(P\)\s*$/i, "").trim();
   const task: ParsedTask = {
     id,
-    title,
+    title: normalizedTitle,
     requirements: [],
     dependencies: [],
+    parallel,
     outcome: "",
     notes: "",
     subtasks: [],
+    hasOptionalTestSubtasks: false,
   };
@@
-  const reqMatch = body.match(/\*\*Maps to requirements:\*\*\s*([\d,\sR\-]+)/i);
+  const reqMatch = body.match(/\*\*Maps?(?: to)? requirements?:\*\*\s*([\d,\sR\-]+)/i);
@@
-  const subtaskMatches = body.matchAll(/^\-\s*\[\s*\]\s+(.+)$/gm);
+  const subtaskMatches = body.matchAll(/^\-\s*\[\s*\](\*)?\s+(.+)$/gm);
   for (const match of subtaskMatches) {
-    task.subtasks.push(match[1].trim());
+    if (match[1] === "*") {
+      task.hasOptionalTestSubtasks = true;
+    }
+    task.subtasks.push(match[2].trim());
   }
@@
 export type ParsedTaskInput = Omit<ParsedTask, "dependencies"> & {
   dependencies?: string[];
 };
```

---

### A3) Compiler: persist parsed task metadata (`parallel`, `hasOptionalTestSubtasks`)

#### Why adopt

- Once parsed, metadata should survive compilation into DB to power status and scheduling UIs.

#### Files

- `packages/core/src/spec/compiler.ts` (update)

#### Diff

```diff
diff --git a/packages/core/src/spec/compiler.ts b/packages/core/src/spec/compiler.ts
--- a/packages/core/src/spec/compiler.ts
+++ b/packages/core/src/spec/compiler.ts
@@
 export interface SpecMetadata {
   spec: {
     slug: string;
     taskId: string;
     requirements: string[];
+    parallel?: boolean;
+    optionalTestSubtasks?: boolean;
   };
 }
@@
       const hasChanges =
         existing.title !== task.title ||
         existing.description !== task.outcome ||
-        existingSpec?.requirements?.join(",") !== task.requirements.join(",");
+        existingSpec?.requirements?.join(",") !== task.requirements.join(",") ||
+        !!existingSpec?.parallel !== !!task.parallel ||
+        !!existingSpec?.optionalTestSubtasks !== !!task.hasOptionalTestSubtasks;
@@
               spec: {
                 slug: specSlug,
                 taskId: task.id,
                 requirements: task.requirements,
+                parallel: task.parallel,
+                optionalTestSubtasks: task.hasOptionalTestSubtasks,
               },
             },
@@
           spec: {
             slug: specSlug,
             taskId: task.id,
             requirements: task.requirements,
+            parallel: task.parallel,
+            optionalTestSubtasks: task.hasOptionalTestSubtasks,
           },
         },
```

---

### A4) Plan exit: restore strict missing-file error behavior

#### Why adopt

- Current parser swallows ENOENT into empty array, so `plan_exit` cannot distinguish “missing file” from “empty file”.
- Better operator feedback and compatibility with tests/spec expectations.

#### Files

- `packages/core/src/spec/parser.ts` (update)
- `packages/core/src/tools/plan.ts` (minor simplification)

#### Diff

```diff
diff --git a/packages/core/src/spec/parser.ts b/packages/core/src/spec/parser.ts
--- a/packages/core/src/spec/parser.ts
+++ b/packages/core/src/spec/parser.ts
@@
 export async function parseTasksMd(tasksFilePath: string): Promise<ParsedTask[]> {
-  let content: string;
-  try {
-    content = await fs.readFile(tasksFilePath, "utf-8");
-  } catch {
-    return [];
-  }
+  const content = await fs.readFile(tasksFilePath, "utf-8");
@@
 }
+
+export async function parseTasksMdSafe(tasksFilePath: string): Promise<ParsedTask[]> {
+  try {
+    return await parseTasksMd(tasksFilePath);
+  } catch {
+    return [];
+  }
+}
```

```diff
diff --git a/packages/core/src/tools/plan.ts b/packages/core/src/tools/plan.ts
--- a/packages/core/src/tools/plan.ts
+++ b/packages/core/src/tools/plan.ts
@@
-    let tasks;
-    try {
-      tasks = await parseTasksMd(tasksFile);
-    } catch (err) {
+    let tasks;
+    try {
+      tasks = await parseTasksMd(tasksFile);
+    } catch (err) {
       const nodeErr = err as NodeJS.ErrnoException;
       if (nodeErr.code === "ENOENT") {
         throw new Error("tasks.md not found. Create it before exiting plan mode.");
       }
       throw err;
     }
```

(Functional change is in parser; plan tool remains readable and explicit.)

---

### A5) Add deterministic validation tool skeletons (runtime-first)

#### Why adopt

- We want cc-sdd-like quality gates, but with hard checks in code.

#### Files

- `packages/core/src/tools/validate.ts` (new)
- `packages/core/src/tools/registry.ts` (update)

#### Diff

```diff
diff --git a/packages/core/src/tools/validate.ts b/packages/core/src/tools/validate.ts
new file mode 100644
--- /dev/null
+++ b/packages/core/src/tools/validate.ts
@@
+import { tool as aiTool } from "ai";
+import { z } from "zod";
+import path from "path";
+import { Instance } from "../instance";
+import { getActiveSpec } from "../spec/helpers";
+import { parseTasksMdSafe, validateTaskDagFromParsed } from "../spec/parser";
+
+export const validateDesignTool = aiTool({
+  description: "Validate current spec design readiness using deterministic checks.",
+  inputSchema: z.object({ spec_slug: z.string().optional() }),
+  execute: async ({ spec_slug }) => {
+    const ctx = Instance.context;
+    if (!ctx) throw new Error("Instance context required");
+    const slug = spec_slug ?? (await getActiveSpec(ctx.sessionID));
+    if (!slug) throw new Error("No active spec");
+
+    const specDir = path.join(ctx.directory, ".kiro", "specs", slug);
+    const tasks = await parseTasksMdSafe(path.join(specDir, "tasks.md"));
+    const dag = validateTaskDagFromParsed(tasks);
+
+    return {
+      spec_slug: slug,
+      checks: {
+        tasks_present: tasks.length > 0,
+        dag_valid: dag.valid,
+      },
+      cycles: dag.cycles,
+    };
+  },
+});
+
+export const validateGapTool = aiTool({
+  description: "Validate requirement/task coverage gaps for current spec.",
+  inputSchema: z.object({ spec_slug: z.string().optional() }),
+  execute: async ({ spec_slug }) => ({ spec_slug, status: "not_implemented_yet" }),
+});
+
+export const validateImplTool = aiTool({
+  description: "Validate implementation readiness/completeness for current spec.",
+  inputSchema: z.object({ spec_slug: z.string().optional() }),
+  execute: async ({ spec_slug }) => ({ spec_slug, status: "not_implemented_yet" }),
+});
```

```diff
diff --git a/packages/core/src/tools/registry.ts b/packages/core/src/tools/registry.ts
--- a/packages/core/src/tools/registry.ts
+++ b/packages/core/src/tools/registry.ts
@@
 import { planEnterTool, planExitTool } from "./plan";
+import { validateDesignTool, validateGapTool, validateImplTool } from "./validate";
@@
   | "plan-enter"
   | "plan-exit"
+  | "validate-gap"
+  | "validate-design"
+  | "validate-impl"
   | "skill";
@@
   "plan-enter": planEnterTool,
   "plan-exit": planExitTool,
+  "validate-gap": validateGapTool,
+  "validate-design": validateDesignTool,
+  "validate-impl": validateImplTool,
```

---

## Skip: Patch Set S (Explicitly Reject)

### S1) Skip making markdown/spec.json the canonical execution source

#### Reason

- Would weaken correctness guarantees from DB-backed dependencies and session mode.

#### Skip diff

```diff
- // DO NOT replace getReadyTasks DB logic with markdown checkbox parsing
- // DO NOT treat spec.json approvals as sole runtime truth
```

Affected files to keep as-is:

- `packages/core/src/spec/helpers.ts`
- `packages/core/src/spec/compiler.ts`

---

### S2) Skip prompt-only enforcement for critical invariants

#### Reason

- Invariants like no cycles, valid requirement mappings, and mode transitions must remain executable checks.

#### Skip diff

```diff
- // DO NOT move DAG validation into agent prompt text only
- // DO NOT move mode transition checks into command prose only
```

Keep as-is (plus additive UX docs only):

- `packages/core/src/session/mode-transition.ts`
- `packages/core/src/tools/plan.ts`
- `packages/core/src/spec/parser.ts`

---

### S3) Skip auto-approval-by-default macro mode

#### Reason

- cc-sdd supports auto paths (`-y`, `--auto`), but defaulting to this in our runtime would reduce review quality.

#### Skip diff

```diff
- // DO NOT add spec-quick with auto-approve default
+ // If added later, interactive should be default; auto mode must be explicit and noisy.
```

Target files (future caution):

- `packages/core/src/tools/*`

---

### S4) Skip broad multi-agent packaging layer now

#### Reason

- Valuable, but not core to planner correctness. Adds maintenance overhead before workflow hardening lands.

#### Skip diff

```diff
- // DO NOT introduce manifest-driven multi-agent installer in this phase
+ // Revisit after planner UX and validation tools are stable.
```

---

## Recommended Execution Order

1. A4 (parser strictness fix) + tests
2. A2 + A3 (task metadata parsing/persistence)
3. A1 (spec state mirror)
4. A5 (validation tool skeletons)

Why this order:

- correctness and metadata first
- visibility next
- UX/validation wrappers after stable substrate

---

## Test Additions Required With This Diff

- Parser tests:
  - `(P)` marker parsing
  - `- [ ]*` optional test marker parsing
  - strict file-not-found behavior
- Compiler tests:
  - metadata persistence for `parallel` and `optionalTestSubtasks`
- Plan tests:
  - writes/updates `spec.json` mirror on enter/exit
- Tool registry tests:
  - new validation tools are registered

---

## Minimal Follow-up Patch (Optional)

After Patch Set A lands, add a status API/tool that merges:

- runtime mode (DB)
- ready task count (DB)
- spec phase/approvals (file mirror)

This gives cc-sdd-level operator visibility without giving up runtime rigor.
