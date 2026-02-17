import * as fs from "fs/promises";
import * as path from "path";
import { SkillInfo, parseSkillInfo } from "./types";

const DEFAULT_DISCOVERY_PATHS = [
  ".claude/skills",
  ".agents/skills",
  ".opencode/skills",
  ".opencode/skill",
];

export async function discoverLocalSkills(
  baseDir: string,
  relativePaths: string[]
): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  for (const relativePath of relativePaths) {
    const fullPath = path.join(baseDir, relativePath);

    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(fullPath, entry.name, "SKILL.md");
          try {
            const content = await fs.readFile(skillPath, "utf-8");
            const skillInfo = parseSkillInfo(content, skillPath);
            skills.push(skillInfo);
          } catch {
            // SKILL.md doesn't exist in this directory, skip
          }
        }
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  return skills;
}

export class SkillDiscovery {
  private baseDir: string;
  private customPaths: string[];

  constructor(baseDir: string, customPaths: string[] = []) {
    this.baseDir = baseDir;
    this.customPaths = customPaths;
  }

  async discover(): Promise<SkillInfo[]> {
    const allPaths = [...DEFAULT_DISCOVERY_PATHS, ...this.customPaths];
    return discoverLocalSkills(this.baseDir, allPaths);
  }
}
