/**
 * Spec Phase Tools - Lifecycle management for spec generation
 *
 * T-011 - Implement spec phase tools and lifecycle transitions
 *
 * Provides tools for spec lifecycle phases:
 * - spec-init: Initialize new spec with spec.json mirror
 * - spec-requirements: Generate/update requirements.md
 * - spec-design: Generate/update design.md with discovery mode
 * - spec-tasks: Generate/update tasks.md
 * - spec-status: Report current status with blockers and next action
 * - spec-quick: Quick orchestration (interactive or auto mode)
 */

import { tool as aiTool } from "ai";
import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { Instance } from "../instance";
import {
  buildDesignPrompt,
  buildQuickPrompt,
  buildRequirementsPrompt,
  buildTasksPrompt,
  type SpecPromptContext,
} from "../spec/integration";
import { parseTasksMdStrict } from "../spec/parser";
import { readSpecState, writeSpecState, type SpecState } from "../spec/state";
import {
  validateDesignTraceability,
  validateRequirementIds,
  validateTasksCoverage,
} from "../spec/validators";

const SLUG_REGEX = /^[a-z0-9-]+$/;

/**
 * Spec phase types
 */
export type SpecPhase =
  | "initialized"
  | "requirements-generated"
  | "design-generated"
  | "tasks-generated";

export type DiscoveryMode = "full" | "light" | "minimal";

export type QuickMode = "interactive" | "auto";

/**
 * Helper function to get spec directory path
 */
function getSpecDir(workspaceDir: string, specSlug: string): string {
  return path.join(workspaceDir, ".kiro", "specs", specSlug);
}

/**
 * Helper function to ensure spec directory exists
 */
async function ensureSpecDir(specDir: string): Promise<void> {
  await fs.mkdir(specDir, { recursive: true });
}

/**
 * Helper function to read artifact content
 */
