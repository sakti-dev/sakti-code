# Tool Infrastructure

## Overview

The tool infrastructure provides the foundation for all agent tools in ekacode. This document explains the base utilities, registry system, and design patterns used across all tools.

## Design Philosophy

### Core Principles

1. **Mastra Native**: Tools use Mastra's `createTool` API
2. **Zod Validation**: All inputs/outputs validated with Zod schemas
3. **Type Safety**: Full TypeScript types for all tool interfaces
4. **Permission First**: All privileged operations check permissions
5. **Truncation**: Large outputs automatically truncated

### Tool Lifecycle

```mermaid
graph LR
    A[Agent calls tool] --> B[Validate input with Zod]
    B --> C[Check permissions]
    C --> D[Execute operation]
    D --> E[Validate output with Zod]
    E --> F[Return to agent]
```

## Base Types

### ToolExecutionContext

```typescript
export interface ToolExecutionContext extends SessionContext {
  workspaceRoot: string; // Workspace root directory
  worktreePath: string; // Worktree path (if applicable)
  ask?: (permission: string, patterns: string[]) => Promise<boolean>;
}
```

**Why This Context?**

- **workspaceRoot**: Path validation and sandbox enforcement
- **worktreePath**: Support for Git worktrees (advanced workflows)
- **ask**: Optional permission callback (tools can request permissions)

### TruncationResult

```typescript
export interface TruncationResult {
  content: string; // Truncated content
  truncated: boolean; // Whether content was truncated
  lineCount?: number; // Original line count (if truncated)
}
```

**Why Return Truncation Info?**

- Agent knows if content was truncated
- Can inform user about truncation
- Enables better decision making

### Truncation Limits

```typescript
export const TRUNCATION_LIMITS = {
  MAX_LINES: 2000, // Maximum lines before truncation
  MAX_BYTES: 50 * 1024, // Maximum bytes before truncation
  MAX_LINE_LENGTH: 2000, // Maximum line length
} as const;
```

**Why These Limits?**

| Limit      | Rationale                                    |
| ---------- | -------------------------------------------- |
| 2000 lines | Fits in most chat contexts (~50-100K tokens) |
| 50KB       | Reasonable memory per operation              |
| 2000 chars | Prevents single-line DOS attacks             |

## Truncation Utility

### Implementation

```typescript
export async function truncateOutput(
  text: string,
  options: Partial<typeof TRUNCATION_LIMITS> = {}
): Promise<TruncationResult> {
  const maxLines = options.MAX_LINES ?? TRUNCATION_LIMITS.MAX_LINES;
  const maxBytes = options.MAX_BYTES ?? TRUNCATION_LIMITS.MAX_BYTES;

  const lines = text.split("\n");

  // Check if truncation needed
  if (lines.length <= maxLines && Buffer.byteLength(text) <= maxBytes) {
    return { content: text, truncated: false, lineCount: lines.length };
  }

  // Truncate lines
  const truncatedLines = lines.slice(0, maxLines);
  const remaining = lines.length - maxLines;

  const truncated = [...truncatedLines, "", `... (${remaining} more lines truncated)`].join("\n");

  return {
    content: truncated,
    truncated: true,
    lineCount: lines.length,
  };
}
```

### Usage Pattern

```typescript
const content = await fs.readFile(filepath, "utf-8");
const { content: finalContent, truncated } = await truncateOutput(content);

if (truncated) {
  // Agent knows content was incomplete
}
```

### Custom Limits

```typescript
// Larger limit for specific operations
const result = await truncateOutput(largeText, {
  MAX_LINES: 5000,
  MAX_BYTES: 100 * 1024,
});
```

## Filesystem Utilities

### Path Validation

```typescript
export function containsPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return !relative.startsWith("..");
}
```

**How It Works**:

```typescript
// Inside workspace
containsPath("/project", "/project/src/file.ts");
// → true (relative: "src/file.ts")

// Outside workspace
containsPath("/project", "/etc/passwd");
// → false (relative: "../../etc/passwd")
```

### Path Normalization

```typescript
export function normalizePath(p: string): string {
  if (process.platform !== "win32") return p;
  try {
    return require("fs").realpathSync.native(p);
  } catch {
    return p;
  }
}
```

**Why Windows-Specific?**

- Windows has case-insensitive filesystem
- UNC paths need normalization
- Symlinks need resolution

### External Directory Detection

```typescript
export async function assertExternalDirectory(
  target: string,
  workspaceRoot: string,
  ask?: (permission: string, patterns: string[]) => Promise<boolean>
): Promise<void> {
  if (containsPath(workspaceRoot, target)) return;

  if (ask) {
    const approved = await ask("external_directory", [path.join(path.dirname(target), "*")]);

    if (!approved) {
      throw new Error(`Permission denied: External directory access to ${target}`);
    }
  }
}
```

**Usage Pattern**:

```typescript
await assertExternalDirectory(filepath, workspace.root, async (perm, patterns) => {
  return permissionMgr.requestApproval({
    id: nanoid(),
    permission: perm as any,
    patterns,
    always: [],
    sessionID: context.sessionID,
  });
});
```

### Binary File Detection

```typescript
export async function detectBinaryFile(filepath: string, content: Buffer): Promise<boolean> {
  // Check for common binary signatures
  const binarySignatures: number[][] = [
    [0x50, 0x4b], // ZIP
    [0x89, 0x50, 0x4e], // PNG
    [0xff, 0xd8, 0xff], // JPEG
    // ... more signatures
  ];

  const header = content.slice(0, 8);
  for (const sig of binarySignatures) {
    if (matchesSignature(header, sig)) return true;
  }

  // Check for null bytes
  if (content.includes(0)) return true;

  return false;
}
```

