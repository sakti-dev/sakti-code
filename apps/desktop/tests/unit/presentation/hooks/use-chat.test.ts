import type { EkacodeApiClient } from "@ekacode/desktop/lib/api-client";
import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MockTextPart = {
  id: string;
  type: "text";
  messageID: string;
  text: string;
};

const mockRemove = vi.fn();
const mockGetBySession = vi.fn(() => []);
const mockGetById = vi.fn();
const mockGetByMessage = vi.fn((_messageId: string): MockTextPart[] => []);
const mockWriteText = vi.fn().mockResolvedValue(undefined);

vi.mock("@renderer/presentation/providers/store-provider", () => ({
  useMessageStore: () => [
    {},
    {
      getBySession: mockGetBySession,
      getById: mockGetById,
      remove: mockRemove,
      upsert: vi.fn(),
    },
  ],
  usePartStore: () => [
    {},
    {
      getByMessage: mockGetByMessage,
      getById: vi.fn(),
      remove: vi.fn(),
      upsert: vi.fn(),
    },
  ],
}));

vi.mock("@ekacode/desktop/lib/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function okResponse(): Response {
  const headers = new Headers();
  headers.set("X-Session-ID", "019c4da0-fc0b-713c-984e-b2aca339c9aa");

  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers,
    body: {
      getReader: () => ({
        read: vi
          .fn()
          .mockResolvedValueOnce({ done: false, value: new Uint8Array([1]) })
          .mockResolvedValueOnce({ done: true }),
        releaseLock: vi.fn(),
      }),
    },
  } as unknown as Response;
}

describe("useChat", () => {
  let mockChatFn: ReturnType<typeof vi.fn>;
  let mockClient: EkacodeApiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText: mockWriteText },
      configurable: true,
    });
    mockChatFn = vi.fn();
    mockClient = { chat: mockChatFn } as unknown as EkacodeApiClient;
    mockGetBySession.mockReturnValue([]);
    mockGetById.mockReturnValue(undefined);
    mockGetByMessage.mockReturnValue([]);
  });

  it("sends messages with expected payload and completes streaming", async () => {
    const { useChat } = await import("@ekacode/desktop/presentation/hooks");
    mockChatFn.mockResolvedValue(okResponse());

    await createRoot(async dispose => {
      const onFinish = vi.fn();
      const chat = useChat({
        sessionId: () => "session-1",
        workspace: () => "/repo",
        client: mockClient,
        onFinish,
      });

      await chat.sendMessage("hello");

      expect(mockChatFn).toHaveBeenCalledWith(
        [{ id: expect.any(String), role: "user", parts: [{ type: "text", text: "hello" }] }],
        expect.objectContaining({
          sessionId: "session-1",
          workspace: "/repo",
          signal: expect.any(AbortSignal),
        })
      );
      expect(chat.streaming.status()).toBe("done");
      expect(onFinish).toHaveBeenCalledWith(expect.any(String));
      dispose();
    });
  });

  it("aborts in-flight requests when stop is called", async () => {
    const { useChat } = await import("@ekacode/desktop/presentation/hooks");
    mockChatFn.mockImplementation(
      (_messages: unknown, options: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        })
    );

    await createRoot(async dispose => {
      const chat = useChat({
        sessionId: () => "session-1",
        workspace: () => "/repo",
        client: mockClient,
      });

      const pending = chat.sendMessage("hello");
      await Promise.resolve();
      chat.stop();
      await pending;

      expect(chat.streaming.status()).toBe("idle");
      expect(chat.streaming.activeMessageId()).toBe(null);
      dispose();
    });
  });

  it("retries a user message by re-sending extracted text", async () => {
    const { useChat } = await import("@ekacode/desktop/presentation/hooks");
    mockGetById.mockReturnValue({
      id: "msg-user",
      role: "user",
      sessionID: "session-1",
    });
    mockGetByMessage.mockImplementation((messageId: string) =>
      messageId === "msg-user"
        ? [{ id: "p1", type: "text", messageID: "msg-user", text: "retry content" }]
        : []
    );
    mockChatFn.mockResolvedValue(okResponse());

    await createRoot(async dispose => {
      const chat = useChat({
        sessionId: () => "session-1",
        workspace: () => "/repo",
        client: mockClient,
      });

      await chat.retry("msg-user");

      expect(mockGetById).toHaveBeenCalledWith("msg-user");
      expect(mockGetByMessage).toHaveBeenCalledWith("msg-user");
      expect(mockChatFn).toHaveBeenCalledWith(
        [
          {
            id: expect.any(String),
            role: "user",
            parts: [{ type: "text", text: "retry content" }],
          },
        ],
        expect.objectContaining({ sessionId: "session-1" })
      );
      dispose();
    });
  });

  it("retries an assistant message via its parent user message", async () => {
    const { useChat } = await import("@ekacode/desktop/presentation/hooks");
    mockGetById.mockReturnValue({
      id: "msg-assistant",
      role: "assistant",
      parentID: "msg-user-parent",
      sessionID: "session-1",
    });
    mockGetByMessage.mockImplementation((messageId: string) =>
      messageId === "msg-user-parent"
        ? [{ id: "p2", type: "text", messageID: "msg-user-parent", text: "parent content" }]
        : []
    );
    mockChatFn.mockResolvedValue(okResponse());

    await createRoot(async dispose => {
      const chat = useChat({
        sessionId: () => "session-1",
        workspace: () => "/repo",
        client: mockClient,
      });

      await chat.retry("msg-assistant");

      expect(mockGetByMessage).toHaveBeenCalledWith("msg-user-parent");
      expect(chat.streaming.status()).toBe("done");
      dispose();
    });
  });

  it("uses store actions for copy/delete", async () => {
    const { useChat } = await import("@ekacode/desktop/presentation/hooks");
    mockGetByMessage.mockImplementation((messageId: string) =>
      messageId === "msg-1" ? [{ id: "p3", type: "text", messageID: "msg-1", text: "copy me" }] : []
    );

    await createRoot(async dispose => {
      const chat = useChat({
        sessionId: () => "session-1",
        workspace: () => "/repo",
        client: mockClient,
      });

      await chat.copy("msg-1");
      chat.delete("msg-2");

      expect(mockWriteText).toHaveBeenCalledWith("copy me");
      expect(mockRemove).toHaveBeenCalledWith("msg-2");
      dispose();
    });
  });
});
