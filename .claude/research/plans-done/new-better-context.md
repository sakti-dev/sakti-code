# Better Context: Native AI SDK v6 Tool Implementation Plan (Z.ai-first)

## Cohesion Addendum (2026-01-28)
Aligned to `00-cohesion-summary.md`.

Key overrides:
- Orchestration: XState Plan/Build owns session lifecycle; sub-agents are XState-controlled.
- Providers: Z.ai-first with AI SDK v6, provider-agnostic.
- Sessions: UUIDv7 server-generated; stored in Drizzle; tool sessions in `tool_sessions`.
- Repo cache persistence: Drizzle/libsql `repo_cache` table (not Mastra store).

---

## Overview

**Goal**: Replicate btca's code search capabilities as a native Vercel AI SDK v6 tool with Z.ai as the default provider (still provider-agnostic), enabling agents to search and understand library source code during execution.

**Reference**: btca (https://btca.dev) - CLI tool that clones git repos and uses AI to answer questions about source code.

---

## Part 1: btca Architecture Analysis

### Current btca Stack

```
┌─────────────────────────────────────────────────────────────────────┐
│                            btca Stack                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │   CLI/TUI    │───▶│   Server     │───▶│   Daytona Sandbox    │  │
│  │              │    │              │    │   (Isolated Env)     │  │
│  └──────────────┘    └──────────────┘    └──────────────────────┘  │
│                             │                        │             │
│                             ▼                        ▼             │
│                    ┌──────────────┐      ┌──────────────────────┐  │
│                    │ Git Resource │      │  OpenCode Instance   │  │
│                    │   (Clone)    │      │  (Local Agent)       │  │
│                    └──────────────┘      └──────────────────────┘  │
│                             │                        │             │
│                             ▼                        ▼             │
│                    ┌──────────────────────────────────────────┐   │
│                    │         Search Results                    │   │
│                    └──────────────────────────────────────────┘   │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Components Deep Dive

#### 1. Git Resource Management (`apps/server/src/resources/impls/git.ts`)

**Capabilities**:

- Clone repositories with depth=1 for speed
- Sparse checkout for partial repo cloning
- Branch validation and switching
- Error pattern detection (40+ git error patterns)
- Automatic updates via `git fetch + reset --hard`

#### 2. OpenCode Agent Integration (`apps/server/src/agent/service.ts`)

**Capabilities**:

- Creates local OpenCode instances on random ports (3000-6000)
- Manages agent lifecycle with registry tracking
- Configures agent with specific tools (read, grep, glob, list)
- Stream-based event handling for real-time responses

#### 3. Daytona Sandbox (`apps/sandbox/src/index.ts`)

**Capabilities**:

- Pre-built snapshots with tools installed
- Isolated execution environments
- Background process management

---

## Part 2: Native Tool Design

### Architecture Decisions

| Aspect            | btca Approach       | Native Tool Approach           | Rationale                                 |
| ----------------- | ------------------- | ------------------------------ | ----------------------------------------- |
| **Sandboxing**    | Daytona SDK         | **None** (local fs only)       | Not needed; we control code execution     |
| **AI Provider**   | OpenCode SDK only   | Z.ai via AI SDK v6 (default)   | AI SDK v6 is provider-agnostic            |
| **Instance Mgmt** | Port-based registry | **Session-based sub-agent**    | Simpler, supports follow-up questions     |
| **Code Search**   | OpenCode tools      | **ts-morph AST + grep**        | Type-aware parsing for btca-style queries |
| **Caching**       | Filesystem          | In-memory LRU + TTL            | Faster, automatic cleanup                 |
| **Research Mode** | Single-shot queries | **Session-based conversation** | Supports follow-up questions              |

### Proposed Architecture (REVISED)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    search_docs Tool (Thin Wrapper)                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  1. User calls search_docs({ resource, query, sessionId })          │
│  2. Tool clones/updates repo (or uses cached)                        │
│  3. Tool spawns/returns sub-agent session                            │
│  4. Sub-agent does actual research with AST + grep tools            │
│  5. Returns structured findings (not raw search results)             │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Code Research Sub-Agent (Session-Based)                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Tools (3 total - minimal but powerful):                             │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  ast_query - Universal AST tool (ts-morph)                    │   │
│  │  - find_functions, find_classes, find_interfaces             │   │
│  │  - get_signature (with type info!)                            │   │
│  │  - resolve_type (what properties does Tool have?)             │   │
│  │  - get_references, get_implementations                         │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  grep_search - Fast text search (ripgrep)                     │   │
│  │  - Quick pattern matching                                      │   │
│  │  - Search many files at once                                  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  file_read - Read file contents                               │   │
│  │  - See full implementation                                    │   │
│  │  - Understand context                                         │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Design Insight: Sub-Agent Pattern

**Why sub-agent instead of direct search?**

1. **LLM Reasoning**: Agent understands context, not just pattern matching
2. **Structured Output**: Returns "findings" not "grep lines"
3. **Multi-step**: Can grep → read files → synthesize
4. **Follow-up Questions**: Session persists for related queries

```
User: "How does tool execution work?"
→ search_docs clones repo, spawns sub-agent
→ Sub-agent uses ast_query, grep_search, file_read
→ Returns: "Tool execution happens in ToolCallManager..."
→ Structured with examples

User: "What about error handling?"
→ Same sub-agent continues (no re-clone)
→ Returns: "Errors are caught at line 175, wrapped in..."
```

---

## Part 3: AST Parser Selection - ts-morph

### Why Type-Aware Parsing Matters

**Your use case**: btca-style code research where users want to understand **how to use** APIs.

**Example Question**: "How do I use `generateText()` in AI SDK v6?"

| Parser Type                          | Can Answer  | Output                                                                                                                                                       |
| ------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **typescript-estree** (parsing only) | ❌ Partial  | "Function `generateText` takes parameter `model` of type `LanguageModel`"                                                                                   |
| **ts-morph** (type-aware)            | ✅ Complete | "Function `generateText` takes `model` (e.g., `zai('glm-4.7')`), `messages: Message[]`, and `tools`. Returns `Promise<GenerateTextResult>`."                 |

### Parser Comparison

| Parser            | Speed      | Type Info | API Style  | Best For                                   |
| ----------------- | ---------- | --------- | ---------- | ------------------------------------------ |
| **ts-morph**      | 🐢 Slow    | ✅ Full   | Fluent OOP | Code manipulation, **type-aware analysis** |
| typescript-estree | 🚀 Fast    | ❌ None   | ESTree     | Fast parsing, linting                      |
| @babel/parser     | 🚀 Fast    | ❌ None   | ESTree     | Fast parsing, transformations              |
| swc               | ⚡ Extreme | ❌ None   | ESTree     | Ultra-fast bulk processing                 |

### What Each Parser CAN/CANNOT Do

**typescript-estree (parsing only):**

```typescript
// Source: function createUser(data: UserData): User
✅ Knows: Function name is "createUser"
✅ Knows: Parameter name is "data"
✅ Knows: Type annotation is "UserData" (as string)
❌ CANNOT tell: What properties does UserData have?
```

**ts-morph (type-aware):**

```typescript
const param = function.getParameter('data');
const type = param.getType();

✅ Returns: UserData has properties:
   - name: string
   - email: string
   - age: number
✅ Can generate usage examples
✅ Can resolve inheritance chains
```

### For Your Use Case (btca-style)

| Question                             | Need ts-morph?                         |
| ------------------------------------ | -------------------------------------- |
| "What functions exist?"              | ❌ No                                  |
| "What is the signature?"             | ❌ No (annotation as string is enough) |
| "What parameters do I need to pass?" | ✅ **YES** - need type contents        |
| "Show me usage examples"             | ✅ **YES** - need type info            |
| "What does this function return?"    | ✅ **YES** - need resolved return type |

### Recommendation: **ts-morph**

**Why?**

1. Your use case needs type resolution (answering "how do I use this?")
2. Code search is not performance-critical (clone takes longer than parsing)
3. Beautiful API reduces complexity
4. `skipLibCheck: true` handles missing dependencies

```bash
pnpm add ts-morph
# ts-morph includes typescript as peer dependency
```

---

## Part 4: The 3 Minimal Tools

### Decision Matrix

```
┌─────────────────────────────────────────────────────────────────┐
│                    Decision Tree                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  "I want to find..."                                             │
│                                                                  │
│  ┌─► All functions/classes/interfaces? → ast_query (find_*)      │
│  │                                                                │
│  ├─► What parameters does this take? → ast_query (get_signature) │
│  │                                                                │
│  ├─► What does this type contain? → ast_query (resolve_type)     │
│  │                                                                │
│  ├─► Where is this used? → ast_query (get_references)            │
│  │                                                                │
│  ├─► Text pattern in many files? → grep_search                   │
│  │                                                                │
│  └─► See full implementation? → file_read                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**AI SDK v6 note**: Tools are created with `tool({ description, parameters, execute })` and registered by name in the `tools` object (e.g., `tools: { ast_query: astQuery }`). We keep output validation inside `execute` when needed.

### Tool 1: ast_query (Universal AST Tool)

**Key Design**: One flexible tool with `queryType` parameter instead of 10 separate tools.

```typescript
const astQueryOutputSchema = z.object({
  results: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["function", "class", "interface", "type", "variable"]),
      location: z.object({ file: z.string(), line: z.number() }),

      // For functions
      signature: z.string().optional(),
      parameters: z
        .array(
          z.object({
            name: z.string(),
            type: z.string(),
            optional: z.boolean(),
          })
        )
        .optional(),
      returnType: z.string().optional(),

      // For resolve_type
      properties: z
        .array(
          z.object({
            name: z.string(),
            type: z.string(),
          })
        )
        .optional(),
    })
  ),
});

export const astQuery = tool({
  description: `Query TypeScript AST to find and understand code structures.
  This single tool handles all AST operations through the queryType parameter.`,

  parameters: z.object({
    queryType: z.enum([
      "find_functions", // Find all functions
      "find_classes", // Find all classes
      "find_interfaces", // Find all interfaces
      "find_types", // Find all type aliases
      "find_exports", // Get all exports from file
      "get_signature", // Get function signature with type info
      "resolve_type", // Resolve what a type contains
      "get_references", // Find where symbol is used
      "get_implementations", // Find what implements interface
      "get_extensions", // Find what interface extends
    ]),

    target: z.string().describe(`
      What to query:
      - For find_*: file path or directory
      - For get_signature: function name
      - For resolve_type: type name (e.g., "Tool", "UserData")
    `),

    file: z.string().optional().describe(`
      Specific file to search in (optional for directory queries)
    `),
  }),

  execute: async args => {
    const project = getOrCreateProject();
    const repoPath = getRepoPath(); // From session context

    let result;
    switch (args.queryType) {
      case "find_functions":
        result = await findFunctions(project, repoPath, args.file);
        break;

      case "get_signature":
        result = await getSignature(project, repoPath, args.target);
        break;

      case "resolve_type":
        result = await resolveType(project, repoPath, args.target);
        break;

      case "get_references":
        result = await getReferences(project, repoPath, args.target);
        break;

      // ... other cases
    }

    return astQueryOutputSchema.parse(result);
  },
});
```

#### Implementation Examples

```typescript
import { Project, SyntaxKind, Node } from "ts-morph";

// Singleton project (reused across queries)
let projectInstance: Project | null = null;

function getOrCreateProject(repoPath: string): Project {
  if (!projectInstance) {
    const { Project } = require("ts-morph");
    projectInstance = new Project({
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
        skipLibCheck: true, // Ignore missing deps
        skipDefaultLibCheck: true,
        esModuleInterop: true,
      },
    });
  }

  // Add directory if not already added
  const sourceFiles = projectInstance.getSourceFiles();
  const alreadyAdded = sourceFiles.some(sf => sf.getFilePath().startsWith(repoPath));

  if (!alreadyAdded) {
    projectInstance.addSourceFilesAtPaths(`${repoPath}/**/*.ts`);
    projectInstance.addSourceFilesAtPaths(`${repoPath}/**/*.tsx`);
  }

  return projectInstance;
}

// Find all functions
async function findFunctions(project: Project, repoPath: string, filePath?: string) {
  const sourceFiles = filePath
    ? [project.getSourceFileOrThrow(filePath)]
    : project.getSourceFiles();

  const functions = [];

  for (const sourceFile of sourceFiles) {
    const funcs = sourceFile.getFunctions();
    for (const func of funcs) {
      functions.push({
        name: func.getName(),
        kind: "function" as const,
        location: {
          file: sourceFile.getFilePath().slice(repoPath.length + 1),
          line: func.getStartLineNumber(),
        },
        signature: func.getSignature()?.getDeclaration().getText(),
      });
    }

    // Also find exported functions via export declarations
    const exportDecls = sourceFile.getExportDeclarations();
    for (const exportDecl of exportDecls) {
      const expr = exportDecl.getExpression();
      if (Node.isFunctionDeclaration(expr)) {
        functions.push({
          name: expr.getName(),
          kind: "function" as const,
          location: {
            file: sourceFile.getFilePath().slice(repoPath.length + 1),
            line: expr.getStartLineNumber(),
          },
          signature: expr.getSignature()?.getDeclaration().getText(),
          exported: true,
        });
      }
    }
  }

  return { results: functions };
}

// Get function signature with type info
async function getSignature(project: Project, repoPath: string, functionName: string) {
  const sourceFiles = project.getSourceFiles();

  for (const sourceFile of sourceFiles) {
    // Try to find function by name
    const func = sourceFile.getFunction(functionName);
    if (func) {
      const signature = func.getSignature();
      if (!signature) continue;

      const parameters = signature.getParameters();
      const returnType = signature.getReturnType();

      return {
        results: [
          {
            name: functionName,
            kind: "function" as const,
            location: {
              file: sourceFile.getFilePath().slice(repoPath.length + 1),
              line: func.getStartLineNumber(),
            },
            signature: signature.getDeclaration().getText(),
            parameters: parameters.map(p => ({
              name: p.getName(),
              type: p.getType().getText(),
              optional: p.isOptional(),
            })),
            returnType: returnType.getText(),
          },
        ],
      };
    }
  }

  return { results: [] };
}

// Resolve what a type contains
async function resolveType(project: Project, repoPath: string, typeName: string) {
  const sourceFiles = project.getSourceFiles();

  for (const sourceFile of sourceFiles) {
    // Try to find interface or type alias
    const interfaceDecl = sourceFile.getInterface(typeName);
    if (interfaceDecl) {
      const properties = interfaceDecl.getProperties();

      return {
        results: [
          {
            name: typeName,
            kind: "interface" as const,
            location: {
              file: sourceFile.getFilePath().slice(repoPath.length + 1),
              line: interfaceDecl.getStartLineNumber(),
            },
            properties: properties.map(p => ({
              name: p.getName(),
              type: p.getType().getText(),
            })),
          },
        ],
      };
    }

    const typeAlias = sourceFile.getTypeAlias(typeName);
    if (typeAlias) {
      const type = typeAlias.getType();
      const properties = type.getProperties();

      return {
        results: [
          {
            name: typeName,
            kind: "type" as const,
            location: {
              file: sourceFile.getFilePath().slice(repoPath.length + 1),
              line: typeAlias.getStartLineNumber(),
            },
            properties: properties.map(p => ({
              name: p.getName(),
              type: p.getType().getText(),
            })),
          },
        ],
      };
    }
  }

  return { results: [] };
}

// Find references to a symbol
async function getReferences(project: Project, repoPath: string, symbolName: string) {
  const sourceFiles = project.getSourceFiles();
  const references = [];

  for (const sourceFile of sourceFiles) {
    // Find all identifier nodes matching the name
    const identifiers = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier);

    for (const identifier of identifiers) {
      if (identifier.getText() === symbolName) {
        const refs = identifier.getReferences();
        for (const ref of refs) {
          references.push({
            name: symbolName,
            kind: "reference" as const,
            location: {
              file: ref
                .getSourceFile()
                .getFilePath()
                .slice(repoPath.length + 1),
              line: ref.getStartLineNumber(),
            },
          });
        }
      }
    }
  }

  return { results: references };
}
```

### Tool 2: grep_search (Fast Text Search)

```typescript
const grepSearchOutputSchema = z.object({
  matches: z.array(
    z.object({
      file: z.string(),
      line: z.number(),
      snippet: z.string(),
    })
  ),
});

export const grepSearch = tool({
  description: `Fast text search using ripgrep. Use this for:
  - Quick pattern matching (faster than AST for simple searches)
  - Searching many files at once
  - Finding text/regex patterns in code`,

  parameters: z.object({
    pattern: z.string().describe("Search pattern (supports regex)"),
    path: z.string().default(".").describe("Directory to search in"),
    filePattern: z.string().optional().describe('File filter (e.g., "*.ts")'),
    excludePattern: z.string().optional().describe('Exclude pattern (e.g., "node_modules")'),
    contextLines: z.number().default(2).describe("Lines of context"),
  }),

  execute: async args => {
    const repoPath = getRepoPath();
    const searchPath = path.join(repoPath, args.path);

    // Use ripgrep
    const rgArgs = ["rg", "--json", "--no-config", "-C", String(args.contextLines)];

    if (args.filePattern) {
      rgArgs.push("-g", args.filePattern);
    }
    if (args.excludePattern) {
      rgArgs.push("-g", `!${args.excludePattern}`);
    }

    rgArgs.push(args.pattern, searchPath);

    const results = await execRipgrep(rgArgs);

    return grepSearchOutputSchema.parse({ matches: results });
  },
});
```

### Tool 3: file_read (Read File Contents)

```typescript
const fileReadOutputSchema = z.object({
  content: z.string(),
  lineCount: z.number(),
});

export const fileRead = tool({
  description: `Read file contents. Use this to:
  - See full implementation of a function/class
  - Understand context around AST query results
  - Read specific files for detailed analysis`,

  parameters: z.object({
    path: z.string().describe("File path to read"),
    startLine: z.number().optional().describe("Start at line"),
    endLine: z.number().optional().describe("End at line"),
  }),

  execute: async args => {
    const repoPath = getRepoPath();
    const fullPath = path.join(repoPath, args.path);

    let content = await fs.readFile(fullPath, "utf-8");

    // Handle line ranges
    if (args.startLine || args.endLine) {
      const lines = content.split("\n");
      const start = args.startLine || 1;
      const end = args.endLine || lines.length;
      content = lines.slice(start - 1, end).join("\n");
    }

    return fileReadOutputSchema.parse({
      content,
      lineCount: content.split("\n").length,
    });
  },
});
```

---

## Part 5: Component Specifications

### 5.1 Session Store

**Purpose**: Manage cloned repositories AND sub-agent sessions

```typescript
interface ClonedRepo {
  resourceKey: string;
  url: string;
  branch: string;
  localPath: string;
  clonedAt: number;
  lastUpdated: number;
  searchPaths: string[];
  metadata: {
    commit?: string;
  };
}

// Extended session with sub-agent
interface DocSession {
  id: string;
  createdAt: number;
  lastAccessed: number;
  repos: Map<string, ClonedRepo>;

  // NEW: Sub-agent sessions, keyed by repo
  subAgentIdsByRepo: Map<string, string>; // resourceKey -> subAgentId
  subAgentConversation?: Message[];
}

const docSessions = new Map<string, DocSession>();
```

**Session Lifecycle (explicit behavior)**:

- `sessionId` is **optional** input. If missing, create a new session and **return** it in the response so callers can reuse it.
- Treat missing `sessionId` as **ephemeral by default**: use a short TTL (20 minutes) and clean it up if unused.
- Use **LRU + TTL** cleanup for all sessions to prevent unbounded growth (evict least-recently-used beyond a cap).
- `clearSession: true` deletes the given session immediately and creates a new one for the request.
- Repo cache should be **independent** of session lifetime so cloning benefits can persist even if a session expires.
- Repo cache should **persist across app restarts** via JSON metadata (e.g., `~/.cache/search-docs/repos.json`).
  - On server startup (Hono app), load metadata and verify each repo path still exists.
  - If a repo folder is missing or invalid, evict it from the cache metadata.
  - Cache key should be stable across restarts: normalized URL + resolved ref (branch/tag/commit) + searchPath.

**Persistent Repo Cache (JSON schema)**:

```json
{
  "repos": {
    "https://github.com/vercel/ai#main::packages/ai": {
      "url": "https://github.com/vercel/ai",
      "ref": "main",
      "searchPath": "packages/ai",
      "localPath": "/Users/me/.cache/search-docs/ai-sdk-main",
      "clonedAt": 1710000000000,
      "lastUpdated": 1710000000000,
      "commit": "abc123"
    }
  }
}
```

**Hono startup cache validation (pseudocode)**:

```typescript
// In server startup
const cache = loadRepoCache(); // read JSON
for (const [key, repo] of Object.entries(cache.repos)) {
  if (!fs.existsSync(repo.localPath)) {
    delete cache.repos[key];
    continue;
  }
  // Optional: verify repo is a git repo + matches expected remote
}
saveRepoCache(cache);
```

### 5.2 Git Manager

(Same as before - clone/update with sparse checkout, error handling)

### 5.3 search_docs Tool Definition (REVISED)

```typescript
const searchDocsOutputSchema = z.object({
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
  cached: z.boolean(),
  metadata: z.object({
    repository: z.string(),
    branch: z.string(),
    commit: z.string().optional(),
  }),
});

export const createSearchDocsTool = (options: { sessionId?: string } = {}) =>
  tool({
    description: `Search and understand code from git repositories.
    This tool clones a repository (if not cached) and provides a conversational
    agent that can answer questions about the codebase using AST queries.

    Use this when you need to:
    - Understand how to use an API/function
    - Find implementation details
    - See type information and usage examples
    - Research library internals`,

    parameters: z.object({
      // Session management
      sessionId: z.string().optional().describe(`
        Session ID for persisting cloned repos and conversation context.
        Reuse the same sessionId for follow-up questions without re-cloning.
      `),

      // Resource selection
      resource: z
        .enum(["ai_sdk", "zai_provider", "react", "vue", "svelte", "custom"])
        .describe('Pre-configured resource or "custom"'),

      // Custom resource
      customUrl: z.string().optional().describe('Git URL when resource="custom"'),
      customBranch: z.string().default("main"),
      searchPath: z.string().optional().describe("Subdirectory for sparse checkout"),

      // The question/query
      query: z.string().describe("Your question about the codebase"),

      // Lifecycle
      clearSession: z.boolean().default(false),
    }),

    execute: async args => {
      // Opportunistic cleanup to enforce TTL/LRU
      cleanupSessions();

      // 1. Get or create session
      const requestedSessionId = options.sessionId ?? args.sessionId;
      let sessionId = requestedSessionId || crypto.randomUUID();

      if (args.clearSession && docSessions.has(sessionId)) {
        await clearSession(sessionId);
        sessionId = crypto.randomUUID();
      }

      const session = getSession(sessionId);
      touchSession(sessionId);

      // 2. Clone/update repo
      const resourceConfig = resolveResource(args);
      const resourceKey = buildResourceKey({
        url: resourceConfig.url,
        ref: resourceConfig.branch, // resolved branch/tag/commit
        searchPath: resourceConfig.searchPath,
      });

      let repo = session.repos.get(resourceKey);
      if (!repo) {
        const gitResult = await gitManager.clone({
          url: resourceConfig.url,
          branch: resourceConfig.branch,
          searchPaths: resourceConfig.searchPath ? [resourceConfig.searchPath] : [],
          depth: 1,
          quiet: true,
        });

        if (!gitResult.success) {
          throw new Error(
            `Failed to clone: ${gitResult.error?.message}\nHint: ${gitResult.error?.hint}`
          );
        }

        repo = {
          resourceKey,
          url: resourceConfig.url,
          branch: resourceConfig.branch,
          localPath: gitResult.path,
          clonedAt: Date.now(),
          lastUpdated: Date.now(),
          searchPaths: resourceConfig.searchPath ? [resourceConfig.searchPath] : [],
          metadata: { commit: gitResult.commit },
        };

        session.repos.set(resourceKey, repo);
      }

      // 3. Create or resume sub-agent
      const subAgent = await getOrCreateSubAgent(session, repo);

      // 4. Run query with sub-agent
      const result = await subAgent.run(args.query);

      // 5. Return structured findings
      return searchDocsOutputSchema.parse({
        sessionId,
        findings: result.summary,
        evidence: result.evidence,
        cached: Date.now() - repo.clonedAt > 5000,
        metadata: {
          repository: resourceConfig.url,
          branch: resourceConfig.branch,
          commit: repo.metadata.commit,
        },
      });
    },
  });

export const searchDocs = createSearchDocsTool();
```

```typescript
function buildResourceKey(input: {
  url: string;
  ref: string; // resolved branch/tag/commit
  searchPath?: string;
}): string {
  const normalizedUrl = input.url.replace(/\.git$/, "").toLowerCase();
  const normalizedPath = (input.searchPath || "").replace(/\/+$/, "");
  return `${normalizedUrl}#${input.ref}::${normalizedPath}`;
}
```

### 5.4 Sub-Agent Factory

```typescript
interface SubAgentSession {
  id: string;
  repo: ClonedRepo;
  agent: any; // AI SDK v6 tool-loop runner
  context: Message[];
}

