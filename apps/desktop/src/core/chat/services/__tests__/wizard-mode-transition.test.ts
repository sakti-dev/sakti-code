/**
 * T-022: Plan->Build transition from wizard completion tests
 *
 * Renderer-side wizard flow should remain browser-safe and rely on
 * workflow state, not filesystem-backed spec state.
 */

import { clearWorkflowStore, upsertWorkflowState } from "@/state/stores/workflow-state-store";
import { beforeEach, describe, expect, it } from "vitest";
import { createSpecWizardController, type WizardActionId } from "../spec-wizard-controller";

describe("SpecWizardController - Plan->Build Transition (T-022)", () => {
  let controller: ReturnType<typeof createSpecWizardController>;
  let sessionId: string;

  beforeEach(() => {
    clearWorkflowStore();
    controller = createSpecWizardController();
    sessionId = "test-session-001";
  });

  describe("Start Implementation button visibility", () => {
    it("shows enabled action when workflow phase is complete", async () => {
      upsertWorkflowState({
        sessionId,
        specSlug: "test-feature",
        phase: "complete",
        specType: "comprehensive",
        responses: [],
        updatedAt: Date.now(),
      });

      const buttons = await controller.getWizardButtons(sessionId);
      const startImplButton = buttons.find(
        button => button.action === "wizard:start-implementation"
      );
      expect(startImplButton).toBeDefined();
      expect(startImplButton?.label).toBe("Start Implementation");
      expect(startImplButton?.variant).toBe("primary");
      expect(startImplButton?.disabled).toBe(false);
    });

    it("does not show start action when workflow is not complete", async () => {
      upsertWorkflowState({
        sessionId,
        specSlug: "test-feature",
        phase: "tasks",
        specType: "comprehensive",
        responses: [],
        updatedAt: Date.now(),
      });

      const buttons = await controller.getWizardButtons(sessionId);
      const startImplButton = buttons.find(
        button => button.action === "wizard:start-implementation"
      );
      expect(startImplButton).toBeUndefined();
    });
  });

  describe("Start Implementation action handling", () => {
    it("handles start implementation action without throwing for complete workflow", async () => {
      upsertWorkflowState({
        sessionId,
        specSlug: "test-feature",
        phase: "complete",
        specType: "comprehensive",
        responses: [],
        updatedAt: Date.now(),
      });

      await expect(
        controller.handleAction("wizard:start-implementation" satisfies WizardActionId, sessionId)
      ).resolves.not.toThrow();
    });

    it("handles start implementation action without throwing for incomplete workflow", async () => {
      upsertWorkflowState({
        sessionId,
        specSlug: "test-feature",
        phase: "tasks",
        specType: "comprehensive",
        responses: [],
        updatedAt: Date.now(),
      });

      await expect(
        controller.handleAction("wizard:start-implementation" satisfies WizardActionId, sessionId)
      ).resolves.not.toThrow();
    });
  });
});
