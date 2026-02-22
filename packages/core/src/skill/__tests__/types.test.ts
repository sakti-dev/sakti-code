import { SkillInfo, parseSkillInfo } from "@/skill/types";
import { describe, expect, it } from "vitest";

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
