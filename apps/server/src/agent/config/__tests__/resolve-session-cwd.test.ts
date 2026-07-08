import { describe, expect, it } from "vite-plus/test";
import { resolveSessionCwd } from "../resolve-session-cwd.ts";

describe("resolveSessionCwd", () => {
  it("returns worktreePath when set", () => {
    expect(resolveSessionCwd({ worktreePath: "/repo-wt/change" }, { cwd: "/repo" })).toBe(
      "/repo-wt/change",
    );
  });

  it("falls back to project.cwd when worktreePath is null", () => {
    expect(resolveSessionCwd({ worktreePath: null }, { cwd: "/repo" })).toBe("/repo");
  });
});
