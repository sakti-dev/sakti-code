import {
  compact,
  DEFAULT_COMPACTION_SETTINGS,
  prepareCompaction,
  Session,
} from "@sakti-code/agent";
import type { Model } from "@sakti-code/llm";
import { Hono } from "hono";
import { resolveAuth, resolveModel } from "../../agent/model-resolver.ts";
import { createSessionStorage, getCtx } from "../../context.ts";

export const compactionRoutes = new Hono()
  .basePath("/sessions")
  .post("/:id/compact", async (c): Promise<Response> => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const session = ctx.repos.sessions.findById(id);
    if (!session) {
      return c.json({ error: "Not found" }, 404);
    }

    let model: { model: Model; provider: string };
    try {
      model = resolveModel(ctx, session);
    } catch (e) {
      return c.json(
        {
          error: `Model resolution failed: ${e instanceof Error ? e.message : String(e)}`,
        },
        500
      );
    }

    const auth = resolveAuth(ctx, session);
    if (!auth) {
      return c.json(
        {
          error: `No API key for ${model.provider} — add one in Settings > Models`,
        },
        500
      );
    }

    const storage = createSessionStorage(ctx, id);
    const entries = await storage.getEntries();
    const preparation = prepareCompaction(entries, DEFAULT_COMPACTION_SETTINGS);

    if (!preparation.ok) {
      return c.json({ error: preparation.error.message }, 500);
    }
    if (!preparation.value) {
      return c.json({ tokensBefore: 0, tokensAfter: 0, skipped: true });
    }

    const result = await compact(preparation.value, auth.model, auth.apiKey);
    if (!result.ok) {
      return c.json({ error: result.error.message }, 500);
    }

    const sessionInstance = new Session(storage);
    await sessionInstance.appendCompaction(
      result.value.summary,
      result.value.firstKeptEntryId,
      result.value.tokensBefore,
      result.value.details
    );

    return c.json({
      tokensBefore: result.value.tokensBefore,
      summary: result.value.summary,
      firstKeptEntryId: result.value.firstKeptEntryId,
    });
  });
