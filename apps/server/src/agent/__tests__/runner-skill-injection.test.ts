import type { Skill } from "@sakti-code/agent";
import { describe, expect, it } from "vite-plus/test";
import { buildSkillInjectionMessages } from "../config/skill-injection.ts";
import { getBuiltinSkillForPhase } from "../config/phase-skills.ts";

describe("runner skill injection (unit)", () => {
  it("builds initialMessages for the build phase", () => {
    const skillName = getBuiltinSkillForPhase("build");
    expect(skillName).toBe("sakti-build");

    const skill: Skill = {
      name: "sakti-build",
      description: "...",
      content: "# Sakti Build\n...",
      filePath: "/path/to/sakti-build/SKILL.md",
    };
    const msgs = buildSkillInjectionMessages(skill);
    expect(msgs).toHaveLength(2);
  });

  it("builds empty initialMessages when skill is not found (undefined)", () => {
    const msgs = buildSkillInjectionMessages(undefined);
    expect(msgs).toEqual([]);
  });

  it("builds empty initialMessages when phase has no builtin skill", () => {
    const skillName = getBuiltinSkillForPhase("custom-phase");
    expect(skillName).toBeUndefined();
  });

  it("maps all 5 phases to their skills", () => {
    expect(getBuiltinSkillForPhase("plan")).toBe("sakti-plan");
    expect(getBuiltinSkillForPhase("specify")).toBe("sakti-specify");
    expect(getBuiltinSkillForPhase("build")).toBe("sakti-build");
    expect(getBuiltinSkillForPhase("verify")).toBe("sakti-verify");
    expect(getBuiltinSkillForPhase("archive")).toBe("sakti-archive");
  });
});
