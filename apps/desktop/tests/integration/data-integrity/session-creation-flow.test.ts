/**
 * Integration Tests: Session Creation Flow
 *
 * End-to-end tests using real server to verify session creation
 * and identity consistency across the full stack.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { TestServer } from "../../helpers/test-server";
import { createTestServer, waitForEvent } from "../../helpers/test-server";

describe("Integration: Session Creation Flow", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await createTestServer();
  });

  afterEach(async () => {
    await server.cleanup();
  });

  describe("Happy Path", () => {
    it("complete flow: send message → server creates session → events arrive in order", async () => {
      // 1. Send chat request without session ID
      const response = await server.request("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Hello" }],
          workspace: "/test/workspace",
        }),
      });

      expect(response.ok).toBe(true);

      // 2. Verify server returns session ID in header
      const taskSessionId = response.headers.get("X-Task-Session-ID");
      expect(taskSessionId).toBeDefined();
      expect(taskSessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      ); // UUIDv7 format

      // 3. Connect to SSE and verify events
      const eventSource = new EventSource(`${server.url}/api/events?sessionId=${taskSessionId}`);

      try {
        // Wait for session.created event
        const sessionEvent = await waitForEvent(eventSource, "session.created", 5000);
        const sessionData = JSON.parse(sessionEvent.data);
        expect(sessionData.sessionID).toBe(taskSessionId);

        // Wait for message.updated event
        const messageEvent = await waitForEvent(eventSource, "message.updated", 5000);
        const messageData = JSON.parse(messageEvent.data);
        expect(messageData.info.sessionID).toBe(taskSessionId);

        // Verify sequence numbers are present and in order
        expect(sessionData.sequence).toBe(1);
        expect(messageData.sequence).toBe(2);
      } finally {
        eventSource.close();
      }
    });

    it("server returns session ID in response header", async () => {
      const response = await server.request("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Test" }],
          workspace: "/test/workspace",
        }),
      });

      const taskSessionId = response.headers.get("X-Task-Session-ID");
      expect(taskSessionId).toBeDefined();
      expect(taskSessionId).not.toBeNull();
      expect(taskSessionId?.length).toBeGreaterThan(0);
    });

    it("session is persisted and can be retrieved", async () => {
      // Create session via chat
      const chatResponse = await server.request("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Hello" }],
          workspace: "/test/workspace",
        }),
      });

      const taskSessionId = chatResponse.headers.get("X-Task-Session-ID")!;

      // Retrieve session data
      const sessionResponse = await server.request(`/api/task-sessions/${taskSessionId}`);
      expect(sessionResponse.ok).toBe(true);

      const sessionData = await sessionResponse.json();
      expect(sessionData.taskSessionId).toBe(taskSessionId);
      expect(sessionData.workspace).toBe("/test/workspace");
    });
  });

  describe("Error Scenarios", () => {
    it("handles server error during session creation gracefully", async () => {
      // This test would need a way to trigger server errors
      // For now, we test error response format
      const response = await server.request("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Invalid request - missing required fields
          workspace: "/test/workspace",
        }),
      });

      // Should return error, not crash
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it("rejects malformed session ID format", async () => {
      // Try to use invalid session ID
      const response = await server.request("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Task-Session-ID": "invalid-session-id",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Hello" }],
          workspace: "/test/workspace",
        }),
      });

      // Should reject invalid session ID format
      expect(response.status).toBe(400);
    });

    it("handles missing workspace parameter", async () => {
      const response = await server.request("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Hello" }],
          // Missing workspace
        }),
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("Concurrent Operations", () => {
    it("handles rapid sequential messages in same session", async () => {
      // Create initial session
      const firstResponse = await server.request("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Message 1" }],
          workspace: "/test/workspace",
        }),
      });

      const taskSessionId = firstResponse.headers.get("X-Task-Session-ID")!;

      // Send multiple messages rapidly using same session
      const promises = [];
      for (let i = 2; i <= 5; i++) {
        promises.push(
          server.request("/api/chat", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Task-Session-ID": taskSessionId,
            },
            body: JSON.stringify({
              messages: [{ role: "user", content: `Message ${i}` }],
              workspace: "/test/workspace",
            }),
          })
        );
      }

      const responses = await Promise.all(promises);

      // All should succeed
      responses.forEach(response => {
        expect(response.ok).toBe(true);
        // All should return same session ID
        expect(response.headers.get("X-Task-Session-ID")).toBe(taskSessionId);
      });
    });

    it("handles concurrent sends from different workspaces", async () => {
      // Send messages to different workspaces simultaneously
      const promises = [
        server.request("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Workspace A" }],
            workspace: "/workspace/a",
          }),
        }),
        server.request("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Workspace B" }],
            workspace: "/workspace/b",
          }),
        }),
        server.request("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Workspace C" }],
            workspace: "/workspace/c",
          }),
        }),
      ];

      const responses = await Promise.all(promises);

      // All should succeed
      responses.forEach(response => {
        expect(response.ok).toBe(true);
      });

      // Each should have different session ID
      const sessionIds = responses.map(r => r.headers.get("X-Task-Session-ID"));
      const uniqueSessionIds = new Set(sessionIds);
      expect(uniqueSessionIds.size).toBe(3);
    });
  });

  describe("Session Persistence", () => {
    it("session persists across multiple requests", async () => {
      // First request - create session
      const response1 = await server.request("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "First" }],
          workspace: "/test/workspace",
        }),
      });

      const taskSessionId = response1.headers.get("X-Task-Session-ID")!;

      // Second request - use same session
      const response2 = await server.request("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Task-Session-ID": taskSessionId,
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Second" }],
          workspace: "/test/workspace",
        }),
      });

      expect(response2.ok).toBe(true);
      expect(response2.headers.get("X-Task-Session-ID")).toBe(taskSessionId);

      // Verify session has both messages
      const messagesResponse = await server.request(`/api/task-sessions/${taskSessionId}/messages`);
      expect(messagesResponse.ok).toBe(true);

      const messagesData = await messagesResponse.json();
      expect(messagesData.messages).toHaveLength(2);
    });

    it("session metadata is updated on each request", async () => {
      const response1 = await server.request("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "First" }],
          workspace: "/test/workspace",
        }),
      });

      const taskSessionId = response1.headers.get("X-Task-Session-ID")!;

      // Get initial session data
      const sessionResponse1 = await server.request(`/api/task-sessions/${taskSessionId}`);
      const sessionData1 = await sessionResponse1.json();
      const firstAccessed = sessionData1.lastAccessed;

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));

      // Make another request
      await server.request("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Task-Session-ID": taskSessionId,
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Second" }],
          workspace: "/test/workspace",
        }),
      });

      // Get updated session data
      const sessionResponse2 = await server.request(`/api/task-sessions/${taskSessionId}`);
      const sessionData2 = await sessionResponse2.json();

      // lastAccessed should be updated
      expect(new Date(sessionData2.lastAccessed).getTime()).toBeGreaterThan(
        new Date(firstAccessed).getTime()
      );
    });
  });
});
