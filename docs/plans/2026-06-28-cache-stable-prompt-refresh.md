# Cache-Stable Prompt Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add four primitives to `AgentHarness` that let users add/remove skills and tools mid-session without silently busting the prompt-cache prefix — by deferring prefix-affecting changes to compaction (free) or routing them through turn-tail notices (also free) or execute-time gates (also free). Plus the persistent substrate (per-session `disabled_skills` in the existing `settings` table) so disable-intent survives app restart.

**Architecture:** Two layers, kept separate:

- **Layer 1 (persistent state — Task 1)**: _which skills are disabled for this session_. Lives in the existing `settings` table under the keyed prefix `session:<id>:disabled_skill:<name>`. On restart, `loadAgentContext` rescans disk and the runner filters out disabled names before `appendSkillsBlock` recomposes the prompt — so the harness is built in the correct state with no in-memory pending swap needed.
- **Layer 2 (in-session cache optimization — Tasks 2-7)**: primitives on `AgentHarness` itself. These have the lifespan of "until the next compaction OR restart, whichever comes first". If restart comes first, they're correctly a no-op because Layer 1 has already produced the right prompt.

The harness already stores `systemPrompt` as a frozen string per session (Reasonix §1 — satisfied). The new Layer-2 mechanisms are:

1. **Pending system-prompt refresh** — schedule a prompt swap; drained automatically when compaction runs (compaction busts cache anyway). For "disable skill" / "change agent policy" / "change locale" — anything that mutates the system-prompt bytes.
2. **`<skills-added>` turn-tail notice** — push a steering message advertising newly-installed skills. Cache stays warm because skill _bodies_ aren't in the prompt (only the advertisement is, and the model can read the body on-demand via `read`).
3. **Soft-disable tool gate** — keep the tool's schema in `activeToolNames` (cache stays warm) but block execution via the existing `beforeToolCall` hook. For MCP / side-effecting tools the user wants gone _now_.
4. **`cache_bust_pending` event** — emitted whenever a change would bust the cache, so the UI can show "compact recommended" alerts.

The "apply now (cache bust)" path needs no new code — it's just `switchAgent`/`setResources` as today.

**Tech Stack:** TypeScript (ESM), `effect`, `vitest`, existing `AgentHarness`. No new dependencies.

**Design references (read before starting):**

- `openspec/references/reasonix-cache-design.md` — the §1-§13 conceptual map. This plan implements a subset: §1 (verified), §2 (turn-tail notice), §4 (drain on compaction), §9 (execute-time gate).
- `packages/agent/src/agent/agent-harness.ts` — the harness. Key spots:
  - `createTurnStateEffect` (line 445-488) — reads `this.systemPrompt` verbatim every turn (string is frozen ✓).
  - `prepareNextTurn` (line 644-653) — re-derives turn state between turns.
  - `compact()` method (line ~1140-1233) — runs compaction, emits `session_compact` event.
  - `beforeToolCall` hook (line 614-624) — already returns `{block, reason}` ✓.
  - `steerQueue` (line 263) + `getSteeringMessages` (line 654-655) — drains into next turn as user message ✓.
  - `setResources()` (line 1608) — replaces skills/promptTemplates.
  - `setActiveTools()` (line 1551) — hard-removes tools from active set (cache-bust).
- `packages/agent/src/resources/system-prompt.ts` — `appendSkillsBlock` composes skills advertisement into the prompt.

**Conventions (from repo `AGENTS.md`):**

- TDD: failing test → implement → pass → commit.
- Tests colocated in `__tests__/`. `vitest`. No `.only`/`.skip`.
- `exactOptionalPropertyTypes: true` → use conditional spread `...(x !== undefined ? { x } : {})`, never pass `undefined`.
- `for...of` over `.forEach()`. Arrow callbacks. `const` by default.
- Verify each task: `cd packages/agent && pnpm run typecheck && pnpm run test`.

**Scope (v1 — DO implement):**

- **Persistent `disabled_skills` per session** (Layer 1) — keyed-prefix DB entries + filter in `loadAgentContext`/`runPrompt`.
- Pending refresh + drain on compact
- `<skills-added>` steering notice
- Soft-disable tool gate
- `cache_bust_pending` event
- `removeSkill(name)` convenience API (composes pending-refresh + soft-disable of `read` on that skill path)
- `addSkill(skill)` convenience API (composes `setResources` + steering notice)
- Server routes that write to DB AND call the harness methods

**Scope (v1 — do NOT implement):**

- UI alert rendering (separate desktop task — user explicitly deferred).
- MCP server integration (no MCP exists yet; when added, use these primitives).
- Cache-shape diagnostics / PrefixShape hashing (separate future plan, see reasonix doc §10).
- Byte-stability regression test suite (separate future plan, see reasonix doc §11).
- Applying pending refresh outside of compaction (the "apply now" path uses existing `switchAgent`/`setResources` directly — no new API).

---

### Task 1: Persistent `disabled_skills` substrate (DB + filter)

The foundation. Without this, every "disable skill" action is forgotten on restart. The mechanism is deliberately simple: keyed-prefix entries in the existing `settings` table + a filter in `runPrompt`. All other tasks build on top.

**Files:**

- Modify: `apps/server/src/agent/runner.ts` — add `loadDisabledSkills` helper, add filter between `loadAgentContext` and `appendSkillsBlock`
- Test: `apps/server/src/agent/__tests__/runner.test.ts` — add unit test for the helper

**Why keyed-prefix and not a JSON array**: matches the existing `getByPrefix` pattern that powers `loadSessionSettings` (`runner.ts:204`). Each disable/enable is a single key write/delete (atomic) instead of a read-modify-write cycle. No JSON parsing.

**Key shape**: `session:<id>:disabled_skill:<name>` → value `"1"`. The skill name is the suffix after `session:<id>:disabled_skill:`.

**Step 1: Write the failing test**

Append to `apps/server/src/agent/__tests__/runner.test.ts`:

```ts
describe("loadDisabledSkills", () => {
  it("returns the set of disabled skill names for a session", async () => {
    const { ctx, cleanup } = await makeTestContext();
    try {
      await ctx.repos.settings.set("session:sess-1:disabled_skill:graphify", "1");
      await ctx.repos.settings.set("session:sess-1:disabled_skill:old-thing", "1");
      // Unrelated session — must not leak
      await ctx.repos.settings.set("session:sess-2:disabled_skill:graphify", "1");

      const result = loadDisabledSkills(ctx, "sess-1");
      expect(result).toEqual(new Set(["graphify", "old-thing"]));
    } finally {
      await cleanup();
    }
  });

  it("returns an empty set when nothing is disabled", async () => {
    const { ctx, cleanup } = await makeTestContext();
    try {
      const result = loadDisabledSkills(ctx, "sess-empty");
      expect(result.size).toBe(0);
    } finally {
      await cleanup();
    }
  });
});
```

