/**
 * Tests for Mode-Specific Prompts - TDD
 *
 * Tests verify mode-specific prompts for:
 * - bug_fixing: error investigation, root cause, fixes
 * - refactoring: interface changes, dependencies, breaking changes
 * - testing: test files, coverage, results
 * - debugging: symptoms, variables, investigation
 * - research: sources, findings, recommendations
 */

import {
  BUGFIXING_COMPRESSION_GUIDANCE,
  BUGFIXING_CONTEXT_INSTRUCTIONS,
  BUGFIXING_GUIDELINES,
  BUGFIXING_OUTPUT_FORMAT,
  BUGFIXING_TASK_CONTEXT,
  DEBUGGING_COMPRESSION_GUIDANCE,
  DEBUGGING_CONTEXT_INSTRUCTIONS,
  DEBUGGING_GUIDELINES,
  DEBUGGING_OUTPUT_FORMAT,
  DEBUGGING_TASK_CONTEXT,
  REFACTORING_COMPRESSION_GUIDANCE,
  REFACTORING_CONTEXT_INSTRUCTIONS,
  REFACTORING_GUIDELINES,
  REFACTORING_OUTPUT_FORMAT,
  REFACTORING_TASK_CONTEXT,
  RESEARCH_COMPRESSION_GUIDANCE,
  RESEARCH_CONTEXT_INSTRUCTIONS,
  RESEARCH_GUIDELINES,
  RESEARCH_OUTPUT_FORMAT,
  RESEARCH_TASK_CONTEXT,
  TESTING_COMPRESSION_GUIDANCE,
  TESTING_CONTEXT_INSTRUCTIONS,
  TESTING_GUIDELINES,
  TESTING_OUTPUT_FORMAT,
  TESTING_TASK_CONTEXT,
} from "@/prompts/memory/observer/modes";
import { describe, expect, it } from "vitest";

describe("Bug Fixing Mode Prompts", () => {
  describe("BUGFIXING_TASK_CONTEXT", () => {
    it("should be defined", () => {
      expect(BUGFIXING_TASK_CONTEXT).toBeDefined();
      expect(typeof BUGFIXING_TASK_CONTEXT).toBe("string");
    });

    it("should contain bugDescription placeholder", () => {
      expect(BUGFIXING_TASK_CONTEXT).toContain("${bugDescription}");
    });

    it("should mention error messages and stack traces", () => {
      expect(BUGFIXING_TASK_CONTEXT.toLowerCase()).toContain("error");
    });

    it("should mention root cause analysis", () => {
      expect(BUGFIXING_TASK_CONTEXT.toLowerCase()).toContain("root cause");
    });
  });

  describe("BUGFIXING_OUTPUT_FORMAT", () => {
    it("should be defined", () => {
      expect(BUGFIXING_OUTPUT_FORMAT).toBeDefined();
      expect(typeof BUGFIXING_OUTPUT_FORMAT).toBe("string");
    });

    it("should contain error investigation section", () => {
      expect(BUGFIXING_OUTPUT_FORMAT.toLowerCase()).toContain("error");
    });

    it("should contain root cause analysis section", () => {
      expect(BUGFIXING_OUTPUT_FORMAT.toLowerCase()).toContain("root cause");
    });

    it("should contain attempted fixes section", () => {
      expect(BUGFIXING_OUTPUT_FORMAT.toLowerCase()).toContain("attempt");
    });

    it("should contain current status section", () => {
      expect(BUGFIXING_OUTPUT_FORMAT.toLowerCase()).toContain("status");
    });
  });

  describe("BUGFIXING_GUIDELINES", () => {
    it("should be defined", () => {
      expect(BUGFIXING_GUIDELINES).toBeDefined();
      expect(typeof BUGFIXING_GUIDELINES).toBe("string");
    });

    it("should mention error messages and stack traces", () => {
      expect(BUGFIXING_GUIDELINES.toLowerCase()).toContain("error");
    });

    it("should mention root cause", () => {
      expect(BUGFIXING_GUIDELINES.toLowerCase()).toContain("root cause");
    });

    it("should warn against summarizing errors away", () => {
      expect(BUGFIXING_GUIDELINES.toLowerCase()).toContain("summarize");
    });
  });

  describe("BUGFIXING_COMPRESSION_GUIDANCE", () => {
    it("should be defined", () => {
      expect(BUGFIXING_COMPRESSION_GUIDANCE).toBeDefined();
      expect(typeof BUGFIXING_COMPRESSION_GUIDANCE).toBe("object");
    });

    it("should have level 0 (no compression)", () => {
      expect(BUGFIXING_COMPRESSION_GUIDANCE[0]).toBe("");
    });

    it("should preserve error messages in compression", () => {
      const level1 = BUGFIXING_COMPRESSION_GUIDANCE[1];
      expect(level1.toLowerCase()).toContain("error");
    });
  });

  describe("BUGFIXING_CONTEXT_INSTRUCTIONS", () => {
    it("should be defined", () => {
      expect(BUGFIXING_CONTEXT_INSTRUCTIONS).toBeDefined();
      expect(typeof BUGFIXING_CONTEXT_INSTRUCTIONS).toBe("string");
    });

    it("should mention fix or solution", () => {
      expect(BUGFIXING_CONTEXT_INSTRUCTIONS.toLowerCase()).toContain("fix");
    });
  });
});