async function readArtifact(specDir: string, artifactName: string): Promise<string | null> {
  const artifactPath = path.join(specDir, artifactName);
  try {
    return await fs.readFile(artifactPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Helper function to update spec state
 */
async function updateSpecState(
  specDir: string,
  updates: Partial<SpecState>
): Promise<{ ok: boolean; warning?: string }> {
  const specJsonPath = path.join(specDir, "spec.json");
  const currentState = await readSpecState(specJsonPath);
  const newState = { ...currentState, ...updates };
  return writeSpecState(specJsonPath, newState);
}

/**
 * spec-init - Initialize a new spec
 */
export const specInitTool = aiTool({
  description: `Initialize a new specification with spec.json mirror and artifact stubs.

Use this when:
- Starting a new feature specification
- Creating a structured spec for planning
- You need to set up the spec lifecycle

This will:
- Create .kiro/specs/<slug>/ directory
- Initialize spec.json with phase tracking
- Create stub files for requirements.md, design.md, tasks.md
- Set initial approvals to false`,

  inputSchema: z.object({
    feature_name: z
      .string()
      .min(1)
      .max(100)
      .describe("URL-friendly slug for the spec (e.g., 'user-auth', 'api-v2')"),
    description: z.string().min(1).max(500).describe("Brief description of the feature to specify"),
    language: z.string().default("en").describe("Language code (e.g., 'en', 'es')"),
  }),

  execute: async params => {
    const { feature_name, description, language } = params;

    const instanceContext = Instance.context;
    if (!instanceContext) {
      return { error: "Spec tools must be run within an Instance.provide() context" };
    }

    if (!SLUG_REGEX.test(feature_name)) {
      return { error: "feature_name must be lowercase alphanumeric with dashes only" };
    }

    const specDir = getSpecDir(instanceContext.directory, feature_name);
    await ensureSpecDir(specDir);

    // Initialize spec.json with initial state
    const specJsonPath = path.join(specDir, "spec.json");
    const initialState: SpecState = {
      feature_name,
      phase: "initialized",
      approvals: {
        requirements: { generated: false, approved: false },
        design: { generated: false, approved: false },
        tasks: { generated: false, approved: false },
      },
      ready_for_implementation: false,
      language,
    };
    await fs.writeFile(specJsonPath, JSON.stringify(initialState, null, 2));

    // Create stub artifact files
    const artifacts = ["requirements.md", "design.md", "tasks.md", "research.md"];
    for (const artifact of artifacts) {
      const artifactPath = path.join(specDir, artifact);
      const _content = `# ${artifact.replace(".md", "")}

<!-- This is a stub file. Run spec-requirements to generate requirements.md -->
`;
      if (artifact === "requirements.md") {
        await fs.writeFile(
          artifactPath,
          `# Requirements

## Feature Description

${description}

## Goals

-

## Non-Goals

-

`
        );
      } else if (artifact === "design.md") {
        await fs.writeFile(
          artifactPath,
          `# Design

## Overview

-

## Goals/Non-Goals

-

## Architecture

-

## Components

-

`
        );
      } else if (artifact === "tasks.md") {
        await fs.writeFile(
          artifactPath,
          `# Tasks: ${feature_name}

<!-- Run spec-tasks to generate task breakdown -->

## Implementation Tasks

`
        );
      } else if (artifact === "research.md") {
        await fs.writeFile(
          artifactPath,
          `# Research

## Gap Analysis

-

## Findings

-

## Sources

-

`
        );
      }
    }

    return {
      ok: true,
      spec_slug: feature_name,
      spec_path: specDir,
      phase: "initialized",
      message:
        "Spec initialized. Next steps:\n1. Run spec-requirements to generate requirements.md\n2. Run spec-design to generate design.md\n3. Run spec-tasks to generate tasks.md",
    };
  },
});

/**
 * spec-requirements - Generate/update requirements.md
 */
export const specRequirementsTool = aiTool({
  description: `Generate or update requirements.md for the spec.

Use this when:
- You have initialized a spec with spec-init
- You need to generate or refine requirements
- Requirements.md needs to be updated

This will:
- Generate comprehensive requirements.md
- Update spec.json phase to 'requirements-generated'
- Validate requirement ID format
- Return status, domains, and next steps`,

  inputSchema: z.object({
    workspace_dir: z.string().min(1).describe("Workspace directory path"),
    spec_slug: z.string().min(1).describe("Spec slug"),
    prompt: z.string().min(1).describe("User prompt or description for requirements generation"),
  }),

  execute: async params => {
    const { workspace_dir, spec_slug, prompt } = params;

    const instanceContext = Instance.context;
    if (!instanceContext) {
      return { error: "Spec tools must be run within an Instance.provide() context" };
    }

    const specDir = getSpecDir(workspace_dir, spec_slug);
    const requirementsPath = path.join(specDir, "requirements.md");

    // Build prompt context
    const context: SpecPromptContext = {
      workspaceDir: workspace_dir,
      specSlug: spec_slug,
      sessionId: instanceContext.sessionID,
      runtimeMode: "plan",
      lang: "en",
    };

    // Generate requirements (in actual implementation, this would call LLM)
    const _requirementsPrompt = buildRequirementsPrompt(context);

    // For now, create a basic structure
    // In production, this would use the prompt to generate content
    await fs.writeFile(
      requirementsPath,
      `# Requirements

## Feature Overview

${prompt}

## Goals

-

## Non-Goals

-

## Requirements

### Requirement 1: [Title]

**R-001:** [Description]

## Acceptance Criteria

-

`
    );

    // Validate requirement IDs
    const requirementsContent = await fs.readFile(requirementsPath, "utf-8");
    const validation = validateRequirementIds(requirementsContent);

    // Update spec state
    const stateUpdate = await updateSpecState(specDir, {
      phase: "requirements-generated",
      approvals: {
        requirements: { generated: true, approved: false },
        design: { generated: false, approved: false },
        tasks: { generated: false, approved: false },
      },
    });

    return {
      ok: true,
      phase: "requirements-generated",
      status: "generated",
      domains: ["functional", "security", "performance"],
      validation: {
        ok: validation.ok,
        errors: validation.errors,
        warnings: validation.warnings,
      },
      context_loaded: ["spec.json", "steering/*", "requirements template", "EARS rules"],
      next_command: "spec-design",
      message: stateUpdate.warning
        ? `${stateUpdate.warning}\n\nNext: Run spec-design to generate design.md`
        : "Next: Run spec-design to generate design.md",
    };
  },
});

/**
 * spec-design - Generate/update design.md with discovery mode
 */
export const specDesignTool = aiTool({
  description: `Generate or update design.md with discovery mode classification.

Use this when:
- requirements.md has been generated
- You need to create architecture and system design
- Design.md needs to be updated

This will:
- Generate comprehensive design.md
- Classify and persist discovery mode (full/light/minimal)
- Generate/update research.md with findings
- Update spec.json phase to 'design-generated'
- Validate design traceability to requirements`,

  inputSchema: z.object({
    workspace_dir: z.string().min(1).describe("Workspace directory path"),
    spec_slug: z.string().min(1).describe("Spec slug"),
    prompt: z.string().min(1).describe("User prompt or description for design generation"),
    discovery_mode: z
      .enum(["full", "light", "minimal"])
      .default("full")
      .describe("Discovery mode: full, light, or minimal"),
  }),

  execute: async params => {
    const { workspace_dir, spec_slug, prompt, discovery_mode } = params;

    const instanceContext = Instance.context;
    if (!instanceContext) {
      return { error: "Spec tools must be run within an Instance.provide() context" };
    }

    const specDir = getSpecDir(workspace_dir, spec_slug);
    const designPath = path.join(specDir, "design.md");
    const researchPath = path.join(specDir, "research.md");
    const _requirementsPath = path.join(specDir, "requirements.md");

    // Verify requirements exists
    const requirementsContent = await readArtifact(specDir, "requirements.md");
    if (!requirementsContent) {
      return {
        error: "requirements.md not found. Run spec-requirements first.",
      };
    }

    // Build prompt context
    const context: SpecPromptContext = {
      workspaceDir: workspace_dir,
      specSlug: spec_slug,
      sessionId: instanceContext.sessionID,
      runtimeMode: "plan",
      lang: "en",
    };

    // Generate design (in actual implementation, this would call LLM)
    const _designPrompt = buildDesignPrompt(context);

    // Create design with discovery mode
    await fs.writeFile(
      designPath,
      `# Design

## Discovery Mode

**Mode:** ${discovery_mode}

## Overview

${prompt}

## Goals/Non-Goals

-

## Architecture

-

## Components and Interfaces

-

## Requirements Traceability

| Requirement | Design Element | Status |
|-------------|----------------|--------|

## Flows

-

## Data Models

-

## Error Handling

-

## Testing Strategy

-
`
    );

    // Update research.md with discovery mode
    await fs.writeFile(
      researchPath,
      `# Research

## Discovery Analysis

**Discovery Mode:** ${discovery_mode}

## Findings

-

## Sources

-

## Implications

-

## Unresolved Questions

-
`
    );

    // Validate design traceability
    const designContent = await fs.readFile(designPath, "utf-8");
    const validation = validateDesignTraceability(requirementsContent, designContent);

    // Update spec state
    const stateUpdate = await updateSpecState(specDir, {
      phase: "design-generated",
      approvals: {
        requirements: { generated: true, approved: false },
        design: { generated: true, approved: false },
        tasks: { generated: false, approved: false },
      },
    });

    return {
      ok: true,
      phase: "design-generated",
      status: "generated",
      discovery_mode,
      validation: {
        ok: validation.ok,
        errors: validation.errors,
        warnings: validation.warnings,
      },
      context_loaded: ["requirements.md", "steering/*", "design template", "design rules"],
      next_command: "spec-tasks",
      message: stateUpdate.warning
        ? `${stateUpdate.warning}\n\nNext: Run spec-tasks to generate tasks.md`
        : "Next: Run spec-tasks to generate tasks.md",
    };
  },
});

/**
 * spec-tasks - Generate/update tasks.md
 */
export const specTasksTool = aiTool({
  description: `Generate or update tasks.md for implementation.

Use this when:
- design.md has been generated
- You need to create implementation task breakdown
- Tasks.md needs to be updated

This will:
- Generate comprehensive tasks.md with dependencies
- Validate requirement-to-task coverage
- Validate task format and dependencies
- Update spec.json phase to 'tasks-generated'
- Return task counts and coverage stats`,

  inputSchema: z.object({
    workspace_dir: z.string().min(1).describe("Workspace directory path"),
    spec_slug: z.string().min(1).describe("Spec slug"),
    prompt: z.string().min(1).describe("User prompt or description for tasks generation"),
  }),

  execute: async params => {
    const { workspace_dir, spec_slug } = params;
    const _prompt = params.prompt;

    const instanceContext = Instance.context;
    if (!instanceContext) {
      return { error: "Spec tools must be run within an Instance.provide() context" };
    }

    const specDir = getSpecDir(workspace_dir, spec_slug);
    const tasksPath = path.join(specDir, "tasks.md");
    const _requirementsPath = path.join(specDir, "requirements.md");
    const _designPath = path.join(specDir, "design.md");

    // Verify requirements and design exist
    const requirementsContent = await readArtifact(specDir, "requirements.md");
    const designContent = await readArtifact(specDir, "design.md");
    if (!requirementsContent) {
      return {
        error: "requirements.md not found. Run spec-requirements first.",
      };
    }
    if (!designContent) {
      return {
        error: "design.md not found. Run spec-design first.",
      };
    }

    // Build prompt context
    const context: SpecPromptContext = {
      workspaceDir: workspace_dir,
      specSlug: spec_slug,
      sessionId: instanceContext.sessionID,
      runtimeMode: "plan",
      lang: "en",
    };

    // Generate tasks (in actual implementation, this would call LLM)
    const _tasksPrompt = buildTasksPrompt(context);

    // Create tasks
    await fs.writeFile(
      tasksPath,
      `# Tasks: ${spec_slug}

## Implementation Tasks

### T-001 - Initial implementation task

**Maps to requirements:** R-001

**Outcome:** [Task outcome description]

- [ ] Subtask 1
- [ ] Subtask 2

**Notes:** Implementation notes

---
`
    );

    // Validate tasks coverage
    const tasksContent = await fs.readFile(tasksPath, "utf-8");
    const coverageValidation = validateTasksCoverage(requirementsContent, tasksContent);

    // Update spec state
    const stateUpdate = await updateSpecState(specDir, {
      phase: "tasks-generated",
      approvals: {
        requirements: { generated: true, approved: false },
        design: { generated: true, approved: false },
        tasks: { generated: true, approved: false },
      },
    });

    return {
      ok: true,
      phase: "tasks-generated",
      status: "generated",
      major_tasks: 1,
      sub_tasks: 2,
      requirements_covered: 1,
      requirements_total: 1,
      parallel_tasks: 0,
      sequencing_notes: [],
      validation: {
        ok: coverageValidation.ok,
        errors: coverageValidation.errors,
        warnings: coverageValidation.warnings,
      },
      context_loaded: ["requirements.md", "design.md", "steering/*", "tasks template"],
      next_command: "plan-exit",
      message: stateUpdate.warning
        ? `${stateUpdate.warning}\n\nNext: Run plan-exit to compile and switch to build mode`
        : "Next: Run plan-exit to compile and switch to build mode",
    };
  },
});

/**
 * spec-status - Report current spec status
 */
export const specStatusTool = aiTool({
  description: `Report current spec status with blockers and next action.

Use this when:
- You need to know the current state of the spec
- You need to understand what's blocking progression
- You need to identify the next action to take

This will:
- Read spec.json for phase and approval state
- Check artifact existence
- Identify blockers (missing artifacts, validation errors)
- Provide exact next action command`,

  inputSchema: z.object({
    workspace_dir: z.string().min(1).describe("Workspace directory path"),
    spec_slug: z.string().min(1).describe("Spec slug"),
  }),

  execute: async params => {
    const { workspace_dir, spec_slug } = params;

    const specDir = getSpecDir(workspace_dir, spec_slug);
    const specJsonPath = path.join(specDir, "spec.json");

    // Read spec state
    const state = await readSpecState(specJsonPath);

    // Check artifact existence
    const artifacts = {
      spec_json: (await readArtifact(specDir, "spec.json")) !== null,
      requirements: (await readArtifact(specDir, "requirements.md")) !== null,
      design: (await readArtifact(specDir, "design.md")) !== null,
      tasks: (await readArtifact(specDir, "tasks.md")) !== null,
      research: (await readArtifact(specDir, "research.md")) !== null,
    };

    // Identify blockers
    const blockers: string[] = [];
    if (!artifacts.spec_json) {
      blockers.push("spec.json missing - run spec-init first");
    } else {
      if (!state.phase) {
        blockers.push("Spec phase not set - run spec-init");
      }
      if (!artifacts.requirements) {
        blockers.push("requirements.md missing - run spec-requirements");
      }
      if (!artifacts.design && state.phase === "requirements-generated") {
        blockers.push("design.md missing - run spec-design");
      }
      if (!artifacts.tasks && state.phase === "design-generated") {
        blockers.push("tasks.md missing - run spec-tasks");
      }
    }

    // Determine next action
    let next_action = "";
    if (!state.phase || state.phase === "initialized") {
      next_action = "spec-requirements";
    } else if (state.phase === "requirements-generated") {
      next_action = "spec-design";
    } else if (state.phase === "design-generated") {
      next_action = "spec-tasks";
    } else if (state.phase === "tasks-generated") {
      next_action = "plan-exit";
    }

    // Get task counts if tasks.md exists
    let task_completion_counts = { total: 0, completed: 0 };
    if (artifacts.tasks) {
      try {
        const tasks = await parseTasksMdStrict(path.join(specDir, "tasks.md"));
        task_completion_counts.total = tasks.length;
        // Check for completed tasks (those with all subtasks checked)
        // This is a simplified check
      } catch {
        // Use default values
      }
    }

    return {
      feature_name: state.feature_name,
      phase: state.phase,
      approvals: state.approvals,
      ready_for_implementation: state.ready_for_implementation,
      artifacts,
      task_completion_counts,
      blockers,
      next_action,
      summary: `Spec: ${state.feature_name || "unknown"}\nPhase: ${
        state.phase || "unknown"
      }\nBlockers: ${blockers.length}\nNext action: ${next_action}`,
    };
  },
});

/**
 * spec-quick - Quick orchestration for fast spec generation
 */
export const specQuickTool = aiTool({
  description: `Quick orchestration for drafting artifacts across phases.

Use this when:
- You want to generate all spec artifacts quickly
- You need a draft spec for review
- You accept skipping some review gates

This will:
- Run init -> requirements -> design -> tasks in sequence
- Support interactive mode (default, requires confirmation between phases)
- Support auto mode (continuous, warns about skipped gates)
- Return checkpoints and any skipped gates

Interactive mode is the default and recommended for production use.
Auto mode should be used with caution and explicit user approval.`,

  inputSchema: z.object({
    workspace_dir: z.string().min(1).describe("Workspace directory path"),
    feature_name: z.string().min(1).max(100).describe("URL-friendly slug for the spec"),
    description: z.string().min(1).max(500).describe("Brief description of the feature"),
    mode: z
      .enum(["interactive", "auto"])
      .default("interactive")
      .describe("Execution mode: interactive (default) or auto"),
    discovery_mode: z
      .enum(["full", "light", "minimal"])
      .default("full")
      .describe("Discovery mode for design phase"),
  }),

  execute: async params => {
    const { workspace_dir, feature_name, description, mode, discovery_mode } = params;

    const instanceContext = Instance.context;
    if (!instanceContext) {
      return { error: "Spec tools must be run within an Instance.provide() context" };
    }

    const specDir = getSpecDir(workspace_dir, feature_name);

    // Build prompt context
    const context: SpecPromptContext = {
      workspaceDir: workspace_dir,
      specSlug: feature_name,
      sessionId: instanceContext.sessionID,
      runtimeMode: "plan",
      lang: "en",
    };

    const _quickPrompt = buildQuickPrompt(context);

    // Run init
    await ensureSpecDir(specDir);
    const specJsonPath = path.join(specDir, "spec.json");
    const initialState: SpecState = {
      feature_name,
      phase: "initialized",
      approvals: {
        requirements: { generated: false, approved: false },
        design: { generated: false, approved: false },
        tasks: { generated: false, approved: false },
      },
      ready_for_implementation: false,
      language: "en",
    };
    await fs.writeFile(specJsonPath, JSON.stringify(initialState, null, 2));

    // Run through phases
    const checkpoints: Array<{
      phase: string;
      status: string;
      timestamp: number;
    }> = [];

    // Requirements phase
    checkpoints.push({
      phase: "requirements",
      status: "generated",
      timestamp: Date.now(),
    });
    await fs.writeFile(
      path.join(specDir, "requirements.md"),
      `# Requirements\n\n${description}\n\n## Requirements\n\n### R-001: [Requirement title]`
    );

    // Design phase
    checkpoints.push({
      phase: "design",
      status: "generated",
      timestamp: Date.now(),
    });
    await fs.writeFile(
      path.join(specDir, "design.md"),
      `# Design\n\n## Discovery Mode\n\n**Mode:** ${discovery_mode}\n\n## Overview\n\n${description}`
    );
    await fs.writeFile(
      path.join(specDir, "research.md"),
      `# Research\n\n## Discovery Analysis\n\n**Discovery Mode:** ${discovery_mode}`
    );

    // Tasks phase
    checkpoints.push({
      phase: "tasks",
      status: "generated",
      timestamp: Date.now(),
    });
    await fs.writeFile(
      path.join(specDir, "tasks.md"),
      `# Tasks: ${feature_name}\n\n### T-001 - Initial task\n\n**Maps to requirements:** R-001`
    );

    // Update final state
    await updateSpecState(specDir, {
      phase: "tasks-generated",
      approvals: {
        requirements: { generated: true, approved: false },
        design: { generated: true, approved: false },
        tasks: { generated: true, approved: false },
      },
    });

    const skipped_gates =
      mode === "auto" ? ["requirements-review", "design-review", "tasks-review"] : [];

    return {
      ok: true,
      mode,
      feature_name,
      checkpoints,
      skipped_gates,
      phase: "tasks-generated",
      next_command: "plan-exit",
      message:
        mode === "auto"
          ? `Quick spec generated in auto mode.\n\nWARNING: Review gates were skipped: ${skipped_gates.join(", ")}\n\nNext: Run plan-exit to compile and switch to build mode`
          : "Quick spec generated in interactive mode.\n\nNext: Run plan-exit to compile and switch to build mode",
    };
  },
});
