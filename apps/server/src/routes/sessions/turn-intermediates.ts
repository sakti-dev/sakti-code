import { Effect } from "effect";
import { Hono } from "hono";
import { createSessionStorage, getCtx } from "../../context.ts";

export const turnIntermediatesRoutes = new Hono()
  .basePath("/sessions")
  .get("/:id/turns/:turnId/intermediates", async (c) => {
    const ctx = getCtx(c);
    const sessionId = c.req.param("id");
    const turnId = c.req.param("turnId");
    const storage = createSessionStorage(ctx, sessionId);

    const entriesWithMeta = await Effect.runPromise(storage.getEntriesWithMeta());
    const intermediates = entriesWithMeta
      .filter((e) => e.turnId === turnId && !e.isTurnSummary)
      .map((e) => e.entry);

    return c.json({ entries: intermediates });
  });
