# References: Shell and Search Tools

**Date:** 2025-01-25
**Command:** /agent-os:shape-spec

---

## OpenCode Reference Implementations

### Shell Tool Implementation

**File:** `/home/eekrain/CODE/ekacode/opencode/packages/opencode/src/tool/bash.ts`

**Key Patterns to Adapt:**

- Tree-sitter command parsing for path extraction
- Permission flow using `ctx.ask()`
- Streaming metadata via `output: stream`
- Process tree cleanup with `detached: true`
- Platform-specific shell selection
- Timeout and abort handling

**Code Reference:**

```typescript
// Tree-sitter parsing
const parser = new Parser();
parser.setLanguage(bash);
const tree = parser.parse(command);
// Extract file paths from AST

// Permission request
await ctx.ask({
  type: "external_directory",
  path: filePath,
});

// Streaming metadata
output.write({
  type: "custom-event",
  status: "executing",
  command,
});
```

---

### Grep Tool Implementation

**File:** `/home/eekrain/CODE/ekacode/opencode/packages/opencode/src/tool/grep.ts`

**Key Patterns to Adapt:**

- Lazy ripgrep binary loading
- JSON output parsing
- 100 match limit
- Exit code handling (0=found, 1=none, 2=error)
- Group by file, show line numbers

**Code Reference:**

```typescript
// Lazy binary loading
const rgPath = await getRipgrepPath();
const result = execa(rgPath, ["--json", pattern, path]);

// JSON output parsing
for (const line of result.stdout.split("\n")) {
  const json = JSON.parse(line);
  if (json.type === "match") {
    // Process match
  }
}

// Exit code handling
if (result.exitCode === 1) {
  return "No matches found";
}
```

---

### Ripgrep Manager

**File:** `/home/eekrain/CODE/ekacode/opencode/packages/opencode/src/file/ripgrep.ts`

**Key Patterns to Adapt:**

- Platform configuration mapping
- Download from GitHub releases
- Extract to XDG data directory
- System PATH fallback

**Code Reference:**

```typescript
// Platform mapping
const PLATFORM = {
  "arm64-darwin": { platform: "aarch64-apple-darwin", extension: "tar.gz" },
  "arm64-linux": { platform: "aarch64-unknown-linux-gnu", extension: "tar.gz" },
  "x64-darwin": { platform: "x86_64-apple-darwin", extension: "tar.gz" },
  "x64-linux": { platform: "x86_64-unknown-linux-musl", extension: "tar.gz" },
};

// Download URL
const url = `https://github.com/BurntSushi/ripgrep/releases/download/${VERSION}/ripgrep-${VERSION}-${platform}.${extension}`;
```

---

### Shell Utilities

**File:** `/home/eekrain/CODE/ekacode/opencode/packages/opencode/src/shell/shell.ts`

**Key Patterns to Adapt:**

- Shell detection (bash/zsh/sh)
- Process tree cleanup (Windows/Unix)
- Platform-specific execution

**Code Reference:**

```typescript
// Shell detection
const shell = process.env.SHELL || "/bin/bash";
if (shell.includes("fish") || shell.includes("nu")) {
  // Fallback to bash
}

// Process cleanup (Unix)
process.kill(-pid, "SIGTERM");
await sleep(200);
process.kill(-pid, "SIGKILL");

// Process cleanup (Windows)
execa("taskkill", ["/pid", String(pid), "/f", "/t"]);
```

---

## NixOS/Flakes Integration

### flake.nix

**File:** `/home/eekrain/CODE/ekacode/opencode/flake.nix`

**Key Patterns to Adapt:**

- CPU platform mapping
- Multi-platform build configuration
- Module updaters

**Code Reference:**

```nix
cpuMap = {
  "x86_64-linux" = "x64-linux";
  "aarch64-linux" = "arm64-linux";
  "x86_64-darwin" = "x64-darwin";
  "aarch64-darwin" = "arm64-darwin";
};
```

---

### Package Derivation

**File:** `/home/eekrain/CODE/ekacode/opencode/nix/opencode.nix`

**Key Patterns to Adapt:**

- Add ripgrep to `lib.makeBinPath`
- Wrap program with PATH

**Code Reference:**

```nix
wrapProgram $out/bin/opencode \
  --prefix PATH : ${lib.makeBinPath([ripgrep])}