const subAgents = new Map<string, SubAgentSession>();

async function getOrCreateSubAgent(session: DocSession, repo: ClonedRepo): Promise<any> {
  // Reuse existing sub-agent per repo
  const existingId = session.subAgentIdsByRepo.get(repo.resourceKey);
  if (existingId && subAgents.has(existingId)) {
    return subAgents.get(existingId)!.agent;
  }

  // Create new sub-agent
  const agentId = crypto.randomUUID();

  // createToolLoopAgent is a thin wrapper around generateText/streamText + maxSteps
  const agent = createToolLoopAgent({
    name: "code_researcher",
    model: zai("glm-4.7"),
    tools: {
      ast_query: astQuery,
      grep_search: grepSearch,
      file_read: fileRead,
    },
    maxSteps: 10,
    system: `You are a code research specialist helping developers understand
    the TypeScript codebase at: ${repo.url} (branch: ${repo.branch})

    You have 3 tools available:
    1. ast_query - Use this for type-aware queries
       - Find functions, classes, interfaces
       - Get signatures with parameter types
       - Resolve what types contain (e.g., "what properties does Tool have?")
       - Find references and implementations

    2. grep_search - Fast text search
       - Use for quick keyword searches
       - Faster than AST for simple pattern matching

    3. file_read - Read file contents
       - Use to see full implementations
       - Use to understand context

    WORKFLOW:
    - Use ast_query.find_* to discover structures
    - Use ast_query.get_signature to understand function signatures
    - Use ast_query.resolve_type to see type definitions
    - Use grep_search for quick text searches
    - Use file_read to see full implementations

    Provide clear, practical answers with code examples. Focus on helping
    the developer understand HOW to use the code, not just what exists.`,
  });

  // Store sub-agent
  const subAgentSession: SubAgentSession = {
    id: agentId,
    repo,
    agent,
    context: [],
  };

  subAgents.set(agentId, subAgentSession);
  session.subAgentIdsByRepo.set(repo.resourceKey, agentId);

  return agent;
}
```

---

## Part 6: Integration Patterns

### 6.1 Direct Usage

```typescript
import { generateText } from "ai";
import { createZai } from "@ai-sdk/zai";
import { createSearchDocsTool } from "./tools/search-docs";

