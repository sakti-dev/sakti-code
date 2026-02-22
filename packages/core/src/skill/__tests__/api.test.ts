import { skillInfoToApiResponse } from "@/skill/index";
import { describe, expect, it } from "vitest";

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
