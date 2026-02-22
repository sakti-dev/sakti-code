import { skillTool, skillToolSchema } from "@/skill/tool";
import type { SkillInfo } from "@/skill/types";
import { describe, expect, it } from "vitest";

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

      const mockContext = { getSkill: () => mockSkill };
      const result = await skillTool.execute({ name: "test-skill" }, mockContext);

      expect(result.content).toContain("Test Skill");
      expect(result.skillFiles).toHaveLength(0); // No additional files
    });

    it("should return error for non-existent skill", async () => {
      const mockContext = { getSkill: () => undefined };
      const result = await skillTool.execute({ name: "non-existent" }, mockContext);

      expect(result.error).toBe("Skill 'non-existent' not found");
    });

    it("should format remote skill locations as URLs", async () => {
      const remoteSkill: SkillInfo = {
        name: "remote-skill",
        description: "Remote",
        location: "https://example.com/skills/remote/SKILL.md",
        content: "# Remote Skill",
      };

      const mockContext = { getSkill: () => remoteSkill };
      const result = await skillTool.execute({ name: "remote-skill" }, mockContext);

      expect(result.error).toBeUndefined();
      expect(result.content).toContain(
        "Base URL for this skill: https://example.com/skills/remote/"
      );
      expect(result.content).not.toContain("file://https:");
    });
  });
});
