# Shape Document: Shell and Search Tools

**Date:** 2025-01-25
**Command:** /agent-os:shape-spec
**Shaped by:** Claude Code

---

## Shaping Context

### Original Request

User requested analysis and implementation plan for Phase 2.3 (Shell tool - bash) and Phase 2.4 (Search tools - grep, webfetch), adapting OpenCode's production-tested patterns to ekacode's Mastra-based architecture.

### Shaping Questions & Answers

**Q1: What is the scope of this specification?**

- **Answer:** Shell tool (bash) + search tools (grep, webfetch)
- **Scope Notes:** Skip websearch tool (explicitly excluded by user)

**Q2: Are there any visuals or UI mockups associated with this spec?**

- **Answer:** No visuals, use OpenCode code as reference

**Q3: Are there any existing code references or patterns to follow?**

- **Answer:** Use OpenCode implementations studied earlier:
  - `opencode/packages/opencode/src/tool/bash.ts`
  - `opencode/packages/opencode/src/tool/grep.ts`
  - `opencode/packages/opencode/src/file/ripgrep.ts`
  - `opencode/packages/opencode/src/shell/shell.ts`

**Q4: Which standards should be applied?**

- **Answer:** code-quality, tech-stack

---

## Technical Decisions Made

### Decision 1: Mastra Tool Streaming

**Question:** Does Mastra's createTool support streaming metadata updates?
**Answer:** YES - Use `context.writer.write()` for event streaming
**Implementation:**

```typescript
await context?.writer?.write({
  type: "custom-event",
  status: "executing",
  command: inputData.command,
});
```

### Decision 2: Ripgrep Distribution

**Question:** How to distribute ripgrep binary in NixOS environment?
**Answer:** Bundle using NixOS/flakes approach (like OpenCode)
**Implementation:**

- Lazy-load from GitHub releases
- Cache in XDG data directory
- Add to `lib.makeBinPath([ripgrep])` in flake.nix
- Platform-specific binaries (x64-linux, arm64-linux, x64-darwin, arm64-darwin)

### Decision 3: Web Search Tool

**Question:** Should we implement websearch tool?
**Answer:** NO - Explicitly excluded by user
**Reason:** User wants to focus on shell, grep, and webfetch only

### Decision 4: Tree-sitter Implementation

**Question:** WASM vs Node.js npm packages for tree-sitter?
**Answer:** Node.js npm packages
**Packages:** `tree-sitter` + `tree-sitter-bash`
**Reason:** Faster, better debugging, native bindings

---

## Tech Stack Mapping: OpenCode → ekacode

| OpenCode Pattern          | ekacode Adaptation                    |
| ------------------------- | ------------------------------------- |
| `Tool.define()`           | `createTool()` from Mastra            |
| `ctx.ask()`               | `PermissionManager.requestApproval()` |
| Bun shell                 | Node.js `child_process`               |
| `Instance.containsPath()` | `WorkspaceInstance.containsPath()`    |
| OpenCode permissions      | ekacode permission system             |
| `output: stream`          | `context.writer.write()`              |

---

## Architecture Notes

### Shell Tool Architecture

```
bash.tool.ts (Mastra tool)
    ├── parser.ts (tree-sitter command parsing)
    ├── shell-selector.ts (shell detection)
    └── kill-tree.ts (process cleanup)
         │
         ▼
PermissionManager (external directory, bash permissions)
         │
         ▼
WorkspaceInstance (path validation)
```

### Grep Tool Architecture

```
grep.tool.ts (Mastra tool)
    └── ripgrep.ts (binary manager)
         ├── findSystemRipgrep()
         ├── downloadAndExtractRipgrep()
         └── XDG cache management
```

### WebFetch Architecture

```
webfetch.tool.ts (Mastra tool)
    ├── Turndown (HTML → Markdown)
    ├── jsdom (DOM parsing)
    └── Native fetch (HTTP)
```

---

## Constraints & Requirements

### From code-quality standard

- Zero TypeScript errors
- Zero ESLint warnings
- No `any` types without justification
- Meaningful names
- Small, focused functions
- Explicit over implicit

### From tech-stack standard

- Use Mastra Framework
- Node.js (not Bun)
- TanStack AI for streaming
- Tree-sitter for parsing
- NixOS/flakes for builds

### User Requirements

- Skip websearch tool
- Bundle ripgrep for NixOS
- Mastra streaming support
- Node.js tree-sitter packages

---

## Integration Points

### Permission System

```typescript
import { PermissionManager } from "@ekacode/security";

await permissionMgr.requestApproval({
  id: nanoid(),
  permission: "bash",
  patterns: [command],
  always: [commandPrefix + "*"],
  sessionID,
});
```

### Workspace Management

```typescript
import { Workspace } from "@ekacode/workspace";

const workspace = await Workspace.getInstance();
if (!workspace.containsPath(filePath)) {
  // Request external_directory permission
}
```

### Mastra Tool Registration

```typescript
import { bashTool, grepTool, webfetchTool } from "./tools";

export const coderAgent = new Agent({
  name: "coder",
  model: openai("gpt-4o"),
  tools: {
    bash: bashTool,
    grep: grepTool,
    webfetch: webfetchTool,
  },
});
```

---

## Success Criteria

### Shell Tool

- Execute common commands (git, npm, ls)
- Permission requests for external directories
- Timeout and abort handling
- Process tree cleanup on all platforms
- Output truncation
- Streaming metadata updates

### Grep Tool

- Find matches using ripgrep
- Lazy-load binary from XDG cache
- JSON output parsing
- 100 match limit
- Exit code handling (0=found, 1=none, 2=error)

### WebFetch Tool

- Fetch and convert HTML to markdown
- Handle errors gracefully
- Cloudflare bypass
- 5MB size limit
- Accept header handling

---

**End of Shape Document**
