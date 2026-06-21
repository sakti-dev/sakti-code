import type { Api, Model } from "@earendil-works/pi-ai/base";
import {
  compact,
  DEFAULT_COMPACTION_SETTINGS,
  prepareCompaction,
  Session,
} from "@sakti-code/agent";
import { Elysia } from "elysia";
import { resolveAuth, resolveModel } from "../../agent/model-resolver.ts";
import { createSessionStorage, getCtx } from "../../context.ts";

export const compactionRoutes = new Elysia({
  name: "routes.compaction",
  prefix: "/sessions",
}).post("/:id/compact", async ({ params, store }): Promise<Response> => {
  const ctx = getCtx(store);
  const session = ctx.repos.sessions.findById(params.id);
  if (!session) {
    return new Response("Not found", { status: 404 });
  }

  let model: { model: Model<Api>; provider: string };
  try {
    model = resolveModel(ctx, session);
  } catch {
    return new Response("No model configuration found for this session", {
      status: 500,
    });
  }

  const auth = resolveAuth(ctx, session);
  if (!auth) {
    return new Response(`No API key for ${model.provider} in env`, {
      status: 500,
    });
  }

  const storage = createSessionStorage(ctx, params.id);
  const entries = await storage.getEntries();
  const preparation = prepareCompaction(entries, DEFAULT_COMPACTION_SETTINGS);

  if (!preparation.ok) {
    return new Response(preparation.error.message, { status: 500 });
  }
  if (!preparation.value) {
    return Response.json({
      tokensBefore: 0,
      tokensAfter: 0,
      skipped: true,
    });
  }

  const result = await compact(preparation.value, auth.model, auth.apiKey);
  if (!result.ok) {
    return new Response(result.error.message, { status: 500 });
  }

  const sessionInstance = new Session(storage);
  await sessionInstance.appendCompaction(
    result.value.summary,
    result.value.firstKeptEntryId,
    result.value.tokensBefore,
    result.value.details
  );

  return Response.json({
    tokensBefore: result.value.tokensBefore,
    summary: result.value.summary,
    firstKeptEntryId: result.value.firstKeptEntryId,
  });
});
