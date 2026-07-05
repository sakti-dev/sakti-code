import type { ThinkingLevel } from "@sakti-code/llm";

import type { Profiles } from "./profiles-store.ts";

export interface ResolvedModelRef {
  model: string;
  provider: string;
  thinkingLevel: ThinkingLevel | "off";
}

const VALID_THINKING_LEVELS: ReadonlySet<string> = new Set<ThinkingLevel | "off">([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

function normalizeThinkingLevel(value: string | undefined): ThinkingLevel | "off" {
  return value && VALID_THINKING_LEVELS.has(value) ? (value as ThinkingLevel | "off") : "off";
}

/**
 * Resolve a model reference from a parsed profiles object.
 * Pure function — no I/O.
 *
 * Resolution order:
 * 1. Active profile id = `profileId ?? profiles.defaultProfile`
 * 2. Model reference = `profile.models[mode] ?? profile.models.default`
 *
 * Throws if the profile or its `models.default` is missing.
 */
export function resolveModelRef(
  profiles: Profiles,
  profileId: string | null,
  mode: "default" | "observe" | "plan" | "reflect" | "build" | "spec",
): ResolvedModelRef {
  const activeId = profileId ?? profiles.defaultProfile;
  const profile = profiles.profiles[activeId];
  if (!profile) {
    throw new Error(`Profile "${activeId}" not found in profiles.json`);
  }

  const modeRef = profile.models[mode];
  const ref = modeRef ?? profile.models.default;
  if (!ref) {
    throw new Error(`Profile "${activeId}" has no models.default — cannot resolve model`);
  }

  if (!(ref.provider && ref.model)) {
    throw new Error(
      `Profile "${activeId}" has no model configured — set a provider and model in profiles.json`,
    );
  }

  return {
    provider: ref.provider,
    model: ref.model,
    thinkingLevel: normalizeThinkingLevel(ref.thinkingLevel),
  };
}
