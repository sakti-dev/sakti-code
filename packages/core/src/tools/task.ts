/**
 * Task tool - Subagent spawning
 *
 * Enables agents to spawn specialized subagents for delegating
 * specific tasks. This is the key mechanism for the OpenCode-inspired
 * flexible architecture where the LLM decides when to spawn subagents.
 *
 * Usage:
 * - Agent spawns a subagent for exploration: "Analyze the codebase structure"
 * - Agent spawns a subagent for planning: "Create a plan for feature X"
 * - Agent can resume previous subagent sessions
 */

import type { LanguageModelV3 } from "@ai-sdk/provider";
import { tool } from "ai";
import { z } from "zod";
import type { AgentConfig, AgentEvent, AgentInput, AgentResult } from "../agent/workflow/types";
import { Instance } from "../instance";
import type { AgentMode } from "../prompts/memory/observer/modes";
import { AgentProcessor } from "../session/processor";
import { getSessionRuntimeMode } from "../spec/helpers";

/**
 * Subagent types available for spawning
 */
export const SUBAGENT_TYPES = ["explore", "plan", "general"] as const;
export type SubagentType = (typeof SUBAGENT_TYPES)[number];

/**
 * Exploration result from explore subagent
 */
export interface ExplorationResult {
  /** Structured findings from exploration */
  findings: string;
  /** List of files explored */
  fileInventory: string;
  /** What's missing */
  gaps: string;
  /** Original messages for reference */
  rawMessages?: string[];
}

/**
 * Result from running a subagent
 */
export interface SubagentResult {
  /** The session ID of the subagent */
  sessionId: string;
  /** Whether the subagent completed or is still running */
  status: "completed" | "failed" | "stopped";
  /** Final content from the subagent */
  finalContent?: string;
  /** Error message if the subagent failed */
  error?: string;
  /** Number of iterations the subagent ran */
  iterations: number;
  /** Duration in milliseconds */
  duration: number;
  /** Tool calls made by the subagent */
  toolCalls: Array<{ name: string; args: unknown }>;
  /** Exploration result (only for explore subagents) */
  explorationResult?: ExplorationResult;
}

/**
 * Agent configuration by subagent type
 *
 * Maps subagent types to their configuration without importing
 * from agent/registry to avoid circular dependency.
 */
export const SUBAGENT_CONFIGS: Record<
  SubagentType,
  {
    agentType: "explore" | "plan" | "build";
    mode: AgentMode;
    model: string;
    maxIterations: number;
    systemPrompt: string;
  }
> = {
  explore: {
    agentType: "explore",
    mode: "explore",
    model: "glm-4.7-flashx",
    maxIterations: 30,
    systemPrompt: buildExploreSystemPrompt(),
  },
  plan: {
    agentType: "plan",
    mode: "default",
    model: "glm-4.7",
    maxIterations: 100,
    systemPrompt: `You are an expert software architect. Your task is to create detailed implementation plans.

Review the task and exploration results, then create a step-by-step plan that includes:
- Files to modify or create
- Specific changes needed
- Order of operations
- Potential challenges and solutions
- Testing strategy

Think through this carefully before presenting your plan. Consider edge cases and alternatives.

You have read-only access. Focus on planning rather than implementing.`,
  },
  general: {
    agentType: "build",
    mode: "default",
    model: "glm-4.7",
    maxIterations: 50,
    systemPrompt: `You are an expert software developer and AI coding agent.

Your capabilities include:
- Reading and understanding codebases
- Writing and modifying code
- Executing commands and running tests
- Searching for information

When working on tasks:
1. Understand the user's goal clearly
2. Explore the codebase to understand context
3. Make targeted, minimal changes
4. Test your changes when possible
5. Explain your actions clearly

Always maintain code quality and follow existing patterns in the codebase.`,
  },
};

/**
 * Build explore agent system prompt with mode-specific instructions
 */
