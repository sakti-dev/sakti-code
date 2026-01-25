# Implementation Plan: Phase 2.3 (Shell) + Phase 2.4 (Grep, WebFetch)

**Date:** 2025-01-25
**Status:** Ready for Implementation
**Based on:** OpenCode tool implementation analysis + NixOS/flakes environment

---

## Executive Summary

Implement bash shell tool and search tools (grep, webfetch) for ekacode, adapting OpenCode's production-tested patterns to ekacode's Mastra-based architecture on NixOS.

---

## Technical Decisions (Resolved)

| #   | Question              | Answer         | Implementation                                    |
| --- | --------------------- | -------------- | ------------------------------------------------- |
| 1   | Mastra Streaming?     | ✅ Yes         | Use `context.writer.write()` for metadata updates |
| 2   | Ripgrep Distribution? | ✅ Bundle      | Lazy-load from GitHub, store in XDG data dir      |
| 3   | Web Search?           | ❌ Skip        | Not implementing websearch tool                   |
| 4   | Tree-sitter?          | ✅ Node.js npm | Use `tree-sitter` + `tree-sitter-bash` packages   |

---

## Dependencies

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

**For NixOS:** Add `ripgrep` to `lib.makeBinPath` in flake.nix

---

## Phase 2.3: Shell Tool (bash)

### Files to Create

```
packages/ekacode/src/tools/shell/
├── bash.tool.ts      # Main shell tool (Mastra)
├── parser.ts         # Command parsing, path extraction
├── kill-tree.ts      # Process tree cleanup (Win/Unix)
└── shell-selector.ts # Shell detection (bash/zsh/sh)
```

### Key Implementation Details

**1. Tool Schema:**

```typescript
inputSchema: z.object({
  command: z.string().describe("The command to execute"),
  timeout: z.number().optional().describe("Timeout in ms (default: 120000)"),
  workdir: z.string().optional().describe("Working directory (default: workspace)"),
  description: z.string().describe("Clear description (5-10 words)"),
});
```

**2. Streaming Metadata (Mastra):**

```typescript
// Stream progress during execution
await context?.writer?.write({
  type: "custom-event",
  status: "executing",
  command: inputData.command,
});

// After completion
await context?.writer?.write({
  type: "custom-event",
  status: "completed",
  exitCode: proc.exitCode,
});
```

**3. Security Flow:**

- Parse command with tree-sitter → extract file paths
- Request `external_directory` permission for paths outside workspace
- Request `bash` permission with command patterns
- Use `detached: true` for process group cleanup

**4. Platform-Specific Shell Selection:**

- Prefer `$SHELL` env var (not fish/nu)
- Fallback: `/bin/zsh` (macOS), `which bash` (Linux), Git Bash or `cmd.exe` (Windows)

**5. Process Cleanup:**

- Windows: `taskkill /pid /f /t`
- Unix: `kill(-pid, SIGTERM)` → wait 200ms → `kill(-pid, SIGKILL)`

---

## Phase 2.4: Search Tools

### 2.4.1 Grep Tool (ripgrep)

**Files to Create:**

```
packages/ekacode/src/tools/search/
├── grep.tool.ts      # Ripgrep wrapper (Mastra)
└── ripgrep.ts        # Binary management
```

**Key Implementation Details:**

**1. Lazy Binary Loading:**

```typescript
// Check system PATH first
let rgPath = await findSystemRipgrep();
if (!rgPath) {
  // Fallback to bundled binary in XDG data dir
  const binPath = path.join(xdgData, "ekacode", "bin", "rg");
  if (!exists(binPath)) {
    await downloadAndExtractRipgrep(binPath);
  }
  rgPath = binPath;
}
```

**2. Platform Configuration:**

```typescript
const PLATFORM = {
  "x64-linux": { platform: "x86_64-unknown-linux-musl", ext: "tar.gz" },
  "arm64-linux": { platform: "aarch64-unknown-linux-gnu", ext: "tar.gz" },
  "x64-darwin": { platform: "x86_64-apple-darwin", ext: "tar.gz" },
  "arm64-darwin": { platform: "aarch64-apple-darwin", ext: "tar.gz" },
};
```

**3. Download URL:**

```
https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-{platform}.{ext}
```

**4. Exit Code Handling:**

- `0` = matches found
- `1` = no matches (return "No files found")
- `2` = errors (but may have matches)

**5. Output Format:**

- JSON parsing: `{"type":"match","data":{"path":"...","line_number":1,"lines":{"text":"..."}}}`
- Limit: 100 matches max
- Group by file, show line numbers

**For NixOS Integration:**

- Add to `lib.makeBinPath([ripgrep])` in flake.nix
- Or use bundled binary in XDG data directory

---

### 2.4.2 WebFetch Tool

**Files to Create:**

```
packages/ekacode/src/tools/search/
└── webfetch.tool.ts  # HTTP fetch + markdown conversion
```

**Key Implementation Details:**

**1. Tool Schema:**

```typescript
inputSchema: z.object({
  url: z.string().describe("URL to fetch"),
  format: z.enum(["text", "markdown", "html"]).default("markdown"),
  timeout: z.number().optional().describe("Timeout in seconds (max: 120)"),
});
```

**2. HTML → Markdown (Turndown):**

