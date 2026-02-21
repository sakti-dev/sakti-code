# Coding Conventions

**Analysis Date:** 2026-02-22

## Naming Patterns

**Files:**

- Components: `kebab-case.tsx` (e.g., `chat-input.tsx`, `session-card.tsx`)
- Utilities: `kebab-case.ts` (e.g., `event-guards.ts`, `retry.ts`)
- Config: `kebab-case.config.ts` (e.g., `vitest.config.ts`, `drizzle.config.ts`)
- Types: `kebab-case.types.ts` or co-located in same file

**Functions:**

- camelCase (e.g., `createSession`, `getSessionManager`)
- Hooks: prefix with `use` (e.g., `useChatInput`, `useMessages`)
- Factories: prefix with `create` (e.g., `createTools`, `createAgent`)

**Variables:**

- camelCase (e.g., `sessionId`, `workspacePath`)
- Constants: UPPER_SNAKE_CASE for compile-time constants
- Booleans: prefix with `is`, `has`, `should` (e.g., `isActive`, `hasPermission`)

**Types:**

- PascalCase (e.g., `Session`, `Workspace`, `Message`)
- Interfaces: prefix with `I` only when necessary (not used in this codebase)
- Type aliases: descriptive (e.g., `type Session = typeof sessions.$inferSelect`)

## Code Style

**Formatting:**

- Prettier 3.8.1
- Semi: true
- Single quote: false (double quotes)
- Tab width: 2
- Print width: 100
- Trailing comma: es5
- Plugins: prettier-plugin-organize-imports, prettier-plugin-tailwindcss

**Linting:**

- ESLint 9.39.2
- @typescript-eslint/recommended rules
- No unused vars (with exceptions for `_` prefix)

**Import Organization:**

1. solid-js and @solid imports
2. @ekacode/ internal imports
3. Third-party modules
4. Relative imports (./, ../)

```typescript
// Example import order
import { createSignal, onMount } from "solid-js";
import { useChatSession } from "@/core/state/providers/workspace-chat-provider";
import { createLogger } from "@ekacode/shared/logger";
import { someThirdParty } from "some-package";
import { localHelper } from "./local";
```

**Path Aliases:**

- `@/*` - aliases to `apps/desktop/src/`
- `@ekacode/core/chat` -> `packages/core/src/chat`
- `@ekacode/server/bus` -> `packages/server/src/bus`

## Error Handling

**Patterns:**

- Custom error classes with Error suffix (e.g., `PermissionDeniedError`, `PermissionTimeoutError`)
- Middleware-based error handling in Hono
- Zod schema validation on all route inputs
- Error classification in `packages/core/src/session/error-classification.ts`

```typescript
// Example error pattern
export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}
```

## Logging

**Framework:** Pino (via @ekacode/shared/logger)

**Patterns:**

- Structured logging with metadata
- Module object tags for filtering
- Development vs production log levels

```typescript
const logger = createLogger("module:name");
logger.info("message", { key: "value" });
```

## Comments

**When to Comment:**

- Complex business logic
- Non-obvious workarounds
- TODO/FIXME with explanation
- Public API JSDoc

**JSDoc/TSDoc:**

- Used on exported functions and types
- Includes @param and @returns

```typescript
/**
 * Creates a new session for the workspace.
 * @param workspaceId - The workspace UUID
 * @returns Newly created session
 */
export async function createSession(workspaceId: string): Promise<Session> {}
```

## Function Design

**Size:** Keep functions focused and single-purpose

**Parameters:**

- Use objects for functions with >3 parameters
- Zod schemas for validation

**Return Values:**

- Always typed (explicit return types for exported functions)
- Promise for async functions

## Module Design

**Exports:**

- Barrel files (index.ts) for clean public APIs
- Named exports preferred over default

**Barrel Files:**

- Used extensively (e.g., `src/tools/index.ts`, `src/routes/index.ts`)

---

_Convention analysis: 2026-02-22_