function buildExploreSystemPrompt(): string {
  return `You are a precise codebase researcher. Your findings will be used by another agent to make decisions.

YOUR OBJECTIVE: Explore the codebase and capture exact details about what you find.

=== EXTRACTION INSTRUCTIONS ===

CRITICAL: Your observations must capture what the parent agent specifically asked for.

For each message exchange, extract and preserve:

1. WHAT WAS REQUESTED - Note what specific information the parent wanted
2. EXACT FINDINGS - File paths, line numbers, function names, interface definitions
3. SCHEMA DEFINITIONS - Full type definitions, interfaces, Zod schemas
4. FUNCTION SIGNATURES - Parameter types, return types
5. "NOT FOUND" RESULTS - Explicitly note when something doesn't exist
6. SEARCH QUERIES USED - What you searched for

PRESERVE EXACT DETAILS:
- File paths: "src/auth/forms/LoginForm.tsx"
- Line numbers: "interface LoginFormData at line 12"
- Type definitions: "interface LoginFormData { email: string; password: string }"
- Schema: "const loginSchema = z.object({...})"

DO NOT:
- Summarize code into prose
- Skip "not found" results
- Merge different findings together
- Lose line numbers or file paths

=== OUTPUT FORMAT ===

Use this structured format to capture exploration findings:

<findings>
## Query: [what parent wanted]
- FOUND: [exact file path]:[line numbers] - [brief description]
- FOUND: [exact file path]:[line numbers] - [brief description]
- NOT FOUND: [what wasn't found]

## Query: [next thing parent wanted]
...
</findings>

<file_inventory>
[filepath1]: [key exports, interfaces, functions found]
[filepath2]: [key exports, interfaces, functions found]
</file_inventory>

<gaps>
- [Things that exist but weren't fully explored]
- [Things that definitely don't exist]
</gaps>

<current-task>
Primary: [what you're currently searching for]
Status: [in_progress / completed / not_found]
</current-task>

=== GUIDELINES ===

PRECISION OVER BREVITY - This is not build mode.

PRIORITY:
1. Exact file paths and line numbers
2. Complete interface/type definitions
3. "NOT FOUND" results (as important as found results)
4. Search queries used

WHAT TO CAPTURE:
- Full interface definitions (not summarized)
- Exact function signatures
- Schema structures
- Import paths
- Line numbers for key definitions

WHEN SOMETHING IS NOT FOUND:
- State explicitly: "NOT FOUND: LoginForm schema"
- This is critical info for parent agent

WHEN FOUND:
- Include file path: "src/auth/LoginForm.tsx"
- Include line number: "line 15-22"
- Include full definition if small, or key parts if large

DO NOT:
- Summarize code into natural language
- Skip details to save space
- Assume parent knows the codebase

IMPORTANT: You are not implementing code - you are finding information. Be precise.
The parent agent needs exact details to make decisions about the codebase.

Remember: Accuracy > Brevity. Parent agent will act on what you remember.`;
}

/**
 * Task tool for spawning subagents
 *
 * This tool allows the main agent to delegate specialized tasks
 * to subagents with different capabilities.
 */
