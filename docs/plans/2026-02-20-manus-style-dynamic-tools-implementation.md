# Manus-Style Dynamic Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a Manus-aligned dynamic tool system that preserves prompt-prefix cache stability, supports per-step tool masking, adds recoverable tool-result compression, and improves error-aware self-correction loops.

**Architecture:** Keep the tool registry and tool definitions stable, pass dynamic availability through request-level tool masks, resolve per-step allowed tools in the agent loop, and avoid definition mutation in hot loops. Add a recoverable tool-output layer that stores large outputs externally and injects compact locators into context. Build provider-aware gating adapters and verification telemetry before enabling by default.

**Tech Stack:** TypeScript, Vercel AI SDK (`streamText`, `activeTools`, repair hooks), Hono server routes, Vitest, existing `packages/core` agent/session stack, existing `packages/server` chat API.

---

## Execution Constraints

- Follow DRY and YAGNI for each step.
- Enforce strict TDD for every task.
- Use frequent commits (one commit per task unless task explicitly says split commits).
- Keep backward compatibility behind feature flags until rollout tasks are complete.
- Do not mutate tool definition text/schema per iteration unless explicitly required by compatibility adapters.
- Preserve existing behavior for users not sending dynamic tool mask input.

## Primary References To Validate During Execution

- `https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text`
- `https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text`
- `https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent`
- `https://ai-sdk.dev/docs/reference/ai-sdk-core/dynamic-tool`
- `https://platform.openai.com/docs/guides/prompt-caching`
- `https://platform.openai.com/docs/api-reference/chat/create-chat-completion`
- `https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching`

## Sub-Skill References For Execution Session

- `@superpowers/executing-plans` for plan execution governance.
- `@superpowers/test-driven-development` for red-green-refactor on each task.
- `@superpowers/verification-before-completion` before any success claims.
- `@superpowers/requesting-code-review` after major phase completion.

## Definition of Done

- Request-level tool mask supported end-to-end.
- Per-step tool availability computed without changing base tool definitions.
- Cache-stability safeguards implemented and tested.
- Recoverable compression implemented for large tool outputs, with restore tooling.
- Error-aware self-correction loop improvements implemented and tested.
- Provider compatibility adapters and fallback behavior validated.
- Observability and benchmark scripts available.
- Documentation updated with runbooks, rollout flags, and rollback guidance.

---

## Phase 1: Dynamic Tool Mask Foundations

### Task 1: Add Feature Flag and Global Config Guards

**Files:**

- Create: `packages/core/src/session/feature-flags.ts`
- Modify: `packages/core/src/session/processor.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/session/feature-flags.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { isDynamicToolMaskEnabled } from "../../src/session/feature-flags";

describe("dynamic tool mask feature flag", () => {
  it("defaults to false", () => {
    expect(isDynamicToolMaskEnabled(undefined)).toBe(false);
  });

  it("returns true when env flag is true", () => {
    expect(isDynamicToolMaskEnabled({ SAKTI_CODE_DYNAMIC_TOOL_MASK: "true" })).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/feature-flags.test.ts`
Expected: FAIL with module-not-found for `session/feature-flags`.

**Step 3: Write minimal implementation**

```ts
export function isDynamicToolMaskEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.SAKTI_CODE_DYNAMIC_TOOL_MASK ?? "false").toLowerCase() === "true";
}

export function isRecoverableCompressionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.SAKTI_CODE_RECOVERABLE_COMPRESSION ?? "false").toLowerCase() === "true";
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/feature-flags.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/feature-flags.ts packages/core/src/session/processor.ts packages/core/src/index.ts packages/core/tests/session/feature-flags.test.ts
git commit -m "feat(core): add feature flags for dynamic tools and recoverable compression"
```

---

### Task 2: Introduce Tool Mask Type Contracts

**Files:**

- Create: `packages/core/src/session/tool-mask.ts`
- Modify: `packages/core/src/agent/workflow/types.ts`
- Modify: `packages/core/src/session/types.ts`
- Test: `packages/core/tests/session/tool-mask.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { normalizeToolMask } from "../../src/session/tool-mask";

describe("normalizeToolMask", () => {
  it("keeps only boolean entries", () => {
    expect(normalizeToolMask({ read: true, write: false, bad: "x" as any })).toEqual({
      read: true,
      write: false,
    });
  });

  it("returns undefined for empty maps", () => {
    expect(normalizeToolMask({})).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/tool-mask.test.ts`
Expected: FAIL with module-not-found.

**Step 3: Write minimal implementation**

```ts
export type ToolMask = Record<string, boolean>;

export function normalizeToolMask(input: unknown): ToolMask | undefined {
  if (!input || typeof input !== "object") return undefined;
  const out: ToolMask = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "boolean") out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function maskToActiveTools(mask: ToolMask, availableTools: string[]): string[] {
  return availableTools.filter(tool => mask[tool] === true);
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/tool-mask.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/tool-mask.ts packages/core/src/agent/workflow/types.ts packages/core/src/session/types.ts packages/core/tests/session/tool-mask.test.ts
git commit -m "feat(core): add typed tool mask normalization and conversion"
```

---

### Task 3: Extend Chat Request Schema With `toolMask`

**Files:**

- Modify: `packages/server/src/routes/chat.ts`
- Test: `packages/server/tests/routes/chat-tool-mask-schema.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { chatMessageSchema } from "../../src/routes/chat";

describe("chat schema toolMask", () => {
  it("accepts toolMask object", () => {
    const parsed = chatMessageSchema.parse({
      message: "hi",
      stream: true,
      toolMask: { read: true, write: false },
    });
    expect(parsed.toolMask.read).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/server test tests/routes/chat-tool-mask-schema.test.ts`
Expected: FAIL with unknown field or missing `toolMask`.

**Step 3: Write minimal implementation**

```ts
const chatMessageSchema = z.object({
  message: z.union([z.string(), multimodalSchema]),
  messageId: z.string().optional(),
  retryOfAssistantMessageId: z.string().optional(),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  stream: z.boolean().optional().default(true),
  toolMask: z.record(z.string(), z.boolean()).optional(),
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/server test tests/routes/chat-tool-mask-schema.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/server/src/routes/chat.ts packages/server/tests/routes/chat-tool-mask-schema.test.ts
git commit -m "feat(server): accept toolMask in chat request schema"
```

---

### Task 4: Thread Tool Mask Through Chat Route to Session Controller

**Files:**

- Modify: `packages/server/src/routes/chat.ts`
- Modify: `packages/core/src/session/controller.ts`
- Test: `packages/server/tests/routes/chat-tool-mask-plumbing.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

describe("chat tool mask plumbing", () => {
  it("passes toolMask to processMessage", async () => {
    const spy = vi.fn();
    // mock controller.processMessage and assert second arg contains toolMask
    expect(spy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ toolMask: { read: true } })
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/server test tests/routes/chat-tool-mask-plumbing.test.ts`
Expected: FAIL because `toolMask` is not passed.

**Step 3: Write minimal implementation**

```ts
const requestedToolMask = body.toolMask;

controller.processMessage(messageText, {
  toolMask: requestedToolMask,
  onEvent: event => {
    // existing handler
  },
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/server test tests/routes/chat-tool-mask-plumbing.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/server/src/routes/chat.ts packages/core/src/session/controller.ts packages/server/tests/routes/chat-tool-mask-plumbing.test.ts
git commit -m "feat(chat): pass toolMask from route into session controller"
```

