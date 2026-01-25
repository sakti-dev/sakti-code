# Implementation Plan: Phase 2.3 (Shell) + Phase 2.4 (Search Tools)

**Date:** 2025-01-25
**Status:** Planning
**Based on:** OpenCode tool implementation analysis

---

## Executive Summary

This plan adapts OpenCode's production-tested shell and search tools to ekacode's Mastra-based architecture. The adaptation maintains OpenCode's security patterns, permission flows, and output handling while leveraging ekacode's existing infrastructure (PermissionManager, WorkspaceInstance, Mastra tools).

---

## Tech Stack Adaptation Matrix

| Component             | OpenCode                  | ekacode                            | Adaptation Strategy                                 |
| --------------------- | ------------------------- | ---------------------------------- | --------------------------------------------------- |
| **Tool Factory**      | `Tool.define()` (custom)  | `createTool()` (Mastra)            | Use Mastra's tool factory                           |
| **Shell Runtime**     | Bun shell                 | Node.js `child_process`            | Replace `$.sync()` with `spawn()`                   |
| **Bash Parser**       | web-tree-sitter (WASM)    | tree-sitter (Node bindings)        | Use `tree-sitter` + `tree-sitter-bash` npm packages |
| **Grep Binary**       | Bundled ripgrep           | Bundled ripgrep                    | Same approach                                       |
| **Web Search**        | Exa AI MCP                | Tavily or free API                 | Use Tavily (MCP) or DuckDuckGo                      |
| **Web Fetch**         | Turndown + HTMLRewriter   | Turndown + jsdom                   | Same libraries, Node compatible                     |
| **Permission System** | `ctx.ask()`               | `PermissionManager`                | Use existing system                                 |
| **Truncation**        | Custom truncation.ts      | Existing `truncateOutput()`        | Reuse with enhancements                             |
| **Path Security**     | `Instance.containsPath()` | `WorkspaceInstance.containsPath()` | Use existing method                                 |

---

## File Structure

```
packages/ekacode/src/
├── tools/
│   ├── shell/
│   │   ├── bash.tool.ts          # Main shell tool (Mastra)
│   │   ├── parser.ts             # Tree-sitter bash parser wrapper
│   │   ├── kill-tree.ts          # Process tree cleanup utility
│   │   └── shell-selector.ts     # Shell detection (bash/zsh/sh)
│   ├── search/
│   │   ├── grep.tool.ts          # Ripgrep wrapper (Mastra)
│   │   ├── ripgrep.ts            # Binary management
│   │   ├── websearch.tool.ts     # Web search (Tavily)
│   │   └── webfetch.tool.ts      # HTTP fetch + markdown
│   └── base/
│       ├── truncation.ts         # (exists, may enhance)
│       └── filesystem.ts         # (exists, may enhance)
```

---

## Phase 2.3: Shell Tool (bash)

### Implementation Specifications

#### 1. Tool Schema (Zod)

```typescript
inputSchema: z.object({
  command: z.string().describe("The command to execute"),
  timeout: z.number().optional().describe("Optional timeout in milliseconds (default: 120000)"),
  workdir: z.string().optional().describe("Working directory (default: workspace root)"),
  description: z.string().describe("Clear description (5-10 words)"),
});

outputSchema: z.object({
  output: z.string(),
  exitCode: z.number(),
  metadata: z.object({
    truncated: z.boolean().optional(),
    timedOut: z.boolean().optional(),
    aborted: z.boolean().optional(),
  }),
});
```

#### 2. Key Features from OpenCode

| Feature              | OpenCode Implementation       | ekacode Adaptation                          |
| -------------------- | ----------------------------- | ------------------------------------------- |
| **Command parsing**  | web-tree-sitter WASM          | `tree-sitter` npm + `tree-sitter-bash`      |
| **Path resolution**  | Bun `$.sync()` for `realpath` | Node `child_process.spawn()` for `realpath` |
| **Permission check** | `ctx.ask()` before exec       | `PermissionManager.requestApproval()`       |
| **Process cleanup**  | `Shell.killTree()`            | Port to Node.js                             |
| **Shell detection**  | `Shell.acceptable()`          | Port to Node.js                             |
| **Output streaming** | `ctx.metadata()` updates      | Mastra tool streaming                       |
| **Timeout handling** | `setTimeout` + kill           | Same pattern                                |

#### 3. Security Measures (from OpenCode)

1. **Pre-execution path analysis** - Parse command with tree-sitter, extract file paths
2. **External directory detection** - Request permission for paths outside workspace
3. **Command whitelisting** - Map common commands to permission patterns
4. **Process tree cleanup** - Kill entire process group on abort/timeout
5. **Working directory validation** - Resolve and validate `workdir` parameter

