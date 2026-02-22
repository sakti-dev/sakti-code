/**
 * Workspace instance management
 *
 * @deprecated Use Instance.provide() instead
 *
 * Migration Guide:
 * Old: WorkspaceInstance.getInstance()
 * New: Instance.provide({ directory, fn })
 *
 * Old: const workspace = WorkspaceInstance.getInstance();
 *      workspace.root;
 * New: const { directory } = Instance.context;
 *
 * Old: workspace.getRelativePath(filePath);
 * New: path.relative(Instance.directory, filePath);
 */

import type { WorkspaceConfig } from "@sakti-code/shared";
import path from "node:path";

/**
 * @deprecated Use Instance.provide() instead
 */
export class WorkspaceInstance {
  private static current: WorkspaceInstance | null = null;

  private constructor(
    public readonly root: string,
    public readonly worktree: string
  ) {}

  /**
   * @deprecated Use Instance.provide({ directory, fn }) instead
   */
  static initialize(config: WorkspaceConfig): WorkspaceInstance {
    this.current = new WorkspaceInstance(
      path.resolve(config.root),
      path.resolve(config.worktree || config.root)
    );
    return this.current;
  }

  /**
   * @deprecated Use Instance.directory instead
   */
  static getInstance(): WorkspaceInstance {
    if (!this.current) {
      throw new Error("Workspace not initialized. Call WorkspaceInstance.initialize() first.");
    }
    return this.current;
  }

  containsPath(filepath: string): boolean {
    const relRoot = path.relative(this.root, filepath);
    const relTree = path.relative(this.worktree, filepath);
    return !relRoot.startsWith("..") || !relTree.startsWith("..");
  }

  getRelativePath(filepath: string): string {
    return path.relative(this.worktree, filepath);
  }

  static isInitialized(): boolean {
    return this.current !== null;
  }

  static reset(): void {
    this.current = null;
  }
}
