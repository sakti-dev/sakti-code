import { describe, expect, it } from "vitest";
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
      expect(manager.getSkill("test-skill")?.location).toBe("/path/to/test-skill/SKILL.md");
    });
  });
});
