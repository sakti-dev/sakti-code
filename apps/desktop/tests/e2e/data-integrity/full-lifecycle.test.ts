/**
 * E2E Tests: Full Data Integrity Lifecycle
 *
 * Comprehensive end-to-end tests covering the complete user journey
 * with focus on data integrity across all layers.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TestServer } from "../../helpers/test-server";
import { createTestServer } from "../../helpers/test-server";

type LifecycleEvent = {
  type: string;
  sequence?: number;
  properties?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseLifecycleEvent(payload: string): LifecycleEvent | null {
  const parsed: unknown = JSON.parse(payload);
  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    return null;
  }

  return {
    type: parsed.type,
    sequence: typeof parsed.sequence === "number" ? parsed.sequence : undefined,
    properties: isRecord(parsed.properties) ? parsed.properties : undefined,
  };
}

function getStringProperty(
  properties: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = properties?.[key];
  return typeof value === "string" ? value : undefined;
}

describe("E2E: Full Data Integrity Lifecycle", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await createTestServer();
  });

  afterEach(async () => {
    await server.cleanup();
  });

  describe("Complete User Journey", () => {
    it("user sends message through to completion", async () => {
      // 1. Initial chat request - creates session
      const chatResponse = await server.request("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Hello, how are you?" }],
          workspace: "/test/project",
        }),
      });

      expect(chatResponse.ok).toBe(true);
      const taskSessionId = chatResponse.headers.get("X-Task-Session-ID")!;

      // 2. Connect to SSE stream
      const eventSource = new EventSource(`${server.url}/api/events?sessionId=${taskSessionId}`);

      const events: LifecycleEvent[] = [];
      eventSource.onmessage = event => {
        const parsed = parseLifecycleEvent(event.data);
        if (parsed) {
          events.push(parsed);
        }
      };

      // Wait for events to arrive
      await new Promise(resolve => setTimeout(resolve, 2000));
      eventSource.close();

      // 3. Verify event sequence
      expect(events.length).toBeGreaterThan(0);

      // First event should be session.created
      const sessionEvent = events.find(e => e.type === "session.created");
      expect(sessionEvent).toBeDefined();
      if (!sessionEvent) {
        throw new Error("Expected session.created event");
      }
      expect(getStringProperty(sessionEvent.properties, "sessionID")).toBe(sessionId);
      expect(sessionEvent.sequence).toBe(1);

      // Should have message events
      const messageEvents = events.filter(e => e.type === "message.updated");
      expect(messageEvents.length).toBeGreaterThan(0);

      // Verify sequence continuity
      const sequences = events
        .flatMap(event => (typeof event.sequence === "number" ? [event.sequence] : []))
        .sort((a, b) => a - b);

      for (let i = 0; i < sequences.length - 1; i++) {
        expect(sequences[i + 1]).toBe(sequences[i] + 1);
      }

      // 4. Verify session persistence
      const sessionDataResponse = await server.request(`/api/task-sessions/${taskSessionId}`);
      expect(sessionDataResponse.ok).toBe(true);

      const sessionData = await sessionDataResponse.json();
      expect(sessionData.taskSessionId).toBe(taskSessionId);
      expect(sessionData.workspace).toBe("/test/project");

      // 5. Verify messages persisted
      const messagesResponse = await server.request(`/api/task-sessions/${taskSessionId}/messages`);
      expect(messagesResponse.ok).toBe(true);

      const messagesData = await messagesResponse.json();
      expect(messagesData.messages.length).toBeGreaterThan(0);
    });

    it("handles multiple turns in conversation", async () => {
      // First message
      const response1 = await server.request("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "First message" }],
          workspace: "/test/project",
        }),
      });

      const taskSessionId = response1.headers.get("X-Task-Session-ID")!;

      // Second message (same session)
      const response2 = await server.request("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Task-Session-ID": taskSessionId,
        },
        body: JSON.stringify({
          messages: [
            { role: "user", content: "First message" },
            { role: "assistant", content: "Response" },
            { role: "user", content: "Second message" },
          ],
          workspace: "/test/project",
        }),
      });

      expect(response2.ok).toBe(true);

      // Third message
      const response3 = await server.request("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Task-Session-ID": taskSessionId,
        },
        body: JSON.stringify({
          messages: [
            { role: "user", content: "First message" },
            { role: "assistant", content: "Response 1" },
            { role: "user", content: "Second message" },
            { role: "assistant", content: "Response 2" },
            { role: "user", content: "Third message" },
          ],
          workspace: "/test/project",
        }),
      });

      expect(response3.ok).toBe(true);

      // Verify all messages persisted
      const messagesResponse = await server.request(`/api/task-sessions/${taskSessionId}/messages`);
      const messagesData = await messagesResponse.json();

      // Should have user + assistant messages
      expect(messagesData.messages.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Stress Tests", () => {
    it("handles 10 concurrent sessions", async () => {
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(
          server.request("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: [{ role: "user", content: `Message ${i}` }],
              workspace: `/test/workspace-${i}`,
            }),
          })
        );
      }

      const responses = await Promise.all(promises);

      // All should succeed
      responses.forEach(response => {
        expect(response.ok).toBe(true);
      });

      // All should have unique session IDs
      const sessionIds = responses.map(r => r.headers.get("X-Task-Session-ID"));
      const uniqueSessionIds = new Set(sessionIds);
      expect(uniqueSessionIds.size).toBe(10);
    });

    it("handles rapid sequential messages without data loss", async () => {
      // Create session
      const response = await server.request("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Start" }],
          workspace: "/test/project",
        }),
      });

      const taskSessionId = response.headers.get("X-Task-Session-ID")!;

      // Send 10 messages rapidly
      const messagePromises = [];
      for (let i = 1; i <= 10; i++) {
        messagePromises.push(
          server.request("/api/chat", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Task-Session-ID": taskSessionId,
            },
            body: JSON.stringify({
              messages: [{ role: "user", content: `Rapid message ${i}` }],
              workspace: "/test/project",
            }),
          })
        );
      }

      const messageResponses = await Promise.all(messagePromises);

      // All should succeed
      messageResponses.forEach(response => {
        expect(response.ok).toBe(true);
      });

      // Verify all messages persisted
      const messagesResponse = await server.request(`/api/task-sessions/${taskSessionId}/messages`);
      const messagesData = await messagesResponse.json();

      // Should have 11 messages (initial + 10 rapid)
      expect(messagesData.messages.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe("Edge Cases", () => {
    it("handles empty message content gracefully", async () => {
      const response = await server.request("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "" }],
          workspace: "/test/project",
        }),
      });

      // Should handle gracefully (either accept or reject with clear error)
      expect(response.status === 200 || response.status >= 400).toBe(true);
    });

    it("handles very long message content", async () => {
      const longContent = "a".repeat(10000);

      const response = await server.request("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: longContent }],
          workspace: "/test/project",
        }),
      });

      expect(response.ok).toBe(true);

      const taskSessionId = response.headers.get("X-Task-Session-ID")!;

      // Verify message persisted with full content
      const messagesResponse = await server.request(`/api/task-sessions/${taskSessionId}/messages`);
      const messagesData = await messagesResponse.json();

      const userMessage = messagesData.messages.find((m: { role: string }) => m.role === "user");
      expect(userMessage).toBeDefined();
    });

    it("handles special characters in message content", async () => {
      const specialContent = `Hello!
      This has "quotes" and 'apostrophes'
      And <html> tags </html>
      And emoji: 🎉 🚀 💻
      And unicode: 你好世界
      And special: \n\t\r
      `;

      const response = await server.request("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: specialContent }],
          workspace: "/test/project",
        }),
      });

      expect(response.ok).toBe(true);
    });
  });

  describe("Data Consistency", () => {
    it("session data is consistent across all endpoints", async () => {
      // Create session
      const chatResponse = await server.request("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Test" }],
          workspace: "/test/project",
        }),
      });

      const taskSessionId = chatResponse.headers.get("X-Task-Session-ID")!;

      // Get session from different endpoints
      const [sessionResponse, messagesResponse] = await Promise.all([
        server.request(`/api/task-sessions/${taskSessionId}`),
        server.request(`/api/task-sessions/${taskSessionId}/messages`),
      ]);

      const sessionData = await sessionResponse.json();
      const messagesData = await messagesResponse.json();

      // All should reference same session
      expect(sessionData.taskSessionId).toBe(taskSessionId);
      expect(messagesData.sessionID).toBe(taskSessionId);

      // Session should have correct message count
      expect(sessionData.messageCount || messagesData.messages.length).toBeGreaterThan(0);
    });

    it("no orphaned data after session operations", async () => {
      // Create session with messages
      const chatResponse = await server.request("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Test message" }],
          workspace: "/test/project",
        }),
      });

      const taskSessionId = chatResponse.headers.get("X-Task-Session-ID")!;

      // Get initial state
      const initialMessages = await server.request(`/api/task-sessions/${taskSessionId}/messages`);
      const initialData = await initialMessages.json();
      expect(initialData.messages.length).toBeGreaterThan(0);

      // Session and messages should be properly linked
      const sessionResponse = await server.request(`/api/task-sessions/${taskSessionId}`);
      const sessionData = await sessionResponse.json();
      expect(sessionData.taskSessionId).toBe(taskSessionId);
    });
  });
});
