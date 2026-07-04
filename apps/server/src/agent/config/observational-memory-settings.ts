import Type from "typebox";
import { Value } from "typebox/value";

const omBufferingSchema = Type.Object({
  observationBufferTokens: Type.Number(),
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
    observationBufferTokens: number;
    observationBufferActivation?: number;
    reflectionBufferActivation?: number;
  };
}

const OM_ALLOWED_KEYS = new Set([
  "observationThreshold",
  "reflectionThreshold",
  "instruction",
  "scope",
  "buffering",
]);

const OM_BUFFERING_ALLOWED_KEYS = new Set([
  "observationBufferTokens",
  "observationBufferActivation",
  "reflectionBufferActivation",
]);

function assertNoUnknownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`Unknown setting "${path}.${key}" — check for typos`);
    }
  }
}

/**
 * Parse + validate the `observationalMemory` tuning block from settings.json.
 *
 * OM is always on — there is no on/off toggle. This only parses optional
 * tuning (thresholds, scope, buffering, instruction). Returns defaults when
 * the block is absent. Throws on a present-but-malformed block, including
 * unknown/typo'd keys (and the now-removed `enabled` key).
 */
export function parseOmSettings(raw: Record<string, unknown>): ParsedOmSettings {
  const om = raw.observationalMemory;
  if (!om || typeof om !== "object") return {};
  const omRecord = om as Record<string, unknown>;
  assertNoUnknownKeys(omRecord, OM_ALLOWED_KEYS, "observationalMemory");
  if (omRecord.buffering && typeof omRecord.buffering === "object") {
    assertNoUnknownKeys(
      omRecord.buffering as Record<string, unknown>,
      OM_BUFFERING_ALLOWED_KEYS,
      "observationalMemory.buffering",
    );
  }
  Value.Assert(OmSettingsSchema, omRecord);
  return Value.Decode(OmSettingsSchema, omRecord);
}