describe("Refactoring Mode Prompts", () => {
  describe("REFACTORING_TASK_CONTEXT", () => {
    it("should be defined", () => {
      expect(REFACTORING_TASK_CONTEXT).toBeDefined();
      expect(typeof REFACTORING_TASK_CONTEXT).toBe("string");
    });

    it("should contain refactorGoal placeholder", () => {
      expect(REFACTORING_TASK_CONTEXT).toContain("${refactorGoal}");
    });

    it("should mention files affected", () => {
      expect(REFACTORING_TASK_CONTEXT.toLowerCase()).toContain("file");
    });

    it("should mention breaking changes", () => {
      expect(REFACTORING_TASK_CONTEXT.toLowerCase()).toContain("breaking");
    });
  });

  describe("REFACTORING_OUTPUT_FORMAT", () => {
    it("should be defined", () => {
      expect(REFACTORING_OUTPUT_FORMAT).toBeDefined();
      expect(typeof REFACTORING_OUTPUT_FORMAT).toBe("string");
    });

    it("should contain refactoring plan section", () => {
      expect(REFACTORING_OUTPUT_FORMAT.toLowerCase()).toContain("refactor");
    });

    it("should contain files to modify section", () => {
      expect(REFACTORING_OUTPUT_FORMAT.toLowerCase()).toContain("file");
    });

    it("should contain interface changes section", () => {
      expect(REFACTORING_OUTPUT_FORMAT.toLowerCase()).toContain("interface");
    });

    it("should contain dependent files section", () => {
      expect(REFACTORING_OUTPUT_FORMAT.toLowerCase()).toContain("dependent");
    });
  });

  describe("REFACTORING_GUIDELINES", () => {
    it("should be defined", () => {
      expect(REFACTORING_GUIDELINES).toBeDefined();
      expect(typeof REFACTORING_GUIDELINES).toBe("string");
    });

    it("should mention interface changes", () => {
      expect(REFACTORING_GUIDELINES.toLowerCase()).toContain("interface");
    });

    it("should mention breaking changes", () => {
      expect(REFACTORING_GUIDELINES.toLowerCase()).toContain("breaking");
    });

    it("should mention dependencies", () => {
      expect(REFACTORING_GUIDELINES.toLowerCase()).toContain("dependenc");
    });
  });

  describe("REFACTORING_COMPRESSION_GUIDANCE", () => {
    it("should be defined", () => {
      expect(REFACTORING_COMPRESSION_GUIDANCE).toBeDefined();
      expect(typeof REFACTORING_COMPRESSION_GUIDANCE).toBe("object");
    });

    it("should have level 0 (no compression)", () => {
      expect(REFACTORING_COMPRESSION_GUIDANCE[0]).toBe("");
    });

    it("should preserve interface changes in compression", () => {
      const level1 = REFACTORING_COMPRESSION_GUIDANCE[1];
      expect(level1.toLowerCase()).toContain("interface");
    });
  });

  describe("REFACTORING_CONTEXT_INSTRUCTIONS", () => {
    it("should be defined", () => {
      expect(REFACTORING_CONTEXT_INSTRUCTIONS).toBeDefined();
      expect(typeof REFACTORING_CONTEXT_INSTRUCTIONS).toBe("string");
    });

    it("should mention changes or modifications", () => {
      expect(REFACTORING_CONTEXT_INSTRUCTIONS.toLowerCase()).toContain("change");
    });
  });
});

