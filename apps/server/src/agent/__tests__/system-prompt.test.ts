import { describe, expect, it } from "vitest";
import { appendSkillsBlock } from "../system-prompt.ts";

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

describe("appendSkillsBlock", () => {
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
