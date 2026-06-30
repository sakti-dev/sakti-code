# Unified buildSystemPrompt — Auto-Embed Tool Descriptions

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-embed tool descriptions into the system prompt alongside skills, so every LLM (especially smaller ones) sees how to use each tool before its first call — without manually editing any agent prompt.

**Architecture:** A new `composeSystemPrompt()` function in the agent package combines three blocks: (1) the agent's base prompt, (2) a rendered tool inventory (`# Tool: <name>\n<description>` sections), (3) the existing skills block. The runner calls this once at setup time for ALL agents (including intake). Mid-session skill changes (add/remove) work automatically because `stripSkillsBlock` only strips the skills suffix, leaving the tool inventory in place.

**Tech Stack:** TypeScript, TypeBox (TSchema), vitest, Effect (harness), Hono (server)

---

## Background: Why This Matters

The edit tool has a rich description (HASHLINE_DESCRIPTION) explaining the hashline patch format. This description is passed to the AI SDK as part of the tool JSON Schema. But smaller LLMs (glm-5-turbo, Qwen 35B) **don't read tool schemas carefully** before first use — they default to patterns from training data (e.g., `old_string/new_string`). The system prompt is what they read carefully. Pi solves this by embedding tool descriptions directly into the system prompt via `renderToolInventory()`. Sakti currently only embeds skills (via `appendSkillsBlock`), not tools.

### Current flow (broken):

```
runner.ts:539  appendSkillsBlock(agent.systemPrompt, skills, hasRead)
               ↑ skills: embedded ✓    tools: NOT embedded ✗
```

### Target flow:

```
runner.ts      composeSystemPrompt(agent.systemPrompt, activeTools, skills, hasRead)
               ↑ skills: embedded ✓    tools: embedded ✓
```

### Mid-session skill changes (unchanged):

```
harness        stripSkillsBlock(prompt)  → strips only skills suffix, tools stay
               appendSkillsBlock(...)    → re-appends skills after tools
```

---

## Files Overview

**Create:**

- `packages/agent/src/resources/tool-inventory.ts` — `renderToolInventory()` + `demoteHeaders()`
- `packages/agent/src/resources/__tests__/tool-inventory.test.ts` — comprehensive unit tests

**Modify:**

- `packages/agent/src/resources/system-prompt.ts` — add `composeSystemPrompt()`
- `packages/agent/src/resources/__tests__/system-prompt.test.ts` — add composition tests
- `packages/agent/src/index.ts` — export new functions
- `apps/server/src/agent/runner.ts` — replace `appendSkillsBlock` with `composeSystemPrompt`
- `apps/server/src/agent/__tests__/runner.test.ts` (or new test file) — integration test

---

## Task 1: `demoteHeaders()` — prevent markdown header collision

