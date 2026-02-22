# Skills System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a complete skills system for @sakti-code/core that allows dynamic loading of domain-specific instructions, compatible with Claude Code's SKILL.md format.

**Architecture:** Skills are discovered from multiple locations (`.claude/skills/`, `.agents/skills/`, `.opencode/skills/`, custom paths, remote URLs). Skills are registered as a tool and integrate with the permission system.

**Tech Stack:** TypeScript, Vitest, Zod, gray-matter (for YAML frontmatter parsing), glob, Node.js fs/path APIs

---

## Task 1: Skill Types and Schema Definitions

**Files:**

- Create: `packages/core/src/skill/types.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/tests/skill/types.test.ts
import { describe, expect, it } from "vitest";
import { SkillInfo, parseSkillInfo } from "../../src/skill/types";

describe("skill types", () => {
  describe("SkillInfo schema", () => {
    it("should parse valid skill info with required fields", () => {
      const input = {
        name: "test-skill",
        description: "Use this skill for testing",
        location: "/path/to/SKILL.md",
        content: "# Test Skill\n\nSkill content here",
      };
      const result = SkillInfo.parse(input);
      expect(result.name).toBe("test-skill");
      expect(result.description).toBe("Use this skill for testing");
    });

    it("should reject missing required fields", () => {
      expect(() => SkillInfo.parse({})).toThrow();
      expect(() => SkillInfo.parse({ name: "test" })).toThrow();
      expect(() => SkillInfo.parse({ description: "test" })).toThrow();
    });
  });

  describe("parseSkillInfo", () => {
    it("should parse valid SKILL.md with frontmatter", () => {
      const md = `---
name: test-skill
description: Test skill description
---
# Test Skill

This is the skill content.`;

      const result = parseSkillInfo(md, "/path/to/SKILL.md");
      expect(result.name).toBe("test-skill");
      expect(result.description).toBe("Test skill description");
      expect(result.location).toBe("/path/to/SKILL.md");
      expect(result.content).toContain("# Test Skill");
    });

    it("should handle YAML parsing errors gracefully", () => {
      const md = `---
name: test
description: Test with: colons in: values
---
Content`;

      const result = parseSkillInfo(md, "/path/to/SKILL.md");
      expect(result.name).toBe("test");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && npm test tests/skill/types.test.ts`
Expected: FAIL - Module not found

**Step 3: Write minimal implementation**

```typescript
// packages/core/src/skill/types.ts
import { z } from "zod";

export const SkillInfo = z.object({
  name: z.string(),
  description: z.string(),
  location: z.string(),
  content: z.string(),
});

export type SkillInfo = z.infer<typeof SkillInfo>;

export function parseSkillInfo(markdown: string, location: string): SkillInfo {
  // Simple frontmatter parser for initial implementation
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = markdown.match(frontmatterRegex);

  if (!match) {
    throw new Error("Invalid SKILL.md format: missing frontmatter");
  }

  const [, frontmatter, content] = match;
  const lines = frontmatter.split("\n");
  let name = "";
  let description = "";

  for (const line of lines) {
    const [key, ...valueParts] = line.split(":");
    if (key && valueParts.length > 0) {
      const value = valueParts.join(":").trim();
      if (key.trim() === "name") name = value;
      if (key.trim() === "description") description = value;
    }
  }

  if (!name || !description) {
    throw new Error("Missing required frontmatter fields: name and description");
  }

  return {
    name,
    description,
    location,
    content: markdown,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && npm test tests/skill/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd packages/core
git add src/skill/types.ts tests/skill/types.test.ts
git commit -m "feat(skill): add skill types and schema"
```

---

## Task 2: Skill Discovery - Local File System

**Files:**