(Adjust `makeTestContext` to match the existing pattern in `runner.test.ts` — see the `loadSessionSettings reads per-session settings via getByPrefix` test around line 113 for the exact fixture shape used in this file. Import `loadDisabledSkills` from `runner.ts` at the top.)

**Step 2: Run — verify it fails**

```bash
cd apps/server && pnpm run test -- "loadDisabledSkills"
```

Expected: FAIL — `loadDisabledSkills is not a function` (or import error).

**Step 3: Implement the helper**

In `apps/server/src/agent/runner.ts`, near `loadSessionSettings` (line 199-211):

```ts
/**
 * Load the set of disabled skill names for a session.
 *
 * Disabled skills are stored as keyed-prefix entries in the settings table:
 *   session:<id>:disabled_skill:<name> = "1"
 *
 * This is the persistent substrate that survives app restart. On restart,
 * `loadAgentContext` rescans disk for skill files; the runner then filters
 * out names in this set before composing the harness system prompt via
 * `appendSkillsBlock`. The harness therefore starts in the correct state
 * without any in-memory pending-refresh state needed.
 *
 * Keyed-prefix (not JSON array) so each enable/disable is a single key
 * write/delete — atomic, no read-modify-write cycle.
 */
export function loadDisabledSkills(ctx: ServerContext, sessionId: string): Set<string> {
  const prefix = `session:${sessionId}:disabled_skill:`;
  const rows = ctx.repos.settings.getByPrefix(prefix);
  const names = new Set<string>();
  for (const row of rows) {
    // Suffix after the prefix is the skill name.
    const name = row.key.slice(prefix.length);
    if (name.length > 0) {
      names.add(name);
    }
  }
  return names;
}

/** Persist a skill-disable for this session (idempotent). */
export async function persistSkillDisabled(
  ctx: ServerContext,
  sessionId: string,
  skillName: string,
): Promise<void> {
  await ctx.repos.settings.set(`session:${sessionId}:disabled_skill:${skillName}`, "1");
}

/** Remove a skill-disable for this session (idempotent). */
export async function persistSkillEnabled(
  ctx: ServerContext,
  sessionId: string,
  skillName: string,
): Promise<void> {
  await ctx.repos.settings.delete(`session:${sessionId}:disabled_skill:${skillName}`);
}
```

Check the existing `ctx.repos.settings.delete` method exists; if not, use the existing `set` pattern with a tombstone, or extend the repo (see `packages/db/src/repos/`). Most likely there's already a `delete(key)` since `settings` is a simple key-value table.

**Step 4: Run — verify it passes**

```bash
cd apps/server && pnpm run typecheck && pnpm run test -- "loadDisabledSkills"
```

Expected: PASS.

**Step 5: Add the filter to `runPrompt`**

In `apps/server/src/agent/runner.ts`, locate the prompt-composition block (`runner.ts:368-426`):

```ts
const loadedContext = await loadAgentContext(project.cwd);
// ...
const hasRead = agent.activeToolNames === undefined || agent.activeToolNames.includes("read");
const composedSystemPrompt = appendSkillsBlock(
  agent.systemPrompt,
  loadedContext.skills, // ← currently passes ALL loaded skills
  hasRead,
);
```

Modify to filter:

```ts
const loadedContext = await loadAgentContext(project.cwd);
// Layer 1: filter out skills disabled for this session (persistent state).
// Layer 2 (harness.scheduleSystemPromptRefresh) handles in-session disables.
const disabledSkills = loadDisabledSkills(ctx, sessionId);
const activeSkills = loadedContext.skills.filter((s) => !disabledSkills.has(s.name));
// ...
const hasRead = agent.activeToolNames === undefined || agent.activeToolNames.includes("read");
const composedSystemPrompt = appendSkillsBlock(
  agent.systemPrompt,
  activeSkills, // ← filtered
  hasRead,
);
```

Also pass `activeSkills` (not `loadedContext.skills`) into the `harness` constructor's `resources.skills`:

```ts
const harness = new HarnessClass({
  // ...
  resources: {
    skills: activeSkills, // ← was loadedContext.skills
    promptTemplates: loadedContext.commands,
  },
});
```

This is the load-time integration. No new test — covered by the route integration test in Task 8.

**Step 6: Manual verification**

Start a server, create a session, prompt it (skill X advertised in `<available_skills>`). Disable skill X via DB write:

```sql
INSERT INTO settings (key, value, updated_at) VALUES
  ('session:<id>:disabled_skill:X', '1', strftime('%s','now'));
```

Restart the server, prompt the same session, observe `<available_skills>` no longer contains X. (Automated integration test lands in Task 8.)

**Step 7: Commit**

```bash
git add apps/server/src/agent/runner.ts apps/server/src/agent/__tests__/runner.test.ts
git commit -m "feat(server): persist disabled_skills per session + filter at load"
```

---

### Task 2: Add `pendingSystemPromptRefresh` field + `scheduleSystemPromptRefresh()` API

