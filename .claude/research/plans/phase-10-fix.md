# Phase 10 Fix Plan: Complete search-docs Implementation

**Date**: 2026-01-30
**Status**: Draft
**Reference**: `new-better-context.md` L1230-L1272, L2139-L2274

---

## Overview

The current implementation covers **Phases 1-3** (Core Infrastructure + Supporting Tools) but is missing critical components for a complete `search_docs` tool:

- **Phase 4**: Sub-Agent Integration (DRA factory, session persistence)
- **Phase 5**: Discovery & Research Agent (6-step workflow orchestration)
- **Phase 6**: Main Tool (user-facing `search_docs` API)
- **Phase 7**: Integration & Polish (tool registration, XState patterns)

This plan provides a structured path to complete the implementation.

---

## Current State Assessment

### ✅ Completed (48 tests passing)

| File | Lines | Tests | Status |
|------|-------|-------|--------|
| `session-store.ts` | 316 | 13 | Complete |
| `git-manager.ts` | 387 | 20 | Complete |
| `ast-query.ts` | 610 | 13 | Complete |
| `grep-search.ts` | 146 | 8 | Complete |
| `file-read.ts` | 83 | 7 | Complete |

### ❌ Missing Components

| Component | Purpose | Complexity |
|-----------|---------|------------|
| `discovery-tools.ts` | Registry, git_probe, import_map lookup | Medium |
| `sub-agent.ts` | DRA factory, agent lifecycle | High |
| `search-docs.ts` | Main tool, DRA orchestration | High |
| Tool registration | Export from tool registry | Low |
| Integration tests | End-to-end workflow | Medium |
| Documentation | Usage examples | Low |

---

## Implementation Phases

---

## Phase 4: Discovery Tools

**File**: `packages/core/src/tools/search-docs/discovery-tools.ts`

### Purpose

Provide tools for the Discovery & Research Agent (DRA) to find repositories and resolve versions without hard-coding rules.

### Components

#### 1. Registry Lookup (Tier 1 Discovery)

```typescript
/**
 * Pre-configured package registry for common libraries.
 * In production, this would be a SQLite database.
 * For MVP, use a hardcoded Map with extensibility for future DB.
 */

const PACKAGE_REGISTRY = new Map<string, {
  url: string;
  searchPath?: string;
  tagPrefix?: string;
  language: string;
  isMonorepo: boolean;
}>([
  // AI/ML Libraries
  ["ai", {
    url: "https://github.com/vercel/ai",
    searchPath: "packages/ai",
    tagPrefix: "packages/ai@",
    language: "typescript",
    isMonorepo: true,
  }],
  ["@ai-sdk/zai", {
    url: "https://github.com/vercel/ai",
    searchPath: "packages/zai",
    tagPrefix: "packages/zai@",
    language: "typescript",
    isMonorepo: true,
  }],
  ["@ai-sdk/openai", {
    url: "https://github.com/vercel/ai",
    searchPath: "packages/openai",
    tagPrefix: "packages/openai@",
    language: "typescript",
    isMonorepo: true,
  }],

  // State Management
  ["xstate", {
    url: "https://github.com/statelyai/xstate",
    language: "typescript",
    isMonorepo: false,
  }],
  ["zustand", {
    url: "https://github.com/pmndrs/zustand",
    language: "typescript",
    isMonorepo: false,
  }],
  ["redux", {
    url: "https://github.com/reduxjs/redux",
    language: "typescript",
    isMonorepo: true,
  }],

  // Frontend Frameworks
  ["react", {
    url: "https://github.com/facebook/react",
    searchPath: "packages/react",
    language: "typescript",
    isMonorepo: true,
  }],
  ["vue", {
    url: "https://github.com/vuejs/core",
    language: "typescript",
    isMonorepo: false,
  }],
  ["svelte", {
    url: "https://github.com/sveltejs/svelte",
    language: "typescript",
    isMonorepo: false,
  }],
  ["solid", {
    url: "https://github.com/solidjs/solid",
    language: "typescript",
    isMonorepo: true,
  }],

  // Build Tools
  ["vite", {
    url: "https://github.com/vitejs/vite",
    language: "typescript",
    isMonorepo: true,
  }],
  ["webpack", {
    url: "https://github.com/webpack/webpack",
    language: "typescript",
    isMonorepo: true,
  }],
  ["esbuild", {
    url: "https://github.com/evanw/esbuild",
    language: "go",
    isMonorepo: false,
  }],
  ["rspack", {
    url: "https://github.com/web-infra-dev/rspack",
    language: "rust",
    isMonorepo: true,
  }],
]);

export const registryLookup = tool({
  description: `Lookup a package in the pre-configured registry.
  Use this to find the repository URL for common libraries.

  Returns: url, searchPath (for monorepos), tagPrefix (for monorepo version tags)`,
  inputSchema: zodSchema(z.object({
    packageName: z.string().describe("Package name (e.g., 'xstate', '@ai-sdk/zai', 'react')"),
  })),
  outputSchema: zodSchema(z.object({
    found: z.boolean(),
    url: z.string().optional(),
    searchPath: z.string().optional(),
    tagPrefix: z.string().optional(),
    language: z.string().optional(),
    isMonorepo: z.boolean().optional(),
  })),
  execute: async ({ packageName }) => {
    const result = PACKAGE_REGISTRY.get(packageName);

    if (!result) {
      return { found: false };
    }

    return {
      found: true,
      ...result,
    };
  },
});
```