- Create: `packages/core/src/skill/discovery.ts`
- Create: `packages/core/tests/skill/discovery.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/tests/skill/discovery.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { discoverLocalSkills, SkillDiscovery } from "../../src/skill/discovery";
import * as fs from "fs/promises";
import * as path from "path";

vi.mock("fs/promises");
vi.mock("path");

describe("skill discovery", () => {
  describe("discoverLocalSkills", () => {
    it("should discover skills from .claude/skills/", async () => {
      vi.mocked(fs.readdir).mockResolvedValue(["test-skill"] as any);
      vi.mocked(fs.readFile).mockResolvedValue(
        `---
name: test-skill
description: Test skill
---
# Content` as any
      );
      vi.mocked(path.join).mockImplementation((...args) => args.join("/"));

      const skills = await discoverLocalSkills("/home/user/project", [".claude/skills"]);
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("test-skill");
    });

    it("should return empty array when directory does not exist", async () => {
      vi.mocked(fs.readdir).mockRejectedValue(new Error("ENOENT"));

      const skills = await discoverLocalSkills("/home/user/project", [".claude/skills"]);
      expect(skills).toHaveLength(0);
    });

    it("should handle multiple discovery paths", async () => {
      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(["skill1"] as any)
        .mockResolvedValueOnce(["skill2"] as any);
      vi.mocked(fs.readFile).mockResolvedValue(
        `---
name: skill
description: Skill
---
# Content` as any
      );

      const skills = await discoverLocalSkills("/project", [".claude/skills", ".agents/skills"]);
      expect(skills).toHaveLength(2);
    });
  });

  describe("SkillDiscovery class", () => {
    it("should discover skills from default locations", async () => {
      const discovery = new SkillDiscovery("/test/project");
      const skills = await discovery.discover();
      expect(Array.isArray(skills)).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && npm test tests/skill/discovery.test.ts`
Expected: FAIL - Module not found

**Step 3: Write minimal implementation**

```typescript
// packages/core/src/skill/discovery.ts
import * as fs from "fs/promises";
import * as path from "path";
import { glob } from "glob";
import { SkillInfo, parseSkillInfo } from "./types";

const DEFAULT_DISCOVERY_PATHS = [
  ".claude/skills",
  ".agents/skills",
  ".opencode/skills",
  ".opencode/skill",
];

export async function discoverLocalSkills(
  baseDir: string,
  relativePaths: string[]
): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  for (const relativePath of relativePaths) {
    const fullPath = path.join(baseDir, relativePath);

    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(fullPath, entry.name, "SKILL.md");
          try {
            const content = await fs.readFile(skillPath, "utf-8");
            const skillInfo = parseSkillInfo(content, skillPath);
            skills.push(skillInfo);
          } catch {
            // SKILL.md doesn't exist in this directory, skip
          }
        }
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  return skills;
}

export class SkillDiscovery {
  private baseDir: string;
  private customPaths: string[];

  constructor(baseDir: string, customPaths: string[] = []) {
    this.baseDir = baseDir;
    this.customPaths = customPaths;
  }

  async discover(): Promise<SkillInfo[]> {
    const allPaths = [...DEFAULT_DISCOVERY_PATHS, ...this.customPaths];
    return discoverLocalSkills(this.baseDir, allPaths);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && npm test tests/skill/discovery.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd packages/core
git add src/skill/discovery.ts tests/skill/discovery.test.ts
git commit -m "feat(skill): add local skill discovery"
```

---

## Task 3: Skill Storage and State Management

**Files:**

- Create: `packages/core/src/skill/skill.ts`
- Create: `packages/core/tests/skill/skill.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/tests/skill/skill.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { SkillManager } from "../../src/skill/skill";
import type { SkillInfo } from "../../src/skill/types";

describe("SkillManager", () => {
  const mockSkills: SkillInfo[] = [
    {
      name: "test-skill",
      description: "Test skill description",
      location: "/path/to/test-skill/SKILL.md",
      content: "# Test Skill\n\nContent",
    },
  ];

  describe("getSkill", () => {
    it("should return skill by name", () => {
      const manager = new SkillManager(mockSkills);
      const skill = manager.getSkill("test-skill");
      expect(skill).toBeDefined();
      expect(skill?.name).toBe("test-skill");
    });

    it("should return undefined for non-existent skill", () => {
      const manager = new SkillManager(mockSkills);
      const skill = manager.getSkill("non-existent");
      expect(skill).toBeUndefined();
    });
  });

  describe("listSkills", () => {
    it("should return all skills", () => {
      const manager = new SkillManager(mockSkills);
      const skills = manager.listSkills();
      expect(skills).toHaveLength(1);
    });

    it("should filter by name pattern", () => {
      const manager = new SkillManager([
        ...mockSkills,
        { name: "another-skill", description: "Desc", location: "/path", content: "Content" },
      ]);
      const filtered = manager.listSkills({ namePattern: "test*" });
      expect(filtered).toHaveLength(1);
    });
  });

  describe("addSkill", () => {
    it("should add new skill", () => {
      const manager = new SkillManager([]);
      const newSkill: SkillInfo = {
        name: "new-skill",
        description: "New skill",
        location: "/path",
        content: "Content",
      };
      manager.addSkill(newSkill);
      expect(manager.getSkill("new-skill")).toBeDefined();
    });

    it("should deduplicate by name", () => {
      const manager = new SkillManager([mockSkills[0]]);
      const newSkill: SkillInfo = {
        name: "test-skill",
        description: "Different description",
        location: "/different/path",
        content: "Different content",
      };
      manager.addSkill(newSkill);
      const skills = manager.listSkills();
      expect(skills).toHaveLength(1);
      expect(manager.getSkill("test-skill")?.location).toBe("/path");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && npm test tests/skill/skill.test.ts`
Expected: FAIL - Module not found

**Step 3: Write minimal implementation**

```typescript
// packages/core/src/skill/skill.ts
import { SkillInfo } from "./types";

export interface ListSkillsOptions {
  namePattern?: string;
}

export class SkillManager {
  private skills: Map<string, SkillInfo>;

  constructor(skills: SkillInfo[] = []) {
    this.skills = new Map();
    for (const skill of skills) {
      this.skills.set(skill.name, skill);
    }
  }

  getSkill(name: string): SkillInfo | undefined {
    return this.skills.get(name);
  }

  listSkills(options: ListSkillsOptions = {}): SkillInfo[] {
    let result = Array.from(this.skills.values());

    if (options.namePattern) {
      const regex = new RegExp(options.namePattern.replace(/\*/g, ".*").replace(/\?/g, "."));
      result = result.filter(s => regex.test(s.name));
    }

    return result;
  }

  addSkill(skill: SkillInfo): void {
    if (!this.skills.has(skill.name)) {
      this.skills.set(skill.name, skill);
    }
  }

  removeSkill(name: string): boolean {
    return this.skills.delete(name);
  }

  get count(): number {
    return this.skills.size;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && npm test tests/skill/skill.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd packages/core
git add src/skill/skill.ts tests/skill/skill.test.ts
git commit -m "feat(skill): add skill manager"
```

---

## Task 4: Frontmatter Parsing with Fallback

**Files:**

- Modify: `packages/core/src/skill/types.ts`
- Create: `packages/core/tests/skill/frontmatter.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/tests/skill/frontmatter.test.ts
import { describe, expect, it } from "vitest";
import { parseSkillInfo } from "../../src/skill/types";

describe("frontmatter parsing", () => {
  it("should parse standard YAML frontmatter", () => {
    const md = `---
name: standard-skill
description: A standard skill
---
# Content`;

    const result = parseSkillInfo(md, "/path");
    expect(result.name).toBe("standard-skill");
    expect(result.description).toBe("A standard skill");
  });

  it("should handle Claude Code style invalid YAML", () => {
    const md = `---
name: test
description: Uses: multiple: colons
---
# Content`;

    const result = parseSkillInfo(md, "/path");
    expect(result.name).toBe("test");
  });

  it("should handle empty lines in frontmatter", () => {
    const md = `---
name: test

description: With blank line
---
# Content`;

    const result = parseSkillInfo(md, "/path");
    expect(result.name).toBe("test");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && npm test tests/skill/frontmatter.test.ts`
Expected: FAIL - tests fail due to current parser not handling edge cases

**Step 3: Write improved implementation**

```typescript
// Enhanced parseSkillInfo in packages/core/src/skill/types.ts

function parseFrontmatterLine(line: string): { key: string; value: string } | null {
  const match = line.match(/^(\w+):\s*(.*)$/);
  if (!match) return null;
  return { key: match[1], value: match[2] };
}

function extractFrontmatter(frontmatter: string): Record<string, string> {
  const result: Record<string, string> = {};
  let currentKey = "";
  let currentValue = "";
  const lines = frontmatter.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const parsed = parseFrontmatterLine(trimmed);
    if (parsed) {
      if (currentKey) {
        result[currentKey] = currentValue.trim();
      }
      currentKey = parsed.key;
      currentValue = parsed.value;
    } else if (currentKey) {
      currentValue += "\n" + trimmed;
    }
  }

  if (currentKey) {
    result[currentKey] = currentValue.trim();
  }

  return result;
}

export function parseSkillInfo(markdown: string, location: string): SkillInfo {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = markdown.match(frontmatterRegex);

  if (!match) {
    throw new Error("Invalid SKILL.md format: missing frontmatter");
  }

  const [, frontmatter, _content] = match;
  const fields = extractFrontmatter(frontmatter);

  const name = fields.name;
  const description = fields.description;

  if (!name || !description) {
    throw new Error("Missing required frontmatter fields: name and description");
  }

  return {
    name,
    description,
    location,
    content: markdown,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && npm test tests/skill/frontmatter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd packages/core
git add src/skill/types.ts tests/skill/frontmatter.test.ts
git commit -m "feat(skill): improve frontmatter parsing with fallback"
```

---

## Task 5: Remote Skill Discovery (HTTP)

**Files:**

- Create: `packages/core/src/skill/remote.ts`
- Create: `packages/core/tests/skill/remote.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/tests/skill/remote.test.ts
import { describe, expect, it, vi } from "vitest";
import { fetchRemoteSkills, RemoteSkillIndex } from "../../src/skill/remote";
import { z } from "zod";

const RemoteIndexSchema = z.object({
  skills: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      files: z.array(z.string()).optional(),
    })
  ),
});

describe("remote skill discovery", () => {
  describe("fetchRemoteSkills", () => {
    it("should fetch and parse remote index.json", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          skills: [{ name: "remote-skill", description: "Remote skill", files: ["SKILL.md"] }],
        }),
      });
      global.fetch = mockFetch;

      const skills = await fetchRemoteSkills("https://example.com/skills/");
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("remote-skill");
    });

    it("should return empty array on network error", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
      global.fetch = mockFetch;

      const skills = await fetchRemoteSkills("https://example.com/skills/");
      expect(skills).toHaveLength(0);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && npm test tests/skill/remote.test.ts`
Expected: FAIL - Module not found

**Step 3: Write minimal implementation**

```typescript
// packages/core/src/skill/remote.ts
import { z } from "zod";
import { SkillInfo } from "./types";

export const RemoteSkillIndex = z.object({
  skills: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      files: z.array(z.string()).optional(),
    })
  ),
});

export type RemoteSkillIndex = z.infer<typeof RemoteSkillIndex>;

export async function fetchRemoteSkills(baseUrl: string): Promise<SkillInfo[]> {
  try {
    const url = new URL("index.json", baseUrl).href;
    const response = await fetch(url);

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const parsed = RemoteSkillIndex.parse(data);

    return parsed.skills.map(skill => ({
      name: skill.name,
      description: skill.description,
      location: new URL(skill.files?.[0] || "SKILL.md", baseUrl).href,
      content: "", // Content loaded on-demand
    }));
  } catch {
    return [];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && npm test tests/skill/remote.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd packages/core
git add src/skill/remote.ts tests/skill/remote.test.ts
git commit -m "feat(skill): add remote skill discovery"
```

---

## Task 6: Skill Tool Implementation

**Files:**

- Create: `packages/core/src/skill/tool.ts`
- Modify: `packages/core/src/tools/registry.ts`
- Create: `packages/core/tests/skill/tool.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/tests/skill/tool.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { skillTool, skillToolSchema } from "../../src/skill/tool";
import type { SkillInfo } from "../../src/skill/types";

describe("skill tool", () => {
  describe("schema", () => {
    it("should have correct input schema", () => {
      const parsed = skillToolSchema.parse({ name: "test-skill" });
      expect(parsed.name).toBe("test-skill");
    });

    it("should require name parameter", () => {
      expect(() => skillToolSchema.parse({})).toThrow();
    });
  });

  describe("execution", () => {
    it("should load skill content when invoked", async () => {
      const mockSkill: SkillInfo = {
        name: "test-skill",
        description: "Test",
        location: "/path/to/SKILL.md",
        content: "# Test Skill\n\nContent here",
      };

      const result = await skillTool.execute({ name: "test-skill" }, {
        getSkill: () => mockSkill,
      } as any);

      expect(result.content).toContain("Test Skill");
      expect(result.skillFiles).toHaveLength(0); // No additional files
    });

    it("should return error for non-existent skill", async () => {
      const result = await skillTool.execute({ name: "non-existent" }, {
        getSkill: () => undefined,
      } as any);

      expect(result.error).toBe("Skill not found");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && npm test tests/skill/tool.test.ts`
Expected: FAIL - Module not found

**Step 3: Write minimal implementation**

```typescript
// packages/core/src/skill/tool.ts
import { z } from "zod";
import { ToolDefinition } from "../tools/base/types";
import * as fs from "fs/promises";
import * as path from "path";
import { glob } from "glob";

export const skillToolSchema = z.object({
  name: z.string().describe("The name of the skill from available_skills"),
});

export type SkillToolInput = z.infer<typeof skillToolSchema>;

export interface SkillToolOutput {
  content: string;
  skillFiles: string[];
  error?: string;
}

export const skillTool: ToolDefinition<SkillToolInput, SkillToolOutput> = {
  name: "skill",
  description: "Load and execute a skill with specific domain knowledge",
  inputSchema: skillToolSchema,
  outputSchema: z.object({
    content: z.string(),
    skillFiles: z.array(z.string()),
    error: z.string().optional(),
  }),

  async execute(input, context) {
    const getSkill = (context as any).getSkill;
    if (!getSkill) {
      return { content: "", skillFiles: [], error: "Skill system not initialized" };
    }

    const skill = getSkill(input.name);
    if (!skill) {
      return { content: "", skillFiles: [], error: `Skill '${input.name}' not found` };
    }

    const skillDir = path.dirname(skill.location);
    let skillFiles: string[] = [];

    try {
      const files = await glob("**/*", { cwd: skillDir, nodir: true });
      skillFiles = files.slice(0, 10).map(f => path.join(skillDir, f));
    } catch {
      // Ignore glob errors
    }

    const formattedContent = `<skill_content name="${skill.name}">
# Skill: ${skill.name}

${skill.content}

Base directory for this skill: file://${skillDir}
Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.
Note: file list is sampled.

<skill_files>
${skillFiles.map(f => `<file>${f}</file>`).join("\n")}
</skill_files>
</skill_content>`;

    return { content: formattedContent, skillFiles };
  },
};
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && npm test tests/skill/tool.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd packages/core
git add src/skill/tool.ts tests/skill/tool.test.ts
git commit -m "feat(skill): add skill tool implementation"
```

---

## Task 7: Integrate Skill Tool into Registry

**Files:**

- Modify: `packages/core/src/tools/registry.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/tests/skill/registry-integration.test.ts
import { describe, expect, it } from "vitest";
import { toolRegistry, ToolName } from "../../src/tools/registry";

describe("skill tool in registry", () => {
  it("should include skill tool in registry", () => {
    const names = toolRegistry.getToolNames();
    expect(names).toContain("skill");
  });

  it("should have skill tool with correct structure", () => {
    const skill = (toolRegistry as any).skill;
    expect(skill).toBeDefined();
    expect(skill.name).toBe("skill");
    expect(skill.inputSchema).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && npm test tests/skill/registry-integration.test.ts`
Expected: FAIL - "skill" not in registry

**Step 3: Write minimal implementation**

Add to `packages/core/src/tools/registry.ts`:

```typescript
// Import at top
import { skillTool } from "../skill/tool";

// Add to toolRegistry
skill: skillTool,

// Add to ToolName type
| "skill";
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && npm test tests/skill/registry-integration.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd packages/core
git add src/tools/registry.ts
git commit -m "feat(skill): integrate skill tool into registry"
```

---

## Task 8: Permission System Integration

**Files:**

- Create: `packages/core/tests/skill/permission.test.ts`
- No production code needed - reuse existing permission system

**Step 1: Write the failing test**

```typescript
// packages/core/tests/skill/permission.test.ts
import { describe, expect, it } from "vitest";
import { evaluatePatterns } from "../../src/security/permission-rules";

describe("skill permissions", () => {
  it("should filter skills based on permission rules", () => {
    const rules = [
      { permission: "skill", pattern: "frontend-*", action: "allow" as const },
      { permission: "skill", pattern: "*", action: "deny" as const },
    ];

    const result = evaluatePatterns("skill", ["frontend-design"], rules);
    expect(result.action).toBe("allow");

    const result2 = evaluatePatterns("skill", ["backend-task"], rules);
    expect(result2.action).toBe("deny");
  });

  it("should handle ask action for skills", () => {
    const rules = [{ permission: "skill", pattern: "*", action: "ask" as const }];

    const result = evaluatePatterns("skill", ["any-skill"], rules);
    expect(result.action).toBe("ask");
  });
});
```

**Step 2: Run test to verify it passes (existing functionality)**

Run: `cd packages/core && npm test tests/skill/permission.test.ts`
Expected: PASS (permission system already exists)

**Step 3: Commit**

```bash
cd packages/core
git add tests/skill/permission.test.ts
git commit -m "test(skill): add permission integration tests"
```

---

## Task 9: Skill Index Export and API Endpoint Support

**Files:**

- Create: `packages/core/src/skill/index.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/tests/skill/api.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/tests/skill/api.test.ts
import { describe, expect, it } from "vitest";
import { skillInfoToApiResponse } from "../../src/skill/index";

describe("skill API", () => {
  describe("skillInfoToApiResponse", () => {
    it("should convert SkillInfo to API response format", () => {
      const skill = {
        name: "test-skill",
        description: "Test description",
        location: "/path/to/SKILL.md",
        content: "# Content",
      };

      const result = skillInfoToApiResponse(skill);
      expect(result.name).toBe("test-skill");
      expect(result.description).toBe("Test description");
      expect(result.location).toBe("/path/to/SKILL.md");
      expect(result.content).toBe("# Content");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && npm test tests/skill/api.test.ts`
Expected: FAIL - Module not found

**Step 3: Write minimal implementation**

```typescript
// packages/core/src/skill/index.ts
export { SkillInfo, parseSkillInfo } from "./types";
export { SkillManager } from "./skill";
export { SkillDiscovery, discoverLocalSkills } from "./discovery";
export { fetchRemoteSkills } from "./remote";
export { skillTool, skillToolSchema } from "./tool";
import type { SkillInfo } from "./types";

export interface SkillApiResponse {
  name: string;
  description: string;
  location: string;
  content: string;
}

export function skillInfoToApiResponse(skill: SkillInfo): SkillApiResponse {
  return {
    name: skill.name,
    description: skill.description,
    location: skill.location,
    content: skill.content,
  };
}
```

Update `packages/core/src/index.ts` to export skill system:

```typescript
// Add to exports
export {
  SkillInfo,
  SkillManager,
  SkillDiscovery,
  skillTool,
  skillToolSchema,
  skillInfoToApiResponse,
  type SkillApiResponse,
} from "./skill";
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && npm test tests/skill/api.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd packages/core
git add src/skill/index.ts src/index.ts tests/skill/api.test.ts
git commit -m "feat(skill): add skill exports and API support"
```

---

## Task 10: Integration Test - Full Skills Flow

**Files:**

- Create: `packages/core/tests/skill/integration.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/tests/skill/integration.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { SkillManager } from "../../src/skill/skill";
import { SkillDiscovery } from "../../src/skill/discovery";
import { skillTool } from "../../src/skill/tool";
import type { SkillInfo } from "../../src/skill/types";

describe("skills integration", () => {
  describe("full workflow", () => {
    it("should discover, store, and load skills", async () => {
      const mockSkills: SkillInfo[] = [
        {
          name: "integration-skill",
          description: "Integration test skill",
          location: "/test/integration-skill/SKILL.md",
          content: "# Integration Skill\n\nTest content",
        },
      ];

      const manager = new SkillManager();

      // Simulate discovery
      for (const skill of mockSkills) {
        manager.addSkill(skill);
      }

      // Verify storage
      expect(manager.count).toBe(1);
      expect(manager.getSkill("integration-skill")).toBeDefined();

      // Verify tool execution
      const context = {
        getSkill: (name: string) => manager.getSkill(name),
      };

      const result = await skillTool.execute({ name: "integration-skill" }, context as any);

      expect(result.error).toBeUndefined();
      expect(result.content).toContain("Integration Skill");
    });

    it("should handle skill not found gracefully", async () => {
      const manager = new SkillManager();
      const context = {
        getSkill: (name: string) => manager.getSkill(name),
      };

      const result = await skillTool.execute({ name: "nonexistent" }, context as any);

      expect(result.error).toBe("Skill 'nonexistent' not found");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && npm test tests/skill/integration.test.ts`
Expected: FAIL - Module not found

**Step 3: Run test to verify it passes (already implemented)**

Run: `cd packages/core && npm test tests/skill/integration.test.ts`
Expected: PASS (components already implemented)

**Step 4: Commit**

```bash
cd packages/core
git add tests/skill/integration.test.ts
git commit -m "test(skill): add integration tests"
```

---

## Task 11: TypeCheck and Lint

**Step 1: Run typecheck**

Run: `cd packages/core && npm run typecheck`
Expected: No errors

**Step 2: Run lint**

Run: `cd packages/core && npm run lint`
Expected: No errors

**Step 3: Run all tests**

Run: `cd packages/core && npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
cd packages/core
git add .
git commit -m "fix: typecheck and lint fixes"
```

---

## Summary

The implementation plan covers:

1. **Task 1-2**: Core types and local discovery
2. **Task 3**: Skill storage/manager
3. **Task 4**: Improved frontmatter parsing with fallback
4. **Task 5**: Remote skill discovery via HTTP
5. **Task 6**: Skill tool implementation
6. **Task 7**: Registry integration
7. **Task 8**: Permission system (reuse existing)
8. **Task 9**: API exports
9. **Task 10**: Integration tests
10. **Task 11**: TypeCheck/Lint verification

Each task follows TDD with failing tests first, minimal implementation, then verification.
