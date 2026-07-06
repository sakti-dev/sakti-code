import type { AgentDefinition } from "@sakti-code/agent";
import { loadAgentContext } from "../../lib/context-loader.ts";
import { DEFAULT_AGENT_NAME, SERVER_AGENTS } from "./server-agents.ts";

/**
 * Resolve an agent by name from the server catalog plus project-loaded agents.
 * A user-defined agent with the same name overrides the server default.
 * Falls back to the default (`build`) agent when the name is unknown.
 */
export function resolveAgentByName(name: string, loadedAgents: AgentDefinition[]): AgentDefinition {
  const byName = new Map<string, AgentDefinition>();
  for (const agent of SERVER_AGENTS) {
    byName.set(agent.name, agent);
  }
  for (const agent of loadedAgents) {
    byName.set(agent.name, agent);
  }
  const resolved = byName.get(name) ?? byName.get(DEFAULT_AGENT_NAME);
  if (resolved) {
    return resolved;
  }
  // Unreachable: SERVER_AGENTS always seeds DEFAULT_AGENT_NAME ("build") above.
  throw new Error(`No agent resolved for "${name}"`);
}

/**
 * Resolve the agent for a session based on its kind + status + per-session
 * override. Per-session override wins; otherwise `plan` kind → plan agent,
 * `mission` kind in the `review` status → verify agent (edit-denied), and
 * all other mission statuses (specifying, building, merged) → build agent.
 *
 * The "specifying → build" routing is intentional: the design phase uses the
 * sakti-design skill (force-injected at run start) to keep the agent on-task
 * instead of a structurally edit-denied spec agent. Edit-denial is preserved
 * for verify (where bias reduction matters most).
 *
 * The "differs from the default" check is how we detect "no override": the
 * session-settings layer returns `DEFAULT_AGENT_NAME` ("build") when no
 * per-session override is set, so returning "build" literally means "no
 * override was chosen." For plan sessions this means: no per-session
 * override → plan agent; per-session override to anything else → that
 * agent.
 */
export function resolveSessionAgentForKind(
  kind: string,
  loadedAgents: AgentDefinition[],
  perSessionOverride?: string,
  status?: string,
): { agent: AgentDefinition } {
  let name: string;
  if (perSessionOverride) {
    name = perSessionOverride;
  } else if (kind === "plan") {
    name = "plan";
  } else if (kind === "mission" && status === "review") {
    name = "verify";
  } else {
    name = DEFAULT_AGENT_NAME;
  }
  return { agent: resolveAgentByName(name, loadedAgents) };
}

/** Load project agents and resolve the active agent by name. */
export async function resolveSessionAgent(
  projectCwd: string,
  agentName: string,
): Promise<AgentDefinition> {
  const { agents } = await loadAgentContext(projectCwd);
  return resolveAgentByName(agentName, agents);
}
