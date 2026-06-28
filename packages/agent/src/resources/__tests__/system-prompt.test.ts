import { describe, expect, it } from "vitest";
import type { Skill } from "../../harness-types";
import {
  appendSkillsBlock,
  composeSystemPrompt,
  formatSkillsForSystemPrompt,
  stripSkillsBlock,
} from "../../resources/system-prompt";
import type { AgentTool } from "../../types";

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
      formatSkillsForSystemPrompt([visibleSkill, disabledSkill, secondSkill])
    ).toBe(
      `The following skills provide specialized instructions for specific tasks.
Read the full skill file when the task matches its description, unless a <skill> block for that skill is already present in the conversation (an explicitly triggered skill is already loaded in full — do not read it again).
When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.

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
</available_skills>`
    );
  });

  it("returns an empty string when no skills are model-visible", () => {
    expect(formatSkillsForSystemPrompt([disabledSkill])).toBe("");
  });

  it("escapes XML in all model-visible skill fields", () => {
    expect(
      formatSkillsForSystemPrompt([
        {
          name: "a&b",
          description: `Quote "double" and 'single'`,
          content: "content",
          filePath: '/skills/<bad>&"quote"/SKILL.md',
        },
      ])
    ).toContain(
      "<name>a&amp;b</name>\n    <description>Quote &quot;double&quot; and &apos;single&apos;</description>\n    <location>/skills/&lt;bad&gt;&amp;&quot;quote&quot;/SKILL.md</location>"
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
    const out = appendSkillsBlock(base, [visibleSkill], true);
    expect(out.startsWith(base)).toBe(true);
    expect(out).toContain("<available_skills>");
    expect(out).toContain("<name>graphify</name>");
  });

  it("returns the base unchanged when read is not available", () => {
    expect(appendSkillsBlock(base, [visibleSkill], false)).toBe(base);
  });

  it("returns the base unchanged when there are no model-visible skills", () => {
    expect(appendSkillsBlock(base, [disabledSkill], true)).toBe(base);
    expect(appendSkillsBlock(base, [], true)).toBe(base);
  });
});

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
    const skills = [
      mockSkill("tdd", "Test-driven dev", "/skills/tdd/SKILL.md"),
    ];
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
    expect(result).toMatch(/You are a coding agent\.\n\n# Tool: read/);
    expect(result).toMatch(/\n\n.*<available_skills>/s);
  });

  it("handles multiple tools and skills together", () => {
    const tools = [
      mockTool("edit", "Edit."),
      mockTool("read", "Read."),
      mockTool("bash", "Run."),
    ];
    const skills = [
      mockSkill("tdd", "TDD", "/tdd/SKILL.md"),
      mockSkill("debug", "Debug", "/debug/SKILL.md"),
    ];
    const result = composeSystemPrompt(BASE, tools, skills, true);
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
    const a = composeSystemPrompt(BASE, tools, skills, true);
    const b = composeSystemPrompt(BASE, tools, skills, true);
    expect(a).toBe(b);
  });
});

describe("mid-session skill changes with tool inventory present", () => {
  const BASE = "You are a coding agent.";
  const tools = [
    mockTool("edit", "Edit files."),
    mockTool("read", "Read files."),
  ];
  const skill1 = mockSkill("tdd", "TDD", "/tdd/SKILL.md");
  const skill2 = mockSkill("debug", "Debug", "/debug/SKILL.md");

  it("stripSkillsBlock preserves tool inventory when removing skills", () => {
    const composed = composeSystemPrompt(BASE, tools, [skill1, skill2], true);
    const stripped = stripSkillsBlock(composed);
    expect(stripped).toContain("# Tool: edit");
    expect(stripped).toContain("# Tool: read");
    expect(stripped).not.toContain("<available_skills>");
    expect(stripped).toContain(BASE);
  });

  it("appendSkillsBlock re-appends skills after tool inventory", () => {
    const composed = composeSystemPrompt(BASE, tools, [skill1, skill2], true);
    const stripped = stripSkillsBlock(composed);
    const recomposed = appendSkillsBlock(stripped, [skill1], true);
    expect(recomposed).toContain("# Tool: edit");
    expect(recomposed).toContain("# Tool: read");
    expect(recomposed).toContain("tdd");
    expect(recomposed).not.toContain("debug");
    const toolIdx = recomposed.lastIndexOf("# Tool:");
    const skillsIdx = recomposed.indexOf("<available_skills>");
    expect(skillsIdx).toBeGreaterThan(toolIdx);
  });

  it("full add → remove → re-add cycle preserves tools throughout", () => {
    let prompt = composeSystemPrompt(BASE, tools, [skill1], true);
    expect(prompt).toContain("# Tool: edit");
    expect(prompt).toContain("tdd");

    const stripped = stripSkillsBlock(prompt);
    prompt = appendSkillsBlock(stripped, [], true);
    expect(prompt).toContain("# Tool: edit");
    expect(prompt).not.toContain("<available_skills>");

    prompt = appendSkillsBlock(prompt, [skill2], true);
    expect(prompt).toContain("# Tool: edit");
    expect(prompt).toContain("debug");
  });
});
