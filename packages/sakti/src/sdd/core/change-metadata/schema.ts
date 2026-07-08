import { z } from "zod";
import { isKebabId } from "../id.js";

export { isKebabId } from "../id.js";

const KebabIdentifierSchema = (label: string): z.ZodString =>
  z.string().superRefine((value, ctx) => {
    if (!isKebabId(value)) {
      ctx.addIssue({
        code: "custom",
        message: `${label} must be kebab-case with lowercase letters, numbers, and single hyphen separators`,
      });
    }
  });

export const InitiativeLinkSchema = z
  .object({
    store: KebabIdentifierSchema("Store id"),
    id: KebabIdentifierSchema("Initiative id"),
  })
  .strict();

export type InitiativeLink = z.infer<typeof InitiativeLinkSchema>;

// ── State machine enums ──────────────────────────────────────────

export const WorkflowSchema = z.enum(["full", "hotfix"]);
export type Workflow = z.infer<typeof WorkflowSchema>;

export const PhaseSchema = z.enum(["open", "specify", "build", "verify", "archive"]);
export type Phase = z.infer<typeof PhaseSchema>;

export const StateTransitionEventSchema = z.enum([
  "open-complete",
  "specify-complete",
  "build-complete",
  "verify-pass",
  "verify-fail",
  "archive-reopen",
  "archived",
]);
export type StateTransitionEvent = z.infer<typeof StateTransitionEventSchema>;

// ── Per-change metadata schema ───────────────────────────────────
// Per-change metadata schema. The schema field is validated against available
// workflow schemas when metadata is read or written.

export const ChangeMetadataSchema = z.object({
  schema: z.string().min(1, { message: "schema is required" }),
  created: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: "created must be YYYY-MM-DD format",
    })
    .optional(),
  goal: z.string().min(1).optional(),
  affected_areas: z.array(z.string().min(1)).optional(),
  initiative: InitiativeLinkSchema.optional(),

  // State machine — core
  workflow: WorkflowSchema.default("full"),
  phase: PhaseSchema.default("open"),
  auto_transition: z.boolean().default(true),

  // State machine — build decisions (null until user chooses)
  build_mode: z.enum(["subagent", "direct"]).nullable().default(null),
  build_pause: z.enum(["plan-ready"]).nullable().default(null),
  subagent_dispatch: z.enum(["confirmed"]).nullable().default(null),
  review_mode: z.enum(["off", "standard", "thorough"]).nullable().default(null),
  isolation: z.enum(["branch", "worktree"]).nullable().default(null),
  direct_override: z.boolean().default(false),

  // State machine — verify
  verify_mode: z.enum(["light", "full"]).nullable().default(null),
  verify_result: z.enum(["pending", "pass", "fail"]).default("pending"),
  verification_report: z.string().nullable().default(null),
  branch_status: z.enum(["pending", "handled"]).default("pending"),

  // State machine — links
  plan: z.string().nullable().default(null),
  base_ref: z.string().nullable().default(null),
  verified_at: z.string().nullable().default(null),
  archived: z.boolean().default(false),
});

export type ChangeMetadata = z.infer<typeof ChangeMetadataSchema>;

/**
 * Input type for ChangeMetadataSchema — fields with defaults are optional.
 * Use this when accepting partial metadata for writing (e.g. writeChangeMetadata).
 */
export type ChangeMetadataInput = z.input<typeof ChangeMetadataSchema>;