const zai = createZai({ apiKey: process.env.ZAI_API_KEY });

const searchDocs = createSearchDocsTool();

const result = await generateText({
  model: zai("glm-4.7"),
  messages: [
    {
      role: "user",
      content: "How do I implement a custom tool in AI SDK v6?",
    },
  ],
  tools: { search_docs: searchDocs },
});

// First call clones repo, spawns sub-agent
console.log(result.text); // "To implement a tool, use tool(...)..."

// Follow-up question (same session - no re-clone!)
const searchDocsSessionId = result.toolResults?.[0]?.result?.sessionId;
const followup = await generateText({
  model: zai("glm-4.7"),
  messages: [
    ...result.messages,
    {
      role: "user",
      content: "What about the input schema?",
    },
  ],
  tools: {
    search_docs: createSearchDocsTool({ sessionId: searchDocsSessionId }),
  },
});

console.log(followup.text); // "The input schema uses Zod..."
```

### 6.2 With XState Machine

```typescript
research: {
  initial: 'idle',
  states: {
    idle: {
      on: { RESEARCH: 'searching' },
    },
    searching: {
      invoke: {
        src: 'searchDocs',
        input: ({ context }) => ({
          resource: 'ai_sdk',
          query: context.researchQuestion,
          sessionId: context.docSessionId,
        }),
        onDone: {
          target: 'complete',
          actions: assign({
            researchFindings: ({ event }) => event.output.findings,
            docSessionId: ({ event }) => event.output.sessionId,
            evidence: ({ event }) => event.output.evidence,
          }),
        },
        onError: 'failure',
      },
    },
    complete: {
      type: 'final',
    },
  },
},
```

### 6.3 As Sub-Agent for Main Agent

```typescript
// Main agent can delegate to search_docs
const mainAgent = createToolLoopAgent({
  name: "assistant",
  model: zai("glm-4.7"),
  tools: {
    search_docs: searchDocs,
    web_search: webSearch,
    filesystem,
  },
  system: `You are a helpful assistant. When asked questions about
  external libraries or frameworks, use search_docs to research them.`,
});

