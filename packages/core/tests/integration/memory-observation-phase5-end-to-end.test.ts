/**
 * Phase 5: End-to-End Verification Tests
 *
 * Tests verify all phases work together correctly:
 * - Phase 1: Core Prompts - All prompts defined correctly
 * - Phase 2: Mode System - Configs and type system
 * - Phase 3: Additional Mode Prompts - All 6 additional modes
 * - Phase 4: Integration - Agent spawning with mode injection
 * - Phase 5: Testing - Complete verification
 */

import { describe, expect, it } from "vitest";
import { getAgentMode } from "../../../src/memory/observation/orchestration";
import { MODE_CONFIGS, getMemoryConfig } from "../../../src/memory/observation/storage";
import {
  BUGFIXING_COMPRESSION_GUIDANCE,
  DEBUGGING_COMPRESSION_GUIDANCE,
  EXPLORER_COMPRESSION_GUIDANCE,
  MODE_EXTRACTION_INSTRUCTIONS,
  MODE_PROMPTS,
  REFACTORING_COMPRESSION_GUIDANCE,
  RESEARCH_COMPRESSION_GUIDANCE,
  TESTING_COMPRESSION_GUIDANCE,
  type AgentMode,
} from "../../../src/prompts/memory/observer/modes";
import { SUBAGENT_CONFIGS } from "../../../src/tools/task";

