/**
 * Tests for spec integration module
 */

import { describe, expect, it } from "vitest";
import {
  buildDesignPrompt,
  buildDesignValidationPrompt,
  buildGapAnalyzerPrompt,
  buildImplPrompt,
  buildImplValidationPrompt,
  buildQuickPrompt,
  buildRequirementsPrompt,
  buildStatusPrompt,
  buildTasksPrompt,
  expandPromptPlaceholders,
  getSpecDir,
  sharedPolicies,
  verifyPromptComposition,
  type SpecPromptContext,
} from "../integration";

describe("SpecIntegration", () => {
  describe("getSpecDir", () => {
    it("should construct spec directory path", () => {
      const context: SpecPromptContext = {
        workspaceDir: "/workspace",
        kiroDir: ".kiro",
        specSlug: "test-feature",
      };

      const specDir = getSpecDir(context);
      expect(specDir).toBe("/workspace/.kiro/specs/test-feature");
    });

    it("should use default kiroDir when not provided", () => {
      const context: SpecPromptContext = {
        workspaceDir: "/workspace",
        specSlug: "test-feature",
      };

      const specDir = getSpecDir(context);
      expect(specDir).toBe("/workspace/.kiro/specs/test-feature");
    });
  });

  describe("expandPromptPlaceholders", () => {
    it("should replace all placeholders with context values", () => {
      const template = "Workspace: {{WORKSPACE_DIR}}, Spec: {{SPEC_SLUG}}, Session: {{SESSION_ID}}";
      const context: SpecPromptContext = {
        workspaceDir: "/my-workspace",
        specSlug: "my-feature",
        sessionId: "session-123",
      };

      const result = expandPromptPlaceholders(template, context);
      expect(result).toBe("Workspace: /my-workspace, Spec: my-feature, Session: session-123");
    });

    it("should use default values for optional placeholders", () => {
      const template = "Mode: {{RUNTIME_MODE}}, Lang: {{LANG}}";
      const context: SpecPromptContext = {
        workspaceDir: "/workspace",
        specSlug: "test",
      };

      const result = expandPromptPlaceholders(template, context);
      expect(result).toBe("Mode: plan, Lang: en");
    });

    it("should construct spec directory path in placeholders", () => {
      const template = "Spec dir: {{SPEC_DIR}}";
      const context: SpecPromptContext = {
        workspaceDir: "/workspace",
        specSlug: "test",
      };

      const result = expandPromptPlaceholders(template, context);
      expect(result).toBe("Spec dir: /workspace/.kiro/specs/test");
    });
  });

  describe("Prompt builders", () => {
    const context: SpecPromptContext = {
      workspaceDir: "/workspace",
      kiroDir: ".kiro",
      specSlug: "test-feature",
      sessionId: "test-session",
      runtimeMode: "plan",
      lang: "en",
    };

    it("should build requirements prompt with context", () => {
      const prompt = buildRequirementsPrompt(context);
      expect(prompt).toContain("test-feature");
      expect(prompt).toContain("/workspace/.kiro/specs/test-feature");
    });

    it("should build gap analyzer prompt with context", () => {
      const prompt = buildGapAnalyzerPrompt(context);
      expect(prompt).toContain("test-feature");
      expect(prompt).toContain("/workspace/.kiro/specs/test-feature");
    });

    it("should build design prompt with context", () => {
      const prompt = buildDesignPrompt(context);
      expect(prompt).toContain("test-feature");
      expect(prompt).toContain("Non-negotiable rules:");
      expect(prompt).toContain("Traceability rules:");
    });

    it("should build design validation prompt with context", () => {
      const prompt = buildDesignValidationPrompt(context);
      expect(prompt).toContain("test-feature");
      expect(prompt).toContain("Non-negotiable rules:");
    });

    it("should build tasks prompt with context", () => {
      const prompt = buildTasksPrompt(context);
      expect(prompt).toContain("test-feature");
      expect(prompt).toContain("Traceability rules:");
      expect(prompt).toContain("Formatting constraints:");
    });

    it("should build implementation executor prompt with context", () => {
      const prompt = buildImplPrompt(context);
      expect(prompt).toContain("test-feature");
      expect(prompt).toContain("Non-negotiable rules:");
    });

    it("should build implementation validator prompt with context", () => {
      const prompt = buildImplValidationPrompt(context);
      expect(prompt).toContain("test-feature");
      expect(prompt).toContain("Traceability rules:");
    });

    it("should build status reporter prompt with context", () => {
      const prompt = buildStatusPrompt(context);
      expect(prompt).toContain("test-feature");
    });

    it("should build quick orchestrator prompt with context", () => {
      const prompt = buildQuickPrompt(context);
      expect(prompt).toContain("test-feature");
      expect(prompt).toContain("spec workflow orchestrator");
      expect(prompt).toContain("Execute init -> requirements -> design -> tasks");
    });
  });

  describe("sharedPolicies", () => {
    it("should export all shared policy blocks", () => {
      expect(sharedPolicies.corePolicy).toBeDefined();
      expect(sharedPolicies.contextLoading).toBeDefined();
      expect(sharedPolicies.formatRules).toBeDefined();
      expect(sharedPolicies.traceabilityRules).toBeDefined();
      expect(sharedPolicies.safetyAndFallback).toBeDefined();

      expect(sharedPolicies.corePolicy).toContain("Non-negotiable rules:");
      expect(sharedPolicies.corePolicy).toContain("Read-first / write-last");
      expect(sharedPolicies.contextLoading).toContain("Required context loading sequence");
      expect(sharedPolicies.formatRules).toContain("Formatting constraints:");
      expect(sharedPolicies.traceabilityRules).toContain("Traceability rules:");
      expect(sharedPolicies.traceabilityRules).toContain(
        "Every task must include requirement references"
      );
      expect(sharedPolicies.safetyAndFallback).toContain("Fallback behavior:");
    });
  });

  describe("verifyPromptComposition", () => {
    it("should validate prompt with all required policies", () => {
      const prompt = `
        ${sharedPolicies.corePolicy}
        ${sharedPolicies.contextLoading}
        ${sharedPolicies.formatRules}
        ${sharedPolicies.traceabilityRules}
        ${sharedPolicies.safetyAndFallback}
      `;

      const result = verifyPromptComposition(prompt);
      expect(result.valid).toBe(true);
      expect(result.missingPolicies).toEqual([]);
    });

    it("should detect missing shared policies", () => {
      const prompt = `
        ${sharedPolicies.corePolicy}
        ${sharedPolicies.formatRules}
      `;

      const result = verifyPromptComposition(prompt);
      expect(result.valid).toBe(false);
      expect(result.missingPolicies).toContain("SPEC_CONTEXT_LOADING");
      expect(result.missingPolicies).toContain("SPEC_TRACEABILITY_RULES");
      expect(result.missingPolicies).toContain("SPEC_SAFETY_AND_FALLBACK");
    });

    it("should detect all missing policies", () => {
      const prompt = "Some other content without policies";

      const result = verifyPromptComposition(prompt);
      expect(result.valid).toBe(false);
      expect(result.missingPolicies).toHaveLength(5);
    });

    it("should handle empty prompt", () => {
      const result = verifyPromptComposition("");
      expect(result.valid).toBe(false);
      expect(result.missingPolicies).toHaveLength(5);
    });
  });

  describe("Integration assertions", () => {
    const context: SpecPromptContext = {
      workspaceDir: "/workspace",
      specSlug: "integration-test",
    };

    it("should verify built prompts include shared policies", () => {
      const requirementsPrompt = buildRequirementsPrompt(context);
      const designPrompt = buildDesignPrompt(context);
      const tasksPrompt = buildTasksPrompt(context);

      // Verify prompts include required policy blocks
      const result = verifyPromptComposition(requirementsPrompt);
      expect(result.valid).toBe(true);
      expect(result.missingPolicies).toEqual([]);

      const designResult = verifyPromptComposition(designPrompt);
      expect(designResult.valid).toBe(true);

      const tasksResult = verifyPromptComposition(tasksPrompt);
      expect(tasksResult.valid).toBe(true);
    });

    it("should verify prompts include required section markers", () => {
      const designPrompt = buildDesignPrompt(context);

      // Design prompt should include section markers
      expect(designPrompt).toContain("<Role>");
      expect(designPrompt).toContain("<Mission>");
      expect(designPrompt).toContain("<SuccessCriteria>");
      expect(designPrompt).toContain("<Inputs>");
      expect(designPrompt).toContain("<ExecutionPlan>");
      expect(designPrompt).toContain("<HardConstraints>");
      expect(designPrompt).toContain("<QualityChecklist>");
      expect(designPrompt).toContain("<OutputSummarySchema>");
    });

    it("should verify tasks prompt includes parallelization rules", () => {
      const tasksPrompt = buildTasksPrompt(context);
      expect(tasksPrompt).toContain("(P)");
      expect(tasksPrompt).toContain("- [ ]*");
      expect(tasksPrompt).toContain("ParallelizationRules");
    });

    it("should verify tasks prompt includes traceability rules", () => {
      const tasksPrompt = buildTasksPrompt(context);
      expect(tasksPrompt).toContain("Traceability rules:");
      expect(tasksPrompt).toContain("Every task must include requirement references");
    });
  });
});
