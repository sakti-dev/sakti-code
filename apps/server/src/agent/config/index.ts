/** Agent configuration: catalog, prompts, tool registry, resolution helpers. */

export { BRANCH_SUMMARY_PROMPTS, COMPACTION_PROMPTS } from "./compaction-prompts.ts";

export {
  BUILD_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  EXPLORE_PROMPT,
  GENERAL_PROMPT,
  INTAKE_SYSTEM_PROMPT,
  PLAN_PROMPT,
} from "./prompts.ts";

export {
  resolveAgentByName,
  resolveSessionAgent,
  resolveSessionAgentForKind,
} from "./resolve-agent.ts";
export { DEFAULT_AGENT_NAME, resolveServerAgent, SERVER_AGENTS } from "./server-agents.ts";
export { SKILLS_INSTRUCTIONS } from "./skills-instructions.ts";
export {
  buildAgentTools,
  rebuildTool,
  TOOL_FACTORIES,
  type ToolContext,
  type ToolFactory,
} from "./tool-registry.ts";
