import { describe, expect, it } from "vite-plus/test";
import type { Skill } from "../../harness-types";
import {
  appendSkillsBlock,
  composeSystemPrompt,
  formatEnvironmentBlock,
  formatSkillsForSystemPrompt,
  stripSkillsBlock,
  stripToolInventory,
} from "../../resources/system-prompt";
import type { AgentTool } from "../../types";

const SKILLS_INSTRUCTIONS = `test-line-1-is-the-marker
test-line-2
test-line-3`;

function mockTool(name: string, description: string): AgentTool {
  return {
    name,
    description,
    label: name,
    parameters: { type: "object", properties: {} },
    execute: async () => ({
      content: [{ type: "text", text: "" }],
      details: undefined,
    }),
  } as unknown as AgentTool;
}

function mockSkill(name: string, description: string, filePath: string): Skill {
  return { name, description, filePath, content: "" } as Skill;
}

const visibleSkill = {
  name: "visible",
  description: "Use <this> & that",
  content: "visible content",
  filePath: "/skills/visible/SKILL.md",
};

const secondSkill = {
  name: "second",
  description: "Second skill",
  content: "second content",
  filePath: "/skills/second/SKILL.md",
};

const disabledSkill = {
  name: "hidden",
  description: "Hidden",
  content: "hidden content",
  filePath: "/skills/hidden/SKILL.md",
  disableModelInvocation: true,
};

describe("formatSkillsForSystemPrompt", () => {
  it("formats visible skills in order and skips model-disabled skills", () => {
    expect(
      formatSkillsForSystemPrompt([visibleSkill, disabledSkill, secondSkill], SKILLS_INSTRUCTIONS),
    ).toBe(
      `test-line-1-is-the-marker
test-line-2
test-line-3

<available_skills>
  <skill>
    <name>visible</name>
    <description>Use &lt;this&gt; &amp; that</description>
    <location>/skills/visible/SKILL.md</location>
  </skill>
  <skill>
    <name>second</name>
    <description>Second skill</description>
    <location>/skills/second/SKILL.md</location>
  </skill>
</available_skills>`,
    );
  });

  it("returns an empty string when no skills are model-visible", () => {
    expect(formatSkillsForSystemPrompt([disabledSkill], SKILLS_INSTRUCTIONS)).toBe("");
  });

  it("escapes XML in all model-visible skill fields", () => {
    expect(
      formatSkillsForSystemPrompt(
        [
          {
            name: "a&b",
            description: `Quote "double" and 'single'`,
            content: "content",
            filePath: '/skills/<bad>&"quote"/SKILL.md',
          },
        ],
        SKILLS_INSTRUCTIONS,
      ),
    ).toContain(
      "<name>a&amp;b</name>\n    <description>Quote &quot;double&quot; and &apos;single&apos;</description>\n    <location>/skills/&lt;bad&gt;&amp;&quot;quote&quot;/SKILL.md</location>",
    );
  });
});

describe("appendSkillsBlock", () => {
  const base = "You are a coding agent.";

  const visibleSkill = {
    name: "graphify",
    description: "build a graph",
    content: "graph it",
    filePath: "/skills/graphify/SKILL.md",
  };

  const disabledSkill = {
    name: "hidden",
    description: "Hidden",
    content: "x",
    filePath: "/skills/hidden/SKILL.md",
    disableModelInvocation: true,
  };

  it("appends the available-skills block when read is available", () => {
    const out = appendSkillsBlock(base, [visibleSkill], true, SKILLS_INSTRUCTIONS);
    expect(out.startsWith(base)).toBe(true);
    expect(out).toContain("<available_skills>");
    expect(out).toContain("<name>graphify</name>");
  });

  it("returns the base unchanged when read is not available", () => {
    expect(appendSkillsBlock(base, [visibleSkill], false, SKILLS_INSTRUCTIONS)).toBe(base);
  });

  it("returns the base unchanged when there are no model-visible skills", () => {
    expect(appendSkillsBlock(base, [disabledSkill], true, SKILLS_INSTRUCTIONS)).toBe(base);
    expect(appendSkillsBlock(base, [], true, SKILLS_INSTRUCTIONS)).toBe(base);
  });
});

