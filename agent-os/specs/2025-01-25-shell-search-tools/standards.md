# Standards Applied: Shell and Search Tools

**Date:** 2025-01-25
**Source:** `agent-os/standards/global/`

---

## Code Quality Standards

### TypeScript and ESLint Error Resolution

**ALL TypeScript and ESLint errors MUST be fixed before committing code.**

#### Required Workflow Before Commit

```bash
# 1. Run typecheck
pnpm run typecheck

# 2. Run ESLint
pnpm run lint

# 3. If either fails, FIX THE ERRORS
# Do not commit until both pass
```

#### Common Error Patterns to Avoid

**`any` Type Violations:**

```typescript
// ❌ BAD
const data = response as any;

// ✅ GOOD
const data = response as ExpectedType;
```

**Unused Variables:**

```typescript
// ❌ BAD
const { getAll, getToolNames, ...tools } = this;

// ✅ GOOD
const { getAll: _getAll, getToolNames: _getToolNames, ...tools } = this;
```

**Missing Return Types:**

```typescript
// ❌ BAD
function getData() {
  return { name: "test" };
}

// ✅ GOOD
function getData(): { name: string } {
  return { name: "test" };
}
```

---

### Clean Code Principles

#### 1. Meaningful Names

- Use pronounceable names: `generationDate` not `genDt`
- Use searchable names: `MAX_RETRIES` not `7`
- Avoid encodings: `User` not `IUser`, `UserInterface`
- Boolean names should be predicates: `isActive` not `active`

#### 2. Small, Focused Functions

- One level of abstraction per function
- Maximum 3-4 parameters (use objects for more)
- Should fit on a single screen (~20 lines)
- Name should describe WHAT it does, not HOW

#### 3. Avoid Duplication (DRY)

Extract common logic into reusable functions with type parameters.

#### 4. Explicit is Better Than Implicit

```typescript
// ❌ BAD - magic values
if (status === 2) {
  retry();
}

// ✅ GOOD - named constants
const STATUS_RETRYABLE = 2;
if (status === STATUS_RETRYABLE) {
  retry();
}
```

#### 5. Early Returns and Guard Clauses

```typescript
// ✅ GOOD - flat structure with early returns
function process(data: Data): boolean {
  if (!data?.items) return false;
  if (data.items.length === 0) return false;
  // do work
  return true;
}
```

#### 6. Error Handling

```typescript
// ✅ GOOD - specific error handling
try {
  await riskyOperation();
} catch (error) {
  if (error instanceof NetworkError) {
    logger.warn("Network failed, retrying", { url });
    return retry();
  }
  throw error;
}
```

---

### Code Organization

#### File Structure

```
src/
  features/
    auth/
      login.ts
      signup.ts
  shared/
    utils/
      date.ts
      validation.ts
```

- One logical concept per file
- Group related files in folders
- Keep folder depth ≤ 3 levels
- Use `index.ts` for public exports

#### Import Order

```typescript
// 1. Node built-ins
import path from "node:path";

// 2. External packages
import { z } from "zod";
import { createTool } from "@mastra/core/tools";

// 3. Internal packages (monorepo)
import { createLogger } from "@ekacode/logger";

// 4. Parent/relative imports
import { WorkspaceInstance } from "../../workspace";
```

---

### Testing Guidelines

Tests should describe behavior, not implementation:

```typescript
// ✅ GOOD - testing behavior
test("cart calculates total with tax", () => {
  const cart = new Cart();
  cart.addItem({ price: 100 });
  expect(cart.total()).toBe(108); // includes 8% tax
});
```

---

### Summary Checklist

- [ ] Functions do ONE thing and are named accordingly
- [ ] No magic numbers or strings - use named constants
- [ ] Early returns instead of deep nesting
- [ ] Error handling is specific and intentional
- [ ] Imports follow ordering convention
- [ ] No commented-out code (delete it, git has history)
- [ ] No `console.log` in production (use proper logging)
- [ ] Tests describe behavior, not implementation
- [ ] Zero TypeScript errors before commit
- [ ] Zero ESLint errors before commit

---

## Tech Stack Standards

### Relevant Technologies for Shell/Search Tools

#### Mastra Framework

- **Version:** Latest (vNext workflow engine)
- **Usage:** Agent orchestration, structured tools with Zod, streaming via `.stream()`
- **Implementation:** Use `createTool()` for tool definition
- **Streaming:** Use `context.writer.write()` for metadata updates

#### Tree-sitter

- **Version:** ^0.20.x
- **Packages:** `tree-sitter`, `tree-sitter-bash`
- **Usage:** Command parsing for shell tool (AST-based path extraction)
- **Implementation:** Node.js npm packages (NOT WASM)

#### Node.js

- **Runtime:** Node.js (not Bun)
- **Child Process:** Use `child_process` module for shell execution
- **Platform Detection:** `process.platform`, `process.arch`

#### Zod Validation

- **Version:** ^3.x
- **Usage:** Runtime schema validation for tool inputs
- **Implementation:** `inputSchema: z.object({ ... })` in tool definition

#### TypeScript

- **Version:** ^5.x
- **Configuration:** Strict mode enabled
- **Compiler API:** For TypeScript/JavaScript code understanding (optional for search)

---

### Integration Requirements

#### Permission System

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

#### Workspace Management

```typescript
import { Workspace } from "@ekacode/workspace";

const workspace = await Workspace.getInstance();
if (!workspace.containsPath(filePath)) {
  // Request external_directory permission
}
```

#### Tool Registration

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

## Specific Requirements for Shell/Search Tools

### Shell Tool (bash)

- Use tree-sitter for command parsing and path extraction
- Cross-platform shell selection (bash/zsh/sh)
- Process tree cleanup on abort
- Streaming metadata via `context.writer.write()`
- Permission requests for external directories

### Grep Tool

- Lazy-load ripgrep binary from XDG cache
- Platform-specific binary selection
- JSON output parsing (limit 100 matches)
- Exit code handling (0=found, 1=none, 2=error)
- Fallback to system ripgrep in PATH

### WebFetch Tool

- Turndown for HTML → Markdown conversion
- 5MB size limit
- Cloudflare bypass handling
- Accept header negotiation
- Error handling for 404, timeouts

---

**End of Standards Document**
