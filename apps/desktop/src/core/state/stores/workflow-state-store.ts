/**
 * Workflow State Store
 *
 * In-memory store for spec wizard workflow state.
 * Follows the same pattern as session-message-store.
 */

/**
 * Workflow state model
 */
export interface SpecWorkflowState {
  sessionId: string;
  specSlug?: string;
  phase: "init" | "requirements" | "design" | "tasks" | "complete";
  specType?: "comprehensive" | "quick";
  responses: Array<{ phase: string; payload: Record<string, unknown> }>;
  updatedAt: number;
}

const workflowStore = new Map<string, SpecWorkflowState>();

export type WorkflowPhase = SpecWorkflowState["phase"];

/**
 * Clear all workflow states (useful for testing)
 */
export function clearWorkflowStore(): void {
  workflowStore.clear();
}

/**
 * Get workflow state by session ID
 * @param sessionId - Session ID to retrieve
 * @returns Workflow state or null if not found
 */
export function getWorkflowState(sessionId: string): SpecWorkflowState | null {
  return workflowStore.get(sessionId) ?? null;
}

/**
 * Upsert workflow state for a session
 * Creates new state or updates existing state
 * @param state - Workflow state to upsert
 */
export function upsertWorkflowState(state: SpecWorkflowState): void {
  workflowStore.set(state.sessionId, state);
}

/**
 * Initialize workflow state after homepage spec selection.
 */
export function initializeWorkflowFromHomepage(
  sessionId: string,
  specType: "comprehensive" | "quick"
): void {
  upsertWorkflowState({
    sessionId,
    phase: specType === "quick" ? "tasks" : "requirements",
    specType,
    responses: [],
    updatedAt: Date.now(),
  });
}

/**
 * Add a response to workflow state
 * @param sessionId - Session ID
 * @param phase - Phase for the response
 * @param payload - Response payload
 */
export function addWorkflowResponse(
  sessionId: string,
  phase: string,
  payload: Record<string, unknown>
): void {
  const state = workflowStore.get(sessionId);
  if (!state) return;

  state.responses.push({ phase, payload });
  state.updatedAt = Date.now();
}

/**
 * Update workflow phase
 * @param sessionId - Session ID
 * @param phase - New phase
 */
export function updateWorkflowPhase(sessionId: string, phase: SpecWorkflowState["phase"]): void {
  const state = workflowStore.get(sessionId);
  if (!state) return;

  state.phase = phase;
  state.updatedAt = Date.now();
}

/**
 * Update workflow spec type
 * @param sessionId - Session ID
 * @param specType - Spec type
 */
export function updateWorkflowSpecType(
  sessionId: string,
  specType: SpecWorkflowState["specType"]
): void {
  const state = workflowStore.get(sessionId);
  if (!state) return;

  state.specType = specType;
  state.updatedAt = Date.now();
}

/**
 * Update workflow spec slug
 * @param sessionId - Session ID
 * @param specSlug - Spec slug
 */
export function updateWorkflowSpecSlug(sessionId: string, specSlug: string): void {
  const state = workflowStore.get(sessionId);
  if (!state) return;

  state.specSlug = specSlug;
  state.updatedAt = Date.now();
}

/**
 * Clear workflow state for a session
 * @param sessionId - Session ID to clear
 */
export function clearWorkflowState(sessionId: string): void {
  workflowStore.delete(sessionId);
}

/**
 * Get all workflow states
 * @returns Array of all workflow states
 */
export function getAllWorkflowStates(): SpecWorkflowState[] {
  return Array.from(workflowStore.values());
}