This is the defer-mechanism (Layer 2). It just stores a pending string; nothing drains it yet (that's Task 3).

**Files:**

- Modify: `packages/agent/src/agent/agent-harness.ts` — add field, method, and clearing on `switchAgent`/`setResources`-induced prompt changes
- Test: `packages/agent/src/agent/__tests__/agent-harness.test.ts`

**Step 1: Write the failing test**

Append to `packages/agent/src/agent/__tests__/agent-harness.test.ts`:

```ts
describe("scheduleSystemPromptRefresh", () => {
  it("stores a pending prompt swap without affecting the current turn", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    const captured: string[] = [];
    registration.setResponses([
      (req) => {
        captured.push(req.system ?? "");
        return fauxAssistantMessage("ok");
      },
    ]);
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      systemPrompt: "original prompt",
    });

    harness.scheduleSystemPromptRefresh("new prompt");
    expect(harness.getPendingSystemPromptRefresh()).toBe("new prompt");

    await harness.prompt("hello");

    // Current turn still uses the original prompt — refresh is deferred.
    expect(captured).toEqual(["original prompt"]);
  });

  it("clears pending refresh when switchAgent applies a new prompt immediately", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      systemPrompt: "original",
    });

    harness.scheduleSystemPromptRefresh("pending");
    await harness.switchAgent({
      name: "x",
      systemPrompt: "applied now",
      permission: undefined,
    });

    expect(harness.getPendingSystemPromptRefresh()).toBeUndefined();
  });
});
```

**Step 2: Run — verify it fails**

```bash
cd packages/agent && pnpm run test -- agent-harness.test scheduleSystemPromptRefresh
```

Expected: FAIL — `harness.scheduleSystemPromptRefresh is not a function`.

**Step 3: Implement**

In `packages/agent/src/agent/agent-harness.ts`:

3a. Add the field near the other private fields (around line 243, after `private systemPrompt`):

```ts
  private pendingSystemPromptRefresh: string | undefined;
```

3b. Add public methods. Place these near `switchAgent` (around line 1665):

```ts
  /**
   * Schedule a system-prompt swap to take effect at the next compaction.
   *
   * The current session's cached prefix stays warm until compaction runs (compaction
   * busts the cache anyway, so the swap is free there). Use this for any change that
   * would otherwise rewrite the prompt mid-session: disabling a skill, changing
   * locale, changing output style. For changes the user wants immediately, call
   * `switchAgent` directly — that applies now at the cost of one cold turn.
   *
   * Emits a `cache_bust_pending` event so the UI can show an alert recommending
   * compaction. The pending swap is cleared if `switchAgent` supersedes it.
   */
  scheduleSystemPromptRefresh(next: string): void {
    this.pendingSystemPromptRefresh = next;
  }

  /** Returns the pending refresh string, if any. Test/debug hook. */
  getPendingSystemPromptRefresh(): string | undefined {
    return this.pendingSystemPromptRefresh;
  }

  /** Clears the pending refresh. Internal; called when compaction drains it
   *  or when switchAgent supersedes it. */
  clearPendingSystemPromptRefresh(): void {
    this.pendingSystemPromptRefresh = undefined;
  }
```

3c. Clear pending in `switchAgent` (around line 1665-1674). Modify the method body:

```ts
  async switchAgent(agent: AgentDefinition): Promise<void> {
    this.currentAgent = agent;
    this.systemPrompt = agent.systemPrompt;
    this.clearPendingSystemPromptRefresh();  // ← new line
    if (agent.thinkingLevel !== undefined) {
      await this.setThinkingLevel(agent.thinkingLevel);
    }
    if (agent.activeToolNames !== undefined) {
      await this.setActiveTools(agent.activeToolNames);
    }
  }
```

**Step 4: Run — verify it passes**

```bash
cd packages/agent && pnpm run test -- agent-harness.test scheduleSystemPromptRefresh
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent/src/agent/agent-harness.ts packages/agent/src/agent/__tests__/agent-harness.test.ts
git commit -m "feat(agent): scheduleSystemPromptRefresh defers prompt swap"
```

---

### Task 3: Drain pending refresh when compaction completes

Wire the drain into `compact()` so the next turn after compaction picks up the new prompt automatically.

**Files:**

- Modify: `packages/agent/src/agent/agent-harness.ts` — drain in the `compact()` method
- Test: `packages/agent/src/agent/__tests__/agent-harness.test.ts`

**Step 1: Write the failing test**

Append to the `scheduleSystemPromptRefresh` describe block:

```ts
it("drains pending refresh during compaction (next turn uses new prompt)", async () => {
  const registration = registerFauxStreamProvider();
  registrations.push(registration);
  const captured: string[] = [];
  registration.setResponses([
    // Compaction summarizer call — systemPrompt is the summarizer prompt,
    // not the harness prompt, so we don't capture here.
    () => fauxAssistantMessage("compact summary"),
    // Post-compaction turn — should see the new prompt.
    (req) => {
      captured.push(req.system ?? "");
      return fauxAssistantMessage("ok");
    },
  ]);
  const harness = new AgentHarness({
    env: new TestExecutionEnv(process.cwd()),
    session: await createTestSession(),
    model: registration.getModel(),
    streamFn: registration.streamFn,
    systemPrompt: "original",
    getApiKeyAndHeaders: async () => ({ apiKey: "test-key" }),
  });

  harness.scheduleSystemPromptRefresh("refreshed");
  await harness.compact();

  expect(harness.getPendingSystemPromptRefresh()).toBeUndefined();
  expect(harness.state.systemPrompt).toBe("refreshed");

  await harness.prompt("next turn after compact");
  expect(captured).toEqual(["refreshed"]);
});
```

**Step 2: Run — verify it fails**

```bash
cd packages/agent && pnpm run test -- "drains pending refresh during compaction"
```

Expected: FAIL — `harness.state.systemPrompt` is still "original".

**Step 3: Implement**

In `packages/agent/src/agent/agent-harness.ts`, locate the `compact()` method (around line 1140). Find the spot just before `return result;` (around line 1225) and add the drain:

```ts
const entry = yield * self.session.getEntry(entryId);
if (entry?.type === "compaction") {
  yield *
    Effect.promise(() =>
      self.emitOwn({
        type: "session_compact",
        compactionEntry: entry,
        fromHook: provided !== undefined,
      }),
    );
}

// Drain pending system-prompt refresh: compaction busts the cache
// anyway, so this is the free moment to swap the prefix bytes.
if (self.pendingSystemPromptRefresh !== undefined) {
  self.systemPrompt = self.pendingSystemPromptRefresh;
  self.clearPendingSystemPromptRefresh();
}

return result;
```

Also add a public getter on `state.systemPrompt` if not already present (check the `get state()` accessor — it should already expose `systemPrompt` from `_state`; for `AgentHarness` the field is read directly as `this.systemPrompt`, so the test should adjust to read `harness.systemPrompt` if `state.systemPrompt` is not exposed). Verify by checking existing tests — if `state.systemPrompt` doesn't work, change the assertion to:

```ts
expect(harness.systemPrompt).toBe("refreshed");
```

**Step 4: Run — verify it passes**

```bash
cd packages/agent && pnpm run test -- "drains pending refresh during compaction"
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent/src/agent/agent-harness.ts packages/agent/src/agent/__tests__/agent-harness.test.ts
git commit -m "feat(agent): drain pending prompt refresh on compaction"
```

---

### Task 4: Emit `cache_bust_pending` event when refresh is scheduled

This is what the UI will subscribe to in order to show "compact recommended" alerts.

**Files:**

- Modify: `packages/agent/src/harness-types.ts` — add event type + result
- Modify: `packages/agent/src/agent/agent-harness.ts` — emit event in `scheduleSystemPromptRefresh`
- Test: `packages/agent/src/agent/__tests__/agent-harness.test.ts`

**Step 1: Write the failing test**

Append to the `scheduleSystemPromptRefresh` describe block:

```ts
it("emits cache_bust_pending when a refresh is scheduled", async () => {
  const registration = registerFauxStreamProvider();
  registrations.push(registration);
  const harness = new AgentHarness({
    env: new TestExecutionEnv(process.cwd()),
    session: await createTestSession(),
    model: registration.getModel(),
    streamFn: registration.streamFn,
    systemPrompt: "original",
  });

  const events: AgentHarnessEvent[] = [];
  harness.subscribe((event) => {
    if (event.type === "cache_bust_pending") {
      events.push(event);
    }
  });

  harness.scheduleSystemPromptRefresh("new");

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: "cache_bust_pending",
    reason: "system_prompt_refresh",
  });
});
```

**Step 2: Run — verify it fails**

```bash
cd packages/agent && pnpm run test -- "emits cache_bust_pending"
```

Expected: FAIL — TS error: `cache_bust_pending` not assignable to `AgentHarnessEvent`.

**Step 3: Implement**

3a. In `packages/agent/src/harness-types.ts`, add the event interface near the other event interfaces (around line 422, after `ToolsUpdateEvent`):

```ts
export interface CacheBustPendingEvent {
  /** What kind of change is pending. */
  reason: "system_prompt_refresh" | "tools_refresh" | "skills_refresh";
  /** Human-readable detail for UI alerts. */
  message: string;
  type: "cache_bust_pending";
}
```

3b. Add it to the `AgentHarnessOwnEvent` union (around line 460):

```ts
export type AgentHarnessOwnEvent<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> =
  | QueueUpdateEvent
  | SavePointEvent
  | AbortEvent
  | SettledEvent
  | BeforeAgentStartEvent<TSkill, TPromptTemplate>
  | ContextEvent
  | BeforeProviderRequestEvent
  | ToolCallEvent
  | ToolResultEvent
  | SessionBeforeCompactEvent
  | SessionCompactEvent
  | SessionBeforeTreeEvent
  | SessionTreeEvent
  | ModelUpdateEvent
  | ThinkingLevelUpdateEvent
  | ResourcesUpdateEvent<TSkill, TPromptTemplate>
  | ToolsUpdateEvent
  | CacheBustPendingEvent; // ← new
```

3c. Add to `AgentHarnessEventResultMap` (around line 518):

```ts
export type AgentHarnessEventResultMap = {
  // ... existing entries ...
  cache_bust_pending: undefined; // ← new (no handler result)
  // ...
};
```

3d. In `packages/agent/src/agent/agent-harness.ts`, modify `scheduleSystemPromptRefresh` (added in Task 2):

```ts
  scheduleSystemPromptRefresh(next: string): void {
    this.pendingSystemPromptRefresh = next;
    void this.emitOwn({
      type: "cache_bust_pending",
      reason: "system_prompt_refresh",
      message:
        "System prompt change pending. Compact the session to apply it without busting the cache.",
    });
  }
```

**Note:** `emitOwn` returns a Promise. Existing callers in the codebase use `void this.emitOwn(...)` when they don't need to await (see line 1530). We follow the same pattern. If the emission needs to be synchronous for test determinism, switch to `await` and make `scheduleSystemPromptRefresh` async — but then the test must `await harness.scheduleSystemPromptRefresh("new")`. Prefer `void` + a microtask wait in the test:

```ts
harness.scheduleSystemPromptRefresh("new");
await Promise.resolve(); // flush microtask
expect(events).toHaveLength(1);
```

**Step 4: Run — verify it passes**

```bash
cd packages/agent && pnpm run typecheck && pnpm run test -- "emits cache_bust_pending"
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent/src/harness-types.ts packages/agent/src/agent/agent-harness.ts packages/agent/src/agent/__tests__/agent-harness.test.ts
git commit -m "feat(agent): cache_bust_pending event on scheduled refresh"
```

---

### Task 5: `<skills-added>` turn-tail notice via steering queue

For newly-installed skills. The skill body is loaded on-demand via `read`, so we only need to advertise `{name, description, location}` in a transient user message. No prompt mutation, no cache cost.

**Files:**

- Modify: `packages/agent/src/agent/agent-harness.ts` — add `announceSkillAdded` method
- Test: `packages/agent/src/agent/__tests__/agent-harness.test.ts`

**Step 1: Write the failing test**

Append a new describe block to `packages/agent/src/agent/__tests__/agent-harness.test.ts`:

```ts
describe("announceSkillAdded", () => {
  it("pushes a <skills-added> steering message on the next turn", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    const captured: string[] = [];
    registration.setResponses([
      (req) => {
        // Concatenate all user-message text so we can search it.
        const userText = req.messages
          .filter((m) => m.role === "user")
          .flatMap((m) =>
            Array.isArray(m.content)
              ? m.content
                  .filter((c): c is { type: "text"; text: string } => c.type === "text")
                  .map((c) => c.text)
              : [],
          )
          .join("\n");
        captured.push(userText);
        return fauxAssistantMessage("ok");
      },
    ]);

    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      systemPrompt: "frozen prompt",
    });

    harness.announceSkillAdded({
      name: "graphify",
      description: "any input to knowledge graph",
      filePath: "/home/user/skills/graphify/SKILL.md",
    });

    await harness.prompt("hello");

    expect(captured[0]).toContain("<skills-added>");
    expect(captured[0]).toContain("graphify");
    expect(captured[0]).toContain("/home/user/skills/graphify/SKILL.md");
    expect(captured[0]).toContain("hello"); // original user text still present
  });
});
```

**Step 2: Run — verify it fails**

```bash
cd packages/agent && pnpm run test -- announceSkillAdded
```

Expected: FAIL — `harness.announceSkillAdded is not a function`.

**Step 3: Implement**

3a. Add a helper to format the XML block. Create `packages/agent/src/resources/skills-added-notice.ts`:

```ts
import type { Skill } from "../harness-types";

/**
 * Format a `<skills-added>` block to prepend to a user turn.
 *
 * Used when a skill is installed mid-session: the system-prompt
 * `<available_skills>` block is frozen (cache-stable), so the new skill is
 * advertised via a transient turn-tail notice. The model reads the skill
 * body on-demand via the `read` tool — only the {name, description, location}
 * triple needs to reach it for the skill to be invocable.
 */
export function formatSkillsAddedNotice(skills: readonly Skill[]): string {
  if (skills.length === 0) {
    return "";
  }
  const lines = [
    "<skills-added>",
    "The following skills were just installed and are available now. Read the full SKILL.md when the task matches its description.",
  ];
  for (const skill of skills) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push("  </skill>");
  }
  lines.push("</skills-added>");
  return lines.join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
```

3b. Export it from the package. In `packages/agent/src/index.ts`, add to the existing `resources/system-prompt` re-exports:

```ts
export { formatSkillsAddedNotice } from "./resources/skills-added-notice";
```

3c. In `packages/agent/src/agent/agent-harness.ts`, add the method near `steer()` (around line 1079):

```ts
  /**
   * Advertise one or more newly-installed skills on the next turn via a
   * `<skills-added>` block. The block rides the user message (transient tail),
   * not the system prompt — the prompt-cache prefix stays warm.
   *
   * Use this when a skill is installed mid-session. The model reads the skill
   * body on-demand via the `read` tool, so only the {name, description, location}
   * triple needs to reach it.
   */
  announceSkillAdded(skill: Skill): void;
  announceSkillAdded(skills: readonly Skill[]): void;
  announceSkillAdded(input: Skill | readonly Skill[]): void {
    const skills = Array.isArray(input) ? input : [input];
    const notice = formatSkillsAddedNotice(skills);
    if (notice === "") {
      return;
    }
    // Push onto the steer queue so it drains into the next turn as a user
    // message. The harness's phase guard rejects steer() calls when idle;
    // we don't have that constraint here because this is a host-side API,
    // not a mid-run injection. The queue is drained by prepareNextTurn /
    // getSteeringMessages between turns.
    this.steerQueue.push(
      createUserMessage(notice)
    );
  }
```

3d. Add the import at the top of `agent-harness.ts`:

```ts
import { formatSkillsAddedNotice } from "../resources/skills-added-notice";
```

**Note on phase semantics:** `steer(text)` (line 1079-1089) throws if `phase === "idle"`. We DON'T want that constraint here — `announceSkillAdded` may be called while idle (user installs a skill between turns). So we push directly onto `steerQueue` rather than going through `steer()`. Verify the queue is drained by the next `prompt()` call via the existing `getSteeringMessages` plumbing in `createLoopConfig` (line 654-655).

**Step 4: Run — verify it passes**

```bash
cd packages/agent && pnpm run typecheck && pnpm run test -- announceSkillAdded
```

Expected: PASS.

If the test fails because the steer queue wasn't drained on the first turn (only between turns), inspect `agent-loop.ts:130-200` for where `getSteeringMessages` is first polled. The first call may happen only after the first assistant turn completes. If so, the test needs adjustment: trigger a follow-up turn, OR change `announceSkillAdded` to prepend directly to the user message via the `before_agent_start` hook instead. Check existing `before_agent_start` usage (line 823-832) and use that path if the steer queue doesn't drain pre-first-turn.

**Step 5: Commit**

```bash
git add packages/agent/src/resources/skills-added-notice.ts \
        packages/agent/src/resources/__tests__/skills-added-notice.test.ts \
        packages/agent/src/agent/agent-harness.ts \
        packages/agent/src/agent/__tests__/agent-harness.test.ts \
        packages/agent/src/index.ts
git commit -m "feat(agent): announceSkillAdded pushes transient skills-added notice"
```

---

### Task 6: Soft-disable tool gate (`softDisableTool`)

For tools/MCP the user wants gone _now_ but whose schema must stay in the request to keep the cache warm. Uses the existing `beforeToolCall` hook chain.

**Files:**

- Modify: `packages/agent/src/agent/agent-harness.ts` — add field, method, gate middleware
- Test: `packages/agent/src/agent/__tests__/agent-harness.test.ts`

**Step 1: Write the failing test**

Append a new describe block:

```ts
describe("softDisableTool", () => {
  it("blocks execution of the named tool while keeping its schema in the request", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);

    const calculateTool: AgentTool = {
      name: "calculate",
      description: "calc",
      parameters: z.object({ expression: z.string() }),
      permission: "bash",
      async execute({ expression }) {
        return {
          content: [{ type: "text", text: `result: ${expression}` }],
        };
      },
    };

    const capturedRequests: StreamRequest[] = [];
    const blockedResults: string[] = [];
    registration.setResponses([
      (req) => {
        capturedRequests.push(req);
        return fauxAssistantMessageWithContent(
          [fauxToolCall("calculate", { expression: "1+1" }, { id: "c1" })],
          "toolUse",
        );
      },
      () => fauxAssistantMessage("done"),
    ]);

    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      tools: [calculateTool],
    });

    // Subscribe to capture tool result content
    harness.subscribe((event) => {
      if (event.type === "tool_result" && event.isError) {
        // ToolResultEvent content is an array; extract text for the assertion.
        const text = event.content.map((c) => (c.type === "text" ? c.text : "")).join("");
        blockedResults.push(text);
      }
    });

    harness.softDisableTool("calculate", "tool disabled for testing");

    await harness.prompt("compute 1+1");

    // Schema is still in the request (cache stays warm)
    expect(capturedRequests[0]?.tools && "calculate" in capturedRequests[0]!.tools!).toBe(true);

    // Execution was blocked with a clear reason
    expect(blockedResults.length).toBeGreaterThanOrEqual(1);
    expect(blockedResults[0]).toContain("tool disabled for testing");
  });
});
```

You'll need to add imports to the test file: `import { z } from "zod";` and `import type { AgentTool, StreamRequest } from "@sakti-code/agent";` (or from the existing aliases the file uses).

**Step 2: Run — verify it fails**

```bash
cd packages/agent && pnpm run test -- softDisableTool
```

Expected: FAIL — `harness.softDisableTool is not a function`.

**Step 3: Implement**

3a. In `packages/agent/src/agent/agent-harness.ts`, add a field near the other private fields (after `pendingSystemPromptRefresh` from Task 2):

```ts
  /** Tools whose schema stays in the request (cache-stable) but whose
   *  execution is blocked at the beforeToolCall gate. Maps tool name to
   *  the reason returned to the model. */
  private softDisabledTools = new Map<string, string>();
```

3b. Add the public method near `setActiveTools()` (around line 1551):

```ts
  /**
   * Block execution of `toolName` while keeping its schema in the request.
   *
   * The tool's schema stays in `activeToolNames` so the cacheable tools-prefix
   * is unchanged; when the model calls the tool, the `beforeToolCall` gate
   * returns `{block: true, reason}` and the model receives `reason` as a
   * tool-error result it can adapt to.
   *
   * Use this when the user disables an MCP server or side-effecting tool
   * mid-session and wants it gone *now* — `setActiveTools` would rewrite the
   * tools array and bust the cache. Pair with `scheduleSystemPromptRefresh`
   * (or wait for natural compaction) to drop the schema from the request
   * entirely.
   */
  softDisableTool(toolName: string, reason: string): void {
    this.softDisabledTools.set(toolName, reason);
  }

  /** Re-enable a previously soft-disabled tool. */
  softEnableTool(toolName: string): void {
    this.softDisabledTools.delete(toolName);
  }

  /** Returns true iff `toolName` is currently soft-disabled. Test/debug hook. */
  isToolSoftDisabled(toolName: string): boolean {
    return this.softDisabledTools.has(toolName);
  }
```

3c. Wire the gate into the loop config's `beforeToolCall` chain. Modify `createLoopConfig` (line 614-624):

```ts
      beforeToolCall: async ({ toolCall, args }) => {
        // Soft-disable gate: check before any user hook runs.
        const softBlock = this.softDisabledTools.get(toolCall.name);
        if (softBlock !== undefined) {
          return { block: true, reason: softBlock };
        }
        const result = await this.emitHook({
          type: "tool_call",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: args as Record<string, unknown>,
        });
        return result
          ? { block: result.block, reason: result.reason }
          : undefined;
      },
```

**Step 4: Run — verify it passes**

```bash
cd packages/agent && pnpm run typecheck && pnpm run test -- softDisableTool
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent/src/agent/agent-harness.ts packages/agent/src/agent/__tests__/agent-harness.test.ts
git commit -m "feat(agent): softDisableTool gates execution without busting cache"
```

---

### Task 7: `addSkill(skill)` and `removeSkill(name)` convenience APIs

Compose the primitives from Tasks 1-5 into the user-facing API. `addSkill` updates resources + pushes a `<skills-added>` notice; `removeSkill` updates resources + schedules prompt refresh + soft-disables `read` on the skill path.

**Files:**

- Modify: `packages/agent/src/agent/agent-harness.ts` — add `addSkill`, `removeSkill`, `removeSkills` methods
- Modify: `packages/agent/src/agent/agent-harness.ts` — extend `beforeToolCall` gate to honor skill-path soft-disable on the `read` tool
- Test: `packages/agent/src/agent/__tests__/agent-harness.test.ts`

**Step 1: Write the failing tests**

Append a new describe block:

```ts
describe("addSkill / removeSkill", () => {
  it("addSkill: updates resources and announces via <skills-added>", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    const capturedUserText: string[] = [];
    registration.setResponses([
      (req) => {
        capturedUserText.push(
          req.messages
            .filter((m) => m.role === "user")
            .flatMap((m) =>
              Array.isArray(m.content)
                ? m.content
                    .filter((c): c is { type: "text"; text: string } => c.type === "text")
                    .map((c) => c.text)
                : [],
            )
            .join("\n"),
        );
        return fauxAssistantMessage("ok");
      },
    ]);

    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      systemPrompt: "frozen",
      resources: { skills: [] },
    });

    await harness.addSkill({
      name: "new-skill",
      description: "newly installed",
      content: "...",
      filePath: "/skills/new/SKILL.md",
    });

    expect(harness.getResources().skills?.map((s) => s.name)).toEqual(["new-skill"]);

    await harness.prompt("hello");

    expect(capturedUserText[0]).toContain("<skills-added>");
    expect(capturedUserText[0]).toContain("new-skill");
  });

  it("removeSkill: schedules prompt refresh + soft-disables read on the skill path", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      systemPrompt: "frozen",
      resources: {
        skills: [
          {
            name: "old-skill",
            description: "to be removed",
            content: "...",
            filePath: "/skills/old/SKILL.md",
          },
        ],
      },
    });

    const events: AgentHarnessEvent[] = [];
    harness.subscribe((event) => {
      if (event.type === "cache_bust_pending") {
        events.push(event);
      }
    });

    await harness.removeSkill("old-skill");

    // Skill is gone from resources
    expect(harness.getResources().skills?.map((s) => s.name)).toEqual([]);

    // Prompt refresh is pending (deferred to compaction)
    expect(harness.getPendingSystemPromptRefresh()).toBeDefined();

    // Cache-bust alert fired
    expect(events.length).toBeGreaterThanOrEqual(1);

    // read on the skill's path is gated (the model shouldn't reload a
    // disabled skill's body)
    expect(harness.isToolPathSoftDisabled("/skills/old/SKILL.md")).toBe(true);
  });
});
```

**Step 2: Run — verify it fails**

```bash
cd packages/agent && pnpm run test -- "addSkill / removeSkill"
```

Expected: FAIL — `harness.addSkill is not a function`.

**Step 3: Implement**

3a. Add a `softDisabledPaths` set for skill-path gating. Near `softDisabledTools`:

```ts
  /** File paths (typically skill SKILL.md paths) the `read` tool should refuse.
   *  Populated by `removeSkill` so the model can't re-load a disabled skill's
   *  body from disk after the advertisement was removed from the prompt. */
  private softDisabledPaths = new Set<string>();
```

3b. Add public methods near `setResources` (around line 1608):

```ts
  /**
   * Install a skill mid-session.
   *
   * Updates `resources.skills` and pushes a `<skills-added>` steering notice
   * so the model learns the skill exists on the next turn. The system prompt
   * stays frozen (the skill's advertisement is NOT added to the prompt's
   * `<available_skills>` block until the next session) — cache stays warm.
   *
   * To materialize the new skill in the prompt's `<available_skills>` block,
   * either restart the session or trigger compaction (which is a no-op
   * cache-wise since you'd compact anyway).
   */
  async addSkill(skill: Skill): Promise<void> {
    const currentSkills = this.resources.skills ?? [];
    if (currentSkills.some((s) => s.name === skill.name)) {
      return; // idempotent
    }
    await this.setResources({
      ...this.resources,
      skills: [...currentSkills, skill],
    });
    this.announceSkillAdded(skill);
  }

  /**
   * Disable a skill mid-session without immediately rewriting the prompt.
   *
   * Three effects, all cache-friendly:
   *   1. Removes the skill from `resources.skills` (in-memory only).
   *   2. Schedules a `systemPromptRefresh` with the skill removed from the
   *      `<available_skills>` block. Applied at next compaction.
   *   3. Soft-disables the `read` tool on the skill's `filePath`, so the
   *      model can't reload the body from disk until compaction swaps the
   *      prompt.
   *
   * Emits `cache_bust_pending` so the UI can recommend compaction.
   */
  async removeSkill(name: string): Promise<void> {
    const currentSkills = this.resources.skills ?? [];
    const skill = currentSkills.find((s) => s.name === name);
    if (!skill) {
      return; // idempotent
    }
    const remaining = currentSkills.filter((s) => s.name !== name);
    await this.setResources({
      ...this.resources,
      skills: remaining,
    });

    // Compute the post-removal system prompt and schedule it for compaction.
    const basePrompt = this.getBaseSystemPrompt();
    const hasRead = this.activeToolNames.includes("read");
    const recomposed = appendSkillsBlock(basePrompt, remaining, hasRead);
    this.scheduleSystemPromptRefresh(recomposed);

    // Soft-disable read on the skill path so the model can't reload the body.
    if (skill.filePath) {
      this.softDisabledPaths.add(skill.filePath);
    }
  }

  /** Test/debug hook for skill-path soft-disable. */
  isToolPathSoftDisabled(path: string): boolean {
    return this.softDisabledPaths.has(path);
  }
```

3c. Add `getBaseSystemPrompt()` helper. The harness's `systemPrompt` field may already include the skills block (composed at session start by `appendSkillsBlock` in `runner.ts:416`). We need the BASE prompt without the skills block so we can re-compose with the new skills list.

Check if a base prompt is stored separately. If not, add a field `private baseSystemPrompt: string` populated in the constructor and `switchAgent`:

In the constructor (line 270-304), after `this.systemPrompt = options.systemPrompt`:

```ts
this.baseSystemPrompt = typeof options.systemPrompt === "string" ? options.systemPrompt : "";
```

In `switchAgent` (line 1665-1674):

```ts
  async switchAgent(agent: AgentDefinition): Promise<void> {
    this.currentAgent = agent;
    this.systemPrompt = agent.systemPrompt;
    this.baseSystemPrompt = agent.systemPrompt;  // ← new
    this.clearPendingSystemPromptRefresh();
    // ... rest unchanged
  }
```

Add the getter:

```ts
  /** Returns the system prompt WITHOUT the `<available_skills>` block. */
  getBaseSystemPrompt(): string {
    return this.baseSystemPrompt;
  }
```

3d. Extend `beforeToolCall` to honor `softDisabledPaths` on the `read` tool. Modify the chain added in Task 6:

```ts
      beforeToolCall: async ({ toolCall, args }) => {
        // Soft-disable gate (by tool name).
        const softBlock = this.softDisabledTools.get(toolCall.name);
        if (softBlock !== undefined) {
          return { block: true, reason: softBlock };
        }
        // Soft-disable gate (by path on the read tool).
        if (toolCall.name === "read") {
          const path = (args as { path?: string } | undefined)?.path;
          if (path !== undefined && this.softDisabledPaths.has(path)) {
            return {
              block: true,
              reason: `path ${path} is soft-disabled (likely a removed skill's SKILL.md)`,
            };
          }
        }
        // Existing user hook chain.
        const result = await this.emitHook({
          type: "tool_call",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: args as Record<string, unknown>,
        });
        return result
          ? { block: result.block, reason: result.reason }
          : undefined;
      },
