import type { KnownProvider, Model } from "@sakti-code/llm";
import { getModel } from "@sakti-code/llm";
import type { ServerContext } from "../context.ts";
import { resolveModelRef } from "../lib/profile-resolver.ts";
import type { Profiles, ProfilesStore } from "../lib/profiles-store.ts";

export interface ResolvedModel {
  model: Model;
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

function resolveModelInstance(provider: KnownProvider, modelId: string): Model {
  return getModel(provider, modelId);
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
  session: { id: string; projectId: string; profileId: string | null }
): ResolvedModel {
  const profiles = getCachedProfiles(ctx);
  const ref = resolveModelRef(profiles, session.profileId, "default");
  return {
    model: resolveModelInstance(ref.provider as KnownProvider, ref.model),
    modelId: ref.model,
    provider: ref.provider,
    thinkingLevel: ref.thinkingLevel,
  };
}

export function resolveAuth(
  ctx: ServerContext,
  session: { id: string; projectId: string; profileId: string | null }
): ResolvedAuth | undefined {
  const resolved = resolveModel(ctx, session);
  const apiKey = ctx.auth.getApiKey(resolved.provider);
  if (!apiKey) {
    return;
  }
  return { ...resolved, apiKey };
}
