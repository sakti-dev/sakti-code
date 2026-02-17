import * as fs from "fs/promises";
import * as path from "path";
import { describe, expect, it, vi } from "vitest";
import { discoverLocalSkills, SkillDiscovery } from "../../src/skill/discovery";

vi.mock("fs/promises");
vi.mock("path");

describe("skill discovery", () => {
  describe("discoverLocalSkills", () => {
    it("should discover skills from .claude/skills/", async () => {
      const mockDirent = {
        isDirectory: () => true,
        name: "test-skill",
      };
      vi.mocked(fs.readdir).mockResolvedValue([mockDirent] as unknown as Awaited<
        ReturnType<typeof fs.readdir>
      >);
      vi.mocked(fs.readFile).mockResolvedValue(
        `---
name: test-skill
description: Test skill
---
# Content`
      );
      vi.mocked(path.join).mockImplementation((...args) => args.join("/"));

      const skills = await discoverLocalSkills("/home/user/project", [".claude/skills"]);
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("test-skill");
    });

    it("should return empty array when directory does not exist", async () => {
      vi.mocked(fs.readdir).mockRejectedValue(new Error("ENOENT"));

      const skills = await discoverLocalSkills("/home/user/project", [".claude/skills"]);
      expect(skills).toHaveLength(0);
    });

    it("should handle multiple discovery paths", async () => {
      const mockDirent1 = { isDirectory: () => true, name: "skill1" };
      const mockDirent2 = { isDirectory: () => true, name: "skill2" };
      vi.mocked(fs.readdir)
        .mockResolvedValueOnce([mockDirent1] as unknown as Awaited<ReturnType<typeof fs.readdir>>)
        .mockResolvedValueOnce([mockDirent2] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      vi.mocked(fs.readFile).mockResolvedValue(
        `---
name: skill
description: Skill
---
# Content`
      );

      const skills = await discoverLocalSkills("/project", [".claude/skills", ".agents/skills"]);
      expect(skills).toHaveLength(2);
    });
  });

  describe("SkillDiscovery class", () => {
    it("should discover skills from default locations", async () => {
      const discovery = new SkillDiscovery("/test/project");
      const skills = await discovery.discover();
      expect(Array.isArray(skills)).toBe(true);
    });
  });
});
