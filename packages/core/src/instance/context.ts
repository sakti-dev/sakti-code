/**
 * AsyncLocalStorage context store
 *
 * Provides automatic context propagation through async call stacks using
 * Node.js AsyncLocalStorage. This enables Instance.provide() pattern where
 * context flows automatically through all async operations without explicit
 * parameter passing.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Core context object that propagates through async call stacks
 */
export interface InstanceContext {
  /** The working directory for this instance */
  directory: string;
  /** UUIDv7 session identifier */
  sessionID: string;
  /** UUIDv7 message identifier (unique per request) */
  messageID: string;
  /** Detected project information (populated by bootstrap) */
  project?: ProjectInfo;
  /** Version control system information (populated by bootstrap) */
  vcs?: VCSInfo;
  /** Context creation timestamp */
  createdAt: number;
  /** Optional agent identifier */
  agent?: string;
  /** Optional abort signal for cancellation */
  abort?: AbortSignal;
  /** Optional provider/model runtime selection for the current request */
  providerRuntime?: {
    providerId: string;
    modelId: string;
    providerApiUrl?: string;
    providerNpmPackage?: string;
    apiKey?: string;
    providerCredentialEnvVar?: string;
    headers?: Record<string, string>;
    hybridVisionEnabled?: boolean;
    hybridVisionProviderId?: string;
    hybridVisionModelId?: string;
    hybridVisionProviderApiUrl?: string;
    hybridVisionProviderNpmPackage?: string;
    hybridVisionApiKey?: string;
  };
}

/**
 * Information about the detected project/workspace
 */
export interface ProjectInfo {
  /** Project name (from package.json, detected, or directory name) */
  name: string;
  /** Project root directory (absolute path) */
  root: string;
  /** Git worktree path if applicable */
  worktree?: string;
  /** Parsed package.json if present */
  packageJson?: Record<string, unknown>;
}

/**
 * Version control system information
 */
export interface VCSInfo {
  /** Type of version control system */
  type: "git" | "hg" | "svn" | "none";
  /** Current branch name */
  branch?: string;
  /** Current commit SHA */
  commit?: string;
  /** Remote URL (e.g., git@github.com:user/repo.git) */
  remote?: string;
}

/**
 * AsyncLocalStorage instance for context propagation
 *
 * This storage is automatically propagated through all async operations
 * (Promise chains, async/await, setTimeout, etc.) without any explicit
 * parameter passing.
 */
const contextStorage = new AsyncLocalStorage<InstanceContext>();

/**
 * Get the current InstanceContext
 *
 * @returns The current context from AsyncLocalStorage
 * @throws If called outside of Instance.provide()
 */
export function getContext(): InstanceContext {
  const context = contextStorage.getStore();
  if (!context) {
    throw new Error(
      "Instance context accessed outside of Instance.provide(). " +
        "Tools must be called within Instance.provide({ directory, fn })"
    );
  }
  return context;
}

/**
 * Run a function within a specific context
 *
 * This establishes a new AsyncLocalStorage context boundary. All async
 * operations called within `fn` will have access to this context.
 *
 * @param context - The context to store
 * @param fn - Function to execute within this context
 * @returns The result of `fn`
 *
 * @example
 * ```ts
 * await runWithContext(
 *   { directory: "/project", sessionID: "123", messageID: "456", createdAt: Date.now() },
 *   async () => {
 *     // Context is available here
 *     const ctx = getContext();
 *     console.log(ctx.directory); // "/project"
 *   }
 * );
 * ```
 */
export function runWithContext<R>(context: InstanceContext, fn: () => Promise<R>): Promise<R> {
  return contextStorage.run(context, fn);
}

/**
 * Check if we're currently inside an Instance.provide() context
 *
 * @returns true if context is available, false otherwise
 */
export function hasContext(): boolean {
  return contextStorage.getStore() !== undefined;
}
