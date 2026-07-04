import type { Model, ThinkingLevel } from "@sakti-code/llm";
import { getModel } from "@sakti-code/llm";
import type {
  TokenCounter,
  ObservationalMemoryThresholds,
  ObservationalMemoryBuffering,
  ObservationalMemoryScope,
} from "@sakti-code/agent";
import { TokenCounter as TokenCounterImpl } from "@sakti-code/agent";
import type { ServerContext } from "../../context.ts";
import { parseOmSettings } from "./observational-memory-settings.ts";
import { resolveModelRef } from "../../lib/profile-resolver.ts";

const DEFAULT_OBSERVATION_THRESHOLD = 30_000;
const DEFAULT_REFLECTION_THRESHOLD = 40_000;
const DEFAULT_OBSERVATION_BUFFER_ACTIVATION = 0.8;
const DEFAULT_REFLECTION_BUFFER_ACTIVATION = 0.5;

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
  scope: ObservationalMemoryScope;
  instruction?: string | undefined;
}

/**
 * Construct a TokenCounter scoped to the observe model's provider so image
 * token estimation uses the right provider table (Anthropic/Google/OpenAI)
 * instead of the OpenAI/default fallback. Per-run, not cached — correctness
 * over the micro-savings of a shared instance.
 */
function getTokenCounter(observeModel: Model): TokenCounter {
  return new TokenCounterImpl({
    model: { provider: observeModel.provider, modelId: observeModel.id },
  });
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
  const raw = ctx.settingsFile.read() as Record<string, unknown>;
  const omSettings = parseOmSettings(raw);
  if (!omSettings) {
    return undefined;
  }

  // Intake children never run their own OM — they read the project's
  // resource-scope OM read-only (the main intake's memory). Only missions
  // observe their own thread. Graduation writes the project OM (Phase 2).
  if (session.kind === "intake") {
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

  const buffering: ObservationalMemoryBuffering | undefined = omSettings.buffering
    ? {
        observationBufferTokens: omSettings.buffering.observationBufferTokens,
        observationBufferActivation:
          omSettings.buffering.observationBufferActivation ?? DEFAULT_OBSERVATION_BUFFER_ACTIVATION,
        reflectionBufferActivation:
          omSettings.buffering.reflectionBufferActivation ?? DEFAULT_REFLECTION_BUFFER_ACTIVATION,
      }
    : undefined;

  return {
    observeModel,
    observeApiKey,
    ...(observeRef.thinkingLevel !== "off"
      ? { observeThinkingLevel: observeRef.thinkingLevel }
      : {}),
    reflectModel,
    reflectApiKey,
    ...(reflectRef.thinkingLevel !== "off"
      ? { reflectThinkingLevel: reflectRef.thinkingLevel }
      : {}),
    thresholds,
    ...(buffering ? { buffering } : {}),
    tokenCounter: getTokenCounter(observeModel),
    scope: omSettings.scope ?? "thread",
    ...(ctx.log?.agent === undefined ? {} : { logger: ctx.log.agent }),
    ...(omSettings.instruction !== undefined ? { instruction: omSettings.instruction } : {}),
  };
}