#### 4. Description Template (from bash.txt)

Key sections to include:

- Tool purpose and use cases
- When to use vs dedicated tools
- Git safety protocol
- PR creation workflow
- Command chaining best practices

---

## Phase 2.4: Search Tools

### 2.4.1 Grep Tool (ripgrep)

#### Implementation Specifications

```typescript
inputSchema: z.object({
  pattern: z.string().describe("Regex pattern to search"),
  path: z.string().optional().describe("Directory to search (default: workspace)"),
  include: z.string().optional().describe('File pattern (e.g. "*.js", "*.{ts,tsx}")'),
});

outputSchema: z.object({
  output: z.string(),
  matches: z.number(),
  truncated: z.boolean(),
});
```

#### Key Features

| Feature                | OpenCode                           | ekacode        |
| ---------------------- | ---------------------------------- | -------------- |
| **Binary**             | Bundled ripgrep (auto-download)    | Same approach  |
| **Exit code handling** | 0=found, 1=no matches, 2=errors    | Same semantics |
| **Output format**      | Grouped by file, sorted by modtime | Same           |
| **Truncation**         | 100 matches max                    | Same           |

---

### 2.4.2 Web Search Tool

#### Implementation Options

| Option         | API            | Pros                          | Cons             |
| -------------- | -------------- | ----------------------------- | ---------------- |
| **Tavily**     | tavily.com     | MCP integration, high quality | Requires API key |
| **DuckDuckGo** | duckduckgo.com | Free, no key needed           | Lower quality    |
| **Exa AI**     | exa.ai         | OpenCode's choice             | Expensive        |

**Recommendation:** Start with Tavily (MCP server available), fallback to DDG

#### Implementation Specifications

```typescript
inputSchema: z.object({
  query: z.string().describe("Search query"),
  numResults: z.number().optional().describe("Number of results (default: 8)"),
  timeout: z.number().optional().describe("Timeout in seconds (max: 30)"),
});

outputSchema: z.object({
  output: z.string(),
  sources: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        snippet: z.string(),
      })
    )
    .optional(),
});
```

---

### 2.4.3 Web Fetch Tool

#### Implementation Specifications

```typescript
inputSchema: z.object({
  url: z.string().describe("URL to fetch"),
  format: z.enum(["text", "markdown", "html"]).default("markdown"),
  timeout: z.number().optional().describe("Timeout in seconds (max: 120)"),
});

outputSchema: z.object({
  output: z.string(),
  title: z.string().optional(),
  metadata: z.object({
    contentType: z.string().optional(),
    size: z.number().optional(),
  }),
});
```

#### Key Features

| Feature               | OpenCode         | ekacode          |
| --------------------- | ---------------- | ---------------- |
| **HTML→Markdown**     | TurndownService  | Same             |
| **Text extraction**   | HTMLRewriter     | jsdom or similar |
| **Size limit**        | 5MB max          | Same             |
| **Cloudflare bypass** | User-Agent retry | Same             |

---

## Dependencies to Install

```json
{
  "dependencies": {
    "tree-sitter": "^0.20.0",
    "tree-sitter-bash": "^0.20.0",
    "turndown": "^7.0.0",
    "jsdom": "^23.0.0"
  },
  "devDependencies": {
    "@types/turndown": "^5.0.0"
  }
}
```

For ripgrep: Use the same binary bundling approach as OpenCode (platform-specific downloads).

---

## Task Breakdown

### Phase 2.3: Shell Tool

| #     | Task                                     | Estimated Complexity |
| ----- | ---------------------------------------- | -------------------- |
| 2.3.1 | Install tree-sitter dependencies         | Low                  |
| 2.3.2 | Create `kill-tree.ts` utility            | Low                  |
| 2.3.3 | Create `shell-selector.ts`               | Low                  |
| 2.3.4 | Create `parser.ts` (tree-sitter wrapper) | Medium               |
| 2.3.5 | Create `bash.tool.ts` with Mastra        | High                 |
| 2.3.6 | Create `bash.txt` description            | Low                  |
| 2.3.7 | Test with common commands                | Medium               |
| 2.3.8 | Test permission flows                    | Medium               |

### Phase 2.4: Search Tools

