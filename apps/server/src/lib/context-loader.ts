import { join } from "node:path";
import type {
  AgentDefinition,
  AgentDiagnostic,
  CommandDiagnostic,
  ExecutionEnv,
  PromptTemplate,
  Skill,
  SkillDiagnostic,
} from "@sakti-code/agent";
import {
  isSuccess,
  loadAgents,
  loadCommands,
  loadSkills,
} from "@sakti-code/agent";
import { NodeExecutionEnv } from "../agent/execution-env.ts";
import { enumerateAgentConfigDirs } from "./config-dirs.ts";

/** Agent context loaded for a project: the slash-command, `@`-agent, and skill lists. */
export interface AgentContext {
  agents: AgentDefinition[];
  commands: PromptTemplate[];
  diagnostics: {
    commands: CommandDiagnostic[];
    agents: AgentDiagnostic[];
    skills: SkillDiagnostic[];
  };
  skills: Skill[];
}

const SKILL_SUBTREE_NAMES = ["skill", "skills"];

/**
 * Load the full agent context (commands, agents, skills) for a project by
 * scanning the global agent dir (`~/.sakti/agent`) and the project's `.agents`
 * dir via {@link enumerateAgentConfigDirs}. Commands and agents resolve their
 * own `command/`/`commands/` and `agent/`/`agents/` subtrees; skills are
 * resolved from `skill/`/`skills/` subtrees and passed to `loadSkills`.
 *
 * Loaded entries are not de-duplicated across the global and project scopes
 * here — name collisions resolve last-wins inside each loader. UI/merge policy
 * is applied by the caller.
 */
export async function loadAgentContext(
  projectCwd: string
): Promise<AgentContext> {
  const env = new NodeExecutionEnv(projectCwd);
  const configDirs = enumerateAgentConfigDirs(projectCwd);
  const skillDirs = await resolveSkillSubtrees(env, configDirs);

  const [commands, agents, skills] = await Promise.all([
    loadCommands(env, configDirs),
    loadAgents(env, configDirs),
    loadSkills(env, skillDirs),
  ]);

  return {
    commands: commands.commands,
    agents: agents.agents,
    skills: skills.skills,
    diagnostics: {
      commands: commands.diagnostics,
      agents: agents.diagnostics,
      skills: skills.diagnostics,
    },
  };
}

async function resolveSkillSubtrees(
  env: ExecutionEnv,
  configDirs: string[]
): Promise<string[]> {
  const skillDirs: string[] = [];
  for (const configDir of configDirs) {
    for (const name of SKILL_SUBTREE_NAMES) {
      const candidate = join(configDir, name);
      const info = await env.fileInfo(candidate);
      if (!isSuccess(info)) {
        continue;
      }
      if (
        info.success.kind === "directory" ||
        info.success.kind === "symlink"
      ) {
        skillDirs.push(candidate);
      }
    }
  }
  return skillDirs;
}
