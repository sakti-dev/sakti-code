export { discoverLocalSkills, SkillDiscovery } from "./discovery";
export { fetchRemoteSkills } from "./remote";
export { SkillManager } from "./skill";
export {
  getSkillManager,
  initializeSkills,
  setSkillManager,
  setSkillPermissionRules,
  skillTool,
  skillToolSchema,
} from "./tool";
export { parseSkillInfo, SkillInfo } from "./types";
import type { SkillInfo } from "./types";

export interface SkillApiResponse {
  name: string;
  description: string;
  location: string;
  content: string;
}

export function skillInfoToApiResponse(skill: SkillInfo): SkillApiResponse {
  return {
    name: skill.name,
    description: skill.description,
    location: skill.location,
    content: skill.content,
  };
}
