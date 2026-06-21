import { getModel } from "@earendil-works/pi-ai";
import type { KnownProvider, Model } from "@earendil-works/pi-ai/base";
import type { ServerContext } from "../context.ts";

export interface ResolvedModel {
  model: Model<any>;
  provider: string;
}

const resolveModelInstance = getModel as unknown as (
  provider: KnownProvider,
  modelId: string
) => Model<any>;

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
