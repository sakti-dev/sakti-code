# Code Quality Standards

## TypeScript and ESLint Error Resolution

### Rule

**ALL TypeScript and ESLint errors MUST be fixed before committing code.**

No exceptions. Zero tolerance policy.

### Rationale

1. **Type Safety** - TypeScript errors indicate potential runtime bugs or missing type information
2. **Code Consistency** - ESLint errors indicate code style violations, anti-patterns, or potential bugs
3. **Compound Interest** - Unfixed errors accumulate and become harder to resolve over time
4. **CI/CD Efficiency** - Pre-commit fixes prevent failed builds and wasted CI time
5. **Team Velocity** - Clean codebases enable faster refactoring and onboarding

### Required Workflow

#### Before Any Commit

```bash
# 1. Run typecheck
pnpm run typecheck

# 2. Run ESLint
pnpm run lint

# 3. If either fails, FIX THE ERRORS
# Do not commit until both pass
```

#### Error Resolution Priority

1. **TypeScript errors** - These are blocking. Must resolve.
2. **ESLint errors** - These are blocking. Must resolve.
3. **ESLint warnings** - Review and either fix or add justified exception

### Common Error Patterns and Fixes

#### `any` Type Violations

**Problem**: Using `any` bypasses type checking

```typescript
// ❌ BAD
const data = response as any;
function foo(error: any) {}

// ✅ GOOD
const data = response as ExpectedType;
function foo(error: unknown) {
  if (error instanceof Error) {
    console.log(error.message);
  }
}
```

#### Unused Variables

**Problem**: Dead code indicates incomplete implementation or cleanup needed

```typescript
// ❌ BAD - unused variable
const { getAll, getToolNames, ...tools } = this;
return tools;

// ✅ GOOD - prefix with _ to indicate intentional exclusion
const { getAll: _getAll, getToolNames: _getToolNames, ...tools } = this;
return tools;
```

Configure ESLint to ignore `_` prefixed variables:

```javascript
"@typescript-eslint/no-unused-vars": [
  "error",
  {
    argsIgnorePattern: "^_",
    varsIgnorePattern: "^_",
    caughtErrorsIgnorePattern: "^_",
  },
]
```

#### `require()` Style Imports

**Problem**: Non-ES imports violate module consistency

```typescript
// ❌ BAD
return require("fs").realpathSync.native(p);

// ✅ GOOD
const fs = await import("node:fs");
return fs.realpathSync.native(p);
```

#### Missing Return Types

**Problem**: Implicit any on function returns reduces type safety

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

### Exception Process

Only acceptable reasons to disable errors:

1. **Third-party library type bugs** - File issue upstream, add `// @ts-expect-error` with explanation
2. **Intentional rule bypass** - Add `// eslint-disable-next-line rule-name` with WHY comment

```typescript
// Example: Intentional bypass with justification
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// The upstream library has incorrect types - tracked in issue #123
const legacyData = externalLib.getSomething() as any;
```

### Verification

Each package must pass both checks:

```bash
# Per-package typecheck
cd packages/xyz
pnpm run typecheck

# Per-package lint
pnpm run lint

# Root-level (all packages)
pnpm run typecheck
pnpm run lint
```

### Lint Script Requirement

Every package must expose a `lint` script (runs `eslint .`). If a package lacks it, add one before shipping changes.

---

## Test Layout and Import Hygiene

### Rule

**All test files live under `packages/*/tests`**, not alongside source files.

### Rationale

- Keeps source tree focused on runtime code.
- Prevents accidental production bundling of tests.
- Makes test discovery consistent across packages.

### Required Layout

```
packages/<pkg>/tests/**
```

When moving tests, update all imports to point to `packages/<pkg>/src/**` or other correct roots.

---

## App Path Resolution (Absolute Paths Only)

### Rule

**All app storage paths must be resolved via the shared path resolver and stored as absolute file URLs.**

### Rationale

Relative DB paths (`file:./...`) can split data if cwd differs between processes (server vs core).

### Required Pattern

- Use the shared `resolveAppPaths()` helper.
- Always use `file:/abs/path/...` URLs (or remote libsql URLs).
- Server + core **must** use the same resolver output.

---

## UIMessage Stream Compliance

### Rule

**All streaming responses must use AI SDK UIMessage stream protocol** (JSON parts).

### Rationale

Custom SSE text blobs (`data-session:...`) break the UIMessage parser and will not update the client state.

### Required Pattern

- Emit JSON parts like `text-delta`, `tool-call`, `tool-result`, `data-*`, `finish`.
- Set response header `x-vercel-ai-ui-message-stream: v1`.

### Git Hooks (Recommended)

Add pre-commit hook to enforce:

```json
{
  "husky": {
    "hooks": {
      "pre-commit": "pnpm run typecheck && pnpm run lint"
    }
  }
}
```

---

## Clean Code Principles

### Rule

**Write code that humans can understand. Machines will execute it either way.**

Clean code is readable, maintainable, and expresses intent clearly.

### Core Principles

#### 1. Meaningful Names

```typescript
// ❌ BAD - what does this mean?
const d = new Date();
const u = users.filter(x => x.a > 18);

// ✅ GOOD - self-documenting
const currentDate = new Date();
const adultUsers = users.filter(user => user.age >= 18);
```

