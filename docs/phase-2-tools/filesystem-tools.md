# Filesystem Tools

## Overview

This document details all 7 filesystem tools implemented in Phase 2.2. Each tool follows the Mastra `createTool` pattern with Zod validation, permission checks, and proper error handling.

## Tool Summary

| Tool          | Purpose                | Permission    | Complex |
| ------------- | ---------------------- | ------------- | ------- |
| `read`        | Read file contents     | Read (cached) | Medium  |
| `write`       | Create/overwrite files | Edit (cached) | Medium  |
| `edit`        | Replace text in files  | Edit (cached) | Simple  |
| `multiedit`   | Batch edits            | Edit (cached) | Medium  |
| `apply_patch` | Apply unified diffs    | Edit (cached) | Complex |
| `ls`          | List directories       | None          | Simple  |
| `glob`        | Find files by pattern  | None          | Simple  |

## Read Tool

### Purpose

Read file contents with optional offset/limit for pagination. Returns line-numbered output.

### Schema

```typescript
inputSchema: z.object({
  filePath: z.string().describe("Path to the file to read"),
  offset: z.coerce.number().min(0).optional().describe("Line offset to start reading"),
  limit: z.coerce.number().min(1).optional().describe("Maximum number of lines to read"),
});

outputSchema: z.object({
  content: z.string(),
  metadata: z.object({
    truncated: z.boolean(),
    lineCount: z.number(),
    filePath: z.string(),
    preview: z.boolean().optional(),
  }),
});
```

### Implementation Details

1. **Path Resolution**: Supports relative paths (from workspace root) or absolute
2. **Binary Detection**: Rejects binary files with magic signature detection
3. **Truncation**: Large files truncated to 2000 lines / 50KB
4. **Line Numbers**: Output formatted as `cat -n` (6-digit line numbers)

### Output Format

```typescript
// Input: Read package.json
// Output:
     1→{
     2→  "name": "ekacode",
     3→  "version": "0.0.1"
     4→}
```

### Use Cases

- Agent reads file to understand code structure
- Preview file contents before editing
- Read specific sections with offset/limit

### Design Decisions

**Why Line Numbers?**

- Agent can reference specific lines in edits
- User sees line numbers in chat output
- Consistent with `cat -n` convention

**Why Offset/Limit?**

- Pagination for large files
- Read specific sections without reading entire file
- Reduce token usage

## Write Tool

### Purpose

Create new files or completely overwrite existing files. Shows unified diff before writing.

### Schema

```typescript
inputSchema: z.object({
  content: z.string().describe("Content to write to the file"),
  filePath: z.string().describe("Absolute path to the file"),
});

outputSchema: z.object({
  success: z.boolean(),
  filePath: z.string(),
  diff: z.string(),
  created: z.boolean(),
});
```

### Implementation Details

1. **Diff Generation**: Uses `diff` package to create unified diff
2. **Parent Directory Creation**: Automatically creates missing directories
3. **Permission Check**: Shows diff in permission request for informed approval

### Diff Format

```typescript
// Writing to package.json
// Diff generated:
--- a/package.json
+++ b/package.json
@@ -1,3 +1,5 @@
 {
+  "name": "new-package",
   "version": "0.0.1"
+  "dependencies": {}
 }
```

### Use Cases

- Create new files
- Completely overwrite configuration files
- Generate boilerplate code

### Design Decisions

**Why Show Diff?**

- User sees exactly what will change
- Informed approval decision
- Matches OpenCode behavior

**Why Auto-Create Directories?**

- Convenience for creating nested files
- Matches user expectations (no "mkdir" first)
- Safe: only creates parent directories

## Edit Tool

### Purpose

Replace text in files using exact string matching. Supports single or replace-all.

### Schema

```typescript
inputSchema: z.object({
  filePath: z.string().describe("Absolute path to the file"),
  oldString: z.string().describe("Exact text to replace"),
  newString: z.string().describe("Replacement text"),
  replaceAll: z.boolean().optional().describe("Replace all occurrences (default: false)"),
});

outputSchema: z.object({
  success: z.boolean(),
  filePath: z.string(),
  replacements: z.number(),
});
```

### Implementation Details

1. **Exact Matching**: Uses `indexOf` for single, `split/join` for replaceAll
2. **Error on No Match**: Throws if oldString not found (prevents silent no-ops)
3. **Return Count**: Tells agent how many replacements were made

### Usage Patterns

```typescript
// Single replacement
editTool.execute({
  filePath: "/project/src/index.ts",
  oldString: "const x = 1",
  newString: "const x = 2",
  replaceAll: false,
});

// Replace all
editTool.execute({
  filePath: "/project/src/index.ts",
  oldString: "console.log",
  newString: "logger.info",
  replaceAll: true,
});
```

