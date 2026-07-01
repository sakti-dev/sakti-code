import type { Model, ThinkingLevel } from "@sakti-code/llm";
import { getModel } from "@sakti-code/llm";
import type {
  TokenCounter,
  ObservationalMemoryThresholds,
  ObservationalMemoryBuffering,
} from "@sakti-code/agent";
import { TokenCounter as TokenCounterImpl } from "@sakti-code/agent";
import type { ServerContext } from "../context.ts";
import { resolveModelRef } from "../lib/profile-resolver.ts";

const DEFAULT_OBSERVATION_THRESHOLD = 30_000;
const DEFAULT_REFLECTION_THRESHOLD = 40_000;

interface OmSettings {
  enabled: boolean;
  observationThreshold?: number | undefined;
  reflectionThreshold?: number | undefined;
  instruction?: string | undefined;
}

function readOmSettings(ctx: ServerContext): OmSettings | undefined {
  const raw = ctx.settingsFile.read() as Record<string, unknown>;
  const om = raw.observationalMemory as Record<string, unknown> | undefined;
  if (!om || typeof om !== "object") {
    return undefined;
  }
  const enabled = om.enabled === true;
  if (!enabled) {
    return undefined;
  }
  return {
    enabled,
    ...(typeof om.observationThreshold === "number"
      ? { observationThreshold: om.observationThreshold }
      : {}),
    ...(typeof om.reflectionThreshold === "number"
      ? { reflectionThreshold: om.reflectionThreshold }
      : {}),
    ...(typeof om.instruction === "string" ? { instruction: om.instruction } : {}),
  };
}

function readBufferingSettings(ctx: ServerContext): ObservationalMemoryBuffering | undefined {
  const raw = ctx.settingsFile.read() as Record<string, unknown>;
  const om = raw.observationalMemory as Record<string, unknown> | undefined;
  if (!om || typeof om !== "object") {
    return undefined;
  }
  const buf = om.buffering as Record<string, unknown> | undefined;
  if (!buf || typeof buf !== "object") {
    return undefined;
  }
  const observationBufferTokens =
    typeof buf.observationBufferTokens === "number" ? buf.observationBufferTokens : 0;
  if (observationBufferTokens <= 0) {
    return undefined;
  }
  return {
    observationBufferTokens,
    observationBufferActivation:
      typeof buf.observationBufferActivation === "number" ? buf.observationBufferActivation : 0.8,
    reflectionBufferActivation:
      typeof buf.reflectionBufferActivation === "number" ? buf.reflectionBufferActivation : 0.5,
  };
}

export interface ResolvedOmConfig {
  observeModel: Model;
  observeApiKey: string;
  observeThinkingLevel?: ThinkingLevel | undefined;
  reflectModel: Model;
  reflectApiKey: string;
  reflectThinkingLevel?: ThinkingLevel | undefined;
  thresholds: ObservationalMemoryThresholds;
  buffering?: ObservationalMemoryBuffering | undefined;
  tokenCounter: TokenCounter;
  instruction?: string | undefined;
}

let tokenCounterSingleton: TokenCounter | null = null;

function getTokenCounter(): TokenCounter {
  if (!tokenCounterSingleton) {
    tokenCounterSingleton = new TokenCounterImpl();
  }
  return tokenCounterSingleton;
}

/**
 * Build observational-memory config from profiles + settings.
 *
 * Returns `undefined` when OM is disabled or the mode resolution fails.
 * The runner assembles per-run fields (storage, sessionId, etc.) into
 * the full `ObservationalMemoryDeps` at run time.
 */
export function resolveOmConfig(
  ctx: ServerContext,
  session: { id: string; kind: string; projectId: string; profileId: string | null },
): ResolvedOmConfig | undefined {
  const omSettings = readOmSettings(ctx);
  if (!omSettings) {
    return undefined;
  }

  const profiles = ctx.profiles.read();
  const activeId = session.profileId ?? profiles.defaultProfile;

  let observeRef;
  try {
    observeRef = resolveModelRef(profiles, session.profileId, "observe");
  } catch {
    ctx.log?.agent.warn("om: failed to resolve observe mode, falling back to default", {
      profileId: activeId,
    });
    return undefined;
  }

  let reflectRef;
  try {
    reflectRef = resolveModelRef(profiles, session.profileId, "reflect");
  } catch {
    ctx.log?.agent.warn("om: failed to resolve reflect mode, falling back to default", {
      profileId: activeId,
    });
    return undefined;
  }

  const observeApiKey = ctx.auth.getApiKey(observeRef.provider);
  if (!observeApiKey) {
    ctx.log?.agent.warn("om: no API key for observe provider", {
      provider: observeRef.provider,
    });
    return undefined;
  }

  const reflectApiKey = ctx.auth.getApiKey(reflectRef.provider);
  if (!reflectApiKey) {
    ctx.log?.agent.warn("om: no API key for reflect provider", {
      provider: reflectRef.provider,
    });
    return undefined;
  }

  const observeModel = getModel(observeRef.provider, observeRef.model);
  const reflectModel = getModel(reflectRef.provider, reflectRef.model);

  const thresholds: ObservationalMemoryThresholds = {
    observation: omSettings.observationThreshold ?? DEFAULT_OBSERVATION_THRESHOLD,
    reflection: omSettings.reflectionThreshold ?? DEFAULT_REFLECTION_THRESHOLD,
  };

  const buffering = readBufferingSettings(ctx);

  return {
    observeModel,
    observeApiKey,
    ...(observeRef.thinkingLevel !== "off"
      ? { observeThinkingLevel: observeRef.thinkingLevel as ThinkingLevel }
      : {}),
    reflectModel,
    reflectApiKey,
    ...(reflectRef.thinkingLevel !== "off"
      ? { reflectThinkingLevel: reflectRef.thinkingLevel as ThinkingLevel }
      : {}),
    thresholds,
    ...(buffering ? { buffering } : {}),
    tokenCounter: getTokenCounter(),
    ...(omSettings.instruction !== undefined ? { instruction: omSettings.instruction } : {}),
  };
}
