import Type from "typebox";
import { Value } from "typebox/value";

const omBufferingSchema = Type.Object({
  observationBufferTokens: Type.Number(),
  observationBufferActivation: Type.Optional(Type.Number()),
  reflectionBufferActivation: Type.Optional(Type.Number()),
});

export const OmSettingsSchema = Type.Object({
  enabled: Type.Boolean(),
  observationThreshold: Type.Optional(Type.Number()),
  reflectionThreshold: Type.Optional(Type.Number()),
  instruction: Type.Optional(Type.String()),
  scope: Type.Optional(Type.Union([Type.Literal("thread"), Type.Literal("resource")])),
  buffering: Type.Optional(omBufferingSchema),
});

export interface ParsedOmSettings {
  enabled: boolean;
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
  "enabled",
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
 * Resolve the OM scope from raw settings, even when OM is disabled.
 * Used by the read-only injection path to look up existing records
 * with the correct lookup key.
 */
export function resolveOmScope(raw: Record<string, unknown>): "thread" | "resource" {
  const om = raw.observationalMemory;
  if (om && typeof om === "object") {
    const scope = (om as Record<string, unknown>).scope;
    if (scope === "resource") return "resource";
  }
  return "thread";
}

/**
 * Parse + validate the `observationalMemory` block from settings.json.
 *
 * Returns `{ enabled: true }` when OM is absent (default-on).
 * Returns `undefined` only when explicitly disabled (`enabled: false`).
 * Throws on a present-but-malformed block — including unknown/typo'd keys.
 */
export function parseOmSettings(raw: Record<string, unknown>): ParsedOmSettings | undefined {
  const om = raw.observationalMemory;
  if (!om || typeof om !== "object") return { enabled: true };
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
  const decoded = Value.Decode(OmSettingsSchema, omRecord);
  if (!decoded.enabled) return undefined;
  return decoded;
}
