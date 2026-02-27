import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../../../../shared/controller/http/validators.js";
import { buildCommandUsecases } from "../factory/command.factory.js";

type Env = {
  Variables: {
    requestId: string;
    startTime: number;
  };
};

const app = new Hono<Env>();
const { listCommandsUsecase } = buildCommandUsecases();
const commandQuerySchema = z.object({
  category: z.string().optional(),
  enabled: z.enum(["true", "false"]).optional(),
});

app.get("/api/commands", zValidator("query", commandQuerySchema), async c => {
  const { category, enabled } = c.req.valid("query");

  return c.json({
    commands: listCommandsUsecase({ category, enabled }),
  });
});

export const commandRoutes = app;
