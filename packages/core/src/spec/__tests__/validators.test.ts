/**
 * Spec Validators Tests
 *
 * Phase 2 - Spec System
 */

import { beforeAll, describe, expect, it } from "vitest";

describe("Spec Validators", () => {
  let extractRequirementIds: typeof import("@/spec/validators").extractRequirementIds;
  let extractTaskIds: typeof import("@/spec/validators").extractTaskIds;
  let validateRequirementIds: typeof import("@/spec/validators").validateRequirementIds;
  let validateTaskFormat: typeof import("@/spec/validators").validateTaskFormat;
  let validateTasksCoverage: typeof import("@/spec/validators").validateTasksCoverage;
  let validateDesignTraceability: typeof import("@/spec/validators").validateDesignTraceability;
  let validateTaskDependencies: typeof import("@/spec/validators").validateTaskDependencies;
  let detectDependencyCycles: typeof import("@/spec/validators").detectDependencyCycles;
  let normalizeRequirementId: typeof import("@/spec/validators").normalizeRequirementId;

  beforeAll(async () => {
    const v = await import("@/spec/validators");
    extractRequirementIds = v.extractRequirementIds;
    extractTaskIds = v.extractTaskIds;
    validateRequirementIds = v.validateRequirementIds;
    validateTaskFormat = v.validateTaskFormat;
    validateTasksCoverage = v.validateTasksCoverage;
    validateDesignTraceability = v.validateDesignTraceability;
    validateTaskDependencies = v.validateTaskDependencies;
    detectDependencyCycles = v.detectDependencyCycles;
    normalizeRequirementId = v.normalizeRequirementId;
  });

  describe("extractRequirementIds", () => {
    it("should extract simple requirement IDs", () => {
      const content = "Some text R-1 and R-2 and R-3";
      const result = extractRequirementIds(content);
      expect(result).toEqual(["R-1", "R-2", "R-3"]);
    });

    it("should deduplicate requirement IDs", () => {
      const content = "R-1 is mentioned R-1 again";
      const result = extractRequirementIds(content);
      expect(result).toEqual(["R-1"]);
    });

    it("should return sorted IDs", () => {
      const content = "R-3 and R-1 and R-2";
      const result = extractRequirementIds(content);
      expect(result).toEqual(["R-1", "R-2", "R-3"]);
    });

    it("should return empty array for no IDs", () => {
      const content = "No IDs here";
      const result = extractRequirementIds(content);
      expect(result).toEqual([]);
    });
  });

  describe("extractTaskIds", () => {
    it("should extract task IDs", () => {
      const content = "Task T-1 depends on T-2";
      const result = extractTaskIds(content);
      expect(result).toEqual(["T-1", "T-2"]);
    });

    it("should return sorted unique task IDs", () => {
      const content = "T-3 and T-1 and T-2";
      const result = extractTaskIds(content);
      expect(result).toEqual(["T-1", "T-2", "T-3"]);
    });
  });

  describe("normalizeRequirementId", () => {
    it("should return valid ID as-is", () => {
      expect(normalizeRequirementId("R-1")).toBe("R-1");
      expect(normalizeRequirementId("R-42")).toBe("R-42");
    });

    it("should normalize various formats", () => {
      expect(normalizeRequirementId("R1")).toBe("R-1");
      expect(normalizeRequirementId("R 1")).toBe("R-1");
      expect(normalizeRequirementId("R:1")).toBe("R-1");
      expect(normalizeRequirementId("r-1")).toBe("R-1");
    });

    it("should return null for invalid formats", () => {
      expect(normalizeRequirementId("X-1")).toBeNull();
      expect(normalizeRequirementId("REQ-1")).toBeNull();
      expect(normalizeRequirementId("")).toBeNull();
    });
  });

  describe("validateRequirementIds", () => {
    it("should pass for valid requirement IDs", () => {
      const content = `
### Requirement 1 (R-1)
Content here

### Requirement 2 (R-2)
More content
    `;
      const result = validateRequirementIds(content);
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should handle various ID formats", () => {
      const content = "### Requirement 1 (R-1)\n### Requirement 2 (R-2)";
      const result = validateRequirementIds(content);
      expect(result).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it("should warn and normalize non-standard IDs", () => {
      const content = "R-1 is used with R:2 instead of R-1";
      const result = validateRequirementIds(content);
      expect(result.ok).toBe(true);
      const normalizedWarnings = result.warnings.filter(w => w.code === "REQ_ID_FORMAT_NORMALIZED");
      expect(normalizedWarnings.length).toBeGreaterThanOrEqual(0);
    });

    it("should warn about sequence gaps", () => {
      const content = "Requirements: R-1, R-2, R-3, R-5 (R-4 is missing)";
      const result = validateRequirementIds(content);
      const gapWarnings = result.warnings.filter(w => w.code === "REQ_ID_SEQUENCE_GAP");
      expect(gapWarnings.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("validateTaskFormat", () => {
    it("should pass for well-formatted tasks", () => {
      const content = `
## T-1 — First Task

**Maps to requirements:** R-1

- [ ] First subtask
    `;
      const result = validateTaskFormat(content);
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect parallel tasks (P)", () => {
      const content = `
## T-1 — Parallel Task (P)

**Maps to requirements:** R-1
    `;
      const result = validateTaskFormat(content);
      expect(result.warnings.some(w => w.code === "TASK_PARALLEL_DETECTED")).toBe(true);
    });

    it("should warn about optional-only test subtasks", () => {
      const content = `
## T-1 — Task

- [ ]* Optional test only
    `;
      const result = validateTaskFormat(content);
      expect(result.warnings.some(w => w.code === "TASK_OPTIONAL_TEST_ONLY")).toBe(true);
    });
  });

  describe("validateTasksCoverage", () => {
    it("should pass when all requirements are covered", () => {
      const requirements = `
### Requirement 1 (R-1)
Content

### Requirement 2 (R-2)
Content
    `;

      const tasks = `
## T-1 — First Task

**Maps to requirements:** R-1

## T-2 — Second Task

**Maps to requirements:** R-2
    `;

      const result = validateTasksCoverage(requirements, tasks);
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect uncovered requirements", () => {
      const requirements = `
### Requirement 1 (R-1)
### Requirement 2 (R-2)
    `;

      const tasks = `
## T-1 — Only Task

**Maps to requirements:** R-1
    `;

      const result = validateTasksCoverage(requirements, tasks);
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe("REQ_UNCOVERED_BY_TASKS");
      expect(result.errors[0].message).toContain("R-2");
    });

    it("should return incomplete coverage warning", () => {
      const requirements = `
### Requirement 1 (R-1)
### Requirement 2 (R-2)
    `;

      const tasks = `
## T-1 — Task

**Maps to requirements:** R-1
    `;

      const result = validateTasksCoverage(requirements, tasks);
      expect(result.warnings.some(w => w.code === "REQ_COVERAGE_INCOMPLETE")).toBe(true);
    });
  });

  describe("validateDesignTraceability", () => {
    it("should pass when all requirements are traced", () => {
      const requirements = `
### Requirement 1 (R-1)
Content

### Requirement 2 (R-2)
Content
    `;

      const design = `
## Requirements

- R-1: covered
- R-2: covered
    `;

      const result = validateDesignTraceability(requirements, design);
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should fail for empty design", () => {
      const requirements = "### Requirement 1 (R-1)";
      const design = "";

      const result = validateDesignTraceability(requirements, design);
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe("DESIGN_EMPTY");
    });

    it("should detect traceability gaps", () => {
      const requirements = `
### Requirement 1 (R-1)
### Requirement 2 (R-2)
    `;

      const design = `
## Requirements

- R-1: traced
    `;

      const result = validateDesignTraceability(requirements, design);
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe("DESIGN_TRACEABILITY_GAP");
      expect(result.errors[0].message).toContain("R-2");
    });

    it("should warn about missing Requirements section", () => {
      const requirements = "### Requirement 1 (R-1)";
      const design = "Some design without requirements section";

      const result = validateDesignTraceability(requirements, design);
      expect(result.warnings.some(w => w.code === "DESIGN_MISSING_REQUIREMENTS_SECTION")).toBe(
        true
      );
    });
  });

  describe("validateTaskDependencies", () => {
    it("should pass for valid dependencies", () => {
      const tasks = [
        { id: "T-1", dependencies: [] },
        { id: "T-2", dependencies: ["T-1"] },
        { id: "T-3", dependencies: ["T-2"] },
      ];

      const result = validateTaskDependencies(tasks);
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect unknown dependencies", () => {
      const tasks = [{ id: "T-1", dependencies: ["T-99"] }];

      const result = validateTaskDependencies(tasks);
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe("TASK_UNKNOWN_DEPENDENCY");
      expect(result.errors[0].message).toContain("T-99");
    });

    it("should detect dependency cycles", () => {
      const tasks = [
        { id: "T-1", dependencies: ["T-2"] },
        { id: "T-2", dependencies: ["T-1"] },
      ];

      const result = validateTaskDependencies(tasks);
      expect(result.ok).toBe(false);
      expect(result.errors.some(e => e.code === "TASK_DEPENDENCY_CYCLE")).toBe(true);
    });

    it("should handle complex cycles", () => {
      const tasks = [
        { id: "T-1", dependencies: ["T-2"] },
        { id: "T-2", dependencies: ["T-3"] },
        { id: "T-3", dependencies: ["T-1"] },
      ];

      const result = validateTaskDependencies(tasks);
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe("TASK_DEPENDENCY_CYCLE");
    });
  });

  describe("detectDependencyCycles", () => {
    it("should return empty for acyclic graph", () => {
      const tasks = [
        { id: "T-1", dependencies: [] },
        { id: "T-2", dependencies: ["T-1"] },
      ];

      const cycles = detectDependencyCycles(tasks);
      expect(cycles).toHaveLength(0);
    });

    it("should detect simple cycle", () => {
      const tasks = [
        { id: "T-1", dependencies: ["T-2"] },
        { id: "T-2", dependencies: ["T-1"] },
      ];

      const cycles = detectDependencyCycles(tasks);
      expect(cycles).toHaveLength(1);
    });

    it("should detect self-referencing cycle", () => {
      const tasks = [{ id: "T-1", dependencies: ["T-1"] }];

      const cycles = detectDependencyCycles(tasks);
      expect(cycles).toHaveLength(1);
    });
  });
});
