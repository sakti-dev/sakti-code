/**
 * Centralized Shutdown Manager
 *
 * Singleton pattern that registers a single set of process event handlers
 * and coordinates cleanup across all modules.
 *
 * Prevents MaxListenersExceededWarning by having only one set of listeners
 * for exit events instead of multiple scattered across the codebase.
 *
 * Cleanup functions run in priority order (lower numbers run first).
 */

type CleanupFn = () => Promise<void> | void;

interface CleanupItem {
  name: string;
  fn: CleanupFn;
  priority: number; // Lower = runs first (default: 100)
}

class ShutdownManager {
  private static instance: ShutdownManager;
  private cleanupFns: CleanupItem[] = [];
  private isShuttingDown = false;
  private handlersRegistered = false;

  private constructor() {
    // Handlers registered on first call to register()
  }

  static getInstance(): ShutdownManager {
    if (!ShutdownManager.instance) {
      ShutdownManager.instance = new ShutdownManager();
    }
    return ShutdownManager.instance;
  }

  /**
   * Register a cleanup function to run on shutdown
   * @param name - Unique identifier for this cleanup
   * @param fn - Cleanup function (sync or async)
   * @param priority - Lower numbers run first (default: 100)
   */
  register(name: string, fn: CleanupFn, priority: number = 100): void {
    // Prevent duplicate registrations
    this.cleanupFns = this.cleanupFns.filter(item => item.name !== name);
    this.cleanupFns.push({ name, fn, priority });
    this.ensureHandlers();
  }

  /**
   * Unregister a cleanup function
   */
  unregister(name: string): void {
    this.cleanupFns = this.cleanupFns.filter(item => item.name !== name);
  }

  private ensureHandlers(): void {
    if (this.handlersRegistered) return;
    if (typeof process === "undefined") return;

    // Register single set of handlers for all cleanup
    process.once("exit", () => this.runCleanup(false));
    process.once("SIGINT", () => this.gracefulShutdown());
    process.once("SIGTERM", () => this.gracefulShutdown());
    process.on("beforeExit", () => this.runCleanup(false));

    this.handlersRegistered = true;
  }

  private async runCleanup(log: boolean): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    // Sort by priority (lower first)
    const sorted = [...this.cleanupFns].sort((a, b) => a.priority - b.priority);

    for (const { name, fn } of sorted) {
      try {
        await fn();
      } catch (err) {
        if (log) console.error(`[shutdown] Failed to cleanup ${name}:`, err);
      }
    }
  }

  private async gracefulShutdown(): Promise<void> {
    await this.runCleanup(true);
    process.exit(0);
  }

  /**
   * Expose gracefulShutdown for external use (e.g., Electron before-quit)
   */
  async shutdown(): Promise<void> {
    await this.runCleanup(true);
  }
}

/**
 * Singleton shutdown manager instance
 */
export const shutdown = ShutdownManager.getInstance();