describe("composeSystemPrompt", () => {
  const BASE = "You are a coding agent.";

  it("returns base prompt alone when no tools and no skills", () => {
    expect(composeSystemPrompt(BASE, [], [], false, SKILLS_INSTRUCTIONS)).toBe(BASE);
  });

  it("appends tool inventory after base prompt", () => {
    const tools = [mockTool("edit", "Edit files.")];
    const result = composeSystemPrompt(BASE, tools, [], false, SKILLS_INSTRUCTIONS);
    expect(result).toContain(BASE);
    expect(result).toContain("# Tool: edit");
    expect(result).toContain("Edit files.");
  });

  it("appends skills block after tool inventory", () => {
    const tools = [mockTool("edit", "Edit files.")];
    const skills = [mockSkill("tdd", "Test-driven dev", "/skills/tdd/SKILL.md")];
    const result = composeSystemPrompt(BASE, tools, skills, true, SKILLS_INSTRUCTIONS);
    const toolIdx = result.indexOf("# Tool: edit");
    const skillsIdx = result.indexOf("<available_skills>");
    expect(toolIdx).toBeGreaterThan(-1);
    expect(skillsIdx).toBeGreaterThan(toolIdx);
  });

  it("omits skills block when hasRead is false", () => {
    const skills = [mockSkill("tdd", "TDD", "/skills/tdd/SKILL.md")];
    const result = composeSystemPrompt(BASE, [], skills, false, SKILLS_INSTRUCTIONS);
    expect(result).not.toContain("<available_skills>");
  });

  it("includes skills block when hasRead is true", () => {
    const skills = [mockSkill("tdd", "TDD", "/skills/tdd/SKILL.md")];
    const result = composeSystemPrompt(BASE, [], skills, true, SKILLS_INSTRUCTIONS);
    expect(result).toContain("<available_skills>");
    expect(result).toContain("tdd");
  });

  it("separates blocks with double newlines", () => {
    const tools = [mockTool("read", "Read files.")];
    const skills = [mockSkill("tdd", "TDD", "/skills/tdd/SKILL.md")];
    const result = composeSystemPrompt(BASE, tools, skills, true, SKILLS_INSTRUCTIONS);
    expect(result).toMatch(/You are a coding agent\.\n\n# Tool: read/);
    expect(result).toMatch(/\n\n.*<available_skills>/s);
  });

  it("handles multiple tools and skills together", () => {
    const tools = [mockTool("edit", "Edit."), mockTool("read", "Read."), mockTool("bash", "Run.")];
    const skills = [
      mockSkill("tdd", "TDD", "/tdd/SKILL.md"),
      mockSkill("debug", "Debug", "/debug/SKILL.md"),
    ];
    const result = composeSystemPrompt(BASE, tools, skills, true, SKILLS_INSTRUCTIONS);
    const bashIdx = result.indexOf("# Tool: bash");
    const editIdx = result.indexOf("# Tool: edit");
    const readIdx = result.indexOf("# Tool: read");
    expect(bashIdx).toBeLessThan(editIdx);
    expect(editIdx).toBeLessThan(readIdx);
    expect(result).toContain("tdd");
    expect(result).toContain("debug");
  });

  it("produces cache-stable output (same input → same output)", () => {
    const tools = [mockTool("edit", "Edit."), mockTool("read", "Read.")];
    const skills = [mockSkill("tdd", "TDD", "/tdd/SKILL.md")];
    const a = composeSystemPrompt(BASE, tools, skills, true, SKILLS_INSTRUCTIONS);
    const b = composeSystemPrompt(BASE, tools, skills, true, SKILLS_INSTRUCTIONS);
    expect(a).toBe(b);
  });

  it("appends environment block when provided", () => {
    const envBlock = [
      "Here is some useful information about the environment you are running in:",
      "<env>",
      "  Working directory: /home/user/project",
      "</env>",
    ].join("\n");
    const result = composeSystemPrompt(BASE, [], [], false, SKILLS_INSTRUCTIONS, envBlock);
    expect(result).toContain(BASE);
    expect(result).toContain("<env>");
    expect(result.endsWith("</env>")).toBe(true);
  });

  it("places environment block after tools and skills", () => {
    const tools = [mockTool("read", "Read.")];
    const skills = [mockSkill("tdd", "TDD", "/tdd/SKILL.md")];
    const envBlock = "<env>\n  Working directory: /x\n</env>";
    const result = composeSystemPrompt(BASE, tools, skills, true, SKILLS_INSTRUCTIONS, envBlock);
    const envIdx = result.indexOf("<env>");
    const skillsIdx = result.indexOf("<available_skills>");
    const toolIdx = result.indexOf("# Tool:");
    expect(toolIdx).toBeLessThan(skillsIdx);
    expect(skillsIdx).toBeLessThan(envIdx);
  });

  it("omits environment block when undefined", () => {
    const result = composeSystemPrompt(BASE, [], [], false, SKILLS_INSTRUCTIONS);
    expect(result).toBe(BASE);
  });

  it("does not break stripToolInventory when environment block is present", () => {
    const tools = [mockTool("edit", "Edit.")];
    const envBlock = "<env>\n  Working directory: /x\n</env>";
    const composed = composeSystemPrompt(BASE, tools, [], false, SKILLS_INSTRUCTIONS, envBlock);
    const stripped = stripToolInventory(composed);
    expect(stripped).toBe(BASE);
  });
});

describe("mid-session skill changes with tool inventory present", () => {
  const BASE = "You are a coding agent.";
  const tools = [mockTool("edit", "Edit files."), mockTool("read", "Read files.")];
  const skill1 = mockSkill("tdd", "TDD", "/tdd/SKILL.md");
  const skill2 = mockSkill("debug", "Debug", "/debug/SKILL.md");

  it("stripSkillsBlock preserves tool inventory when removing skills", () => {
    const composed = composeSystemPrompt(BASE, tools, [skill1, skill2], true, SKILLS_INSTRUCTIONS);
    const stripped = stripSkillsBlock(composed, SKILLS_INSTRUCTIONS);
    expect(stripped).toContain("# Tool: edit");
    expect(stripped).toContain("# Tool: read");
    expect(stripped).not.toContain("<available_skills>");
    expect(stripped).toContain(BASE);
  });

  it("appendSkillsBlock re-appends skills after tool inventory", () => {
    const composed = composeSystemPrompt(BASE, tools, [skill1, skill2], true, SKILLS_INSTRUCTIONS);
    const stripped = stripSkillsBlock(composed, SKILLS_INSTRUCTIONS);
    const recomposed = appendSkillsBlock(stripped, [skill1], true, SKILLS_INSTRUCTIONS);
    expect(recomposed).toContain("# Tool: edit");
    expect(recomposed).toContain("# Tool: read");
    expect(recomposed).toContain("tdd");
    expect(recomposed).not.toContain("debug");
    const toolIdx = recomposed.lastIndexOf("# Tool:");
    const skillsIdx = recomposed.indexOf("<available_skills>");
    expect(skillsIdx).toBeGreaterThan(toolIdx);
  });

  it("full add → remove → re-add cycle preserves tools throughout", () => {
    let prompt = composeSystemPrompt(BASE, tools, [skill1], true, SKILLS_INSTRUCTIONS);
    expect(prompt).toContain("# Tool: edit");
    expect(prompt).toContain("tdd");

    const stripped = stripSkillsBlock(prompt, SKILLS_INSTRUCTIONS);
    prompt = appendSkillsBlock(stripped, [], true, SKILLS_INSTRUCTIONS);
    expect(prompt).toContain("# Tool: edit");
    expect(prompt).not.toContain("<available_skills>");

    prompt = appendSkillsBlock(prompt, [skill2], true, SKILLS_INSTRUCTIONS);
    expect(prompt).toContain("# Tool: edit");
    expect(prompt).toContain("debug");
  });
});

describe("stripToolInventory", () => {
  const BASE = "You are a coding agent.";

  it("returns prompt unchanged when no tool inventory is present", () => {
    expect(stripToolInventory(BASE)).toBe(BASE);
  });

  it("strips tool inventory from a composed prompt (tools only, no skills)", () => {
    const tools = [mockTool("edit", "Edit."), mockTool("read", "Read.")];
    const composed = composeSystemPrompt(BASE, tools, [], false, SKILLS_INSTRUCTIONS);
    const stripped = stripToolInventory(composed);
    expect(stripped).toBe(BASE);
  });

  it("strips tool inventory and trailing skills, returning base only", () => {
    const tools = [mockTool("edit", "Edit.")];
    const skills = [mockSkill("tdd", "TDD", "/tdd/SKILL.md")];
    const composed = composeSystemPrompt(BASE, tools, skills, true, SKILLS_INSTRUCTIONS);
    // stripToolInventory cuts at the first # Tool: heading, which removes
    // the tool section AND the trailing skills block (both come after it).
    const stripped = stripToolInventory(composed);
    expect(stripped).toBe(BASE);
    expect(stripped).not.toContain("# Tool: edit");
    expect(stripped).not.toContain("<available_skills>");
  });

  it("recovers the base when stripping both tools and skills (chain)", () => {
    const tools = [mockTool("edit", "Edit."), mockTool("read", "Read.")];
    const skills = [mockSkill("tdd", "TDD", "/tdd/SKILL.md")];
    const composed = composeSystemPrompt(BASE, tools, skills, true, SKILLS_INSTRUCTIONS);
    // Chain: strip skills first (removes suffix), then strip tools (removes tool section)
    const recovered = stripToolInventory(stripSkillsBlock(composed, SKILLS_INSTRUCTIONS));
    expect(recovered).toBe(BASE);
  });

  it("handles empty string", () => {
    expect(stripToolInventory("")).toBe("");
  });

  it("does not false-positive on base prompts with non-Tool headers", () => {
    const baseWithHeader = "You are a coding agent.\n\n## Important\nDo good work.";
    const tools = [mockTool("edit", "Edit.")];
    const composed = composeSystemPrompt(baseWithHeader, tools, [], false, SKILLS_INSTRUCTIONS);
    const stripped = stripToolInventory(composed);
    expect(stripped).toBe(baseWithHeader);
  });

  it("round-trips: strip then recompose produces same output", () => {
    const tools = [mockTool("bash", "Run."), mockTool("edit", "Edit."), mockTool("read", "Read.")];
    const skills = [mockSkill("tdd", "TDD", "/tdd/SKILL.md")];
    const composed = composeSystemPrompt(BASE, tools, skills, true, SKILLS_INSTRUCTIONS);
    const recovered = stripToolInventory(stripSkillsBlock(composed, SKILLS_INSTRUCTIONS));
    const recomposed = composeSystemPrompt(recovered, tools, skills, true, SKILLS_INSTRUCTIONS);
    expect(recomposed).toBe(composed);
  });
});

describe("formatEnvironmentBlock", () => {
  it("formats a complete env block with all fields", () => {
    const block = formatEnvironmentBlock({
      workingDirectory: "/home/user/project",
      isGitRepo: true,
      platform: "linux",
      date: "Sun Jul 05 2026",
      modelId: "anthropic/claude-sonnet-4-5",
    });
    expect(block).toBe(
      [
        "Here is some useful information about the environment you are running in:",
        "<env>",
        "  Working directory: /home/user/project",
        "  You are already here — do not prepend `cd /home/user/project` to bash commands. Use `cd` only to enter a subdirectory.",
        "  Is directory a git repo: yes",
        "  Platform: linux",
        "  Today's date: Sun Jul 05 2026",
        "  Model: anthropic/claude-sonnet-4-5",
        "</env>",
      ].join("\n"),
    );
  });

  it("omits modelId line when modelId is undefined", () => {
    const block = formatEnvironmentBlock({
      workingDirectory: "/tmp",
      isGitRepo: false,
      platform: "darwin",
      date: "Mon Jan 01 2024",
    });
    expect(block).not.toContain("Model:");
    expect(block).toContain("Platform: darwin");
    expect(block).toContain("Is directory a git repo: no");
  });

  it("wraps values in <env> tags with two-space indentation", () => {
    const block = formatEnvironmentBlock({
      workingDirectory: "/x",
      isGitRepo: true,
      platform: "win32",
      date: "D",
    });
    expect(block.startsWith("Here is some useful")).toBe(true);
    expect(block.endsWith("</env>")).toBe(true);
    const lines = block.split("\n");
    expect(lines[1]).toBe("<env>");
    for (const line of lines.slice(2, -1)) {
      expect(line.startsWith("  ")).toBe(true);
    }
  });
});
