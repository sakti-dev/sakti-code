import { SkillManager } from "@/skill/skill";
import { skillTool } from "@/skill/tool";
import type { SkillInfo } from "@/skill/types";
import { describe, expect, it } from "vitest";

async function getToolResult(
  result:
    | AsyncIterable<{ content: string; skillFiles: string[]; error?: string }>
    | { content: string; skillFiles: string[]; error?: string }
): Promise<{ content: string; skillFiles: string[]; error?: string }> {
  if (Symbol.asyncIterator in result) {
    let finalResult: { content: string; skillFiles: string[]; error?: string } = {
      content: "",
      skillFiles: [],
    };
    for await (const chunk of result) {
      finalResult = chunk;
    }
    return finalResult;
  }
  return result;
}

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

      for (const skill of mockSkills) {
        manager.addSkill(skill);
      }

      expect(manager.count).toBe(1);
      expect(manager.getSkill("integration-skill")).toBeDefined();

      const context = {
        getSkill: (name: string) => manager.getSkill(name),
      };

      const executeFn = skillTool.execute;
      if (!executeFn) {
        throw new Error("skillTool.execute is undefined");
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawResult = await executeFn({ name: "integration-skill" }, context as any);
      const result = await getToolResult(rawResult);

      expect(result.error).toBeUndefined();
      expect(result.content).toContain("Integration Skill");
    });

    it("should handle skill not found gracefully", async () => {
      const manager = new SkillManager();
      const context = {
        getSkill: (name: string) => manager.getSkill(name),
      };

      const executeFn = skillTool.execute;
      if (!executeFn) {
        throw new Error("skillTool.execute is undefined");
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawResult = await executeFn({ name: "nonexistent" }, context as any);
      const result = await getToolResult(rawResult);

      expect(result.error).toBe("Skill 'nonexistent' not found");
    });
  });
});