---

### Task 5: Extend `SessionController.processMessage` Options To Include Tool Mask

**Files:**

- Modify: `packages/core/src/session/controller.ts`
- Modify: `packages/core/src/session/types.ts`
- Test: `packages/core/tests/session/controller-tool-mask.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("session controller tool mask", () => {
  it("propagates toolMask into agent input context", async () => {
    // mock AgentProcessor.run and inspect input.context.toolMask
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/controller-tool-mask.test.ts`
Expected: FAIL with placeholder assertion.

**Step 3: Write minimal implementation**

```ts
async processMessage(
  message: string,
  options?: {
    toolMask?: Record<string, boolean>;
    onEvent?: (event: { type: string; [key: string]: unknown }) => void;
  }
) {
  // ...
  const result = await this.currentAgent.run({
    task: message,
    context: {
      sessionId: this.sessionId,
      resourceId: this.config.resourceId,
      workspace: this.config.workspace,
      toolMask: options?.toolMask,
    },
  });
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/controller-tool-mask.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/controller.ts packages/core/src/session/types.ts packages/core/tests/session/controller-tool-mask.test.ts
git commit -m "feat(session): support toolMask in processMessage options"
```

---

### Task 6: Resolve Active Tools In Processor From Context Tool Mask

**Files:**

- Modify: `packages/core/src/session/processor.ts`
- Create: `packages/core/src/session/active-tools.ts`
- Test: `packages/core/tests/session/active-tools.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { resolveActiveTools } from "../../src/session/active-tools";

describe("resolveActiveTools", () => {
  it("returns masked enabled tools", () => {
    const tools = resolveActiveTools(["read", "write", "grep"], {
      read: true,
      write: false,
      grep: true,
    });
    expect(tools).toEqual(["read", "grep"]);
  });

  it("returns undefined without mask", () => {
    expect(resolveActiveTools(["read"], undefined)).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/active-tools.test.ts`
Expected: FAIL with module-not-found.

**Step 3: Write minimal implementation**

```ts
export function resolveActiveTools(
  availableToolNames: string[],
  toolMask: Record<string, boolean> | undefined
): string[] | undefined {
  if (!toolMask) return undefined;
  const active = availableToolNames.filter(name => toolMask[name] === true);
  return active.length > 0 ? active : [];
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/active-tools.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/active-tools.ts packages/core/src/session/processor.ts packages/core/tests/session/active-tools.test.ts
git commit -m "feat(core): resolve active tools from request toolMask"
```

---

### Task 7: Wire `activeTools` Calculation Into `streamIteration`

**Files:**

- Modify: `packages/core/src/session/processor.ts`
- Test: `packages/core/tests/session/processor-active-tools.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

const streamTextMock = vi.fn();

vi.mock("ai", () => ({
  streamText: streamTextMock,
  tool: vi.fn(def => def),
}));

describe("processor activeTools wiring", () => {
  it("passes masked activeTools to streamText", async () => {
    // setup processor with tools and context.toolMask
    // run one step
    const args = streamTextMock.mock.calls[0][0];
    expect(args.activeTools).toEqual(["read", "grep"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/processor-active-tools.test.ts`
Expected: FAIL because activeTools remains undefined except last step.

**Step 3: Write minimal implementation**

```ts
const toolMask = normalizeToolMask(this.latestInput?.context?.toolMask);
const maskedActiveTools = resolveActiveTools(Object.keys(toolsForIteration), toolMask);
const activeTools = this.isLastStep() ? [] : maskedActiveTools;
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/processor-active-tools.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/processor.ts packages/core/tests/session/processor-active-tools.test.ts
git commit -m "feat(core): pass request-scoped activeTools to streamText"
```

---

### Task 8: Add Defensive Validation for Empty/Invalid Mask Behavior

**Files:**

