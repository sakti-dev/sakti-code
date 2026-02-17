import { z } from "zod";

export const SkillInfo = z.object({
  name: z.string(),
  description: z.string(),
  location: z.string(),
  content: z.string(),
});

export type SkillInfo = z.infer<typeof SkillInfo>;

export function parseSkillInfo(markdown: string, location: string): SkillInfo {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = markdown.match(frontmatterRegex);

  if (!match) {
    throw new Error("Invalid SKILL.md format: missing frontmatter");
  }

  const [, frontmatter] = match;
  const lines = frontmatter.split("\n");
  let name = "";
  let description = "";

  for (const line of lines) {
    const [key, ...valueParts] = line.split(":");
    if (key && valueParts.length > 0) {
      const value = valueParts.join(":").trim();
      if (key.trim() === "name") name = value;
      if (key.trim() === "description") description = value;
    }
  }

  if (!name || !description) {
    throw new Error("Missing required frontmatter fields: name and description");
  }

  return {
    name,
    description,
    location,
    content: markdown,
  };
}
