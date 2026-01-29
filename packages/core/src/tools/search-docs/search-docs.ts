/**
 * search-docs - Main tool for code research
 *
 * Orchestrates the Discovery & Research Agent (DRA) workflow:
 * PARSE → DISCOVER → RESOLVE → CLONE → RESEARCH → SYNTHESIZE
 */

import { tool, zodSchema } from "ai";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { getGitManager } from "./git-manager";
import { getSessionStore } from "./session-store";
import type { SubAgentResult } from "./sub-agent";
import { getSubAgentManager } from "./sub-agent";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface SearchDocsOutput {
  sessionId: string;
  findings: string;
  evidence: Array<{
    file: string;
    excerpt: string;
    relevance: string;
  }>;
  cached: boolean;
  metadata: {
    repository: string;
    branch: string;
    commit?: string;
    searchPaths?: string[];
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse natural language query to extract package, version, and question.
 * In production, this could be an LLM call. For MVP, use regex patterns.
 */
function parseQuery(query: string): {
  package: string;
  version?: string;
  question: string;
} {
  // Pattern: "package version question"
  // Examples:
  // - "xstate v4 how to use actor"
  // - "React hooks types"
  // - "@ai-sdk/zai with glm-4.7"

  const packagePattern = /@?[\w-]+\/?[\w]*/;
  const versionPattern = /v?\d+(\.\d+)*/;

  const packageMatch = query.match(packagePattern);
  const versionMatch = query.match(versionPattern);

  const packageName = packageMatch?.[0] || "";
  const version = versionMatch?.[0];
  const question = query
    .replace(packageName, "")
    .replace(version || "", "")
    .trim();

  return {
    package: packageName,
    version,
    question: question || query,
  };
}

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export interface CreateSearchDocsToolOptions {
  sessionId?: string;
}

type SearchDocsInput = {
  query: string;
  sessionId?: string;
  clearSession?: boolean;
};

/**
 * Create a search_docs tool
 *
 * Main tool that orchestrates the complete DRA workflow for code research.
 */
export const createSearchDocsTool = (options: CreateSearchDocsToolOptions = {}) =>
  tool<SearchDocsInput, SearchDocsOutput>({
    description: `Search and understand code from git repositories.

This tool clones a repository (if not cached) and provides a conversational
agent that can answer questions about the codebase using type-aware AST queries.

**Use this when you need to:**
- Understand how to use an API/function
- Find implementation details
- See type information and usage examples
- Research library internals

**Examples:**
- "How do I use generateText in AI SDK v6?"
- "XState v4 actor usage"
- "React hooks TypeScript types"
- "What parameters does tool() take in AI SDK?"

**Session Management:**
- Reuse the sessionId for follow-up questions (no re-clone)
- Sessions auto-expire after 30 minutes
- Set clearSession=true to start fresh`,

    inputSchema: zodSchema(
      z.object({
        query: z.string().describe(`
        Natural language description including:
        - Which library/package
        - Which version (optional, defaults to latest)
        - What you want to know

        Examples:
        - "How to use actor in xstate v4"
        - "React hooks TypeScript types"
        - "What is tool() in AI SDK v6?"
      `),
        sessionId: z.string().optional().describe(`
        Session ID for follow-up questions.
        Reuse same sessionId to continue researching the same repository.
      `),
        clearSession: z.boolean().default(false).describe(`
        Set to true to clear the session and start fresh.
      `),
      })
    ),

    outputSchema: zodSchema(
      z.object({
        sessionId: z.string(),
        findings: z.string().describe("AI-generated answer to your question"),
        evidence: z
          .array(
            z.object({
              file: z.string(),
              excerpt: z.string(),
              relevance: z.string(),
            })
          )
          .describe("Supporting code excerpts"),
        cached: z.boolean().describe("Whether repo was cached (no clone needed)"),
        metadata: z.object({
          repository: z.string(),
          branch: z.string(),
          commit: z.string().optional(),
          searchPaths: z.array(z.string()).optional(),
        }),
      })
    ),

    execute: async args => {
      const sessionStore = getSessionStore();
      const gitManager = getGitManager();
      const subAgentManager = getSubAgentManager();

      // 1. Get or create session
      let sessionId = options.sessionId ?? args.sessionId;
      let shouldCreateNew = false;

      if (args.clearSession && sessionId) {
        sessionStore.deleteSession(sessionId);
        shouldCreateNew = true;
      }

      if (!sessionId || shouldCreateNew) {
        sessionId = uuidv7();
      }

      sessionStore.getOrCreateSession(sessionId);

      // 2. Parse query
      const parsed = parseQuery(args.query);
      const { package: pkg, version, question } = parsed;

      if (!pkg) {
        throw new Error(
          "Could not identify package name in query. " +
            "Please specify the package name (e.g., 'xstate', 'react', '@ai-sdk/zai')"
        );
      }

      // 3. Build resource key for cache lookup
      const resourceKey = gitManager.buildResourceKey({
        url: `https://github.com/${pkg}`, // Will be resolved by discovery
        ref: version || "main",
      });

      // 4. Check if repo is already cached
      let repo = sessionStore.getRepo(sessionId, resourceKey);
      let wasCloned = false;

      if (!repo) {
        // 5. Clone/update repo
        // For MVP, use direct URL construction
        // In production, use DRA workflow with discovery tools
        const url = `https://github.com/${pkg.replace("@", "").replace("/", "-")}`;

        const cloneResult = await gitManager.clone({
          url,
          branch: version || "main",
          searchPaths: [],
          depth: 1,
          quiet: true,
        });

        if (!cloneResult.success) {
          throw new Error(
            `Failed to clone repository: ${cloneResult.error?.message}\n` +
              `Hint: ${cloneResult.error?.hint}`
          );
        }

        repo = {
          resourceKey,
          url,
          branch: version || "main",
          localPath: cloneResult.path!,
          clonedAt: Date.now(),
          lastUpdated: Date.now(),
          searchPaths: [],
          metadata: { commit: cloneResult.commit },
        };

        sessionStore.addRepo(sessionId, repo);
        wasCloned = true;
      }

      // 6. Get or create sub-agent for this repo
      const subAgent = await subAgentManager.getOrCreate({
        repo,
        sessionId,
      });

      // 7. Run research query
      const result: SubAgentResult = await subAgent.run(question);

      // 8. Return structured findings
      return {
        sessionId,
        findings: result.summary,
        evidence: result.evidence,
        cached: !wasCloned && Date.now() - repo.clonedAt > 5000,
        metadata: {
          repository: repo.url,
          branch: repo.branch,
          commit: repo.metadata.commit,
          searchPaths: repo.searchPaths,
        },
      };
    },
  });

/**
 * Default search_docs tool instance
 */
export const searchDocs = createSearchDocsTool();