// User: "How does React.useEffect work?"
// → Agent calls search_docs({ resource: 'react', query: 'useEffect' })
// → search_docs clones React repo, spawns sub-agent
// → Returns structured findings
// → Main agent synthesizes answer
```

---

## Part 7: Testing Strategy

### Unit Tests

```typescript
describe("search_docs tool", () => {
  describe("session management", () => {
    it("should create new session when sessionId not provided", async () => {
      const result = await searchDocs.execute({
        resource: "ai_sdk",
        query: "What is tool()?",
      });

      expect(result.sessionId).toBeDefined();
      expect(result.cached).toBe(false);
    });

    it("should support follow-up questions", async () => {
      const first = await searchDocs.execute({
        resource: "ai_sdk",
        query: "What is tool()?",
      });

      const sessionId = first.sessionId;

      const second = await searchDocs.execute({
        sessionId,
        resource: "ai_sdk",
        query: "What about the output schema?",
      });

      expect(second.sessionId).toBe(sessionId); // Same session!
      expect(second.cached).toBe(true);
    });
  });

  describe("sub-agent tools", () => {
    it("should use ast_query for type-aware queries", async () => {
      const result = await astQuery.execute({
        queryType: "resolve_type",
        target: "Tool",
      });

      expect(result.results).toBeDefined();
      // Should return properties of Tool interface
    });

    it("should use grep_search for quick pattern matching", async () => {
      const result = await grepSearch.execute({
        pattern: "export function",
        filePattern: "*.ts",
      });

      expect(result.matches.length).toBeGreaterThan(0);
    });
  });
});
```

### Integration Tests

```typescript
describe("search_docs integration", () => {
  it("should answer practical questions about code", async () => {
    const zai = createZai({ apiKey: process.env.ZAI_API_KEY });

    const result = await generateText({
      model: zai("glm-4.7"),
      messages: [
        {
          role: "user",
          content: "How do I use generateText in AI SDK v6? Show me the parameters.",
        },
      ],
      tools: { search_docs: searchDocs },
    });

    // Should return structured answer with:
    // - Parameter descriptions
    // - Parameter types
    // - Usage example
    expect(result.messages).toMatchSnapshot();
  });
});
```

---

## Part 8: Error Handling

### Error Categories

1. **Git Errors** - Repository not found, branch not found, auth required
2. **AST Errors** - Invalid TypeScript, missing files
3. **Search Errors** - No results, invalid query
4. **Session Errors** - Expired, too large

### Example Errors

```typescript
// Git error
{
  type: 'GIT_ERROR',
  code: 'BRANCH_NOT_FOUND',
  message: 'Branch "v5" not found',
  hint: 'Available branches: main, dev, v4',
  retryable: false,
}

