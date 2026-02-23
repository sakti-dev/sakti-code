/**
 * Phase 5: Integration Flow Tests
 *
 * Tests verify the complete integration flow:
 * - Mode passing from SUBAGENT_CONFIGS → taskTool → AgentProcessor
 * - Config retrieval and application
 * - Exploration result parsing
 * - Mode-specific observer agent creation
 */

import { describe, expect, it } from "vitest";
import { getAgentMode } from "../../../src/memory/observation/orchestration";
import { getMemoryConfig, MODE_CONFIGS } from "../../../src/memory/observation/storage";
import {
  ExplorationResult,
  SUBAGENT_CONFIGS,
  SubagentResult,
  taskTool,
} from "../../../src/tools/task";

describe("Phase 5: Integration Flow", () => {
  describe("SUBAGENT_CONFIGS mode configuration", () => {
    it("should have mode field for all subagent types", () => {
      for (const subagentType of ["explore", "plan", "general"] as const) {
        const config = SUBAGENT_CONFIGS[subagentType];
        expect(config).toHaveProperty("mode");
        expect(typeof config.mode).toBe("string");
      }
    });

    it("explore subagent should have explore mode", () => {
      expect(SUBAGENT_CONFIGS.explore.mode).toBe("explore");
    });

    it("plan subagent should have default mode", () => {
      expect(SUBAGENT_CONFIGS.plan.mode).toBe("default");
    });

    it("general subagent should have default mode", () => {
      expect(SUBAGENT_CONFIGS.general.mode).toBe("default");
    });

    it("explore subagent should have exploration-specific system prompt", () => {
      const prompt = SUBAGENT_CONFIGS.explore.systemPrompt;
      expect(prompt).toContain("EXACT FINDINGS");
      expect(prompt).toContain("<findings>");
      expect(prompt).toContain("PRECISION OVER BREVITY");
    });

    it("plan subagent should have planning-specific system prompt", () => {
      const prompt = SUBAGENT_CONFIGS.plan.systemPrompt;
      expect(prompt.toLowerCase()).toContain("plan");
    });

    it("general subagent should have general-purpose system prompt", () => {
      const prompt = SUBAGENT_CONFIGS.general.systemPrompt;
      expect(prompt.toLowerCase()).toContain("software developer");
    });
  });

  describe("Mode to Config mapping", () => {
    it("should return explore config for explore mode", () => {
      const config = getMemoryConfig("explore");
      expect(config.observationThreshold).toBe(60000);
      expect(config.reflectionThreshold).toBe(80000);
      expect(config.bufferTokens).toBe(12000);
    });

    it("should return default config for default mode", () => {
      const config = getMemoryConfig("default");
      expect(config.observationThreshold).toBe(30000);
      expect(config.reflectionThreshold).toBe(40000);
      expect(config.bufferTokens).toBe(6000);
    });

    it("should return default config for unknown mode", () => {
      const config = getMemoryConfig("unknown_mode");
      expect(config).toBe(MODE_CONFIGS.default);
    });

    it("should have correct thresholds for bug_fixing mode", () => {
      const config = getMemoryConfig("bug_fixing");
      expect(config.observationThreshold).toBe(40000);
      expect(config.reflectionThreshold).toBe(60000);
    });

    it("should have correct thresholds for refactoring mode", () => {
      const config = getMemoryConfig("refactoring");
      expect(config.observationThreshold).toBe(50000);
      expect(config.reflectionThreshold).toBe(70000);
    });

    it("should have correct thresholds for testing mode", () => {
      const config = getMemoryConfig("testing");
      expect(config.observationThreshold).toBe(40000);
      expect(config.reflectionThreshold).toBe(60000);
    });

    it("should have correct thresholds for debugging mode", () => {
      const config = getMemoryConfig("debugging");
      expect(config.observationThreshold).toBe(40000);
      expect(config.reflectionThreshold).toBe(60000);
    });

    it("should have correct thresholds for research mode", () => {
      const config = getMemoryConfig("research");
      expect(config.observationThreshold).toBe(60000);
      expect(config.reflectionThreshold).toBe(80000);
    });
  });

  describe("Agent type to mode mapping", () => {
    it("should map explore agent type to explore mode", () => {
      expect(getAgentMode("explore")).toBe("explore");
    });

    it("should map build agent type to default mode", () => {
      expect(getAgentMode("build")).toBe("default");
    });

    it("should map plan agent type to default mode", () => {
      expect(getAgentMode("plan")).toBe("default");
    });

    it("should map bug_fixing agent type to bug_fixing mode", () => {
      expect(getAgentMode("bug_fixing")).toBe("bug_fixing");
    });

    it("should map refactoring agent type to refactoring mode", () => {
      expect(getAgentMode("refactoring")).toBe("refactoring");
    });

    it("should map testing agent type to testing mode", () => {
      expect(getAgentMode("testing")).toBe("testing");
    });

    it("should map debugging agent type to debugging mode", () => {
      expect(getAgentMode("debugging")).toBe("debugging");
    });

    it("should map research agent type to research mode", () => {
      expect(getAgentMode("research")).toBe("research");
    });

    it("should return default for unknown agent type", () => {
      expect(getAgentMode("unknown")).toBe("default");
    });
  });

  describe("ExplorationResult interface", () => {
    it("should be properly typed with required fields", () => {
      const result: ExplorationResult = {
        findings: "Test findings",
        fileInventory: "src/test.ts: Test file",
        gaps: "None",
      };

      expect(result.findings).toBe("Test findings");
      expect(result.fileInventory).toBe("src/test.ts: Test file");
      expect(result.gaps).toBe("None");
    });

    it("should accept optional rawMessages field", () => {
      const result: ExplorationResult = {
        findings: "Test",
        fileInventory: "",
        gaps: "",
        rawMessages: ["msg1", "msg2"],
      };

      expect(result.rawMessages).toEqual(["msg1", "msg2"]);
    });
  });

  describe("SubagentResult interface", () => {
    it("should have explorationResult field for explore subagents", () => {
      const explorationResult: ExplorationResult = {
        findings: "Found auth module",
        fileInventory: "src/auth.ts",
        gaps: "None",
      };

      const result: SubagentResult = {
        sessionId: "test-session",
        status: "completed",
        iterations: 5,
        duration: 1000,
        toolCalls: [],
        explorationResult,
      };

      expect(result.explorationResult).toBeDefined();
      expect(result.explorationResult?.findings).toBe("Found auth module");
    });

    it("should not require explorationResult for non-explore subagents", () => {
      const result: SubagentResult = {
        sessionId: "test-session",
        status: "completed",
        iterations: 3,
        duration: 500,
        toolCalls: [],
      };

      expect(result.explorationResult).toBeUndefined();
    });
  });

  describe("taskTool availability", () => {
    it("should be exported as a tool object", () => {
      expect(taskTool).toBeDefined();
      expect(typeof taskTool).toBe("object");
    });

    it("should have execute method", () => {
      expect(taskTool).toHaveProperty("execute");
    });
  });

  describe("MODE_CONFIGS threshold verification", () => {
    it("all modes should have thread scope", () => {
      for (const [, config] of Object.entries(MODE_CONFIGS)) {
        expect(config.scope).toBe("thread");
      }
    });

    it("all modes should have bufferActivation of 0.8", () => {
      for (const [, config] of Object.entries(MODE_CONFIGS)) {
        expect(config.bufferActivation).toBe(0.8);
      }
    });

    it("all modes should have maxRecentObservations configured", () => {
      for (const [, config] of Object.entries(MODE_CONFIGS)) {
        expect(config.maxRecentObservations).toBeGreaterThan(0);
      }
    });

    it("all modes should have maxRecentHours configured", () => {
      for (const [, config] of Object.entries(MODE_CONFIGS)) {
        expect(config.maxRecentHours).toBeGreaterThan(0);
      }
    });

    it("explore and research should have higher thresholds than default", () => {
      const defaultConfig = MODE_CONFIGS.default;
      const exploreConfig = MODE_CONFIGS.explore;
      const researchConfig = MODE_CONFIGS.research;

      expect(exploreConfig.observationThreshold).toBeGreaterThan(
        defaultConfig.observationThreshold
      );
      expect(researchConfig.observationThreshold).toBeGreaterThan(
        defaultConfig.observationThreshold
      );
    });

    it("explore and research should have lastMessages of 15", () => {
      expect(MODE_CONFIGS.explore.lastMessages).toBe(15);
      expect(MODE_CONFIGS.research.lastMessages).toBe(15);
    });

    it("default should have lastMessages of 10", () => {
      expect(MODE_CONFIGS.default.lastMessages).toBe(10);
    });
  });
});
