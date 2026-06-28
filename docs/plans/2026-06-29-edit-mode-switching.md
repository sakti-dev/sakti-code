# Edit Mode Switching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to switch the edit tool mode (hashline <-> replace) mid-session without busting the system prompt cache.

**Architecture:** The edit tool's executor and parameters schema swap immediately (busts only the tools-tier cache, which is small and separate from the system prompt cache). The system prompt's `# Tool: edit` description stays frozen until compaction. A `<tool-schema-changed>` notification is injected via the steer queue (same pattern as `<skills-added>`) so the model knows the format changed. The notification reuses `renderToolSection` so its content is identical to what the system prompt will show after compaction.

**Tech Stack:** Hono REST, typebox validation, vitest, Effect-TS harness, `@sakti-code/tools`

---

## Key Design Decisions

1. **Cache tiers are separate**: The zai-anthropic provider places independent `cache_control` breakpoints on system (last system block) and tools (last tool definition). Changing the tools array busts only the tools-tier cache. The system prompt cache survives. (Verified in `packages/llm/src/provider/zai-anthropic/zai-language-model.ts:227-248`.)

2. **Immediate executor + schema swap, deferred description**: `swapTool()` replaces the tool in the registry so the next turn's request carries the new parameters schema and routes calls to the new executor. The system prompt description is deferred via `scheduleSystemPromptRefresh` (applied at compaction).

3. **Notification via steer queue**: Same mechanism as `announceSkillAdded` — a user message pushed to `steerQueue`, drained at the next turn boundary. Content uses `renderToolSection(tool)` so the model sees the exact same formatting it will see in the system prompt after compaction.

4. **Error bridge as fallback**: Smart models adapt from the notification alone. If a cheap model ignores it and emits confused calls, the new executor's existing validation returns clear errors explaining the expected format.

