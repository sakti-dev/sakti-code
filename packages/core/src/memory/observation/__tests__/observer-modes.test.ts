/**
 * Tests for Mode-Specific Observer - TDD
 *
 * Tests verify:
 * - AgentMode type has correct values
 * - Mode-specific prompts are applied based on mode
 * - Each mode has its own extraction instructions
 */

import {
  AgentMode,
  MODE_EXTRACTION_INSTRUCTIONS,
  buildObserverSystemPrompt,
  getModeExtractionInstructions,
} from "@/prompts/memory/observer/modes";
import { describe, expect, it } from "vitest";

describe("Mode-Specific Observer", () => {
  describe("AgentMode type", () => {
    it("should have default mode", () => {
      const mode: AgentMode = "default";
      expect(mode).toBe("default");
    });

    it("should have explore mode", () => {
      const mode: AgentMode = "explore";
      expect(mode).toBe("explore");
    });

    it("should have bug_fixing mode", () => {
      const mode: AgentMode = "bug_fixing";
      expect(mode).toBe("bug_fixing");
    });

    it("should have refactoring mode", () => {
      const mode: AgentMode = "refactoring";
      expect(mode).toBe("refactoring");
    });

    it("should have testing mode", () => {
      const mode: AgentMode = "testing";
      expect(mode).toBe("testing");
    });

    it("should have debugging mode", () => {
      const mode: AgentMode = "debugging";
      expect(mode).toBe("debugging");
    });

    it("should have research mode", () => {
      const mode: AgentMode = "research";
      expect(mode).toBe("research");
    });
  });

  describe("MODE_EXTRACTION_INSTRUCTIONS", () => {
    it("should have instructions for default mode", () => {
      expect(MODE_EXTRACTION_INSTRUCTIONS.default).toBeDefined();
      expect(typeof MODE_EXTRACTION_INSTRUCTIONS.default).toBe("string");
    });

    it("should have instructions for explore mode", () => {
      expect(MODE_EXTRACTION_INSTRUCTIONS.explore).toBeDefined();
      expect(typeof MODE_EXTRACTION_INSTRUCTIONS.explore).toBe("string");
    });

    it("should have instructions for bug_fixing mode", () => {
      expect(MODE_EXTRACTION_INSTRUCTIONS.bug_fixing).toBeDefined();
      expect(typeof MODE_EXTRACTION_INSTRUCTIONS.bug_fixing).toBe("string");
    });

    it("should have instructions for refactoring mode", () => {
      expect(MODE_EXTRACTION_INSTRUCTIONS.refactoring).toBeDefined();
      expect(typeof MODE_EXTRACTION_INSTRUCTIONS.refactoring).toBe("string");
    });

    it("should have instructions for testing mode", () => {
      expect(MODE_EXTRACTION_INSTRUCTIONS.testing).toBeDefined();
      expect(typeof MODE_EXTRACTION_INSTRUCTIONS.testing).toBe("string");
    });

    it("should have instructions for debugging mode", () => {
      expect(MODE_EXTRACTION_INSTRUCTIONS.debugging).toBeDefined();
      expect(typeof MODE_EXTRACTION_INSTRUCTIONS.debugging).toBe("string");
    });

    it("should have instructions for research mode", () => {
      expect(MODE_EXTRACTION_INSTRUCTIONS.research).toBeDefined();
      expect(typeof MODE_EXTRACTION_INSTRUCTIONS.research).toBe("string");
    });
  });

  describe("getModeExtractionInstructions", () => {
    it("should return default mode instructions when mode is default", () => {
      const instructions = getModeExtractionInstructions("default");
      expect(instructions).toBe(MODE_EXTRACTION_INSTRUCTIONS.default);
    });

    it("should return explore mode instructions", () => {
      const instructions = getModeExtractionInstructions("explore");
      expect(instructions).toBe(MODE_EXTRACTION_INSTRUCTIONS.explore);
      expect(instructions).toContain("search");
    });

    it("should return bug_fixing mode instructions", () => {
      const instructions = getModeExtractionInstructions("bug_fixing");
      expect(instructions).toBe(MODE_EXTRACTION_INSTRUCTIONS.bug_fixing);
      expect(instructions).toContain("error");
    });

    it("should return refactoring mode instructions", () => {
      const instructions = getModeExtractionInstructions("refactoring");
      expect(instructions).toBe(MODE_EXTRACTION_INSTRUCTIONS.refactoring);
      expect(instructions).toContain("refactor");
    });

    it("should return testing mode instructions", () => {
      const instructions = getModeExtractionInstructions("testing");
      expect(instructions).toBe(MODE_EXTRACTION_INSTRUCTIONS.testing);
      expect(instructions).toContain("test");
    });

    it("should return debugging mode instructions", () => {
      const instructions = getModeExtractionInstructions("debugging");
      expect(instructions).toBe(MODE_EXTRACTION_INSTRUCTIONS.debugging);
      expect(instructions).toContain("Debug session");
    });

    it("should return research mode instructions", () => {
      const instructions = getModeExtractionInstructions("research");
      expect(instructions).toBe(MODE_EXTRACTION_INSTRUCTIONS.research);
      expect(instructions).toContain("research");
    });
  });

  describe("buildObserverSystemPrompt", () => {
    it("should build prompt with default mode", () => {
      const prompt = buildObserverSystemPrompt("default");
      expect(prompt).toContain("memory consciousness");
      expect(prompt).toContain(MODE_EXTRACTION_INSTRUCTIONS.default);
    });

    it("should build prompt with explore mode", () => {
      const prompt = buildObserverSystemPrompt("explore");
      expect(prompt).toContain("codebase researcher");
      expect(prompt).toContain(MODE_EXTRACTION_INSTRUCTIONS.explore);
    });

    it("should build prompt with bug_fixing mode", () => {
      const prompt = buildObserverSystemPrompt("bug_fixing");
      expect(prompt).toContain("memory consciousness");
      expect(prompt).toContain(MODE_EXTRACTION_INSTRUCTIONS.bug_fixing);
    });

    it("should build prompt with refactoring mode", () => {
      const prompt = buildObserverSystemPrompt("refactoring");
      expect(prompt).toContain("memory consciousness");
      expect(prompt).toContain(MODE_EXTRACTION_INSTRUCTIONS.refactoring);
    });

    it("should build prompt with testing mode", () => {
      const prompt = buildObserverSystemPrompt("testing");
      expect(prompt).toContain("memory consciousness");
      expect(prompt).toContain(MODE_EXTRACTION_INSTRUCTIONS.testing);
    });

    it("should build prompt with debugging mode", () => {
      const prompt = buildObserverSystemPrompt("debugging");
      expect(prompt).toContain("memory consciousness");
      expect(prompt).toContain(MODE_EXTRACTION_INSTRUCTIONS.debugging);
    });

    it("should build prompt with research mode", () => {
      const prompt = buildObserverSystemPrompt("research");
      expect(prompt).toContain("memory consciousness");
      expect(prompt).toContain(MODE_EXTRACTION_INSTRUCTIONS.research);
    });

    it("should include output format in prompt", () => {
      const prompt = buildObserverSystemPrompt("default");
      expect(prompt).toContain("<observations>");
      expect(prompt).toContain("<current-task>");
      expect(prompt).toContain("<suggested-response>");
    });

    it("should include core extraction instructions in default mode", () => {
      const prompt = buildObserverSystemPrompt("default");
      expect(prompt).toContain("CRITICAL: DISTINGUISH USER REQUESTS FROM QUESTIONS");
    });
  });
});
