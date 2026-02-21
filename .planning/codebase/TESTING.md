# Testing Patterns

**Analysis Date:** 2026-02-22

## Test Framework

**Runner:**

- Vitest 4.0.18
- Config files: `apps/desktop/vitest.config.ts`, `packages/server/vitest.config.ts`, etc.

**Assertion Library:**

- Vitest built-in (expect)

**Run Commands:**

```bash
pnpm test                    # Run all tests
pnpm -r test               # Run tests recursively in monorepo
vitest run                 # Run tests once (not watch)
vitest --watch             # Watch mode
vitest --coverage          # With coverage
```

## Test File Organization

**Location:**

- Co-located with source or in sibling `tests/` directory
- Desktop: `apps/desktop/tests/` (unit, integration, e2e subdirs)
- Server: `packages/server/tests/` (routes, middleware, bus subdirs)
- Core: `packages/core/tests/` (tools, skill subdirs)
- ZAI: `packages/zai/tests/` (chat subdirs)

**Naming:**

- `*.test.ts` or `*.spec.ts`
- Test files mirror source structure

**Structure:**

```
tests/
├── unit/                  # Unit tests
│   └── core/
│       └── stores/
│           └── message-store.test.ts
├── integration/           # Integration tests
│   └── data-integrity/
├── e2e/                   # End-to-end tests
└── routes/                # API route tests
    ├── sessions.test.ts
    └── chat.test.ts
```

## Test Structure

**Suite Organization:**

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("MessageStore", () => {
  let store: MessageStore;

  beforeEach(() => {
    store = new MessageStore();
  });

  it("should add message", () => {
    store.addMessage({ role: "user", content: "Hello" });
    expect(store.getMessages()).toHaveLength(1);
  });
});
```

**Patterns:**

- `beforeEach` for setup/reset
- `describe` blocks for logical grouping
- Clear test names: "should [expected behavior]"

## Mocking

**Framework:** Vitest mocks (vi)

**Patterns:**

```typescript
// Mock module
vi.mock("@ekacode/shared/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock function
const mockFn = vi.fn(() => Promise.resolve("result"));

// Spy
const spy = vi.spyOn(object, "method");
```

**What to Mock:**

- External services (not used in unit tests)
- Database connections (use test setup)
- Time/date (use vitest fake timers)

**What NOT to Mock:**

- Core business logic being tested
- Simple utilities

## Fixtures and Factories

**Test Data:**

- Inline in test files for simple cases
- Separate fixtures for complex data in `__fixtures__/` or `fixtures/`

```typescript
// Factory pattern example
function createMockSession(overrides = {}) {
  return {
    session_id: "test-id",
    title: "Test Session",
    created_at: new Date(),
    ...overrides,
  };
}
```

**Location:**

- Co-located with test files or in `tests/fixtures/`

## Coverage

**Requirements:** None enforced (target not specified)

**View Coverage:**

```bash
pnpm test:coverage          # In packages with coverage script
vitest run --coverage       # Direct
```

## Test Types

**Unit Tests:**

- Focus on individual functions/classes
- Mock dependencies
- Location: `tests/unit/` or co-located

**Integration Tests:**

- Test multiple components together
- Use test database
- Location: `tests/integration/`

**E2E Tests:**

- Full application flow
- Desktop app in Electron
- Location: `apps/desktop/tests/e2e/`

## Common Patterns

**Async Testing:**

```typescript
it("should resolve promise", async () => {
  const result = await fetchData();
  expect(result).toBe("data");
});
```

**Error Testing:**

```typescript
it("should throw on invalid input", () => {
  expect(() => validateInput({})).toThrow("required field");
});
```

**SSE/Stream Testing:**

```typescript
it("should handle stream", async () => {
  const stream = createStream();
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  expect(chunks).toHaveLength(3);
});
```

---

_Testing analysis: 2026-02-22_
