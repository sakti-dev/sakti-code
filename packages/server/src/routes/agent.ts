/**
 * Agent API Routes
 *
 * GET /api/agents - List available agents
 */

import { listAgents } from "@sakti-code/core";
import { Hono } from "hono";
import type { Env } from "../index";

const agentRouter = new Hono<Env>();

/**
 * List available agents
 */
agentRouter.get("/api/agents", async c => {
  const nameMap: Record<string, string> = {
    build: "Build Agent",
    explore: "Explore Agent",
    plan: "Plan Agent",
  };

  return c.json({
    agents: listAgents().map(agent => ({
      id: agent.name,
      name: nameMap[agent.name] ?? agent.name,
    })),
  });
});

export default agentRouter;
