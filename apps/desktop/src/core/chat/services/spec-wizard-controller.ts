/**
 * Spec Wizard Controller
 *
 * Orchestrates spec wizard workflow with phase-based button rendering.
 */

import type { IntentResult } from "@/core/chat/services/intent-analyzer";
import type { SpecWorkflowState, WorkflowPhase } from "@/state/stores/workflow-state-store";
import {
  getWorkflowState,
  initializeWorkflowFromHomepage,
  updateWorkflowPhase,
  upsertWorkflowState,
} from "@/state/stores/workflow-state-store";
import type {
  ActionButton,
  ActionButtonVariant,
} from "@/views/workspace-view/chat-area/parts/action-button-part";

/**
 * Wizard phase button definitions
 */
interface WizardPhaseButton {
  id: string;
  label: string;
  action: string;
  variant: ActionButtonVariant;
  disabled?: boolean;
}

/**
 * Wizard button action IDs
 */
export type WizardActionId =
  | "wizard:start:comprehensive"
  | "wizard:start:quick"
  | "wizard:requirements:revise"
  | "wizard:requirements:approve"
  | "wizard:design:revise"
  | "wizard:design:approve"
  | "wizard:tasks:approve"
  | "wizard:start-implementation"
  | "spec-status";

/**
 * Wizard controller interface
 */
export interface SpecWizardController {
  /**
   * Determine if wizard should be offered based on intent analysis
   */
  shouldOfferWizard(intentResult: IntentResult, sessionId: string): boolean;

  /**
   * Get wizard buttons for current phase
   */
  getWizardButtons(sessionId: string): Promise<ActionButton[]>;

  /**
   * Handle wizard action
   */
  handleAction(actionId: WizardActionId, sessionId: string): Promise<void>;

  /**
   * Get current wizard state
   */
  getWizardState(sessionId: string): SpecWorkflowState | null;

  /**
   * Generate session title based on first user message
   */
  generateSessionTitle(firstUserMessage: string): string;

  /**
   * Get current wizard phase
   */
  getPhase(sessionId: string): WorkflowPhase | null;
}

/**
 * Create spec wizard controller
 * @returns Wizard controller instance
 */
