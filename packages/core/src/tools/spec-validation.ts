/**
 * Spec Validation Tools - spec-validate-gap, spec-validate-design, spec-validate-impl
 *
 * T-008 - Add validation tools and registry wiring
 * Returns { ok, phase, errors, warnings, summary, nextSteps }
 */

import { tool as aiTool } from "ai";
import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { Instance } from "../instance";
import { parseTasksMdStrict } from "../spec/parser";
import {
  extractRequirementIds,
  validateDesignTraceability,
  validateRequirementIds,
  validateTaskDependencies,
  validateTaskFormat,
  validateTasksCoverage,
  type ParsedTaskDependency,
} from "../spec/validators";

export interface SpecValidationResponse {
  ok: boolean;
  phase: "gap" | "design" | "impl";
  errors: Array<{ code: string; message: string; location?: string }>;
  warnings: Array<{ code: string; message: string; location?: string }>;
  summary: string;
  nextSteps: string[];
}

async function getSpecDir(): Promise<string | null> {
  const instanceContext = Instance.context;
  if (!instanceContext) return null;
  return path.join(instanceContext.directory, ".kiro", "specs");
}

async function _readSpecFile(
  specSlug: string,
  filename: string
): Promise<{ content: string; path: string } | null> {
  const specDir = await getSpecDir();
  if (!specDir) return null;

  const filePath = path.join(specDir, specSlug, filename);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return { content, path: filePath };
  } catch {
    return null;
  }
}

function buildValidationResponse(
  ok: boolean,
  phase: "gap" | "design" | "impl",
  errors: Array<{ code: string; message: string; location?: string }>,
  warnings: Array<{ code: string; message: string; location?: string }>,
  customSummary?: string
): SpecValidationResponse {
  let summary = customSummary || "";

  if (ok) {
    summary = summary || "Validation passed. No critical issues found.";
  } else {
    const errorCount = errors.length;
    const warningCount = warnings.length;
    summary =
      summary || `Validation failed with ${errorCount} error(s) and ${warningCount} warning(s).`;
  }

  const nextSteps: string[] = [];
  if (!ok) {
    if (phase === "gap") {
      nextSteps.push("Review and fix requirement ID format issues");
      nextSteps.push("Ensure all requirements are properly numbered");
    } else if (phase === "design") {
      nextSteps.push("Update design.md to trace all requirements");
      nextSteps.push("Add missing requirement references");
    } else if (phase === "impl") {
      nextSteps.push("Fix task dependencies (unknown refs or cycles)");
      nextSteps.push("Ensure all requirements are covered by tasks");
    }
  } else {
    if (phase === "gap") {
      nextSteps.push("Proceed to spec-requirements to generate requirements.md");
    } else if (phase === "design") {
      nextSteps.push("Proceed to spec-tasks to generate tasks.md");
    } else if (phase === "impl") {
      nextSteps.push("Ready for implementation - use plan-exit to switch to build mode");
    }
  }

  return {
    ok,
    phase,
    errors,
    warnings,
    summary,
    nextSteps,
  };
}

export const specValidateGapTool = aiTool({
  description: `Validate spec requirements and gap analysis.

Validates:
- Requirement ID format (R-1, R-2, etc.)
- Requirement ID sequence continuity
- Generates gap analysis between requirements and existing code (if available)

Use this after spec-init or after requirements.md changes.`,

  inputSchema: z.object({
    spec_slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/)
      .describe("URL-friendly slug for the spec"),
  }),

  execute: async params => {
    const { spec_slug } = params;

    const instanceContext = Instance.context;
    if (!instanceContext) {
      return { error: "Spec tools must be run within an Instance.provide() context" };
    }

    const errors: Array<{ code: string; message: string; location?: string }> = [];
    const warnings: Array<{ code: string; message: string; location?: string }> = [];

    const specDir = path.join(instanceContext.directory, ".kiro", "specs", spec_slug);

    let requirementsContent = "";
    const requirementsPath = path.join(specDir, "requirements.md");
    try {
      requirementsContent = await fs.readFile(requirementsPath, "utf-8");
    } catch {
      errors.push({
        code: "REQUIREMENTS_MISSING",
        message: "requirements.md not found. Run spec-requirements first.",
        location: requirementsPath,
      });
      return buildValidationResponse(false, "gap", errors, warnings);
    }

    const reqValidation = validateRequirementIds(requirementsContent);
    errors.push(...reqValidation.errors);
    warnings.push(...reqValidation.warnings);

    const reqIds = extractRequirementIds(requirementsContent);
    if (reqIds.length === 0) {
      warnings.push({
        code: "REQUIREMENTS_EMPTY",
        message: "No valid requirement IDs found in requirements.md",
      });
    }

    return buildValidationResponse(errors.length === 0, "gap", errors, warnings);
  },
});

