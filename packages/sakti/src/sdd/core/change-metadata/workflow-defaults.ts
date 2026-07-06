import type { ChangeMetadata, Workflow } from "./schema.js";

/**
 * Returns the initial state-machine field values for a given workflow type.
 *
 * - `full`: build decisions stay null until the user selects them in build phase
 * - `hotfix`/`tweak`: preset to `direct` execution, `branch` isolation, `light` verify
 *
 * Fields not listed here (auto_transition, verify_result, branch_status, etc.)
 * use their schema defaults via ChangeMetadataSchema.
 */
export function getStateDefaultsForWorkflow(workflow: Workflow): Partial<ChangeMetadata> {
  const base = {
    workflow,
    phase: "open" as const,
  };

  switch (workflow) {
    case "full":
      return {
        ...base,
        build_mode: null,
        review_mode: null,
        isolation: null,
        verify_mode: null,
      };
    case "hotfix":
    case "tweak":
      return {
        ...base,
        build_mode: "direct",
        review_mode: "off",
        isolation: "branch",
        verify_mode: "light",
      };
  }
}