// AST error
{
  type: 'AST_ERROR',
  code: 'TYPE_NOT_FOUND',
  message: 'Type "Wizard" not found in codebase',
  hint: 'Check available types with ast_query({ queryType: "find_types" })',
  retryable: false,
}

// Search error
{
  type: 'SEARCH_ERROR',
  code: 'NO_RESULTS',
  message: 'No matches found for pattern',
  hint: 'Try a broader search pattern',
  retryable: true,
}
```

---

## Part 9: Performance Considerations

### Caching Strategy

| Cache Type      | Duration         | Purpose              |
| --------------- | ---------------- | -------------------- |
| **Repo clone**  | Session (30 min) | Don't re-clone       |
| **Sub-agent**   | Session          | Conversation context |
| **AST project** | Global (process) | ts-morph singleton   |

### Optimizations

- **Shallow clones**: `--depth 1`
- **Sparse checkout**: Only needed directories
- **Single branch**: Clone specific branch only
- **ts-morph singleton**: Reuse Project instance
- **Lazy tool loading**: Load ts-morph only when needed

---

## Part 10: Implementation Checklist

### Phase 1: Core Infrastructure

- [ ] Session store (with sub-agent support)
- [ ] Git manager (clone/update)
- [ ] Error handling
- [ ] Basic tests

### Phase 2: AST Query Tool

- [ ] ts-morph integration
- [ ] Implement all query types:
  - [ ] find_functions, find_classes, find_interfaces, find_types
  - [ ] get_signature
  - [ ] resolve_type
  - [ ] get_references, get_implementations
- [ ] AST tests

### Phase 3: Supporting Tools

- [ ] grep_search (ripgrep wrapper)
- [ ] file_read
- [ ] Tool tests

### Phase 4: Sub-Agent Integration

- [ ] Sub-agent factory
- [ ] Session persistence
- [ ] Conversation context
- [ ] Integration tests

### Phase 5: Main Tool

- [ ] search_docs tool definition
- [ ] Resource configuration
- [ ] Structured output
- [ ] End-to-end tests

### Phase 6: Integration & Polish

- [ ] XState integration examples
- [ ] Documentation
- [ ] Performance optimization
- [ ] Error messages

---

## Part 11: Repository Discovery & Version Management (AGENT-DRIVEN)

### The Problem

**User Question**: "How does the main agent know which repo to search, and how do we ensure we get the correct version?"

**Example**:

- User asks: "Tell me about XState v4"
- Naive approach: Clone `https://github.com/statelyai/xstate` → gets v5 (latest)
- Problem: Wrong version, misleading information

**Solution**: Let an LLM agent handle the uncertainty through a workflow, not hard-coded rules.

### Solution: Agent-Driven Discovery Workflow

Instead of hard-coding discovery logic, we spawn a **Discovery & Research Agent (DRA)** that follows a structured workflow to handle uncertainty intelligently.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Discovery & Research Agent                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  INPUT: Natural language description                                 │
│  Example: "How to use actor correctly in xstate version 4.38.3"      │
│                                                                       │
│  WORKFLOW (Agent follows these steps):                                │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  STEP 1: PARSE                                              │    │
│  │  → Extract package name                                    │    │
│  │  → Extract version requirement                             │    │
│  │  → Extract research question                               │    │
│  │                                                             │    │
│  │  Examples:                                                  │    │
│  │  "xstate v4" → { pkg: "xstate", version: "v4.*" }          │    │
│  │  "React hooks" → { pkg: "react", context: "hooks API" }    │    │
│  │  "that router thing" → { pkg: unclear, ask_clarify }       │    │
│  └─────────────────────────────────────────────────────────────┘    │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  STEP 2: DISCOVER REPOSITORY                                │    │
│  │  → Check registry (Tier 1)                                 │    │
│  │  → Try heuristic + git ls-remote (Tier 2)                  │    │
│  │  → Check import map (Tier 3)                               │    │
│  │  → Web search fallback (Tier 4) - STUB for now             │    │
│  │                                                             │    │
│  │  Agent decisions:                                           │    │
│  │  "xstate" → found in registry                               │    │
│  │  "my-corp-lib" → use import map entry                       │    │
│  │  "unknown" → try github.com/unknown, ask user if fails     │    │
│  └─────────────────────────────────────────────────────────────┘    │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  STEP 3: RESOLVE VERSION                                    │    │
│  │  → Use git ls-remote to fetch available tags                │    │
│  │  → Match user's version to tag/branch                       │    │
│  │  → Handle semantic versions intelligently                   │    │
│  │                                                             │    │
│  │  Agent decisions:                                           │    │
│  │  "v4" → find latest v4.x tag (v4.38.3)                      │    │
│  │  "^4.0.0" → find latest 4.x (v4.38.3)                       │    │
│  │  "4.38.3" → exact match or closest                          │    │
│  │  "main" → use main branch                                   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  STEP 4: CLONE REPOSITORY                                   │    │
│  │  → git clone with resolved tag/branch                       │    │
│  │  → Shallow clone (--depth 1)                                │    │
│  │  → Sparse checkout for monorepos                            │    │
│  └─────────────────────────────────────────────────────────────┘    │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  STEP 5: RESEARCH CODEBASE                                  │    │
│  │  → Use ast_query for type-aware queries                     │    │
│  │  → Use grep_search for quick pattern matching               │    │
│  │  → Use file_read to see implementations                     │    │
│  │  → Answer the user's question                               │    │
│  └─────────────────────────────────────────────────────────────┘    │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  STEP 6: SYNTHESIZE & RETURN                                │    │
│  │  → Structure findings with evidence                         │    │
│  │  → Include code examples                                    │    │
│  │  → Return to main agent                                     │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Why Agent-Driven is Better

| Challenge           | Hard-coded Rules               | Agent-Driven Workflow                                      |
| ------------------- | ------------------------------ | ---------------------------------------------------------- |
| Version parsing     | Regex for "v4", "^4.0.0", etc. | Understands "version 4", "v4", "4.x", "four" all mean same |
| Package ambiguity   | Fail on unknown packages       | Uses context: "React hooks" → facebook/react               |
| Monorepo complexity | Hard-code tag prefixes         | Reads package.json, understands structure                  |
| Fallback strategy   | Fixed order                    | Adaptive: try registry, if package scoped try org/repo     |
| User errors         | Cryptic error messages         | Asks clarifying questions                                  |

### Tool Interface (Simplified)

```typescript
export const createSearchDocsTool = (options: { sessionId?: string } = {}) =>
  tool({
    description: `Search and understand code from git repositories.
    Provide a natural language description of what you want to know about which library.

    Examples:
    - "How to use actor correctly in xstate version 4.38.3"
    - "How do I use @ai-sdk/zai with glm-4.7?"
    - "Show me createMachine from XState v4"
    - "What are the tool execution parameters in AI SDK v6?"`,

    parameters: z.object({
      query: z.string().describe(`
        Natural language description including:
        - Which library/package
        - Which version (optional, defaults to latest)
        - What you want to know
      `),

      sessionId: z.string().optional().describe(`
        Session ID for follow-up questions.
        Reuse same sessionId to continue researching the same repository.
      `),

      clearSession: z.boolean().default(false),
    }),

    execute: async args => {
      const sessionId = options.sessionId ?? args.sessionId;

      // Spawn Discovery & Research Agent
      const dra = await spawnDRA(sessionId);

      // Agent follows workflow, returns findings
      return await dra.run(args.query);
    },
  });
```