#### 2. Git Probe (Tier 2 Discovery)

```typescript
/**
 * Validate git URL and fetch available tags/branches.
 * Uses git ls-remote (no clone required).
 */

export interface GitProbeResult {
  valid: boolean;
  url: string;
  tags: string[];
  branches: string[];
  error?: {
    code: string;
    message: string;
  };
}

export const gitProbe = tool({
  description: `Validate a git repository URL and fetch available tags/branches.
  Uses git ls-remote (no cloning required).

  Use this to:
  - Check if a repository URL is valid
  - Discover available versions (tags)
  - Find available branches

  Returns: valid flag, tags array, branches array`,
  inputSchema: zodSchema(z.object({
    url: z.string().describe("Git repository URL to probe"),
  })),
  outputSchema: zodSchema(z.object({
    valid: z.boolean(),
    url: z.string(),
    tags: z.array(z.string()),
    branches: z.array(z.string()),
    error: z.object({
      code: z.string(),
      message: z.string(),
    }).optional(),
  })),
  execute: async ({ url }) => {
    // Validate URL first
    const gitMgr = getGitManager();
    if (!gitMgr.validateUrl(url)) {
      return {
        valid: false,
        url,
        tags: [],
        branches: [],
        error: {
          code: "INVALID_URL",
          message: "URL not in allowlist",
        },
      };
    }

    // Fetch tags (already implemented in git-manager)
    const tags = await gitMgr.fetchTags(url);

    // Fetch branches
    let branches: string[] = [];
    try {
      const output = execGit(["ls-remote", "--heads", url], true);
      branches = output
        .split("\n")
        .filter(line => line.includes("refs/heads/"))
        .map(line => line.split("\t")[1].replace("refs/heads/", ""));
    } catch {
      branches = ["main", "master"]; // Common defaults
    }

    return {
      valid: true,
      url,
      tags,
      branches,
    };
  },
});
```

#### 3. Git Clone Tool (DRA-specific)

```typescript
/**
 * Clone a repository at a specific version.
 * Wrapper around git-manager with version resolution.
 */

export const gitClone = tool({
  description: `Clone a git repository at a specific version (tag/branch).
  Uses shallow clone (--depth 1) for speed.
  Supports sparse checkout for monorepos.

  Returns: local path for code research`,
  inputSchema: zodSchema(z.object({
    url: z.string().describe("Git repository URL"),
    version: z.string().default("main").describe("Tag or branch (e.g., 'v4.38.3', 'main')"),
    searchPath: z.string().optional().describe("Subdirectory for monorepo sparse checkout"),
  })),
  outputSchema: zodSchema(z.object({
    success: z.boolean(),
    path: z.string().optional(),
    ref: z.string().optional(),
    commit: z.string().optional(),
    error: z.object({
      code: z.string(),
      message: z.string(),
      hint: z.string().optional(),
    }).optional(),
  })),
  execute: async ({ url, version, searchPath }) => {
    const gitMgr = getGitManager();

    // Resolve version to tag
    const tags = await gitMgr.fetchTags(url);
    const resolvedRef = gitMgr.resolveVersion(version, tags) || version;

    // Clone
    const result = await gitMgr.clone({
      url,
      branch: resolvedRef,
      searchPaths: searchPath ? [searchPath] : [],
      depth: 1,
      quiet: true,
    });

    if (result.success) {
      return {
        success: true,
        path: result.path,
        ref: resolvedRef,
        commit: result.commit,
      };
    }

    return {
      success: false,
      error: result.error,
    };
  },
});
```

