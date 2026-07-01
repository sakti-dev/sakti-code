import { describe, expect, it } from "vite-plus/test";

import { parseOmSettings } from "../observational-memory-settings.ts";

describe("parseOmSettings", () => {
  it("returns undefined when absent", () => {
    expect(parseOmSettings({})).toBeUndefined();
  });

  it("returns undefined when disabled", () => {
    expect(parseOmSettings({ observationalMemory: { enabled: false } })).toBeUndefined();
  });

  it("accepts a minimal enabled-only config", () => {
    const result = parseOmSettings({ observationalMemory: { enabled: true } });
    expect(result?.enabled).toBe(true);
    expect(result?.observationThreshold).toBeUndefined();
  });

  it("accepts a full config including buffering", () => {
    const result = parseOmSettings({
      observationalMemory: {
        enabled: true,
        observationThreshold: 30000,
        reflectionThreshold: 40000,
        instruction: "be terse",
        buffering: {
          observationBufferTokens: 0.2,
          observationBufferActivation: 0.8,
          reflectionBufferActivation: 0.5,
        },
      },
    });
    expect(result?.enabled).toBe(true);
    expect(result?.observationThreshold).toBe(30000);
    expect(result?.buffering?.observationBufferTokens).toBe(0.2);
  });

  it("rejects a typo'd threshold key (I4)", () => {
    expect(() =>
      parseOmSettings({ observationalMemory: { enabled: true, obserationThreshold: 100 } }),
    ).toThrow();
  });

  it("rejects a non-number observationThreshold", () => {
    expect(() =>
      parseOmSettings({ observationalMemory: { enabled: true, observationThreshold: "30000" } }),
    ).toThrow();
  });

  it("rejects a non-boolean enabled", () => {
    expect(() => parseOmSettings({ observationalMemory: { enabled: "yes" } })).toThrow();
  });

  it("rejects buffering without required observationBufferTokens", () => {
    expect(() =>
      parseOmSettings({
        observationalMemory: { enabled: true, buffering: { observationBufferActivation: 0.8 } },
      }),
    ).toThrow();
  });
});
