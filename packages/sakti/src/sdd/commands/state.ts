/**
 * State Command
 *
 * Reads and updates the state-machine fields in a change's .sakti.yaml.
 * Subcommands: get, set, transition.
 */
import { promises as fs } from "fs";
import path from "path";
import type { ChangeMetadata, StateTransitionEvent } from "../core/change-metadata/index.js";
import { readChangeMetadata, writeChangeMetadata } from "../utils/change-metadata.js";

// Fields that may be read or written via `sakti state`.
export const STATE_FIELDS = [
  "workflow",
  "phase",
  "auto_transition",
  "build_mode",
  "build_pause",
  "subagent_dispatch",
  "review_mode",
  "isolation",
  "direct_override",
  "verify_mode",
  "verify_result",
  "verification_report",
  "branch_status",
  "design_doc",
  "plan",
  "base_ref",
  "verified_at",
  "archived",
] as const;

export type StateField = (typeof STATE_FIELDS)[number];

function assertKnownField(field: string): asserts field is StateField {
  if (!STATE_FIELDS.includes(field as StateField)) {
    throw new Error(`Unknown field '${field}'. Valid fields: ${STATE_FIELDS.join(", ")}`);
  }
}

/**
 * Reads a single state field from a change's .sakti.yaml.
 * Returns the value as a string (or "null"/"true"/"false" for scalars).
 */
export async function stateGet(changeDir: string, field: string): Promise<string> {
  assertKnownField(field);
  const metadata = readChangeMetadata(changeDir);
  if (!metadata) {
    throw new Error(`No .sakti.yaml found in ${changeDir}`);
  }
  const value = metadata[field];
  if (value === null || value === undefined) {
    return "null";
  }
  return String(value);
}

export interface StateSetOptions {
  projectRoot?: string;
  force?: boolean;
}

/**
 * Updates a single state field in a change's .sakti.yaml with validation.
 *
 * Direct `phase` writes are blocked — use `stateTransition` instead.
 * Pass `force: true` to override (repair escape hatch, mirrors comet's COMET_FORCE_PHASE).
 */
export async function stateSet(
  changeDir: string,
  field: string,
  value: string,
  options: StateSetOptions = {},
): Promise<void> {
  assertKnownField(field);

  if (field === "phase" && !options.force) {
    throw new Error(
      "Setting 'phase' directly is not allowed; use 'sakti state transition' for validated phase advances. " +
        "Repair escape hatch: pass force: true.",
    );
  }

  const metadata = readChangeMetadata(changeDir, options.projectRoot);
  if (!metadata) {
    throw new Error(`No .sakti.yaml found in ${changeDir}`);
  }

  const parsedValue = coerceValue(value);

  const updated: ChangeMetadata = {
    ...metadata,
    [field]: parsedValue,
  };

  writeChangeMetadata(changeDir, updated, options.projectRoot);
}

export interface StateTransitionOptions {
  projectRoot?: string;
}

/**
 * Applies a validated phase transition.
 *
 * Validates: current phase matches the event's expected source phase, and any
 * required evidence (artifacts, design_doc, verification_report) is present.
 * Does NOT run build commands or deep content checks — that's the guard's job.
 */
export async function stateTransition(
  changeDir: string,
  event: StateTransitionEvent,
  options: StateTransitionOptions = {},
): Promise<void> {
  const metadata = readChangeMetadata(changeDir, options.projectRoot);
  if (!metadata) {
    throw new Error(`No .sakti.yaml found in ${changeDir}`);
  }

  const requirePhase = (expected: string): void => {
    if (metadata.phase !== expected) {
      throw new Error(
        `Cannot transition '${event}': expected phase ${expected}, got ${metadata.phase}`,
      );
    }
  };

  const apply = (changes: Partial<ChangeMetadata>): void => {
    writeChangeMetadata(changeDir, { ...metadata, ...changes }, options.projectRoot);
  };

  switch (event) {
    case "open-complete": {
      requirePhase("open");
      const artifacts =
        metadata.workflow === "full"
          ? ["proposal.md", "design.md", "tasks.md"]
          : ["proposal.md", "tasks.md"];
      for (const artifact of artifacts) {
        try {
          await fs.access(path.join(changeDir, artifact));
        } catch {
          throw new Error(
            `Cannot transition 'open-complete': ${artifact} must exist and be non-empty before leaving open`,
          );
        }
      }
      const nextPhase = metadata.workflow === "full" ? "design" : "build";
      apply({ phase: nextPhase });
      break;
    }

    case "design-complete": {
      requirePhase("design");
      if (!metadata.design_doc) {
        throw new Error(
          "Cannot transition 'design-complete': design_doc must point to an existing Design Doc before leaving design",
        );
      }
      try {
        await fs.access(path.join(changeDir, metadata.design_doc));
      } catch {
        throw new Error(
          `Cannot transition 'design-complete': design_doc file '${metadata.design_doc}' does not exist`,
        );
      }
      apply({ phase: "build" });
      break;
    }

    case "build-complete": {
      requirePhase("build");
      const changes: Partial<ChangeMetadata> = { phase: "verify", verify_result: "pending" };
      if (metadata.verify_result !== "fail") {
        changes.verification_report = null;
        changes.branch_status = "pending";
      }
      apply(changes);
      break;
    }

    case "verify-pass": {
      requirePhase("verify");
      if (!metadata.verification_report) {
        throw new Error(
          "Cannot transition 'verify-pass': verification_report must point to an existing report file",
        );
      }
      if (metadata.branch_status !== "handled") {
        throw new Error("Cannot transition 'verify-pass': branch_status must be handled");
      }
      const today = new Date().toISOString().split("T")[0];
      apply({
        verify_result: "pass",
        phase: "archive",
        verified_at: today,
      });
      break;
    }

    case "verify-fail": {
      requirePhase("verify");
      apply({ verify_result: "fail", phase: "build" });
      break;
    }

    case "archive-reopen": {
      requirePhase("archive");
      if (metadata.archived) {
        throw new Error("Cannot transition 'archive-reopen': already archived");
      }
      apply({ verify_result: "pending", phase: "verify", verified_at: null });
      break;
    }

    case "archived": {
      requirePhase("archive");
      if (metadata.verify_result !== "pass") {
        throw new Error(
          "Cannot transition 'archived': verify_result must be pass before archiving",
        );
      }
      apply({ archived: true });
      break;
    }
  }
}

/**
 * Coerces a string CLI value into the correct type for the field.
 * Relies on ChangeMetadataSchema (Zod) to reject invalid enum values.
 */
function coerceValue(value: string): unknown {
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}
