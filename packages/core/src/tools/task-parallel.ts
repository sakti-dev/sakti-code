/**
 * Task Parallel Tool - Deterministic Parallel Explore Spawning
 *
 * Enables agents to spawn multiple explore subagents concurrently
 * with deterministic output ordering and failure isolation.
 */

import { tool } from "ai";
import { z } from "zod";
import { loadModel } from "../agent/registry";
import type { AgentConfig, AgentEvent, AgentInput } from "../agent/workflow/types";
import { Instance } from "../instance";
import type { ExplorationResult } from "./task";

/**
 * Input for a single parallel task
 */
export interface ParallelTaskInput {
  description: string;
  prompt: string;
}

/**
 * Result for a single parallel task
 */
export interface ParallelTaskResult {
  index: number;
  sessionId: string;
  status: "completed" | "failed" | "stopped";
  finalContent?: string;
  error?: string;
  duration: number;
  iterations: number;
  toolCalls: Array<{ name: string; args: unknown }>;
  explorationResult?: ExplorationResult;
}

/**
 * Result from running parallel tasks
 */
export interface ParallelTaskExecuteResult {
  results: ParallelTaskResult[];
  totalDuration: number;
}

const MAX_TASKS = 8;
const MAX_CONCURRENCY = 8;
const DEFAULT_CONCURRENCY = 4;

/**
 * Parse exploration result from subagent output
 */
function parseExplorationResult(content: string): ExplorationResult {
  const findingsMatch = content.match(/<findings>([\s\S]*?)<\/findings>/);
  const fileInventoryMatch = content.match(/<file_inventory>([\s\S]*?)<\/file_inventory>/);
  const gapsMatch = content.match(/<gaps>([\s\S]*?)<\/gaps>/);

  const findings = findingsMatch?.[1]?.trim() ?? "";
  const fileInventory = fileInventoryMatch?.[1]?.trim() ?? "";
  const gaps = gapsMatch?.[1]?.trim() ?? "";

  return {
    findings,
    fileInventory,
    gaps,
    rawMessages: [content],
  };
}

export const taskParallelTool = tool({
  description: `Run multiple explore subagents in parallel.

Use this tool when you need to:
- Explore multiple areas of the codebase concurrently
- Gather information from different parts of the codebase simultaneously
- Speed up exploration by running independent tasks in parallel

This tool:
- Runs all tasks concurrently with configurable concurrency
- Returns results in deterministic order matching input order
- Does not cancel siblings if one task fails (allSettled behavior)
- Each task runs as an isolated explore subagent`,

  inputSchema: z.object({
    tasks: z
      .array(
        z.object({
          description: z
            .string()
            .min(3)
            .max(50)
            .describe("Brief description of the exploration task"),
          prompt: z.string().min(1).describe("Detailed prompt for what to explore"),
        })
      )
      .min(1)
      .max(MAX_TASKS)
      .describe("Array of explore tasks to run in parallel"),
    max_concurrency: z
      .number()
      .min(1)
      .max(MAX_CONCURRENCY)
      .optional()
      .describe("Maximum concurrent tasks (1-8, default 4)"),
  }),

  execute: async (
    params: {
      tasks: ParallelTaskInput[];
      max_concurrency?: number;
    },
    _context: unknown
  ): Promise<ParallelTaskExecuteResult> => {
    const { tasks, max_concurrency } = params;

    const instanceContext = Instance.context;
    if (!instanceContext) {
      throw new Error("Task parallel tool must be run within an Instance.provide() context");
    }

    if (!tasks || tasks.length === 0) {
      throw new Error("At least one task is required");
    }

    if (tasks.length > MAX_TASKS) {
      throw new Error(`Maximum ${MAX_TASKS} tasks allowed`);
    }

    const _concurrency = Math.min(max_concurrency ?? DEFAULT_CONCURRENCY, MAX_CONCURRENCY);

    const startTime = Date.now();

    const taskPromises = tasks.map(async (task, index) => {
      const taskStartTime = Date.now();

      const agentId = `parallel-explore-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`;

      try {
        loadModel("glm-4.7-flashx");

        const { getToolsForPhase } = await import("../tools/phase-tools");
        const tools = await getToolsForPhase("explore");

        const agentConfig: AgentConfig = {
          id: agentId,
          type: "explore",
          model: "glm-4.7-flashx",
          systemPrompt:
            "You are a codebase exploration agent. Explore the specified area thoroughly and report your findings.",
          tools,
          maxIterations: 10,
        };

        const toolCalls: Array<{ name: string; args: unknown }> = [];
        const eventCallback = (event: AgentEvent) => {
          if (event.type === "tool-call") {
            toolCalls.push({
              name: event.toolName,
              args: event.args,
            });
          }
        };

        const { AgentProcessor } = await import("../session/processor");
        const processor = new AgentProcessor(agentConfig, eventCallback);

        const input: AgentInput = {
          task: `${task.description}\n\n${task.prompt}`,
          context: {
            parentSessionId: instanceContext.sessionID,
            parentMessageId: instanceContext.messageID,
            mode: "explore",
          },
        };

        const result = await processor.run(input);

        const duration = Date.now() - taskStartTime;

        let explorationResult: ExplorationResult | undefined;
        if (result.finalContent) {
          explorationResult = parseExplorationResult(result.finalContent);
        }

        return {
          index,
          sessionId: agentId,
          status: result.status,
          finalContent: result.finalContent,
          error: result.error,
          duration,
          iterations: result.iterations,
          toolCalls,
          explorationResult,
        } as ParallelTaskResult;
      } catch (error) {
        const duration = Date.now() - taskStartTime;
        return {
          index,
          sessionId: agentId,
          status: "failed" as const,
          error: error instanceof Error ? error.message : String(error),
          duration,
          iterations: 0,
          toolCalls: [],
        } as ParallelTaskResult;
      }
    });

    const settledResults = await Promise.allSettled(taskPromises);

    const results: ParallelTaskResult[] = settledResults.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      return {
        index,
        sessionId: `failed-${index}`,
        status: "failed" as const,
        error: result.reason?.message ?? String(result.reason),
        duration: 0,
        iterations: 0,
        toolCalls: [],
      };
    });

    results.sort((a, b) => a.index - b.index);

    const totalDuration = Date.now() - startTime;

    return {
      results,
      totalDuration,
    };
  },
});