describe("Phase 5: End-to-End Verification", () => {
  describe("Complete Mode System Coverage", () => {
    const allModes: AgentMode[] = [
      "default",
      "explore",
      "bug_fixing",
      "refactoring",
      "testing",
      "debugging",
      "research",
    ];

    it("all 7 modes should have complete prompt definitions", () => {
      for (const mode of allModes) {
        const prompts = MODE_PROMPTS[mode];
        expect(prompts, `MODE_PROMPTS.${mode} should exist`).toBeDefined();
        expect(prompts.extractionInstructions, `${mode} extractionInstructions`).toBeDefined();
        expect(prompts.outputFormat, `${mode} outputFormat`).toBeDefined();
        expect(prompts.guidelines, `${mode} guidelines`).toBeDefined();
        expect(prompts.compressionGuidance, `${mode} compressionGuidance`).toBeDefined();
      }
    });

    it("all 7 modes should have memory configs", () => {
      for (const mode of allModes) {
        const config = MODE_CONFIGS[mode];
        expect(config, `MODE_CONFIGS.${mode} should exist`).toBeDefined();
        expect(config.observationThreshold).toBeGreaterThan(0);
        expect(config.reflectionThreshold).toBeGreaterThan(0);
        expect(config.bufferTokens).toBeGreaterThan(0);
      }
    });

    it("all 7 modes should have extraction instructions", () => {
      for (const mode of allModes) {
        const instructions = MODE_EXTRACTION_INSTRUCTIONS[mode];
        expect(instructions, `MODE_EXTRACTION_INSTRUCTIONS.${mode}`).toBeDefined();
        expect(typeof instructions).toBe("string");
        expect(instructions.length).toBeGreaterThan(20);
      }
    });

    it("all 6 non-default modes should have compression guidance", () => {
      const guidances = [
        { mode: "explore", guidance: EXPLORER_COMPRESSION_GUIDANCE },
        { mode: "bug_fixing", guidance: BUGFIXING_COMPRESSION_GUIDANCE },
        { mode: "refactoring", guidance: REFACTORING_COMPRESSION_GUIDANCE },
        { mode: "testing", guidance: TESTING_COMPRESSION_GUIDANCE },
        { mode: "debugging", guidance: DEBUGGING_COMPRESSION_GUIDANCE },
        { mode: "research", guidance: RESEARCH_COMPRESSION_GUIDANCE },
      ];

      for (const { mode, guidance } of guidances) {
        expect(guidance[0], `${mode} compression level 0`).toBeDefined();
        expect(guidance[1], `${mode} compression level 1`).toBeDefined();
        expect(guidance[2], `${mode} compression level 2`).toBeDefined();
      }
    });
  });

  describe("Phase 1: Explore Mode Prompts (Core)", () => {
    it("explore mode has all required prompt components", () => {
      const explore = MODE_PROMPTS.explore;

      // Task Context
      expect(explore.taskContext).toContain("${explorationGoal}");
      expect(explore.taskContext).toContain("codebase");

      // Output Format
      expect(explore.outputFormat).toContain("<findings>");
      expect(explore.outputFormat).toContain("<file_inventory>");
      expect(explore.outputFormat).toContain("<gaps>");
      expect(explore.outputFormat).toContain("<current-task>");

      // Guidelines
      expect(explore.guidelines).toContain("PRECISION OVER BREVITY");
      expect(explore.guidelines).toContain("Exact file paths");

      // Context Instructions
      expect(explore.contextInstructions).toContain("parent");
    });

    it("explore mode has higher memory thresholds", () => {
      const exploreConfig = MODE_CONFIGS.explore;
      const defaultConfig = MODE_CONFIGS.default;

      expect(exploreConfig.observationThreshold).toBe(60000);
      expect(exploreConfig.observationThreshold).toBeGreaterThan(
        defaultConfig.observationThreshold
      );
      expect(exploreConfig.bufferTokens).toBe(12000);
    });
  });

  describe("Phase 2: Mode System Foundation", () => {
    it("AgentMode type covers all use cases", () => {
      // All agent types should map to valid modes
      const agentTypes = [
        "explore",
        "build",
        "plan",
        "bug_fixing",
        "refactoring",
        "testing",
        "debugging",
        "research",
      ];

      for (const agentType of agentTypes) {
        const mode = getAgentMode(agentType);
        expect(mode).toBeDefined();
        expect(MODE_PROMPTS[mode]).toBeDefined();
        expect(MODE_CONFIGS[mode]).toBeDefined();
      }
    });

    it("getMemoryConfig returns correct config for each mode", () => {
      expect(getMemoryConfig("default")).toBe(MODE_CONFIGS.default);
      expect(getMemoryConfig("explore")).toBe(MODE_CONFIGS.explore);
      expect(getMemoryConfig("bug_fixing")).toBe(MODE_CONFIGS.bug_fixing);
      expect(getMemoryConfig("refactoring")).toBe(MODE_CONFIGS.refactoring);
      expect(getMemoryConfig("testing")).toBe(MODE_CONFIGS.testing);
      expect(getMemoryConfig("debugging")).toBe(MODE_CONFIGS.debugging);
      expect(getMemoryConfig("research")).toBe(MODE_CONFIGS.research);
    });
  });

  describe("Phase 3: Additional Mode Prompts", () => {
    it("bug_fixing mode has error investigation focus", () => {
      const prompts = MODE_PROMPTS.bug_fixing;
      expect(prompts.taskContext).toContain("${bugDescription}");
      expect(prompts.outputFormat.toLowerCase()).toContain("error");
      expect(prompts.guidelines.toLowerCase()).toContain("root cause");
    });

    it("refactoring mode has interface change tracking", () => {
      const prompts = MODE_PROMPTS.refactoring;
      expect(prompts.taskContext).toContain("${refactorGoal}");
      expect(prompts.extractionInstructions).toContain("INTERFACE CHANGES");
      expect(prompts.guidelines.toLowerCase()).toContain("breaking");
    });

    it("testing mode has coverage tracking", () => {
      const prompts = MODE_PROMPTS.testing;
      expect(prompts.taskContext).toContain("${testingGoal}");
      expect(prompts.extractionInstructions).toContain("COVERAGE");
      expect(prompts.outputFormat.toLowerCase()).toContain("coverage");
    });

    it("debugging mode has variable state tracking", () => {
      const prompts = MODE_PROMPTS.debugging;
      expect(prompts.taskContext).toContain("${debugGoal}");
      expect(prompts.extractionInstructions).toContain("VARIABLES");
      expect(prompts.outputFormat.toLowerCase()).toContain("symptoms");
    });

    it("research mode has source tracking", () => {
      const prompts = MODE_PROMPTS.research;
      expect(prompts.taskContext).toContain("${researchGoal}");
      expect(prompts.extractionInstructions).toContain("SOURCES");
      expect(prompts.outputFormat.toLowerCase()).toContain("research_findings");
    });
  });

  describe("Phase 4: Integration", () => {
    it("SUBAGENT_CONFIGS has mode for all subagent types", () => {
      expect(SUBAGENT_CONFIGS.explore.mode).toBe("explore");
      expect(SUBAGENT_CONFIGS.plan.mode).toBe("default");
      expect(SUBAGENT_CONFIGS.general.mode).toBe("default");
    });

    it("explore subagent has mode-specific system prompt", () => {
      const explorePrompt = SUBAGENT_CONFIGS.explore.systemPrompt;
      expect(explorePrompt).toContain("EXACT FINDINGS");
      expect(explorePrompt).toContain("SCHEMA DEFINITIONS");
      expect(explorePrompt).toContain("PRECISION OVER BREVITY");
    });

    it("all subagents have different system prompts", () => {
      const explorePrompt = SUBAGENT_CONFIGS.explore.systemPrompt;
      const planPrompt = SUBAGENT_CONFIGS.plan.systemPrompt;
      const generalPrompt = SUBAGENT_CONFIGS.general.systemPrompt;

      expect(explorePrompt).not.toBe(planPrompt);
      expect(planPrompt).not.toBe(generalPrompt);
      expect(explorePrompt).not.toBe(generalPrompt);
    });
  });

  describe("Phase 5: Complete System Verification", () => {
    it("mode system is internally consistent", () => {
      // Every mode in AgentMode should have corresponding configs
      const modes: AgentMode[] = [
        "default",
        "explore",
        "bug_fixing",
        "refactoring",
        "testing",
        "debugging",
        "research",
      ];

      for (const mode of modes) {
        // Check prompts
        expect(MODE_PROMPTS[mode]).toBeDefined();

        // Check config
        expect(MODE_CONFIGS[mode]).toBeDefined();

        // Check extraction instructions
        expect(MODE_EXTRACTION_INSTRUCTIONS[mode]).toBeDefined();

        // Check getMemoryConfig returns correct config
        expect(getMemoryConfig(mode)).toBe(MODE_CONFIGS[mode]);
      }
    });

    it("exploration mode has highest thresholds for detailed findings", () => {
      const exploreThreshold = MODE_CONFIGS.explore.observationThreshold;
      const researchThreshold = MODE_CONFIGS.research.observationThreshold;
      const defaultThreshold = MODE_CONFIGS.default.observationThreshold;

      // Explore and research should have higher thresholds
      expect(exploreThreshold).toBe(60000);
      expect(researchThreshold).toBe(60000);
      expect(defaultThreshold).toBe(30000);
    });

    it("bug fixing and debugging share similar threshold needs", () => {
      const bugfixThreshold = MODE_CONFIGS.bug_fixing.observationThreshold;
      const debugThreshold = MODE_CONFIGS.debugging.observationThreshold;
      const testThreshold = MODE_CONFIGS.testing.observationThreshold;

      // All investigation modes should have 40k threshold
      expect(bugfixThreshold).toBe(40000);
      expect(debugThreshold).toBe(40000);
      expect(testThreshold).toBe(40000);
    });

    it("all modes have lastMessages configured for context preservation", () => {
      for (const [, config] of Object.entries(MODE_CONFIGS)) {
        expect(config.lastMessages).toBeGreaterThanOrEqual(10);
        expect(config.lastMessages).toBeLessThanOrEqual(15);
      }
    });

    it("complete flow: agent type -> mode -> config -> prompts", () => {
      // Test the complete chain for explore agent
      const agentType = "explore";
      const mode = getAgentMode(agentType);
      const config = getMemoryConfig(mode);
      const prompts = MODE_PROMPTS[mode];

      expect(mode).toBe("explore");
      expect(config.observationThreshold).toBe(60000);
      expect(prompts.guidelines).toContain("PRECISION OVER BREVITY");

      // Test for bug_fixing
      const bugMode = getAgentMode("bug_fixing");
      const bugConfig = getMemoryConfig(bugMode);
      const bugPrompts = MODE_PROMPTS[bugMode];

      expect(bugMode).toBe("bug_fixing");
      expect(bugConfig.observationThreshold).toBe(40000);
      expect(bugPrompts.taskContext).toContain("${bugDescription}");
    });
  });

  describe("System Reliability Checks", () => {
    it("handles unknown modes gracefully", () => {
      const unknownMode = "nonexistent_mode" as AgentMode;
      const config = getMemoryConfig(unknownMode);

      // Should return default config for unknown modes
      expect(config).toBe(MODE_CONFIGS.default);
    });

    it("handles unknown agent types gracefully", () => {
      const mode = getAgentMode("unknown_agent_type");

      // Should return default mode for unknown agent types
      expect(mode).toBe("default");
    });

    it("all compression guidance levels are defined", () => {
      const allGuidances = [
        EXPLORER_COMPRESSION_GUIDANCE,
        BUGFIXING_COMPRESSION_GUIDANCE,
        REFACTORING_COMPRESSION_GUIDANCE,
        TESTING_COMPRESSION_GUIDANCE,
        DEBUGGING_COMPRESSION_GUIDANCE,
        RESEARCH_COMPRESSION_GUIDANCE,
      ];

      for (const guidance of allGuidances) {
        expect(guidance[0]).toBeDefined();
        expect(guidance[1]).toBeDefined();
        expect(guidance[2]).toBeDefined();

        // Level 1 should have MILD CONSOLIDATION
        expect(guidance[1]).toContain("MILD CONSOLIDATION");

        // Level 2 should have MODERATE CONSOLIDATION
        expect(guidance[2]).toContain("MODERATE CONSOLIDATION");
      }
    });

    it("all modes have consistent config structure", () => {
      const requiredFields = [
        "observationThreshold",
        "reflectionThreshold",
        "bufferTokens",
        "bufferActivation",
        "blockAfter",
        "scope",
        "lastMessages",
        "maxRecentObservations",
        "maxRecentHours",
      ];

      for (const [, config] of Object.entries(MODE_CONFIGS)) {
        for (const field of requiredFields) {
          expect(config).toHaveProperty(field);
        }
      }
    });
  });
});
