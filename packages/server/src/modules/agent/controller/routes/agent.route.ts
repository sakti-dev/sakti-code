import { Hono } from "hono";
import { buildAgentUsecases } from "../factory/agent.factory.js";

type Env = {
  Variables: {
    requestId: string;
    startTime: number;
  };
};

const app = new Hono<Env>();
const { listAgentsUsecase } = buildAgentUsecases();

app.get("/api/agents", async c => {
  return c.json({
    agents: listAgentsUsecase(),
  });
});

export const agentRoutes = app;