### Discovery & Research Agent System Prompt

```typescript
const DRASystemPrompt = `You are a Code Discovery and Research Agent. Your goal is to help developers understand how to use library code by:

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
1. Check the registry database (Tier 1)
2. If not found, try heuristic resolution (Tier 2):
   - Try github.com/{org}/{pkg}
   - Try gitlab.com/{org}/{pkg}
   - Use git ls-remote to validate
3. Check import map (Tier 3)
4. If still not found, ask the user for the repository URL

### Step 3: RESOLVE the version
1. Use git ls-remote --tags to get available versions
2. Match user's version requirement:
   - "v4" → latest v4.x tag
   - "^4.0.0" → latest 4.x tag
   - "4.38.3" → exact match or closest
   - No version → main branch

### Step 4: CLONE the repository
1. Clone with resolved tag/branch (shallow, --depth 1)
2. Use sparse checkout for monorepos (only needed directory)

### Step 5: RESEARCH the codebase
Use your tools:
- **ast_query**: Find functions, get signatures, resolve types
- **grep_search**: Quick text pattern matching
- **file_read**: See full implementations

Focus on answering the user's specific question with:
- How to use the API/function
- What parameters to pass
- Type information
- Practical code examples

### Step 6: SYNTHESIZE findings
Return structured response:
1. Clear answer to their question
2. Code examples
3. Type signatures if relevant
4. File references for further reading

## TOOLS AVAILABLE

You have access to:
- **registry_lookup**: Check pre-configured package registry
- **git_probe**: Validate URL and fetch tags (git ls-remote)
- **git_clone**: Clone repository with specific version
- **import_map_lookup**: Check user's import map configuration
- **ast_query**: Type-aware code queries
- **grep_search**: Fast text search
- **file_read**: Read file contents

## EXAMPLES

User: "How to use actor correctly in xstate version 4.38.3"
Your workflow:
1. Parse: pkg="xstate", version="4.38.3", question="use actor"
2. Discover: Registry returns github.com/statelyai/xstate
3. Resolve: git ls-remote finds tag "v4.38.3"
4. Clone: git clone --branch v4.38.3
5. Research: ast_query for "actor" functions, grep for "actor" usage
6. Synthesize: Return explanation with code examples

User: "React hooks TypeScript types"
Your workflow:
1. Parse: pkg="react" (not "react-hooks"), version=latest, question="hooks types"
2. Discover: Registry returns github.com/facebook/react, searchPath="packages/react"
3. Resolve: Use main branch (latest)
4. Clone: git clone with sparse checkout packages/react
5. Research: ast_query for useState, useEffect type signatures
6. Synthesize: Return type information and examples
`;
```

### Supporting Tools for DRA

```typescript
// Tool 1: Registry lookup
export const registryLookup = tool({
  description: "Lookup a package in the local registry index.",
  parameters: z.object({
    packageName: z.string(),
  }),
  execute: async ({ packageName }) => {
    const result = db.query("SELECT url, search_path, tag_prefix FROM packages WHERE name = ?", [
      packageName,
    ]);
    return result || { found: false };
  },
});

// Tool 2: Git probe (validate URL, fetch tags)
export const gitProbe = tool({
  description: "Validate a git URL and fetch tags/branches.",
  parameters: z.object({
    url: z.string(),
  }),
  execute: async ({ url }) => {
    try {
      const tags = await execGit(["ls-remote", "--tags", "--sort=-v:refname", url]);
      const branches = await execGit(["ls-remote", "--heads", url]);
      return {
        valid: true,
        tags: parseRefs(tags),
        branches: parseRefs(branches),
      };
    } catch {
      return { valid: true, tags: [], branches: [] };
    }
  },
});

// Tool 3: Git clone (with version)
export const gitClone = tool({
  description: "Clone a repository at a specific version (tag/branch/commit).",
  parameters: z.object({
    url: z.string(),
    version: z.string().default("main"),
    searchPath: z.string().optional(),
  }),
  execute: async ({ url, version, searchPath }) => {
    // Clone logic with sparse checkout support
    // Returns local path for agent to research
  },
});

// Tool 4: Import map lookup
export const importMapLookup = tool({
  description: "Lookup a package in the user's import map config.",
  parameters: z.object({
    packageName: z.string(),
  }),
  execute: async ({ packageName }) => {
    // Load and check import map
  },
});
```

### Comparison: Before vs After

| Aspect             | Before (Hard-coded)                                   | After (Agent-Driven)                                           |
| ------------------ | ----------------------------------------------------- | -------------------------------------------------------------- |
| Input              | `{ resource: "xstate", version: "v4", query: "..." }` | `{ query: "How to use actor in xstate v4" }`                   |
| Discovery          | If/else chains, regex parsing                         | LLM interprets, handles edge cases                             |
| Version resolution | Fixed patterns                                        | Semantic understanding                                         |
| Errors             | "Package not found"                                   | "I couldn't find xstate-v4. Did you mean xstate or xstate-v5?" |
| Fallback           | Fixed order                                           | Adaptive strategy                                              |
| Extensibility      | Add new rules in code                                 | Agent learns from context                                      |

## Tiered Discovery Architecture (Now as Tool Options)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Repository Discovery Flow                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  User Query: "XState v4"                                             │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Tier 1: Pre-configured Registry (Top 10k-50k packages)     │    │
│  │  - SQLite DB: package → URL, monorepo path, tag prefix      │    │
│  │  - Fast O(1) lookup                                         │    │
│  │  - Example: "xstate" → https://github.com/statelyai/xstate  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│       │                                                              │
│       │ (Not found?)                                                 │
│       ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Tier 2: Heuristic Scope Resolution with git ls-remote      │    │
│  │  1. Try: github.com/{org}/{package}                         │    │
│  │  2. Try: gitlab.com/{org}/{package}                         │    │
│  │  3. Probe with git ls-remote --tags                          │    │
│  │  4. Validate version exists                                 │    │
│  └─────────────────────────────────────────────────────────────┘    │
│       │                                                              │
│       │ (Still not found?)                                           │
│       ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Tier 3: Import Map Configuration (User-defined)            │    │
│  │  - ~/.config/search-docs/import-map.json                    │    │
│  │  - Custom URLs, private repos, monorepo overrides           │    │
│  └─────────────────────────────────────────────────────────────┘    │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Tier 4: Web Search Fallback                               │    │
│  │  - Search: "{package} github repository"                    │    │
│  │  - Ask user to confirm                                      │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### 11.1 Tier 1: Pre-configured Registry

**Schema** (SQLite):

```sql
CREATE TABLE packages (
  name TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  -- Monorepo support
  search_path TEXT,  -- e.g., "packages/react" for facebook/react
  tag_prefix TEXT,   -- e.g., "packages/zai@" for @ai-sdk/zai
  -- Metadata
  language TEXT,     -- "typescript", "javascript", etc.
  is_monorepo BOOLEAN
);

-- Sample data
INSERT INTO packages VALUES
  ('xstate', 'https://github.com/statelyai/xstate', NULL, NULL, 'typescript', false),
  ('react', 'https://github.com/facebook/react', 'packages/react', NULL, 'typescript', true),
  ('@ai-sdk/zai', 'https://github.com/vercel/ai', 'packages/zai', 'packages/zai@', 'typescript', true);
```

**Usage**:

```typescript
function resolvePackage(packageName: string, version?: string): RepoConfig {
  const result = db.query("SELECT url, search_path, tag_prefix FROM packages WHERE name = ?", [
    packageName,
  ]);

  if (result) {
    return {
      url: result.url,
      searchPath: result.search_path,
      tagPrefix: result.tag_prefix,
    };
  }

  return null; // Fall through to Tier 2
}
```

### 11.2 Tier 2: Heuristic Resolution

**Git ls-remote Probe** (efficient, no clone):

