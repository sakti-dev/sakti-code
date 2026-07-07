# Skill Injection Cache Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix four issues in the phase-workflow skill injection: (1) injected messages break Anthropic's user-first requirement on new sessions, (2) re-injection every run duplicates skill content and pollutes the conversation, (3) observer filter leaves orphaned assistant toolCalls, (4) `buildForceReset` doesn't pass `status` to `resolveOmConfig`.

**Architecture:** The injected `[assistant(toolCall), toolResult]` pair moves from BEFORE the user message to AFTER it (Anthropic-valid: user→assistant→user-toolResult). A new `injectedMessages` field on the harness (separate from `nextTurnQueue`) provides this positioning. Deduplication happens in `runner.ts`: before passing `initialMessages`, scan session history for the skill's stable toolCallId (`skill-read:<skillName>`) — if found, skip injection (the skill is already persisted from a prior run of the same phase). The injected messages ARE persisted (via the existing `message_end → appendMessage` pipeline) — this is intentional and cache-optimal: what the LLM sees equals what's stored, so prefix caching is stable across runs within a phase. Phase transitions inject the new skill as new tail content (expected cache miss, same as any new user message). The system prompt never changes across phases.

**Tech Stack:** TypeScript, Effect, vitest, node:sqlite.

---

## Part 1: Harness — User-First Ordering

Move injected messages from before the user message to after it. Use a separate `injectedMessages` field (not `nextTurnQueue`, whose prepend semantics are correct for `nextTurn()` but wrong for skill injection).

### Task 1.1: Add `injectedMessages` field, repoint `injectMessages`

**Files:**

- Modify: `packages/agent/src/agent/agent-harness.ts`
- Test: `packages/agent/src/agent/__tests__/agent-harness-inject.test.ts`

**Step 1: Read the current field + method**

```
packages/agent/src/agent/agent-harness.ts:280    — private nextTurnQueue field
packages/agent/src/agent/agent-harness.ts:1298   — injectMessages docstring + method body
```

**Step 2: Write the failing test**

Append to `packages/agent/src/agent/__tests__/agent-harness-inject.test.ts`:

```ts
it("positions injected messages AFTER the user message (Anthropic user-first)", async () => {
  const registration = registerFauxStreamProvider();
  registrations.push(registration);
  let capturedReq: StreamRequest | undefined;
  registration.setResponses([
    (req) => {
      capturedReq = req;
      return fauxAssistantMessage("ok");
    },
  ]);
  const harness = new AgentHarness({
    branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
    skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
    env: new TestExecutionEnv(process.cwd()),
    session: await createTestSession(),
    model: registration.getModel(),
    streamFn: registration.streamFn,
  });

  harness.injectMessages(syntheticPair());
  await Effect.runPromise(harness.promptEffect("hello"));

  expect(capturedReq).toBeDefined();
  const roles = capturedReq!.messages.map((m) => m.role);
  // First message must be "user" (Anthropic requirement).
  expect(roles[0]).toBe("user");
  // Injected assistant comes after the user message.
  expect(roles).toEqual(["user", "assistant", "user"]);
});
```

**Step 3: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- agent-harness-inject.test
```

Expected: FAIL — currently `roles` is `["assistant", "user", "user"]` (injected before user).

**Step 4: Add `injectedMessages` field**

In `packages/agent/src/agent/agent-harness.ts`, find the `nextTurnQueue` field (line ~280) and add a sibling:

```ts
private nextTurnQueue: AgentMessage[] = [];

/**
 * Ephemeral messages injected after the user message at the next turn.
 * Used for forced skill injection: a synthetic `[assistant(toolCall),
 * toolResult]` pair that loads the phase's SKILL.md content. Positioned
 * AFTER the user message (not before) so the conversation starts with a
 * user message — Anthropic requires this.
 *
 * Unlike nextTurnQueue (prepended before the user message), these are
 * appended after. Drained once in executeTurnEffect.
 *
 * NOTE: these messages ARE persisted via the message_end → appendMessage
 * pipeline. Deduplication (skip if already in session history) is the
 * runner's responsibility, not the harness's.
 */
