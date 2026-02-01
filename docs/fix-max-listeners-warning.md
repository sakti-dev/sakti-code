# Fix MaxListenersExceededWarning

## Problem

```
MaxListenersExceededWarning: Possible EventEmitter memory leak detected.
11 exit listeners added to [process]. MaxListeners is 10.
```

Multiple modules are adding `exit` event handlers to `process`, exceeding the default limit of 10.

## Root Cause

Each module that needs cleanup on exit adds its own listener. Currently these include:

- Electron app lifecycle
- HTTP server shutdown
- Database connections (libsql)
- Mastra Memory cleanup
- Pino logger flush
- Potentially others from dependencies

## Solution: Centralized Shutdown Manager

### Step 1: Create shutdown manager

```typescript
// packages/shared/src/shutdown.ts
type CleanupFn = () => Promise<void> | void;

class ShutdownManager {
  private static instance: ShutdownManager;
  private cleanupFns: Map<string, CleanupFn> = new Map();
  private isShuttingDown = false;

  private constructor() {
    // Single listener for all cleanup
    process.once("exit", () => this.runCleanup());
    process.once("SIGINT", () => this.gracefulShutdown());
    process.once("SIGTERM", () => this.gracefulShutdown());
  }

  static getInstance(): ShutdownManager {
    if (!ShutdownManager.instance) {
      ShutdownManager.instance = new ShutdownManager();
    }
    return ShutdownManager.instance;
  }

  register(name: string, fn: CleanupFn): void {
    this.cleanupFns.set(name, fn);
  }

  unregister(name: string): void {
    this.cleanupFns.delete(name);
  }

  private async runCleanup(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    for (const [name, fn] of this.cleanupFns) {
      try {
        await fn();
        console.log(`[shutdown] Cleaned up: ${name}`);
      } catch (err) {
        console.error(`[shutdown] Failed to cleanup ${name}:`, err);
      }
    }
  }

  private async gracefulShutdown(): Promise<void> {
    await this.runCleanup();
    process.exit(0);
  }
}

export const shutdown = ShutdownManager.getInstance();
```

### Step 2: Update modules to use ShutdownManager

**Before:**

```typescript
// In each module
process.on("exit", () => cleanup());
```

**After:**

```typescript
import { shutdown } from "@ekacode/shared/shutdown";

// Register cleanup
shutdown.register("database", async () => {
  await db.close();
});
```

### Step 3: Files to update

| File                                 | Current Pattern           | Change                                   |
| ------------------------------------ | ------------------------- | ---------------------------------------- |
| `packages/server/src/index.ts`       | `process.on('exit', ...)` | Use `shutdown.register('server', ...)`   |
| `packages/server/db/index.ts`        | Direct exit handler       | Use `shutdown.register('database', ...)` |
| `packages/core/src/memory/index.ts`  | Possible exit handler     | Use `shutdown.register('memory', ...)`   |
| `packages/desktop/src/main/index.ts` | Electron cleanup          | Use `shutdown.register('electron', ...)` |

### Step 4: Find existing exit listeners

Run this to locate all exit handlers:

```bash
grep -rn "process.on.*exit\|process.once.*exit" packages/
```

## Quick Fix Alternative

If you need a quick fix before implementing the above:

```typescript
// In packages/desktop/src/main/index.ts (very early)
process.setMaxListeners(15);
```

## Priority

- **Low** - The warning doesn't affect functionality
- Implement when doing refactoring or cleanup work