describe("Testing Mode Prompts", () => {
  describe("TESTING_TASK_CONTEXT", () => {
    it("should be defined", () => {
      expect(TESTING_TASK_CONTEXT).toBeDefined();
      expect(typeof TESTING_TASK_CONTEXT).toBe("string");
    });

    it("should contain testingGoal placeholder", () => {
      expect(TESTING_TASK_CONTEXT).toContain("${testingGoal}");
    });

    it("should mention test files", () => {
      expect(TESTING_TASK_CONTEXT.toLowerCase()).toContain("test");
    });

    it("should mention coverage", () => {
      expect(TESTING_TASK_CONTEXT.toLowerCase()).toContain("coverage");
    });
  });

  describe("TESTING_OUTPUT_FORMAT", () => {
    it("should be defined", () => {
      expect(TESTING_OUTPUT_FORMAT).toBeDefined();
      expect(typeof TESTING_OUTPUT_FORMAT).toBe("string");
    });

    it("should contain test summary section", () => {
      expect(TESTING_OUTPUT_FORMAT.toLowerCase()).toContain("test");
    });

    it("should contain coverage section", () => {
      expect(TESTING_OUTPUT_FORMAT.toLowerCase()).toContain("coverage");
    });

    it("should contain results section", () => {
      expect(TESTING_OUTPUT_FORMAT.toLowerCase()).toContain("result");
    });
  });

  describe("TESTING_GUIDELINES", () => {
    it("should be defined", () => {
      expect(TESTING_GUIDELINES).toBeDefined();
      expect(typeof TESTING_GUIDELINES).toBe("string");
    });

    it("should mention test results", () => {
      expect(TESTING_GUIDELINES.toLowerCase()).toContain("test");
    });

    it("should mention coverage", () => {
      expect(TESTING_GUIDELINES.toLowerCase()).toContain("coverage");
    });

    it("should mention pass/fail", () => {
      expect(TESTING_GUIDELINES.toLowerCase()).toContain("pass");
    });
  });

  describe("TESTING_COMPRESSION_GUIDANCE", () => {
    it("should be defined", () => {
      expect(TESTING_COMPRESSION_GUIDANCE).toBeDefined();
      expect(typeof TESTING_COMPRESSION_GUIDANCE).toBe("object");
    });

    it("should have level 0 (no compression)", () => {
      expect(TESTING_COMPRESSION_GUIDANCE[0]).toBe("");
    });

    it("should preserve test results in compression", () => {
      const level1 = TESTING_COMPRESSION_GUIDANCE[1];
      expect(level1.toLowerCase()).toContain("test");
    });
  });

  describe("TESTING_CONTEXT_INSTRUCTIONS", () => {
    it("should be defined", () => {
      expect(TESTING_CONTEXT_INSTRUCTIONS).toBeDefined();
      expect(typeof TESTING_CONTEXT_INSTRUCTIONS).toBe("string");
    });

    it("should mention tests", () => {
      expect(TESTING_CONTEXT_INSTRUCTIONS.toLowerCase()).toContain("test");
    });
  });
});

describe("Debugging Mode Prompts", () => {
  describe("DEBUGGING_TASK_CONTEXT", () => {
    it("should be defined", () => {
      expect(DEBUGGING_TASK_CONTEXT).toBeDefined();
      expect(typeof DEBUGGING_TASK_CONTEXT).toBe("string");
    });

    it("should contain debugGoal placeholder", () => {
      expect(DEBUGGING_TASK_CONTEXT).toContain("${debugGoal}");
    });

    it("should mention symptoms", () => {
      expect(DEBUGGING_TASK_CONTEXT.toLowerCase()).toContain("symptom");
    });

    it("should mention variables", () => {
      expect(DEBUGGING_TASK_CONTEXT.toLowerCase()).toContain("variable");
    });
  });

  describe("DEBUGGING_OUTPUT_FORMAT", () => {
    it("should be defined", () => {
      expect(DEBUGGING_OUTPUT_FORMAT).toBeDefined();
      expect(typeof DEBUGGING_OUTPUT_FORMAT).toBe("string");
    });

    it("should contain debug session section", () => {
      expect(DEBUGGING_OUTPUT_FORMAT.toLowerCase()).toContain("debug");
    });

    it("should contain symptoms section", () => {
      expect(DEBUGGING_OUTPUT_FORMAT.toLowerCase()).toContain("symptom");
    });

    it("should contain investigation section", () => {
      expect(DEBUGGING_OUTPUT_FORMAT.toLowerCase()).toContain("investig");
    });

    it("should contain variables/state section", () => {
      expect(DEBUGGING_OUTPUT_FORMAT.toLowerCase()).toContain("variable");
    });

    it("should contain conclusion section", () => {
      expect(DEBUGGING_OUTPUT_FORMAT.toLowerCase()).toContain("conclusion");
    });
  });

  describe("DEBUGGING_GUIDELINES", () => {
    it("should be defined", () => {
      expect(DEBUGGING_GUIDELINES).toBeDefined();
      expect(typeof DEBUGGING_GUIDELINES).toBe("string");
    });

    it("should mention symptoms", () => {
      expect(DEBUGGING_GUIDELINES.toLowerCase()).toContain("symptom");
    });

    it("should mention variables", () => {
      expect(DEBUGGING_GUIDELINES.toLowerCase()).toContain("variable");
    });

    it("should mention investigation", () => {
      expect(DEBUGGING_GUIDELINES.toLowerCase()).toContain("investig");
    });
  });

  describe("DEBUGGING_COMPRESSION_GUIDANCE", () => {
    it("should be defined", () => {
      expect(DEBUGGING_COMPRESSION_GUIDANCE).toBeDefined();
      expect(typeof DEBUGGING_COMPRESSION_GUIDANCE).toBe("object");
    });

    it("should have level 0 (no compression)", () => {
      expect(DEBUGGING_COMPRESSION_GUIDANCE[0]).toBe("");
    });

    it("should preserve symptoms in compression", () => {
      const level1 = DEBUGGING_COMPRESSION_GUIDANCE[1];
      expect(level1.toLowerCase()).toContain("symptom");
    });
  });

  describe("DEBUGGING_CONTEXT_INSTRUCTIONS", () => {
    it("should be defined", () => {
      expect(DEBUGGING_CONTEXT_INSTRUCTIONS).toBeDefined();
      expect(typeof DEBUGGING_CONTEXT_INSTRUCTIONS).toBe("string");
    });

    it("should mention debugging", () => {
      expect(DEBUGGING_CONTEXT_INSTRUCTIONS.toLowerCase()).toContain("debug");
    });
  });
});