5. **`swapTool` vs `setTools`**: `setTools` replaces the entire tools Map and records an `active_tools_change` entry. `swapTool` replaces one tool by name, preserves `activeToolNames`, emits `tools_update` with `source: "swap"`, schedules prompt refresh, and announces — without recording an entry (the active tool names haven't changed).

6. **SnapshotStore sharing**: When swapping the edit tool, a fresh `createEditTool` call creates new `snapshotStore`/`noopOwner` instances. The read/write tools keep their originals. For hashline mode, the edit tool falls back to disk reads when no snapshot is found (correct, slightly less efficient). For replace mode, no snapshots are used. This tradeoff is acceptable for a rare user-initiated action.

---

## Task 1: Commit `renderToolSection` refactor

**Files:**
- Already modified: `packages/agent/src/resources/tool-inventory.ts`
- Already modified: `packages/agent/src/index.ts`

**Context:** `renderToolSection` was already extracted from `renderToolInventory` and exported. Verify tests pass and commit.

**Step 1: Run existing tests**

Run: `cd packages/agent && npx vitest run src/resources/__tests__/tool-inventory.test.ts`
Expected: 17 tests PASS

**Step 2: Typecheck**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add packages/agent/src/resources/tool-inventory.ts packages/agent/src/index.ts
git commit -m "refactor(agent): extract renderToolSection from renderToolInventory

Reusable single-tool rendering for mid-session tool-change notifications.
renderToolInventory now delegates to renderToolSection per tool."
```

---

## Task 2: Add `swapTool` method to AgentHarness

**Files:**
- Modify: `packages/agent/src/agent/agent-harness.ts`
- Test: `packages/agent/src/agent/__tests__/agent-harness.test.ts`

**Context:** `swapTool(name, newTool)` replaces one tool in the registry. It preserves `activeToolNames`, emits `tools_update` with `source: "swap"`, schedules a prompt refresh, and announces the change. The method is async (like `setTools`) to allow the event emission to complete.

### Step 1: Write failing tests

Add a new `describe("swapTool")` block in `agent-harness.test.ts`. Tests:

1. **swaps tool implementation, preserves activeToolNames**: Create harness with `[calculateTool, getCurrentTimeTool]`. Call `swapTool("calculate", calculateTool)` (same tool, simulates swap). Assert `getActiveTools()` still returns both tools in the same order. Assert `getTools()` returns the new tool object.

2. **schedules prompt refresh**: Create harness with composed system prompt. Call `swapTool("calculate", newCalculateTool)`. Assert `getPendingSystemPromptRefresh()` is defined and contains the new tool's description (via `renderToolSection`).

3. **announces via steer queue**: Call `swapTool("calculate", newTool)` while a turn is in flight (or idle — the announce uses the steerQueue which works in both states). Assert the steerQueue message contains `<tool-schema-changed>` and the tool's description text.

4. **throws when name mismatch**: Call `swapTool("calculate", toolWithName("other"))`. Assert it throws with `invalid_argument`.

5. **throws when tool not found**: Call `swapTool("nonexistent", anyTool)`. Assert it throws with `invalid_argument`.

6. **emits tools_update event**: Subscribe to events. Call `swapTool`. Assert a `tools_update` event with `source: "swap"` was emitted.

Use the existing test patterns from the `softDisableTool prompt refresh` describe block for harness setup (registerFauxStreamProvider, createTestSession, etc.).

**Step 2: Run tests to verify they fail**

Run: `cd packages/agent && npx vitest run src/agent/__tests__/agent-harness.test.ts -t "swapTool"`
Expected: FAIL — `swapTool` is not a function

### Step 3: Implement `swapTool`

In `agent-harness.ts`, add the method near `setTools` (after line 1651):

```ts
/**
 * Replace a single tool's implementation while preserving activeToolNames.
 *
 * The new tool must have the same `name` as the one being replaced. The
 * tools-tier cache busts on the next request (new parameters schema), but
 * the system prompt cache survives — the `# Tool:` description stays frozen
 * until the next compaction applies the scheduled refresh.
 *
 * Announces the change via a `<tool-schema-changed>` user message on the
 * steer queue so the model knows the format changed.
 *
 * Use this for mid-session tool reconfiguration (e.g. switching edit mode
 * from hashline to replace) where the tool stays active but its contract
 * changes.
 */
async swapTool(name: string, newTool: TTool): Promise<void> {
  if (newTool.name !== name) {
    throw new AgentHarnessError({
      code: "invalid_argument",
      message: `swapTool: newTool.name "${newTool.name}" must match "${name}"`,
    });
  }
  if (!this.tools.has(name)) {
    throw new AgentHarnessError({
      code: "invalid_argument",
      message: `swapTool: tool "${name}" not found in registry`,
    });
  }
  const previousToolNames = [...this.tools.keys()];
  const previousActiveToolNames = [...this.activeToolNames];
  this.tools.set(name, newTool);
  this.scheduleSystemPromptRefresh(this.recomposeSystemPrompt());
  this.announceToolChange(newTool);
  void this.emitOwn({
    type: "tools_update",
    toolNames: [...this.tools.keys()],
    previousToolNames,
    activeToolNames: [...this.activeToolNames],
    previousActiveToolNames,
    source: "swap",
  });
}
```

Also add the private `announceToolChange` helper near `announceSkillAdded` (after line 1172). Import `renderToolSection` from `../resources/tool-inventory`:

```ts
import { renderToolSection } from "../resources/tool-inventory";

/**
 * Push a `<tool-schema-changed>` notice onto the steer queue so the model
 * knows a tool's format has changed. The notice includes the full
 * {@link renderToolSection} output — identical to what the system prompt
 * will show after compaction.
 *
 * Safe to call while idle (same as {@link announceSkillAdded}).
 */
private announceToolChange(tool: TTool): void {
  const notice = [
    "<tool-schema-changed>",
    `The "${tool.name}" tool has been updated. The previous format is no longer active. Use the updated format below:`,
    "",
    renderToolSection(tool),
    "</tool-schema-changed>",
  ].join("\n");
  this.steerQueue.push(createUserMessage(notice));
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/agent && npx vitest run src/agent/__tests__/agent-harness.test.ts -t "swapTool"`
Expected: PASS

**Step 5: Commit (RED — tests fail pre-implementation)**

Since we're implementing + testing in one task, use `--no-verify` is NOT needed if all tests pass.

```bash
git add packages/agent/src/agent/agent-harness.ts packages/agent/src/agent/__tests__/agent-harness.test.ts
git commit -m "feat(agent): add swapTool for mid-session tool implementation swap

Replaces one tool in the registry, preserving activeToolNames. Schedules
prompt refresh (deferred to compaction) and announces via steer queue
using renderToolSection for content consistency with the system prompt."
```

---

## Task 3: Add `EditMode` parameter to `buildTools`

**Files:**
- Modify: `apps/server/src/agent/tools-builder.ts`
- Test: `apps/server/src/agent/__tests__/tools-builder.test.ts` (new file)

**Context:** `buildTools` currently hardcodes `mode: "hashline"`. Add an optional `editMode` parameter defaulting to `"hashline"`.

### Step 1: Write failing test

Create `apps/server/src/agent/__tests__/tools-builder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildTools } from "../tools-builder";

describe("buildTools", () => {
  it("defaults to hashline mode", () => {
    const tools = buildTools("/tmp");
    const edit = tools.find((t) => t.name === "edit");
    expect(edit).toBeDefined();
    expect(edit!.description).toContain("SWAP"); // hashline-specific
  });

  it("produces replace-mode edit tool when requested", () => {
    const tools = buildTools("/tmp", "replace");
    const edit = tools.find((t) => t.name === "edit");
    expect(edit).toBeDefined();
    expect(edit!.description).toContain("oldText"); // replace-specific
    expect(edit!.description).not.toContain("SWAP");
  });

  it("produces hashline-mode edit tool when requested", () => {
    const tools = buildTools("/tmp", "hashline");
    const edit = tools.find((t) => t.name === "edit");
    expect(edit).toBeDefined();
    expect(edit!.description).toContain("SWAP");
  });

  it("always includes read, write, edit, bash, grep, find, ls", () => {
    const tools = buildTools("/tmp");
    const names = tools.map((t) => t.name);
    expect(names).toContain("read");
    expect(names).toContain("write");
    expect(names).toContain("edit");
    expect(names).toContain("bash");
    expect(names).toContain("grep");
    expect(names).toContain("find");
    expect(names).toContain("ls");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/agent/__tests__/tools-builder.test.ts`
Expected: FAIL — `buildTools` doesn't accept a second argument

### Step 3: Implement

In `tools-builder.ts`:

```ts
import type { EditMode } from "@sakti-code/tools";

export function buildTools(cwd: string, editMode: EditMode = "hashline"): AgentTool[] {
  const snapshotStore = new InMemorySnapshotStore();
  const noopOwner: NoopLoopGuardOwner = {};
  return [
    createReadTool(cwd, { autoResizeImages: true, snapshotStore }),
    createWriteTool(cwd, { snapshotStore }),
    createEditTool(cwd, { mode: editMode, snapshotStore, noopOwner }),
    createBashTool(cwd),
    createGrepTool(cwd),
    createFindTool(cwd),
    createLsTool(cwd),
  ] as AgentTool[];
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/agent/__tests__/tools-builder.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/agent/tools-builder.ts apps/server/src/agent/__tests__/tools-builder.test.ts
git commit -m "feat(server): accept editMode parameter in buildTools"
```

---

## Task 4: Add `resolveEditMode` helper + reorder `runPrompt`

**Files:**
- Modify: `apps/server/src/agent/runner.ts`
- Test: `apps/server/src/agent/__tests__/runner.test.ts`

**Context:** Add `resolveEditMode(ctx, sessionId)` mirroring `resolveThinkingLevel`. Reorder `runPrompt` so settings are loaded before `buildTools`.

### Step 1: Write failing test

Add to `runner.test.ts`:

```ts
import { resolveEditMode } from "../runner";

describe("resolveEditMode", () => {
  it("returns stored mode when set", async () => {
    const { ctx, sessionId } = await setupTestContext();
    ctx.repos.settings.set(`session:${sessionId}:edit_mode`, "replace");
    expect(resolveEditMode(ctx, sessionId)).toBe("replace");
  });

  it("defaults to hashline when not set", async () => {
    const { ctx, sessionId } = await setupTestContext();
    expect(resolveEditMode(ctx, sessionId)).toBe("hashline");
  });
});
```

Use the existing test helpers from `runner.test.ts` for context setup. If no helper exists, construct a minimal `ServerContext` with an in-memory settings repo.

**Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/agent/__tests__/runner.test.ts -t "resolveEditMode"`
Expected: FAIL — `resolveEditMode` is not exported

### Step 3: Implement

In `runner.ts`, add near `resolveThinkingLevel` (after line 345):

```ts
import type { EditMode } from "@sakti-code/tools";

export function resolveEditMode(
  ctx: ServerContext,
  sessionId: string
): EditMode {
  const row = ctx.repos.settings.get(`session:${sessionId}:edit_mode`);
  if (row === "hashline" || row === "replace") {
    return row;
  }
  return "hashline";
}
```

In `runPrompt`, reorder so settings load before `buildTools` (around line 455):

```ts
const settings = loadSessionSettings(ctx, sessionId);
const editMode = resolveEditMode(ctx, sessionId);
const tools = buildTools(project.cwd, editMode);
```

(Move the `loadSessionSettings` call from line 460 to before `buildTools` at line 455.)

**Step 4: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/agent/__tests__/runner.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/agent/runner.ts apps/server/src/agent/__tests__/runner.test.ts
git commit -m "feat(server): resolveEditMode + wire into runPrompt"
```

---

## Task 5: Add `setEditModeForSession` dual-layer helper

**Files:**
- Modify: `apps/server/src/agent/runner.ts`
- Test: `apps/server/src/agent/__tests__/runner.test.ts`

**Context:** Mirrors `switchAgentForSession` — persists to settings table (Layer 1) + applies to live harness via `swapTool` (Layer 2).

### Step 1: Write failing test

Add to `runner.test.ts`:

```ts
import { setEditModeForSession } from "../runner";

describe("setEditModeForSession", () => {
  it("persists mode to settings table", async () => {
    const { ctx, sessionId } = await setupTestContext();
    await setEditModeForSession(ctx, sessionId, "replace");
    const stored = ctx.repos.settings.get(`session:${sessionId}:edit_mode`);
    expect(stored).toBe("replace");
  });

  it("returns false for unknown session", async () => {
    const { ctx } = await setupTestContext();
    const result = await setEditModeForSession(ctx, "nonexistent", "replace");
    expect(result).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/agent/__tests__/runner.test.ts -t "setEditModeForSession"`
Expected: FAIL — `setEditModeForSession` is not exported

### Step 3: Implement

In `runner.ts`, add near `switchAgentForSession` (after line 417):

```ts
export async function setEditModeForSession(
  ctx: ServerContext,
  sessionId: string,
  mode: EditMode
): Promise<boolean> {
  const session = await ctx.repos.sessions.findById(sessionId);
  if (!session) {
    return false;
  }

  // Layer 1: persist (survives restart)
  await ctx.repos.settings.set(`session:${sessionId}:edit_mode`, mode);

  // Layer 2: live apply (swap executor + schema immediately, defer
  // description to compaction)
  const harness = getActiveHarness(sessionId);
  if (harness) {
    const project = await ctx.repos.projects.findById(session.projectId);
    if (project) {
      const newTools = buildTools(project.cwd, mode);
      const newEditTool = newTools.find((t) => t.name === "edit");
      if (newEditTool) {
        await harness.swapTool("edit", newEditTool);
      }
    }
  }
  return true;
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/agent/__tests__/runner.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/agent/runner.ts apps/server/src/agent/__tests__/runner.test.ts
git commit -m "feat(server): setEditModeForSession dual-layer helper

Persists edit mode to settings (Layer 1) + swaps the live edit tool
implementation via harness.swapTool (Layer 2). System prompt description
stays frozen until compaction."
```

---

## Task 6: Create edit-mode route module

**Files:**
- Create: `apps/server/src/routes/sessions/edit-mode.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/src/routes/sessions/__tests__/edit-mode.test.ts` (new file)

**Context:** `GET /api/sessions/:id/edit-mode` and `PUT /api/sessions/:id/edit-mode` with typebox validation. Follows the `session-settings.ts` and `skills.ts` patterns.

### Step 1: Write failing test

Create `apps/server/src/routes/sessions/__tests__/edit-mode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
// Use the existing test app builder pattern from other route tests

describe("PUT /api/sessions/:id/edit-mode", () => {
  it("returns 404 for unknown session", async () => {
    // ...
    expect(res.status).toBe(404);
  });

  it("persists mode and returns 200", async () => {
    // ...
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("replace");
  });

  it("rejects invalid mode", async () => {
    // ...
    expect(res.status).toBe(400);
  });
});

describe("GET /api/sessions/:id/edit-mode", () => {
  it("returns stored mode", async () => {
    // ...
    const body = await res.json();
    expect(body.mode).toBe("replace");
  });

  it("returns default hashline when not set", async () => {
    // ...
    const body = await res.json();
    expect(body.mode).toBe("hashline");
  });
});
```

Look at existing route tests (e.g. `skills.test.ts` or `session-settings.test.ts`) for the test app setup pattern.

**Step 2: Run test to verify it fails**

Run: `cd apps/server && npx vitest run src/routes/sessions/__tests__/edit-mode.test.ts`
Expected: FAIL — route doesn't exist

### Step 3: Implement route module

Create `apps/server/src/routes/sessions/edit-mode.ts`:

```ts
import { tbValidator } from "@hono/typebox-validator";
import { Hono } from "hono";
import Type from "typebox";
import { setEditModeForSession } from "../../agent/runner.ts";
import { getCtx } from "../../context.ts";

const body = Type.Object({
  mode: Type.Union([Type.Literal("hashline"), Type.Literal("replace")]),
});

export const editModeRoutes = new Hono()
  .basePath("/sessions")
  .get("/:id/edit-mode", async (c) => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const row = ctx.repos.settings.get(`session:${id}:edit_mode`);
    return c.json({ mode: row ?? "hashline" });
  })
  .put(
    "/:id/edit-mode",
    tbValidator("json", body),
    async (c) => {
      const ctx = getCtx(c);
      const id = c.req.param("id");
      const { mode } = c.req.valid("json");
      const session = await ctx.repos.sessions.findById(id);
      if (!session) {
        return c.json({ error: "Not found" }, 404);
      }
      const ok = await setEditModeForSession(ctx, id, mode);
      return ok ? c.json({ mode }) : c.json({ error: "Not found" }, 404);
    }
  );
```

Register in `app.ts`:

```ts
import { editModeRoutes } from "./routes/sessions/edit-mode.ts";
// ...
.route("/", editModeRoutes)  // add after sessionSettingsRoutes
```

**Step 4: Run test to verify it passes**

Run: `cd apps/server && npx vitest run src/routes/sessions/__tests__/edit-mode.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/routes/sessions/edit-mode.ts apps/server/src/routes/sessions/__tests__/edit-mode.test.ts apps/server/src/app.ts
git commit -m "feat(server): GET/PUT /api/sessions/:id/edit-mode route"
```

---

## Task 7: Full verification

**Step 1: Typecheck all packages**

Run: `pnpm run typecheck`
Expected: all 7 packages pass

**Step 2: Run all test suites**

```bash
cd packages/agent && pnpm run test
cd packages/tools && pnpm run test
cd packages/db && pnpm run test
cd apps/server && pnpm run test
```

Expected: all green (except pre-existing known failures: compaction.test.ts POST compact, e2e multi-session timing)

**Step 3: Run lint + format**

Run: `pnpm run fix`
Expected: no errors

**Step 4: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: lint fixes"  # only if needed
```

---

## Future Considerations (Not In Scope)

- **Desktop UI**: A toggle in the session settings to switch edit mode. The API contract is already defined (`GET/PUT /api/sessions/:id/edit-mode`).
- **SnapshotStore sharing optimization**: Pass the original `snapshotStore` to the new edit tool so hashline snapshots from reads persist across mode switches. Currently each swap creates a fresh edit tool with its own stores.
- **Undo mode switch**: A `DELETE /api/sessions/:id/edit-mode` to revert to default (hashline).
- **Per-project default**: Read the default edit mode from project config (`.sakti/config.json`) instead of hardcoding `"hashline"` in `resolveEditMode`.
