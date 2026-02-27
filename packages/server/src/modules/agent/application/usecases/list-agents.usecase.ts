import { listAgents } from "@sakti-code/core";

export interface AgentSummary {
  id: string;
  name: string;
}

const nameMap: Record<string, string> = {
  build: "Build Agent",
  explore: "Explore Agent",
  plan: "Plan Agent",
};

export function listAgentsUsecase(): AgentSummary[] {
  return listAgents().map(agent => ({
    id: agent.name,
    name: nameMap[agent.name] ?? agent.name,
  }));
}