describe("Research Mode Prompts", () => {
  describe("RESEARCH_TASK_CONTEXT", () => {
    it("should be defined", () => {
      expect(RESEARCH_TASK_CONTEXT).toBeDefined();
      expect(typeof RESEARCH_TASK_CONTEXT).toBe("string");
    });

    it("should contain researchGoal placeholder", () => {
      expect(RESEARCH_TASK_CONTEXT).toContain("${researchGoal}");
    });

    it("should mention sources", () => {
      expect(RESEARCH_TASK_CONTEXT.toLowerCase()).toContain("source");
    });

    it("should mention findings", () => {
      expect(RESEARCH_TASK_CONTEXT.toLowerCase()).toContain("finding");
    });
  });

  describe("RESEARCH_OUTPUT_FORMAT", () => {
    it("should be defined", () => {
      expect(RESEARCH_OUTPUT_FORMAT).toBeDefined();
      expect(typeof RESEARCH_OUTPUT_FORMAT).toBe("string");
    });

    it("should contain research findings section", () => {
      expect(RESEARCH_OUTPUT_FORMAT.toLowerCase()).toContain("finding");
    });

    it("should contain sources section", () => {
      expect(RESEARCH_OUTPUT_FORMAT.toLowerCase()).toContain("source");
    });

    it("should contain recommendations section", () => {
      expect(RESEARCH_OUTPUT_FORMAT.toLowerCase()).toContain("recommend");
    });

    it("should contain alternatives section", () => {
      expect(RESEARCH_OUTPUT_FORMAT.toLowerCase()).toContain("alternativ");
    });
  });

  describe("RESEARCH_GUIDELINES", () => {
    it("should be defined", () => {
      expect(RESEARCH_GUIDELINES).toBeDefined();
      expect(typeof RESEARCH_GUIDELINES).toBe("string");
    });

    it("should mention sources", () => {
      expect(RESEARCH_GUIDELINES.toLowerCase()).toContain("source");
    });

    it("should mention findings", () => {
      expect(RESEARCH_GUIDELINES.toLowerCase()).toContain("finding");
    });

    it("should mention documentation", () => {
      expect(RESEARCH_GUIDELINES.toLowerCase()).toContain("document");
    });
  });

  describe("RESEARCH_COMPRESSION_GUIDANCE", () => {
    it("should be defined", () => {
      expect(RESEARCH_COMPRESSION_GUIDANCE).toBeDefined();
      expect(typeof RESEARCH_COMPRESSION_GUIDANCE).toBe("object");
    });

    it("should have level 0 (no compression)", () => {
      expect(RESEARCH_COMPRESSION_GUIDANCE[0]).toBe("");
    });

    it("should preserve sources in compression", () => {
      const level1 = RESEARCH_COMPRESSION_GUIDANCE[1];
      expect(level1.toLowerCase()).toContain("source");
    });
  });

  describe("RESEARCH_CONTEXT_INSTRUCTIONS", () => {
    it("should be defined", () => {
      expect(RESEARCH_CONTEXT_INSTRUCTIONS).toBeDefined();
      expect(typeof RESEARCH_CONTEXT_INSTRUCTIONS).toBe("string");
    });

    it("should mention research", () => {
      expect(RESEARCH_CONTEXT_INSTRUCTIONS.toLowerCase()).toContain("research");
    });
  });
});
