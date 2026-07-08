import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_DEPENDENCY_SYMLINK_DIRS,
  resolveDependencySymlinkDirs,
} from "../worktree-settings.ts";

describe("resolveDependencySymlinkDirs", () => {
  it("uses curated defaults when settings are empty", () => {
    expect(resolveDependencySymlinkDirs({}).dirs).toEqual(DEFAULT_DEPENDENCY_SYMLINK_DIRS);
  });

  it("uses global settings override when dependencySymlinkDirs is a non-empty string array", () => {
    const resolved = resolveDependencySymlinkDirs({
      worktree: { dependencySymlinkDirs: ["node_modules", ".venv", "target"] },
    });
    expect(resolved.dirs).toEqual(["node_modules", ".venv", "target"]);
    expect(resolved.warning).toBeUndefined();
  });

  it("deduplicates override entries and removes empty strings", () => {
    const resolved = resolveDependencySymlinkDirs({
      worktree: { dependencySymlinkDirs: ["node_modules", "", "node_modules", "target"] },
    });
    expect(resolved.dirs).toEqual(["node_modules", "target"]);
  });

  it("falls back to defaults and returns a warning for malformed override values", () => {
    const resolved = resolveDependencySymlinkDirs({
      worktree: { dependencySymlinkDirs: "node_modules" },
    });
    expect(resolved.dirs).toEqual(DEFAULT_DEPENDENCY_SYMLINK_DIRS);
    expect(resolved.warning).toContain("worktree.dependencySymlinkDirs");
  });
});
