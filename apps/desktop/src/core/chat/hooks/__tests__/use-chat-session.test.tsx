/**
 * useChat Session Identity Tests
 *
 * Tests for server-authoritative session creation and identity consistency.
 * These tests verify that the client waits for the server to create sessions
 * and handles session ID mismatches correctly.
 */

import type { SaktiCodeApiClient } from "@/core/services/api/api-client";
import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock stores
const mockRemove = vi.fn();
const mockGetBySession = vi.fn(() => []);
const mockGetById = vi.fn();
const mockGetByMessage = vi.fn(() => []);
const mockUpsertMessage = vi.fn();
const mockUpsertPart = vi.fn();
const mockUpsertSession = vi.fn();
const mockGetSessionByDirectory = vi.fn(() => []);
const mockGetSessionById = vi.fn();

vi.mock("@/core/state/providers/store-provider", () => ({
  useMessageStore: () => [
    {},
    {
      getBySession: mockGetBySession,
      getById: mockGetById,
      remove: mockRemove,
      upsert: mockUpsertMessage,
    },
  ],
  usePartStore: () => [
    {},
    {
      getByMessage: mockGetByMessage,
      getById: vi.fn(),
      remove: vi.fn(),
      upsert: mockUpsertPart,
    },
  ],
  useSessionStore: () => [
    { sessions: {}, status: {} },
    {
      upsert: mockUpsertSession,
      setStatus: vi.fn(),
      clearStatus: vi.fn(),
      clearAllStatuses: vi.fn(),
      remove: vi.fn(),
      getByDirectory: mockGetSessionByDirectory,
      getById: mockGetSessionById,
    },
  ],
}));

vi.mock("@/core/shared/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function createMockResponse(overrides?: Partial<Response> & { sessionId?: string }): Response {
  const headers = new Headers(overrides?.headers);
  if (overrides?.sessionId) {
    headers.set("X-Session-ID", overrides.sessionId);
  }

  // Create a proper ReadableStream for the body
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
      controller.close();
    },
  });

  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers,
    body: stream,
    ...overrides,
  } as unknown as Response;
}

