# Desktop Testing Strategy

## Overview

This document defines the testing strategy, standards, and conventions for the Sakti Code desktop application.

## Layout Policy

- **Unit/Component Tests**: Place test files in `src/**/__tests__/` directories adjacent to the code they test
- **Integration Tests**: Keep in `tests/integration/` directory for end-to-end scenarios
- **E2E Tests**: Keep in `tests/e2e/` directory for full-stack validation
- **Helper Modules**: Place in `tests/helpers/` and `tests/fixtures/` directories

## Import Policy

**Primary Rules:**

- Use `@/` alias for all imports from the desktop app
- Avoid deep relative imports (`../src`, `../../src`, etc.)
- Test files MUST import from `@/core/*`, `@/components/*`, or `@/views/*`
- Never import `@renderer/*` - these are deprecated paths

**Forbidden Imports:**

- `from "@renderer/lib/api-client"` → use `"@/core/services/api/api-client"`
- `from "@renderer/core/stores/*"` → use `"@/core/state/stores/*"`
- `from "../src/*"` → use `"@/core/*"`
- `from "../../src/*"` → use `"@/core/*"`

## Solid Testing-Library Conventions

**Component Testing:**

- Use `import { render, cleanup } from "@solidjs/testing-library"`
- Use `afterEach(cleanup)` at the top of test files
- Never use `import { render } from "solid-js/web"` in component tests
- Use destructured return: `const { container } = render(() => <Component />)`
- Don't use the old container pattern: `render(() => <Component />, container)`

**Store Testing:**

- Access stores via hooks: `useMessageStore()`, `usePartStore()`, `useSessionStore()`
- Don't import store actions directly from implementation files
- Use `extractStoreActions()` helper for test setup

**Async Testing Rules:**

- Use `await flushReactive()` after state changes
- Use `await flushMicrotasks()` after async operations
- Use `await waitFor()` with timeouts for async operations that need polling
- Avoid arbitrary `await` - only wait for specific conditions

## Mock and Timer Rules

**Timers:**

- Always use fake timers in tests: `vi.useFakeTimers()`
- Use `vi.runAllTimers()` after all async operations
- Always real timers in `afterEach`: `vi.useRealTimers()`

**Vitest Mocks:**

- Use `vi.fn()` for function mocks
- Use `vi.mock()` for module mocks
- Use `vi.spyOn()` for partial mocks
- Always clear mocks in `beforeEach`: `vi.clearAllMocks()`
- Restore mocks in `afterEach`: `vi.restoreAllMocks()`

**Event Mocking:**

- Use event factories from `@/tests/helpers/event-factories` for typed events
- Don't use `@sakti-code/server` for local tests
- Mock server responses with `vi.fn()` instead

## Required Commands

**During Development:**

```bash
# Run unit tests
pnpm --filter @sakti-code/desktop run test:unit

# Run UI tests
pnpm --filter @sakti-code/desktop run test:ui

# Run integration tests
pnpm --filter @sakti-code/desktop run test:integration

# Typecheck test files
pnpm --filter @sakti-code/desktop run typecheck:test

# Run all tests
pnpm --filter @sakti-code/desktop run test:all

# Health check
pnpm --filter @sakti-code/desktop run test:health

# Lint tests
pnpm --filter @sakti-code/desktop run lint
```

**For Pull Request / Merge:**

- All TypeScript checks must pass: `typecheck:test` and `typecheck`
- All tests must pass: `test:unit`, `test:ui`, `test:integration`
- All lint checks must pass with no errors
- Run final verification: `pnpm --filter @sakti-code/desktop run test:all`