**Why Detect Binaries?**

- Prevent reading large binaries into memory
- Avoid displaying binary content in chat
- Protect against corrupted terminal output

## Tool Registry

### Design

```typescript
export const toolRegistry = {
  read: readTool,
  write: writeTool,
  edit: editTool,
  multiedit: multieditTool,
  apply_patch: applyPatchTool,
  ls: lsTool,
  glob: globTool,

  getAll(): Record<string, unknown> {
    return this as any;
  },

  getToolNames(): string[] {
    return Object.keys(this);
  },
};
```

**Why Registry Pattern?**

1. **Centralized**: All tools in one place
2. **Type-Safe**: TypeScript validates tool names
3. **Discoverable**: Easy to list available tools
4. **Extensible**: Add tools without changing consumers

### Registry Usage

```typescript
// Get all tools
const tools = toolRegistry.getAll();

// Get tool names
const names = toolRegistry.getToolNames();
// ["read", "write", "edit", "multiedit", "apply_patch", "ls", "glob"]

// Get specific tool
const readTool = toolRegistry.read;
```

### Future: Dynamic Loading

```typescript
// Future: Load tools from MCP servers
import { loadMCPTools } from "./mcp";

const githubTools = await loadMCPTools("github-mcp-server");
toolRegistry.github = githubTools;

// Get all tools including MCP
const allTools = toolRegistry.getAll();
```

## Tool Implementation Pattern

### Standard Template

```typescript
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const exampleTool = createTool({
  id: "tool-id",
  description: "Human-readable description for LLM",

  inputSchema: z.object({
    // Define input schema with Zod
    param1: z.string().describe("Parameter description"),
    param2: z.number().optional().describe("Optional parameter"),
  }),

  outputSchema: z.object({
    // Define output schema with Zod
    result: z.string(),
    metadata: z.object({
      success: z.boolean(),
    }),
  }),

  execute: async (params, context) => {
    // 1. Validate inputs (automatic via Zod)
    // 2. Check permissions if needed
    // 3. Perform operation
    // 4. Return validated output
  },
});
```

### Tool Context Access

```typescript
execute: async (params, context) => {
  // Access session context
  const sessionID = (context as any)?.sessionID;
  const messageID = (context as any)?.messageID;

  // Access workspace
  const workspace = WorkspaceInstance.getInstance();

  // Request permissions
  const approved = await permissionMgr.requestApproval({
    id: nanoid(),
    permission: "read",
    patterns: [filepath],
    always: [],
    sessionID,
  });
};
```

## Error Handling

### Validation Errors

```typescript
// Zod automatically validates inputs
execute: async ({ filePath }) => {
  // If input doesn't match schema, Mastra throws ZodError
  // No manual validation needed
};
```

### Permission Errors

```typescript
execute: async ({ filePath }, context) => {
  const approved = await permissionMgr.requestApproval(/* ... */);

  if (!approved) {
    throw new Error(`Permission denied: Cannot read ${filePath}`);
  }
};
```

### Operation Errors

```typescript
execute: async ({ filePath }) => {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return { content };
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`File not found: ${filePath}`);
    }
    if (error.code === "EACCES") {
      throw new Error(`Permission denied: ${filePath}`);
    }
    throw error;
  }
};
```

## Performance Considerations

### Async Operations

```typescript
// Always use async for file operations
execute: async ({ filePath }) => {
  const content = await fs.readFile(filePath, "utf-8");
  // ...
};
```

### Streaming Large Files

```typescript
// Future: Stream large file reads
execute: async function* ({ filePath }) {
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    yield { type: "chunk", data: chunk };
  }
}
```

### Caching

```typescript
// Future: Cache file reads
const cache = new Map<string, { content: string; timestamp: number }>();

execute: async ({ filePath }) => {
  const cached = cache.get(filePath);
  if (cached && Date.now() - cached.timestamp < 5000) {
    return cached.content; // Use cache if < 5 seconds old
  }

  const content = await fs.readFile(filePath, "utf-8");
  cache.set(filePath, { content, timestamp: Date.now() });
  return { content };
};
```

## Testing

### Unit Tests

```typescript
describe("truncateOutput", () => {
  it("should not truncate small content", async () => {
    const result = await truncateOutput("small content");
    expect(result.truncated).toBe(false);
    expect(result.content).toBe("small content");
  });

  it("should truncate large content", async () => {
    const largeContent = "x".repeat(2001).split("\n").join("\n");
    const result = await truncateOutput(largeContent, { MAX_LINES: 2000 });
    expect(result.truncated).toBe(true);
    expect(result.content).toContain("truncated");
  });
});
```

### Tool Tests

```typescript
describe("readTool", () => {
  it("should read file contents", async () => {
    const result = await readTool.execute({
      filePath: "/tmp/test.txt",
    });
    expect(result.content).toBeDefined();
  });

  it("should reject binary files", async () => {
    await expect(readTool.execute({ filePath: "/tmp/binary.bin" })).rejects.toThrow(
      "Cannot read binary file"
    );
  });
});
```

## Best Practices

### DO

- ✅ Use Zod for all input/output validation
- ✅ Check permissions before operations
- ✅ Truncate large outputs
- ✅ Provide clear error messages
- ✅ Use async for file operations
- ✅ Document tool purpose and usage

### DON'T

- ❌ Use `any` type
- ❌ Skip permission checks
- ❌ Return unvalidated data
- ❌ Throw generic errors
- ❌ Block operations unnecessarily
- ❌ Duplicate code across tools

---

_Updated: 2025-01-25_
