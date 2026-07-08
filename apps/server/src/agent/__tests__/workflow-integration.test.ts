import type { Skill } from "@sakti-code/agent";
import { describe, expect, it } from "vite-plus/test";
import { buildSkillInjectionMessages } from "../config/skill-injection.ts";
import { getBuiltinSkillForPhase, isBuiltinSkillName } from "../config/phase-skills.ts";

describe("phase workflow integration", () => {
  it("for each phase, the correct skill is mapped and injection messages build correctly", () => {
    const cases: Array<{ phase: string; expectedSkill: string }> = [
      { phase: "plan", expectedSkill: "sakti-plan" },
      { phase: "specify", expectedSkill: "sakti-specify" },
      { phase: "build", expectedSkill: "sakti-build" },
      { phase: "verify", expectedSkill: "sakti-verify" },
      { phase: "archive", expectedSkill: "sakti-archive" },
    ];

    for (const { phase, expectedSkill } of cases) {
      const skillName = getBuiltinSkillForPhase(phase);
      expect(skillName).toBe(expectedSkill);
      expect(isBuiltinSkillName(skillName!)).toBe(true);

      const skill: Skill = {
        name: skillName!,
        description: `${skillName} skill`,
        content: `# ${skillName}\nskill body`,
        filePath: `/skills/${skillName}/SKILL.md`,
      };
      const msgs = buildSkillInjectionMessages(skill);
      expect(msgs).toHaveLength(2);
      expect(msgs[0]!.role).toBe("assistant");
      expect(msgs[1]!.role).toBe("toolResult");
    }
  });

  it("unknown phase yields no injection", () => {
    expect(getBuiltinSkillForPhase("nonexistent")).toBeUndefined();
    expect(buildSkillInjectionMessages(undefined)).toEqual([]);
  });
});
