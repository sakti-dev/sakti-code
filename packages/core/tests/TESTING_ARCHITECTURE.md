# Core Testing Architecture

This document describes testing architecture for `packages/core`, including test placement rules, import patterns, and verification commands.

## Test Placement

### Unit/Domain Tests

**Location:** `src/**/__tests__/`

Unit and domain tests are colocated with source code they test. These tests should:

- Test isolated units of functionality or specific domain components
- May use database connections via `@/testing/db` bridge
- Use `@/` alias for all internal imports
- Run efficiently (integration-level tests colocated with domain code)

**Examples:**

- `src/agent/workflow/__tests__/model-provider.test.ts` - Unit test for model provider
- `src/session/__tests__/manager.integration.test.ts` - Domain test with DB
- `src/memory/observation/__tests__/storage.integration.test.ts` - Domain test with DB
- `src/tools/__tests__/task.integration.test.ts` - Domain test for tools

### Integration Tests

**Location:** `tests/integration/`

Integration tests test system-level workflows and cross-component interactions. These tests may:

- Use real database connections
- Call external APIs (opt-in, requires API keys)
- Test end-to-end workflows across multiple domains
- Test integration points between packages

**Current integration suites:**

- `build-memory-tools.integration.test.ts` - Memory tools integration
- `e2e-agent.test.ts` - Agent with tools (requires `ZAI_API_KEY`)
- `instance-context-integration.test.ts` - Instance context integration
- `memory-observation.integration.test.ts` - Memory observation integration
- `memory-observation-phase5-*.test.ts` - Phase 5 end-to-end tests
- `search-docs-integration.test.ts` - Code research (requires `ZAI_API_KEY`)

### Centralized Test Infrastructure

**Location:** `tests/`

The following centralized directories are retained for shared test infrastructure:

- `tests/helpers/` - Shared test helpers and utilities
- `tests/fixtures/` - Test fixtures and mock data
- `tests/integration/` - System-level integration tests
- `tests/e2e/` - End-to-end tests (if any)

**Forbidden:** No domain-specific tests under `tests/{agent,memory,session,spec,tools}/`. All domain tests must be colocated in `src/**/__tests__/`.

## Import Patterns

### Allowed Patterns

**In colocated tests (`src/**/**tests**/`):\*\*

- `@/<domain>/...` for importing from core internals
- `@/testing/db` for database access (core-owned bridge)
- External package imports (e.g., `vitest`, `@types/node`)
- Mock imports for external services

**In integration tests (`tests/integration/`):**

- `@/*` for core internals (path alias configured in vitest)
- External package imports
- Server bridge imports (via `@sakti-code/shared/core-server-bridge`)
- `@/testing/db` for database access

### Forbidden Patterns

**In ALL tests:**

- Direct imports from `@sakti-code/server` or `@sakti-code/server/*` (use `@/testing/db` instead)
- Deep relative imports to `../src/*`, `../../src/*`, etc. in unit tests (use `@/*` instead)
- Adding new test files under `tests/{agent,memory,session,spec,tools}/`

## Verification Commands

Before committing any changes to tests in `packages/core`, run the following verification matrix:

```bash
# Type check (uses tsconfig.spec.json with test imports)
pnpm --filter @sakti-code/core test:typecheck

# Lint (enforces import patterns)
pnpm --filter @sakti-code/core lint

# Layout check (enforces nearest __tests__ colocation)
pnpm --filter @sakti-code/core test:layout

# Unit tests (colocated tests)
pnpm --filter @sakti-code/core test:unit

# Integration tests
pnpm --filter @sakti-code/core test:integration

# All tests
pnpm --filter @sakti-code/core test

# Import regression check (if available)
pnpm --filter @sakti-code/core run test:imports
```

## Adding New Tests

### When to Add a Unit Test

Add tests to `src/<domain>/__tests__/` when:

- The test has no external dependencies (pure unit test)
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

### When to Add a Domain Integration Test

Add tests to `src/<domain>/__tests__/` (named `*.integration.test.ts`) when:

- The test requires database access
- The test tests domain-specific workflows
- The test is faster than system-level integration tests
- The test benefits from being close to the code it tests

**Example:**

```typescript
// src/memory/observation/__tests__/storage.integration.test.ts
import { describe, expect, it } from "vitest";
import { ObservationalMemoryStorage } from "../storage";
import { getDb, closeDb } from "@/testing/db";

describe("ObservationalMemoryStorage", () => {
  let storage: ObservationalMemoryStorage;

  beforeEach(async () => {
    storage = new ObservationalMemoryStorage(await getDb());
  });

  afterEach(async () => {
    closeDb();
  });

  it("should create observational memory", async () => {
    // ... integration test with DB
  });
});
```

### When to Add a System Integration Test

Add tests to `tests/integration/` when:

- The test requires multiple components to interact
- The test is an end-to-end workflow
- The test is significantly slower than domain tests
- The test cross-cuts multiple domains

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

## Troubleshooting

### Test Type Check Errors

If `test:typecheck` fails:

1. Check for incorrect import paths (use `@/*` for core internals)
2. Use `@/testing/db` for database access instead of server imports
3. Check for missing type imports

### Lint Errors

If lint fails with import errors:

1. Unit tests: Use `@/*` instead of relative paths like `../../src/`
2. All tests: Avoid direct `@sakti-code/server` imports
3. Use `@/testing/db` for database access

### Layout Check Errors

If `test:layout` fails:

1. Check for new test files under `tests/{agent,memory,session,spec,tools}/`
2. Move tests to nearest `src/<domain>/__tests__/` directory
3. Ensure filename is `*.test.ts` or `*.integration.test.ts`

### Test Discovery Issues

If tests aren't being discovered:

1. Check file is named `*.test.ts` or `*.spec.ts`
2. Verify file is in `src/**/__tests__/`, `tests/integration/`, or `tests/e2e/`
3. Check vitest.config.ts include patterns

## Migration Notes

This architecture is the result of a migration from a legacy domain-based structure (`tests/<domain>/*.test.ts`) to a nearest-`__tests__` colocation model.

Migration outcomes:

- All unit/domain tests colocated in `src/**/__tests__/`
- Only system-level integration tests remain in `tests/integration/`
- Centralized test infrastructure retained in `tests/helpers/` and `tests/fixtures/`
- Guardrail script (`scripts/check-no-legacy-domain-tests.sh`) prevents reintroduction of legacy domain test directories
