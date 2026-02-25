/**
 * Tests for phase tools integration
 *
 * These tests validate the tool filtering for different agent phases.
 */

import { getToolsForPhase } from "@/tools/phase-tools";
import { describe, expect, it } from "vitest";

describe("tools/phase-tools", () => {
  describe("getToolsForPhase", () => {
    it("should return intake tools (read-only) for explore phase", () => {
      const tools = getToolsForPhase("explore");

      // Explore agents (intake mode) should only have read-only tools
      expect(tools).toBeDefined();

      // Should have read tools
      expect(tools).toHaveProperty("read");

      // Should have search tools
      expect(tools).toHaveProperty("grep");
      expect(tools).toHaveProperty("glob");
      expect(tools).toHaveProperty("question");

      // Should NOT have write tools
      expect(tools).not.toHaveProperty("write");
      expect(tools).not.toHaveProperty("edit");
      expect(tools).not.toHaveProperty("bash");

      // Should NOT have spec tools (only plan mode has these)
      expect(tools).not.toHaveProperty("spec-init");
      expect(tools).not.toHaveProperty("spec-requirements");
      expect(tools).not.toHaveProperty("spec-design");
      expect(tools).not.toHaveProperty("spec-tasks");
    });

    it("should return read-only tools for plan phase", () => {
      const tools = getToolsForPhase("plan");

      // Plan agents should only have read-only tools
      expect(tools).toBeDefined();

      // Should have read tools
      expect(tools).toHaveProperty("read");

      // Should have search tools
      expect(tools).toHaveProperty("grep");
      expect(tools).toHaveProperty("glob");
      expect(tools).toHaveProperty("question");

      // Should NOT have write tools
      expect(tools).not.toHaveProperty("write");
      expect(tools).not.toHaveProperty("edit");
      expect(tools).not.toHaveProperty("bash");
    });

    it("should return read + write tools for build phase", () => {
      const tools = getToolsForPhase("build");

      // Build agents should have both read and write tools
      expect(tools).toBeDefined();

      // Should have read tools
      expect(tools).toHaveProperty("read");

      // Should have write tools
      expect(tools).toHaveProperty("write");
      expect(tools).toHaveProperty("edit");
      expect(tools).toHaveProperty("bash");

      // Should have search tools
      expect(tools).toHaveProperty("grep");
      expect(tools).toHaveProperty("glob");
      expect(tools).toHaveProperty("question");
    });

    it("should include code research tools for all phases", () => {
      const exploreTools = getToolsForPhase("explore");
      const planTools = getToolsForPhase("plan");
      const buildTools = getToolsForPhase("build");

      // All phases should have access to code research tools
      expect(exploreTools).toHaveProperty("search-docs");
      expect(planTools).toHaveProperty("search-docs");
      expect(buildTools).toHaveProperty("search-docs");

      expect(exploreTools).toHaveProperty("ast-query");
      expect(planTools).toHaveProperty("ast-query");
      expect(buildTools).toHaveProperty("ast-query");
    });

    it("should include sequential thinking for all phases", () => {
      const exploreTools = getToolsForPhase("explore");
      const planTools = getToolsForPhase("plan");
      const buildTools = getToolsForPhase("build");

      expect(exploreTools).toHaveProperty("sequentialthinking");
      expect(planTools).toHaveProperty("sequentialthinking");
      expect(buildTools).toHaveProperty("sequentialthinking");
    });

    it("should return different tool sets for different phases", () => {
      const exploreTools = getToolsForPhase("explore");
      const buildTools = getToolsForPhase("build");

      // Explore should have fewer tools than build
      const exploreKeys = Object.keys(exploreTools);
      const buildKeys = Object.keys(buildTools);

      expect(exploreKeys.length).toBeLessThan(buildKeys.length);
    });
  });
});