#### 4. Import Map Lookup (Tier 3 Discovery)

```typescript
/**
 * User-defined package mappings.
 * Config file: ~/.config/search-docs/import-map.json
 */

const IMPORT_MAP_PATH = path.join(
  process.env.HOME || os.homedir(),
  ".config",
  "search-docs",
  "import-map.json"
);

interface ImportMapConfig {
  imports?: Record<string, string>;
  overrides?: Record<string, {
    url: string;
    strategy?: "monorepo" | "single";
    tagPrefix?: string;
    searchPath?: string;
  }>;
  aliases?: Record<string, {
    url: string;
    tag?: string;
    branch?: string;
    commit?: string;
    searchPath?: string;
  }>;
}

let importMapCache: ImportMapConfig | null = null;

function loadImportMap(): ImportMapConfig | null {
  if (importMapCache) {
    return importMapCache;
  }

  try {
    if (fs.existsSync(IMPORT_MAP_PATH)) {
      const content = fs.readFileSync(IMPORT_MAP_PATH, "utf-8");
      importMapCache = JSON.parse(content);
      return importMapCache;
    }
  } catch {
    // File doesn't exist or is invalid
  }

  return null;
}

export const importMapLookup = tool({
  description: `Lookup a package in the user's import map configuration.
  Config file: ~/.config/search-docs/import-map.json

  Use this for:
  - Private repositories
  - Custom package aliases
  - Monorepo overrides

  Returns: URL and configuration from import map`,
  inputSchema: zodSchema(z.object({
    packageName: z.string().describe("Package name or alias to lookup"),
  })),
  outputSchema: zodSchema(z.object({
    found: z.boolean(),
    url: z.string().optional(),
    tag: z.string().optional(),
    branch: z.string().optional(),
    commit: z.string().optional(),
    searchPath: z.string().optional(),
    tagPrefix: z.string().optional(),
  })),
  execute: async ({ packageName }) => {
    const config = loadImportMap();

    if (!config) {
      return { found: false };
    }

    // Check aliases (exact match)
    if (config.aliases?.[packageName]) {
      return {
        found: true,
        ...config.aliases[packageName],
      };
    }

    // Check overrides
    if (config.overrides?.[packageName]) {
      return {
        found: true,
        url: config.overrides[packageName].url,
        searchPath: config.overrides[packageName].searchPath,
        tagPrefix: config.overrides[packageName].tagPrefix,
      };
    }

    // Check imports (pattern match)
    for (const [pattern, url] of Object.entries(config.imports || {})) {
      if (packageName.startsWith(pattern)) {
        return { found: true, url };
      }
    }

    return { found: false };
  },
});
```

### Tests to Create

`tests/tools/search-docs/discovery-tools.test.ts`:

```typescript
describe("discovery tools", () => {
  describe("registry_lookup", () => {
    it("finds common packages (xstate, react, ai-sdk)");
    it("returns monorepo info (searchPath, tagPrefix)");
    it("returns not found for unknown packages");
  });

  describe("git_probe", () => {
    it("validates repository URLs");
    it("fetches available tags");
    it("fetches available branches");
    it("handles invalid URLs gracefully");
  });

  describe("git_clone", () => {
    it("clones repository at specific version");
    it("resolves version tags (v4 -> v4.38.3)");
    it("supports sparse checkout");
    it("handles clone errors");
  });

  describe("import_map_lookup", () => {
    it("loads config from ~/.config/search-docs/import-map.json");
    it("returns custom URLs from aliases");
    it("matches import patterns");
    it("returns not found when no config exists");
  });
});
```

