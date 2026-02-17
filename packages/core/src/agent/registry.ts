/**
 * Agent registry for OpenCode-inspired architecture
 *
 * Central registry of all available agent configurations.
 * Agents are identified by name and can be looked up dynamically.
 * This replaces the rigid phase-based agent system with flexible,
 * on-demand agent spawning.
 */

import type { LanguageModelV3 } from "@ai-sdk/provider";
import { createTools, ToolName } from "../tools/registry";
import { getBuildModel, getExploreModel } from "./workflow/model-provider";

/**
 * Agent mode types
 *
 * - primary: Main agent for user-facing tasks (build)
 * - subagent: Spawning-only agent for specialized tasks (explore, plan)
 */
export type AgentMode = "primary" | "subagent";

/**
 * Agent configuration schema
 *
 * Defines the complete configuration for an agent including
 * model, tools, system prompt, and execution limits.
 */
export interface AgentConfig {
  /** Unique identifier for this agent type */
  name: string;

  /** Agent mode - primary or subagent */
  mode: AgentMode;

  /** Model identifier (e.g., "glm-4.7", "glm-4.7-flash") */
  model: string;

  /** Maximum number of iterations before giving up */
  maxIterations: number;

  /** Tool names available to this agent */
  tools: ToolName[];

  /** System prompt template */
  systemPrompt: string;

  /** Optional temperature setting for LLM */
  temperature?: number;

  /** Whether this agent should be hidden from agent listings */
  hidden?: boolean;
}

/**
 * Agent Registry
 *
 * Central repository of all available agent configurations.
 * Add new agents here to make them available to the system.
 */
export const AGENT_REGISTRY: Record<string, AgentConfig> = {
  /**
   * Build Agent - Primary default agent
   *
   * Main agent for handling user requests. Has full tool access
   * and can spawn subagents for specialized tasks.
   */
  build: {
    name: "build",
    mode: "primary",
    model: "glm-4.7",
    maxIterations: 50,
    tools: [
      "read",
      "write",
      "edit",
      "multiedit",
      "apply_patch",
      "invalid",
      "ls",
      "glob",
      "bash",
      "grep",
      "webfetch",
      "sequentialthinking",
      "task",
      "task-parallel",
      "search-docs",
      "ast-query",
      "grep-search",
      "file-read-docs",
      "task-query",
      "task-mutate",
      "memory-search",
      "plan-enter",
      "plan-exit",
    ],
    systemPrompt: `You are an expert software developer and AI coding agent.

Your capabilities include:
- Reading and understanding codebases
- Writing and modifying code
- Executing commands and running tests
- Searching for information
- Spawning specialized subagents for complex tasks

**Tool Usage Guidelines:**
- Use ls ONCE per directory to understand structure - do NOT call it repeatedly with different parameters
- For finding specific files by pattern, use glob tool (e.g., "src/**/*.ts" to find TypeScript files)
- For searching file contents, use grep tool
- For reading file contents, use read tool
- Each tool call provides complete information - avoid redundant calls

When working on tasks:
1. Understand the user's goal clearly
2. Explore the codebase to understand context (use ls once, then glob/grep for specifics)
3. Make targeted, minimal changes
4. Test your changes when possible
5. Explain your actions clearly

For complex exploration or planning tasks, use the Task tool to spawn specialized subagents.

Always maintain code quality and follow existing patterns in the codebase.`,
  },

  /**
   * Explore Agent - Subagent for codebase exploration
   *
   * Read-only agent for exploring and understanding codebases.
   * Spawned by the build agent for exploration tasks.
   */
  explore: {
    name: "explore",
    mode: "subagent",
    hidden: true,
    model: "glm-4.7-flashx",
    maxIterations: 30,
    tools: [
      "read",
      "invalid",
      "ls",
      "glob",
      "grep",
      "webfetch",
      "search-docs",
      "ast-query",
      "grep-search",
      "file-read-docs",
    ],
    systemPrompt: `You are an expert code explorer. Your task is to analyze the codebase and understand:
- Project structure and architecture
- Key files and their relationships
- Dependencies and frameworks used
- Existing patterns and conventions

**Tool Usage Guidelines:**
- Use ls ONCE per directory to understand structure - do NOT call it repeatedly
- For finding specific files by pattern, use glob tool (e.g., "src/**/*.ts" to find all TypeScript files)
- For searching file contents, use grep tool
- For reading file contents, use read tool
- Each tool call provides complete information - avoid redundant calls

Use the available tools to explore the codebase thoroughly. Be methodical and document your findings.

You have read-only access. Focus on understanding rather than modifying.`,
  },

  /**
   * Plan Agent - Subagent for planning and design
   *
   * Planning agent for creating detailed implementation plans.
   * Spawned by the build agent when complex planning is needed.
   */
  plan: {
    name: "plan",
    mode: "subagent",
    hidden: true,
    model: "glm-4.7",
    maxIterations: 100,
    tools: [
      "read",
      "invalid",
      "ls",
      "glob",
      "grep",
      "webfetch",
      "search-docs",
      "ast-query",
      "grep-search",
      "file-read-docs",
      "task",
      "task-parallel",
      "plan-exit",
    ],
    systemPrompt: `You are an expert software architect. Your task is to create detailed implementation plans.

Review the task and exploration results, then create a step-by-step plan that includes:
- Files to modify or create
- Specific changes needed
- Order of operations
- Potential challenges and solutions
- Testing strategy

**Tool Usage Guidelines:**
- Use ls ONCE per directory to understand structure - do NOT call it repeatedly
- For finding specific files by pattern, use glob tool
- For searching file contents, use grep tool
- For reading file contents, use read tool
- Each tool call provides complete information - avoid redundant calls

Think through this carefully before presenting your plan. Consider edge cases and alternatives.

You have read-only access. Focus on planning rather than implementing.`,
  },
};

