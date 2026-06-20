import { getModel } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai/base";
import type { ServerContext } from "../context.ts";

export interface ResolvedModel {
  model: Model<any>;
  provider: string;
}

export function resolveModel(
  ctx: ServerContext,
  session: { projectId: string }
): ResolvedModel {
  const config = ctx.repos.models.getForProject(session.projectId);
  if (config) {
    return {
      model: getModel(config.provider, config.modelId),
      provider: config.provider,
    };
  }
  const global = ctx.repos.models.getGlobalDefault();
  if (global) {
    return {
      model: getModel(global.provider, global.modelId),
      provider: global.provider,
    };
  }
  throw new Error(
    `No model config found for project ${session.projectId} and no global default`
  );
}
