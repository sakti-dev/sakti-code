export const DEFAULT_DEPENDENCY_SYMLINK_DIRS = [
  "node_modules",
  ".venv",
  "venv",
  "target",
  ".cargo",
  "vendor/bundle",
  ".bundle",
  ".gradle",
  ".m2",
  "vendor",
  "zig-cache",
  ".zig-cache",
] as const;

export interface DependencySymlinkDirsResult {
  dirs: string[];
  warning?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDirs(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed === "" || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/**
 * Resolve the dependency/cache directory names to symlink into a mission
 * worktree. A non-empty string array at `worktree.dependencySymlinkDirs` in
 * global settings replaces the curated default list; a malformed or empty
 * override falls back to the defaults (with an optional warning the caller can
 * surface). Workspace-specific overrides are out of scope.
 */
export function resolveDependencySymlinkDirs(
  settings: Record<string, unknown>,
): DependencySymlinkDirsResult {
  const fallback = [...DEFAULT_DEPENDENCY_SYMLINK_DIRS];
  const worktree = settings.worktree;
  if (!isRecord(worktree) || worktree.dependencySymlinkDirs === undefined) {
    return { dirs: fallback };
  }
  const raw = worktree.dependencySymlinkDirs;
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
    return {
      dirs: fallback,
      warning:
        "Ignoring malformed settings.worktree.dependencySymlinkDirs; expected a string array.",
    };
  }
  const dirs = normalizeDirs(raw);
  if (dirs.length === 0) {
    return { dirs: fallback };
  }
  return { dirs };
}
