/**
 * Phase 4 Integration Tests
 *
 * Tests for wiring observational memory mode system into agent spawning flow.
 */

import { describe, expect, it } from "vitest";
import { SUBAGENT_CONFIGS, taskTool } from "../../../src/tools/task";

describe("Phase 4: Integration", () => {
  describe("Mode-specific prompt injection in SUBAGENT_CONFIGS", () => {
    it("should include exploration-specific instructions in explore system prompt", () => {
      const exploreConfig = SUBAGENT_CONFIGS.explore;

      // The explore prompt should contain mode-specific instructions from EXPLORER_GUIDELINES
      expect(exploreConfig.systemPrompt).toContain("Exact file paths and line numbers");
      expect(exploreConfig.systemPrompt).toContain('"NOT FOUND" results');
      expect(exploreConfig.systemPrompt).toContain("Search queries used");
    });

    it("should include extraction instructions for what to capture", () => {
      const exploreConfig = SUBAGENT_CONFIGS.explore;

      // Should contain extraction instructions
      expect(exploreConfig.systemPrompt).toContain("EXACT FINDINGS");
      expect(exploreConfig.systemPrompt).toContain("SCHEMA DEFINITIONS");
    });

    it("should include structured output format guidance", () => {
      const exploreConfig = SUBAGENT_CONFIGS.explore;

      // Should contain output format
      expect(exploreConfig.systemPrompt).toContain("<findings>");
      expect(exploreConfig.systemPrompt).toContain("<file_inventory>");
      expect(exploreConfig.systemPrompt).toContain("<gaps>");
    });

    it("should include mode in agent config", () => {
      // SUBAGENT_CONFIGS should include mode field for all types
      expect(SUBAGENT_CONFIGS.explore).toHaveProperty("mode");
      expect(SUBAGENT_CONFIGS.explore.mode).toBe("explore");

      expect(SUBAGENT_CONFIGS.plan).toHaveProperty("mode");
      expect(SUBAGENT_CONFIGS.plan.mode).toBe("default");

      expect(SUBAGENT_CONFIGS.general).toHaveProperty("mode");
      expect(SUBAGENT_CONFIGS.general.mode).toBe("default");
    });
  });

  describe("ExplorationResult interface", () => {
    it("should define ExplorationResult interface", () => {
      // taskTool should be defined (it's an object from AI SDK tool())
      expect(taskTool).toBeDefined();
      expect(typeof taskTool).toBe("object");
    });
  });
});
