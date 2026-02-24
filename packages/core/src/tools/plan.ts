/**
 * Plan Tools - plan_enter and plan_exit
 *
 * Phase 3 - Spec System
 * Provides tools for entering and exiting plan mode
 */

import { tool as aiTool } from "ai";
import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { Instance } from "../instance";
import { requestModeSwitchApproval } from "../session/mode-approval";
import { transitionSessionMode } from "../session/mode-transition";
import { compileSpecToDb, type SpecMetadata } from "../spec/compiler";
import {
  getActiveSpec,
  getReadyTasks,
  updateCurrentTask,
  updateSessionRuntimeMode,
  updateSessionSpec,
} from "../spec/helpers";
import { parseTasksMdStrict, validateTaskDagFromParsed } from "../spec/parser";
import { writeSpecTemplate } from "../spec/templates";

const SLUG_REGEX = /^[a-z0-9-]+$/;

export const planEnterTool = aiTool({
  description: `Switch to plan mode for research and planning.

Use this when:
- User asks to plan something complex
- Requirements are unclear and need investigation
- You want to create a structured plan before implementing

This will switch your agent to plan mode where you can:
- Explore the codebase using subagents
- Create structured spec files
- Define tasks with clear dependencies
- NOT make any code changes (except to spec files)

The plan will be saved to .kiro/specs/<slug>/`,
  inputSchema: z.object({
    spec_slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/)
      .describe("URL-friendly slug for the spec (e.g., 'user-auth', 'api-v2')"),
    description: z.string().min(1).max(500).describe("Brief description of what to plan"),
  }),

  execute: async params => {
    const { spec_slug, description } = params;

    const instanceContext = Instance.context;
    if (!instanceContext) {
      return { error: "Plan tools must be run within an Instance.provide() context" };
    }

    if (!SLUG_REGEX.test(spec_slug)) {
      return { error: "spec_slug must be lowercase alphanumeric with dashes only" };
    }

    const specDir = path.join(instanceContext.directory, ".kiro", "specs", spec_slug);
    await fs.mkdir(specDir, { recursive: true });

    await writeSpecTemplate(specDir, spec_slug, description);

    await updateSessionSpec(instanceContext.sessionID, spec_slug);
    await updateSessionRuntimeMode(instanceContext.sessionID, "plan");

    return {
      spec_slug,
      spec_path: specDir,
      status:
        "Plan mode activated. Use explore agents to understand the codebase, then create requirements.md, design.md, and tasks.md",
    };
  },
});

export const planExitTool = aiTool({
  description: `Request user approval to switch from plan mode to build mode.

Use this when:
- You have completed all spec files
- tasks.md is ready with all T-### tasks
- Dependencies form a valid DAG (no cycles)
- You want user to approve before implementation

This will:
1. Present the plan summary to user
2. Validate DAG (no cycles)
3. Ask for approval to switch to build mode
4. If approved, switch agent and activate first ready task`,

  inputSchema: z.object({
    summary: z.string().max(2000).describe("Brief summary of the plan for user review"),
  }),

  execute: async params => {
    const { summary } = params;

    const instanceContext = Instance.context;
    if (!instanceContext) {
      throw new Error("Plan tools must be run within an Instance.provide() context");
    }

    const specSlug = await getActiveSpec(instanceContext.sessionID);
    if (!specSlug) {
      throw new Error("No active spec. Use plan_enter first.");
    }

    const specDir = path.join(instanceContext.directory, ".kiro", "specs", specSlug);
    const tasksFile = path.join(specDir, "tasks.md");

    let tasks;
    try {
      tasks = await parseTasksMdStrict(tasksFile);
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === "ENOENT") {
        throw new Error("tasks.md not found. Create it before exiting plan mode.");
      }
      throw err;
    }

    if (tasks.length === 0) {
      throw new Error("No tasks found in tasks.md. Add at least one T-### task.");
    }

    const unmapped = tasks.filter(t => !t.requirements || t.requirements.length === 0);
    if (unmapped.length > 0) {
      throw new Error(`Tasks without R-### mapping: ${unmapped.map(t => t.id).join(", ")}`);
    }

    const dagValidation = validateTaskDagFromParsed(tasks);
    if (!dagValidation.valid) {
      throw new Error(
        `Task dependencies form cycles: ${dagValidation.cycles.map(c => c.join(" → ")).join(", ")}`
      );
    }

    const approved = await requestModeSwitchApproval({
      sessionId: instanceContext.sessionID,
      fromMode: "plan",
      toMode: "build",
      reason: summary,
    });

    if (!approved) {
      return {
        status: "planning_continued",
        message: "User denied mode switch. Planning can continue.",
      };
    }

    const compiled = await compileSpecToDb(specDir, specSlug);
    if (compiled.errors.length > 0) {
      throw new Error(`Compilation failed: ${compiled.errors.join("; ")}`);
    }

    const readyTasks = await getReadyTasks(specSlug);

    const firstReady = readyTasks[0];
    const firstReadyMetadata = firstReady?.metadata as SpecMetadata | null;
    const firstReadyTaskId = firstReadyMetadata?.spec?.taskId ?? null;
    if (firstReadyTaskId) {
      await updateCurrentTask(instanceContext.sessionID, firstReadyTaskId);
    }

    await transitionSessionMode({
      sessionId: instanceContext.sessionID,
      from: "plan",
      to: "build",
    });

    return {
      status: "Plan compiled to database",
      tasks_compiled: compiled.created + compiled.updated,
      next_task: firstReadyTaskId,
      message: firstReady
        ? `First ready task: ${firstReady.title} (${firstReadyTaskId})`
        : "All tasks have dependencies - no ready tasks",
    };
  },
});
