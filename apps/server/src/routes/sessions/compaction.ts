import { Hono } from "hono";
import { runCompact } from "../../agent/commands/compact.ts";
import { getCtx } from "../../context.ts";

export const compactionRoutes = new Hono()
  .basePath("/sessions")
  .post("/:id/compact", async (c): Promise<Response> => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const customInstructions = c.req.query("instructions") ?? undefined;

    const result = await runCompact(ctx, id, customInstructions);

    if ("notFound" in result) {
      return c.json({ error: "Not found" }, 404);
    }
    if ("error" in result) {
      return c.json({ error: result.error }, 500);
    }
    if ("skipped" in result) {
      return c.json({ tokensBefore: 0, tokensAfter: 0, skipped: true });
    }
    return c.json(result);
  });
