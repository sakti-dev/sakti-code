import { tool, zodSchema } from "ai";
import { glob } from "glob";
import * as path from "path";
import { z } from "zod";
import { createDefaultRules, evaluatePermission } from "../security/permission-rules";
import { SkillDiscovery, fetchRemoteSkills } from "./index";
import { SkillManager } from "./skill";

export const skillToolSchema = z.object({
  name: z.string().describe("The name of the skill from available_skills"),
  query: z.string().optional().describe("Optional query to provide context when loading the skill"),
});

export type SkillToolInput = z.infer<typeof skillToolSchema>;

export interface SkillToolOutput {
  content: string;
  skillFiles: string[];
  error?: string;
}

let skillManagerInstance: SkillManager | null = null;
let skillPermissionRules = createDefaultRules();

export function setSkillManager(manager: SkillManager): void {
  skillManagerInstance = manager;
}

export function getSkillManager(): SkillManager | null {
  return skillManagerInstance;
}

export function setSkillPermissionRules(rules: typeof skillPermissionRules): void {
  skillPermissionRules = rules;
}

export async function initializeSkills(
  workspaceDir: string,
  customPaths?: string[],
  remoteUrls?: string[]
): Promise<SkillManager> {
  const discovery = new SkillDiscovery(workspaceDir, customPaths);
  const [localSkills, ...remoteSkillArrays] = await Promise.all([
    discovery.discover(),
    ...(remoteUrls?.map(url => fetchRemoteSkills(url)) ?? []),
  ]);

  const allSkills = [...localSkills, ...remoteSkillArrays.flat()];
  const manager = new SkillManager(allSkills);
  setSkillManager(manager);
  return manager;
}

export const skillTool = tool({
  description: "Load and execute a skill with specific domain knowledge",
  inputSchema: zodSchema(skillToolSchema),
  outputSchema: zodSchema(
    z.object({
      content: z.string(),
      skillFiles: z.array(z.string()),
      error: z.string().optional(),
    })
  ),
  execute: async ({ name, query }: SkillToolInput, context: unknown): Promise<SkillToolOutput> => {
    const permissionAction = evaluatePermission("skill", name, skillPermissionRules);

    if (permissionAction === "deny") {
      return {
        content: "",
        skillFiles: [],
        error: `Permission denied to load skill '${name}'`,
      };
    }

    if (permissionAction === "ask") {
      return {
        content: "",
        skillFiles: [],
        error: `Permission required to load skill '${name}'. Please approve the skill permission.`,
      };
    }

    const ctx = context as { getSkill?: (name: string) => unknown } | undefined;
    const getSkill = ctx?.getSkill ?? ((_name: string) => skillManagerInstance?.getSkill(_name));

    const skill = getSkill(name) as
      | Awaited<ReturnType<NonNullable<typeof skillManagerInstance>["getSkill"]>>
      | undefined;
    if (!skill) {
      return {
        content: "",
        skillFiles: [],
        error: `Skill '${name}' not found`,
      };
    }

    const skillDir = path.dirname(skill.location);
    let skillFiles: string[] = [];

    try {
      const files = await glob("**/*", { cwd: skillDir, nodir: true });
      skillFiles = files.slice(0, 10).map(f => path.join(skillDir, f));
    } catch {
      // Ignore glob errors
    }

    const userContextSection = query ? `\n## User Query Context\n\n${query}\n` : "";

    const formattedContent = `<skill_content name="${skill.name}">
# Skill: ${skill.name}

${skill.content}
${userContextSection}
Base directory for this skill: file://${skillDir}
Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.
Note: file list is sampled.

<skill_files>
${skillFiles.map(f => `<file>${f}</file>`).join("\n")}
</skill_files>
</skill_content>`;

    return { content: formattedContent, skillFiles };
  },
});
