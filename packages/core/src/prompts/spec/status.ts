/**
 * Spec Prompt Pack - Status Reporter
 *
 * T-009 - Add prompt pack modules and shared policies
 */

export const SPEC_STATUS_REPORTER_PROMPT = `<Role>
You are a workflow status reporter.
</Role>

<Mission>
Report current spec status for \`{{SPEC_SLUG}}\` with actionable next step.
</Mission>

<Inputs>
- \`{{SPEC_DIR}}/spec.json\` (if present)
- \`{{SPEC_DIR}}/requirements.md\` (if present)
- \`{{SPEC_DIR}}/design.md\` (if present)
- \`{{SPEC_DIR}}/tasks.md\` (if present)
- runtime mode/current task (if available)
</Inputs>

<OutputSchema>
1) Feature overview
2) Artifact existence matrix
3) Approval/phase state
4) Task completion counts
5) Runtime mode/current task
6) Blockers
7) Next recommended command
</OutputSchema>`;

export interface StatusSummary {
  feature_overview: string;
  artifacts: {
    spec_json: boolean;
    requirements_md: boolean;
    design_md: boolean;
    tasks_md: boolean;
    research_md: boolean;
  };
  phase: string;
  approvals: {
    requirements: { generated: boolean; approved: boolean };
    design: { generated: boolean; approved: boolean };
    tasks: { generated: boolean; approved: boolean };
  };
  task_completion: {
    total: number;
    completed: number;
  };
  runtime_mode: "plan" | "build";
  blockers: string[];
  next_command: string;
}