| #     | Task                                    | Estimated Complexity |
| ----- | --------------------------------------- | -------------------- |
| 2.4.1 | Download and bundle ripgrep binary      | Medium               |
| 2.4.2 | Create `ripgrep.ts` manager             | Medium               |
| 2.4.3 | Create `grep.tool.ts`                   | Medium               |
| 2.4.4 | Install web fetch dependencies          | Low                  |
| 2.4.5 | Create `webfetch.tool.ts`               | High                 |
| 2.4.6 | Create `websearch.tool.ts` (Tavily/DDG) | Medium               |
| 2.4.7 | Test search tools                       | Medium               |

---

## OpenCode Best Practices to Adapt

### 1. Permission Flow Pattern

```typescript
// OpenCode pattern (from bash.ts):
await ctx.ask({
  permission: "bash",
  patterns: ["git status", "npm install"],
  always: ["git*", "npm*"],
  metadata: {},
});

// ekacode adaptation:
await permissionMgr.requestApproval({
  id: nanoid(),
  permission: "bash",
  patterns: ["git status", "npm install"],
  always: ["git*", "npm*"],
  sessionID,
});
```

### 2. Output Streaming Pattern

```typescript
// OpenCode:
ctx.metadata({
  metadata: {
    output: truncatedOutput,
    description: params.description,
  },
});

// ekacode: Use Mastra's tool streaming
// (research Mastra's streaming API)
```

### 3. Truncation Hint Pattern

```typescript
// OpenCode adds hint when truncated:
if (truncated) {
  output += `\n\n... (${remaining} more lines truncated)`;
}

// ekacode: Same pattern in truncateOutput()
```

### 4. Exit Code Semantics

```typescript
// OpenCode grep exit codes:
// 0 = matches found
// 1 = no matches (acceptable)
// 2 = errors (but may have matches)

// ekacode: Implement same semantics
```

---

## Security Considerations

### 1. Command Injection Prevention

- Parse commands with tree-sitter (don't execute raw strings)
- Validate all file paths before execution
- Reject commands with suspicious patterns

### 2. Path Traversal Protection

- Use `realpath` to resolve all paths
- Check `WorkspaceInstance.containsPath()` for external access
- Request permission for external directories

### 3. Process Isolation

- Use `detached: true` for non-Windows (process group)
- Implement proper cleanup on abort/timeout
- Kill entire process tree, not just parent

### 4. Resource Limits

- Default timeout: 2 minutes
- Max output: 2000 lines / 50KB
- Max HTTP response: 5MB

---

## Testing Strategy

### Unit Tests

- `kill-tree.ts`: Test process cleanup on all platforms
- `shell-selector.ts`: Test shell detection logic
- `parser.ts`: Test command parsing and path extraction

### Integration Tests

- Execute common commands (git, npm, ls)
- Test permission flows (external directory access)
- Test timeout handling
- Test abort/cancellation

### E2E Tests

- Full workflow: plan → execute → verify
- Multi-step commands with `&&`
- Parallel command execution

---

## Open Questions

1. **Mastra Tool Streaming:** How does ekacode's Mastra setup handle streaming output during tool execution? Need to verify if `createTool` supports streaming metadata updates.

2. **Ripgrep Distribution:** Should we bundle ripgrep binary or require system installation? OpenCode bundles it; we should likely do the same.

3. **Web Search API:** Tavily requires API key. Should we implement DuckDuckGo as fallback for offline use?

4. **Tree-sitter Performance:** Node.js tree-sitter may be slower than WASM version. Need to benchmark.

---

## Success Criteria

### Phase 2.3 (Shell)

- [ ] Can execute common commands (git, npm, ls)
- [ ] Permission requests work for external directories
- [ ] Timeout and abort work correctly
- [ ] Process tree cleanup works on all platforms
- [ ] Output truncation works
- [ ] Command parsing with tree-sitter works

### Phase 2.4 (Search)

- [ ] Grep finds matches in workspace
- [ ] Grep handles external directory permissions
- [ ] Web fetch converts HTML to markdown
- [ ] Web search returns relevant results
- [ ] All tools handle errors gracefully

---

## References

- OpenCode bash tool: `/home/eekrain/CODE/ekacode/opencode/packages/opencode/src/tool/bash.ts`
- OpenCode grep tool: `/home/eekrain/CODE/ekacode/opencode/packages/opencode/src/tool/grep.ts`
- OpenCode webfetch: `/home/eekrain/CODE/ekacode/opencode/packages/opencode/src/tool/webfetch.ts`
- ekacode read tool: `/home/eekrain/CODE/ekacode/packages/ekacode/src/tools/filesystem/read.ts`
- ekacode PermissionManager: `/home/eekrain/CODE/ekacode/packages/ekacode/src/security/permission-manager.ts`
