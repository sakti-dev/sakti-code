import { z } from "zod";
import { SkillInfo } from "./types";

export const RemoteSkillIndex = z.object({
  skills: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      files: z.array(z.string()).optional(),
    })
  ),
});

export type RemoteSkillIndex = z.infer<typeof RemoteSkillIndex>;

export async function fetchRemoteSkills(baseUrl: string): Promise<SkillInfo[]> {
  try {
    const url = new URL("index.json", baseUrl).href;
    const response = await fetch(url);

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const parsed = RemoteSkillIndex.parse(data);

    const skillsWithContent = await Promise.all(
      parsed.skills.map(async skill => {
        const location = new URL(skill.files?.[0] || "SKILL.md", baseUrl).href;
        let content = "";

        try {
          const contentResponse = await fetch(location);
          if (contentResponse.ok) {
            content = await contentResponse.text();
          }
        } catch {
          // Failed to fetch content, leave empty
        }

        return {
          name: skill.name,
          description: skill.description,
          location,
          content,
        };
      })
    );

    return skillsWithContent;
  } catch {
    return [];
  }
}