When a tool description contains `#`-level headers, they collide with the `# Tool: <name>` wrapper. This utility demotes all ATX headers by one level (unless they're inside fenced code blocks).

**Files:**

- Create: `packages/agent/src/resources/tool-inventory.ts`
- Test: `packages/agent/src/resources/__tests__/tool-inventory.test.ts`

### Step 1: Write failing tests

````typescript
// packages/agent/src/resources/__tests__/tool-inventory.test.ts
import { describe, expect, it } from "vitest";
import { demoteHeaders } from "../tool-inventory";

describe("demoteHeaders", () => {
  it("returns descriptions with no level-1 headers unchanged", () => {
    const input = "Some description\n## Already level 2";
    expect(demoteHeaders(input)).toBe(input);
  });

  it("demotes level-1 headers to level-2 when present", () => {
    const input = "# Section\nSome text";
    expect(demoteHeaders(input)).toBe("## Section\nSome text");
  });

  it("demotes all ATX headers by one level", () => {
    const input = "# A\n## B\n### C";
    expect(demoteHeaders(input)).toBe("## A\n### B\n#### C");
  });

  it("preserves headers inside fenced code blocks", () => {
    const input = "# Real Header\n```\n# Not A Header\n```";
    const result = demoteHeaders(input);
    expect(result).toContain("## Real Header");
    expect(result).toContain("# Not A Header");
  });

  it("handles mixed fenced and unfenced headers", () => {
    const input = "# Outside\n```\n# Inside\n```\n# Also Outside";
    const result = demoteHeaders(input);
    expect(result).toBe("## Outside\n```\n# Inside\n```\n## Also Outside");
  });

  it("handles tilde-fenced code blocks", () => {
    const input = "# Outside\n~~~\n# Inside\n~~~";
    const result = demoteHeaders(input);
    expect(result).toContain("## Outside");
    expect(result).toContain("# Inside");
  });

  it("returns plain text with no headers unchanged", () => {
    const input = "Just some text\nwith no headers";
    expect(demoteHeaders(input)).toBe(input);
  });

  it("handles empty string", () => {
    expect(demoteHeaders("")).toBe("");
  });
});
````

### Step 2: Run tests to verify they fail

```bash
cd packages/agent && npx vitest run src/resources/__tests__/tool-inventory.test.ts
```

Expected: FAIL — `demoteHeaders` is not defined (module not found).

### Step 3: Implement `demoteHeaders`

```typescript
// packages/agent/src/resources/tool-inventory.ts

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const ATX_RE = /^ {0,3}#{1,6}( |\t|$)/;
const TOP_LEVEL_RE = /^ {0,3}#( |\t|$)/;

/**
 * Demote every ATX header in `description` by one level so the whole block
 * nests under a `# Tool: <name>` wrapper heading. Only triggered when a
 * level-1 header is actually present; descriptions already at `##` are
 * left untouched. Headers inside fenced code blocks are never rewritten.
 */
export function demoteHeaders(description: string): string {
  const lines = description.split("\n");

  let fence: string | undefined;
  let collides = false;
  for (const line of lines) {
    const marker = FENCE_RE.exec(line)?.[1]?.[0];
    if (marker) {
      fence = fence === undefined ? marker : fence === marker ? undefined : fence;
    } else if (fence === undefined && TOP_LEVEL_RE.test(line)) {
      collides = true;
      break;
    }
  }
  if (!collides) return description;

  fence = undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marker = FENCE_RE.exec(line)?.[1]?.[0];
    if (marker) {
      fence = fence === undefined ? marker : fence === marker ? undefined : fence;
    } else if (fence === undefined && ATX_RE.test(line)) {
      lines[i] = line.replace(/^( {0,3})#/, "$1##");
    }
  }
  return lines.join("\n");
}
```

### Step 4: Run tests to verify they pass

```bash
cd packages/agent && npx vitest run src/resources/__tests__/tool-inventory.test.ts
```

Expected: PASS — all 8 tests.

### Step 5: Commit

```bash
git add packages/agent/src/resources/tool-inventory.ts packages/agent/src/resources/__tests__/tool-inventory.test.ts
git commit -m "feat(agent): add demoteHeaders utility for tool inventory rendering"
```

---

## Task 2: `renderToolInventory()` — extract and format tool descriptions

Renders each tool as a `# Tool: <name>` section with its (header-demoted) description. Tools are sorted alphabetically by name for cache stability.

**Files:**

- Modify: `packages/agent/src/resources/tool-inventory.ts`
- Modify: `packages/agent/src/resources/__tests__/tool-inventory.test.ts`

### Step 1: Add imports and failing tests

Append to the test file:

````typescript
import { renderToolInventory } from "../tool-inventory";
import type { AgentTool } from "../../types";

// Minimal mock tool factory for tests
function mockTool(name: string, description: string): AgentTool {
  return {
    name,
    description,
    label: name.charAt(0).toUpperCase() + name.slice(1),
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: "" }], details: undefined }),
  } as unknown as AgentTool;
}

