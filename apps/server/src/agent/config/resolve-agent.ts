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
 * Resolve the agent for a session based on its kind + per-session override.
 * Per-session override wins (when it differs from the default); otherwise
 * `intake` kind → intake agent, other kinds → build agent (the default).
 *
 * The "differs from the default" check is how we detect "no override": the
 * session-settings layer returns `DEFAULT_AGENT_NAME` ("build") when no
 * per-session override is set, so returning "build" literally means "no
 * override was chosen." For intake sessions this means: no per-session
 * override → intake agent; per-session override to anything else → that
 * agent.
 */
export function resolveSessionAgentForKind(
  kind: string,
  loadedAgents: AgentDefinition[],
  perSessionOverride?: string,
): { agent: AgentDefinition } {
  const name = perSessionOverride ?? (kind === "intake" ? "intake" : DEFAULT_AGENT_NAME);
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