```

3e. Add the import for `appendSkillsBlock` at the top of `agent-harness.ts`:

```ts
import { appendSkillsBlock } from "../resources/system-prompt";
```

**Step 4: Run — verify it passes**

```bash
cd packages/agent && pnpm run typecheck && pnpm run test -- "addSkill / removeSkill"
```

Expected: PASS. If the `addSkill` test fails because the steering queue doesn't drain on the first turn, follow the same debugging note as Task 5 Step 4.

**Step 5: Commit**

```bash
git add packages/agent/src/agent/agent-harness.ts packages/agent/src/agent/__tests__/agent-harness.test.ts
git commit -m "feat(agent): addSkill/removeSkill compose cache-stable primitives"
```

---

### Task 8: Server routes — write DB AND call the harness (Layer 1 + Layer 2)

The desktop UI hits these routes to toggle skills. Each route coordinates the two layers: persistent state in DB (Task 1) + live-session effect on the harness (Task 7).

**Three endpoints** (REST verbs chosen so the UI can curl them naturally):

| Method + path                                   | Effect                                                                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/sessions/:id/skills`                 | Announce a brand-new skill mid-session (file just dropped on disk). Calls `harness.addSkill` only — disk is source of truth, no DB write. |
| `POST /api/sessions/:id/skills/:name/disable`   | Persist `disabled_skill:<name>` (Task 1) + call `harness.removeSkill(name)` (Task 7). Idempotent.                                         |
| `DELETE /api/sessions/:id/skills/:name/disable` | Remove `disabled_skill:<name>` + call `harness.addSkill(skillData)` re-using the on-disk skill data from `loadAgentContext`. Idempotent.  |