---

## Phase 5: Sub-Agent Integration

**File**: `packages/core/src/tools/search-docs/sub-agent.ts`

### Purpose

Create and manage the Discovery & Research Agent (DRA) that performs code research using the AST, grep, and file-read tools.

### System Prompt

```typescript
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
- **grep_search**: Fast text pattern matching
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
```

### Sub-Agent Factory

```typescript
import { generateText } from "ai";
import { createZai } from "@ai-sdk/zai";
import { createAstQueryTool } from "./ast-query";
import { createGrepSearchTool } from "./grep-search";
import { createFileReadTool } from "./file-read";

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
        maxSteps: 10,
      });

      // Extract evidence from tool calls
      const evidence: SubAgentResult["evidence"] = [];

      for (const step of result.steps ?? []) {
        if (step.stepType === "tools" && step.toolCalls) {
          for (const toolCall of step.toolCalls) {
            if (toolCall.toolName === "file_read" && toolCall.result) {
              evidence.push({
                file: toolCall.args.path as string,
                excerpt: (toolCall.result as { content: string }).content.slice(0, 500),
                relevance: "Direct source",
              });
            }
          }
        }
      }

      return {
        summary: result.text,
        evidence,
        conversation: result.messages,
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

  async getOrCreate(config: SubAgentConfig): Promise<Awaited<ReturnType<typeof createCodeResearchAgent>>> {
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

export function resetSubAgentManager(): void {
  subAgentManagerInstance = null;
}
```

### Tests to Create

`tests/tools/search-docs/sub-agent.test.ts`:

```typescript
describe("sub-agent", () => {
  describe("createCodeResearchAgent", () => {
    it("creates agent with repo-scoped tools");
    it("runs query and returns structured result");
    it("extracts evidence from tool calls");
  });

  describe("SubAgentManager", () => {
    it("reuses agents for same repo");
    it("creates separate agents per repo");
    it("clears all agents");
  });
});
```

---

## Phase 6: Main Tool

**File**: `packages/core/src/tools/search-docs/search-docs.ts`

### Purpose

User-facing tool that orchestrates the complete DRA workflow.

### Implementation

```typescript
/**
 * search_docs - Main tool for code research
 *
 * Orchestrates the Discovery & Research Agent (DRA) workflow:
 * PARSE → DISCOVER → RESOLVE → CLONE → RESEARCH → SYNTHESIZE
 */

import { tool, zodSchema } from "ai";
import { z } from "zod";
import { v7 as uuidv7 } from "uuid";
import { getSessionStore } from "./session-store";
import { getGitManager } from "./git-manager";
import { getSubAgentManager } from "./sub-agent";
import type { SubAgentResult } from "./sub-agent";

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
// OUTPUT SCHEMA
// ============================================================================

const searchDocsOutputSchema = z.object({
  sessionId: z.string(),
  findings: z.string().describe("AI-generated answer to your question"),
  evidence: z.array(z.object({
    file: z.string(),
    excerpt: z.string(),
    relevance: z.string(),
  })).describe("Supporting code excerpts"),
  cached: z.boolean().describe("Whether repo was cached (no clone needed)"),
  metadata: z.object({
    repository: z.string(),
    branch: z.string(),
    commit: z.string().optional(),
    searchPaths: z.array(z.string()).optional(),
  }),
});

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

export const createSearchDocsTool = (options: CreateSearchDocsToolOptions = {}) =>
  tool({
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
    inputSchema: zodSchema(z.object({
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
    })),
    outputSchema: zodSchema(searchDocsOutputSchema),
    execute: async (args) => {
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

      const session = sessionStore.getOrCreateSession(sessionId);

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
      return searchDocsOutputSchema.parse({
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
      });
    },
  });

/**
 * Default search_docs tool instance
 */
export const searchDocs = createSearchDocsTool();
```

### Tests to Create

`tests/tools/search-docs/search-docs.test.ts`:

```typescript
describe("search_docs tool", () => {
  describe("session management", () => {
    it("creates new session when sessionId not provided");
    it("supports follow-up questions with same sessionId");
    it("clears session when clearSession=true");
  });

  describe("query parsing", () => {
    it("extracts package name from query");
    it("extracts version from query");
    it("handles missing package name");
  });

  describe("caching", () => {
    it("reuses cached repo for same session");
    it("sets cached=true for repos cloned >5s ago");
  });

  describe("end-to-end", () => {
    it("answers questions about code (with mocked agent)");
    it("returns structured evidence");
    it("handles clone errors gracefully");
  });
});
```

---

## Phase 7: Integration & Polish

### 1. Update Exports

**File**: `packages/core/src/tools/search-docs/index.ts`

```typescript
/**
 * search-docs tool exports
 *
 * Complete tool stack for code research:
 * - Discovery tools: registry, git_probe, git_clone, import_map
 * - Sub-agent: DRA factory for code research
 * - Main tool: search_docs (user-facing API)
 * - Supporting tools: ast_query, grep_search, file_read
 * - Infrastructure: session_store, git_manager
 */

// Infrastructure
export * from "./session-store";
export * from "./git-manager";

// Discovery tools (for DRA)
export * from "./discovery-tools";

// Sub-agent
export * from "./sub-agent";

// Supporting tools
export * from "./ast-query";
export * from "./grep-search";
export * from "./file-read";

// Main tool (user-facing)
export * from "./search-docs";
```

### 2. Register with Tool Registry

**File**: `packages/core/src/tools/index.ts` (or equivalent)

```typescript
// Add to existing tool exports:
export * from "./search-docs";
```

### 3. Create Documentation

**File**: `packages/core/docs/search-docs.md`

```markdown
# search_docs Tool

Code research tool for understanding library source code.

## Features

- **Type-aware queries**: Uses ts-morph for AST parsing with type resolution
- **Version-aware**: Research specific versions (tags/branches) of libraries
- **Session-based**: Follow-up questions without re-cloning
- **Fast caching**: Repositories cached for 30 minutes

## Usage

### Basic Usage

\`\`\`typescript
import { generateText } from "ai";
import { searchDocs } from "@ekacode/core";

const result = await generateText({
  model: zai("glm-4.7"),
  messages: [{
    role: "user",
    content: "How do I use generateText in AI SDK v6?",
  }],
  tools: {
    search_docs: searchDocs,
  },
});

console.log(result.text);
// "In AI SDK v6, generateText() is used to..."
\`\`\`

### Follow-up Questions

\`\`\`typescript
const sessionId = result.toolResults?.[0]?.result?.sessionId;

const followup = await generateText({
  model: zai("glm-4.7"),
  messages: [
    ...result.messages,
    {
      role: "user",
      content: "What about the maxSteps parameter?",
    },
  ],
  tools: {
    search_docs: createSearchDocsTool({ sessionId }),
  },
});
\`\`\`

## Available Sub-Tools

### ast_query

Type-aware TypeScript code queries:

- `find_functions`: Find all functions
- `find_classes`: Find all classes
- `get_signature`: Get function signature with types
- `resolve_type`: Get type properties
- `get_references`: Find symbol usage

### grep_search

Fast text search using ripgrep.

### file_read

Read file contents with line range support.

## Configuration

### Import Map

Create `~/.config/search-docs/import-map.json`:

\`\`\`json
{
  "aliases": {
    "my-private-lib": "https://github.com/myorg/lib.git"
  },
  "overrides": {
    "xstate": {
      "url": "https://github.com/statelyai/xstate",
      "tagPrefix": "packages/"
    }
  }
}
\`\`\`

## Architecture

```
User Query → search_docs tool
                ↓
        Discovery & Research Agent
                ↓
    ┌───────────────────────────────┐
    │  Discovery                    │
    │  - registry_lookup            │
    │  - git_probe                  │
    │  - import_map_lookup          │
    └───────────────────────────────┘
                ↓
    ┌───────────────────────────────┐
    │  Version Resolution           │
    │  - git ls-remote --tags       │
    │  - Semantic version matching  │
    └───────────────────────────────┘
                ↓
    ┌───────────────────────────────┐
    │  Clone                        │
    │  - Shallow clone (--depth 1)  │
    │  - Sparse checkout            │
    └───────────────────────────────┘
                ↓
    ┌───────────────────────────────┐
    │  Research                     │
    │  - ast_query (type-aware)     │
    │  - grep_search (fast)         │
    │  - file_read (context)        │
    └───────────────────────────────┘
                ↓
        Structured Findings