describe("renderToolInventory", () => {
  it("returns empty string for empty tool list", () => {
    expect(renderToolInventory([])).toBe("");
  });

  it("renders a single tool with name and description", () => {
    const tool = mockTool("read", "Read a file from the filesystem.");
    const result = renderToolInventory([tool]);
    expect(result).toContain("# Tool: read");
    expect(result).toContain("Read a file from the filesystem.");
  });

  it("sorts tools alphabetically by name", () => {
    const tools = [
      mockTool("write", "Write a file."),
      mockTool("bash", "Run a command."),
      mockTool("edit", "Edit a file."),
    ];
    const result = renderToolInventory(tools);
    const bashIdx = result.indexOf("# Tool: bash");
    const editIdx = result.indexOf("# Tool: edit");
    const writeIdx = result.indexOf("# Tool: write");
    expect(bashIdx).toBeLessThan(editIdx);
    expect(editIdx).toBeLessThan(writeIdx);
  });

  it("separates tool sections with double newline", () => {
    const tools = [mockTool("edit", "Edit."), mockTool("read", "Read.")];
    const result = renderToolInventory(tools);
    expect(result).toContain("# Tool: edit\nEdit.\n\n# Tool: read");
  });

  it("demotes level-1 headers in descriptions", () => {
    const tool = mockTool("edit", "# Syntax\nUse SWAP N.=M:");
    const result = renderToolInventory([tool]);
    expect(result).toContain("## Syntax");
    expect(result).not.toMatch(/^# Syntax/m);
  });

  it("skips tools with empty descriptions but still lists them", () => {
    const tool = mockTool("mystery", "");
    const result = renderToolInventory([tool]);
    expect(result).toContain("# Tool: mystery");
  });

  it("handles tools with multi-line descriptions", () => {
    const tool = mockTool("edit", "Line 1\nLine 2\nLine 3");
    const result = renderToolInventory([tool]);
    expect(result).toContain("Line 1\nLine 2\nLine 3");
  });

  it("preserves code blocks inside descriptions", () => {
    const tool = mockTool("edit", "Example:\n```\nSWAP 1.=1:\n+body\n```");
    const result = renderToolInventory([tool]);
    expect(result).toContain("```\nSWAP 1.=1:\n+body\n```");
  });

  it("renders a realistic edit tool description", () => {
    const desc =
      "Edit files using hashline patches. Line numbers are 1-indexed.\n\nLine ops:\n- SWAP N.=M: replace lines\n- DEL N.=M: delete lines";
    const tool = mockTool("edit", desc);
    const result = renderToolInventory([tool]);
    expect(result).toContain("# Tool: edit");
    expect(result).toContain("hashline patches");
    expect(result).toContain("SWAP N.=M");
  });
});
````

### Step 2: Run tests to verify they fail

```bash
cd packages/agent && npx vitest run src/resources/__tests__/tool-inventory.test.ts
```

Expected: FAIL — `renderToolInventory` is not exported.

### Step 3: Implement `renderToolInventory`

Add to `packages/agent/src/resources/tool-inventory.ts`:

```typescript
import type { AgentTool } from "../../types";

/**
 * Render a set of tools as `# Tool: <name>` sections for embedding in the
 * system prompt. Tools are sorted alphabetically for cache stability.
 * Each tool's description has its ATX headers demoted by one level so they
 * nest under the wrapper heading.
 */
export function renderToolInventory(tools: readonly AgentTool[]): string {
  if (tools.length === 0) return "";
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  return sorted
    .map((tool) => {
      const parts = [`# Tool: ${tool.name}`];
      if (tool.description) {
        parts.push(demoteHeaders(tool.description));
      }
      return parts.join("\n");
    })
    .join("\n\n");
}
```

### Step 4: Run tests to verify they pass

```bash
cd packages/agent && npx vitest run src/resources/__tests__/tool-inventory.test.ts
```

Expected: PASS — all tests (8 demoteHeaders + 9 renderToolInventory = 17).

### Step 5: Commit

```bash
git add packages/agent/src/resources/tool-inventory.ts packages/agent/src/resources/__tests__/tool-inventory.test.ts
git commit -m "feat(agent): add renderToolInventory for system prompt embedding"
```

---

## Task 3: `composeSystemPrompt()` — unified composition

Combines base agent prompt + tool inventory + skills block into a single system prompt string. Replaces the ad-hoc `appendSkillsBlock` call in the runner.

**Files:**

- Modify: `packages/agent/src/resources/system-prompt.ts`
- Modify: `packages/agent/src/resources/__tests__/system-prompt.test.ts`

### Step 1: Write failing tests

Add to `packages/agent/src/resources/__tests__/system-prompt.test.ts`:

```typescript
import { composeSystemPrompt } from "../system-prompt";
import type { AgentTool } from "../../types";
import type { Skill } from "../../harness-types";

function mockTool(name: string, description: string): AgentTool {
  return {
    name,
    description,
    label: name,
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: "" }], details: undefined }),
  } as unknown as AgentTool;
}

