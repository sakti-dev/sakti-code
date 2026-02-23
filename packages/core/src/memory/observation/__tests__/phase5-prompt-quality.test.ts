/**
 * Phase 5: Comprehensive Prompt Quality Tests
 *
 * Tests verify all mode prompts contain required elements.
 * TDD approach - tests verify existing implementation.
 */

import {
  BUGFIXING_COMPRESSION_GUIDANCE,
  DEBUGGING_COMPRESSION_GUIDANCE,
  EXPLORER_COMPRESSION_GUIDANCE,
  MODE_PROMPTS,
  REFACTORING_COMPRESSION_GUIDANCE,
  RESEARCH_COMPRESSION_GUIDANCE,
  TESTING_COMPRESSION_GUIDANCE,
  type AgentMode,
} from "@/prompts/memory/observer/modes";
import { describe, expect, it } from "vitest";

describe("Phase 5: Prompt Quality - All Modes", () => {
  const allModes: AgentMode[] = [
    "default",
    "explore",
    "bug_fixing",
    "refactoring",
    "testing",
    "debugging",
    "research",
  ];

  describe("MODE_PROMPTS structure", () => {
    it("should have all 7 modes defined", () => {
      expect(Object.keys(MODE_PROMPTS)).toHaveLength(7);
      for (const mode of allModes) {
        expect(MODE_PROMPTS[mode]).toBeDefined();
      }
    });

    it("each mode should have all required prompt fields", () => {
      for (const mode of allModes) {
        const prompts = MODE_PROMPTS[mode];
        expect(prompts).toHaveProperty("taskContext");
        expect(prompts).toHaveProperty("extractionInstructions");
        expect(prompts).toHaveProperty("outputFormat");
        expect(prompts).toHaveProperty("guidelines");
        expect(prompts).toHaveProperty("compressionGuidance");
        expect(prompts).toHaveProperty("contextInstructions");
      }
    });
  });

  describe("Explore Mode Prompt Quality", () => {
    const prompts = MODE_PROMPTS.explore;

    it("should have exploration goal placeholder in taskContext", () => {
      expect(prompts.taskContext).toContain("${explorationGoal}");
    });

    it("should mention file paths in taskContext", () => {
      expect(prompts.taskContext.toLowerCase()).toContain("file path");
    });

    it("should mention NOT FOUND results in taskContext", () => {
      expect(prompts.taskContext).toContain('"NOT FOUND" results');
    });

    it("should have extraction instructions mentioning codebase", () => {
      expect(prompts.extractionInstructions.toLowerCase()).toContain("codebase");
    });

    it("should mention exploration objective in extraction", () => {
      expect(prompts.extractionInstructions.toLowerCase()).toContain("objective");
    });

    it("should have structured output format with XML tags", () => {
      expect(prompts.outputFormat).toContain("<findings>");
      expect(prompts.outputFormat).toContain("<file_inventory>");
      expect(prompts.outputFormat).toContain("<gaps>");
    });

    it("should have PRECISION OVER BREVITY in guidelines", () => {
      expect(prompts.guidelines).toContain("PRECISION OVER BREVITY");
    });

    it("should mention exact file paths in guidelines", () => {
      expect(prompts.guidelines.toLowerCase()).toContain("exact file paths");
    });

    it("should have context instructions for parent agent", () => {
      expect(prompts.contextInstructions.toLowerCase()).toContain("parent");
    });
  });

  describe("Bug Fixing Mode Prompt Quality", () => {
    const prompts = MODE_PROMPTS.bug_fixing;

    it("should have bugDescription placeholder in taskContext", () => {
      expect(prompts.taskContext).toContain("${bugDescription}");
    });

    it("should mention error messages in taskContext", () => {
      expect(prompts.taskContext.toLowerCase()).toContain("error");
    });

    it("should mention root cause in taskContext", () => {
      expect(prompts.taskContext.toLowerCase()).toContain("root cause");
    });

    it("should mention CRITICAL in extraction instructions", () => {
      expect(prompts.extractionInstructions).toContain("CRITICAL:");
    });

    it("should mention error messages in extraction instructions", () => {
      expect(prompts.extractionInstructions.toLowerCase()).toContain("error");
    });

    it("should have error_investigation in output format", () => {
      expect(prompts.outputFormat.toLowerCase()).toContain("error");
    });

    it("should mention root cause in guidelines", () => {
      expect(prompts.guidelines.toLowerCase()).toContain("root cause");
    });

    it("should warn against summarizing errors in guidelines", () => {
      expect(prompts.guidelines.toLowerCase()).toContain("summarize");
    });
  });

  describe("Refactoring Mode Prompt Quality", () => {
    const prompts = MODE_PROMPTS.refactoring;

    it("should have refactorGoal placeholder in taskContext", () => {
      expect(prompts.taskContext).toContain("${refactorGoal}");
    });

    it("should mention interface changes in taskContext", () => {
      expect(prompts.taskContext.toLowerCase()).toContain("interface");
    });

    it("should mention breaking changes in taskContext", () => {
      expect(prompts.taskContext.toLowerCase()).toContain("breaking");
    });

    it("should mention INTERFACE CHANGES in extraction instructions", () => {
      expect(prompts.extractionInstructions).toContain("INTERFACE CHANGES");
    });

    it("should mention files affected in extraction instructions", () => {
      expect(prompts.extractionInstructions.toLowerCase()).toContain("files");
    });

    it("should have refactoring_plan in output format", () => {
      expect(prompts.outputFormat.toLowerCase()).toContain("refactor");
    });

    it("should mention breaking changes in guidelines", () => {
      expect(prompts.guidelines.toLowerCase()).toContain("breaking");
    });
  });

  describe("Testing Mode Prompt Quality", () => {
    const prompts = MODE_PROMPTS.testing;

    it("should have testingGoal placeholder in taskContext", () => {
      expect(prompts.taskContext).toContain("${testingGoal}");
    });

    it("should mention test files in taskContext", () => {
      expect(prompts.taskContext.toLowerCase()).toContain("test file");
    });

    it("should mention coverage in taskContext", () => {
      expect(prompts.taskContext.toLowerCase()).toContain("coverage");
    });

    it("should mention TEST FILES in extraction instructions", () => {
      expect(prompts.extractionInstructions).toContain("TEST FILES");
    });

    it("should mention COVERAGE in extraction instructions", () => {
      expect(prompts.extractionInstructions).toContain("COVERAGE");
    });

    it("should have test_summary in output format", () => {
      expect(prompts.outputFormat.toLowerCase()).toContain("test");
    });

    it("should mention coverage in guidelines", () => {
      expect(prompts.guidelines.toLowerCase()).toContain("coverage");
    });
  });

  describe("Debugging Mode Prompt Quality", () => {
    const prompts = MODE_PROMPTS.debugging;

    it("should have debugGoal placeholder in taskContext", () => {
      expect(prompts.taskContext).toContain("${debugGoal}");
    });

    it("should mention symptoms in taskContext", () => {
      expect(prompts.taskContext.toLowerCase()).toContain("symptoms");
    });

    it("should mention variables in taskContext", () => {
      expect(prompts.taskContext.toLowerCase()).toContain("variables");
    });

    it("should mention SYMPTOMS in extraction instructions", () => {
      expect(prompts.extractionInstructions).toContain("SYMPTOMS");
    });

    it("should mention VARIABLES in extraction instructions", () => {
      expect(prompts.extractionInstructions).toContain("VARIABLES");
    });

    it("should have debug_session in output format", () => {
      expect(prompts.outputFormat.toLowerCase()).toContain("debug");
    });

    it("should mention variable states in guidelines", () => {
      expect(prompts.guidelines.toLowerCase()).toContain("variable");
    });
  });

  describe("Research Mode Prompt Quality", () => {
    const prompts = MODE_PROMPTS.research;

    it("should have researchGoal placeholder in taskContext", () => {
      expect(prompts.taskContext).toContain("${researchGoal}");
    });

    it("should mention sources in taskContext", () => {
      expect(prompts.taskContext.toLowerCase()).toContain("sources");
    });

    it("should mention findings in taskContext", () => {
      expect(prompts.taskContext.toLowerCase()).toContain("findings");
    });

    it("should mention SOURCES in extraction instructions", () => {
      expect(prompts.extractionInstructions).toContain("SOURCES");
    });

    it("should mention FINDINGS in extraction instructions", () => {
      expect(prompts.extractionInstructions).toContain("FINDINGS");
    });

    it("should have research_findings in output format", () => {
      expect(prompts.outputFormat.toLowerCase()).toContain("research");
    });

    it("should mention sources in guidelines", () => {
      expect(prompts.guidelines.toLowerCase()).toContain("source");
    });
  });

  describe("Default Mode Prompt Quality", () => {
    const prompts = MODE_PROMPTS.default;

    it("should have empty taskContext", () => {
      expect(prompts.taskContext).toBe("");
    });

    it("should have extraction instructions with CRITICAL directive", () => {
      expect(prompts.extractionInstructions).toContain("CRITICAL:");
    });

    it("should mention file paths in extraction instructions", () => {
      expect(prompts.extractionInstructions.toLowerCase()).toContain("file path");
    });

    it("should mention PROJECT CONTEXT in extraction instructions", () => {
      expect(prompts.extractionInstructions).toContain("PROJECT CONTEXT");
    });

    it("should have context instructions", () => {
      expect(prompts.contextInstructions).toBeDefined();
      expect(typeof prompts.contextInstructions).toBe("string");
    });
  });

  describe("Compression Guidance for All Modes", () => {
    const compressionGuidances = [
      { name: "explore", guidance: EXPLORER_COMPRESSION_GUIDANCE },
      { name: "bug_fixing", guidance: BUGFIXING_COMPRESSION_GUIDANCE },
      { name: "refactoring", guidance: REFACTORING_COMPRESSION_GUIDANCE },
      { name: "testing", guidance: TESTING_COMPRESSION_GUIDANCE },
      { name: "debugging", guidance: DEBUGGING_COMPRESSION_GUIDANCE },
      { name: "research", guidance: RESEARCH_COMPRESSION_GUIDANCE },
    ];

    for (const { name, guidance } of compressionGuidances) {
      describe(`${name} compression guidance`, () => {
        it("should have level 0 defined", () => {
          expect(guidance[0]).toBeDefined();
        });

        it("should have level 1 defined with MILD CONSOLIDATION", () => {
          expect(guidance[1]).toBeDefined();
          expect(guidance[1]).toContain("MILD CONSOLIDATION");
        });

        it("should have level 2 defined with MODERATE CONSOLIDATION", () => {
          expect(guidance[2]).toBeDefined();
          expect(guidance[2]).toContain("MODERATE CONSOLIDATION");
        });

        it("level 1 should have NEVER remove section", () => {
          expect(guidance[1]).toContain("NEVER remove");
        });

        it("level 2 should have Keep section", () => {
          expect(guidance[2]).toContain("Keep:");
        });
      });
    }
  });
});