```

---

## ekacode Reference Patterns

### Tool Pattern

**File:** `/home/eekrain/CODE/ekacode/packages/ekacode/src/tools/filesystem/read.ts`

**Key Patterns:**

- Mastra `createTool()` usage
- `PermissionManager.requestApproval()` integration
- `Workspace.getInstance()` usage
- `truncateOutput()` utility

**Code Reference:**

```typescript
import { createTool } from "@mastra/core/tools";
import { PermissionManager } from "@ekacode/security";
import { Workspace } from "@ekacode/workspace";

export const readTool = createTool({
  id: "read",
  inputSchema: z.object({
    path: z.string(),
  }),
  execute: async ({ context }) => {
    const workspace = await Workspace.getInstance();
    const permissionMgr = new PermissionManager();

    // Request permission
    const approved = await permissionMgr.requestApproval({
      id: nanoid(),
      permission: "fs_read",
      patterns: [path],
      sessionID: context?.sessionID,
    });

    if (!approved) {
      return { error: "Permission denied" };
    }

    // Read file
    const content = await fs.readFile(path, "utf-8");

    // Truncate output
    const { content: truncated, truncated: wasTruncated } = await truncateOutput(content);

    return { content: truncated, truncated: wasTruncated };
  },
});
```

---

### Permission Manager

**File:** `/home/eekrain/CODE/ekacode/packages/ekacode/src/security/permission-manager.ts`

**Key API:**

```typescript
interface PermissionRequest {
  id: string;
  permission: string;
  patterns: string[];
  always?: string[];
  sessionID?: string;
}

class PermissionManager {
  async requestApproval(request: PermissionRequest): Promise<boolean>;
}
```

---

### Workspace Instance

**File:** `/home/eekrain/CODE/ekacode/packages/ekacode/src/workspace/instance.ts`

**Key API:**

```typescript
class WorkspaceInstance {
  containsPath(filepath: string): boolean;
  readonly root: string;
  readonly worktree: string;
}
```

---

## External Dependencies Documentation

### Tree-sitter

**Docs:** https://tree-sitter.github.io/tree-sitter/
**npm:** `tree-sitter`, `tree-sitter-bash`
**Usage:** AST-based command parsing for shell tool

### Turndown

**Docs:** https://github.com/mixmark-io/turndown
**npm:** `turndown`
**Usage:** HTML to Markdown conversion for webfetch tool

### jsdom

**Docs:** https://github.com/jsdom/jsdom
**npm:** `jsdom`
**Usage:** DOM parsing for HTML content (optional, can use native APIs)

### Ripgrep

**Docs:** https://github.com/BurntSushi/ripgrep
**Binary:** Downloaded from GitHub releases
**Version:** 14.1.1

---

## Implementation Tasks Reference

### Task Order

1. Shell utilities (kill-tree.ts, shell-selector.ts, parser.ts)
2. Shell tool (bash.tool.ts)
3. Ripgrep manager (ripgrep.ts)
4. Grep tool (grep.tool.ts)
5. WebFetch tool (webfetch.tool.ts)
6. Update exports (index.ts)
7. Integration test (run common commands)

### File Structure

```
packages/ekacode/src/tools/
├── shell/
│   ├── bash.tool.ts
│   ├── parser.ts
│   ├── kill-tree.ts
│   └── shell-selector.ts
├── search/
│   ├── grep.tool.ts
│   ├── ripgrep.ts
│   └── webfetch.tool.ts
└── index.ts
```

---

**End of References Document**
