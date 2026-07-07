import Type from "typebox";
import { Value } from "typebox/value";

const omBufferingSchema = Type.Object({
  observationBufferTokens: Type.Optional(Type.Number()),
  observationBufferActivation: Type.Optional(Type.Number()),
  reflectionBufferActivation: Type.Optional(Type.Number()),
});

export const OmSettingsSchema = Type.Object({
  observationThreshold: Type.Optional(Type.Number()),
  reflectionThreshold: Type.Optional(Type.Number()),
  instruction: Type.Optional(Type.String()),
  scope: Type.Optional(Type.Union([Type.Literal("thread"), Type.Literal("resource")])),
  buffering: Type.Optional(omBufferingSchema),
});

export interface ParsedOmSettings {
  observationThreshold?: number;
  reflectionThreshold?: number;
  instruction?: string;
  scope?: "thread" | "resource";
  buffering?: {
    observationBufferTokens?: number;
    observationBufferActivation?: number;
    reflectionBufferActivation?: number;
  };
}

/**
 * Parse + validate the `observationalMemory` tuning block from settings.json.
 *
 * OM is always on — there is no on/off toggle. This only parses optional
 * tuning (thresholds, scope, buffering, instruction). Returns defaults when
 * the block is absent. Throws on a present-but-malformed value (wrong type).
 * Unknown/stale keys are silently ignored so renaming or removing a setting
 * can't crash the app.
 */
export function parseOmSettings(raw: Record<string, unknown>): ParsedOmSettings {
  const om = raw.observationalMemory;
  if (!om || typeof om !== "object") return {};
  const omRecord = om as Record<string, unknown>;
  Value.Assert(OmSettingsSchema, omRecord);
  return Value.Decode(OmSettingsSchema, omRecord);
}