```typescript
import { execSync } from "child_process";

interface GitRemoteResult {
  url: string;
  tags: string[];
  branches: string[];
}

function probeGitRepository(baseUrl: string): GitRemoteResult | null {
  try {
    // Get all tags (sorted by version, newest first)
    const tagsOutput = execSync(`git ls-remote --tags --sort=-v:refname ${baseUrl}`, {
      encoding: "utf-8",
      timeout: 10000,
    });

    const tags = tagsOutput
      .split("\n")
      .filter(line => line.includes("refs/tags/"))
      .map(line => line.split("\t")[1].replace("refs/tags/", "").replace("^{}", ""))
      .filter(tag => !tag.endsWith("^{}"));

    // Get branches
    const branchesOutput = execSync(`git ls-remote --heads ${baseUrl}`, {
      encoding: "utf-8",
      timeout: 10000,
    });

    const branches = branchesOutput
      .split("\n")
      .filter(line => line.includes("refs/heads/"))
      .map(line => line.split("\t")[1].replace("refs/heads/", ""));

    return { url: baseUrl, tags, branches };
  } catch (error) {
    return null;
  }
}

// Heuristic URL attempts
function discoverRepositoryUrl(packageName: string): string | null {
  const attempts = [
    // Try github first (most common)
    `https://github.com/${packageName}`,
    `https://github.com/${packageName.replace("@", "").replace("/", "-")}`,

    // Try gitlab
    `https://gitlab.com/${packageName}`,

    // Try common scoped package patterns
    `https://github.com/${packageName.split("/")[0]}/${packageName.split("/")[1]?.replace(/^@/, "")}`,
  ];

  for (const url of attempts) {
    const result = probeGitRepository(url);
    if (result) {
      return url;
    }
  }

  return null;
}
```

### 11.3 Version Resolution

**Semantic Version Normalization**:

```typescript
function resolveVersion(
  packageName: string,
  userVersion?: string,
  availableTags: string[]
): string | null {
  // No version specified → use main branch
  if (!userVersion) {
    return "main";
  }

  // Direct branch name
  if (availableTags.includes(userVersion)) {
    return userVersion;
  }

  // Semantic version matching
  const normalizedVersion = normalizeVersion(userVersion);
  const matchingTag = availableTags.find(
    tag => tag.startsWith(normalizedVersion) || tag.startsWith("v" + normalizedVersion)
  );

  return matchingTag || null;
}

function normalizeVersion(version: string): string {
  // "v4" → "4."
  // "4.38" → "4.38."
  // "^4.0.0" → "4."
  const cleaned = version.replace(/^[\^~]/, "").replace(/^v?/, "v");
  return cleaned.endsWith(".") ? cleaned : cleaned + ".";
}
```

**Examples**:

```typescript
// XState tags: ["v5.0.0", "v4.38.3", "v4.37.0", ...]

resolveVersion("xstate", "v4", tags);
// → "v4.38.3" (latest v4.x)

resolveVersion("xstate", "4.38", tags);
// → "v4.38.3"

resolveVersion("xstate", "^4.0.0", tags);
// → "v4.38.3"

resolveVersion("xstate", undefined, tags);
// → "main"
```

### 11.4 Monorepo Tag Resolution

**Problem**: Monorepos use tag prefixes like `packages/router@1.0.0`

**Solution**:

```typescript
function resolveMonorepoTag(
  packageName: string,
  version: string,
  tagPrefix: string,
  availableTags: string[]
): string | null {
  // Tag prefix from registry: "packages/router@"
  const prefix = tagPrefix;

  // Find tags matching prefix
  const matchingTags = availableTags.filter(tag => tag.startsWith(prefix));

  // Apply version resolution to filtered tags
  const versionSuffix = resolveVersion(packageName, version, matchingTags);

  if (versionSuffix) {
    return prefix + versionSuffix.replace(/^v/, "");
  }

  return null;
}

// Example: @ai-sdk/zai
// tags: ["packages/zai@0.1.0", "packages/zai@0.2.0", "packages/openai@0.3.0", ...]
// tagPrefix: "packages/zai@"

resolveMonorepoTag("@ai-sdk/zai", "0.2", "packages/zai@", tags);
// → "packages/zai@0.2.0"
```

### 11.5 Tier 3: Import Map Configuration

**User Config**: `~/.config/search-docs/import-map.json`

```json
{
  "$schema": "./import-map-schema.json",
  "imports": {
    "my-private-lib": "git@gitlab.corp.net:platform/core-lib.git",
    "@internal/utils": "https://github.com/mycompany/utils.git"
  },
  "overrides": {
    "my-monorepo-lib": {
      "url": "git@github.com:org/monorepo.git",
      "strategy": "monorepo",
      "tagPrefix": "packages/lib-a@",
      "searchPath": "packages/lib-a/src"
    }
  },
  "aliases": {
    "xstate-v4": {
      "url": "https://github.com/statelyai/xstate",
      "tag": "v4.38.3"
    },
    "react-concurrent": {
      "url": "https://github.com/facebook/react",
      "branch": "main",
      "searchPath": "packages/react"
    }
  }
}
```

**Schema Validation** (Zod):

```typescript
const ImportMapSchema = z.object({
  imports: z.record(z.string().url()),
  overrides: z.record(
    z.object({
      url: z.string().url(),
      strategy: z.enum(["monorepo", "single"]).default("single"),
      tagPrefix: z.string().optional(),
      searchPath: z.string().optional(),
    })
  ),
  aliases: z.record(
    z.object({
      url: z.string().url(),
      tag: z.string().optional(),
      branch: z.string().optional(),
      commit: z.string().optional(),
      searchPath: z.string().optional(),
    })
  ),
});
```

### 11.6 Git Manager Enhancements

**Clone with Version/Tag Support**:

```typescript
interface CloneOptions {
  url: string;
  version?: string; // Tag or branch
  commit?: string; // Specific commit hash
  searchPath?: string;
  depth?: number;
}

async function cloneRepo(options: CloneOptions): Promise<CloneResult> {
  const { url, version, commit, searchPath, depth = 1 } = options;

  // 1. Resolve version to tag/branch
  let targetRef = version || "main";

  if (version && !version.startsWith("v")) {
    const tags = await fetchRemoteTags(url);
    const resolvedTag = resolveVersion(url, version, tags);

    if (!resolvedTag) {
      throw new Error(
        `Version "${version}" not found. Available: ${tags.slice(0, 5).join(", ")}...`
      );
    }

    targetRef = resolvedTag;
  }

  // 2. Clone with specific tag
  const localPath = getLocalPath(url, targetRef);

  const args = [
    "clone",
    "--depth",
    String(depth),
    "--single-branch",
    "--branch",
    targetRef,
    url,
    localPath,
  ];

  // 3. Sparse checkout for monorepos
  if (searchPath) {
    args.splice(1, 0, "--sparse");
  }

  await execGit(args);

  // 4. Checkout specific commit if provided
  if (commit) {
    await execGit(["-C", localPath, "checkout", commit]);
  }

  // 5. Sparse checkout pull
  if (searchPath) {
    await execGit(["-C", localPath, "sparse-checkout", "set", searchPath]);
  }

  return {
    success: true,
    path: localPath,
    ref: targetRef,
    commit: commit || (await getHeadCommit(localPath)),
  };
}
```

**Fetch Remote Tags** (without cloning):

```typescript
async function fetchRemoteTags(url: string): Promise<string[]> {
  const output = await execGit(["ls-remote", "--tags", "--sort=-v:refname", url]);

  return output
    .split("\n")
    .filter(line => line.includes("refs/tags/"))
    .map(line => {
      const tag = line.split("\t")[1];
      return tag.replace("refs/tags/", "").replace("^{}", "");
    })
    .filter(tag => !tag.endsWith("^{}"));
}
```

### 11.7 Complete Discovery Flow

```typescript
interface DiscoveryResult {
  url: string;
  tag?: string;
  branch?: string;
  commit?: string;
  searchPath?: string;
  tagPrefix?: string;
}