function mockSkill(name: string, description: string, filePath: string): Skill {
  return { name, description, filePath } as Skill;
}

describe("composeSystemPrompt", () => {
  const BASE = "You are a coding agent.";

  it("returns base prompt alone when no tools and no skills", () => {
    expect(composeSystemPrompt(BASE, [], [], false)).toBe(BASE);
  });

  it("appends tool inventory after base prompt", () => {
    const tools = [mockTool("edit", "Edit files.")];
    const result = composeSystemPrompt(BASE, tools, [], false);
    expect(result).toContain(BASE);
    expect(result).toContain("# Tool: edit");
    expect(result).toContain("Edit files.");
  });

  it("appends skills block after tool inventory", () => {
    const tools = [mockTool("edit", "Edit files.")];
    const skills = [mockSkill("tdd", "Test-driven dev", "/skills/tdd/SKILL.md")];
    const result = composeSystemPrompt(BASE, tools, skills, true);
    const toolIdx = result.indexOf("# Tool: edit");
    const skillsIdx = result.indexOf("<available_skills>");
    expect(toolIdx).toBeGreaterThan(-1);
    expect(skillsIdx).toBeGreaterThan(toolIdx);
  });

  it("omits skills block when hasRead is false", () => {
    const skills = [mockSkill("tdd", "TDD", "/skills/tdd/SKILL.md")];
    const result = composeSystemPrompt(BASE, [], skills, false);
    expect(result).not.toContain("<available_skills>");
  });

  it("includes skills block when hasRead is true", () => {
    const skills = [mockSkill("tdd", "TDD", "/skills/tdd/SKILL.md")];
    const result = composeSystemPrompt(BASE, [], skills, true);
    expect(result).toContain("<available_skills>");
    expect(result).toContain("tdd");
  });

  it("separates blocks with double newlines", () => {
    const tools = [mockTool("read", "Read files.")];
    const skills = [mockSkill("tdd", "TDD", "/skills/tdd/SKILL.md")];
    const result = composeSystemPrompt(BASE, tools, skills, true);
    // base \n\n # Tool: read ... \n\n <available_skills>
    expect(result).toMatch(/You are a coding agent\.\n\n# Tool: read/);
    expect(result).toMatch(/\n\n.*<available_skills>/s);
  });

  it("handles multiple tools and skills together", () => {
    const tools = [mockTool("edit", "Edit."), mockTool("read", "Read."), mockTool("bash", "Run.")];
    const skills = [
      mockSkill("tdd", "TDD", "/tdd/SKILL.md"),
      mockSkill("debug", "Debug", "/debug/SKILL.md"),
    ];
    const result = composeSystemPrompt(BASE, tools, skills, true);
    // Tools sorted alphabetically
    const bashIdx = result.indexOf("# Tool: bash");
    const editIdx = result.indexOf("# Tool: edit");
    const readIdx = result.indexOf("# Tool: read");
    expect(bashIdx).toBeLessThan(editIdx);
    expect(editIdx).toBeLessThan(readIdx);
    // Skills present
    expect(result).toContain("tdd");
    expect(result).toContain("debug");
  });

  it("produces cache-stable output (same input → same output)", () => {
    const tools = [mockTool("edit", "Edit."), mockTool("read", "Read.")];
    const skills = [mockSkill("tdd", "TDD", "/tdd/SKILL.md")];
    const a = composeSystemPrompt(BASE, tools, skills, true);
    const b = composeSystemPrompt(BASE, tools, skills, true);
    expect(a).toBe(b);
  });
});
```

### Step 2: Run tests to verify they fail

```bash
cd packages/agent && npx vitest run src/resources/__tests__/system-prompt.test.ts
```

Expected: FAIL — `composeSystemPrompt` is not exported.

### Step 3: Implement `composeSystemPrompt`

Add to `packages/agent/src/resources/system-prompt.ts`:

```typescript
import { renderToolInventory } from "./tool-inventory";

/**
 * Compose a complete system prompt from three blocks:
 * 1. The agent's base system prompt (role, principles)
 * 2. A rendered tool inventory (# Tool: <name> sections with descriptions)
 * 3. The skills advertisement (<available_skills> block)
 *
 * Blocks are separated by double newlines. Tools are always included;
 * skills are gated on `hasRead` (the `read` tool must be available for
 * the model to load skill files).
 *
 * This replaces the ad-hoc appendSkillsBlock call in the runner and
 * mirrors pi's unified buildSystemPrompt composition.
 */
export function composeSystemPrompt(
  baseSystemPrompt: string,
  tools: readonly AgentTool[],
  skills: readonly Skill[],
  hasRead: boolean,
): string {
  const parts: string[] = [baseSystemPrompt];

  const toolInventory = renderToolInventory(tools);
  if (toolInventory) {
    parts.push(toolInventory);
  }

  if (hasRead) {
    const skillsBlock = formatSkillsForSystemPrompt([...skills]);
    if (skillsBlock) {
      parts.push(skillsBlock);
    }
  }

  return parts.join("\n\n");
}
```

### Step 4: Run tests to verify they pass

```bash
cd packages/agent && npx vitest run src/resources/__tests__/system-prompt.test.ts
```

Expected: PASS — all existing tests + new composition tests.

### Step 5: Commit

```bash
git add packages/agent/src/resources/system-prompt.ts packages/agent/src/resources/__tests__/system-prompt.test.ts
git commit -m "feat(agent): add composeSystemPrompt for unified prompt composition"
```

---

## Task 4: Export new functions from agent package

**Files:**

- Modify: `packages/agent/src/index.ts`

### Step 1: Add exports

Find the existing exports from `./resources/system-prompt` and add the new ones. Also export from `./resources/tool-inventory`:

```typescript
// In packages/agent/src/index.ts, find:
export {
  appendSkillsBlock,
  formatSkillsForSystemPrompt,
  // ...
} from "./resources/system-prompt";

// Change to:
export {
  appendSkillsBlock,
  composeSystemPrompt,
  formatSkillsForSystemPrompt,
  // ...
} from "./resources/system-prompt";

export { demoteHeaders, renderToolInventory } from "./resources/tool-inventory";
```

### Step 2: Verify typecheck

```bash
cd packages/agent && npx tsc --noEmit
```

Expected: clean (no errors).

### Step 3: Commit

```bash
git add packages/agent/src/index.ts
git commit -m "feat(agent): export composeSystemPrompt and tool-inventory functions"
```

---

## Task 5: Wire `composeSystemPrompt` into the runner

Replace the `appendSkillsBlock` call in the runner with `composeSystemPrompt`. This is the critical integration point — tool descriptions now appear in the system prompt for ALL agents.

**Files:**

- Modify: `apps/server/src/agent/runner.ts`

### Step 1: Read the current runner code

Read `apps/server/src/agent/runner.ts` lines 455-549 to understand the exact composition flow:

- Line 455: `const tools = buildTools(project.cwd)` — builds all tools
- Lines 481-490: skills loaded and filtered
- Lines 492-509: harness constructed (intake gets systemPrompt here)
- Lines 530-549: `appendSkillsBlock` called ONLY for non-intake

### Step 2: Understand what needs to change

The change:

1. Replace the `appendSkillsBlock` import with `composeSystemPrompt`
2. Filter tools by `agent.activeToolNames` to get the active subset
3. Call `composeSystemPrompt` with `(agent.systemPrompt, activeTools, activeSkills, hasRead)` for ALL agents
4. Move the composition BEFORE the harness constructor (so intake also gets it)

### Step 3: Write a runner integration test

This is tricky because the runner is deeply integrated with the server context. Instead of a full runner test, write a focused test that verifies the composition logic the runner will use:

```typescript
// apps/server/src/agent/__tests__/system-prompt-composition.test.ts
import { describe, expect, it } from "vitest";
import { composeSystemPrompt } from "@sakti-code/agent";
import type { AgentTool } from "@sakti-code/agent";

describe("runner system prompt composition", () => {
  it("includes the edit tool description when edit is in the toolset", () => {
    const editTool: AgentTool = {
      name: "edit",
      description: "Edit files using hashline patches. Use SWAP N.=M: to replace lines.",
      label: "Edit",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: [{ type: "text", text: "" }], details: undefined }),
    } as unknown as AgentTool;

    const readTool: AgentTool = {
      name: "read",
      description: "Read a file from the local filesystem.",
      label: "Read",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: [{ type: "text", text: "" }], details: undefined }),
    } as unknown as AgentTool;

    const prompt = composeSystemPrompt("You are a coding agent.", [editTool, readTool], [], true);

    // Tool inventory is embedded
    expect(prompt).toContain("# Tool: edit");
    expect(prompt).toContain("hashline patches");
    expect(prompt).toContain("# Tool: read");
    // Base prompt preserved
    expect(prompt).toContain("You are a coding agent.");
  });

  it("respects activeToolNames filtering", () => {
    const allTools: AgentTool[] = [
      {
        name: "read",
        description: "Read.",
        label: "Read",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ content: [{ type: "text", text: "" }], details: undefined }),
      } as unknown as AgentTool,
      {
        name: "edit",
        description: "Edit.",
        label: "Edit",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ content: [{ type: "text", text: "" }], details: undefined }),
      } as unknown as AgentTool,
      {
        name: "bash",
        description: "Bash.",
        label: "Bash",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ content: [{ type: "text", text: "" }], details: undefined }),
      } as unknown as AgentTool,
    ];
    const activeToolNames = ["read", "bash"];
    const activeTools = allTools.filter((t) => activeToolNames.includes(t.name));

    const prompt = composeSystemPrompt("Base.", activeTools, [], false);
    expect(prompt).toContain("# Tool: read");
    expect(prompt).toContain("# Tool: bash");
    expect(prompt).not.toContain("# Tool: edit");
  });
});
```

### Step 4: Run the test to verify it fails

```bash
cd apps/server && npx vitest run src/agent/__tests__/system-prompt-composition.test.ts
```

Expected: FAIL — `composeSystemPrompt` not yet imported from `@sakti-code/agent` at the server level (or test setup issue).

Actually — this should pass already since `composeSystemPrompt` is exported from the agent package (Task 4). The test verifies the composition logic the runner will use, not the runner itself. It should PASS if Tasks 1-4 are done.

If it fails, fix the import path or mock setup.

### Step 5: Modify the runner

In `apps/server/src/agent/runner.ts`:

**Change the import:**

Find:

```typescript
import {
  appendSkillsBlock,
  // ...
} from "@sakti-code/agent";
```

Add `composeSystemPrompt`:

```typescript
import {
  appendSkillsBlock, // keep for mid-session use in harness
  composeSystemPrompt,
  // ...
} from "@sakti-code/agent";
```

**Replace the composition logic (lines ~530-549):**

Find:

```typescript
if (!isIntake) {
  const hasRead = agent.activeToolNames === undefined || agent.activeToolNames.includes("read");
  const composedSystemPrompt = appendSkillsBlock(agent.systemPrompt, activeSkills, hasRead);
  await harness.switchAgent(
    composedSystemPrompt === agent.systemPrompt
      ? agent
      : { ...agent, systemPrompt: composedSystemPrompt },
  );
}
```

Replace with:

```typescript
{
  const hasRead = agent.activeToolNames === undefined || agent.activeToolNames.includes("read");
  const activeTools =
    agent.activeToolNames !== undefined
      ? tools.filter((t) => agent.activeToolNames!.includes(t.name))
      : tools;
  const composedSystemPrompt = composeSystemPrompt(
    agent.systemPrompt,
    activeTools,
    activeSkills,
    hasRead,
  );

  if (isIntake) {
    // For intake, update the harness system prompt directly
    await harness.switchAgent(
      composedSystemPrompt === agent.systemPrompt
        ? agent
        : { ...agent, systemPrompt: composedSystemPrompt },
    );
  } else {
    await harness.switchAgent(
      composedSystemPrompt === agent.systemPrompt
        ? agent
        : { ...agent, systemPrompt: composedSystemPrompt },
    );
  }
}
```

Note: Both branches do the same thing — the `if (isIntake)` can be collapsed. The key change is that composition now runs for ALL agents (including intake), and tools are included.

**Simplified version (collapse the conditional):**

```typescript
{
  const hasRead = agent.activeToolNames === undefined || agent.activeToolNames.includes("read");
  const activeTools =
    agent.activeToolNames !== undefined
      ? tools.filter((t) => agent.activeToolNames!.includes(t.name))
      : tools;
  const composedSystemPrompt = composeSystemPrompt(
    agent.systemPrompt,
    activeTools,
    activeSkills,
    hasRead,
  );
  await harness.switchAgent(
    composedSystemPrompt === agent.systemPrompt
      ? agent
      : { ...agent, systemPrompt: composedSystemPrompt },
  );
}
```

### Step 6: Also update intake path

For intake, the harness is constructed with `systemPrompt: INTAKE_SYSTEM_PROMPT`. Since we now compose in the block above, we need to either:

- Remove the `systemPrompt` from the constructor (let `switchAgent` set it), OR
- Keep the constructor value and let `switchAgent` overwrite it

Since `switchAgent` overwrites `this.systemPrompt`, keeping the constructor value is harmless (it gets replaced immediately). But for clarity, remove the conditional from the constructor:

Find:

```typescript
const harness = new HarnessClass({
  env,
  model,
  session: sessionShape,
  ...(isIntake ? { systemPrompt: INTAKE_SYSTEM_PROMPT } : {}),
  tools,
  // ...
});
```

Change to:

```typescript
const harness = new HarnessClass({
  env,
  model,
  session: sessionShape,
  tools,
  // ...
});
```

The `switchAgent` call below will set the composed system prompt.

**IMPORTANT:** Make sure `switchAgent` is called for ALL agents, including intake. The current code only calls it inside `if (!isIntake)`. After the change, it should be called unconditionally.

### Step 7: Run the runner test

```bash
cd apps/server && npx vitest run src/agent/__tests__/system-prompt-composition.test.ts
```

Expected: PASS.

### Step 8: Run full server test suite

```bash
cd apps/server && npx vitest run
```

Expected: PASS — all existing tests + new test.

### Step 9: Run agent test suite

```bash
cd packages/agent && npx vitest run
```

Expected: PASS — all existing tests + new tests.

### Step 10: Commit

```bash
git add apps/server/src/agent/runner.ts apps/server/src/agent/__tests__/system-prompt-composition.test.ts
git commit -m "feat(server): wire composeSystemPrompt into runner for all agents"
```

---

## Task 6: Verify mid-session skill changes still work

The harness's `addSkill()` and `removeSkill()` use `stripSkillsBlock` + `appendSkillsBlock`. With the tool inventory now in the system prompt (between base prompt and skills block), verify these operations still work correctly.

**Files:**

- Test: `packages/agent/src/resources/__tests__/system-prompt.test.ts`

### Step 1: Write tests for the strip + re-append cycle

Add to the test file:

```typescript
import { appendSkillsBlock, stripSkillsBlock } from "../system-prompt";

