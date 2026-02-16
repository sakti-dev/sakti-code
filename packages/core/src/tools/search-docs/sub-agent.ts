/**
 * Sub-Agent Integration for the Discovery & Research Agent (DRA)
 *
 * Creates and manages the Discovery & Research Agent that performs code research
 * using the AST, grep, and file-read tools.
 *
 */

import { createZai } from "@ekacode/zai";
import { generateText, stepCountIs } from "ai";
import { DRA_SYSTEM_PROMPT } from "../../prompts/search-docs";
import { createAstQueryTool } from "./ast-query";
import { createFileReadTool } from "./file-read";
import { createGrepSearchTool } from "./grep-search";
import type { ClonedRepo } from "./session-store";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface SubAgentConfig {
  repo: ClonedRepo;
  sessionId: string;
}

export interface SubAgentResult {
  summary: string;
  evidence: Array<{
    file: string;
    excerpt: string;
    relevance: string;
  }>;
  conversation?: unknown[];
}

// ============================================================================
// SUB-AGENT FACTORY
// ============================================================================

/**
 * Create a code research sub-agent for a specific repository.
 *
 * The sub-agent has access to:
 * - ast_query: Type-aware TypeScript code queries
 * - grep_search: Fast text search
 * - file_read: Read file contents
 */
export async function createCodeResearchAgent(config: SubAgentConfig): Promise<{
  run: (query: string) => Promise<SubAgentResult>;
}> {
  const { repo } = config;

  // Create tools scoped to this repository
  const astQuery = createAstQueryTool({ repoPath: repo.localPath });
  const grepSearch = createGrepSearchTool({ repoPath: repo.localPath });
  const fileRead = createFileReadTool({ repoPath: repo.localPath });

  // Create model (provider-agnostic, defaults to Z.ai)
  const zai = createZai({ apiKey: process.env.ZAI_API_KEY });

  return {
    run: async (query: string): Promise<SubAgentResult> => {
      const result = await generateText({
        model: zai("glm-4.7"),
        system: DRA_SYSTEM_PROMPT,
        prompt: `Research question: ${query}\n\nRepository: ${repo.url}\nBranch/Tag: ${repo.branch}${repo.searchPaths ? `\nSearch paths: ${repo.searchPaths.join(", ")}` : ""}`,
        tools: {
          ast_query: astQuery,
          grep_search: grepSearch,
          file_read: fileRead,
        },
        stopWhen: stepCountIs(10),
      });

      // Extract evidence from tool calls
      const evidence: SubAgentResult["evidence"] = [];

      for (const step of result.steps ?? []) {
        for (const toolResult of step.toolResults ?? []) {
          if (toolResult.toolName === "file_read") {
            const output = toolResult.output as { content?: string };
            evidence.push({
              file: (toolResult.input as { path?: string }).path ?? "unknown",
              excerpt: (output.content ?? "").slice(0, 500),
              relevance: "Direct source",
            });
          }
        }
      }

      return {
        summary: result.text,
        evidence,
        conversation: result.response.messages,
      };
    },
  };
}

/**
 * Sub-agent session manager.
 * Maintains sub-agent instances per repository within a session.
 */
class SubAgentManager {
  private agents: Map<string, Awaited<ReturnType<typeof createCodeResearchAgent>>> = new Map();

  async getOrCreate(
    config: SubAgentConfig
  ): Promise<Awaited<ReturnType<typeof createCodeResearchAgent>>> {
    const key = config.repo.resourceKey;

    if (!this.agents.has(key)) {
      const agent = await createCodeResearchAgent(config);
      this.agents.set(key, agent);
    }

    return this.agents.get(key)!;
  }

  clear(): void {
    this.agents.clear();
  }
}

// Singleton instance
let subAgentManagerInstance: SubAgentManager | null = null;

export function getSubAgentManager(): SubAgentManager {
  if (!subAgentManagerInstance) {
    subAgentManagerInstance = new SubAgentManager();
  }
  return subAgentManagerInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetSubAgentManager(): void {
  subAgentManagerInstance = null;
}
