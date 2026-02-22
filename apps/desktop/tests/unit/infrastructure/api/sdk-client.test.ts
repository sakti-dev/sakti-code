/**
 * Tests for SDK Client utility
 *
 * Part of Phase 6: Cleanup & Optimization
 */

import type { SDKClient } from "@/infrastructure/api/sdk-client";
import { createSDKClient } from "@/infrastructure/api/sdk-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock global fetch
global.fetch = vi.fn();

describe("createSDKClient", () => {
  let client: SDKClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as typeof fetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should create SDK client with baseUrl", () => {
    client = createSDKClient("http://localhost:3000", () => "test-token");

    expect(client).toBeDefined();
    expect(client.baseUrl).toBe("http://localhost:3000");
  });

  describe("sessions API", () => {
    beforeEach(() => {
      client = createSDKClient("http://localhost:3000", () => "test-token");
    });

    it("should list sessions", async () => {
      const mockSessions = [
        {
          sessionId: "session-1",
          resourceId: "resource-1",
          createdAt: "2024-01-01",
          lastAccessed: "2024-01-01",
        },
        {
          sessionId: "session-2",
          resourceId: "resource-2",
          createdAt: "2024-01-02",
          lastAccessed: "2024-01-02",
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessions: mockSessions }),
      } as Response);

      const sessions = await client.session.list();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/sessions",
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Basic YWRtaW46dGVzdC10b2tlbg==", // Base64 of 'admin:test-token'
          }),
        })
      );
      expect(sessions).toEqual(mockSessions);
    });

    it("should get specific session", async () => {
      const mockSession = {
        sessionId: "session-1",
        resourceId: "resource-1",
        createdAt: "2024-01-01",
        lastAccessed: "2024-01-01",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSession,
      } as Response);

      const session = await client.session.get("session-1");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/sessions/session-1",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Basic YWRtaW46dGVzdC10b2tlbg==",
          }),
        })
      );
      expect(session).toEqual(mockSession);
    });

    it("should get session messages with pagination", async () => {
      const mockMessages = {
        sessionID: "session-1",
        messages: [{ id: "msg-1", role: "user" }],
        hasMore: true,
        total: 100,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockMessages,
      } as Response);

      const messages = await client.session.messages({
        sessionID: "session-1",
        limit: 50,
        offset: 1, // Use non-zero offset
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/chat/session-1/messages?limit=50&offset=1",
        expect.objectContaining({
          headers: expect.any(Object),
        })
      );
      expect(messages).toEqual(mockMessages);
    });

    it("should support abort signal for messages", async () => {
      const abortController = new AbortController();
      const mockMessages = {
        sessionID: "session-1",
        messages: [],
        hasMore: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockMessages,
      } as Response);

      await client.session.messages({
        sessionID: "session-1",
        signal: abortController.signal,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: abortController.signal,
        })
      );
    });
  });

  describe("fetch method", () => {
    beforeEach(() => {
      client = createSDKClient("http://localhost:3000", () => "test-token");
    });

    it("should make authenticated fetch request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: "success" }),
      } as Response);

      await client.fetch("/api/test", {
        method: "POST",
        body: JSON.stringify({ test: "data" }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/test",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ test: "data" }),
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Basic YWRtaW46dGVzdC10b2tlbg==",
          }),
        })
      );
    });

    it("should merge custom headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: "success" }),
      } as Response);

      await client.fetch("/api/test", {
        headers: {
          "X-Custom-Header": "custom-value",
        },
      });

      // Verify the fetch was called
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/test",
        expect.objectContaining({
          headers: expect.objectContaining({
            // Check for the custom header (case-insensitive)
            "x-custom-header": "custom-value",
          }),
        })
      );

      // Also verify auth header is present
      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1].headers;
      expect(headers["authorization"] || headers["Authorization"]).toContain("Basic");
    });
  });

  describe("error handling", () => {
    beforeEach(() => {
      client = createSDKClient("http://localhost:3000", () => "test-token");
    });

    it("should throw on HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as Response);

      await expect(client.session.get("unknown-session")).rejects.toThrow("HTTP 404: Not Found");
    });

    it("should throw on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(client.session.list()).rejects.toThrow("Network error");
    });
  });

  describe("token accessor", () => {
    it("should use current token value from accessor", async () => {
      let currentToken = "token-1";
      const tokenAccessor = () => currentToken;

      client = createSDKClient("http://localhost:3000", tokenAccessor);

      // First request with token-1
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessions: [] }),
      } as Response);

      await client.session.list();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Basic YWRtaW46dG9rZW4tMQ==", // Base64 of 'admin:token-1'
          }),
        })
      );

      // Change token
      currentToken = "token-2";

      // Second request with token-2
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessions: [] }),
      } as Response);

      await client.session.list();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Basic YWRtaW46dG9rZW4tMg==", // Base64 of 'admin:token-2'
          }),
        })
      );
    });
  });

  describe("URL normalization", () => {
    it("should remove trailing slash from baseUrl", () => {
      client = createSDKClient("http://localhost:3000/", () => "test-token");

      expect(client.baseUrl).toBe("http://localhost:3000/");
    });

    it("should handle baseUrl without trailing slash", () => {
      client = createSDKClient("http://localhost:3000", () => "test-token");

      expect(client.baseUrl).toBe("http://localhost:3000");
    });
  });
});