The disable/enable pair uses a sub-resource (`/disable`) so a future `DELETE /skills/:name` could mean "fully uninstall" (delete the file) without collision.

**Files:**

- Create: `apps/server/src/routes/sessions/skills.ts` — new route module
- Modify: `apps/server/src/app.ts` — register the new route
- Test: `apps/server/src/__tests__/skills-route.test.ts`

**Step 1: Write the failing test**

Create `apps/server/src/__tests__/skills-route.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { skillsRoutes } from "../routes/sessions/skills.ts";
import { loadDisabledSkills } from "../agent/runner.ts";
// Adjust makeApp import to match existing test-utils pattern
// (see apps/server/src/__tests__/compaction.test.ts for the reference shape).
import { makeApp } from "../test-utils.ts";

describe("skills routes", () => {
  it("POST /skills/:name/disable writes DB + calls harness.removeSkill", async () => {
    const { app, ctx } = await makeApp([skillsRoutes]);
    const session = await ctx.repos.sessions.create({
      projectId: "proj-1",
      kind: "standard",
    });

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/skills/graphify/disable`, {
        method: "POST",
      }),
    );

    expect(res.status).toBe(204);

    // Layer 1: persistent state
    const disabled = loadDisabledSkills(ctx, session.id);
    expect(disabled.has("graphify")).toBe(true);
  });

  it("DELETE /skills/:name/disable removes DB entry", async () => {
    const { app, ctx } = await makeApp([skillsRoutes]);
    const session = await ctx.repos.sessions.create({
      projectId: "proj-1",
      kind: "standard",
    });
    await ctx.repos.settings.set(`session:${session.id}:disabled_skill:graphify`, "1");

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/skills/graphify/disable`, {
        method: "DELETE",
      }),
    );

    expect(res.status).toBe(204);
    const disabled = loadDisabledSkills(ctx, session.id);
    expect(disabled.has("graphify")).toBe(false);
  });

  it("POST /skills (no /disable) announces a new skill without DB write", async () => {
    const { app, ctx } = await makeApp([skillsRoutes]);
    const session = await ctx.repos.sessions.create({
      projectId: "proj-1",
      kind: "standard",
    });

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/skills`, {
        method: "POST",
        body: JSON.stringify({
          name: "brand-new",
          description: "just installed",
          filePath: "/skills/brand-new/SKILL.md",
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(res.status).toBe(204);
    // No DB write — disk is source of truth for new installs.
    const disabled = loadDisabledSkills(ctx, session.id);
    expect(disabled.size).toBe(0);
  });

  it("survives a server restart: disabled skill stays filtered after reload", async () => {
    // Integration test for Layer 1.
    // 1. Create a session, run a prompt, observe <available_skills> includes X.
    // 2. Hit POST /skills/X/disable.
    // 3. Tear down the harness (simulate restart).
    // 4. Rebuild the harness via runPrompt plumbing — loadDisabledSkills filter kicks in.
    // 5. Observe <available_skills> no longer includes X.
    //
    // This is the regression test for the user-spotted gap: without Task 1,
    // disabling a skill mid-session was forgotten on restart.
  });
});
```

(The fourth test is sketched as a comment because the exact "tear down and rebuild harness" dance depends on test fixtures we don't have yet. Implement it as a full integration test if practical, OR convert to a unit test of `loadDisabledSkills` + the filter step in `runPrompt` — the unit pieces are already tested, the integration glue is one line.)

**Step 2: Run — verify it fails**

```bash
cd apps/server && pnpm run test -- skills-route
```

Expected: FAIL — module not found.

**Step 3: Implement**

3a. Create `apps/server/src/routes/sessions/skills.ts`:

```ts
import { Hono } from "hono";
import { loadAgentContext } from "../../agent/loader.ts"; // adjust path
import { getActiveHarness, persistSkillDisabled, persistSkillEnabled } from "../../agent/runner.ts";
import { getCtx } from "../../context.ts";

interface SkillAnnouncePayload {
  name: string;
  description: string;
  filePath: string;
}

export const skillsRoutes = new Hono()
  .basePath("/sessions")
  // Announce a brand-new skill mid-session (file just dropped on disk).
  // Disk is source of truth — no DB write. Just tell the live harness.
  .post("/:id/skills", async (c): Promise<Response> => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const session = ctx.repos.sessions.findById(id);
    if (!session) {
      return c.json({ error: "Not found" }, 404);
    }
    const body = (await c.req.json()) as SkillAnnouncePayload;
    const harness = getActiveHarness(id);
    if (harness) {
      await harness.addSkill({
        name: body.name,
        description: body.description,
        content: "", // body loaded on-demand via read
        filePath: body.filePath,
      });
    }
    return c.body(null, 204);
  })
  // Disable a skill for this session: persist + live-effect.
  .post("/:id/skills/:name/disable", async (c): Promise<Response> => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const name = c.req.param("name");
    const session = ctx.repos.sessions.findById(id);
    if (!session) {
      return c.json({ error: "Not found" }, 404);
    }

    // Layer 1: persistent state survives restart.
    await persistSkillDisabled(ctx, id, name);

    // Layer 2: live-session cache-stable effect (deferred prompt refresh +
    // soft-disable read on the skill path).
    const harness = getActiveHarness(id);
    if (harness) {
      await harness.removeSkill(name);
    }
    return c.body(null, 204);
  })
  // Re-enable a previously-disabled skill: remove DB entry + live-effect.
  .delete("/:id/skills/:name/disable", async (c): Promise<Response> => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const name = c.req.param("name");
    const session = ctx.repos.sessions.findById(id);
    if (!session) {
      return c.json({ error: "Not found" }, 404);
    }
    const project = await ctx.repos.projects.findById(session.projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    // Layer 1: clear persistent state.
    await persistSkillEnabled(ctx, id, name);

    // Layer 2: re-add to live harness. We need the skill data from disk
    // (loadAgentContext is the canonical source).
    const loadedContext = await loadAgentContext(project.cwd);
    const skill = loadedContext.skills.find((s) => s.name === name);
    const harness = getActiveHarness(id);
    if (harness && skill) {
      await harness.addSkill(skill);
    }
    // If skill is undefined, the file was removed from disk — silently
    // succeed; nothing to re-enable.
    return c.body(null, 204);
  });