export function createSpecWizardController(): SpecWizardController {
  const WIZARD_OFFER_THRESHOLD = 0.7;

  /**
   * Check if implementation is ready based on spec.json
   * @param state - Workflow state
   * @returns true if ready for implementation, false otherwise
   */
  async function isReadyForImplementation(state: SpecWorkflowState): Promise<boolean> {
    return state.phase === "complete";
  }

  /**
   * Handle Plan->Build transition
   * @param sessionId - Session ID
   * @returns Transition result
   */
  async function handlePlanToBuildTransition(
    sessionId: string
  ): Promise<{ outcome: string; fromMode?: string; toMode?: string; error?: string }> {
    const state = getWorkflowState(sessionId);
    if (!state || state.phase !== "complete") {
      return {
        outcome: "denied",
        fromMode: "plan",
        toMode: "build",
      };
    }

    return {
      outcome: "approved",
      fromMode: "plan",
      toMode: "build",
    };
  }

  /**
   * Generate session title based on first user message
   * @param firstUserMessage - First message in the session
   * @returns Generated session title
   */
  function generateSessionTitle(firstUserMessage: string): string {
    if (!firstUserMessage || firstUserMessage.trim().length === 0) {
      return "Untitled Session";
    }

    // Generate a concise title (max 50 chars)
    const maxLength = 50;
    let title = firstUserMessage.trim();
    if (title.length > maxLength) {
      title = title.substring(0, maxLength - 3) + "...";
    }

    return title;
  }

  /**
   * Get phase buttons for init phase (entry point)
   */
  function getInitButtons(): WizardPhaseButton[] {
    return [
      {
        id: "start-comprehensive",
        label: "Comprehensive Spec",
        action: "wizard:start:comprehensive",
        variant: "primary",
      },
      {
        id: "start-quick",
        label: "Quick Spec",
        action: "wizard:start:quick",
        variant: "secondary",
      },
    ];
  }

  /**
   * Get phase buttons for requirements phase
   */
  function getRequirementsButtons(_workflow: SpecWorkflowState): WizardPhaseButton[] {
    return [
      {
        id: "add-requirements",
        label: "Add More Requirements",
        action: "wizard:requirements:revise",
        variant: "secondary",
      },
      {
        id: "approve-requirements",
        label: "Approve Requirements and Continue",
        action: "wizard:requirements:approve",
        variant: "primary",
      },
    ];
  }

  /**
   * Get phase buttons for design phase
   */
  function getDesignButtons(_workflow: SpecWorkflowState): WizardPhaseButton[] {
    return [
      {
        id: "request-changes",
        label: "Request Changes",
        action: "wizard:design:revise",
        variant: "secondary",
      },
      {
        id: "approve-design",
        label: "Approve Design and Continue",
        action: "wizard:design:approve",
        variant: "primary",
      },
    ];
  }

  /**
   * Get phase buttons for tasks phase
   */
  function getTasksButtons(
    _workflow: SpecWorkflowState,
    blockers: string[] = []
  ): WizardPhaseButton[] {
    const hasBlockers = blockers && blockers.length > 0;

    return [
      {
        id: "approve-tasks",
        label: "Approve Tasks",
        action: "wizard:tasks:approve",
        variant: "primary",
        disabled: hasBlockers,
      },
      {
        id: "edit-spec",
        label: "Edit Spec",
        action: "spec-status",
        variant: "secondary",
      },
    ];
  }

  /**
   * Get phase buttons for complete phase
   */
  function getCompleteButtons(
    _workflow: SpecWorkflowState,
    readyForImplementation: boolean
  ): WizardPhaseButton[] {
    return [
      {
        id: "start-implementation",
        label: "Start Implementation",
        action: "wizard:start-implementation",
        variant: "primary",
        disabled: !readyForImplementation,
      },
      {
        id: "edit-spec-complete",
        label: "Edit Spec",
        action: "spec-status",
        variant: "secondary",
      },
    ];
  }

  return {
    shouldOfferWizard: (intentResult: IntentResult, sessionId: string): boolean => {
      const state = getWorkflowState(sessionId);

      // Don't offer if wizard already in progress
      if (state && state.phase !== "init") {
        return false;
      }

      // Only offer for high-confidence feature requests
      return (
        intentResult.kind === "feature_request" && intentResult.confidence >= WIZARD_OFFER_THRESHOLD
      );
    },

    getWizardButtons: async (sessionId: string): Promise<ActionButton[]> => {
      const state = getWorkflowState(sessionId);

      if (!state) {
        return [];
      }

      const phase = state.phase as WorkflowPhase;
      const _blockers: string[] = [];

      switch (phase) {
        case "init":
          return getInitButtons();
        case "requirements":
          return getRequirementsButtons(state);
        case "design":
          return getDesignButtons(state);
        case "tasks":
          return getTasksButtons(state, _blockers);
        case "complete":
          const ready = await isReadyForImplementation(state);
          return getCompleteButtons(state, ready);
        default:
          return [];
      }
    },

    handleAction: async (actionId: WizardActionId, sessionId: string): Promise<void> => {
      const state = getWorkflowState(sessionId);

      if (!state) {
        console.warn("[WizardController] No workflow state for session:", sessionId);
        return;
      }

      // Handle action based on current phase
      switch (actionId) {
        case "wizard:start:comprehensive": {
          updateWorkflowPhase(sessionId, "requirements");
          upsertWorkflowState({
            ...state,
            specType: "comprehensive",
          });
          break;
        }
        case "wizard:start:quick": {
          updateWorkflowPhase(sessionId, "tasks");
          upsertWorkflowState({
            ...state,
            specType: "quick",
          });
          break;
        }
        case "wizard:requirements:revise":
        case "wizard:design:revise":
          // These trigger re-generation of the phase artifact
          // For now, just log the action
          console.log(`[WizardController] Revise action for phase: ${state.phase}`);
          break;
        case "wizard:requirements:approve":
          updateWorkflowPhase(sessionId, "design");
          break;
        case "wizard:design:approve":
          updateWorkflowPhase(sessionId, "tasks");
          break;
        case "wizard:tasks:approve":
          updateWorkflowPhase(sessionId, "complete");
          break;
        case "wizard:start-implementation": {
          const result = await handlePlanToBuildTransition(sessionId);
          console.log(`[WizardController] Transition completed: ${result.outcome}`, result);
          break;
        }
        case "spec-status":
          // Status display action
          console.log(`[WizardController] Action: ${actionId}`);
          break;
        default:
          console.warn(`[WizardController] Unknown action: ${actionId}`);
      }
    },

    getWizardState: (sessionId: string): SpecWorkflowState | null => {
      return getWorkflowState(sessionId);
    },

    generateSessionTitle: (firstUserMessage: string): string => {
      return generateSessionTitle(firstUserMessage);
    },

    getPhase: (sessionId: string): WorkflowPhase | null => {
      const state = getWorkflowState(sessionId);
      return state?.phase ?? null;
    },
  };
}

/**
 * Initialize wizard workflow state from homepage spec selection.
 */
export function initializeWizardWorkflowFromHomepage(
  sessionId: string,
  specType: "comprehensive" | "quick"
): void {
  initializeWorkflowFromHomepage(sessionId, specType);
}
