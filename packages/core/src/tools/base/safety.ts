/**
 * Path safety utilities for tool operations
 *
 * Provides layered safety validation for file operations:
 * 1. Context existence
 * 2. Path resolution
 * 3. External directory detection
 * 4. Permission validation
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Instance } from "../../instance";
import type { PermissionManager } from "../../security/permission-manager";
import { containsPath } from "./filesystem";

/**
 * Result of safe path resolution
 */
export interface SafePathResult {
  /** Absolute path after resolution */
  absolutePath: string;
  /** Path relative to workspace root */
  relativePath: string;
  /** Whether the path is outside the workspace */
  isExternal: boolean;
}

/**
 * Type of file operation for permission checking
 *
 * Note: Maps to PermissionType from shared types.
 * - "write" operations should map to "edit" permission
 * - "delete" operations should map to "edit" permission (file modification)
 */
export type PathOperation = "read" | "edit";

/**
 * Resolve a path safely with workspace boundary validation
 *
 * Converts relative paths to absolute, normalizes the path, and detects
 * if the resolved path is outside the workspace boundary.
 *
 * @param targetPath - Path to resolve (can be relative or absolute)
 * @param workspaceRoot - Workspace root directory
 * @returns Safe path resolution result
 *
 * @example
 * ```ts
 * const result = await resolveSafePath("src/file.ts", "/workspace");
 * // { absolutePath: "/workspace/src/file.ts", relativePath: "src/file.ts", isExternal: false }
 * ```
 */
export async function resolveSafePath(
  targetPath: string,
  workspaceRoot: string
): Promise<SafePathResult> {
  const workspaceRootResolved = (await tryRealpath(workspaceRoot)) ?? path.resolve(workspaceRoot);

  // Handle empty path
  if (!targetPath || targetPath.trim() === "") {
    return {
      absolutePath: workspaceRootResolved,
      relativePath: ".",
      isExternal: false,
    };
  }

  // Convert to absolute path if relative
  let absolutePath = targetPath;
  if (!path.isAbsolute(targetPath)) {
    absolutePath = path.resolve(workspaceRootResolved, targetPath);
  }

  // Normalize the path (resolve . and .. segments)
  absolutePath = path.normalize(absolutePath);

  // Resolve symlinks where possible to avoid workspace escape via symlinks
  const resolvedAbsolute =
    (await tryRealpath(absolutePath)) ?? (await resolveViaParent(absolutePath)) ?? absolutePath;

  // Check if path is external (outside workspace)
  const isExternal = !containsPath(workspaceRootResolved, resolvedAbsolute);

  // Calculate relative path
  let relativePath = path.relative(workspaceRootResolved, resolvedAbsolute);
  // For external paths, keep the absolute path as relative
  if (isExternal) {
    relativePath = resolvedAbsolute;
  }

  return {
    absolutePath: resolvedAbsolute,
    relativePath,
    isExternal,
  };
}

async function tryRealpath(target: string): Promise<string | null> {
  try {
    return await fs.realpath(target);
  } catch {
    return null;
  }
}

async function resolveViaParent(target: string): Promise<string | null> {
  const parent = path.dirname(target);
  const resolvedParent = await tryRealpath(parent);
  if (!resolvedParent) return null;
  return path.join(resolvedParent, path.basename(target));
}

/**
 * Validate a path operation with layered safety checks
 *
 * Performs safety validation in order:
 * 1. Validates context exists
 * 2. Resolves path safely
 * 3. Checks external directory permission
 * 4. Checks operation-specific permission
 *
 * @param targetPath - Path to validate
 * @param workspaceRoot - Workspace root directory
 * @param operation - Type of operation being performed
 * @param permissionMgr - Permission manager instance
 * @param sessionID - Current session ID
 * @param options - Optional overrides for permission metadata and patterns
 * @throws {Error} If context is missing
 * @throws {Error} If permission is denied
 * @returns Resolved safe path info
 *
 * @example
 * ```ts
 * const result = await validatePathOperation(
 *   "/workspace/file.ts",
 *   "/workspace",
 *   "read",
 *   permissionMgr,
 *   sessionID
 * );
 * ```
 */
export async function validatePathOperation(
  targetPath: string,
  workspaceRoot: string,
  operation: PathOperation,
  permissionMgr: PermissionManager,
  sessionID: string,
  options?: {
    metadata?: Record<string, unknown>;
    always?: string[];
    patterns?: string[];
  }
): Promise<SafePathResult> {
  // 1. Validate context exists (will throw if missing)
  void Instance.context;

  // 2. Resolve path safely
  const { absolutePath, relativePath, isExternal } = await resolveSafePath(
    targetPath,
    workspaceRoot
  );

  // 3. Check external directory permission
  if (isExternal) {
    const approved = await permissionMgr.requestApproval({
      id: `${sessionID}-external-${Date.now()}`,
      permission: "external_directory",
      patterns: [path.join(path.dirname(absolutePath), "*")],
      always: [],
      sessionID,
    });

    if (!approved) {
      throw new Error(`Permission denied: External directory access to ${absolutePath}`);
    }
  }

  // 4. Check operation-specific permission
  const defaultPatterns = relativePath === "" ? ["."] : [relativePath];
  const approved = await permissionMgr.requestApproval({
    id: `${sessionID}-${operation}-${Date.now()}`,
    permission: operation,
    patterns: options?.patterns ?? defaultPatterns,
    always: options?.always ?? [],
    sessionID,
    metadata: options?.metadata,
  });

  if (!approved) {
    throw new Error(`Permission denied: Cannot ${operation} ${targetPath}`);
  }

  return {
    absolutePath,
    relativePath,
    isExternal,
  };
}
