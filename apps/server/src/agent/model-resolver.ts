import { getModel } from "@earendil-works/pi-ai";
import type { Api, KnownProvider, Model } from "@earendil-works/pi-ai/base";
import type { ServerContext } from "../context.ts";
import { resolveModelRef } from "../lib/profile-resolver.ts";
import type { Profiles, ProfilesStore } from "../lib/profiles-store.ts";

export interface ResolvedModel {
  model: Model<Api>;
  /** The raw model ID string from the profile (for session snapshot). */
  modelId: string;
  provider: string;
  thinkingLevel: string;
}

export interface ResolvedAuth extends ResolvedModel {
  apiKey: string;
}

interface ProfileCache {
  mtimeMs: number;
  profiles: Profiles;
  store: ProfilesStore;
}

let cache: ProfileCache | null = null;

function resolveModelInstance(
  provider: KnownProvider,
  modelId: string
): Model<Api> {
  return getModel(provider, modelId as never);
}

/** Clear the profile cache (for testing). */
export function clearProfileCache(): void {
  cache = null;
}

function getCachedProfiles(ctx: ServerContext): Profiles {
  const store = ctx.profiles;
  const currentMtime = store.getMtimeMs();

  if (cache && cache.store === store && cache.mtimeMs === currentMtime) {
    return cache.profiles;
  }

  const profiles = store.read();
  cache = { store, mtimeMs: currentMtime, profiles };
  return profiles;
}

export function resolveModel(
  ctx: ServerContext,
  session: { projectId: string }
): ResolvedModel {
  const project = ctx.repos.projects.findById(session.projectId);
  if (!project) {
    throw new Error(`Project not found: ${session.projectId}`);
  }

  const profiles = getCachedProfiles(ctx);
  const ref = resolveModelRef(profiles, project.profileId, "default");
  return {
    model: resolveModelInstance(ref.provider as KnownProvider, ref.model),
    modelId: ref.model,
    provider: ref.provider,
    thinkingLevel: ref.thinkingLevel,
  };
}

export function resolveAuth(
  ctx: ServerContext,
  session: { projectId: string }
): ResolvedAuth | undefined {
  const resolved = resolveModel(ctx, session);
  const apiKey = ctx.auth.getApiKey(resolved.provider);
  if (!apiKey) {
    return;
  }
  return { ...resolved, apiKey };
}
