/**
 * Tests for workspace endpoint
 *
 * Tests workspace information retrieval with session context
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("workspace endpoint", () => {
  beforeEach(async () => {
    const { setupTestDatabase } = await import("../../../db/test-setup");
    await setupTestDatabase();
    const { db, taskSessions } = await import("../../../db");
    await db.delete(taskSessions);
  });

  afterEach(async () => {
    const { db, taskSessions } = await import("../../../db");
    await db.delete(taskSessions);
  });

  describe("GET /api/workspace", () => {
    it("should return 200 with workspace data", async () => {
      const { createTaskSession } = await import("../../../db/task-sessions");
      const session = await createTaskSession("local");
      const workspaceRouter = (await import("../workspace")).default;

      const response = await workspaceRouter.request(
        "http://localhost/api/workspace?directory=/tmp/workspace-test",
        {
          method: "GET",
          headers: {
            "X-Task-Session-ID": session.taskSessionId,
          },
        }
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.directory).toBeDefined();
      expect(data.inContext).toBeDefined();
    });

    it("should return current directory path from query parameter", async () => {
      const { createTaskSession } = await import("../../../db/task-sessions");
      const session = await createTaskSession("local");
      const workspaceRouter = (await import("../workspace")).default;

      const testDir = "/tmp/workspace-query-test";
      const response = await workspaceRouter.request(
        `http://localhost/api/workspace?directory=${encodeURIComponent(testDir)}`,
        {
          method: "GET",
          headers: {
            "X-Task-Session-ID": session.taskSessionId,
          },
        }
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.directory).toBe(testDir);
    });

    it("should return inContext as true when sessionBridge establishes context", async () => {
      const { createTaskSession } = await import("../../../db/task-sessions");
      const session = await createTaskSession("local");
      const workspaceRouter = (await import("../workspace")).default;

      const response = await workspaceRouter.request(
        "http://localhost/api/workspace?directory=/tmp/workspace-context",
        {
          method: "GET",
          headers: {
            "X-Task-Session-ID": session.taskSessionId,
          },
        }
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.inContext).toBe(true);
    });

    it("should have content-type application/json", async () => {
      const { createTaskSession } = await import("../../../db/task-sessions");
      const session = await createTaskSession("local");
      const workspaceRouter = (await import("../workspace")).default;

      const response = await workspaceRouter.request(
        "http://localhost/api/workspace?directory=/tmp/workspace-headers",
        {
          method: "GET",
          headers: {
            "X-Task-Session-ID": session.taskSessionId,
          },
        }
      );

      expect(response.headers.get("content-type")).toMatch(/application\/json/);
    });

    it("should include sessionId when session is created", async () => {
      const { createTaskSession } = await import("../../../db/task-sessions");
      const session = await createTaskSession("local");
      const workspaceRouter = (await import("../workspace")).default;

      const response = await workspaceRouter.request(
        "http://localhost/api/workspace?directory=/tmp/workspace-session",
        {
          method: "GET",
          headers: {
            "X-Task-Session-ID": session.taskSessionId,
          },
        }
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.sessionId).toBeDefined();
      expect(typeof data.sessionId).toBe("string");
      // sessionId should be a UUIDv7 (36 characters with dashes)
      expect(data.sessionId).toHaveLength(36);
    });

    it("should return same sessionId for subsequent requests with same session header", async () => {
      const { createTaskSession } = await import("../../../db/task-sessions");
      const session = await createTaskSession("local");
      const workspaceRouter = (await import("../workspace")).default;

      const testDir = "/tmp/workspace-same-session";

      // First request - use created session
      const response1 = await workspaceRouter.request(
        `http://localhost/api/workspace?directory=${encodeURIComponent(testDir)}`,
        {
          method: "GET",
          headers: {
            "X-Task-Session-ID": session.taskSessionId,
          },
        }
      );

      const data1 = await response1.json();
      expect(data1.sessionId).toBe(session.taskSessionId);

      // Second request - reuse same session
      const response2 = await workspaceRouter.request(
        `http://localhost/api/workspace?directory=${encodeURIComponent(testDir)}`,
        {
          method: "GET",
          headers: {
            "X-Task-Session-ID": session.taskSessionId,
          },
        }
      );

      const data2 = await response2.json();
      expect(data2.sessionId).toBe(session.taskSessionId);
    });

    it("should return required workspace fields", async () => {
      const { createTaskSession } = await import("../../../db/task-sessions");
      const session = await createTaskSession("local");
      const workspaceRouter = (await import("../workspace")).default;

      const response = await workspaceRouter.request(
        "http://localhost/api/workspace?directory=/tmp/workspace-fields",
        {
          method: "GET",
          headers: {
            "X-Task-Session-ID": session.taskSessionId,
          },
        }
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      // Required fields should always be present
      expect(data).toHaveProperty("directory");
      expect(data).toHaveProperty("inContext");
      expect(data).toHaveProperty("sessionId");
      // project and vcs are optional (depend on Instance.context population)
    });
  });

  describe("directory parameter handling", () => {
    it("should fall back to process cwd when directory is not provided", async () => {
      const { createTaskSession } = await import("../../../db/task-sessions");
      const session = await createTaskSession("local");
      const workspaceRouter = (await import("../workspace")).default;

      const response = await workspaceRouter.request("http://localhost/api/workspace", {
        method: "GET",
        headers: {
          "X-Task-Session-ID": session.taskSessionId,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.directory).toBe(process.cwd());
      expect(data.inContext).toBe(true);
    });

    it("should decode URL-encoded directory paths", async () => {
      const { createTaskSession } = await import("../../../db/task-sessions");
      const session = await createTaskSession("local");
      const workspaceRouter = (await import("../workspace")).default;

      const testDir = "/tmp/workspace with spaces";
      const encodedDir = encodeURIComponent(testDir);

      const response = await workspaceRouter.request(
        `http://localhost/api/workspace?directory=${encodedDir}`,
        {
          method: "GET",
          headers: {
            "X-Task-Session-ID": session.taskSessionId,
          },
        }
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.directory).toBe(testDir);
    });

    it("should handle absolute paths", async () => {
      const { createTaskSession } = await import("../../../db/task-sessions");
      const session = await createTaskSession("local");
      const workspaceRouter = (await import("../workspace")).default;

      const absolutePath = "/tmp/absolute/workspace/path";

      const response = await workspaceRouter.request(
        `http://localhost/api/workspace?directory=${encodeURIComponent(absolutePath)}`,
        {
          method: "GET",
          headers: {
            "X-Task-Session-ID": session.taskSessionId,
          },
        }
      );

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.directory).toBe(absolutePath);
    });
  });
});