```

3b. Register in `apps/server/src/app.ts`. Add the import and a `.route()`:

```ts
import { skillsRoutes } from "./routes/sessions/skills.ts";
// ...
    .route("/", skillsRoutes)
```

3c. Verify imports. `getActiveHarness` is already exported from `runner.ts` (line 182). `persistSkillDisabled`/`persistSkillEnabled`/`loadDisabledSkills` are added in Task 1. `loadAgentContext` should already exist — verify the import path matches existing usage in `runner.ts:368`.

**Step 4: Run — verify it passes**

```bash
cd apps/server && pnpm run typecheck && pnpm run test -- skills-route
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/routes/sessions/skills.ts \
        apps/server/src/app.ts \
        apps/server/src/__tests__/skills-route.test.ts
git commit -m "feat(server): skill toggle routes coordinate DB persistence + harness"
```

---

### Task 9: Update `openspec/references/reasonix-cache-design.md` with implementation status

Document what got built and what remains.

**Files:**

- Modify: `openspec/references/reasonix-cache-design.md` — add a "Status" subsection to each implemented point

**Step 1: Edit the doc**

At the top of the file, after the existing intro, add:

```markdown
## Implementation status (sakti-code)

| §   | Behavior                                              | Status                                                         | Where                                         |
| --- | ----------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------- |
| 1   | Frozen system prompt                                  | ✅ Already (string, not function)                              | `agent-harness.ts:460-461`                    |
| 2   | `Compose(text)` turn-tail wrapper                     | ✅ Partial — `<skills-added>` notices via `announceSkillAdded` | `agent-harness.ts` `announceSkillAdded`       |
| 4   | Three-tier compaction + stuck guard                   | ⚠ Single threshold today                                       | `compaction/auto-compaction.ts` — future work |
| 5   | Compaction invariants (user turns, digests, boundary) | ⚠ Audit needed                                                 | future work                                   |
| 6   | Drop `reasoning_content` round-trip                   | ⚠ Open — profile on Z.ai                                       | future work                                   |
| 7   | Tool schemas sorted before hashing                    | ❌ Not implemented                                             | future work                                   |
| 9   | Plan mode as runtime gate (not prompt change)         | ✅ Soft-disable gate via `beforeToolCall`                      | `agent-harness.ts` `softDisableTool`          |
| 10  | Cache-shape diagnostics                               | ❌ Not implemented                                             | future work                                   |
| 11  | Byte-stability regression tests                       | ❌ Not implemented                                             | future work                                   |

