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

  it("allows nested safe relative dependency dirs", () => {
    const resolved = resolveDependencySymlinkDirs({
      worktree: { dependencySymlinkDirs: ["vendor/bundle", "tools/cache"] },
    });

    expect(resolved.dirs).toEqual(["vendor/bundle", "tools/cache"]);
    expect(resolved.warning).toBeUndefined();
  });

  it("falls back to defaults when override contains path traversal", () => {
    const resolved = resolveDependencySymlinkDirs({
      worktree: { dependencySymlinkDirs: ["node_modules", "../outside"] },
    });

    expect(resolved.dirs).toEqual(DEFAULT_DEPENDENCY_SYMLINK_DIRS);
    expect(resolved.warning).toContain("unsafe");
  });

  it("falls back to defaults when override contains an absolute path", () => {
    const resolved = resolveDependencySymlinkDirs({
      worktree: { dependencySymlinkDirs: ["/tmp/cache"] },
    });

    expect(resolved.dirs).toEqual(DEFAULT_DEPENDENCY_SYMLINK_DIRS);
    expect(resolved.warning).toContain("unsafe");
  });

  it("falls back to defaults when override normalizes outside the worktree", () => {
    const resolved = resolveDependencySymlinkDirs({
      worktree: { dependencySymlinkDirs: ["nested/../../outside"] },
    });

    expect(resolved.dirs).toEqual(DEFAULT_DEPENDENCY_SYMLINK_DIRS);
    expect(resolved.warning).toContain("unsafe");
  });
});