describe("mid-session skill changes with tool inventory present", () => {
  const BASE = "You are a coding agent.";
  const tools = [mockTool("edit", "Edit files."), mockTool("read", "Read files.")];
  const skill1 = mockSkill("tdd", "TDD", "/tdd/SKILL.md");
  const skill2 = mockSkill("debug", "Debug", "/debug/SKILL.md");

  it("stripSkillsBlock preserves tool inventory when removing skills", () => {
    const composed = composeSystemPrompt(BASE, tools, [skill1, skill2], true);
    const stripped = stripSkillsBlock(composed);
    // Tool inventory survives
    expect(stripped).toContain("# Tool: edit");
    expect(stripped).toContain("# Tool: read");
    // Skills block removed
    expect(stripped).not.toContain("<available_skills>");
    // Base prompt preserved
    expect(stripped).toContain(BASE);
  });

  it("appendSkillsBlock re-appends skills after tool inventory", () => {
    const composed = composeSystemPrompt(BASE, tools, [skill1, skill2], true);
    const stripped = stripSkillsBlock(composed);
    const recomposed = appendSkillsBlock(stripped, [skill1], true);
    // Tool inventory still present
    expect(recomposed).toContain("# Tool: edit");
    expect(recomposed).toContain("# Tool: read");
    // Only remaining skill
    expect(recomposed).toContain("tdd");
    expect(recomposed).not.toContain("debug");
    // Skills block is last
    const toolIdx = recomposed.lastIndexOf("# Tool:");
    const skillsIdx = recomposed.indexOf("<available_skills>");
    expect(skillsIdx).toBeGreaterThan(toolIdx);
  });

  it("full add → remove → re-add cycle preserves tools throughout", () => {
    // Start with tools + skill1
    let prompt = composeSystemPrompt(BASE, tools, [skill1], true);
    expect(prompt).toContain("# Tool: edit");
    expect(prompt).toContain("tdd");

    // Remove skill1
    const stripped = stripSkillsBlock(prompt);
    prompt = appendSkillsBlock(stripped, [], true);
    expect(prompt).toContain("# Tool: edit");
    expect(prompt).not.toContain("<available_skills>");

    // Add skill2
    prompt = appendSkillsBlock(prompt, [skill2], true);
    expect(prompt).toContain("# Tool: edit");
    expect(prompt).toContain("debug");
  });
});
```

### Step 2: Run tests

```bash
cd packages/agent && npx vitest run src/resources/__tests__/system-prompt.test.ts
```

If any tests fail, it means `stripSkillsBlock` is not correctly preserving the tool inventory. The likely cause would be if the tool inventory happens to contain text that matches the `SKILLS_INSTRUCTIONS[0]` marker. Verify that the marker `"The following skills provide specialized instructions"` does not appear in any tool description.

### Step 3: Fix if needed

If `stripSkillsBlock` strips too much, the fix is to ensure the tool inventory doesn't contain the skills marker text. This should not happen because tool descriptions are about tools, not skills.

### Step 4: Commit

```bash
git add packages/agent/src/resources/__tests__/system-prompt.test.ts
git commit -m "test(agent): verify mid-session skill changes preserve tool inventory"
```

---

## Task 7: Full integration verification

Run all test suites and verify no regressions.

### Step 1: Run all package tests

```bash
cd packages/agent && npx vitest run
cd packages/tools && npx vitest run
cd packages/db && npx vitest run
cd apps/server && npx vitest run
```

Expected: ALL PASS.

### Step 2: Run typecheck

```bash
pnpm run typecheck
```

Expected: clean.

### Step 3: Run lint

```bash
pnpm run fix
```

Expected: no errors.

### Step 4: Manual verification (optional)

Start the dev server and verify in the logs that the system prompt sent to the LLM contains tool descriptions:

```bash
pnpm run dev:server
```

Then check `~/.sakti/logs/llm.1.log` — the request should show tool descriptions embedded in the system prompt.

### Step 5: Commit any remaining changes

```bash
git add -A
git commit -m "test: full integration verification for unified system prompt"
```

---

## Architecture Notes

### Why not use Handlebars templates like pi?

Pi uses Handlebars templates (`system-prompt.md`) with conditional blocks (`{{#has tools "edit"}}`). This is powerful but adds a template engine dependency and complexity. Sakti's approach is simpler: string composition (`composeSystemPrompt` joins blocks with `\n\n`). This is sufficient because:

1. Tool descriptions are self-contained (HASHLINE_DESCRIPTION includes examples, syntax, etc.)
2. We don't need per-tool policy guidance in the system prompt (the tool description IS the guidance)
3. String composition is easier to test and debug

### Why always render full inventory (not compact list)?

Pi has two modes: compact (just names) and full (descriptions). The compact mode works for large LLMs that read tool schemas. For sakti (targeting smaller LLMs), full inventory is always better — the whole point is to put descriptions where the LLM reads them.

### Cache stability

Tools are sorted alphabetically by name before rendering, ensuring byte-identical output for the same tool set. This is critical for provider caching (Anthropic, DeepSeek cache the system prompt prefix).

### Why not render parameter schemas?

Pi renders `jsonSchemaToTypeScript(toolWireSchema(tool))` for the Parameters section. We skip this because:

1. The tool description already includes parameter usage (e.g., "Body rows go on lines BELOW the op header, each prefixed with +")
2. Parameter schemas are already sent via the AI SDK tool definitions
3. Adding JSON Schema → TypeScript conversion adds complexity for minimal benefit
4. Smaller LLMs benefit more from prose descriptions than from TypeScript signatures

If parameter rendering is needed later, it can be added as an enhancement to `renderToolInventory` without changing the composition flow.
