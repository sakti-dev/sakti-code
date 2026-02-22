/**
 * ChatProvider Tests
 */

import type { SaktiCodeApiClient } from "@/core/services/api/api-client";
import { render } from "@solidjs/testing-library";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/state/providers/store-provider", () => ({
  useMessageStore: () => [
    {},
    {
      getBySession: () => [],
      getById: () => undefined,
      remove: vi.fn(),
      upsert: vi.fn(),
    },
  ],
  usePartStore: () => [
    {},
    {
      getByMessage: () => [],
      getById: () => undefined,
      remove: vi.fn(),
      upsert: vi.fn(),
    },
  ],
  useSessionStore: () => [
    { sessions: {}, status: {} },
    {
      upsert: vi.fn(),
      setStatus: vi.fn(),
      clearStatus: vi.fn(),
      clearAllStatuses: vi.fn(),
      remove: vi.fn(),
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

describe("ChatProvider", () => {
  let mockClient: SaktiCodeApiClient;
  let mockChatFn: ReturnType<typeof vi.fn>;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);

    mockChatFn = vi.fn();
    mockClient = {
      chat: mockChatFn,
    } as unknown as SaktiCodeApiClient;
  });

  afterEach(() => {
    container.remove();
  });

  function successResponse(): Response {
    const headers = new Headers();
    headers.set("X-Session-ID", "019c4da0-fc0b-713c-984e-b2aca339c9bb");

    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers,
      body: {
        getReader: () => ({
          read: vi
            .fn()
            .mockResolvedValueOnce({ done: false, value: new Uint8Array() })
            .mockResolvedValueOnce({ done: true }),
          releaseLock: vi.fn(),
        }),
      },
    } as unknown as Response;
  }

  it("imports ChatProvider and useChatContext", async () => {
    const { ChatProvider, useChatContext } = await import("@/core/state/contexts/chat-provider");
    expect(ChatProvider).toBeInstanceOf(Function);
    expect(useChatContext).toBeInstanceOf(Function);
  });

  it("throws when useChatContext is called outside provider", async () => {
    const { useChatContext } = await import("@/core/state/contexts/chat-provider");

    expect(() => {
      createRoot(dispose => {
        useChatContext();
        dispose();
      });
    }).toThrow("useChatContext must be used within ChatProvider");
  });

  it("passes client to useChat and sends message", async () => {
    const { ChatProvider, useChatContext } = await import("@/core/state/contexts/chat-provider");
    mockChatFn.mockResolvedValue(successResponse());

    let capturedChat: { sendMessage: (text: string) => Promise<void> } | null = null;

    function TestChild() {
      const { chat } = useChatContext();
      capturedChat = chat;
      return null;
    }

    const { unmount: dispose } = render(() => (
      <ChatProvider client={mockClient} workspace={() => "/test"} sessionId={() => "session-123"}>
        <TestChild />
      </ChatProvider>
    ));

    expect(capturedChat).not.toBeNull();
    await capturedChat!.sendMessage("test");
    expect(mockChatFn).toHaveBeenCalledTimes(1);

    dispose();
  });

  it("wires callbacks into useChat", async () => {
    const { ChatProvider, useChatContext } = await import("@/core/state/contexts/chat-provider");
    mockChatFn.mockResolvedValue(successResponse());

    const onError = vi.fn();
    const onFinish = vi.fn();
    const onSessionIdReceived = vi.fn();

    let capturedChat: { sendMessage: (text: string) => Promise<void> } | null = null;

    function TestChild() {
      const { chat } = useChatContext();
      capturedChat = chat;
      return null;
    }

    const { unmount: dispose } = render(() => (
      <ChatProvider
        client={mockClient}
        workspace={() => "/test"}
        sessionId={() => "session-123"}
        onError={onError}
        onFinish={onFinish}
        onSessionIdReceived={onSessionIdReceived}
      >
        <TestChild />
      </ChatProvider>
    ));

    await capturedChat!.sendMessage("test");

    expect(onError).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledWith(expect.any(String));

    dispose();
  });
});
