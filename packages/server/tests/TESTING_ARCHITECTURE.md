# Testing Architecture

This document describes the testing conventions for `@sakti-code/server`.

## Test Location Conventions

### Domain Tests (Nearest Source)

Domain tests live near their source code in `__tests__` directories:

- **`src/**/**tests**/**/\*.test.ts`** - Tests for source modules
- **`db/**tests**/**/\*.test.ts`\*\* - Tests for database modules

### System Tests (Centralized)

Only these test directories remain centralized:

- **`tests/integration/**/\*.test.ts`\*\* - Integration contract tests
- **`tests/e2e/**/\*.test.ts`\*\* - End-to-end tests
- **`tests/helpers/**`\*\* - Shared test utilities
- **`tests/vitest.setup.ts`** - Global test setup

## Running Tests

```bash
# Run all tests
pnpm --filter @sakti-code/server run test

# Run typecheck for tests
pnpm --filter @sakti-code/server run test:typecheck

# Verify test layout (no legacy domain tests)
pnpm --filter @sakti-code/server run test:layout

# Run lint
pnpm --filter @sakti-code/server run lint
```

## Verification Commands

| Command                   | Purpose                                  |
| ------------------------- | ---------------------------------------- |
| `pnpm run test:typecheck` | TypeScript type checking for test files  |
| `pnpm run test:layout`    | Guardrail: ensure no legacy domain tests |
| `pnpm run lint`           | ESLint validation                        |
| `pnpm run test`           | Run all tests                            |

## Migration Notes

This architecture was implemented as part of the "nearest `__tests__` colocation" migration. All domain tests have been moved from `tests/{bus,contracts,db,middleware,plugin,provider,routes,spec,state}` to their nearest source locations.
