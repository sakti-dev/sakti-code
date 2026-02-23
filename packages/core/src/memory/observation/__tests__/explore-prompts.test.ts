/**
 * Tests for Explore Mode Prompts - TDD
 *
 * Tests verify:
 * - EXPLORER_TASK_CONTEXT template with explorationGoal placeholder
 * - EXPLORER_OUTPUT_FORMAT structured format
 * - EXPLORER_GUIDELINES precision-over-brevity principles
 * - EXPLORER_COMPRESSION_GUIDANCE minimal compression
 */

import {
  EXPLORER_COMPRESSION_GUIDANCE,
  EXPLORER_CONTEXT_INSTRUCTIONS,
  EXPLORER_GUIDELINES,
  EXPLORER_OUTPUT_FORMAT,
  EXPLORER_TASK_CONTEXT,
} from "@/prompts/memory/observer/modes";
import { describe, expect, it } from "vitest";

describe("Explore Mode Prompts", () => {
  describe("EXPLORER_TASK_CONTEXT", () => {
    it("should be defined", () => {
      expect(EXPLORER_TASK_CONTEXT).toBeDefined();
      expect(typeof EXPLORER_TASK_CONTEXT).toBe("string");
    });

    it("should contain explorationGoal placeholder", () => {
      expect(EXPLORER_TASK_CONTEXT).toContain("${explorationGoal}");
    });

    it("should mention parent agent context", () => {
      expect(EXPLORER_TASK_CONTEXT.toLowerCase()).toContain("parent");
    });

    it("should emphasize accuracy over brevity", () => {
      expect(EXPLORER_TASK_CONTEXT.toLowerCase()).toContain("accuracy");
    });
  });

  describe("EXPLORER_OUTPUT_FORMAT", () => {
    it("should be defined", () => {
      expect(EXPLORER_OUTPUT_FORMAT).toBeDefined();
      expect(typeof EXPLORER_OUTPUT_FORMAT).toBe("string");
    });

    it("should contain findings section", () => {
      expect(EXPLORER_OUTPUT_FORMAT).toContain("findings");
    });

    it("should contain file_inventory section", () => {
      expect(EXPLORER_OUTPUT_FORMAT).toContain("file_inventory");
    });

    it("should contain gaps section for not found items", () => {
      expect(EXPLORER_OUTPUT_FORMAT).toContain("gaps");
    });

    it("should contain current-task section", () => {
      expect(EXPLORER_OUTPUT_FORMAT).toContain("current-task");
    });

    it("should mention NOT FOUND for missing items", () => {
      expect(EXPLORER_OUTPUT_FORMAT).toContain("NOT FOUND");
    });
  });

  describe("EXPLORER_GUIDELINES", () => {
    it("should be defined", () => {
      expect(EXPLORER_GUIDELINES).toBeDefined();
      expect(typeof EXPLORER_GUIDELINES).toBe("string");
    });

    it("should emphasize precision over brevity", () => {
      expect(EXPLORER_GUIDELINES.toLowerCase()).toContain("precision");
    });

    it("should mention file paths and line numbers", () => {
      expect(EXPLORER_GUIDELINES.toLowerCase()).toContain("file");
    });

    it("should mention NOT FOUND results", () => {
      expect(EXPLORER_GUIDELINES.toLowerCase()).toContain("not found");
    });

    it("should warn against summarizing code", () => {
      expect(EXPLORER_GUIDELINES.toLowerCase()).toContain("summarize");
    });
  });

  describe("EXPLORER_COMPRESSION_GUIDANCE", () => {
    it("should be defined", () => {
      expect(EXPLORER_COMPRESSION_GUIDANCE).toBeDefined();
      expect(typeof EXPLORER_COMPRESSION_GUIDANCE).toBe("object");
    });

    it("should have level 0 (no compression)", () => {
      expect(EXPLORER_COMPRESSION_GUIDANCE[0]).toBeDefined();
      expect(EXPLORER_COMPRESSION_GUIDANCE[0]).toBe("");
    });

    it("should have level 1 (mild consolidation)", () => {
      expect(EXPLORER_COMPRESSION_GUIDANCE[1]).toBeDefined();
      expect(typeof EXPLORER_COMPRESSION_GUIDANCE[1]).toBe("string");
    });

    it("should preserve NOT FOUND results in compression", () => {
      const level1 = EXPLORER_COMPRESSION_GUIDANCE[1];
      expect(level1.toLowerCase()).toContain("not found");
    });

    it("should preserve file paths in compression", () => {
      const level1 = EXPLORER_COMPRESSION_GUIDANCE[1];
      expect(level1.toLowerCase()).toContain("file");
    });
  });

  describe("EXPLORER_CONTEXT_INSTRUCTIONS", () => {
    it("should be defined", () => {
      expect(EXPLORER_CONTEXT_INSTRUCTIONS).toBeDefined();
      expect(typeof EXPLORER_CONTEXT_INSTRUCTIONS).toBe("string");
    });

    it("should mention using findings", () => {
      expect(EXPLORER_CONTEXT_INSTRUCTIONS.toLowerCase()).toContain("finding");
    });
  });
});