**Naming guidelines:**

- Use pronounceable names - `generationDate` not `genDt`
- Use searchable names - `MAX_RETRIES` not `7`
- Avoid encodings - `User` not `IUser`, `UserInterface`
- Boolean names should be predicates - `isActive` not `active`

#### 2. Small, Focused Functions

```typescript
// ❌ BAD - does too many things
async function processUser(userId: string) {
  const user = await db.getUser(userId);
  if (!user) return null;
  await validateEmail(user.email);
  await sendWelcomeEmail(user.email);
  await updateStats(user);
  return user;
}

// ✅ GOOD - single responsibility per function
async function getUser(userId: string) {
  return await db.getUser(userId);
}

async function onboardUser(user: User) {
  await validateEmail(user.email);
  await sendWelcomeEmail(user.email);
  await updateStats(user);
}
```

**Function guidelines:**

- One level of abstraction per function
- Maximum 3-4 parameters (use objects for more)
- Should fit on a single screen (~20 lines)
- Name should describe WHAT it does, not HOW

#### 3. Avoid Duplication (DRY)

```typescript
// ❌ BAD - duplicated logic
function getUserName(user: User) {
  if (user && user.name) {
    return user.name.trim();
  }
  return "Guest";
}

function getUserEmail(user: User) {
  if (user && user.email) {
    return user.email.trim();
  }
  return "";
}

// ✅ GOOD - extracted common logic
function safeProperty<T>(obj: T | null, prop: keyof T, fallback: string): string {
  return obj?.[prop] ? String(obj[prop]).trim() : fallback;
}

const userName = safeProperty(user, "name", "Guest");
const userEmail = safeProperty(user, "email", "");
```

#### 4. Explicit is Better Than Implicit

```typescript
// ❌ BAD - magic values and hidden behavior
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
// ❌ BAD - nested conditions
function process(data: Data) {
  if (data) {
    if (data.items) {
      if (data.items.length > 0) {
        // do work
        return true;
      } else {
        return false;
      }
    }
  }
  return false;
}

// ✅ GOOD - flat structure with early returns
function process(data: Data): boolean {
  if (!data?.items) return false;
  if (data.items.length === 0) return false;

  // do work
  return true;
}
```

#### 6. Don't Repeat Tests

```typescript
// ❌ BAD - repeated test in branches
if (user && user.age >= 18 && user.isVerified) {
  // adult verified user logic
} else if (user && user.age >= 18 && !user.isVerified) {
  // adult unverified user logic
} else if (user && user.age < 18) {
  // minor user logic
}

// ✅ GOOD - test once, branch smartly
if (!user) return;
if (user.age < 18) {
  // minor user logic
} else if (user.isVerified) {
  // adult verified user logic
} else {
  // adult unverified user logic
}
```

#### 7. Error Handling

```typescript
// ❌ BAD - silent failures
try {
  await riskyOperation();
} catch (e) {
  // ignore
}

// ❌ BAD - generic catch
try {
  await riskyOperation();
} catch (error) {
  console.log(error);
}

// ✅ GOOD - specific error handling
try {
  await riskyOperation();
} catch (error) {
  if (error instanceof NetworkError) {
    logger.warn("Network failed, retrying", { url });
    return retry();
  }
  throw error; // re-throw unexpected errors
}
```

### Code Organization

#### File Structure

```
src/
  features/
    auth/
      login.ts        // single feature
      signup.ts
    payments/
      checkout.ts
  shared/
    utils/
      date.ts
      validation.ts
    types/
      user.ts
      api.ts
```

**Guidelines:**

- One logical concept per file
- Group related files in folders
- Keep folder depth ≤ 3 levels
- Use `index.ts` for public exports

### Comments

**Code should be self-documenting. Comments explain WHY, not WHAT.**

```typescript
// ❌ BAD - redundant comments
// Get the user from database
const user = await db.getUser(id);

// Check if user exists
if (user) {
  // Return user data
  return user;
}

// ✅ GOOD - explain the "why"
// Use cached user to avoid rate limit on auth provider
const user = await getCachedUser(id);

// Fallback to guest session if auth provider is down
if (user) {
  return user;
}
```

**When to comment:**

- Legal disclaimers
- Complex algorithm explanations
- Workarounds for bugs (link to issue)
- Non-obvious performance optimizations
- TODO/FIXME with actionable context

### Testing

```typescript
// ❌ BAD - testing implementation
test("adds item to array", () => {
  const items: string[] = [];
  items.push("test");
  expect(items.length).toBe(1);
});

// ✅ GOOD - testing behavior
test("cart calculates total with tax", () => {
  const cart = new Cart();
  cart.addItem({ price: 100 });
  expect(cart.total()).toBe(108); // includes 8% tax
});
```

### Summary Checklist

- [ ] Functions do ONE thing and are named accordingly
- [ ] No magic numbers or strings - use named constants
- [ ] Early returns instead of deep nesting
- [ ] Error handling is specific and intentional
- [ ] Imports follow ordering convention
- [ ] No commented-out code (delete it, git has history)
- [ ] No `console.log` in production (use proper logging)
- [ ] Tests describe behavior, not implementation

---

## Related Standards

- `global/tech-stack` - TypeScript version and tooling configuration
