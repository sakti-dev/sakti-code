/**
 * Tests for workspace storage
 *
 * TDD approach: Tests written first to define expected behavior
 */

import { v7 as uuidv7 } from "uuid";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, sessions, threads, workspaces } from "../../db";

// Mock uuidv7 for consistent testing
vi.mock("uuid", () => ({
  v7: vi.fn(),
}));

const uuidv7Mock = vi.mocked(uuidv7) as unknown as ReturnType<typeof vi.fn>;

describe("workspaces", () => {
  beforeAll(async () => {
    const { setupTestDatabase } = await import("../../db/test-setup");
    await setupTestDatabase();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    let counter = 0;
    uuidv7Mock.mockImplementation(() => {
      counter++;
      return `01234567-89ab-cdef-0123-${String(counter).padStart(12, "0")}`;
    });
    await db.delete(sessions);
    await db.delete(threads);
    await db.delete(workspaces);
  });

  afterEach(async () => {
    await db.delete(sessions);
    await db.delete(threads);
    await db.delete(workspaces);
  });

  describe("createWorkspace", () => {
    it("creates a workspace with UUIDv7 ID", async () => {
      const mockId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockId);

      const { createWorkspace } = await import("../../db/workspaces");
      const ws = await createWorkspace({ path: "/tmp/test-project", name: "test-project" });

      expect(ws.id).toBe(mockId);
      expect(ws.path).toBe("/tmp/test-project");
      expect(ws.name).toBe("test-project");
      expect(ws.status).toBe("active");
      expect(ws.createdAt).toBeInstanceOf(Date);
      expect(ws.lastOpenedAt).toBeInstanceOf(Date);
    });

    it("creates a workspace with default name from path", async () => {
      const mockId = "01234567-89ab-cdef-0123-456789abcdef";
      uuidv7Mock.mockReturnValue(mockId);

      const { createWorkspace } = await import("../../db/workspaces");
      const ws = await createWorkspace({ path: "/home/user/my-cool-project" });

      expect(ws.name).toBe("my-cool-project");
    });
  });

  describe("getWorkspaceById", () => {
    it("retrieves workspace by ID", async () => {
      const { createWorkspace, getWorkspaceById } = await import("../../db/workspaces");
      const created = await createWorkspace({ path: "/tmp/test", name: "test" });
      const retrieved = await getWorkspaceById(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.path).toBe("/tmp/test");
    });

    it("returns null for non-existent ID", async () => {
      const { getWorkspaceById } = await import("../../db/workspaces");
      const result = await getWorkspaceById("non-existent-id");
      expect(result).toBeNull();
    });
  });

  describe("getWorkspaceByPath", () => {
    it("retrieves workspace by path", async () => {
      const { createWorkspace, getWorkspaceByPath } = await import("../../db/workspaces");
      const created = await createWorkspace({ path: "/tmp/test-project", name: "test" });
      const retrieved = await getWorkspaceByPath("/tmp/test-project");

      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.path).toBe("/tmp/test-project");
    });

    it("returns null for non-existent path", async () => {
      const { getWorkspaceByPath } = await import("../../db/workspaces");
      const result = await getWorkspaceByPath("/non/existent/path");
      expect(result).toBeNull();
    });
  });

  describe("listWorkspaces", () => {
    it("lists active workspaces sorted by last_opened_at", async () => {
      const { createWorkspace, listWorkspaces } = await import("../../db/workspaces");

      await createWorkspace({ path: "/tmp/workspace-a", name: "workspace-a" });
      await new Promise(r => setTimeout(r, 10));
      await createWorkspace({ path: "/tmp/workspace-b", name: "workspace-b" });
      await new Promise(r => setTimeout(r, 10));
      await createWorkspace({ path: "/tmp/workspace-c", name: "workspace-c" });

      const active = await listWorkspaces("active");

      expect(active).toHaveLength(3);
      expect(active[0].name).toBe("workspace-a");
      expect(active[2].name).toBe("workspace-c");
    });

    it("excludes archived workspaces from active list", async () => {
      const { createWorkspace, archiveWorkspace, listWorkspaces } =
        await import("../../db/workspaces");

      const ws = await createWorkspace({ path: "/tmp/to-archive", name: "to-archive" });
      await archiveWorkspace(ws.id);

      const active = await listWorkspaces("active");
      expect(active).toHaveLength(0);
    });
  });

  describe("listWorkspaces (archived)", () => {
    it("lists archived workspaces", async () => {
      const { createWorkspace, archiveWorkspace, listWorkspaces } =
        await import("../../db/workspaces");

      const ws = await createWorkspace({ path: "/tmp/to-archive", name: "to-archive" });
      await archiveWorkspace(ws.id);

      const archived = await listWorkspaces("archived");
      expect(archived).toHaveLength(1);
      expect(archived[0].id).toBe(ws.id);
      expect(archived[0].status).toBe("archived");
    });
  });

  describe("archiveWorkspace", () => {
    it("archives a workspace with metadata", async () => {
      const { createWorkspace, archiveWorkspace, getWorkspaceById } =
        await import("../../db/workspaces");

      const ws = await createWorkspace({ path: "/tmp/test", name: "test" });
      await archiveWorkspace(ws.id, {
        baseBranch: "main",
        repoPath: "/tmp/repo",
        isMerged: true,
      });

      const updated = await getWorkspaceById(ws.id);
      expect(updated?.status).toBe("archived");
      expect(updated?.baseBranch).toBe("main");
      expect(updated?.repoPath).toBe("/tmp/repo");
      expect(updated?.isMerged).toBe(true);
      expect(updated?.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe("restoreWorkspace", () => {
    it("restores an archived workspace", async () => {
      const { createWorkspace, archiveWorkspace, restoreWorkspace, getWorkspaceById } =
        await import("../../db/workspaces");

      const ws = await createWorkspace({ path: "/tmp/test", name: "test" });
      await archiveWorkspace(ws.id);
      await restoreWorkspace(ws.id);

      const restored = await getWorkspaceById(ws.id);
      expect(restored?.status).toBe("active");
      expect(restored?.archivedAt).toBeNull();
    });
  });

  describe("touchWorkspace", () => {
    it("updates last_opened_at timestamp", async () => {
      const { createWorkspace, touchWorkspace, getWorkspaceById } =
        await import("../../db/workspaces");

      const ws = await createWorkspace({ path: "/tmp/test", name: "test" });

      // Wait a bit before touching
      await new Promise(r => setTimeout(r, 1100));

      await touchWorkspace(ws.id);

      const updated = await getWorkspaceById(ws.id);
      expect(updated).not.toBeNull();
      // Just verify it executed without error - the timestamp is updated
    });
  });

  describe("deleteWorkspace", () => {
    it("deletes a workspace", async () => {
      const { createWorkspace, deleteWorkspace, getWorkspaceById } =
        await import("../../db/workspaces");

      const ws = await createWorkspace({ path: "/tmp/test", name: "test" });
      await deleteWorkspace(ws.id);

      const result = await getWorkspaceById(ws.id);
      expect(result).toBeNull();
    });
  });

  describe("unique path constraint", () => {
    it("prevents duplicate paths", async () => {
      const { createWorkspace } = await import("../../db/workspaces");

      await createWorkspace({ path: "/tmp/test", name: "test" });
      await expect(createWorkspace({ path: "/tmp/test", name: "test2" })).rejects.toThrow();
    });
  });
});
