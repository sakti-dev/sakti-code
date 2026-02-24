/**
 * Spec Tools - Integration helpers for spec lifecycle tools
 *
 * Provides prompt builders and integration utilities for spec generation tools.
 * This module bridges the prompt pack with tool implementations.
 */

import {
  SPEC_CONTEXT_LOADING,
  SPEC_CORE_POLICY,
  SPEC_DESIGN_GENERATOR_PROMPT,
  SPEC_DESIGN_VALIDATOR_PROMPT,
  SPEC_FORMAT_RULES,
  SPEC_GAP_ANALYZER_PROMPT,
  SPEC_IMPL_EXECUTOR_PROMPT,
  SPEC_IMPL_VALIDATOR_PROMPT,
  SPEC_QUICK_ORCHESTRATOR_PROMPT,
  SPEC_REQUIREMENTS_GENERATOR_PROMPT,
  SPEC_SAFETY_AND_FALLBACK,
  SPEC_STATUS_REPORTER_PROMPT,
  SPEC_TASKS_GENERATOR_PROMPT,
  SPEC_TRACEABILITY_RULES,
} from "../prompts/spec";

/**
 * Spec context variables for prompt expansion
 */
export interface SpecPromptContext {
  workspaceDir: string;
  kiroDir?: string;
  specSlug: string;
  sessionId?: string;
  runtimeMode?: "plan" | "build";
  lang?: string;
}

/**
 * Get spec directory path from context
 */
export function getSpecDir(context: SpecPromptContext): string {
  const kiroDir = context.kiroDir || ".kiro";
  return `${context.workspaceDir}/${kiroDir}/specs/${context.specSlug}`;
}

/**
 * Expand placeholders in a prompt template
 */
export function expandPromptPlaceholders(template: string, context: SpecPromptContext): string {
  const kiroDir = context.kiroDir || ".kiro";
  const specDir = getSpecDir(context);

  return template
    .replace(/\{\{WORKSPACE_DIR\}\}/g, context.workspaceDir)
    .replace(/\{\{KIRO_DIR\}\}/g, kiroDir)
    .replace(/\{\{SPEC_SLUG\}\}/g, context.specSlug)
    .replace(/\{\{SPEC_DIR\}\}/g, specDir)
    .replace(/\{\{SESSION_ID\}\}/g, context.sessionId || "unknown")
    .replace(/\{\{RUNTIME_MODE\}\}/g, context.runtimeMode || "plan")
    .replace(/\{\{LANG\}\}/g, context.lang || "en");
}

/**
 * Build requirements generation prompt with context
 */
export function buildRequirementsPrompt(context: SpecPromptContext): string {
  return expandPromptPlaceholders(SPEC_REQUIREMENTS_GENERATOR_PROMPT, context);
}

/**
 * Build gap analyzer prompt with context
 */
export function buildGapAnalyzerPrompt(context: SpecPromptContext): string {
  return expandPromptPlaceholders(SPEC_GAP_ANALYZER_PROMPT, context);
}

/**
 * Build design generator prompt with context
 */
export function buildDesignPrompt(context: SpecPromptContext): string {
  return expandPromptPlaceholders(SPEC_DESIGN_GENERATOR_PROMPT, context);
}

/**
 * Build design validator prompt with context
 */
export function buildDesignValidationPrompt(context: SpecPromptContext): string {
  return expandPromptPlaceholders(SPEC_DESIGN_VALIDATOR_PROMPT, context);
}

/**
 * Build tasks generator prompt with context
 */
export function buildTasksPrompt(context: SpecPromptContext): string {
  return expandPromptPlaceholders(SPEC_TASKS_GENERATOR_PROMPT, context);
}

/**
 * Build implementation executor prompt with context
 */
export function buildImplPrompt(context: SpecPromptContext): string {
  return expandPromptPlaceholders(SPEC_IMPL_EXECUTOR_PROMPT, context);
}

/**
 * Build implementation validator prompt with context
 */
export function buildImplValidationPrompt(context: SpecPromptContext): string {
  return expandPromptPlaceholders(SPEC_IMPL_VALIDATOR_PROMPT, context);
}

/**
 * Build status reporter prompt with context
 */
export function buildStatusPrompt(context: SpecPromptContext): string {
  return expandPromptPlaceholders(SPEC_STATUS_REPORTER_PROMPT, context);
}

/**
 * Build quick orchestrator prompt with context
 */
export function buildQuickPrompt(context: SpecPromptContext): string {
  return expandPromptPlaceholders(SPEC_QUICK_ORCHESTRATOR_PROMPT, context);
}

/**
 * Get shared policy blocks for direct use
 */
export const sharedPolicies = {
  corePolicy: SPEC_CORE_POLICY,
  contextLoading: SPEC_CONTEXT_LOADING,
  formatRules: SPEC_FORMAT_RULES,
  traceabilityRules: SPEC_TRACEABILITY_RULES,
  safetyAndFallback: SPEC_SAFETY_AND_FALLBACK,
};

/**
 * Verify prompt includes required shared policies
 * Checks for key content markers from each policy block
 */
export function verifyPromptComposition(prompt: string): {
  valid: boolean;
  missingPolicies: string[];
} {
  const requiredMarkers = [
    { name: "SPEC_CORE_POLICY", marker: "Non-negotiable rules:" },
    { name: "SPEC_CONTEXT_LOADING", marker: "Required context loading sequence" },
    { name: "SPEC_FORMAT_RULES", marker: "Formatting constraints:" },
    { name: "SPEC_TRACEABILITY_RULES", marker: "Traceability rules:" },
    { name: "SPEC_SAFETY_AND_FALLBACK", marker: "Fallback behavior:" },
  ];

  const missingPolicies = requiredMarkers
    .filter(block => !prompt.includes(block.marker))
    .map(block => block.name);

  return {
    valid: missingPolicies.length === 0,
    missingPolicies,
  };
}