private injectedMessages: AgentMessage[] = [];
```

**Step 5: Change `injectMessages` to use the new field**

Find the `injectMessages` method (line ~1298) and change its body:

Old:

```ts
injectMessages(messages: AgentMessage[]): void {
  for (const msg of messages) {
    this.nextTurnQueue.push(msg);
  }
}
```

New:

```ts
injectMessages(messages: AgentMessage[]): void {
  for (const msg of messages) {
    this.injectedMessages.push(msg);
  }
}
```

Also update the docstring to say "appended AFTER the user message" instead of "prepended before the next user message."

**Step 6: Drain `injectedMessages` after user message in `executeTurnEffect`**

Find `executeTurnEffect` (line ~892). After the `nextTurnQueue` drain block (line ~911) and before the `beforeResult` hook (line ~912), add:

```ts
// Drain injected messages AFTER the user message. Positioned here so
// the conversation starts with a user message (Anthropic requirement).
if (self.injectedMessages.length > 0) {
  const injected = self.injectedMessages.splice(0);
  messages = [...messages, ...injected];
}
```

The full context around line 910-912 becomes:

```ts
        messages = [...queuedMessages, messages[0]!];
      }
      // Drain injected messages AFTER the user message.
      if (self.injectedMessages.length > 0) {
        const injected = self.injectedMessages.splice(0);
        messages = [...messages, ...injected];
      }
      const beforeResult = yield* self.emitHookEffect({
```

**Step 7: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- agent-harness-inject.test
```

Expected: PASS.

**Step 8: Run full agent test suite**

```bash
vp run '@sakti-code/agent#test'
```

Expected: PASS — no regressions.

**Step 9: Commit**

```bash
git add packages/agent/src/agent/agent-harness.ts packages/agent/src/agent/__tests__/agent-harness-inject.test.ts
git commit -m "fix(agent): position injected messages after user (Anthropic user-first)

Separate injectedMessages field (not nextTurnQueue) drained AFTER the
user message in executeTurnEffect. Fixes Anthropic API rejection on new
sessions where the first message was an injected assistant toolCall."
```

---

## Part 2: Deduplication — Inject Once Per Phase

The injected messages are persisted via `message_end → appendMessage`. On the second run of the same phase, the skill is already in the session history — re-injecting creates duplicates. Fix: check session history for the skill's stable toolCallId before injecting.

### Task 2.1: Add deduplication check in runner.ts

**Files:**

- Modify: `apps/server/src/agent/runner.ts` (around line 483-492)

**Step 1: Read the current injection code**

```
apps/server/src/agent/runner.ts:483-492 — phaseKey, builtinSkillName, phaseSkill, initialMessages
```

Note the existing code:

```ts
const phaseKey = session.kind === "plan" ? "plan" : session.status;
const builtinSkillName = getBuiltinSkillForPhase(phaseKey);
const phaseSkill =
  builtinSkillName !== undefined
    ? loadedContext.skills.find((s) => s.name === builtinSkillName)
    : undefined;
const initialMessages = buildSkillInjectionMessages(phaseSkill);
```

**Step 2: Write the failing test**

Create `apps/server/src/agent/__tests__/runner-skill-dedup.test.ts`:

```ts
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

// Test the deduplication predicate in isolation. The integration with
// runner.ts is verified via the full test suite (existing runner tests
// should not regress — injection is additive when session is empty).

describe("skill injection deduplication", () => {
  it("a skill-read toolCallId in session history means already injected", () => {
    // The predicate: does any assistant message in entries contain a
    // toolCall with id === "skill-read:sakti-build"?
    const entries = [
      {
        id: "e1",
        parentId: null,
        timestamp: new Date().toISOString(),
        type: "message" as const,
        message: {
          role: "assistant" as const,
          api: "synthetic",
          model: "synthetic",
          provider: "synthetic",
          stopReason: "toolUse" as const,
          timestamp: Date.now(),
          usage: {
            cacheRead: 0,
            cacheWrite: 0,
            cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
            input: 0,
            output: 0,
            totalTokens: 0,
          },
          content: [
            {
              type: "toolCall" as const,
              id: "skill-read:sakti-build",
              name: "read",
              arguments: { filePath: "/skills/sakti-build/SKILL.md" },
            },
          ],
        },
      },
    ];
    const skillCallId = "skill-read:sakti-build";
    const found = entries.some(
      (e) =>
        e.type === "message" &&
        e.message.role === "assistant" &&
        e.message.content.some((b) => b.type === "toolCall" && b.id === skillCallId),
    );
    expect(found).toBe(true);
  });

  it("no matching toolCallId means not yet injected", () => {
    const entries: Array<{ type: string; message: { role: string; content: unknown[] } }> = [
      { type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
    ];
    const skillCallId = "skill-read:sakti-build";
    const found = entries.some(
      (e) =>
        e.type === "message" &&
        e.message.role === "assistant" &&
        Array.isArray(e.message.content) &&
        e.message.content.some(
          (b: { type: string; id?: string }) => b.type === "toolCall" && b.id === skillCallId,
        ),
    );
    expect(found).toBe(false);
  });
});
```

**Step 3: Run test to verify it passes (documents the contract)**

```bash
vp run '@sakti-code/server#test' -- runner-skill-dedup.test
```

Expected: PASS (pure predicate test — documents the check logic).

**Step 4: Add deduplication check in runner.ts**

Replace the current `initialMessages` block (line ~483-492) with:

```ts
// Force-inject the phase's builtin skill. Persisted via the normal
// message_end → appendMessage pipeline — NOT ephemeral. Deduplicate:
// skip injection if the skill is already in the session history
// (injected on a prior run of the same phase). This keeps the cache
// prefix stable: what the LLM saw = what's stored = no prefix
// divergence across runs.
const phaseKey = session.kind === "plan" ? "plan" : session.status;
const builtinSkillName = getBuiltinSkillForPhase(phaseKey);
const phaseSkill =
  builtinSkillName !== undefined
    ? loadedContext.skills.find((s) => s.name === builtinSkillName)
    : undefined;
let initialMessages = buildSkillInjectionMessages(phaseSkill);

// Deduplicate: skip injection if the skill's toolCallId is already in
// the session tree. The toolCallId is stable: `skill-read:<skillName>`.
if (initialMessages.length > 0 && builtinSkillName !== undefined) {
  const skillCallId = `skill-read:${builtinSkillName}`;
  const alreadyInjected =
    yield *
    Effect.promise(async () => {
      const leafId = await Effect.runPromise(storage.getLeafId());
      if (!leafId) return false;
      const entries = await Effect.runPromise(storage.getPathToRoot(leafId));
      return entries.some(
        (entry) =>
          entry.type === "message" &&
          entry.message.role === "assistant" &&
          entry.message.content.some(
            (block) => block.type === "toolCall" && block.id === skillCallId,
          ),
      );
    });
  if (alreadyInjected) {
    initialMessages = [];
    ctx.log?.agent.debug("skill already injected, skipping", {
      sessionId,
      skill: builtinSkillName,
    });
  }
}
```

**Step 5: Ensure `Effect` is imported in runner.ts**

Check the top of `apps/server/src/agent/runner.ts` for the Effect import. If missing, add:

```ts
import { Effect } from "effect";
```

(It's almost certainly already imported — `runPromptEffect` returns an `Effect.Effect`.)

**Step 6: Run full server test suite**

```bash
vp run '@sakti-code/server#test'
```

Expected: PASS — existing tests should not regress (injection is additive when the session is empty, and the dedup check returns false for empty sessions).

**Step 7: Run check**

```bash
vp check
```

Expected: 0 warnings, 0 errors.

**Step 8: Commit**

```bash
git add apps/server/src/agent/runner.ts apps/server/src/agent/__tests__/runner-skill-dedup.test.ts
git commit -m "fix(server): deduplicate skill injection — skip if already in session

Check session history for skill-read:<name> toolCallId before injecting.
Prevents duplicate skill content accumulating across runs. Cache-optimal:
what the LLM sees equals what's persisted, so prefix caching is stable
within a phase."
```

---

## Part 3: Observer Filter — Drop Orphaned Assistant toolCall

The current `filterSkillContentEntries` drops the toolResult but keeps the preceding assistant(toolCall). The observer sees "Assistant called read: {filePath}" with no result — noise. Fix: also drop assistant entries whose ONLY content blocks are skill-read toolCalls.

### Task 3.1: Extend `filterSkillContentEntries` to drop skill-read assistant entries

**Files:**

- Modify: `packages/agent/src/observational-memory/skill-filter.ts`
- Test: `packages/agent/src/observational-memory/__tests__/skill-filter.test.ts`

**Step 1: Write the failing test**

Append to `packages/agent/src/observational-memory/__tests__/skill-filter.test.ts`:

```ts
it("also drops the assistant toolCall entry when all its calls target skillRoot", () => {
  const entries = [
    makeEntry("e1", userMsg("do stuff")),
    makeEntry("e2", assistantReadMsg("c-skill", `${SKILL_ROOT}/sakti-build/SKILL.md`)),
    makeEntry("e3", toolResultMsg("c-skill", "skill content")),
    makeEntry("e4", assistantReadMsg("c-src", "/project/src/file.ts")),
    makeEntry("e5", toolResultMsg("c-src", "source code")),
  ];
  const filtered = filterSkillContentEntries(entries, SKILL_ROOT);
  const ids = filtered.map((e) => e.id);
  // e2 (assistant with only a skill-read toolCall) is dropped.
  expect(ids).not.toContain("e2");
  // e3 (skill toolResult) is dropped.
  expect(ids).not.toContain("e3");
  // e4 (assistant with non-skill toolCall) is kept.
  expect(ids).toContain("e4");
  // e5 (non-skill toolResult) is kept.
  expect(ids).toContain("e5");
});

it("keeps assistant entries that have text content alongside skill-read toolCalls", () => {
  const mixedAssistant: AssistantMessage = {
    ...assistantReadMsg("c-mixed", `${SKILL_ROOT}/sakti-build/SKILL.md`),
    content: [
      { type: "text", text: "Let me read the skill first." },
      {
        type: "toolCall",
        id: "c-mixed",
        name: "read",
        arguments: { filePath: `${SKILL_ROOT}/sakti-build/SKILL.md` },
      },
    ],
  };
  const entries = [
    makeEntry("e1", userMsg("do stuff")),
    makeEntry("e2", mixedAssistant),
    makeEntry("e3", toolResultMsg("c-mixed", "skill content")),
  ];
  const filtered = filterSkillContentEntries(entries, SKILL_ROOT);
  const ids = filtered.map((e) => e.id);
  // e2 is kept because it has text content (the agent said something).
  expect(ids).toContain("e2");
  // e3 (skill toolResult) is still dropped.
  expect(ids).not.toContain("e3");
});
```

**Step 2: Run test to verify it fails**

```bash
vp run '@sakti-code/agent#test' -- skill-filter.test
```

Expected: FAIL — `e2` is currently kept (the filter only drops toolResults, not assistant entries).

**Step 3: Update `filterSkillContentEntries`**

Replace the entire function body in `packages/agent/src/observational-memory/skill-filter.ts`:

```ts
export function filterSkillContentEntries(
  entries: MessageEntry[],
  skillRoot: string | undefined,
): MessageEntry[] {
  if (!skillRoot) return entries;

  // Build the set of toolCallIds whose read targeted a skill path.
  const skillCallIds = new Set<string>();
  for (const entry of entries) {
    const msg = entry.message;
    if (msg.role !== "assistant") continue;
    for (const block of msg.content) {
      if (block.type !== "toolCall") continue;
      if (block.name !== "read") continue;
      const fp = block.arguments.filePath;
      if (typeof fp === "string" && fp.startsWith(skillRoot)) {
        skillCallIds.add(block.id);
      }
    }
  }

  return entries.filter((entry) => {
    const msg = entry.message;

    // Drop toolResults for skill reads.
    if (msg.role === "toolResult") {
      return !skillCallIds.has(msg.toolCallId);
    }

    // Drop assistant entries whose ONLY content is skill-read toolCalls
    // (no text, no thinking — pure tool-call with no agent output).
    // Keeps entries that have text alongside the toolCall.
    if (msg.role === "assistant") {
      const toolCalls = msg.content.filter((b) => b.type === "toolCall");
      const hasOtherContent = msg.content.some(
        (b) => b.type === "text" && "text" in b && b.text.length > 0,
      );
      if (
        toolCalls.length > 0 &&
        !hasOtherContent &&
        toolCalls.every((tc) => skillCallIds.has(tc.id))
      ) {
        return false;
      }
    }

    return true;
  });
}
```

**Step 4: Run test to verify it passes**

```bash
vp run '@sakti-code/agent#test' -- skill-filter.test
```

Expected: PASS.

**Step 5: Run full agent test suite**

```bash
vp run '@sakti-code/agent#test'
```

Expected: PASS — no regressions.

**Step 6: Commit**

```bash
git add packages/agent/src/observational-memory/skill-filter.ts packages/agent/src/observational-memory/__tests__/skill-filter.test.ts
git commit -m "fix(agent): observer filter drops orphaned assistant toolCall entries

When all content blocks of an assistant message are skill-read toolCalls
(no text), drop the entry entirely — prevents the observer from seeing
'Assistant called read: ...' with no corresponding result."
```

---

## Part 4: buildForceReset — Pass Status

`buildForceReset` calls `resolveOmConfig` without `status`. The `skillFilterRoot` computation works by accident (`undefined !== "merged"` → filter ON). Fix: add `status` to the session type and pass it through.

### Task 4.1: Add `status` to `buildForceReset` session type

**Files:**

- Modify: `apps/server/src/agent/config/force-reset.ts`
- Test: `apps/server/src/agent/config/__tests__/force-reset.test.ts`

**Step 1: Read the current session type**

```
apps/server/src/agent/config/force-reset.ts:20 — session type without status
```

**Step 2: Write the failing test**

Append to `apps/server/src/agent/config/__tests__/force-reset.test.ts`:

```ts
it("passes status through to resolveOmConfig", async () => {
  vi.mocked(resolveOmConfig).mockReturnValue({
    observeModel: "m",
    reflectModel: "m",
    scope: "thread",
  } as unknown as ReturnType<typeof resolveOmConfig>);

  await buildForceReset(ctx, { ...session, status: "review" })("s1");

  expect(resolveOmConfig).toHaveBeenCalledWith(ctx, expect.objectContaining({ status: "review" }));
});
```

**Step 3: Run test to verify it fails**

```bash
vp run '@sakti-code/server#test' -- force-reset.test
```

Expected: FAIL — `resolveOmConfig` is called without `status`.

**Step 4: Add `status` to the session type and pass it through**

In `apps/server/src/agent/config/force-reset.ts`:

4a. Update the session parameter type (line ~20):

Old:

```ts
session: { id: string; kind: string; projectId: string; profileId: string | null },
```

New:

```ts
session: { id: string; kind: string; projectId: string; profileId: string | null; status?: string },
```

4b. Pass `status` to `resolveOmConfig` (line ~23-28):

Old:

```ts
const omConfig = resolveOmConfig(ctx, {
  id: sid,
  kind: session.kind,
  projectId: session.projectId,
  profileId: session.profileId,
});
```

New:

```ts
const omConfig = resolveOmConfig(ctx, {
  id: sid,
  kind: session.kind,
  projectId: session.projectId,
  profileId: session.profileId,
  ...(session.status !== undefined ? { status: session.status } : {}),
});
```

**Step 5: Run test to verify it passes**

```bash
vp run '@sakti-code/server#test' -- force-reset.test
```

Expected: PASS.

**Step 6: Verify confirm.ts already passes status**

The caller in `apps/server/src/routes/sessions/confirm.ts:34` is:

```ts
const forceReset = buildForceReset(ctx, existing);
```

`existing` is the full session row from `ctx.repos.sessions.findById(id)` — it already has `status`. TypeScript structural typing passes it through automatically now that the type accepts it. No code change needed in `confirm.ts`.

**Step 7: Run full server test suite**

```bash
vp run '@sakti-code/server#test'
```

Expected: PASS.

**Step 8: Commit**

```bash
git add apps/server/src/agent/config/force-reset.ts apps/server/src/agent/config/__tests__/force-reset.test.ts
git commit -m "fix(server): buildForceReset passes status to resolveOmConfig

The skillFilterRoot computation was correct by accident (undefined !==
'merged' → filter ON). Now explicit: status flows through so the filter
is deterministically correct for the build→verify transition."
```

---

## Part 5: Cleanup + Verification

### Task 5.1: Update stale comments

**Files:**

- Modify: `packages/agent/src/runner/agent-run.ts` (comment at line ~213)
- Modify: `apps/server/src/agent/config/skill-injection.ts` (docstring)

**Step 1: Update agent-run.ts comment**

In `packages/agent/src/runner/agent-run.ts`, find the comment at line ~213:

Old:

```ts
// Inject ephemeral priming messages (skill injection) before the first
// turn. These go into the harness's nextTurnQueue and are prepended to
// the user's first message when executeTurnEffect runs.
```

New:

```ts
// Inject phase skill messages before the first turn. These go into
// the harness's injectedMessages and are appended AFTER the user's
// first message (Anthropic user-first). Persisted via message_end →
// appendMessage — NOT ephemeral. Deduplication (skip if already in
// session) is the runner's responsibility.
```

**Step 2: Update skill-injection.ts docstring**

In `apps/server/src/agent/config/skill-injection.ts`, update the docstring:

Old:

```ts
/**
 * Build the synthetic `[AssistantMessage with toolCall, ToolResultMessage]`
 * pair that force-loads a skill's SKILL.md as if the agent had called `read`
 * itself.
 *
 * The pair is prepended to the user's first message at run start. It is
 * ephemeral (in-memory only, never persisted to DB) — re-built every run
 * from the current phase + on-disk SKILL.md content.
 *
 * The toolCall uses a stable synthetic id (`skill-read:<skillName>`) so the
 * matching toolResult can reference it deterministically.
 */
```

New:

```ts
/**
 * Build the synthetic `[AssistantMessage with toolCall, ToolResultMessage]`
 * pair that force-loads a skill's SKILL.md as if the agent had called `read`
 * itself.
 *
 * The pair is appended AFTER the user's first message at run start
 * (Anthropic requires user-first). It is persisted via the normal
 * message_end → appendMessage pipeline — NOT ephemeral. Deduplication
 * (skip if the skill is already in the session history) is handled by
 * the runner, which checks for the stable toolCallId before calling
 * injectMessages.
 *
 * The toolCall uses a stable synthetic id (`skill-read:<skillName>`) so the
 * matching toolResult can reference it deterministically AND the runner
 * can detect prior injection by scanning for this id.
 */
```

**Step 3: Run check**

```bash
vp check
```

Expected: 0 warnings, 0 errors.

**Step 4: Commit**

```bash
git add packages/agent/src/runner/agent-run.ts apps/server/src/agent/config/skill-injection.ts
git commit -m "docs: correct stale 'ephemeral' comments on skill injection

Injected messages are persisted (via message_end → appendMessage), not
ephemeral. Deduplication prevents duplication across runs."
```

---

### Task 5.2: Final full-suite verification

**Step 1: Run all tests across all packages**

```bash
vp run -r test
```

Expected: ALL PASS (the only pre-existing failure is `workspace-build.test.ts` — missing `packages/llm/dist/index.mjs`, unrelated).

**Step 2: Run full check**

```bash
vp check
```

Expected: 0 warnings, 0 errors.

---

## Verification Checklist

After all tasks complete:

- [ ] Injected messages positioned AFTER user message (Anthropic user-first)
- [ ] `injectedMessages` field separate from `nextTurnQueue` on harness
- [ ] Deduplication: second run of same phase does NOT re-inject
- [ ] Deduplication: phase change DOES inject the new skill
- [ ] Observer filter drops both toolResult AND orphaned assistant toolCall
- [ ] Observer filter keeps assistant entries with text content
- [ ] `buildForceReset` passes `status` to `resolveOmConfig`
- [ ] Stale "ephemeral" comments corrected
- [ ] All tests pass (`vp run -r test`)
- [ ] Full check clean (`vp check`)

---

## Cache Stability Analysis

### Within a phase (multiple runs, same skill)

```
Run 1: [user1, skill-read, toolResult, resp1, tool, result]
       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ← cache write

Run 2: [user1, skill-read, toolResult, resp1, tool, result, user2, resp2, ...]
       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ← full cache HIT
                                                              new content after cache boundary
```

The injected skill pair is in the persisted history at the same position → prefix is stable → cache hits on the full prior conversation.

### Phase transition (skill changes)

```
Run N (building): [...history..., userN, respN]
Run N+1 (review): [...history..., userN, respN, userN+1, skill-verify, toolResult, ...]
                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ← cache hit on history
                                              new skill is tail content (expected miss)
```

System prompt NEVER changes across phases → system-prompt cache is always warm. The skill injection is message-stream content, not system-prompt content.

### Why deduplication matters for cache

Without deduplication:

```
Run 1: [user1, skill, resp1]
Run 2: [user1, skill, resp1, user2, skill, resp2]  ← DUPLICATE skill, different position
Run 3: [user1, skill, resp1, user2, skill, resp2, user3, skill, resp3]  ← TRIPLICATE
```

The cache prefix grows correctly (hits on prior prefix), but the conversation accumulates redundant skill copies → token waste, context pollution, eventual context-limit exhaustion.

With deduplication:

```
Run 1: [user1, skill, resp1]           ← inject + persist
Run 2: [user1, skill, resp1, user2, resp2]  ← skip inject, skill already in history
Run 3: [..., user3, resp3]             ← skip inject
```

No duplication. Conversation stays clean. Cache prefix stable.

---

## Notes for the Implementer

- **TDD is mandatory.** Every task follows RED → GREEN → COMMIT.
- **Run `vp check --fix` after each task** to catch formatting/lint early.
- **The `Effect` import in runner.ts** is almost certainly already present (the file is Effect-based). Verify before adding.
- **The `existing` session in confirm.ts** already has `status` — TypeScript structural typing handles the pass-through automatically once `buildForceReset`'s type accepts it.
- **The deduplication check** uses `Effect.runPromise` inside `Effect.promise` to avoid error-type mismatch between `SessionError` and the runner's error channel.
- **The `storage` variable in runner.ts** is the `SessionStorageShape` created at line ~312 via `createSessionStorage`. It has `getLeafId()` and `getPathToRoot()` returning Effects.
