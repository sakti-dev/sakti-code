import { getModel } from "@earendil-works/pi-ai";
import type { AnyModel } from "@sakti-code/agent";
import type { ServerContext } from "../context.ts";

// biome-ignore lint/suspicious/noExplicitAny: DB stores provider/modelId as strings; pi-ai requires specific literal types — safe boundary cast
const getModelAny = getModel as any;

export function resolveModel(
  ctx: ServerContext,
  session: { projectId: string }
): AnyModel {
  const config = ctx.repos.models.getForProject(session.projectId);
  if (config) {
    return getModelAny(config.provider, config.modelId) as AnyModel;
  }
  const global = ctx.repos.models.getGlobalDefault();
  if (global) {
    return getModelAny(global.provider, global.modelId) as AnyModel;
  }
  throw new Error(
    `No model config found for project ${session.projectId} and no global default`
  );
}
