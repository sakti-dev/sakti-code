import { getEnvApiKey, getModel } from "@earendil-works/pi-ai";
import type { Api, KnownProvider, Model } from "@earendil-works/pi-ai/base";
import type { ServerContext } from "../context.ts";

export interface ResolvedModel {
  model: Model<Api>;
  provider: string;
}

export interface ResolvedAuth extends ResolvedModel {
  apiKey: string;
}

function resolveModelInstance(
  provider: KnownProvider,
  modelId: string
): Model<Api> {
  return getModel(provider, modelId as never);
}

export function resolveModel(
  ctx: ServerContext,
  session: { projectId: string }
): ResolvedModel {
  const config = ctx.repos.models.getForProject(session.projectId);
  if (config) {
    return {
      model: resolveModelInstance(
        config.provider as KnownProvider,
        config.modelId
      ),
      provider: config.provider,
    };
  }
  const global = ctx.repos.models.getGlobalDefault();
  if (global) {
    return {
      model: resolveModelInstance(
        global.provider as KnownProvider,
        global.modelId
      ),
      provider: global.provider,
    };
  }
  throw new Error(
    `No model config found for project ${session.projectId} and no global default`
  );
}

/**
 * Resolve model + provider + API key for a session.
 * Returns undefined if no API key is set in env for the resolved provider.
 */
export function resolveAuth(
  ctx: ServerContext,
  session: { projectId: string }
): ResolvedAuth | undefined {
  const { model, provider } = resolveModel(ctx, session);
  const apiKey = getEnvApiKey(provider);
  if (!apiKey) {
    return;
  }
  return { model, provider, apiKey };
}
