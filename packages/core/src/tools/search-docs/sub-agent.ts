/**
 * Sub-Agent Integration for the Discovery & Research Agent (DRA)
 *
 * Creates and manages the Discovery & Research Agent that performs code research
 * using the AST, grep, and file-read tools.
 *
 */

import { createZai } from "@ekacode/zai";
import { generateText, stepCountIs } from "ai";
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
// DISCOVERY & RESEARCH AGENT SYSTEM PROMPT
// ============================================================================

const DRA_SYSTEM_PROMPT = `You are a Code Discovery and Research Agent. Your goal is to help developers understand how to use library code by:

1. **DISCOVERING** the correct repository and version
2. **CLONING** the source code
3. **RESEARCHING** the codebase to answer questions
4. **SYNTHESIZING** clear, practical answers

## YOUR WORKFLOW

### Step 1: PARSE the user's request
Extract:
- Package/library name (handle: "xstate", "@ai-sdk/zai", "React")
- Version requirement (handle: "v4", "^4.0.0", "4.38.3", "latest", "main")
- Research question (what they want to know)

### Step 2: DISCOVER the repository
1. Check **registry_lookup** (Tier 1) - Pre-configured packages
2. If not found, try **git_probe** with heuristic URLs (Tier 2)
3. Check **import_map_lookup** for user-defined mappings (Tier 3)
4. If still not found, explain to the user what you need

### Step 3: RESOLVE the version
1. Use **git_probe** to get available tags
2. Match user's version requirement:
   - "v4" → latest v4.x tag
   - "^4.0.0" → latest 4.x tag
   - "4.38.3" → exact match
   - No version → main branch

### Step 4: CLONE the repository
1. Use **git_clone** with resolved tag/branch
2. Use sparse checkout for monorepos

### Step 5: RESEARCH the codebase
Use your available tools:
- **ast_query**: Type-aware code queries (find functions, get signatures, resolve types)
- **grep_search**: Fast text search
- **file_read**: Read full implementations

Focus on answering the user's specific question with:
- How to use the API/function
- What parameters to pass
- Type information
- Practical code examples

### Step 6: SYNTHESIZE findings
Return structured response:
1. Clear answer to their question
2. Code examples with actual type signatures
3. File references for further reading
4. Usage patterns

## EXAMPLES

User: "How to use actor correctly in xstate version 4.38.3"
Your workflow:
1. Parse: pkg="xstate", version="4.38.3", question="use actor"
2. Discover: registry_lookup("xstate") → github.com/statelyai/xstate
3. Resolve: git_probe → tag "v4.38.3" exists
4. Clone: git_clone(url="github.com/statelyai/xstate", version="v4.38.3")
5. Research: ast_query for "actor" → grep for "actor" usage → file_read for examples
6. Synthesize: "In XState v4, actor is used for..."

User: "React hooks TypeScript types"
Your workflow:
1. Parse: pkg="react", version=latest, question="hooks types"
2. Discover: registry_lookup("react") → github.com/facebook/react, searchPath="packages/react"
3. Resolve: Use main branch (latest)
4. Clone: git_clone with sparse checkout packages/react
5. Research: ast_query for useState, useEffect type signatures
6. Synthesize: Return type information and examples`;

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
