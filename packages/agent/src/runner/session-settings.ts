import { parseRetrySettings, type RetrySettings } from "../memory/compaction/retry-loop.ts";
import type { QueueMode, ThinkingLevel } from "../types.ts";

/**
 * String literal mirroring `@sakti-code/tools`'s `EditMode`. Defined locally
 * to avoid a circular dep (tools → agent). The server's `EditMode` is
 * structurally identical and assignable.
 */
export type EditMode = "replace" | "hashline";

/**
 * Default session settings (pi-faithful). Mirrors the keys previously inlined
 * in `apps/server/src/agent/runner.ts:DEFAULT_SETTINGS`. Merged with the
 * per-session DB overrides inside {@link parseSessionSettings}.
 */
export const DEFAULT_SESSION_SETTINGS: Readonly<Record<string, string>> = {
  auto_retry: "true",
  // Exponential backoff base for application-level retry (2s → 4s → 8s).
  // Matches pi's coding-agent defaults (settings-manager.ts:807-813).
  base_delay_ms: "2000",
  follow_up_mode: "all",
  max_retries: "3",
  steering_mode: "all",
  thinking_level: "off",
};

/** Default agent name when none is selected for a session. */
export const DEFAULT_AGENT_NAME = "build";

export interface SessionSettings {
  agent(): string;
  autoRetry(): boolean;
  editMode(): EditMode;
  followUpMode(): QueueMode;
  readonly raw: Readonly<Record<string, string>>;
  retry(): RetrySettings;
  steeringMode(): QueueMode;
  /**
   * null = no per-session override; the caller should fall back to the
   * profile default. "off" also returns null (off is the absence of
   * thinking).
   */
  thinkingLevelOverride(): ThinkingLevel | null;
}

/**
 * Build a typed view over a session-settings map. The caller (server) supplies
 * the raw KV rows from the DB; defaults are merged in here so callers don't
 * have to. Accessors parse on demand — cheap because the maps are tiny.
 */
export function parseSessionSettings(raw: Record<string, string>): SessionSettings {
  const merged: Record<string, string> = {
    ...DEFAULT_SESSION_SETTINGS,
    ...raw,
  };
  return {
    raw: merged,
    agent: () => merged.agent ?? DEFAULT_AGENT_NAME,
    autoRetry: () => merged.auto_retry !== "false",
    editMode: () => (merged.edit_mode === "replace" ? "replace" : "hashline"),
    followUpMode: () => (merged.follow_up_mode === "one-at-a-time" ? "one-at-a-time" : "all"),
    steeringMode: () => (merged.steering_mode === "one-at-a-time" ? "one-at-a-time" : "all"),
    retry: () => parseRetrySettings(merged),
    thinkingLevelOverride: () => {
      const v = merged.thinking_level;
      if (v === undefined || v === "off") {
        return null;
      }
      return v as ThinkingLevel;
    },
  };
}
