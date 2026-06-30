# Merge `ls` into `read` — Design & Implementation Plan

## Goal

Make `read` auto-detect file vs directory paths (like opencode's `read` tool), returning file contents or a directory listing accordingly. Then remove the standalone `ls` tool.

## OpenCode Reference Files

Cross-reference these during implementation:

| Reference                                                                | Purpose                                                                    |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `openspec/references/opencode/packages/core/src/tool/read.ts`            | Read tool layer — permission, path resolution, inspect→branch→read/list    |
| `openspec/references/opencode/packages/core/src/tool/read-filesystem.ts` | Implementation of `inspect`, `read`, `list` — the three core functions     |
| `openspec/references/opencode/packages/core/src/filesystem.ts`           | `FileSystem.Entry` struct (`{ path, type }`), `ListPage`, `TextPage` types |
| `openspec/references/opencode/packages/schema/src/filesystem.ts`         | `Entry` schema definition                                                  |

## Plan

### Step 1: Create `packages/tools/src/read/read-filesystem.ts`

A new module with three exported functions, modeled after opencode's `read-filesystem.ts` (but without Effect).

**`inspect(absolutePath: string): Promise<"file" | "directory">`**

Straightforward `fs.stat` → check `isFile()`/`isDirectory()`. Throw if neither (symlink, socket, etc.).

**`list(absolutePath: string, page?: { offset?: number; limit?: number }): Promise<ListPage>`**

Where `ListPage = { entries: Entry[], truncated: boolean, next?: number }` and `Entry = { path: string; type: "file" | "directory" }`.

Logic (mirror opencode `read-filesystem.ts:323-351`):

1. `readdir` with default flags so dotfiles are included (matches current `ls` behavior)
2. Parallel stat each entry (16 concurrency, like opencode line 343)
3. Filter out unresolvable entries (symlink loop, permission denied) and any entry whose resolved path escapes `absolutePath`
4. Sort: directories first, then case-insensitive by name (matches current `ls` behavior)
5. Slice by `offset` (1-based) and `limit`
6. Compute `truncated` and `next` if there are more entries after the slice
7. Return `{ entries, truncated, next }`

**`readText(absolutePath: string, page?: { offset?: number; limit?: number }): Promise<TextPage>`**

Where `TextPage = { content: string; offset: number; truncated: boolean; next?: number }`.

This is the **existing** file-reading logic extracted from `read/index.ts` (the text path of `execute()`, starting after image handling and ending before the final `return { content, details }`). No change in behavior — just move it into this module. The offset/limit/truncate logic stays as-is. Do not rely on the exact line numbers from this plan; extract the full text-only branch as it exists in the file at implementation time.

### Step 2: Modify `packages/tools/src/read/index.ts`

**Schema**: Already has `path`, `offset`, `limit` — no changes needed. Note that `path` remains required (no default). To list the current working directory, callers must pass `path: "."`. This matches OpenCode's `read` schema and differs from the old `ls` tool, where `path` defaulted to `.`.

**Description**: Update to mention directory listing. Model after opencode's read.ts:42-43:

> "Read a text file or supported image, page through a large UTF-8 text file by line offset, or list a directory page. Relative paths resolve from the current working directory; absolute paths are read directly."

**`execute()`** — add directory detection at the top, between path resolution and the existing image/text logic (mirror opencode read.ts:54-100):

```
1. resolveToCwd / resolveReadPathAsync (existing)
2. ops.access (existing)
3. NEW: const type = await inspect(absolutePath)
4. If type === "directory":
     → return await list(absolutePath, { offset, limit })
     → format as text: entries joined by newlines, dirs with / suffix
     → add truncation/continuation notices
5. If type === "file":
     → existing image/text logic (unchanged)
```

**Output format for directories**: Format as text (matching current `ls` style), not structured entries. This keeps consistency with how the rest of our tool outputs work (plain text in `content[0].text`). Include continuation notices when truncated. Directory listings do not use hashline mode; the `snapshotStore` option applies only to file reads.

**Permissions for directories**: Keep the existing `permissions()` callback unchanged. A directory read will declare `permission: "read"` on the directory path, matching OpenCode's behavior (`action: name` where `name` is `"read"`). This differs from the old `ls` tool, which declared `permission: "list"`. After `ls` is fully removed, the `list` permission type will become unused.

### Step 3: Deprecate `packages/tools/src/ls/index.ts`

Add a comment at the top:

```ts
// DEPRECATED: Use createReadTool instead — read now handles directories.
```

No functional change to `createLsTool` yet. Don't remove exports from `index.ts` in this step — delete them in a follow-up after verifying nothing breaks.

### Step 4: Update `packages/tools/src/index.ts`

No changes yet (ls still exported, read unchanged from outside). The new `read-filesystem.ts` is internal to `read/`.

### Step 5: Update tool description metadata

Update `createLsTool`'s description to say "prefer read for directory listing" so the model learns the new pattern.

### Step 6: Tests

- `read/__tests__/read-filesystem.test.ts` — tests for `inspect`, `list`, `readText`
- `read/__tests__/read.test.ts` — existing tests updated to cover directory paths, including:
  - listing a directory returns entries with `/` suffix for subdirectories
  - listing with `offset`/`limit` returns continuation notices and `next`-style offsets
  - listing the current directory via `path: "."`
  - dotfiles are included in directory listings
  - directory listings do not use hashline mode even when `snapshotStore` is provided
- `ls/__tests__/ls.test.ts` — no changes (ls still works), but mark as deprecated

### Step 7 (future): Remove `ls`

After verifying nothing depends on `ls` (search for `createLsTool` imports across the monorepo), remove:

- `packages/tools/src/ls/` directory
- `ls` exports from `packages/tools/src/index.ts`
- `"ls"` from `DEFAULT_TOOL_NAMES` in `apps/server/src/agent/runner.ts`
- `"ls"` from every `activeToolNames` array in `apps/server/src/agent/config/server-agents.ts`
- The `list: "allow"` entry from `exploreRuleset()` in `apps/server/src/agent/config/server-agents.ts` (the `list` permission type becomes unused once `ls` is gone)
- Any remaining references in agent loop tool registration

## Key Differences from OpenCode (Why)

| OpenCode approach                                 | Our adaptation                            | Rationale                                                                           |
| ------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| Effect-TS services (`ReadToolFileSystem.Service`) | Plain async functions in a module         | No Effect DI in our codebase                                                        |
| `ListPage`/`TextPage` Schema classes              | Plain TypeScript interfaces + text output | Our `AgentTool` returns `{ content: TextContent[], details }`, not structured types |
| `Image.Service` for image normalization           | Existing photon-based resize inline       | Our image logic is already working — no reason to extract                           |
| `PermissionV2.assert()` everywhere                | Existing `permissions()` callback         | Our permission model is simpler and stays that way                                  |
| `list` action for directory reads                 | Reuse `read` action                       | Aligns with OpenCode's `action: name` and lets `read` cover both files and dirs     |

## Migration Notes

- **Callers must pass `path` explicitly.** `read({ path: "." })` replaces `ls({})` for the current directory.
- **Permission rulesets should use `read` for directory access.** Once `ls` is removed, `list` grants in rulesets have no effect.
- **Tool descriptions should guide the model toward `read`.** The `ls` description (Step 5) and the `read` description (Step 2) both need to advertise the new pattern so the model stops calling `ls`.
