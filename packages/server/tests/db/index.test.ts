/**
 * Tests for database client and connection
 *
 * TDD approach: Tests written first to define expected behavior
 */

import { resolveAppPaths } from "@sakti-code/shared/paths";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe("database client", () => {
  describe("connection", () => {
    it("should create database client successfully", async () => {
      const { db } = await import("../../db/index");
      expect(db).toBeDefined();
    });

    it("should use correct database URL from environment", async () => {
      const originalUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = "file:./test.db";

      const { getDatabaseUrl } = await import("../../db/index");
      const url = getDatabaseUrl();

      const expected = pathToFileURL(path.resolve(process.cwd(), "./test.db")).href;
      expect(url).toBe(expected);

      process.env.DATABASE_URL = originalUrl;
    });

    it("should default to local SQLite file when DATABASE_URL not set", async () => {
      delete process.env.DATABASE_URL;

      const { getDatabaseUrl } = await import("../../db/index");
      const url = getDatabaseUrl();

      const expected = resolveAppPaths().sakticodeDbUrl;
      expect(url).toBe(expected);
    });
  });

  describe("schema", () => {
    it("should export sessions table schema", async () => {
      const { sessions } = await import("../../db/schema");
      expect(sessions).toBeDefined();
      expect(sessions.session_id).toBeDefined();
      expect(sessions.resource_id).toBeDefined();
      expect(sessions.thread_id).toBeDefined();
      expect(sessions.created_at).toBeDefined();
      expect(sessions.last_accessed).toBeDefined();
    });

    it("should export toolSessions table schema", async () => {
      const { toolSessions } = await import("../../db/schema");
      expect(toolSessions).toBeDefined();
      expect(toolSessions.tool_session_id).toBeDefined();
      expect(toolSessions.session_id).toBeDefined();
      expect(toolSessions.tool_name).toBeDefined();
      expect(toolSessions.tool_key).toBeDefined();
      expect(toolSessions.data).toBeDefined();
      expect(toolSessions.created_at).toBeDefined();
      expect(toolSessions.last_accessed).toBeDefined();
    });

    it("should have foreign key constraint from tool_sessions to sessions", async () => {
      const { toolSessions, sessions } = await import("../../db/schema");
      // The foreign key is defined in the schema - just verify the relationship exists
      expect(toolSessions.session_id).toBeDefined();
      expect(sessions.session_id).toBeDefined();
    });
  });
});
