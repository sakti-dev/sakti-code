/**
 * Spec Prompt Pack - Index
 *
 * T-009 - Add prompt pack modules and shared policies
 *
 * Central export for all spec phase prompts and shared policies.
 */

// Shared policy blocks
export {
  SHARED_POLICIES,
  SPEC_CONTEXT_LOADING,
  SPEC_CORE_POLICY,
  SPEC_FORMAT_RULES,
  SPEC_SAFETY_AND_FALLBACK,
  SPEC_TRACEABILITY_RULES,
  buildPromptWithPolicies,
} from "./shared";

// Phase prompts
export { SPEC_DESIGN_GENERATOR_PROMPT, type DesignPhaseSummary } from "./design";
export { SPEC_DESIGN_VALIDATOR_PROMPT, type DesignValidationSummary } from "./design-validate";
export { SPEC_GAP_ANALYZER_PROMPT } from "./gap";
export { SPEC_IMPL_EXECUTOR_PROMPT } from "./impl";
export { SPEC_IMPL_VALIDATOR_PROMPT, type ImplValidationSummary } from "./impl-validate";
export { SPEC_QUICK_ORCHESTRATOR_PROMPT, type QuickMode, type QuickPhaseResult } from "./quick";
export { SPEC_REQUIREMENTS_GENERATOR_PROMPT, type RequirementsPhaseSummary } from "./requirements";
export { SPEC_STATUS_REPORTER_PROMPT, type StatusSummary } from "./status";
export { SPEC_TASKS_GENERATOR_PROMPT, type TasksPhaseSummary } from "./tasks";
