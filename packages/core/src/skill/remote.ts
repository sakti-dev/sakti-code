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

    return parsed.skills.map(skill => ({
      name: skill.name,
      description: skill.description,
      location: new URL(skill.files?.[0] || "SKILL.md", baseUrl).href,
      content: "",
    }));
  } catch {
    return [];
  }
}
