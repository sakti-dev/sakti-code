import type { AgentDefinition } from "../harness-types.ts";

/**
 * Construct a validated AgentDefinition. Throws on missing required fields
 * (name, systemPrompt). Optional fields (permission, activeToolNames,
 * thinkingLevel) are left undefined if not supplied — callers consuming the
 * agent must handle undefined per AgentDefinition's contract.
 *
 * Used by consumers (server, future CLI) to build their agent catalogs with
 * a consistent shape and clear failure when an entry is malformed.
 */
export function defineAgent(agent: AgentDefinition): AgentDefinition {
  if (!agent.name) {
    throw new Error("defineAgent: name is required");
  }
  if (!agent.systemPrompt) {
    throw new Error("defineAgent: systemPrompt is required");
  }
  return agent;
}
