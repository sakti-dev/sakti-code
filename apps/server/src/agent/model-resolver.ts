import { getModel } from "@earendil-works/pi-ai";
import type { AnyModel } from "@sakti-code/agent";
import type { ServerContext } from "../context.ts";

// biome-ignore lint/suspicious/noExplicitAny: DB stores provider/modelId as strings; pi-ai requires specific literal types — safe boundary cast
const getModelAny = getModel as any;

export interface ResolvedModel {
  model: AnyModel;
  provider: string;
}

export function resolveModel(
  ctx: ServerContext,
  session: { projectId: string }
): ResolvedModel {
  const config = ctx.repos.models.getForProject(session.projectId);
  if (config) {
    return {
      model: getModelAny(config.provider, config.modelId) as AnyModel,
      provider: config.provider,
    };
  }
  const global = ctx.repos.models.getGlobalDefault();
  if (global) {
    return {
      model: getModelAny(global.provider, global.modelId) as AnyModel,
      provider: global.provider,
    };
  }
  throw new Error(
    `No model config found for project ${session.projectId} and no global default`
  );
}
