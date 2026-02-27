import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../../../../shared/controller/http/validators.js";
import { buildLspUsecases } from "../factory/lsp.factory.js";

type Env = {
  Variables: {
    requestId: string;
    startTime: number;
    instanceContext: { directory: string } | undefined;
  };
};

const app = new Hono<Env>();
const { getLspStatusUsecase } = buildLspUsecases();
const lspQuerySchema = z.object({
  directory: z.string().optional(),
});

app.get("/api/lsp/status", zValidator("query", lspQuerySchema), async c => {
  const result = await getLspStatusUsecase({
    directory: c.req.valid("query").directory,
    fallbackDirectory: c.get("instanceContext")?.directory,
  });
  return c.json(result);
});

export const lspRoutes = app;