### Use Cases

- Rename variables or functions
- Update import statements
- Replace patterns throughout file

### Design Decisions

**Why Error on No Match?**

- Prevents silent failures
- Agent knows operation didn't work
- Forces agent to verify string exists

**Why Not Regex?**

- Simpler API (no escaping)
- Less error-prone
- Agent can use multiedit for complex patterns

## MultiEdit Tool

### Purpose

Apply multiple edits to a single file in sequence. All edits must succeed or none are applied.

### Schema

```typescript
inputSchema: z.object({
  filePath: z.string().describe("Absolute path to the file"),
  edits: z
    .array(
      z.object({
        oldString: z.string(),
        newString: z.string(),
        replaceAll: z.boolean().optional(),
      })
    )
    .min(1)
    .describe("Array of edit operations to apply sequentially"),
});

outputSchema: z.object({
  success: z.boolean(),
  filePath: z.string(),
  totalReplacements: z.number(),
  results: z.array(
    z.object({
      replacements: z.number(),
    })
  ),
});
```

### Implementation Details

1. **Sequential Execution**: Edits applied in order specified
2. **Atomic**: All edits use single permission check
3. **Individual Results**: Returns count for each edit

### Transaction Semantics

```typescript
// Current: Not truly atomic (edits apply immediately)
// If edit 3 fails, edits 1-2 are already applied

// Future: True atomicity
// 1. Read file
// 2. Apply all edits in memory
// 3. Write file only if all succeed
```

### Use Cases

- Refactor: Rename variable and update all references
- Multi-part changes: Import + usage
- Consistency updates: Same change in multiple places

### Design Decisions

**Why Sequential, Not Parallel?**

- Later edits may depend on earlier ones
- Order matters for transformations
- Simpler error handling

**Current Limitation: No Rollback**

- If edit 3 fails, edits 1-2 remain applied
- Future: Implement true atomicity with in-memory edits

## Apply Patch Tool

### Purpose

Apply unified diff patches to files. Supports add, update, delete, and move operations.

### Schema

```typescript
inputSchema: z.object({
  patchText: z.string().describe("Full unified diff patch text"),
});

outputSchema: z.object({
  success: z.boolean(),
  filesModified: z.number(),
  files: z.array(
    z.object({
      path: z.string(),
      action: z.enum(["add", "update", "delete", "move"]),
    })
  ),
});
```

### Implementation Details

1. **Patch Parsing**: Simplified parser (future: use proper diff parser)
2. **Directory Creation**: Creates parent directories
3. **Single File**: Current implementation handles one file per patch

### Patch Format

```diff
--- a/old.txt
+++ b/new.txt
@@ -1,3 +1,4 @@
 line 1
 line 2
-line 3
+line 3 modified
+line 4 added
```

### Limitations

**Current**: Simplified parser, single file

**Future Enhancements**:

- Use `diff-parser` package for robust parsing
- Support multi-file patches
- Handle delete and move operations properly

### Use Cases

- Apply patches from external sources
- Code review workflow integration
- Git-style modifications

## LS Tool

### Purpose

List directory contents. Supports recursive listing.

### Schema

```typescript
inputSchema: z.object({
  dirPath: z.string().describe("Path to the directory"),
  recursive: z.boolean().optional().describe("List recursively (default: false)"),
});

outputSchema: z.object({
  entries: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      type: z.enum(["file", "directory"]),
    })
  ),
  count: z.number(),
});
```

### Implementation Details