- Modify: `packages/core/src/session/processor.ts`
- Test: `packages/core/tests/session/processor-active-tools-validation.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("processor activeTools validation", () => {
  it("falls back to full toolset when mask invalid and feature flag off", () => {
    expect(true).toBe(false);
  });

  it("passes [] when mask valid but enables no tools", () => {
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/processor-active-tools-validation.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

```ts
if (!isDynamicToolMaskEnabled()) {
  activeTools = this.isLastStep() ? [] : undefined;
} else {
  activeTools = this.isLastStep() ? [] : maskedActiveTools;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/processor-active-tools-validation.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/processor.ts packages/core/tests/session/processor-active-tools-validation.test.ts
git commit -m "test(core): validate mask fallback and empty activeTools behavior"
```

---

## Phase 2: Prompt/Cache Stability Hardening

### Task 9: Add Stable Prompt Ordering Utility

**Files:**

- Create: `packages/core/src/session/prompt-order.ts`
- Modify: `packages/core/src/session/processor.ts`
- Test: `packages/core/tests/session/prompt-order.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { orderMessagesForCache } from "../../src/session/prompt-order";

describe("orderMessagesForCache", () => {
  it("keeps static system blocks before dynamic blocks", () => {
    const input = [
      { role: "system", content: "dynamic-obs" },
      { role: "system", content: "base-system" },
      { role: "user", content: "task" },
    ] as any;
    const out = orderMessagesForCache(input);
    expect(out[0].content).toContain("base-system");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/prompt-order.test.ts`
Expected: FAIL with missing module.

**Step 3: Write minimal implementation**

```ts
export function orderMessagesForCache(messages: Array<{ role: string; content: unknown }>) {
  const staticSystem = messages.filter(
    m => m.role === "system" && String(m.content).includes("expert")
  );
  const otherSystem = messages.filter(
    m => m.role === "system" && !String(m.content).includes("expert")
  );
  const rest = messages.filter(m => m.role !== "system");
  return [...staticSystem, ...otherSystem, ...rest];
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/prompt-order.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/prompt-order.ts packages/core/src/session/processor.ts packages/core/tests/session/prompt-order.test.ts
git commit -m "feat(core): add cache-stable prompt ordering utility"
```

---

### Task 10: Stop Per-Iteration Tool Definition Mutation When Masking Enabled

**Files:**

- Modify: `packages/core/src/plugin/hooks.ts`
- Modify: `packages/core/src/session/processor.ts`
- Test: `packages/core/tests/plugin/hooks-tool-definition-stability.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import {
  applyToolDefinitionHook,
  setCorePluginHooks,
  clearCorePluginHooks,
} from "../../src/plugin/hooks";

describe("tool.definition stability", () => {
  it("can bypass mutable definition hook when stability mode enabled", async () => {
    setCorePluginHooks({
      "tool.definition": vi.fn((_i, out) => {
        out.description = "mutated";
      }),
    });
    const tools = await applyToolDefinitionHook({
      tools: { read: { description: "original" } as any },
      skipMutation: true as any,
    });
    expect((tools.read as any).description).toBe("original");
    clearCorePluginHooks();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/plugin/hooks-tool-definition-stability.test.ts`
Expected: FAIL because skipMutation does not exist.

**Step 3: Write minimal implementation**

```ts
export async function applyToolDefinitionHook(input: {
  tools: Record<string, unknown>;
  skipMutation?: boolean;
}) {
  if (input.skipMutation) return input.tools;
  // existing behavior
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/plugin/hooks-tool-definition-stability.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/plugin/hooks.ts packages/core/src/session/processor.ts packages/core/tests/plugin/hooks-tool-definition-stability.test.ts
git commit -m "feat(core): add optional hook bypass for tool definition stability"
```

---

### Task 11: Add Cache Telemetry Event Mapping

**Files:**

- Modify: `packages/core/src/session/processor.ts`
- Modify: `packages/core/src/agent/workflow/types.ts`
- Test: `packages/core/tests/session/processor-cache-telemetry.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("cache telemetry", () => {
  it("emits cache read/write token metrics on step-finish", () => {
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/processor-cache-telemetry.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

```ts
this.emitEvent({
  type: "step-finish",
  // existing fields
  tokens: normalized.tokens,
});
```

Add explicit assertions that cache.read/cache.write are non-null numbers in emitted payload.

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/processor-cache-telemetry.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/processor.ts packages/core/src/agent/workflow/types.ts packages/core/tests/session/processor-cache-telemetry.test.ts
git commit -m "feat(core): expose cache token telemetry on step-finish events"
```

---

### Task 12: Add Integration Test for Stable Prefix Under Dynamic Masking

**Files:**

- Create: `packages/core/tests/integration/dynamic-mask-cache-stability.test.ts`
- Modify: `packages/core/tests/session/processor-plugin-hooks.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("dynamic mask cache stability", () => {
  it("keeps stable tool definition payload across steps", async () => {
    // capture streamText input.tools across 3 iterations
    // ensure definition objects are deep-equal
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/integration/dynamic-mask-cache-stability.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

- Ensure processor passes `skipMutation: true` when feature flag on.
- Ensure `activeTools` changes do not mutate `tools` definition objects.

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/integration/dynamic-mask-cache-stability.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/tests/integration/dynamic-mask-cache-stability.test.ts packages/core/tests/session/processor-plugin-hooks.test.ts packages/core/src/session/processor.ts
git commit -m "test(core): verify stable tool definitions under dynamic activeTools"
```

---

### Task 13: Document Cache-Stability Rules For Contributors

**Files:**

- Create: `docs/architecture/dynamic-tools-cache-stability.md`
- Modify: `README.md`
- Test: `packages/core/tests/integration/dynamic-mask-cache-stability.test.ts` (link assertions optional)

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("docs references", () => {
  it("has cache stability doc linked from README", () => {
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/integration/dynamic-mask-cache-stability.test.ts`
Expected: FAIL placeholder.

**Step 3: Write minimal implementation**

Document:

- Never mutate tool schema/description in hot loop.
- Prefer `activeTools` for dynamic availability.
- Keep static prompt prefix stable.
- Add provider notes for OpenAI vs Anthropic caching.

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/integration/dynamic-mask-cache-stability.test.ts`
Expected: PASS if doc-link assertion is implemented.

**Step 5: Commit**

```bash
git add docs/architecture/dynamic-tools-cache-stability.md README.md packages/core/tests/integration/dynamic-mask-cache-stability.test.ts
git commit -m "docs: add dynamic tools cache stability guide"
```

---

### Task 14: Add Structured Logging For Tool Mask Decisions

**Files:**

- Modify: `packages/core/src/session/processor.ts`
- Test: `packages/core/tests/session/processor-tool-mask-logging.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

describe("tool mask logging", () => {
  it("logs selected active tools and skipped tools", () => {
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/processor-tool-mask-logging.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

```ts
logger.info("Resolved active tools for iteration", {
  module: "agent:processor",
  agent: this.config.id,
  activeTools,
  availableTools: Object.keys(toolsForIteration),
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/processor-tool-mask-logging.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/processor.ts packages/core/tests/session/processor-tool-mask-logging.test.ts
git commit -m "feat(core): log dynamic tool mask resolution per iteration"
```

---

### Task 15: Add End-To-End Test For Request `toolMask` Behavior

**Files:**

- Create: `packages/server/tests/routes/chat-tool-mask-e2e.test.ts`
- Modify: `packages/server/tests/routes/chat.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("chat toolMask e2e", () => {
  it("only emits tool-call events for enabled tools", async () => {
    // send /api/chat with toolMask = { read: true, write: false }
    // assert stream does not contain write tool call
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/server test tests/routes/chat-tool-mask-e2e.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

- Ensure request `toolMask` is passed consistently in both normal and retry flows.
- Ensure no override path drops mask when creating agent events.

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/server test tests/routes/chat-tool-mask-e2e.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/server/tests/routes/chat-tool-mask-e2e.test.ts packages/server/tests/routes/chat.test.ts packages/server/src/routes/chat.ts
git commit -m "test(server): e2e coverage for toolMask request behavior"
```

---

## Phase 3: Recoverable Compression + Restore Tools

### Task 16: Create Tool Output Store Interface

**Files:**

- Create: `packages/core/src/session/tool-output-store/types.ts`
- Create: `packages/core/src/session/tool-output-store/index.ts`
- Test: `packages/core/tests/session/tool-output-store-types.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { ToolOutputStoreKey } from "../../src/session/tool-output-store/types";

describe("tool output store types", () => {
  it("defines stable key shape", () => {
    const key: ToolOutputStoreKey = {
      sessionId: "s1",
      messageId: "m1",
      toolCallId: "t1",
      digest: "abc",
    };
    expect(key.toolCallId).toBe("t1");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/tool-output-store-types.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

```ts
export interface ToolOutputStoreKey {
  sessionId: string;
  messageId: string;
  toolCallId: string;
  digest: string;
}

export interface StoredToolOutput {
  key: ToolOutputStoreKey;
  contentType: "json" | "text";
  value: unknown;
  createdAt: number;
  bytes: number;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/tool-output-store-types.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/tool-output-store/types.ts packages/core/src/session/tool-output-store/index.ts packages/core/tests/session/tool-output-store-types.test.ts
git commit -m "feat(core): define tool output store contracts"
```

---

### Task 17: Implement Filesystem Tool Output Store

**Files:**

- Create: `packages/core/src/session/tool-output-store/fs-store.ts`
- Test: `packages/core/tests/session/tool-output-store-fs.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createFsToolOutputStore } from "../../src/session/tool-output-store/fs-store";

describe("fs tool output store", () => {
  it("stores and retrieves JSON payload", async () => {
    const store = createFsToolOutputStore({ baseDir: "/tmp/sakti-code-tool-store-test" });
    const key = await store.put({
      sessionId: "s1",
      messageId: "m1",
      toolCallId: "t1",
      value: { ok: true },
    });
    const value = await store.get(key);
    expect((value as any).ok).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/tool-output-store-fs.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

```ts
export function createFsToolOutputStore(input: { baseDir: string }) {
  return {
    async put(args: { sessionId: string; messageId: string; toolCallId: string; value: unknown }) {
      // write JSON file and return locator key
    },
    async get(key: string) {
      // read JSON file by key
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/tool-output-store-fs.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/tool-output-store/fs-store.ts packages/core/tests/session/tool-output-store-fs.test.ts
git commit -m "feat(core): implement filesystem store for compressed tool outputs"
```

---

### Task 18: Add Compression Policy Utility

**Files:**

- Create: `packages/core/src/session/tool-output-store/policy.ts`
- Test: `packages/core/tests/session/tool-output-policy.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { shouldCompressToolOutput } from "../../src/session/tool-output-store/policy";

describe("tool output compression policy", () => {
  it("compresses large output", () => {
    expect(shouldCompressToolOutput({ raw: "x".repeat(100_000), thresholdBytes: 4096 })).toBe(true);
  });

  it("keeps small output inline", () => {
    expect(shouldCompressToolOutput({ raw: "ok", thresholdBytes: 4096 })).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/tool-output-policy.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

```ts
export function shouldCompressToolOutput(input: { raw: string; thresholdBytes: number }): boolean {
  return Buffer.byteLength(input.raw, "utf8") > input.thresholdBytes;
}

export function summarizeToolOutput(raw: string): string {
  return raw.slice(0, 1000);
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/tool-output-policy.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/tool-output-store/policy.ts packages/core/tests/session/tool-output-policy.test.ts
git commit -m "feat(core): add policy for recoverable tool-output compression"
```

---

### Task 19: Integrate Compression Into Tool-Result Handling

**Files:**

- Modify: `packages/core/src/session/processor.ts`
- Modify: `packages/core/src/session/feature-flags.ts`
- Test: `packages/core/tests/session/processor-tool-result-compression.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("processor tool result compression", () => {
  it("stores oversized tool result and injects locator", async () => {
    // mock huge tool output event
    // expect emitted tool-result contains locator metadata instead of full payload
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/processor-tool-result-compression.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

```ts
if (isRecoverableCompressionEnabled() && shouldCompressToolOutput({ raw, thresholdBytes })) {
  const locator = await toolOutputStore.put({
    sessionId,
    messageId,
    toolCallId,
    value: chunk.output,
  });
  chunk.output = {
    compressed: true,
    locator,
    summary: summarizeToolOutput(raw),
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/processor-tool-result-compression.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/processor.ts packages/core/src/session/feature-flags.ts packages/core/tests/session/processor-tool-result-compression.test.ts
git commit -m "feat(core): compress oversized tool outputs into recoverable locators"
```

---

### Task 20: Add `restore_tool_output` Tool

**Files:**

- Create: `packages/core/src/tools/restore-tool-output.ts`
- Modify: `packages/core/src/tools/registry.ts`
- Modify: `packages/core/src/tools/phase-tools.ts`
- Test: `packages/core/tests/tools/restore-tool-output.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { restoreToolOutputTool } from "../../src/tools/restore-tool-output";

describe("restore tool output tool", () => {
  it("returns stored payload by locator", async () => {
    const res = await (restoreToolOutputTool as any).execute({ locator: "loc-123" });
    expect(res).toHaveProperty("output");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/tools/restore-tool-output.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

```ts
export const restoreToolOutputTool = tool({
  description: "Restore previously compressed tool output by locator key.",
  inputSchema: z.object({ locator: z.string().min(1) }),
  execute: async ({ locator }) => {
    const output = await getToolOutputStore().get(locator);
    return { locator, output };
  },
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/tools/restore-tool-output.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/tools/restore-tool-output.ts packages/core/src/tools/registry.ts packages/core/src/tools/phase-tools.ts packages/core/tests/tools/restore-tool-output.test.ts
git commit -m "feat(core): add restore_tool_output tool for recoverable compression"
```

---

### Task 21: Ensure Build Agent Has Restore Tool Access

**Files:**

- Modify: `packages/core/src/agent/registry.ts`
- Modify: `packages/core/src/tools/registry.ts`
- Test: `packages/core/tests/agent/registry-restore-tool.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { getAgent } from "../../src/agent/registry";

describe("build agent restore tool", () => {
  it("includes restore-tool-output for build mode", () => {
    const build = getAgent("build");
    expect(build.tools).toContain("restore-tool-output");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/agent/registry-restore-tool.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Add `"restore-tool-output"` to tool type union, registry map, and `build` tool list.

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/agent/registry-restore-tool.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/agent/registry.ts packages/core/src/tools/registry.ts packages/core/tests/agent/registry-restore-tool.test.ts
git commit -m "feat(core): add restore-tool-output to build agent toolset"
```

---

### Task 22: Add Prompt Guidance For Locator-Aware Behavior

**Files:**

- Modify: `packages/core/src/agent/registry.ts`
- Modify: `packages/core/src/prompts/agent-modes.ts`
- Test: `packages/core/tests/agent/registry-prompt-locator.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { getAgent } from "../../src/agent/registry";

describe("locator prompt guidance", () => {
  it("instructs agent to use restore-tool-output when locator present", () => {
    const build = getAgent("build");
    expect(build.systemPrompt).toMatch(/restore-tool-output/i);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/agent/registry-prompt-locator.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Add system prompt bullets:

- If tool result contains `{ compressed: true, locator }`, call `restore-tool-output` when full payload is required.
- Avoid immediate restore unless needed for decision quality.

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/agent/registry-prompt-locator.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/agent/registry.ts packages/core/src/prompts/agent-modes.ts packages/core/tests/agent/registry-prompt-locator.test.ts
git commit -m "docs(prompt): guide agent on locator-based restore behavior"
```

---

### Task 23: Add Unit Tests For Locator Serialization In Events

**Files:**

- Modify: `packages/server/src/routes/chat.ts`
- Test: `packages/server/tests/routes/chat-tool-result-locator-events.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("locator tool result event", () => {
  it("streams locator metadata to UI when output compressed", () => {
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/server test tests/routes/chat-tool-result-locator-events.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Ensure event formatter preserves:

- `compressed: true`
- `locator`
- `summary`
  inside `data-tool-result` and `data-action` subtitle generation.

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/server test tests/routes/chat-tool-result-locator-events.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/server/src/routes/chat.ts packages/server/tests/routes/chat-tool-result-locator-events.test.ts
git commit -m "feat(server): stream compressed tool-result locator metadata"
```

---

### Task 24: Add Integration Test For Restore Flow

**Files:**

- Create: `packages/core/tests/integration/tool-output-restore-flow.test.ts`
- Modify: `packages/core/src/session/processor.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("tool output restore flow", () => {
  it("compresses large result then restores via restore tool", async () => {
    // simulate large output tool call
    // verify compressed locator in first step
    // verify restore-tool-output returns full payload
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/integration/tool-output-restore-flow.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

- Hook up store singleton in processor.
- Ensure restore tool points to same store.
- Keep deterministic locator shape for testability.

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/integration/tool-output-restore-flow.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/tests/integration/tool-output-restore-flow.test.ts packages/core/src/session/processor.ts packages/core/src/tools/restore-tool-output.ts
git commit -m "test(core): validate end-to-end compressed output restore flow"
```

---

### Task 25: Add Operational Cleanup + TTL For Stored Tool Outputs

**Files:**

- Modify: `packages/core/src/session/tool-output-store/fs-store.ts`
- Create: `packages/core/src/session/tool-output-store/cleanup.ts`
- Test: `packages/core/tests/session/tool-output-store-cleanup.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("tool output cleanup", () => {
  it("deletes expired locator files", async () => {
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/tool-output-store-cleanup.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement cleanup utility:

- TTL default 24h.
- Remove files older than TTL.
- Return summary `{ scanned, deleted }`.

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/tool-output-store-cleanup.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/tool-output-store/fs-store.ts packages/core/src/session/tool-output-store/cleanup.ts packages/core/tests/session/tool-output-store-cleanup.test.ts
git commit -m "feat(core): add ttl cleanup for stored compressed tool outputs"
```

---

## Phase 4: Error-Aware Self-Correction Hardening

### Task 26: Normalize Tool Error Envelope

**Files:**

- Create: `packages/core/src/session/tool-error-envelope.ts`
- Modify: `packages/core/src/session/processor.ts`
- Test: `packages/core/tests/session/tool-error-envelope.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { toToolErrorEnvelope } from "../../src/session/tool-error-envelope";

describe("tool error envelope", () => {
  it("maps thrown error into deterministic envelope", () => {
    const env = toToolErrorEnvelope(new Error("ENOENT"), "read");
    expect(env).toEqual(
      expect.objectContaining({
        tool: "read",
        retryable: false,
        category: "filesystem",
      })
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/tool-error-envelope.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

```ts
export function toToolErrorEnvelope(error: unknown, tool: string) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    tool,
    message,
    category: message.includes("ENOENT") ? "filesystem" : "unknown",
    retryable: false,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/tool-error-envelope.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/tool-error-envelope.ts packages/core/src/session/processor.ts packages/core/tests/session/tool-error-envelope.test.ts
git commit -m "feat(core): normalize tool errors into stable envelopes"
```

---

### Task 27: Emit Normalized Error Envelope In `tool-result`

**Files:**

- Modify: `packages/core/src/session/processor.ts`
- Test: `packages/core/tests/session/processor-tool-error-envelope.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("processor tool error envelope emission", () => {
  it("emits tool-result with normalized envelope", () => {
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/processor-tool-error-envelope.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Replace raw `result: { error: chunk.error }` with deterministic shape:

```ts
result: {
  error: toToolErrorEnvelope(chunk.error, chunk.toolName),
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/processor-tool-error-envelope.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/processor.ts packages/core/tests/session/processor-tool-error-envelope.test.ts
git commit -m "feat(core): emit normalized error envelopes in tool-result"
```

---

### Task 28: Improve Repair Function Fallback Behavior

**Files:**

- Modify: `packages/core/src/session/processor.ts`
- Test: `packages/core/tests/session/processor-repair-function.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("repair function fallback", () => {
  it("routes unknown tool to invalid with explicit envelope", async () => {
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/processor-repair-function.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Enhance payload sent to `invalid` tool with:

- attempted tool name
- original input
- error category
- hint: allowed tools list

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/processor-repair-function.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/processor.ts packages/core/tests/session/processor-repair-function.test.ts
git commit -m "feat(core): improve repair fallback payload for invalid tool routing"
```

---

### Task 29: Add Retryability Classification For Tool Failures

**Files:**

- Create: `packages/core/src/session/tool-error-classification.ts`
- Modify: `packages/core/src/session/processor.ts`
- Test: `packages/core/tests/session/tool-error-classification.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { classifyToolFailure } from "../../src/session/tool-error-classification";

describe("tool failure classification", () => {
  it("marks network timeout as retryable", () => {
    const out = classifyToolFailure("ETIMEDOUT while calling api");
    expect(out.retryable).toBe(true);
  });

  it("marks permission denied as non-retryable", () => {
    const out = classifyToolFailure("Permission denied");
    expect(out.retryable).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/tool-error-classification.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

```ts
export function classifyToolFailure(message: string) {
  const text = message.toLowerCase();
  if (text.includes("timedout") || text.includes("network"))
    return { retryable: true, kind: "network" as const };
  if (text.includes("permission")) return { retryable: false, kind: "permission" as const };
  return { retryable: false, kind: "unknown" as const };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/tool-error-classification.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/tool-error-classification.ts packages/core/src/session/processor.ts packages/core/tests/session/tool-error-classification.test.ts
git commit -m "feat(core): classify tool failures by retryability"
```

---

### Task 30: Add Prompt Reminder On Repeated Tool Errors

**Files:**

- Modify: `packages/core/src/session/processor.ts`
- Create: `packages/core/src/prompts/tool-error-reminders.ts`
- Test: `packages/core/tests/session/processor-tool-error-reminder.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("tool error reminder injection", () => {
  it("injects reminder after repeated tool failure signatures", () => {
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/processor-tool-error-reminder.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Inject one-time assistant/system reminder when same failure repeats twice:

- Suggest alternative tool.
- Suggest reading error text before retrying.

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/processor-tool-error-reminder.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/processor.ts packages/core/src/prompts/tool-error-reminders.ts packages/core/tests/session/processor-tool-error-reminder.test.ts
git commit -m "feat(core): add reminder injection for repeated tool failures"
```

---

### Task 31: Tighten Doom Loop Detection With Error Categories

**Files:**

- Modify: `packages/core/src/session/processor.ts`
- Test: `packages/core/tests/session/processor-doom-loop-categories.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("doom loop category handling", () => {
  it("triggers faster for repeated non-retryable permission errors", () => {
    expect(true).toBe(false);
  });

  it("allows extra attempts for retryable network errors", () => {
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/processor-doom-loop-categories.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

- Maintain category-aware counters.
- Non-retryable failures: threshold 2.
- Retryable failures: threshold 4 before abort.

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/processor-doom-loop-categories.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/processor.ts packages/core/tests/session/processor-doom-loop-categories.test.ts
git commit -m "feat(core): category-aware doom loop thresholds"
```

---

### Task 32: Add Integration Test For Error-Learning Loop

**Files:**

- Create: `packages/core/tests/integration/error-learning-loop.test.ts`
- Modify: `packages/core/src/session/processor.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("error learning loop", () => {
  it("changes tool arguments after receiving explicit tool error", async () => {
    // simulate first failed call then corrected call
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/integration/error-learning-loop.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

- Ensure error envelope is present in model-visible message history.
- Ensure repair/reminder injection doesn’t suppress original error data.

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/integration/error-learning-loop.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/tests/integration/error-learning-loop.test.ts packages/core/src/session/processor.ts
git commit -m "test(core): validate self-correction after tool errors"
```

---

### Task 33: Update Chat Stream Mapping For Normalized Error Metadata

**Files:**

- Modify: `packages/server/src/routes/chat.ts`
- Test: `packages/server/tests/routes/chat-retry-error-envelope.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("chat retry envelope mapping", () => {
  it("publishes retry part with normalized metadata kind", async () => {
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/server test tests/routes/chat-retry-error-envelope.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

- Ensure retry event preserves `errorKind` from core processor.
- Ensure tool-result error metadata remains structured in stream.

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/server test tests/routes/chat-retry-error-envelope.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/server/src/routes/chat.ts packages/server/tests/routes/chat-retry-error-envelope.test.ts
git commit -m "feat(server): preserve normalized retry/tool error metadata in stream"
```

---

## Phase 5: Provider Compatibility and Adapter Layer

### Task 34: Add Provider Capability Matrix For Dynamic Tool Control

**Files:**

- Create: `packages/core/src/session/provider-tool-capabilities.ts`
- Modify: `packages/core/src/agent/workflow/model-provider.ts`
- Test: `packages/core/tests/session/provider-tool-capabilities.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { getProviderToolCapabilities } from "../../src/session/provider-tool-capabilities";

describe("provider tool capabilities", () => {
  it("returns baseline capability object for openai", () => {
    const caps = getProviderToolCapabilities("openai");
    expect(caps.supportsActiveToolsHint).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/provider-tool-capabilities.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

```ts
export function getProviderToolCapabilities(providerId: string) {
  switch (providerId) {
    case "openai":
      return { supportsActiveToolsHint: true, supportsAllowedToolsAdapter: true };
    case "anthropic":
      return { supportsActiveToolsHint: true, supportsAllowedToolsAdapter: false };
    default:
      return { supportsActiveToolsHint: true, supportsAllowedToolsAdapter: false };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/provider-tool-capabilities.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/provider-tool-capabilities.ts packages/core/src/agent/workflow/model-provider.ts packages/core/tests/session/provider-tool-capabilities.test.ts
git commit -m "feat(core): add provider capability matrix for dynamic tool control"
```

---

### Task 35: Add Optional Provider Request Adapter Hook Contract

**Files:**

- Modify: `packages/core/src/plugin/hooks.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/plugin/provider-request-adapter-hook.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { setCorePluginHooks, triggerChatParamsHook } from "../../src/plugin/hooks";

describe("provider request adapter hook", () => {
  it("allows modifying provider options for tool gating", async () => {
    const hook = vi.fn((_input, output) => {
      output.options.allowedToolsAdapter = ["read"];
    });
    setCorePluginHooks({ "chat.params": hook });
    const out = await triggerChatParamsHook({} as any, { options: {} });
    expect(out.options.allowedToolsAdapter).toEqual(["read"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/plugin/provider-request-adapter-hook.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

No broad refactor needed; ensure hook contract docs include provider option adapter semantics and type export coverage.

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/plugin/provider-request-adapter-hook.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/plugin/hooks.ts packages/core/src/index.ts packages/core/tests/plugin/provider-request-adapter-hook.test.ts
git commit -m "feat(core): formalize provider request adapter hook contract"
```

---

### Task 36: Add OpenAI-Oriented Allowed-Tools Adapter (Experimental)

**Files:**

- Create: `packages/core/src/session/provider-adapters/openai-allowed-tools.ts`
- Modify: `packages/core/src/session/processor.ts`
- Test: `packages/core/tests/session/openai-allowed-tools-adapter.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { mapActiveToolsToOpenAIOptions } from "../../src/session/provider-adapters/openai-allowed-tools";

describe("openai allowed tools adapter", () => {
  it("maps activeTools to provider options payload", () => {
    const out = mapActiveToolsToOpenAIOptions(["read", "grep"]);
    expect(out).toEqual(
      expect.objectContaining({
        toolChoiceAdapter: expect.any(Object),
      })
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/openai-allowed-tools-adapter.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement isolated mapping utility with feature flag guard:

```ts
export function mapActiveToolsToOpenAIOptions(activeTools: string[] | undefined) {
  if (!activeTools) return {};
  return {
    openaiToolChoiceAdapter: {
      type: "allowed-tools",
      allowed: activeTools,
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/openai-allowed-tools-adapter.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/provider-adapters/openai-allowed-tools.ts packages/core/src/session/processor.ts packages/core/tests/session/openai-allowed-tools-adapter.test.ts
git commit -m "feat(core): add experimental openai allowed-tools adapter utility"
```

---

### Task 37: Add Anthropic Fallback Adapter Notes + Guardrails

**Files:**

- Create: `packages/core/src/session/provider-adapters/anthropic-fallback.ts`
- Modify: `packages/core/src/session/processor.ts`
- Test: `packages/core/tests/session/anthropic-fallback-adapter.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { resolveAnthropicToolMaskStrategy } from "../../src/session/provider-adapters/anthropic-fallback";

describe("anthropic fallback", () => {
  it("uses activeTools strategy without unsupported adapter fields", () => {
    const out = resolveAnthropicToolMaskStrategy(["read"]);
    expect(out).toEqual({ activeTools: ["read"], providerOptions: {} });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/anthropic-fallback-adapter.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

```ts
export function resolveAnthropicToolMaskStrategy(activeTools: string[] | undefined) {
  return {
    activeTools,
    providerOptions: {},
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/anthropic-fallback-adapter.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/provider-adapters/anthropic-fallback.ts packages/core/src/session/processor.ts packages/core/tests/session/anthropic-fallback-adapter.test.ts
git commit -m "feat(core): add anthropic fallback strategy for dynamic tool masking"
```

---

### Task 38: Add Provider-Aware Logging and Safety Warnings

**Files:**

- Modify: `packages/core/src/session/processor.ts`
- Test: `packages/core/tests/session/provider-aware-warnings.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("provider-aware warnings", () => {
  it("logs warning when unsupported adapter mode requested", () => {
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/provider-aware-warnings.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Add warnings when:

- provider lacks specific adapter capability.
- masking strategy falls back from adapter mode to plain `activeTools`.

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/provider-aware-warnings.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/processor.ts packages/core/tests/session/provider-aware-warnings.test.ts
git commit -m "feat(core): add provider-aware warnings for masking strategy fallback"
```

---

## Phase 6: Benchmarks, Rollout, and Operational Hardening

### Task 39: Add Cache and Tool-Selection Benchmark Script

**Files:**

- Create: `scripts/benchmark-dynamic-tools.ts`
- Create: `packages/core/tests/integration/benchmark-smoke.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("benchmark smoke", () => {
  it("runs benchmark script and emits json summary", () => {
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/integration/benchmark-smoke.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Benchmark script outputs:

- average input/output tokens
- cache read/write tokens
- tool-call success rate
- average steps to completion

Command target:

```bash
node --import tsx scripts/benchmark-dynamic-tools.ts --provider=openai --runs=10
```

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/integration/benchmark-smoke.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/benchmark-dynamic-tools.ts packages/core/tests/integration/benchmark-smoke.test.ts
git commit -m "chore: add dynamic tools benchmark script and smoke test"
```

---

### Task 40: Add Feature-Flagged Rollout Config in Server Route

**Files:**

- Modify: `packages/server/src/routes/chat.ts`
- Modify: `packages/server/src/provider/schema.ts`
- Test: `packages/server/tests/routes/chat-dynamic-tools-rollout.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("dynamic tools rollout", () => {
  it("ignores toolMask when rollout flag disabled", async () => {
    expect(true).toBe(false);
  });

  it("applies toolMask when rollout flag enabled", async () => {
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/server test tests/routes/chat-dynamic-tools-rollout.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

- Gate use of incoming `toolMask` with env/config flag.
- Preserve compatibility with older clients.

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/server test tests/routes/chat-dynamic-tools-rollout.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/server/src/routes/chat.ts packages/server/src/provider/schema.ts packages/server/tests/routes/chat-dynamic-tools-rollout.test.ts
git commit -m "feat(server): gate dynamic tool mask behavior behind rollout flag"
```

---

### Task 41: Add Rollback Kill Switches and Safe Defaults

**Files:**

- Modify: `packages/core/src/session/feature-flags.ts`
- Modify: `packages/server/src/routes/chat.ts`
- Test: `packages/core/tests/session/feature-flags.test.ts`
- Test: `packages/server/tests/routes/chat-dynamic-tools-rollout.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { isDynamicToolsHardDisabled } from "../../src/session/feature-flags";

describe("kill switch", () => {
  it("forces old behavior when hard disable is true", () => {
    expect(
      isDynamicToolsHardDisabled({ SAKTI_CODE_DYNAMIC_TOOLS_HARD_DISABLE: "true" } as any)
    ).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/session/feature-flags.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

```ts
export function isDynamicToolsHardDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.SAKTI_CODE_DYNAMIC_TOOLS_HARD_DISABLE ?? "false").toLowerCase() === "true";
}
```

Ensure processor and route short-circuit dynamic behavior when true.

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/session/feature-flags.test.ts`
Run: `pnpm -C packages/server test tests/routes/chat-dynamic-tools-rollout.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/session/feature-flags.ts packages/server/src/routes/chat.ts packages/core/tests/session/feature-flags.test.ts packages/server/tests/routes/chat-dynamic-tools-rollout.test.ts
git commit -m "feat: add hard-disable kill switch for dynamic tool system"
```

---

### Task 42: Update API/OpenAPI Documentation For `toolMask`

**Files:**

- Modify: `packages/server/src/routes/provider.openapi.ts`
- Modify: `packages/server/src/provider/schema.ts`
- Create: `docs/api/chat-tool-mask.md`
- Test: `packages/server/tests/schema/chat-tool-mask-openapi.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("openapi toolMask", () => {
  it("documents toolMask in chat request schema", () => {
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/server test tests/schema/chat-tool-mask-openapi.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

- Add `toolMask` schema docs and examples.
- Document default behavior when omitted.
- Document incompatibility/fallback notes.

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/server test tests/schema/chat-tool-mask-openapi.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/server/src/routes/provider.openapi.ts packages/server/src/provider/schema.ts docs/api/chat-tool-mask.md packages/server/tests/schema/chat-tool-mask-openapi.test.ts
git commit -m "docs(api): document chat toolMask request field and behavior"
```

---

### Task 43: Add Contributor Runbook For Dynamic Tools + Compression

**Files:**

- Create: `docs/runbooks/dynamic-tools.md`
- Modify: `README.md`
- Test: `packages/core/tests/integration/benchmark-smoke.test.ts` (optional doc link assert)

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("dynamic tools runbook docs", () => {
  it("README links to runbook", () => {
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/integration/benchmark-smoke.test.ts`
Expected: FAIL if assertion added.

**Step 3: Write minimal implementation**

Runbook content:

- feature flags and rollout sequence
- operational dashboards and key metrics
- kill switch usage
- known provider caveats
- troubleshooting guide

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/integration/benchmark-smoke.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add docs/runbooks/dynamic-tools.md README.md packages/core/tests/integration/benchmark-smoke.test.ts
git commit -m "docs: add dynamic tools runbook and operator guidance"
```

---

### Task 44: Add Comprehensive Integration Matrix Test Suite

**Files:**

- Create: `packages/core/tests/integration/dynamic-tools-matrix.test.ts`
- Modify: `packages/core/tests/integration/dynamic-mask-cache-stability.test.ts`
- Modify: `packages/core/tests/integration/tool-output-restore-flow.test.ts`
- Modify: `packages/core/tests/integration/error-learning-loop.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("dynamic tools matrix", () => {
  it("covers combinations of feature flags and provider ids", () => {
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test -- --run tests/integration/dynamic-tools-matrix.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Matrix dimensions:

- provider: `openai`, `anthropic`, `zai`
- dynamic mask: on/off
- recoverable compression: on/off
- tool-definition mutation bypass: on/off

Validate invariants:

- no crashes
- deterministic step-finish events
- expected activeTools behavior

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/core test -- --run tests/integration/dynamic-tools-matrix.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/tests/integration/dynamic-tools-matrix.test.ts packages/core/tests/integration/dynamic-mask-cache-stability.test.ts packages/core/tests/integration/tool-output-restore-flow.test.ts packages/core/tests/integration/error-learning-loop.test.ts
git commit -m "test(core): add dynamic tools integration matrix coverage"
```

---

### Task 45: Final Verification Task (Full Test Sweep + Sanity Bench)

**Files:**

- Modify: `docs/plans/2026-02-20-manus-style-dynamic-tools-implementation.md`
- No code changes unless failures require fixes.

**Step 1: Run targeted core test suite**

Run:

```bash
pnpm -C packages/core test -- --run tests/session/feature-flags.test.ts
pnpm -C packages/core test -- --run tests/session/tool-mask.test.ts
pnpm -C packages/core test -- --run tests/session/processor-active-tools.test.ts
pnpm -C packages/core test -- --run tests/integration/dynamic-mask-cache-stability.test.ts
pnpm -C packages/core test -- --run tests/integration/tool-output-restore-flow.test.ts
pnpm -C packages/core test -- --run tests/integration/error-learning-loop.test.ts
pnpm -C packages/core test -- --run tests/integration/dynamic-tools-matrix.test.ts
```

Expected: PASS for all listed suites.

**Step 2: Run targeted server test suite**

Run:

```bash
pnpm -C packages/server test tests/routes/chat-tool-mask-schema.test.ts
pnpm -C packages/server test tests/routes/chat-tool-mask-plumbing.test.ts
pnpm -C packages/server test tests/routes/chat-tool-mask-e2e.test.ts
pnpm -C packages/server test tests/routes/chat-tool-result-locator-events.test.ts
pnpm -C packages/server test tests/routes/chat-retry-error-envelope.test.ts
pnpm -C packages/server test tests/routes/chat-dynamic-tools-rollout.test.ts
pnpm -C packages/server test tests/schema/chat-tool-mask-openapi.test.ts
```

Expected: PASS for all listed suites.

**Step 3: Run benchmark sanity check**

Run:

```bash
node --import tsx scripts/benchmark-dynamic-tools.ts --provider=openai --runs=5
node --import tsx scripts/benchmark-dynamic-tools.ts --provider=anthropic --runs=5
```

Expected:

- script exits 0
- JSON output includes `cacheReadTokens`, `toolSuccessRate`, `avgSteps`

**Step 4: Summarize validation evidence in plan**

Append run logs summary table in this plan:

- command
- status
- key metric
- follow-up

**Step 5: Commit verification evidence**

```bash
git add docs/plans/2026-02-20-manus-style-dynamic-tools-implementation.md
git commit -m "docs(plan): append final validation and benchmark evidence"
```

---

## Risk Register (Execution-Time)

| Risk                                                 | Impact | Likelihood | Mitigation Task(s) |
| ---------------------------------------------------- | ------ | ---------: | ------------------ |
| `activeTools` semantics differ by provider transport | High   |     Medium | 34, 36, 37, 38     |
| Tool definition mutation causes cache misses         | High   |       High | 10, 12, 13         |
| Request `toolMask` breaks backward compatibility     | Medium |     Medium | 3, 4, 40, 41       |
| Compressed outputs become inaccessible               | High   |        Low | 17, 20, 24, 25     |
| Error envelopes remove useful debugging detail       | Medium |     Medium | 26, 27, 33         |
| Benchmark script not representative                  | Medium |       High | 39, 44, 45         |
| Rollout causes production behavior drift             | High   |     Medium | 40, 41, 43, 45     |

---

## Test Strategy Summary

### Unit

- feature flags
- tool mask normalization and resolution
- prompt ordering
- compression policy
- fs output store
- error classification and envelopes
- provider capability matrix/adapters

### Integration

- processor activeTools wiring
- cache stability invariants under dynamic masks
- compression + restore flow
- error-learning loop
- provider feature matrix

### E2E / Route-Level

- chat schema acceptance
- plumbing from route to processor
- stream output event shape for compressed and error tool results
- rollout gating and kill switch behavior

### Performance / Cost Validation

- benchmark script verifies token/cache metrics
- compare baseline vs dynamic-masked runs
- ensure no regression in completion success rate

---

## Implementation Notes For Engineer Running This Plan

- Keep tasks independent and commit after each task.
- If a task introduces red tests in unrelated suites, pause and create a separate bugfix task before continuing.
- Do not squash commits during execution; keep history granular for rollback.
- If provider adapter behavior is uncertain, preserve fallback path and mark uncertain branch with TODO + log warning.
- Re-run previous phase critical tests after each new phase completes.

### Critical Invariants

1. Base tool definitions remain stable across iterations when dynamic masking is enabled.
2. `activeTools` reflects request/context mask when enabled.
3. Last-step hard disable (`activeTools = []`) remains intact.
4. Existing users without `toolMask` get unchanged behavior.
5. Recoverable compression never silently drops payloads; locator must always be retrievable or explicit error returned.
6. Tool errors remain model-visible in a structured way.

### Out-of-Scope (YAGNI)

- Full rewrite to `ToolLoopAgent` architecture.
- Cross-session distributed object store for compressed outputs.
- Provider-specific binary protocol adapters beyond request metadata mappings.
- UI redesign for compressed output visualization.

---

## Command Appendix

### Core test commands

```bash
pnpm -C packages/core test -- --run tests/session/feature-flags.test.ts
pnpm -C packages/core test -- --run tests/session/tool-mask.test.ts
pnpm -C packages/core test -- --run tests/session/active-tools.test.ts
pnpm -C packages/core test -- --run tests/session/processor-active-tools.test.ts
pnpm -C packages/core test -- --run tests/session/prompt-order.test.ts
pnpm -C packages/core test -- --run tests/plugin/hooks-tool-definition-stability.test.ts
pnpm -C packages/core test -- --run tests/session/processor-cache-telemetry.test.ts
pnpm -C packages/core test -- --run tests/integration/dynamic-mask-cache-stability.test.ts
pnpm -C packages/core test -- --run tests/session/tool-output-store-fs.test.ts
pnpm -C packages/core test -- --run tests/session/tool-output-policy.test.ts
pnpm -C packages/core test -- --run tests/session/processor-tool-result-compression.test.ts
pnpm -C packages/core test -- --run tests/tools/restore-tool-output.test.ts
pnpm -C packages/core test -- --run tests/integration/tool-output-restore-flow.test.ts
pnpm -C packages/core test -- --run tests/session/tool-error-envelope.test.ts
pnpm -C packages/core test -- --run tests/session/tool-error-classification.test.ts
pnpm -C packages/core test -- --run tests/integration/error-learning-loop.test.ts
pnpm -C packages/core test -- --run tests/session/provider-tool-capabilities.test.ts
pnpm -C packages/core test -- --run tests/session/openai-allowed-tools-adapter.test.ts
pnpm -C packages/core test -- --run tests/session/anthropic-fallback-adapter.test.ts
pnpm -C packages/core test -- --run tests/integration/dynamic-tools-matrix.test.ts
```

### Server test commands

```bash
pnpm -C packages/server test tests/routes/chat-tool-mask-schema.test.ts
pnpm -C packages/server test tests/routes/chat-tool-mask-plumbing.test.ts
pnpm -C packages/server test tests/routes/chat-tool-mask-e2e.test.ts
pnpm -C packages/server test tests/routes/chat-tool-result-locator-events.test.ts
pnpm -C packages/server test tests/routes/chat-retry-error-envelope.test.ts
pnpm -C packages/server test tests/routes/chat-dynamic-tools-rollout.test.ts
pnpm -C packages/server test tests/schema/chat-tool-mask-openapi.test.ts
```

### Bench and sanity commands

```bash
node --import tsx scripts/benchmark-dynamic-tools.ts --provider=openai --runs=5
node --import tsx scripts/benchmark-dynamic-tools.ts --provider=anthropic --runs=5
node --import tsx scripts/benchmark-dynamic-tools.ts --provider=zai --runs=5
```

---

## Checklist For PR Reviewer

- [ ] Feature flags default to safe/off behavior.
- [ ] Request `toolMask` is validated and optional.
- [ ] `activeTools` is computed from normalized mask and feature flags.
- [ ] Last-step tools disable behavior preserved.
- [ ] Tool definition mutation bypass available and tested.
- [ ] Cache telemetry present and visible in events.
- [ ] Recoverable compression store works with restore tool.
- [ ] Error envelopes are structured and stable.
- [ ] Provider compatibility fallback logs are clear.
- [ ] Rollout/kill-switch behavior verified.
- [ ] OpenAPI + runbook docs updated.
- [ ] Benchmark script produces valid metrics.

---

## Backout Plan

If production regressions occur:

1. Set `SAKTI_CODE_DYNAMIC_TOOLS_HARD_DISABLE=true`.
2. Set `SAKTI_CODE_RECOVERABLE_COMPRESSION=false`.
3. Redeploy server and core runtime.
4. Validate chat route behavior with legacy requests.
5. Verify no `toolMask`-dependent path is active.
6. Keep logs and benchmark outputs for postmortem.

---

## Post-Deployment Validation Runbook (Day 0, Day 1, Day 7)

### Day 0

- Validate 10 real chats with no `toolMask`: behavior unchanged.
- Validate 10 real chats with restrictive `toolMask`: only allowed tools appear.
- Verify zero unexpected fatal errors in session processor.

### Day 1

- Compare cache read token metrics pre/post rollout.
- Compare average tool-call success rate.
- Compare average step count for typical coding task prompts.

### Day 7

- Evaluate locator store growth and cleanup health.
- Evaluate error category distribution.
- Decide whether to enable adapter mode for additional providers.

---

## Extended Task Notes (Per-Task Testing Heuristics)

### Heuristic A: Test Naming Convention

Use deterministic names:

- `should_<behavior>_when_<condition>`

Examples:

- `should_pass_masked_active_tools_when_mask_is_present`
- `should_emit_locator_metadata_when_tool_output_exceeds_threshold`

### Heuristic B: Mocking Policy

- Mock AI provider calls only at boundary (`streamText`/`generateText`).
- Do not mock internal helper units unless needed to isolate failures.
- Avoid brittle snapshot tests for large payloads; assert structural subsets.

### Heuristic C: Expected Failure Quality

For each red step, failure must be specific:

- Missing module
- Missing field
- Wrong array contents
- Wrong event shape

Avoid generic false assertions unless bootstrapping test file skeleton.

### Heuristic D: Commit Hygiene

- Each commit must correspond to one task.
- Commit message prefix:
  - `feat` for behavior
  - `test` for coverage only
  - `docs` for documentation
  - `chore` for script/infrastructure

### Heuristic E: Verification Before Completion

Before marking any phase complete:

- Run all tests added in that phase.
- Run one earlier-phase smoke test to detect regressions.
- Capture command output summary into PR description.

---

## Future Enhancements (Not In Scope For This Plan)

- Shared distributed tool-output store (S3/Redis) for multi-instance restore.
- Adaptive tool mask learning from historical success rates.
- Automated provider capability probing via live model metadata APIs.
- UI-native viewer for compressed output locators with lazy expansion.
- Continuous benchmark pipeline in CI with trend alerts.

---

## Handoff Notes For `executing-plans`

- Implement strictly in task order.
- If a task blocks on ambiguous provider behavior, add a minimal fallback and continue.
- Do not reorder rollout tasks before core behavior is covered by tests.
- Keep this plan updated with validation notes in Task 45.

---

Plan complete and saved to `docs/plans/2026-02-20-manus-style-dynamic-tools-implementation.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
