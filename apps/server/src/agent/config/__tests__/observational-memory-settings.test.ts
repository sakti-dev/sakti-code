import { describe, expect, it } from "vite-plus/test";

import { parseOmSettings } from "../observational-memory-settings.ts";

describe("parseOmSettings", () => {
  it("returns defaults when the block is absent", () => {
    const result = parseOmSettings({});
    expect(result.observationThreshold).toBeUndefined();
    expect(result.scope).toBeUndefined();
  });

  it("accepts an empty observationalMemory block", () => {
    const result = parseOmSettings({ observationalMemory: {} });
    expect(result.observationThreshold).toBeUndefined();
  });

  it("accepts a full config including buffering", () => {
    const result = parseOmSettings({
      observationalMemory: {
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
    expect(result.observationThreshold).toBe(30000);
    expect(result.buffering?.observationBufferTokens).toBe(0.2);
  });

  it("ignores unknown/typo'd keys without crashing", () => {
    const result = parseOmSettings({ observationalMemory: { obserationThreshold: 100 } });
    expect(result.observationThreshold).toBeUndefined();
  });

  it("rejects a non-number observationThreshold", () => {
    expect(() =>
      parseOmSettings({ observationalMemory: { observationThreshold: "30000" } }),
    ).toThrow();
  });

  it("ignores the removed `enabled` key (stale setting)", () => {
    const result = parseOmSettings({ observationalMemory: { enabled: true } });
    expect(result.observationThreshold).toBeUndefined();
  });

  it("accepts buffering without observationBufferTokens (optional, defaults in resolveOmConfig)", () => {
    const result = parseOmSettings({
      observationalMemory: { buffering: { observationBufferActivation: 0.8 } },
    });
    expect(result.buffering?.observationBufferTokens).toBeUndefined();
    expect(result.buffering?.observationBufferActivation).toBe(0.8);
  });

  it("accepts scope: 'resource'", () => {
    const result = parseOmSettings({ observationalMemory: { scope: "resource" } });
    expect(result.scope).toBe("resource");
  });

  it("scope is absent by default (deps builder defaults to 'thread')", () => {
    const result = parseOmSettings({ observationalMemory: {} });
    expect(result.scope).toBeUndefined();
  });

  it("rejects an invalid scope value", () => {
    expect(() => parseOmSettings({ observationalMemory: { scope: "banana" } })).toThrow();
  });
});
