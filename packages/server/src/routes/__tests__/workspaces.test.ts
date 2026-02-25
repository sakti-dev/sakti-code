/**
 * Tests for workspace API endpoints
 *
 * TDD approach: Tests written first to define expected behavior
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test files use any for simplicity */

import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, taskSessions, threads, workspaces } from "../../../db";

describe("workspace API endpoints", () => {
  let mockApp: Hono<any>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Clean up database
    await db.delete(taskSessions);
    await db.delete(threads);
    await db.delete(workspaces);

    // Create a test app
    mockApp = new Hono();

    // Import and use the workspace router
    const { default: workspaceRouter } = await import("../workspaces");
    mockApp.route("/", workspaceRouter);
  });

  afterEach(async () => {
    await db.delete(taskSessions);
    await db.delete(threads);
    await db.delete(workspaces);
  });

  describe("GET /api/workspaces", () => {
    it("should return empty array when no workspaces exist", async () => {
      const response = await mockApp.request("/api/workspaces");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workspaces).toEqual([]);
    });

    it("should return active workspaces", async () => {
      // Create a workspace directly in DB
      await db.insert(workspaces).values({
        id: "test-ws-1",
        path: "/tmp/workspace-1",
        name: "workspace-1",
        status: "active",
        created_at: new Date(),
        last_opened_at: new Date(),
      });

      const response = await mockApp.request("/api/workspaces");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workspaces).toHaveLength(1);
      expect(data.workspaces[0].name).toBe("workspace-1");
    });

    it("should not return archived workspaces", async () => {
      await db.insert(workspaces).values({
        id: "archived-ws",
        path: "/tmp/archived",
        name: "archived",
        status: "archived",
        created_at: new Date(),
        last_opened_at: new Date(),
      });

      const response = await mockApp.request("/api/workspaces");
      const data = await response.json();

      expect(data.workspaces).toHaveLength(0);
    });
  });

  describe("GET /api/workspaces/archived", () => {
    it("should return archived workspaces", async () => {
      await db.insert(workspaces).values({
        id: "archived-ws",
        path: "/tmp/archived",
        name: "archived",
        status: "archived",
        archived_at: new Date(),
        created_at: new Date(),
        last_opened_at: new Date(),
      });

      const response = await mockApp.request("/api/workspaces/archived");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workspaces).toHaveLength(1);
      expect(data.workspaces[0].status).toBe("archived");
    });
  });

  describe("GET /api/workspaces/:id", () => {
    it("should return workspace by ID", async () => {
      await db.insert(workspaces).values({
        id: "test-ws-1",
        path: "/tmp/workspace-1",
        name: "workspace-1",
        status: "active",
        created_at: new Date(),
        last_opened_at: new Date(),
      });

      const response = await mockApp.request("/api/workspaces/test-ws-1");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workspace.id).toBe("test-ws-1");
      expect(data.workspace.name).toBe("workspace-1");
    });

    it("should return 404 for non-existent workspace", async () => {
      const response = await mockApp.request("/api/workspaces/non-existent");

      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/workspaces/by-path", () => {
    it("should return workspace by path query param", async () => {
      await db.insert(workspaces).values({
        id: "test-ws-1",
        path: "/tmp/workspace-1",
        name: "workspace-1",
        status: "active",
        created_at: new Date(),
        last_opened_at: new Date(),
      });

      const response = await mockApp.request("/api/workspaces/by-path?path=/tmp/workspace-1");
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workspace.path).toBe("/tmp/workspace-1");
    });

    it("should return 404 when path not found", async () => {
      const response = await mockApp.request("/api/workspaces/by-path?path=/non/existent");

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/workspaces", () => {
    it("should create a new workspace", async () => {
      const response = await mockApp.request("/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ path: "/tmp/new-workspace", name: "new-workspace" }),
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.workspace).toBeDefined();
      expect(data.workspace.path).toBe("/tmp/new-workspace");
      expect(data.workspace.name).toBe("new-workspace");
      expect(data.workspace.status).toBe("active");
    });

    it("should return existing workspace if path already exists", async () => {
      // Create workspace first
      await db.insert(workspaces).values({
        id: "existing-ws",
        path: "/tmp/existing",
        name: "existing",
        status: "active",
        created_at: new Date(),
        last_opened_at: new Date(),
      });

      // Try to create again
      const response = await mockApp.request("/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ path: "/tmp/existing", name: "existing2" }),
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workspace.id).toBe("existing-ws");
    });
  });

  describe("PUT /api/workspaces/:id", () => {
    it("should update workspace", async () => {
      await db.insert(workspaces).values({
        id: "test-ws-1",
        path: "/tmp/workspace-1",
        name: "workspace-1",
        status: "active",
        created_at: new Date(),
        last_opened_at: new Date(),
      });

      const response = await mockApp.request("/api/workspaces/test-ws-1", {
        method: "PUT",
        body: JSON.stringify({ name: "updated-name" }),
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workspace.name).toBe("updated-name");
    });
  });

  describe("PUT /api/workspaces/:id/archive", () => {
    it("should archive workspace with metadata", async () => {
      await db.insert(workspaces).values({
        id: "test-ws-1",
        path: "/tmp/workspace-1",
        name: "workspace-1",
        status: "active",
        created_at: new Date(),
        last_opened_at: new Date(),
      });

      const response = await mockApp.request("/api/workspaces/test-ws-1/archive", {
        method: "PUT",
        body: JSON.stringify({ baseBranch: "main", repoPath: "/tmp/repo", isMerged: true }),
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workspace.status).toBe("archived");
      expect(data.workspace.baseBranch).toBe("main");
      expect(data.workspace.isMerged).toBe(true);
    });
  });

  describe("PUT /api/workspaces/:id/restore", () => {
    it("should restore archived workspace", async () => {
      await db.insert(workspaces).values({
        id: "archived-ws",
        path: "/tmp/archived",
        name: "archived",
        status: "archived",
        archived_at: new Date(),
        created_at: new Date(),
        last_opened_at: new Date(),
      });

      const response = await mockApp.request("/api/workspaces/archived-ws/restore", {
        method: "PUT",
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workspace.status).toBe("active");
      expect(data.workspace.archivedAt).toBeNull();
    });
  });

  describe("PUT /api/workspaces/:id/touch", () => {
    it("should update last_opened_at timestamp", async () => {
      const originalTime = new Date(Date.now() - 10000);

      await db.insert(workspaces).values({
        id: "test-ws-1",
        path: "/tmp/workspace-1",
        name: "workspace-1",
        status: "active",
        created_at: originalTime,
        last_opened_at: originalTime,
      });

      const response = await mockApp.request("/api/workspaces/test-ws-1/touch", {
        method: "PUT",
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      const newTime = new Date(data.workspace.lastOpenedAt).getTime();
      expect(newTime).toBeGreaterThan(originalTime.getTime());
    });
  });

  describe("DELETE /api/workspaces/:id", () => {
    it("should delete workspace", async () => {
      await db.insert(workspaces).values({
        id: "test-ws-1",
        path: "/tmp/workspace-1",
        name: "workspace-1",
        status: "active",
        created_at: new Date(),
        last_opened_at: new Date(),
      });

      const response = await mockApp.request("/api/workspaces/test-ws-1", {
        method: "DELETE",
      });

      expect(response.status).toBe(200);

      // Verify it's deleted
      const getResponse = await mockApp.request("/api/workspaces/test-ws-1");
      expect(getResponse.status).toBe(404);
    });
  });
});
