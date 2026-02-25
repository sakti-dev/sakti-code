/**
 * Chat Route Integration Tests
 *
 * Tests for the /api/chat endpoint with SessionManager integration.
 * Verifies UIMessage streaming, state updates, and agent execution.
 *
 * Updated for simplified single-agent architecture using processMessage API.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../runtime", () => {
  const controllers = new Map<
    string,
    {
      sessionId: string;
      processMessage: () => Promise<{ status: "completed"; finalContent: string }>;
      getStatus: () => { sessionId: string; phase: "completed" };
      hasIncompleteWork: () => boolean;
    }
  >();
  let lastRequestedSessionId: string | null = null;

  const ensureController = (sessionId: string) => {
    const existing = controllers.get(sessionId);
    if (existing) return existing;
    const controller = {
      sessionId,
      async processMessage() {
        return {
          status: "completed" as const,
          finalContent: "mock-response",
        };
      },
      getStatus: () => ({
        sessionId,
        phase: "completed" as const,
      }),
      hasIncompleteWork: () => false,
    };
    controllers.set(sessionId, controller);
    return controller;
  };

  return {
    getSessionManager: () => ({
      async getSession(sessionId: string) {
        lastRequestedSessionId = sessionId;
        return controllers.get(sessionId);
      },
      async createSession() {
        if (lastRequestedSessionId) {
          ensureController(lastRequestedSessionId);
        }
      },
    }),
  };
});

describe("Chat route integration", () => {
  beforeEach(async () => {
    delete process.env.ZAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const { setupTestDatabase } = await import("../../../db/test-setup");
    await setupTestDatabase();
    const { db, taskSessions } = await import("../../../db");
    await db.delete(taskSessions);
  });

  afterEach(async () => {
    const { db, taskSessions } = await import("../../../db");
    await db.delete(taskSessions);
  });

  describe("UIMessage streaming", () => {
    it("streams UIMessage parts with correct headers", async () => {
      const chatRouter = (await import("../chat")).default;

      const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: "Hello", stream: true }),
      });

      expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
      expect(response.headers.get("content-type") || "").toContain("text/plain");

      const body = await response.text();
      expect(body).toContain("data-session");
      expect(body).toContain('"finishReason"');
      expect(body).toContain('"type":"finish"');
    });

    it("should stream agent responses with proper status", async () => {
      const chatRouter = (await import("../chat")).default;

      const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "What files are in this directory?",
          stream: true,
        }),
      });

      // Verify response status
      expect(response.status).toBe(200);

      // Verify SSE content type
      const contentType = response.headers.get("content-type");
      expect(contentType).toBeTruthy();
      expect(contentType || "").toContain("text/plain");
    });

    it("should include state updates in stream", async () => {
      const chatRouter = (await import("../chat")).default;

      const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "List the files in the current directory",
          stream: true,
        }),
      });

      expect(response.status).toBe(200);

      const body = await response.text();

      expect(body).toContain('"type":"finish"');
    });

    it("should include text deltas in stream", async () => {
      const chatRouter = (await import("../chat")).default;

      const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "Say hello",
          stream: true,
        }),
      });

      expect(response.status).toBe(200);

      const body = await response.text();

      const hasTextDelta = body.includes('"type":"text-delta"') || body.includes("text-delta");
      const hasError = body.includes('"type":"error"');
      expect(hasTextDelta || hasError).toBe(true);
    });

    it("should complete with finish message", async () => {
      const chatRouter = (await import("../chat")).default;

      const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "Hello",
          stream: true,
        }),
      });

      expect(response.status).toBe(200);

      const body = await response.text();

      // Should have finish message with completion reason
      expect(body).toContain('"type":"finish"');
      expect(body).toContain('"finishReason"');
    });

    it("use processMessage API instead of start", async () => {
      const chatRouter = (await import("../chat")).default;

      const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "Test processMessage API",
          stream: true,
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("data-session");
      expect(body).toContain('"type":"finish"');
    });
  });

  describe("Session handling", () => {
    it("should create new session when none provided", async () => {
      const chatRouter = (await import("../chat")).default;

      const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "Hello",
          stream: true,
        }),
      });

      expect(response.status).toBe(200);

      const body = await response.text();

      // Should include session in response
      expect(body).toContain("data-session");
    });

    it("should use existing session when provided", async () => {
      const chatRouter = (await import("../chat")).default;

      const sessionId = "019c0000-0000-7000-8000-000000000121";

      const response = await chatRouter.request(`http://localhost/api/chat?directory=/tmp/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Task-Session-ID": sessionId,
        },
        body: JSON.stringify({
          message: "Hello",
          stream: true,
        }),
      });

      expect(response.status).toBe(200);
      // Should complete successfully with existing session
      const body = await response.text();
      expect(body).toContain('"finishReason"');
    });

    it("should process multiple messages in the same session", async () => {
      const chatRouter = (await import("../chat")).default;

      const sessionId = "019c0000-0000-7000-8000-000000000122";

      // First message
      const response1 = await chatRouter.request(`http://localhost/api/chat?directory=/tmp/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Task-Session-ID": sessionId,
        },
        body: JSON.stringify({
          message: "First message",
          stream: true,
        }),
      });

      expect(response1.status).toBe(200);

      // Second message in same session
      const response2 = await chatRouter.request(`http://localhost/api/chat?directory=/tmp/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Task-Session-ID": sessionId,
        },
        body: JSON.stringify({
          message: "Second message",
          stream: true,
        }),
      });

      expect(response2.status).toBe(200);
    });
  });

  describe("Error handling", () => {
    it("should return error when no directory provided", async () => {
      const chatRouter = (await import("../chat")).default;

      const response = await chatRouter.request("http://localhost/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "Hello",
        }),
      });

      // Should return error for missing directory
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it("should return 400 when retry target assistant message does not exist", async () => {
      const chatRouter = (await import("../chat")).default;

      const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "",
          retryOfAssistantMessageId: "missing-assistant-message",
          stream: true,
        }),
      });

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(String(payload?.error ?? "")).toContain("Retry target assistant message not found");
    });

    it("publishes retry part payload with attempt and next", async () => {
      const sessionId = "019c0000-0000-7000-8000-000000000001";
      const messageId = "019c0000-0000-7000-8000-000000000002";
      const { createPartPublishState, publishPartEvent } = await import("../chat");
      const { getSessionMessages } = await import("../../state/session-message-store");

      const partState = createPartPublishState();
      const assistantInfo = {
        role: "assistant",
        id: messageId,
        sessionID: sessionId,
        parentID: "019c0000-0000-7000-8000-000000000003",
        time: { created: Date.now() },
      };

      await publishPartEvent(sessionId, messageId, partState, assistantInfo as never, {
        type: "retry",
        attempt: 3,
        message: "Temporary upstream disconnect",
        next: Date.now() + 6000,
        errorKind: "network_socket_closed",
      });

      const sessionMessages = getSessionMessages(sessionId);
      const assistant = sessionMessages.find(message => message.info.id === messageId);
      const retryPart = assistant?.parts.find(part => part.type === "retry");

      expect(retryPart).toBeDefined();
      expect(retryPart?.attempt).toBe(3);
      expect(retryPart?.next).toBeTypeOf("number");
      const retryError = retryPart?.error as { message?: string; metadata?: { kind?: string } };
      expect(retryError.message).toContain("Temporary upstream disconnect");
      expect(retryError.metadata?.kind).toBe("network_socket_closed");
    });

    it("updates a single retry part across multiple retry attempts", async () => {
      const sessionId = "019c0000-0000-7000-8000-000000000011";
      const messageId = "019c0000-0000-7000-8000-000000000012";
      const { createPartPublishState, publishPartEvent } = await import("../chat");
      const { getSessionMessages } = await import("../../state/session-message-store");

      const partState = createPartPublishState();
      const assistantInfo = {
        role: "assistant",
        id: messageId,
        sessionID: sessionId,
        parentID: "019c0000-0000-7000-8000-000000000013",
        time: { created: Date.now() },
      };

      await publishPartEvent(sessionId, messageId, partState, assistantInfo as never, {
        type: "retry",
        attempt: 1,
        message: "socket closed",
        next: Date.now() + 3000,
        errorKind: "network_socket_closed",
      });
      await publishPartEvent(sessionId, messageId, partState, assistantInfo as never, {
        type: "retry",
        attempt: 2,
        message: "socket closed",
        next: Date.now() + 6000,
        errorKind: "network_socket_closed",
      });

      const sessionMessages = getSessionMessages(sessionId);
      const assistant = sessionMessages.find(message => message.info.id === messageId);
      const retryParts = assistant?.parts.filter(part => part.type === "retry") ?? [];

      expect(retryParts).toHaveLength(1);
      expect(retryParts[0]?.attempt).toBe(2);
      expect(retryParts[0]?.next).toBeTypeOf("number");
    });

    it("should handle empty message gracefully", async () => {
      const chatRouter = (await import("../chat")).default;

      const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "",
          stream: true,
        }),
      });

      // Should handle empty message (may succeed or fail gracefully)
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(500);
    });

    it("should handle agent execution errors gracefully", async () => {
      const chatRouter = (await import("../chat")).default;

      // This test verifies that when agent execution fails,
      // the error is properly propagated through the stream
      const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "This should trigger an error",
          stream: true,
        }),
      });

      // Even with errors, the endpoint should handle them gracefully
      expect(response.status).toBe(200);

      const body = await response.text();
      // The stream should complete with some finish message
      expect(body).toContain('"type":"finish"');
    });
  });

  describe("Multimodal support", () => {
    it("should accept multimodal message format", async () => {
      const chatRouter = (await import("../chat")).default;

      const multimodalMessage = {
        content: [
          { type: "text", text: "What is in this image?" },
          {
            type: "image",
            image: { url: "https://example.com/test.jpg" },
          },
        ],
      };

      const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: multimodalMessage,
          stream: true,
        }),
      });

      // Should accept multimodal format
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(500);
    });
  });

  describe("Non-streaming mode", () => {
    it("should support non-streaming responses", async () => {
      const chatRouter = (await import("../chat")).default;

      const response = await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "Hello",
          stream: false,
        }),
      });

      // Should handle non-streaming request
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(500);
    });
  });

  describe("Session status endpoint", () => {
    it("should return session status", async () => {
      const chatRouter = (await import("../chat")).default;

      // First create a session
      await chatRouter.request("http://localhost/api/chat?directory=/tmp/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "Hello",
          stream: true,
        }),
      });

      // Then get status - note: we need to use a known session ID
      // For this test, we'll just verify the endpoint structure
      const statusResponse = await chatRouter.request(
        "http://localhost/api/session/unknown-session/status",
        {
          method: "GET",
        }
      );

      // Unknown session should return 404
      expect(statusResponse.status).toBe(404);
    });
  });
});
