import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_SESSION_SETTINGS,
  parseSessionSettings,
} from "../session-settings.ts";

describe("DEFAULT_SESSION_SETTINGS", () => {
  it("includes all keys used by the runner", () => {
    expect(DEFAULT_SESSION_SETTINGS.auto_compaction).toBe("false");
    expect(DEFAULT_SESSION_SETTINGS.auto_retry).toBe("true");
    expect(DEFAULT_SESSION_SETTINGS.base_delay_ms).toBe("2000");
    expect(DEFAULT_SESSION_SETTINGS.follow_up_mode).toBe("all");
    expect(DEFAULT_SESSION_SETTINGS.max_retries).toBe("3");
    expect(DEFAULT_SESSION_SETTINGS.steering_mode).toBe("all");
    expect(DEFAULT_SESSION_SETTINGS.thinking_level).toBe("off");
  });
});

describe("parseSessionSettings", () => {
  it("returns defaults when raw is empty", () => {
    const s = parseSessionSettings({});
    expect(s.agent()).toBe("build");
    expect(s.autoCompaction()).toBe(false);
    expect(s.autoRetry()).toBe(true);
    expect(s.editMode()).toBe("hashline");
    expect(s.followUpMode()).toBe("all");
    expect(s.steeringMode()).toBe("all");
    expect(s.thinkingLevelOverride()).toBeNull();
  });

  it("honors overrides", () => {
    const s = parseSessionSettings({
      agent: "explore",
      auto_compaction: "true",
      auto_retry: "false",
      base_delay_ms: "500",
      edit_mode: "replace",
      follow_up_mode: "one-at-a-time",
      max_retries: "5",
      steering_mode: "one-at-a-time",
      thinking_level: "high",
    });
    expect(s.agent()).toBe("explore");
    expect(s.autoCompaction()).toBe(true);
    expect(s.autoRetry()).toBe(false);
    expect(s.editMode()).toBe("replace");
    expect(s.followUpMode()).toBe("one-at-a-time");
    expect(s.steeringMode()).toBe("one-at-a-time");
    expect(s.thinkingLevelOverride()).toBe("high");
  });

  it("editMode falls back to hashline for unknown values", () => {
    expect(parseSessionSettings({ edit_mode: "garbage" }).editMode()).toBe(
      "hashline"
    );
  });

  it("thinkingLevelOverride returns null for 'off' (delegate to profile)", () => {
    expect(
      parseSessionSettings({ thinking_level: "off" }).thinkingLevelOverride()
    ).toBeNull();
  });

  it("retry() parses base_delay_ms + max_retries + auto_retry", () => {
    const s = parseSessionSettings({
      auto_retry: "false",
      base_delay_ms: "1500",
      max_retries: "7",
    });
    expect(s.retry()).toEqual({
      enabled: false,
      baseDelayMs: 1500,
      maxRetries: 7,
    });
  });

  it("retry() falls back to defaults for missing keys", () => {
    const s = parseSessionSettings({});
    expect(s.retry()).toEqual({
      enabled: true,
      baseDelayMs: 2000,
      maxRetries: 3,
    });
  });

  it("compaction() delegates to parseCompactionSettings", () => {
    const s = parseSessionSettings({ auto_compaction: "true" });
    expect(s.compaction().enabled).toBe(true);
    expect(s.compaction().reserveTokens).toBe(16_384);
    expect(s.compaction().keepRecentTokens).toBe(20_000);
  });

  it("compaction() reflects disabled by default (DEFAULT_SESSION_SETTINGS has auto_compaction=false)", () => {
    const s = parseSessionSettings({});
    expect(s.compaction().enabled).toBe(false);
  });
});
