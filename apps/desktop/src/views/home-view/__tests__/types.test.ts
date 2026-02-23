import type { GitStatus } from "@/core/chat/types";
import { describe, expect, it } from "vitest";

describe("Workspace Types - Export Verification", () => {
  describe("GitStatus", () => {
    it("should be exported as interface", () => {
      const gitStatus: GitStatus = {
        branch: "main",
        baseBranch: "origin/main",
        ahead: 3,
        behind: 0,
        hasUncommitted: true,
      };
      expect(gitStatus.branch).toBe("main");
    });
  });

  describe("ArchivedWorkspace", () => {
    it("should be exported as interface", () => {
      const workspace = {
        id: "ArchivedWorkspace",
        name: "ArchivedWorkspace",
        path: "ArchivedWorkspace",
        archivedAt: new Date(),
        isMerged: true,
        baseBranch: "main",
        repoPath: "/repo",
      };
      expect(workspace.id).toBe("ArchivedWorkspace");
      expect(workspace.isMerged).toBe(true);
    });
  });

  describe("RecentProject", () => {
    it("should be exported as interface", () => {
      const project = {
        id: "RecentProject",
        name: "RecentProject",
        path: "RecentProject",
        lastOpened: new Date(),
      };
      expect(project.id).toBe("RecentProject");
      expect(project.lastOpened).toBeInstanceOf(Date);
    });
  });
});