/**
 * Get agent configuration by name
 *
 * @param name - Agent name (e.g., "build", "explore", "plan")
 * @returns Agent configuration
 * @throws Error if agent not found
 */
export function getAgent(name: string): AgentConfig {
  const agent = AGENT_REGISTRY[name];
  if (!agent) {
    throw new Error(
      `Unknown agent: ${name}. Available agents: ${Object.keys(AGENT_REGISTRY).join(", ")}`
    );
  }
  return agent;
}

/**
 * Get the default agent name
 *
 * Returns "build" as the default agent for user-facing interactions.
 *
 * @returns Default agent name
 */
export function getDefaultAgent(): string {
  return "build";
}

/**
 * Get all available agent configurations
 *
 * Returns all non-hidden agents for listing purposes.
 *
 * @returns Array of agent configurations
 */
export function listAgents(): AgentConfig[] {
  return Object.values(AGENT_REGISTRY).filter(agent => !agent.hidden);
}

/**
 * Load language model for an agent
 *
 * Resolves model name to actual LanguageModelV3 instance.
 *
 * @param modelName - Model name from agent config
 * @returns Language model instance
 */
export function loadModel(modelName: string): LanguageModelV3 {
  // Map model names to provider functions
  const modelMap: Record<string, () => LanguageModelV3> = {
    "glm-4.7": getBuildModel, // High quality model
    "glm-4.7-flash": getBuildModel, // Fast model
    "glm-4.7-flashx": getExploreModel, // Cost-effective model
  };

  const loader = modelMap[modelName];
  if (!loader) {
    throw new Error(
      `Unknown model: ${modelName}. Available models: ${Object.keys(modelMap).join(", ")}`
    );
  }

  return loader();
}

/**
 * Resolve tool names to tool implementations
 *
 * Converts tool names from agent config to actual tool objects
 * that can be passed to the AI SDK.
 *
 * @param toolNames - Array of tool names
 * @returns Record of tool implementations
 */
export function resolveTools(toolNames: ToolName[]): Record<string, unknown> {
  return createTools(toolNames);
}
