# Core Testing Architecture

This document describes the testing architecture for `packages/core`, including test placement rules, import patterns, and verification commands.

## Test Placement

### Unit Tests

**Location:** `src/**/__tests__/`

Unit tests are colocated with the source code they test. These tests should:

- Test isolated units of functionality
- Have no external dependencies (DB, APIs, file system, etc.)
- Use mocks for external services
- Run quickly (< 5 seconds per test file)

**Examples:**

- `src/agent/__tests__/create.test.ts`
- `src/tools/search/__tests__/search-docs.test.ts`
- `src/lsp/__tests__/client.test.ts`

### Integration Tests

**Location:** `tests/integration/`

Integration tests test how multiple components work together. These tests may:

- Use real database connections
- Call external APIs (opt-in, requires API keys)
- Test end-to-end workflows
- Take longer to run

**Current integration suites:**

- `e2e-agent.test.ts` - Agent with tools (requires `ZAI_API_KEY`)
- `search-docs-integration.test.ts` - Code research (requires `ZAI_API_KEY`)

### DB-Dependent Tests

**Location:** `tests/<domain>/`

Tests that require database connections but are not full integration tests live in the legacy `tests/` directory. This is intentional to avoid `test:typecheck` cross-package import issues with `@sakti-code/server`.

**Examples:**

- `tests/spec/compiler.test.ts` - Spec compiler with DB
- `tests/memory/` - All memory domain tests (DB-dependent)
- `tests/agent/workflow/model-provider.test.ts` - Type errors with DB imports

## Import Patterns

### Allowed Patterns

**In unit tests (`src/**/**tests**/`):\*\*

- `@/<domain>/...` for importing from core internals
- External package imports (e.g., `vitest`, `@types/node`)
- Mock imports for external services

**In integration tests (`tests/integration/`):**

- `@/*` for core internals (path alias configured in vitest)
- External package imports
- Server bridge imports (via `@sakti-code/shared/core-server-bridge`)

**In DB-dependent tests (`tests/<domain>/`):**

- `@/*` for core internals (when not importing from server)
- `../../server/db/index.ts` or similar for DB access (intentionally excluded from unit test colocated structure)

### Forbidden Patterns

**In ALL tests:**

- Direct imports from `@sakti-code/server` or `@sakti-code/server/*` (use core server-bridge contracts instead)
- Deep relative imports to `../src/*`, `../../src/*`, etc. in unit tests (use `@/*` instead)
- Reintroducing stale test directories under `packages/core/tests/`

**Specifically in unit tests (`src/**/**tests**/`):\*\*

- `../../server/*` relative imports to server package (blocked by ESLint rule)

## Verification Commands

Before committing any changes to tests in `packages/core`, run the following verification matrix:

```bash
# Type check (uses tsconfig.spec.json with test imports)
pnpm --filter @sakti-code/core test:typecheck

# Lint (enforces import patterns)
pnpm --filter @sakti-code/core lint

# Unit tests (colocated tests + DB-dependent tests)
pnpm --filter @sakti-code/core test:unit

# Integration tests (requires opt-in via RUN_ONLINE_TESTS=1)
pnpm --filter @sakti-code/core test:integration

# All tests
pnpm --filter @sakti-code/core test

# Import regression check (if available)
pnpm --filter @sakti-code/core run test:imports
```

## Adding New Tests

### When to Add a Unit Test

Add tests to `src/<domain>/__tests__/` when:

- The test has no external dependencies
- The test runs quickly
- The test only tests a single function/class/module

**Example:**

```typescript
// src/agent/__tests__/create.test.ts
import { describe, expect, it } from "vitest";
import { createAgent } from "../create";

describe("createAgent", () => {
  it("should create an agent with default config", () => {
    const agent = createAgent({ name: "test" });
    expect(agent.name).toBe("test");
  });
});
```

### When to Add an Integration Test

Add tests to `tests/integration/` when:

- The test requires multiple components to interact
- The test needs real database or external API connections
- The test is an end-to-end workflow

**Example:**

```typescript
// tests/integration/e2e-agent.test.ts
import { describe, expect, it } from "vitest";
import { createAgent } from "@/agent/create";

describe("E2E: Agent with tools", () => {
  it("should complete a task using tools", async () => {
    const agent = createAgent({ name: "test" });
    // ... full integration test
  });
});
```

### When to Keep Tests in Legacy Location

Keep tests in `tests/<domain>/` when:

- The test imports from `@sakti-code/server` DB layer
- The test has type errors that prevent colocation
- The test depends on server bridge contracts

**Note:** These tests should eventually be refactored to avoid direct DB imports, but this is a larger effort.

## Troubleshooting

### Test Type Check Errors

If `test:typecheck` fails:

1. Check for incorrect import paths (use `@/*` for core internals)
2. Verify DB-dependent tests are not in `src/**/__tests__/`
3. Check for missing type imports from server bridge contracts

### Lint Errors

If lint fails with import errors:

1. Unit tests: Use `@/*` instead of relative paths like `../../src/`
2. All tests: Avoid direct `@sakti-code/server` imports
3. DB-dependent tests: They are exempt from the `no-restricted-imports` rule

### Test Discovery Issues

If tests aren't being discovered:

1. Check the file is named `*.test.ts` or `*.spec.ts`
2. Verify the file is in `src/**/__tests__/`, `tests/integration/`, or `tests/<domain>/`
3. Check vitest.config.ts include patterns

## Migration Notes

This architecture is the result of a migration from a legacy domain-based structure to a hybrid model with colocation. See `tests/.migration/baseline.md` and `tests/.migration/final-verification.md` for migration details.

Key migration outcomes:

- 126 test files colocated in `src/**/__tests__/`
- 62 test files remain in `tests/` (DB-dependent or type errors)
- All verification gates passing (typecheck, lint, unit, integration)
