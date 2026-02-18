/**
 * Agent configuration constants
 *
 * Model assignments and iteration limits for each agent phase.
 */

import { AgentType } from "./types";

/**
 * Model assignments for each agent phase
 * - explore: Cost-effective model for quick exploration
 * - plan: High-quality model for careful planning
 * - build: High-quality model for code generation
 */
export const PHASE_MODELS: Record<AgentType, string> = {
  explore: "glm-4.7-flashx", // Cost-effective
  plan: "glm-4.7", // High quality
  build: "glm-4.7", // High quality code generation
};

/**
 * Iteration limits for each agent phase
 * Prevents infinite loops while allowing sufficient iterations
 */
export const PHASE_ITERATION_LIMITS: Record<AgentType, number> = {
  explore: 30,
  plan: 100,
  build: 50,
};