describe("useChat - Session Identity", () => {
  let mockChatFn: ReturnType<typeof vi.fn>;
  let mockClient: SaktiCodeApiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockChatFn = vi.fn();
    mockClient = { chat: mockChatFn } as unknown as SaktiCodeApiClient;
    mockGetBySession.mockReturnValue([]);
    mockGetById.mockReturnValue(undefined);
    mockGetByMessage.mockReturnValue([]);
    mockGetSessionByDirectory.mockReturnValue([]);
    mockGetSessionById.mockReturnValue(undefined);
  });

  describe("Server-Authoritative Session Creation", () => {
    it("does NOT generate session ID optimistically when no session exists", async () => {
      const { useChat } = await import("@/core/chat/hooks");
      const serverSessionId = "019c4da0-fc0b-713c-984e-b2aca339c97b"; // Valid UUIDv7

      mockChatFn.mockResolvedValue(createMockResponse({ sessionId: serverSessionId }));

      await createRoot(async dispose => {
        const chat = useChat({
          sessionId: () => null, // No existing session
          workspace: () => "/repo",
          client: mockClient,
        });

        // Before sending, no session should exist
        expect(chat.sessionId()).toBeNull();

        await chat.sendMessage("hello");

        // After sending, should have server-provided session
        expect(chat.sessionId()).toBe(serverSessionId);

        // Verify client did not generate its own session ID
        const callArgs = mockChatFn.mock.calls[0];
        const options = callArgs[1];
        // Should either not have sessionId or have null/undefined
        expect(options?.sessionId === null || options?.sessionId === undefined).toBe(true);

        dispose();
      });
    });

    it("sends request without X-Session-ID when no session exists", async () => {
      const { useChat } = await import("@/core/chat/hooks");

      mockChatFn.mockResolvedValue(
        createMockResponse({ sessionId: "019c4da0-fc0b-713c-984e-b2aca339c982" })
      );

      await createRoot(async dispose => {
        const chat = useChat({
          sessionId: () => null,
          workspace: () => "/repo",
          client: mockClient,
        });

        await chat.sendMessage("hello");

        // Verify the client sent the request
        const callArgs = mockChatFn.mock.calls[0];
        expect(callArgs[0]).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ role: "user", parts: [{ type: "text", text: "hello" }] }),
          ])
        );
        expect(callArgs[1]).toMatchObject({
          workspace: "/repo",
        });
        // sessionId should be null or undefined
        expect(callArgs[1].sessionId === null || callArgs[1].sessionId === undefined).toBe(true);

        dispose();
      });
    });

    it("creates optimistic message only after receiving session ID from server", async () => {
      const { useChat } = await import("@/core/chat/hooks");
      const serverSessionId = "019c4da0-fc0b-713c-984e-b2aca339c981"; // Valid UUIDv7

      let resolveResponse: (value: Response) => void;
      const responsePromise = new Promise<Response>(resolve => {
        resolveResponse = resolve;
      });

      mockChatFn.mockReturnValue(responsePromise);

      await createRoot(async dispose => {
        const chat = useChat({
          sessionId: () => null,
          workspace: () => "/repo",
          client: mockClient,
        });

        // Start sending message but don't await yet
        const sendPromise = chat.sendMessage("hello");

        // Verify no optimistic message created before server responds
        expect(mockUpsertMessage).not.toHaveBeenCalled();

        // Now resolve the response
        resolveResponse(createMockResponse({ sessionId: serverSessionId }));
        await sendPromise;

        // After server responds, optimistic message should be created
        expect(mockUpsertMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            role: "user",
            sessionID: serverSessionId,
          })
        );

        dispose();
      });
    });

    it("shows loading state while creating session", async () => {
      const { useChat } = await import("@/core/chat/hooks");

      let resolveResponse: (value: Response) => void;
      const responsePromise = new Promise<Response>(resolve => {
        resolveResponse = resolve;
      });

      mockChatFn.mockReturnValue(responsePromise);

      await createRoot(async dispose => {
        const chat = useChat({
          sessionId: () => null,
          workspace: () => "/repo",
          client: mockClient,
        });

        // Should be able to check if creating session
        const sendPromise = chat.sendMessage("hello");

        // During the request, should be in creating state
        // Note: This depends on implementation exposing isCreatingSession

        // Resolve the response
        resolveResponse(createMockResponse({ sessionId: "019c4da0-fc0b-713c-984e-b2aca339c983" }));
        await sendPromise;

        dispose();
      });
    });

    it("handles server returning different session ID than expected", async () => {
      const { useChat } = await import("@/core/chat/hooks");
      const onSessionIdReceived = vi.fn();
      const serverSessionId = "019c4da0-fc0b-713c-984e-b2aca339c97c"; // Valid UUIDv7

      mockChatFn.mockResolvedValue(createMockResponse({ sessionId: serverSessionId }));

      await createRoot(async dispose => {
        const chat = useChat({
          sessionId: () => null,
          workspace: () => "/repo",
          client: mockClient,
          onSessionIdReceived,
        });

        await chat.sendMessage("hello");

        // Should update to server-provided session ID
        expect(chat.sessionId()).toBe(serverSessionId);
        expect(onSessionIdReceived).toHaveBeenCalledWith(serverSessionId);

        dispose();
      });
    });

    it("migrates optimistic messages to correct server session ID", async () => {
      const { useChat } = await import("@/core/chat/hooks");
      const serverSessionId = "019c4da0-fc0b-713c-984e-b2aca339c97d"; // Valid UUIDv7

      mockChatFn.mockResolvedValue(createMockResponse({ sessionId: serverSessionId }));

      await createRoot(async dispose => {
        const chat = useChat({
          sessionId: () => null,
          workspace: () => "/repo",
          client: mockClient,
        });

        await chat.sendMessage("hello");

        // Verify message was created with server session ID
        const upsertCalls = mockUpsertMessage.mock.calls;
        const lastCall = upsertCalls[upsertCalls.length - 1];
        expect(lastCall[0].sessionID).toBe(serverSessionId);

        dispose();
      });
    });
  });

  describe("Session ID Validation", () => {
    it("rejects malformed session ID from server", async () => {
      const { useChat } = await import("@/core/chat/hooks");
      const onError = vi.fn();

      // Server returns invalid session ID (not UUIDv7 format)
      mockChatFn.mockResolvedValue(createMockResponse({ sessionId: "invalid-session-id" }));

      await createRoot(async dispose => {
        const chat = useChat({
          sessionId: () => null,
          workspace: () => "/repo",
          client: mockClient,
          onError,
        });

        await chat.sendMessage("hello");

        // Should call error handler with validation error
        expect(onError).toHaveBeenCalled();
        const errorArg = onError.mock.calls[0][0];
        expect(errorArg.message).toContain("Invalid session ID");

        dispose();
      });
    });

    it("continues without error when X-Session-ID is missing for new session", async () => {
      const { useChat } = await import("@/core/chat/hooks");
      const onError = vi.fn();

      // Response without session header
      mockChatFn.mockResolvedValue(createMockResponse());

      await createRoot(async dispose => {
        const chat = useChat({
          sessionId: () => null,
          workspace: () => "/repo",
          client: mockClient,
          onError,
        });

        await chat.sendMessage("hello");

        // Should not hard-fail; SSE/session sync can provide authoritative session later.
        expect(onError).not.toHaveBeenCalled();
        expect(chat.streaming.status()).toBe("done");

        dispose();
      });
    });
  });

  describe("Error Handling", () => {
    it("shows error when session creation fails", async () => {
      const { useChat } = await import("@/core/chat/hooks");
      const onError = vi.fn();

      mockChatFn.mockRejectedValue(new Error("Server error"));

      await createRoot(async dispose => {
        const chat = useChat({
          sessionId: () => null,
          workspace: () => "/repo",
          client: mockClient,
          onError,
        });

        await chat.sendMessage("hello");

        expect(onError).toHaveBeenCalledWith(expect.any(Error));
        expect(chat.streaming.status()).toBe("error");

        dispose();
      });
    });

    it("clears optimistic state on session error", async () => {
      const { useChat } = await import("@/core/chat/hooks");

      mockChatFn.mockRejectedValue(new Error("Server error"));

      await createRoot(async dispose => {
        const chat = useChat({
          sessionId: () => null,
          workspace: () => "/repo",
          client: mockClient,
        });

        await chat.sendMessage("hello");

        // Should not have created any messages
        expect(mockUpsertMessage).not.toHaveBeenCalled();

        dispose();
      });
    });

    it("allows retry after session creation failure", async () => {
      const { useChat } = await import("@/core/chat/hooks");

      mockChatFn
        .mockRejectedValueOnce(new Error("Server error"))
        .mockResolvedValueOnce(
          createMockResponse({ sessionId: "019c4da0-fc0b-713c-984e-b2aca339c97e" })
        ); // Valid UUIDv7

      await createRoot(async dispose => {
        const chat = useChat({
          sessionId: () => null,
          workspace: () => "/repo",
          client: mockClient,
        });

        // First attempt fails
        await chat.sendMessage("hello");
        expect(chat.streaming.status()).toBe("error");

        // Second attempt succeeds
        await chat.sendMessage("hello again");
        expect(chat.sessionId()).toBe("019c4da0-fc0b-713c-984e-b2aca339c97e");

        dispose();
      });
    });
  });

  describe("Race Conditions", () => {
    it("handles rapid double-click on send button", async () => {
      const { useChat } = await import("@/core/chat/hooks");
      const serverSessionId = "019c4da0-fc0b-713c-984e-b2aca339c97f"; // Valid UUIDv7

      let callCount = 0;
      mockChatFn.mockImplementation(async () => {
        callCount++;
        await new Promise(resolve => setTimeout(resolve, 100));
        return createMockResponse({ sessionId: serverSessionId });
      });

      await createRoot(async dispose => {
        const chat = useChat({
          sessionId: () => null,
          workspace: () => "/repo",
          client: mockClient,
        });

        // Rapid double send
        const promise1 = chat.sendMessage("first");
        const promise2 = chat.sendMessage("second");

        await Promise.all([promise1, promise2]);

        // Should only create one session
        expect(callCount).toBe(1);
        expect(chat.sessionId()).toBe(serverSessionId);

        dispose();
      });
    });

    it("prevents concurrent session creation requests", async () => {
      const { useChat } = await import("@/core/chat/hooks");

      mockChatFn.mockResolvedValue(
        createMockResponse({ sessionId: "019c4da0-fc0b-713c-984e-b2aca339c980" })
      ); // Valid UUIDv7

      await createRoot(async dispose => {
        const chat = useChat({
          sessionId: () => null,
          workspace: () => "/repo",
          client: mockClient,
        });

        // Try to send multiple messages rapidly
        const promises = [
          chat.sendMessage("msg1"),
          chat.sendMessage("msg2"),
          chat.sendMessage("msg3"),
        ];

        await Promise.all(promises);

        // Should only make one API call for session creation
        expect(mockChatFn).toHaveBeenCalledTimes(1);

        dispose();
      });
    });
  });
});