async function discoverRepository(
  packageIdentifier: string,
  version?: string
): Promise<DiscoveryResult> {
  // 1. Check import map aliases (exact match)
  const alias = loadImportMap()?.aliases[packageIdentifier];
  if (alias) {
    return alias;
  }

  // 2. Check registry
  const registryResult = db.query("SELECT * FROM packages WHERE name = ?", [packageIdentifier]);

  if (registryResult) {
    const tags = registryResult.tag_prefix
      ? await fetchMonorepoTags(registryResult.url, registryResult.tag_prefix)
      : await fetchRemoteTags(registryResult.url);

    const resolvedVersion = registryResult.tag_prefix
      ? resolveMonorepoTag(packageIdentifier, version, registryResult.tag_prefix, tags)
      : resolveVersion(packageIdentifier, version, tags);

    return {
      url: registryResult.url,
      tag: resolvedVersion || "main",
      searchPath: registryResult.search_path,
      tagPrefix: registryResult.tag_prefix,
    };
  }

  // 3. Check import map for package pattern match
  const importMap = loadImportMap();
  for (const [pattern, url] of Object.entries(importMap?.imports || {})) {
    if (packageIdentifier.startsWith(pattern)) {
      return { url };
    }
  }

  // 4. Heuristic discovery
  const discoveredUrl = discoverRepositoryUrl(packageIdentifier);
  if (discoveredUrl) {
    const tags = await fetchRemoteTags(discoveredUrl);
    const resolvedVersion = resolveVersion(packageIdentifier, version, tags);

    return {
      url: discoveredUrl,
      tag: resolvedVersion || "main",
    };
  }

  // 5. Web search fallback
  throw new Error(
    `Repository not found for "${packageIdentifier}".\n` +
      `Please provide URL or add to import map: ~/.config/search-docs/import-map.json`
  );
}
```

### 11.8 Error Messages

**Version Not Found**:

```
❌ Version "v3" not found for xstate

Available versions:
  v5.0.0 (latest)
  v4.38.3
  v4.37.0
  ...

Hint: Use "v4" for XState v4.x or "v5" for v5.x
```

**Repository Not Found**:

```
❌ Repository not found: "unknown-package"

Tried:
  • https://github.com/unknown-package
  • https://gitlab.com/unknown-package

To fix:
  1. Add to import map: ~/.config/search-docs/import-map.json
  2. Provide full URL: customUrl="https://github.com/..."

Example import map:
  {
    "imports": {
      "unknown-package": "https://github.com/correct-org/repo.git"
    }
  }
```

### 11.9 Security Considerations

**Git Execution Safety**:

- Validate URLs (allowlist: github.com, gitlab.com, bitbucket.org)
- Timeout all git operations (10s default)
- Clone to isolated temp directory
- Clean up on error

**Input Sanitization**:

```typescript
function validateGitUrl(url: string): boolean {
  const allowedHosts = ["github.com", "gitlab.com", "bitbucket.org", "gist.github.com"];

  try {
    const parsed = new URL(url);
    return allowedHosts.includes(parsed.hostname);
  } catch {
    return false;
  }
}
```

---

## Part 12: Dependencies

```bash
# Core dependencies
pnpm add zod

# AST parsing
pnpm add ts-morph
# (typescript is peer dependency)

# Ensure ripgrep is installed
rg --version

# Optional: SQLite for registry (or use JSON file)
pnpm add better-sqlite3
```

---

## Part 13: Updated Implementation Checklist (Agent-Driven)

### Phase 1: Core Infrastructure

- [ ] Session store (with agent support)
- [ ] Git manager (clone/update with sparse checkout)
- [ ] Error handling patterns
- [ ] Basic tests

### Phase 2: Discovery Tools (for DRA)

- [ ] registry_lookup tool
  - [ ] SQLite/JSON storage
  - [ ] Seed data (top packages: xstate, react, vue, @ai-sdk/\*)
  - [ ] Query by package name
- [ ] git_probe tool
  - [ ] git ls-remote wrapper
  - [ ] Tag/branch parsing
  - [ ] URL validation
- [ ] git_clone tool
  - [ ] Version-specific cloning
  - [ ] Sparse checkout support
  - [ ] Path resolution
- [ ] import_map_lookup tool
  - [ ] Config file loader
  - [ ] Schema validation
  - [ ] Alias resolution

### Phase 3: AST Query Tool

- [ ] ts-morph integration
- [ ] Implement all query types:
  - [ ] find_functions, find_classes, find_interfaces, find_types
  - [ ] get_signature
  - [ ] resolve_type
  - [ ] get_references, get_implementations
- [ ] AST tests

### Phase 4: Supporting Tools

- [ ] grep_search (ripgrep wrapper)
- [ ] file_read
- [ ] Tool tests

### Phase 5: Discovery & Research Agent (DRA)

- [ ] System prompt (6-step workflow)
- [ ] Agent factory
- [ ] Tool assignment (registry_lookup, git_probe, git_clone, ast_query, grep_search, file_read)
- [ ] Session persistence
- [ ] Integration tests

### Phase 6: Main Tool

- [ ] search_docs tool definition (simplified, natural language input)
- [ ] DRA spawning logic
- [ ] Structured output
- [ ] End-to-end tests

### Phase 7: Integration & Polish

- [ ] XState integration examples
- [ ] Documentation
- [ ] Performance optimization
- [ ] Error messages

---

## Summary

### Key Design Decisions

1. **No Daytona** - Clone locally, no sandboxing needed
2. **Agent-Driven Discovery** - LLM agent handles uncertainty instead of hard-coded rules (NEW)
3. **Sub-Agent Pattern** - Tool spawns Discovery & Research Agent (DRA)
4. **ts-morph for AST** - Type-aware parsing is essential for btca-style queries
5. **Natural Language Input** - Simple query instead of structured parameters (NEW)
6. **Workflow-Based** - Agent follows 6-step workflow: PARSE → DISCOVER → RESOLVE → CLONE → RESEARCH → SYNTHESIZE (NEW)
7. **Session-Based** - Agent persists for follow-up questions

### Architecture Flow (Agent-Driven)

```
User: "How do I use XState v4 machine?"
    ↓
search_docs tool
    │ Input: { query: "How do I use XState v4 machine?" }
    ↓
    │ Spawn Discovery & Research Agent (DRA)
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  DRA Workflow                                                   │
├─────────────────────────────────────────────────────────────────┤
│  1. PARSE: pkg="xstate", version="v4", question="use machine"  │
│  2. DISCOVER: registry_lookup("xstate") → github.com/...       │
│  3. RESOLVE: git_probe → tags=["v4.38.3", "v5.0.0", ...]      │
│             Match "v4" → "v4.38.3"                              │
│  4. CLONE: git_clone(url, version="v4.38.3")                   │
│  5. RESEARCH: ast_query("createMachine") → signature, types    │
│  6. SYNTHESIZE: "In XState v4, use createMachine() like..."   │
└─────────────────────────────────────────────────────────────────┘
    ↓
    │ Return structured findings
    ▼
Main Agent receives answer with code examples
```

### Input Comparison

| Approach                | Input Example                                                   |
| ----------------------- | --------------------------------------------------------------- |
| **Before** (structured) | `{ resource: "xstate", version: "v4", query: "createMachine" }` |
| **After** (natural)     | `"How do I use createMachine in XState v4?"`                    |

The agent parses natural language and handles:

- `"XState v4"` → pkg: xstate, version: v4.\*
- `"that provider thing"` → pkg: @ai-sdk/zai (context inference)
- `"React 18 hooks"` → pkg: react, version: 18, topic: hooks API

### Benefits Over Original Plan

| Before        | After (This Plan)                 |
| ------------- | --------------------------------- |
| Direct search | Sub-agent with reasoning          |
| Simple grep   | Type-aware AST queries            |
| Single-shot   | Session-based conversation        |
| Raw results   | Structured findings with examples |

**Next Steps**:

1. Implement Phase 1 (Core Infrastructure)
2. Implement Phase 2 (AST Query Tool with ts-morph)
3. Test with AI SDK repo (vercel/ai)
4. Integrate into research phase of agent machine
