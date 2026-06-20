import { getEnvApiKey } from "@earendil-works/pi-ai";
import { compactMessages } from "@sakti-code/agent";
import { SqliteSessionStore } from "@sakti-code/db";
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

    // biome-ignore lint/suspicious/noExplicitAny: pi-ai Model is generic over provider API; resolveModel returns any model type
    let model: any;
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

    const sessionStore = new SqliteSessionStore(ctx.db);
    const messages = await sessionStore.loadMessages(params.id);
    const result = await compactMessages({
      model,
      apiKey,
      contextWindow: model.contextWindow,
      messages,
      keepRecentTokens: 20_000,
    });
    await sessionStore.replaceMessages(params.id, result.messages);

    return Response.json({
      tokensBefore: result.tokensBefore,
      tokensAfter: result.tokensAfter,
    });
  }
);