export const specValidateDesignTool = aiTool({
  description: `Validate design.md traceability against requirements.md.

Validates:
- All requirements are traced in design.md
- Design has required sections
- Requirement references are complete

Use this after design.md is generated.`,

  inputSchema: z.object({
    spec_slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/)
      .describe("URL-friendly slug for the spec"),
  }),

  execute: async params => {
    const { spec_slug } = params;

    const instanceContext = Instance.context;
    if (!instanceContext) {
      return { error: "Spec tools must be run within an Instance.provide() context" };
    }

    const errors: Array<{ code: string; message: string; location?: string }> = [];
    const warnings: Array<{ code: string; message: string; location?: string }> = [];

    const specDir = path.join(instanceContext.directory, ".kiro", "specs", spec_slug);

    let requirementsContent = "";
    const requirementsPath = path.join(specDir, "requirements.md");
    try {
      requirementsContent = await fs.readFile(requirementsPath, "utf-8");
    } catch {
      errors.push({
        code: "REQUIREMENTS_MISSING",
        message: "requirements.md not found. Run spec-requirements first.",
        location: requirementsPath,
      });
      return buildValidationResponse(false, "design", errors, warnings);
    }

    let designContent = "";
    const designPath = path.join(specDir, "design.md");
    try {
      designContent = await fs.readFile(designPath, "utf-8");
    } catch {
      errors.push({
        code: "DESIGN_MISSING",
        message: "design.md not found. Run spec-design first.",
        location: designPath,
      });
      return buildValidationResponse(false, "design", errors, warnings);
    }

    const designValidation = validateDesignTraceability(requirementsContent, designContent);
    errors.push(...designValidation.errors);
    warnings.push(...designValidation.warnings);

    return buildValidationResponse(errors.length === 0, "design", errors, warnings);
  },
});

export const specValidateImplTool = aiTool({
  description: `Validate tasks.md for implementation readiness.

Validates:
- Task format (P markers, optional test subtasks)
- Requirement coverage by tasks
- Task dependency graph integrity (DAG, no unknown refs)

Use this after tasks.md is generated, before plan-exit.`,

  inputSchema: z.object({
    spec_slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/)
      .describe("URL-friendly slug for the spec"),
  }),

  execute: async params => {
    const { spec_slug } = params;

    const instanceContext = Instance.context;
    if (!instanceContext) {
      return { error: "Spec tools must be run within an Instance.provide() context" };
    }

    const errors: Array<{ code: string; message: string; location?: string }> = [];
    const warnings: Array<{ code: string; message: string; location?: string }> = [];

    const specDir = path.join(instanceContext.directory, ".kiro", "specs", spec_slug);

    let requirementsContent = "";
    const requirementsPath = path.join(specDir, "requirements.md");
    try {
      requirementsContent = await fs.readFile(requirementsPath, "utf-8");
    } catch {
      errors.push({
        code: "REQUIREMENTS_MISSING",
        message: "requirements.md not found. Run spec-requirements first.",
        location: requirementsPath,
      });
    }

    let tasksContent = "";
    const tasksPath = path.join(specDir, "tasks.md");
    try {
      tasksContent = await fs.readFile(tasksPath, "utf-8");
    } catch {
      errors.push({
        code: "TASKS_MISSING",
        message: "tasks.md not found. Run spec-tasks first.",
        location: tasksPath,
      });
      return buildValidationResponse(false, "impl", errors, warnings);
    }

    const formatValidation = validateTaskFormat(tasksContent);
    errors.push(...formatValidation.errors);
    warnings.push(...formatValidation.warnings);

    if (requirementsContent) {
      const coverageValidation = validateTasksCoverage(requirementsContent, tasksContent);
      errors.push(...coverageValidation.errors);
      warnings.push(...coverageValidation.warnings);
    }

    const parsed = await parseTasksMdStrict(tasksPath);
    const dependencies: ParsedTaskDependency[] = parsed.map(task => ({
      id: task.id,
      dependencies: task.dependencies || [],
    }));

    const depValidation = validateTaskDependencies(dependencies);
    errors.push(...depValidation.errors);
    warnings.push(...depValidation.warnings);

    return buildValidationResponse(errors.length === 0, "impl", errors, warnings);
  },
});
