import { SkillInfo } from "./types";

export interface ListSkillsOptions {
  namePattern?: string;
}

export class SkillManager {
  private skills: Map<string, SkillInfo>;

  constructor(skills: SkillInfo[] = []) {
    this.skills = new Map();
    for (const skill of skills) {
      this.skills.set(skill.name, skill);
    }
  }

  getSkill(name: string): SkillInfo | undefined {
    return this.skills.get(name);
  }

  listSkills(options: ListSkillsOptions = {}): SkillInfo[] {
    let result = Array.from(this.skills.values());

    if (options.namePattern) {
      const regex = new RegExp(options.namePattern.replace(/\*/g, ".*").replace(/\?/g, "."));
      result = result.filter(s => regex.test(s.name));
    }

    return result;
  }

  addSkill(skill: SkillInfo): void {
    if (!this.skills.has(skill.name)) {
      this.skills.set(skill.name, skill);
    }
  }

  removeSkill(name: string): boolean {
    return this.skills.delete(name);
  }

  get count(): number {
    return this.skills.size;
  }
}