1. **Relative Paths**: Returns paths relative to workspace
2. **Type Detection**: Uses `withFileTypes: true` for efficient type checking
3. **Error Handling**: Ignores ENOENT (directory doesn't exist)

### Output Format

```typescript
// Input: ls({ dirPath: "src", recursive: true })
// Output:
{
  entries: [
    { name: "index.ts", path: "src/index.ts", type: "file" },
    { name: "components", path: "src/components", type: "directory" },
    { name: "Button.tsx", path: "src/components/Button.tsx", type: "file" }
  ],
  count: 3
}
```

### Use Cases

- Explore project structure
- Find files in specific directories
- Understand codebase organization

### Design Decisions

**Why No Permission Check?**

- Reading directory structure is safe
- No file contents exposed
- Essential for agent navigation

**Why Recursive Optional?**

- Performance: Shallow listing is faster
- Control: Agent can limit scope
- Flexibility: Choose based on use case

## Glob Tool

### Purpose

Find files matching glob patterns. Searches entire workspace.

### Schema

```typescript
inputSchema: z.object({
  pattern: z.string().describe("Glob pattern (e.g., 'src/**/*.ts')"),
  limit: z.coerce
    .number()
    .min(1)
    .max(1000)
    .optional()
    .describe("Maximum number of results (default: 100)"),
});

outputSchema: z.object({
  files: z.array(z.string()),
  count: z.number(),
  pattern: z.string(),
});
```

### Implementation Details

1. **Glob Package**: Uses `glob` package for pattern matching
2. **Workspace Root**: Searches from workspace root
3. **Limit**: Caps results to prevent large responses

### Pattern Examples

```typescript
// All TypeScript files
"**/*.ts";

// Src directory only
"src/**/*";

// Test files
"**/*.test.ts";

// Specific depth
"*/*.ts"; // One level
"**/*/*.ts"; // Two levels
```

### Use Cases

- Find all files of certain type
- Discover test files
- Search specific directories

### Design Decisions

**Why Limit to 100?**

- Prevents massive responses (think `node_modules/**/*`)
- Keeps token usage reasonable
- Agent can refine pattern if needed

**Why Relative Paths?**

- Consistent with other tools
- Shorter output
- Workspace-centric

## Common Patterns

### Permission Flow

All tools follow the same permission pattern:

```typescript
// 1. Check external directory
await assertExternalDirectory(absolutePath, workspace.root, askFunction);

// 2. Check operation permission
const approved = await permissionMgr.requestApproval({
  id: nanoid(),
  permission: "read", // or "edit"
  patterns: [absolutePath],
  always: ["*"], // Pre-approved patterns
  sessionID: context.sessionID,
});

if (!approved) {
  throw new Error(`Permission denied`);
}
```

### Error Handling

Consistent error format:

```typescript
// File not found
throw new Error(`File not found: ${filePath}`);

// Permission denied
throw new Error(`Permission denied: Cannot ${operation} ${filePath}`);

// Binary file
throw new Error(`Cannot read binary file: ${filePath}`);

// String not found (edit tool)
throw new Error(`String not found in file: "${oldString.slice(0, 50)}..."`);
```

### Path Resolution

Consistent path handling:

```typescript
// Resolve path (relative or absolute)
let absolutePath = filePath;
if (!path.isAbsolute(filePath)) {
  absolutePath = path.join(workspace.root, filePath);
}

// Validate path
if (!workspace.containsPath(absolutePath)) {
  throw new Error(`Path outside workspace: ${absolutePath}`);
}

// Get relative path for output
const relativePath = workspace.getRelativePath(absolutePath);
```

## Testing

### Read Tool Tests

```typescript
describe("readTool", () => {
  it("should read file contents", async () => {
    const result = await readTool.execute({
      filePath: "/tmp/test.txt",
    });
    expect(result.content).toContain("test content");
  });

  it("should truncate large files", async () => {
    const result = await readTool.execute({
      filePath: "/tmp/large.txt",
    });
    expect(result.metadata.truncated).toBe(true);
  });

  it("should reject binary files", async () => {
    await expect(readTool.execute({ filePath: "/tmp/binary.bin" })).rejects.toThrow(
      "Cannot read binary file"
    );
  });
});
```

### Edit Tool Tests

```typescript
describe("editTool", () => {
  it("should replace single occurrence", async () => {
    const result = await editTool.execute({
      filePath: "/tmp/test.txt",
      oldString: "old",
      newString: "new",
      replaceAll: false,
    });
    expect(result.replacements).toBe(1);
  });

  it("should replace all occurrences", async () => {
    const result = await editTool.execute({
      filePath: "/tmp/test.txt",
      oldString: "old",
      newString: "new",
      replaceAll: true,
    });
    expect(result.replacements).toBeGreaterThan(1);
  });
});
```

## Future Enhancements

### Streaming Read

```typescript
// Future: Stream large files
execute: async function* ({ filePath, offset = 0 }) {
  const stream = fs.createReadStream(filePath, { start: offset });
  for await (const chunk of stream) {
    yield { type: "chunk", data: chunk.toString() };
  }
}
```

### Atomic MultiEdit

```typescript
// Future: True atomicity
execute: async ({ filePath, edits }) => {
  let content = await fs.readFile(filePath, "utf-8");

  // Apply all edits in memory
  for (const edit of edits) {
    content = content.replace(edit.oldString, edit.newString);
  }

  // Write only if all succeed
  await fs.writeFile(filePath, content);
};
```

### Watch Integration

```typescript
// Future: File watching
const watcher = chokidar.watch("**/*.ts");
watcher.on("change", path => {
  // Notify agent of file changes
});
```

---

_Updated: 2025-01-25_
