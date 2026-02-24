/**
 * Spec Validators - Deterministic validation for spec artifacts
 *
 * Phase 2 - Spec System
 * Provides:
 * - validateRequirementIds: Extract and validate requirement ID format
 * - validateTasksCoverage: Check task coverage of requirements
 * - validateDesignTraceability: Check design coverage of requirements
 * - validateTaskFormat: Validate (P) and - [ ]* markers
 * - validateTaskDependencies: Validate dependency graph integrity
 */

export class SpecValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly location?: string
  ) {
    super(message);
    this.name = "SpecValidationError";
  }
}

export interface ValidationError {
  code: string;
  message: string;
  location?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  location?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

const VALID_REQUIREMENT_ID_REGEX = /^R-\d+$/;

export function extractRequirementIds(content: string): string[] {
  const ids: string[] = [];

  const strictRegex = /\b(R-\d+)\b/g;
  let match;
  while ((match = strictRegex.exec(content)) !== null) {
    const normalized = normalizeRequirementId(match[1]);
    if (normalized && !ids.includes(normalized)) {
      ids.push(normalized);
    }
  }

  const looseRegex = /\bR[\s:-]*(\d+)\b/gi;
  while ((match = looseRegex.exec(content)) !== null) {
    const normalized = normalizeRequirementId(match[0]);
    if (normalized && !ids.includes(normalized)) {
      ids.push(normalized);
    }
  }

  return ids.sort((a, b) => {
    const aNum = parseInt(a.replace("R-", ""), 10);
    const bNum = parseInt(b.replace("R-", ""), 10);
    return aNum - bNum;
  });
}

export function extractTaskIds(content: string): string[] {
  const ids: string[] = [];
  const regex = /\b(T-\d+)\b/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const id = match[1];
    if (!ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids.sort();
}

export function extractDesignSectionIds(content: string): Map<string, string[]> {
  const requirementMap = new Map<string, string[]>();
  const sectionRegex = /^##+\s+(.+?)(?:\s*\(R-[\d,]+\))?\s*$/gm;
  const idRegex = /\b(R-\d+)\b/g;

  let sectionMatch;
  let lastSectionName = "";

  while ((sectionMatch = sectionRegex.exec(content)) !== null) {
    lastSectionName = sectionMatch[1].trim();

    idRegex.lastIndex = sectionMatch.index + sectionMatch[0].length;
    let idMatch;

    while ((idMatch = idRegex.exec(content)) !== null) {
      if (idMatch.index < sectionRegex.lastIndex) {
        const existing = requirementMap.get(lastSectionName) || [];
        if (!existing.includes(idMatch[1])) {
          existing.push(idMatch[1]);
        }
        requirementMap.set(lastSectionName, existing);
      }
    }
  }

  return requirementMap;
}

export function normalizeRequirementId(id: string): string | null {
  const trimmed = id.trim().toUpperCase();

  if (VALID_REQUIREMENT_ID_REGEX.test(trimmed)) {
    return trimmed;
  }

  const numericMatch = trimmed.match(/^R[\s:-]*(\d+)$/i);
  if (numericMatch) {
    return `R-${parseInt(numericMatch[1], 10)}`;
  }

  return null;
}

export function validateRequirementIds(content: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const headingRegex = /^###\s+Requirement\s+(\d+)\s+/gm;
  let match;

  const foundNumericIds = new Set<string>();
  while ((match = headingRegex.exec(content)) !== null) {
    foundNumericIds.add(match[1]);
  }

  const extractedIds = extractRequirementIds(content);

  for (const id of extractedIds) {
    if (!VALID_REQUIREMENT_ID_REGEX.test(id)) {
      const normalized = normalizeRequirementId(id);
      if (normalized) {
        warnings.push({
          code: "REQ_ID_FORMAT_NORMALIZED",
          message: `Requirement ID "${id}" normalized to "${normalized}"`,
          location: id,
        });
      } else {
        errors.push({
          code: "REQ_ID_FORMAT_INVALID",
          message: `Invalid requirement ID format: "${id}". Expected format: R-1, R-2, etc.`,
          location: id,
        });
      }
    }
  }

  const numericIds = extractedIds
    .map(id => {
      const m = id.match(/^R-(\d+)$/);
      return m ? parseInt(m[1], 10) : null;
    })
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);

  if (numericIds.length > 0) {
    const min = numericIds[0];
    const max = numericIds[numericIds.length - 1];
    const expectedCount = max - min + 1;

    if (numericIds.length !== expectedCount) {
      const missing: number[] = [];
      for (let i = min; i <= max; i++) {
        if (!numericIds.includes(i)) {
          missing.push(i);
        }
      }
      warnings.push({
        code: "REQ_ID_SEQUENCE_GAP",
        message: `Requirement ID sequence has gaps. Missing: R-${missing.join(", R-")}`,
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateTaskFormat(content: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const parallelRegex = /^#{2,3}\s+(T-\d+)\s*[—–-]\s+(.+?)\s*\(P\)\s*$/gm;
  let match;

  const parallelTasks: string[] = [];
  while ((match = parallelRegex.exec(content)) !== null) {
    parallelTasks.push(match[1]);
  }

  const taskBodies = content.split(/^#{2,3}\s+(T-\d+)\s*[—–-]\s+/m);
  for (let i = 1; i < taskBodies.length; i += 2) {
    const taskId = taskBodies[i];
    const body = taskBodies[i + 1] || "";

    const subtaskOptionalRegex = /^-\s*\[\s*\]\s*\*\s*(.+)$/gm;
    const subtaskRequiredRegex = /^-\s*\[\s*\]\s+(?!\*)(.+)$/gm;

    let hasOptionalTest = false;
    let hasRequiredTest = false;

    while (subtaskOptionalRegex.exec(body) !== null) {
      hasOptionalTest = true;
    }

    while (subtaskRequiredRegex.exec(body) !== null) {
      hasRequiredTest = true;
    }

    if (hasOptionalTest && !hasRequiredTest) {
      warnings.push({
        code: "TASK_OPTIONAL_TEST_ONLY",
        message: `Task ${taskId} has only optional test subtasks (- [ ]*). Consider if at least one required test should exist.`,
        location: taskId,
      });
    }
  }

  const hasParallelTasks = parallelTasks.length > 0;
  if (hasParallelTasks) {
    warnings.push({
      code: "TASK_PARALLEL_DETECTED",
      message: `${parallelTasks.length} parallelizable task(s) detected: ${parallelTasks.join(", ")}. Verify dependencies are correct.`,
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateTasksCoverage(
  requirementsContent: string,
  tasksContent: string
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const requirementIds = extractRequirementIds(requirementsContent);
  const _taskIds = extractTaskIds(tasksContent);

  const taskBodies = tasksContent.split(/^#{2,3}\s+(T-\d+)\s*[—–-]\s+/m);
  const taskRequirementsMap = new Map<string, string[]>();

  for (let i = 1; i < taskBodies.length; i += 2) {
    const taskId = taskBodies[i];
    const body = taskBodies[i + 1] || "";

    const reqMatch = body.match(/\*\*Maps to requirements:\*\*\s*([\d,\sR\-]+)/i);
    if (reqMatch) {
      const reqs = extractRequirementIds(reqMatch[1]);
      taskRequirementsMap.set(taskId, reqs);
    }
  }

  const coveredRequirements = new Set<string>();
  const uncoveredRequirements: string[] = [];

  for (const reqId of requirementIds) {
    let isCovered = false;

    for (const reqs of Array.from(taskRequirementsMap.values())) {
      if (reqs.includes(reqId)) {
        isCovered = true;
        break;
      }
    }

    if (isCovered) {
      coveredRequirements.add(reqId);
    } else {
      uncoveredRequirements.push(reqId);
    }
  }

  if (uncoveredRequirements.length > 0) {
    errors.push({
      code: "REQ_UNCOVERED_BY_TASKS",
      message: `Requirement(s) not covered by any task: ${uncoveredRequirements.join(", ")}`,
    });
  }

  const totalReqs = requirementIds.length;
  const coveredCount = coveredRequirements.size;
  const coveragePercent = totalReqs > 0 ? Math.round((coveredCount / totalReqs) * 100) : 100;

  if (coveragePercent < 100 && totalReqs > 0) {
    warnings.push({
      code: "REQ_COVERAGE_INCOMPLETE",
      message: `Requirement coverage is ${coveragePercent}% (${coveredCount}/${totalReqs})`,
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateDesignTraceability(
  requirementsContent: string,
  designContent: string
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const requirementIds = extractRequirementIds(requirementsContent);

  if (!designContent || designContent.trim().length === 0) {
    errors.push({
      code: "DESIGN_EMPTY",
      message: "design.md is empty or missing",
    });
    return { ok: false, errors, warnings };
  }

  const designRequirementIds = extractRequirementIds(designContent);
  const designRequirementSet = new Set(designRequirementIds);

  const uncoveredRequirements: string[] = [];
  for (const reqId of requirementIds) {
    if (!designRequirementSet.has(reqId)) {
      uncoveredRequirements.push(reqId);
    }
  }

  if (uncoveredRequirements.length > 0) {
    errors.push({
      code: "DESIGN_TRACEABILITY_GAP",
      message: `Requirement(s) not traced in design.md: ${uncoveredRequirements.join(", ")}`,
    });
  }

  const totalReqs = requirementIds.length;
  const tracedCount = designRequirementSet.size;
  const traceabilityPercent = totalReqs > 0 ? Math.round((tracedCount / totalReqs) * 100) : 0;

  if (traceabilityPercent < 100 && totalReqs > 0) {
    warnings.push({
      code: "DESIGN_TRACEABILITY_INCOMPLETE",
      message: `Design traceability is ${traceabilityPercent}% (${tracedCount}/${totalReqs})`,
    });
  }

  const hasRequirementsSection = /^#{1,3}\s+Requirements/i.test(designContent);
  if (!hasRequirementsSection) {
    warnings.push({
      code: "DESIGN_MISSING_REQUIREMENTS_SECTION",
      message: "design.md is missing a Requirements section",
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export interface ParsedTaskDependency {
  id: string;
  dependencies: string[];
}

export function validateTaskDependencies(tasks: ParsedTaskDependency[]): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const taskIdSet = new Set(tasks.map(t => t.id));

  const unknownDependencies: string[] = [];
  for (const task of tasks) {
    for (const dep of task.dependencies || []) {
      if (!taskIdSet.has(dep)) {
        unknownDependencies.push(`${task.id} -> ${dep}`);
      }
    }
  }

  if (unknownDependencies.length > 0) {
    errors.push({
      code: "TASK_UNKNOWN_DEPENDENCY",
      message: `Unknown task dependencies: ${unknownDependencies.join(", ")}`,
    });
  }

  const cycles = detectDependencyCycles(tasks);
  if (cycles.length > 0) {
    for (const cycle of cycles) {
      errors.push({
        code: "TASK_DEPENDENCY_CYCLE",
        message: `Dependency cycle detected: ${cycle.join(" -> ")}`,
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function detectDependencyCycles(tasks: ParsedTaskDependency[]): string[][] {
  const deps: Map<string, string[]> = new Map();

  for (const task of tasks) {
    deps.set(task.id, task.dependencies || []);
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): boolean {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const neighbors = deps.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) {
          return true;
        }
      } else if (recursionStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        cycles.push([...path.slice(cycleStart), neighbor]);
        return true;
      }
    }

    path.pop();
    recursionStack.delete(node);
    return false;
  }

  for (const task of tasks) {
    if (!visited.has(task.id)) {
      path.length = 0;
      dfs(task.id);
    }
  }

  return cycles;
}
