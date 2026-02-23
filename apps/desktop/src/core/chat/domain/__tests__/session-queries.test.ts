/**
 * Session Queries Tests
 */

import {
  getActiveSessions,
  getByDirectory,
  getById,
  getStatus,
} from "@/core/chat/domain/session-queries";
import type { SessionState } from "@/core/state/stores/session-store";
import { describe, expect, it } from "vitest";

describe("Session Queries", () => {
  const createState = (): SessionState => ({
    byId: {
      "sess-1": { sessionID: "sess-1", directory: "/path" },
      "sess-2": { sessionID: "sess-2", directory: "/path" },
      "sess-3": { sessionID: "sess-3", directory: "/other" },
    },
    status: {
      "sess-1": { type: "busy" },
      "sess-2": { type: "idle" },
    },
    byDirectory: {
      "/path": ["sess-1", "sess-2"],
      "/other": ["sess-3"],
    },
  });

  describe("getByDirectory", () => {
    it("returns all sessions for a directory", () => {
      const state = createState();
      const sessions = getByDirectory(state, "/path");

      expect(sessions).toHaveLength(2);
      expect(sessions[0].sessionID).toBe("sess-1");
      expect(sessions[1].sessionID).toBe("sess-2");
    });

    it("returns empty array for unknown directory", () => {
      const state = createState();
      const sessions = getByDirectory(state, "/unknown");

      expect(sessions).toEqual([]);
    });
  });

  describe("getById", () => {
    it("returns session by id", () => {
      const state = createState();
      const session = getById(state, "sess-1");

      expect(session?.sessionID).toBe("sess-1");
      expect(session?.directory).toBe("/path");
    });

    it("returns undefined for unknown session", () => {
      const state = createState();
      const session = getById(state, "unknown");

      expect(session).toBeUndefined();
    });
  });

  describe("getStatus", () => {
    it("returns session status", () => {
      const state = createState();
      const status = getStatus(state, "sess-1");

      expect(status).toEqual({ type: "busy" });
    });

    it("returns undefined for session without status", () => {
      const state = createState();
      const status = getStatus(state, "sess-3");

      expect(status).toBeUndefined();
    });
  });

  describe("getActiveSessions", () => {
    it("returns only busy sessions", () => {
      const state = createState();
      const sessions = getActiveSessions(state, "/path");

      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionID).toBe("sess-1");
    });

    it("returns empty array when no active sessions", () => {
      const state = createState();
      const sessions = getActiveSessions(state, "/other");

      expect(sessions).toEqual([]);
    });
  });
});
