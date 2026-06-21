import { getEnvApiKey } from "@earendil-works/pi-ai";
import type { Api, Model } from "@earendil-works/pi-ai/base";
import {
  compact,
  DEFAULT_COMPACTION_SETTINGS,
  prepareCompaction,
} from "@sakti-code/agent";
import { SqliteSessionStorage } from "@sakti-code/db";
import { Elysia } from "elysia";
import { resolveModel } from "../agent/model-resolver.ts";
import { getCtx } from "../context.ts";

export const compactionRoutes = new Elysia({ name: "routes.compaction" }).post(
  "/api/sessions/:id/compact",
  async ({ params, store }): Promise<Response> => {
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

    const config = ctx.repos.models.getForProject(session.projectId);
    const provider = config?.provider ?? "";
    const apiKey = getEnvApiKey(provider);
    if (!apiKey) {
      return new Response(`No API key for ${provider} in env`, { status: 500 });
    }

    const storage = new SqliteSessionStorage(ctx.db, params.id, {
      id: params.id,
      createdAt: new Date().toISOString(),
    });
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

    const result = await compact(preparation.value, model.model, apiKey);
    if (!result.ok) {
      return new Response(result.error.message, { status: 500 });
    }

    const compactionEntry = {
      id: await storage.createEntryId(),
      parentId: null,
      timestamp: new Date().toISOString(),
      type: "compaction" as const,
      summary: result.value.summary,
      firstKeptEntryId: result.value.firstKeptEntryId,
      tokensBefore: result.value.tokensBefore,
    };
    await storage.appendEntry(compactionEntry);

    return Response.json({
      tokensBefore: result.value.tokensBefore,
      summary: result.value.summary,
      firstKeptEntryId: result.value.firstKeptEntryId,
    });
  }
);