export const taskTool = tool({
  description: `Spawn a subagent to handle a specific task.

Use this tool when you need to:
- Explore the codebase (use "explore" subagent)
- Create detailed plans (use "plan" subagent)
- Delegate any specialized work (use "general" subagent)

The subagent will run in isolation and return results to you.

Examples:
- "Explore the authentication module structure"
- "Create a plan for implementing user settings"
- "Find all API endpoints in the codebase"`,

  inputSchema: z.object({
    description: z
      .string()
      .min(3)
      .max(50)
      .describe("Brief description (3-5 words) of the task for the subagent"),
    prompt: z.string().min(1).describe("Detailed prompt for the subagent explaining what to do"),
    subagent_type: z
      .enum(SUBAGENT_TYPES)
      .describe(
        "Type of subagent to spawn: explore (codebase exploration), plan (detailed planning), or general (any task)"
      ),
    session_id: z
      .string()
      .optional()
      .describe("Optional session ID to resume a previous subagent session"),
  }),

  execute: async (
    params: {
      description: string;
      prompt: string;
      subagent_type: SubagentType;
      session_id?: string;
    },
    _context: unknown
  ): Promise<SubagentResult> => {
    const { description, prompt, subagent_type, session_id } = params;

    // Get instance context
    const instanceContext = Instance.context;
    if (!instanceContext) {
      throw new Error("Task tool must be run within an Instance.provide() context");
    }

    // Enforce runtime-mode subagent policy
    // intake: allow only explore subagents (conservative)
    // plan: allow only explore subagents
    // build: allow all subagent types
    const runtimeMode = (await getSessionRuntimeMode(instanceContext.sessionID)) ?? "intake";
    if ((runtimeMode === "intake" || runtimeMode === "plan") && subagent_type !== "explore") {
      throw new Error(
        `${runtimeMode} mode can only spawn explore subagents`
      );
    }

    // Get subagent configuration
    const config = SUBAGENT_CONFIGS[subagent_type];

    // Load model and tools
    await loadModelForAgent(config.model);
    const tools = await getToolsForAgent(config.agentType);

    // Create agent configuration
    const agentId =
      session_id || `subagent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const agentConfig: AgentConfig = {
      id: agentId,
      type: config.agentType,
      model: config.model,
      systemPrompt: config.systemPrompt,
      tools: tools, // Pass tools as object with named keys
      maxIterations: config.maxIterations,
    };

    // Collect events for tracking tool calls
    const toolCalls: Array<{ name: string; args: unknown }> = [];
    const eventCallback = (event: AgentEvent) => {
      if (event.type === "tool-call") {
        toolCalls.push({
          name: event.toolName,
          args: event.args,
        });
      }
    };

    // Create and run the processor
    const processor = new AgentProcessor(agentConfig, eventCallback);

    // Build input with mode context
    const input: AgentInput = {
      task: `${description}\n\n${prompt}`,
      context: {
        parentSessionId: instanceContext.sessionID,
        parentMessageId: instanceContext.messageID,
        mode: config.mode,
      },
    };

    // Run the subagent
    const result: AgentResult = await processor.run(input);

    // Parse exploration result for explore subagents
    let explorationResult: ExplorationResult | undefined;
    if (subagent_type === "explore" && result.finalContent) {
      explorationResult = parseExplorationResult(result.finalContent);
    }

    // Return formatted result
    return {
      sessionId: agentId,
      status: result.status,
      finalContent: result.finalContent,
      error: result.error,
      iterations: result.iterations,
      duration: result.duration,
      toolCalls,
      explorationResult,
    };
  },
});

/**
 * Parse exploration result from subagent output
 *
 * @param content - Raw output from explore subagent
 * @returns Structured exploration result
 */
function parseExplorationResult(content: string): ExplorationResult {
  // Extract findings section
  const findingsMatch = content.match(/<findings>([\s\S]*?)<\/findings>/);
  const findings = findingsMatch ? findingsMatch[1].trim() : "";

  // Extract file inventory section
  const inventoryMatch = content.match(/<file_inventory>([\s\S]*?)<\/file_inventory>/);
  const fileInventory = inventoryMatch ? inventoryMatch[1].trim() : "";

  // Extract gaps section
  const gapsMatch = content.match(/<gaps>([\s\S]*?)<\/gaps>/);
  const gaps = gapsMatch ? gapsMatch[1].trim() : "";

  return {
    findings,
    fileInventory,
    gaps,
  };
}

/**
 * Load model for an agent
 *
 * @param modelName - Model name from agent config
 * @returns Language model instance
 */
async function loadModelForAgent(modelName: string): Promise<LanguageModelV3> {
  // Import directly from model-provider to avoid circular dependency
  const { getBuildModel, getExploreModel } = await import("../agent/workflow/model-provider");

  // Map model names to provider functions
  switch (modelName) {
    case "glm-4.7":
      return getBuildModel();
    case "glm-4.7-flash":
      return getBuildModel();
    case "glm-4.7-flashx":
      return getExploreModel();
    default:
      throw new Error(`Unknown model: ${modelName}`);
  }
}

/**
 * Get tools for an agent type
 *
 * @param agentType - Agent type (explore, plan, build)
 * @returns Tools object
 */
async function getToolsForAgent(
  agentType: "explore" | "plan" | "build"
): Promise<Record<string, unknown>> {
  // Import from phase-tools to avoid circular dependency with registry
  const { getToolsForPhase } = await import("../tools/phase-tools");
  return getToolsForPhase(agentType);
}