```typescript
const turndownService = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

turndownService.remove(["script", "style", "meta", "link"]);
return turndownService.turndown(html);
```

**3. Size Limit:** 5MB max response

**4. Cloudflare Bypass:**

- Detect `cf-mitigated: "challenge"` header
- Retry with `User-Agent: "ekacode"`

**5. Accept Headers:**

- markdown: `text/markdown;q=1.0, text/plain;q=0.8`
- text: `text/plain;q=1.0`
- html: `text/html;q=1.0`

---

## File Structure Overview

```
packages/ekacode/src/
├── tools/
│   ├── shell/
│   │   ├── bash.tool.ts          # Mastra shell tool
│   │   ├── parser.ts             # tree-sitter command parser
│   │   ├── kill-tree.ts          # Process cleanup
│   │   └── shell-selector.ts     # Shell detection
│   ├── search/
│   │   ├── grep.tool.ts          # Ripgrep wrapper
│   │   ├── ripgrep.ts            # Binary manager
│   │   └── webfetch.tool.ts      # HTTP + markdown
│   └── index.ts                 # Export all tools
```

---

## Integration Points

### 1. Update tools/index.ts

```typescript
export { bashTool } from "./shell/bash.tool";
export { grepTool } from "./search/grep.tool";
export { webfetchTool } from "./search/webfetch.tool";
```

### 2. Update Mastra instance

```typescript
import { bashTool, grepTool, webfetchTool } from "./tools";

export const coderAgent = new Agent({
  name: "coder",
  instructions: "You are an expert coding agent...",
  model: openai("gpt-4o"),
  tools: {
    bash: bashTool,
    grep: grepTool,
    webfetch: webfetchTool,
    // ... existing tools
  },
});
```

---

## OpenCode Best Practices to Adapt

### 1. Permission Flow Pattern

```typescript
// OpenCode: ctx.ask()
// ekacode: PermissionManager.requestApproval()
await permissionMgr.requestApproval({
  id: nanoid(),
  permission: "bash",
  patterns: [command],
  always: [commandPrefix + "*"],
  sessionID,
});
```

### 2. Truncation Pattern

```typescript
// Reuse existing truncateOutput()
const { content, truncated } = await truncateOutput(output);
if (truncated) {
  content += `\n\n... (${remainingLines} more lines truncated)`;
}
```

### 3. External Directory Detection

```typescript
// Check WorkspaceInstance.containsPath()
if (!workspace.containsPath(filePath)) {
  // Request external_directory permission
}
```

---

## Verification & Testing

### Shell Tool Tests

- [ ] Execute `ls` command successfully
- [ ] Execute `git status` with proper output
- [ ] Test timeout handling (command that sleeps > timeout)
- [ ] Test abort/cancellation cleanup
- [ ] Test external directory permission request
- [ ] Test command parsing and path extraction

### Grep Tool Tests

- [ ] Search finds matches in workspace
- [ ] Search with `include` pattern filters correctly
- [ ] No matches returns "No files found"
- [ ] External directory permission works
- [ ] JSON output parses correctly
- [ ] 100 match limit enforced

### WebFetch Tool Tests

- [ ] Fetch HTML and convert to markdown
- [ ] Fetch plain text
- [ ] Handle 404 errors gracefully
- [ ] Cloudflare bypass works
- [ ] 5MB size limit enforced

---

## Success Criteria

### Phase 2.3 (Shell)

- [ ] Common commands execute (git, npm, ls)
- [ ] Permission requests trigger for external directories
- [ ] Timeout and abort work correctly
- [ ] Process tree cleanup verified on all platforms
- [ ] Output truncation works
- [ ] Streaming metadata updates visible

### Phase 2.4 (Search)

- [ ] Grep finds matches using ripgrep
- [ ] Ripgrep binary lazy-loads from XDG cache
- [ ] Web fetch converts HTML to markdown
- [ ] All tools handle errors gracefully
- [ ] Permission integration works

---

## Critical Files Reference

**From OpenCode:**

- `/home/eekrain/CODE/ekacode/opencode/packages/opencode/src/tool/bash.ts` - Shell implementation
- `/home/eekrain/CODE/ekacode/opencode/packages/opencode/src/tool/grep.ts` - Grep implementation
- `/home/eekrain/CODE/ekacode/opencode/packages/opencode/src/file/ripgrep.ts` - Ripgrep manager
- `/home/eekrain/CODE/ekacode/opencode/packages/opencode/src/shell/shell.ts` - Shell utilities

**From ekacode:**

- `/home/eekrain/CODE/ekacode/packages/ekacode/src/tools/filesystem/read.ts` - Tool pattern reference
- `/home/eekrain/CODE/ekacode/packages/ekacode/src/security/permission-manager.ts` - Permission system
- `/home/eekrain/CODE/ekacode/packages/ekacode/src/workspace/instance.ts` - Workspace management

---

## Implementation Order

1. **Shell utilities** (kill-tree.ts, shell-selector.ts, parser.ts)
2. **Shell tool** (bash.tool.ts)
3. **Ripgrep manager** (ripgrep.ts)
4. **Grep tool** (grep.tool.ts)
5. **WebFetch tool** (webfetch.tool.ts)
6. **Update exports** (index.ts)
7. **Integration test** (run common commands)

---

**End of Plan**