```
```

### 4. XState Integration Example

**File**: `packages/core/docs/xstate-search-docs-example.ts`

```typescript
/**
 * Example: Integrate search_docs into XState agent machine
 */

import { setup, assign, fromPromise } from "xstate";
import { searchDocs } from "@ekacode/core";

export const researchMachine = setup({
  types: {
    context: {} as {
      researchQuestion: string;
      docSessionId?: string;
      findings?: string;
      error?: string;
    },
    events: {} as
      | { type: "RESEARCH"; question: string }
      | { type: "RESEARCH_COMPLETE"; findings: string; sessionId: string }
      | { type: "RESEARCH_ERROR"; error: string },
  },
  actors: {
    searchDocs: fromPromise(async ({ input }: { input: { question: string; sessionId?: string } }) => {
      const result = await searchDocs.execute({
        query: input.question,
        sessionId: input.sessionId,
      });

      return {
        findings: result.findings,
        sessionId: result.sessionId,
      };
    }),
  },
}).createMachine({
  id: "research",
  initial: "idle",
  context: {
    researchQuestion: "",
  },
  states: {
    idle: {
      on: {
        RESEARCH: {
          target: "searching",
          actions: assign({
            researchQuestion: ({ event }) => event.question,
          }),
        },
      },
    },
    searching: {
      invoke: {
        src: "searchDocs",
        input: ({ context }) => ({
          question: context.researchQuestion,
          sessionId: context.docSessionId,
        }),
        onDone: {
          target: "complete",
          actions: assign({
            findings: ({ event }) => event.output.findings,
            docSessionId: ({ event }) => event.output.sessionId,
          }),
        },
        onError: {
          target: "failure",
          actions: assign({
            error: ({ event }) => (event.error as Error).message,
          }),
        },
      },
    },
    complete: {
      type: "final",
    },
    failure: {
      on: {
        RESEARCH: "searching",
      },
    },
  },
});
```

---

## Implementation Order

### Week 1: Discovery Tools
1. Day 1: `discovery-tools.ts` - registry_lookup, git_probe, git_clone, import_map_lookup
2. Day 2: Tests for discovery tools
3. Day 3: Integration testing with real repos

### Week 2: Sub-Agent
1. Day 1: `sub-agent.ts` - DRA factory, system prompt
2. Day 2: Tests for sub-agent
3. Day 3: Integration with existing tools (ast_query, grep_search, file_read)

### Week 3: Main Tool
1. Day 1: `search-docs.ts` - Main tool with orchestration
2. Day 2: Tests for main tool
3. Day 3: End-to-end integration tests

### Week 4: Integration & Polish
1. Day 1: Update exports, tool registry
2. Day 2: Documentation
3. Day 3: XState examples, final testing

---

## Success Criteria

- [ ] All 4 phases (4-7) implemented
- [ ] 100+ tests passing (existing 48 + new tests)
- [ ] End-to-end test: Research AI SDK v6 tool usage
- [ ] Documentation complete
- [ ] ROADMAP.md Phase 10 marked complete
- [ ] No regression in existing tests

---

## Dependencies

```bash
# Already installed
pnpm add ts-morph zod uuid

# No new dependencies required
# Uses existing: ai, @ai-sdk/zai, node:fs, node:child_process
```

---

## Open Questions

1. **Registry Backend**: JSON Map vs SQLite? (Start with JSON, migrate to SQLite if needed)
2. **Import Map Location**: `~/.config/search-docs/` vs project-local config?
3. **Session Persistence**: In-memory only vs database-backed? (Plan calls for database, but in-memory is MVP)
4. **LLM Provider**: Hard-code Z.ai or make configurable? (Plan says Z.ai-first, provider-agnostic)