**Cache-stable mid-session changes (new — not in Reasonix doc):**

- `loadDisabledSkills` + filter at `runPrompt` (Layer 1, persistent).
- `persistSkillDisabled` / `persistSkillEnabled` (Layer 1, keyed-prefix DB).
- `scheduleSystemPromptRefresh(prompt)` — defer prompt swap to compaction (Layer 2, in-memory).
- `announceSkillAdded(skill)` — turn-tail notice for newly-installed skills (Layer 2).
- `softDisableTool(name, reason)` — gate execute without removing schema (Layer 2).
- `softDisabledPaths` — gate `read` on removed-skill paths (Layer 2).
- `addSkill` / `removeSkill` — convenience composition (Layer 2).
- `cache_bust_pending` event — UI hook for "compact recommended" alerts.
- Skill toggle routes coordinate Layer 1 + Layer 2 atomically per request.
```

**Step 2: Commit**

```bash
git add openspec/references/reasonix-cache-design.md
git commit -m "docs(reasonix): mark cache-stable primitives as implemented"
```

---

## Final verification

After all 9 tasks:

```bash
pnpm run fix                              # format + lint
pnpm run typecheck                        # all packages
cd packages/agent && pnpm run test        # full agent suite
cd apps/server && pnpm run test           # full server suite
```

All should pass with no regressions.

## Out-of-scope follow-ups (for future plans)

- UI alert rendering for `cache_bust_pending` events (desktop).
- Three-tier compaction + stuck guard (Reasonix §4).
- Compaction invariants audit (Reasonix §5).
- Profile `reasoning_content` round-trip cost on Z.ai (Reasonix §6).
- Tool-schema sort before hashing (Reasonix §7).
- `PrefixShape` diagnostics + session-cumulative hit/miss counters (Reasonix §10).
- Byte-stability regression test suite + CI guard (Reasonix §11).
- MCP server integration (when added, use `softDisableTool` + `scheduleSystemPromptRefresh`).
