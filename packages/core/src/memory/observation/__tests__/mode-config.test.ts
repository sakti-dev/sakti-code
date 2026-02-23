/**
 * Tests for Mode-Specific Memory Config - TDD
 *
 * Tests verify:
 * - MODE_CONFIGS has configs for all agent modes
 * - getMemoryConfig returns correct config for each mode
 * - Threshold values match the plan spec (explore: 60k, bug_fixing: 40k, etc.)
 */

import {
  MODE_CONFIGS,
  getMemoryConfig,
  type ObservationalMemoryModeConfig,
} from "@/memory/observation/storage";
import { describe, expect, it } from "vitest";

describe("Mode-Specific Memory Config", () => {
  describe("MODE_CONFIGS", () => {
    it("should have default mode config", () => {
      expect(MODE_CONFIGS.default).toBeDefined();
    });

    it("should have explore mode config with 60k threshold", () => {
      const config = MODE_CONFIGS.explore;
      expect(config.observationThreshold).toBe(60000);
      expect(config.reflectionThreshold).toBe(80000);
      expect(config.bufferTokens).toBe(12000);
    });

    it("should have bug_fixing mode config with 40k threshold", () => {
      const config = MODE_CONFIGS.bug_fixing;
      expect(config.observationThreshold).toBe(40000);
      expect(config.reflectionThreshold).toBe(60000);
      expect(config.bufferTokens).toBe(8000);
    });

    it("should have refactoring mode config with 50k threshold", () => {
      const config = MODE_CONFIGS.refactoring;
      expect(config.observationThreshold).toBe(50000);
      expect(config.reflectionThreshold).toBe(70000);
      expect(config.bufferTokens).toBe(10000);
    });

    it("should have testing mode config with 40k threshold", () => {
      const config = MODE_CONFIGS.testing;
      expect(config.observationThreshold).toBe(40000);
      expect(config.reflectionThreshold).toBe(60000);
      expect(config.bufferTokens).toBe(8000);
    });

    it("should have debugging mode config with 40k threshold", () => {
      const config = MODE_CONFIGS.debugging;
      expect(config.observationThreshold).toBe(40000);
      expect(config.reflectionThreshold).toBe(60000);
      expect(config.bufferTokens).toBe(8000);
    });

    it("should have research mode config with 60k threshold", () => {
      const config = MODE_CONFIGS.research;
      expect(config.observationThreshold).toBe(60000);
      expect(config.reflectionThreshold).toBe(80000);
      expect(config.bufferTokens).toBe(12000);
    });

    it("should have thread scope for all modes", () => {
      for (const mode of Object.keys(MODE_CONFIGS)) {
        expect(MODE_CONFIGS[mode as keyof typeof MODE_CONFIGS].scope).toBe("thread");
      }
    });

    it("should have lastMessages configured", () => {
      expect(MODE_CONFIGS.default.lastMessages).toBe(10);
      expect(MODE_CONFIGS.explore.lastMessages).toBe(15);
      expect(MODE_CONFIGS.bug_fixing.lastMessages).toBe(12);
    });
  });

  describe("getMemoryConfig", () => {
    it("should return default config for default mode", () => {
      const config = getMemoryConfig("default");
      expect(config).toBe(MODE_CONFIGS.default);
    });

    it("should return explore config for explore mode", () => {
      const config = getMemoryConfig("explore");
      expect(config).toBe(MODE_CONFIGS.explore);
      expect(config.observationThreshold).toBe(60000);
    });

    it("should return bug_fixing config for bug_fixing mode", () => {
      const config = getMemoryConfig("bug_fixing");
      expect(config).toBe(MODE_CONFIGS.bug_fixing);
      expect(config.observationThreshold).toBe(40000);
    });

    it("should return refactoring config for refactoring mode", () => {
      const config = getMemoryConfig("refactoring");
      expect(config).toBe(MODE_CONFIGS.refactoring);
      expect(config.observationThreshold).toBe(50000);
    });

    it("should return testing config for testing mode", () => {
      const config = getMemoryConfig("testing");
      expect(config).toBe(MODE_CONFIGS.testing);
      expect(config.observationThreshold).toBe(40000);
    });

    it("should return debugging config for debugging mode", () => {
      const config = getMemoryConfig("debugging");
      expect(config).toBe(MODE_CONFIGS.debugging);
      expect(config.observationThreshold).toBe(40000);
    });

    it("should return research config for research mode", () => {
      const config = getMemoryConfig("research");
      expect(config).toBe(MODE_CONFIGS.research);
      expect(config.observationThreshold).toBe(60000);
    });

    it("should return default config for unknown mode", () => {
      const config = getMemoryConfig("unknown");
      expect(config).toBe(MODE_CONFIGS.default);
    });
  });

  describe("ObservationalMemoryModeConfig interface", () => {
    it("should have all required fields", () => {
      const config: ObservationalMemoryModeConfig = {
        observationThreshold: 30000,
        reflectionThreshold: 40000,
        bufferTokens: 6000,
        bufferActivation: 0.8,
        blockAfter: 7200,
        scope: "thread",
        lastMessages: 10,
        maxRecentObservations: 50,
        maxRecentHours: 24,
      };

      expect(config.observationThreshold).toBe(30000);
      expect(config.reflectionThreshold).toBe(40000);
      expect(config.bufferTokens).toBe(6000);
      expect(config.bufferActivation).toBe(0.8);
      expect(config.blockAfter).toBe(7200);
      expect(config.scope).toBe("thread");
      expect(config.lastMessages).toBe(10);
      expect(config.maxRecentObservations).toBe(50);
      expect(config.maxRecentHours).toBe(24);
    });
  });
});
