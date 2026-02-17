import { describe, expect, it, vi } from "vitest";
import { fetchRemoteSkills } from "../../src/skill/remote";

describe("remote skill discovery", () => {
  describe("fetchRemoteSkills", () => {
    it("should fetch and parse remote index.json", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          skills: [{ name: "remote-skill", description: "Remote skill", files: ["SKILL.md"] }],
        }),
      });
      global.fetch = mockFetch;

      const skills = await fetchRemoteSkills("https://example.com/skills/");
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("remote-skill");
    });

    it("should return empty array on network error", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
      global.fetch = mockFetch;

      const skills = await fetchRemoteSkills("https://example.com/skills/");
      expect(skills).toHaveLength(0);
    });
  });
});
