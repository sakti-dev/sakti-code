import { SaktiCodeApiClient } from "@/core/services/api/api-client";
import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MockTextPart = {
  id: string;
  type: "text";
  messageID: string;
  text: string;
  sessionID?: string;
  metadata?: {
    optimistic?: boolean;
    optimisticSource?: string;
    correlationKey?: string;
    timestamp?: number;
  };
};

type MockSessionInfo = {
  sessionID: string;
  directory: string;
};

type MockMessageEntry = {
  id: string;
  role: "user" | "assistant" | "system";
  sessionID?: string;
  metadata?: {
    optimistic?: boolean;
    optimisticSource?: string;
    correlationKey?: string;
    timestamp?: number;
  };
};

const mockRemove = vi.fn();
const mockPartRemove = vi.fn();
const mockGetBySession = vi.fn<(sessionId: string) => MockMessageEntry[]>(() => []);
const mockGetById = vi.fn();
const mockGetByMessage = vi.fn((messageId: string): MockTextPart[] => {
  void messageId;
  return [];
});
const mockPartGetById = vi.fn();
const mockSessionUpsert = vi.fn();
const mockSessionGetByDirectory = vi.fn<(directory: string) => MockSessionInfo[]>(() => []);
const mockSessionGetById = vi.fn();
const mockMessageUpsert = vi.fn();
const mockPartUpsert = vi.fn();
const mockWriteText = vi.fn().mockResolvedValue(undefined);

vi.mock("@/core/state/providers/store-provider", () => ({
  useMessageStore: () => [
    {},
    {
      getBySession: mockGetBySession,
      getById: mockGetById,
      remove: mockRemove,
      upsert: mockMessageUpsert,
    },
  ],
  usePartStore: () => [
    {},
    {
      getByMessage: mockGetByMessage,
      getById: mockPartGetById,
      remove: mockPartRemove,
      upsert: mockPartUpsert,
    },
  ],
  useSessionStore: () => [
    { sessions: {}, status: {} },
    {
      upsert: mockSessionUpsert,
      setStatus: vi.fn(),
      clearStatus: vi.fn(),
      clearAllStatuses: vi.fn(),
      remove: vi.fn(),
      getByDirectory: mockSessionGetByDirectory,
      getById: mockSessionGetById,
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

function okResponse(): Response {
  const headers = new Headers();
  headers.set("X-Task-Session-ID", "019c4da0-fc0b-713c-984e-b2aca339c9aa");
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    statusText: "OK",
    headers,
  });
}

function streamResponse(
  lines: string[],
  sessionId = "019c4da0-fc0b-713c-984e-b2aca339c9aa"
): Response {
  const headers = new Headers();
  headers.set("X-Task-Session-ID", sessionId);
  const bodyText = lines.join("\n");
  const encoded = new TextEncoder().encode(bodyText);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    statusText: "OK",
    headers,
  });
}

describe("useChat", () => {
  let mockChatFn: ReturnType<typeof vi.fn>;
  let mockClient: SaktiCodeApiClient;
  let messagesById: Map<string, { id: string; role?: string; sessionID?: string }>;
  let partsById: Map<string, MockTextPart>;

  beforeEach(() => {
    vi.clearAllMocks();
    messagesById = new Map();
    partsById = new Map();
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText: mockWriteText },
      configurable: true,
    });
    mockClient = new SaktiCodeApiClient({ baseUrl: "http://localhost:3000", token: "test-token" });
    mockChatFn = vi.spyOn(mockClient, "chat");
    mockGetBySession.mockReturnValue([]);
    mockGetById.mockImplementation((id: string) => messagesById.get(id));
    mockGetByMessage.mockReturnValue([]);
    mockSessionGetByDirectory.mockReturnValue([]);
    mockSessionGetById.mockReturnValue(undefined);
    mockMessageUpsert.mockReset();
    mockMessageUpsert.mockImplementation(message => {
      if (message?.id && typeof message.id === "string") {
        messagesById.set(message.id, message as { id: string; role?: string; sessionID?: string });
      }
    });
    mockPartUpsert.mockReset();
    mockPartUpsert.mockImplementation(part => {
      if (part?.id && typeof part.id === "string") {
        partsById.set(part.id, part as MockTextPart);
      }
    });
    mockPartRemove.mockReset();
    mockPartGetById.mockReset();
    mockPartGetById.mockImplementation((id: string) => partsById.get(id));
  });

  it("sends messages with expected payload and completes streaming", async () => {
    const { useChat } = await import("@/core/chat/hooks");
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

  it("forwards selected provider and model to chat client", async () => {
    const { useChat } = await import("@/core/chat/hooks");
    mockChatFn.mockResolvedValue(okResponse());

    await createRoot(async dispose => {
      const chat = useChat({
        sessionId: () => "session-1",
        workspace: () => "/repo",
        client: mockClient,
        providerId: () => "zai",
        modelId: () => "zai/glm-4.7",
      });

      await chat.sendMessage("hello");

      expect(mockChatFn).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          providerId: "zai",
          modelId: "zai/glm-4.7",
        })
      );

      dispose();
    });
  });

  it("aborts in-flight requests when stop is called", async () => {
    const { useChat } = await import("@/core/chat/hooks");
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
    const { useChat } = await import("@/core/chat/hooks");
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
        expect.objectContaining({
          sessionId: "session-1",
          retryOfAssistantMessageId: undefined,
        })
      );
      dispose();
    });
  });

  it("retries an assistant message via its parent user message", async () => {
    const { useChat } = await import("@/core/chat/hooks");
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
      expect(mockChatFn).toHaveBeenCalledWith(
        [
          {
            id: "msg-user-parent",
            role: "user",
            parts: [{ type: "text", text: "parent content" }],
          },
        ],
        expect.objectContaining({
          sessionId: "session-1",
          messageId: "msg-user-parent",
          retryOfAssistantMessageId: "msg-assistant",
        })
      );
      expect(chat.streaming.status()).toBe("done");
      dispose();
    });
  });

  it("uses store actions for copy/delete", async () => {
    const { useChat } = await import("@/core/chat/hooks");
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

  it("does not fail when server omits X-Task-Session-ID for new session", async () => {
    const { useChat } = await import("@/core/chat/hooks");
    const responseWithoutHeader = {
      response: new Response(null, { status: 200, headers: new Headers() }),
    };
    mockChatFn.mockResolvedValue(responseWithoutHeader.response);

    await createRoot(async dispose => {
      const onError = vi.fn();
      const chat = useChat({
        sessionId: () => null,
        workspace: () => "/repo",
        client: mockClient,
        onError,
      });

      await chat.sendMessage("hello");

      expect(chat.streaming.status()).toBe("done");
      expect(onError).not.toHaveBeenCalled();
      dispose();
    });
  });

  it("adopts discovered session from session store when header is missing", async () => {
    const { useChat } = await import("@/core/chat/hooks");
    const discoveredSessionId = "019c4da0-fc0b-713c-984e-b2aca339c9ab";
    mockSessionGetByDirectory.mockReturnValue([
      { sessionID: discoveredSessionId, directory: "/repo" },
    ]);
    mockChatFn.mockResolvedValue(new Response(null, { status: 200, headers: new Headers() }));

    await createRoot(async dispose => {
      const onSessionIdReceived = vi.fn();
      const chat = useChat({
        sessionId: () => null,
        workspace: () => "/repo",
        client: mockClient,
        onSessionIdReceived,
      });

      await chat.sendMessage("hello");

      expect(chat.sessionId()).toBe(discoveredSessionId);
      expect(onSessionIdReceived).toHaveBeenCalledWith(discoveredSessionId);
      expect(mockMessageUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ role: "user", sessionID: discoveredSessionId })
      );
      dispose();
    });
  });

  it("routes data-thought and tool events to assistant message parts", async () => {
    const { useChat } = await import("@/core/chat/hooks");
    mockChatFn.mockResolvedValue(
      streamResponse([
        'data: {"type":"data-thought","id":"reason-1","data":{"text":"Analyzing","status":"thinking"}}',
        'data: {"type":"data-tool-call","id":"call-1","data":{"toolCallId":"call-1","toolName":"read_file","args":{"path":"README.md"}}}',
        'data: {"type":"data-tool-result","id":"call-1","data":{"toolCallId":"call-1","result":"ok"}}',
        'data: {"type":"text-delta","id":"assistant-1","delta":"Final answer"}',
        'data: {"type":"finish","finishReason":"stop"}',
      ])
    );

    await createRoot(async dispose => {
      const chat = useChat({
        sessionId: () => "019c4da0-fc0b-713c-984e-b2aca339c9aa",
        workspace: () => "/repo",
        client: mockClient,
      });

      await chat.sendMessage("hello");

      const assistantMessageCall = mockMessageUpsert.mock.calls.find(
        call => call[0]?.role === "assistant"
      );
      expect(assistantMessageCall).toBeTruthy();
      const assistantMessageId = assistantMessageCall?.[0]?.id as string;

      const reasoningCall = mockPartUpsert.mock.calls.find(
        call => call[0]?.type === "reasoning" && call[0]?.id === "reason-1-thought"
      );
      expect(reasoningCall?.[0]).toMatchObject({
        messageID: assistantMessageId,
        text: "Analyzing",
      });

      const toolCallPart = mockPartUpsert.mock.calls.find(call => call[0]?.id === "call-1-tool");
      expect(toolCallPart?.[0]).toMatchObject({
        type: "tool",
        messageID: assistantMessageId,
      });
      expect(chat.streaming.status()).toBe("done");
      dispose();
    });
  });

  it("coalesces repeated reasoning deltas for the same part id", async () => {
    const { useChat } = await import("@/core/chat/hooks");
    mockChatFn.mockResolvedValue(
      streamResponse([
        'data: {"type":"data-thought","id":"reason-1","data":{"text":"A","status":"thinking"}}',
        'data: {"type":"data-thought","id":"reason-1","data":{"text":"AB","status":"thinking"}}',
        'data: {"type":"data-thought","id":"reason-1","data":{"text":"ABC","status":"thinking"}}',
        'data: {"type":"finish","finishReason":"stop"}',
      ])
    );

    await createRoot(async dispose => {
      const chat = useChat({
        sessionId: () => "019c4da0-fc0b-713c-984e-b2aca339c9aa",
        workspace: () => "/repo",
        client: mockClient,
      });

      await chat.sendMessage("hello");

      const reasoningCalls = mockPartUpsert.mock.calls.filter(
        call => call[0]?.type === "reasoning" && call[0]?.id === "reason-1-thought"
      );
      expect(reasoningCalls).toHaveLength(1);
      expect(reasoningCalls[0]?.[0]).toMatchObject({
        text: "ABC",
      });
      dispose();
    });
  });

  it("skips optimistic reasoning updates when canonical SSE part already exists", async () => {
    const { useChat } = await import("@/core/chat/hooks");
    mockPartGetById.mockImplementation((id: string) => {
      if (id !== "reason-1-thought") return undefined;
      return {
        id: "reason-1-thought",
        type: "reasoning",
        messageID: "assistant-1",
        sessionID: "019c4da0-fc0b-713c-984e-b2aca339c9aa",
        text: "canonical thought",
        metadata: {
          __eventSequence: 100,
          __eventTimestamp: Date.now(),
        },
      };
    });
    mockChatFn.mockResolvedValue(
      streamResponse([
        'data: {"type":"data-thought","id":"reason-1","data":{"text":"A","status":"thinking"}}',
        'data: {"type":"data-thought","id":"reason-1","data":{"text":"AB","status":"thinking"}}',
        'data: {"type":"finish","finishReason":"stop"}',
      ])
    );

    await createRoot(async dispose => {
      const chat = useChat({
        sessionId: () => "019c4da0-fc0b-713c-984e-b2aca339c9aa",
        workspace: () => "/repo",
        client: mockClient,
      });

      await chat.sendMessage("hello");

      const reasoningCalls = mockPartUpsert.mock.calls.filter(
        call => call[0]?.type === "reasoning" && call[0]?.id === "reason-1-thought"
      );
      expect(reasoningCalls).toHaveLength(0);
      dispose();
    });
  });

  it("backfills user message when session resolves during stream", async () => {
    const { useChat } = await import("@/core/chat/hooks");
    const lateSessionId = "019c4da0-fc0b-713c-984e-b2aca339c9ac";
    let lookupCount = 0;
    mockSessionGetByDirectory.mockImplementation(() => {
      lookupCount += 1;
      return lookupCount >= 2 ? [{ sessionID: lateSessionId, directory: "/repo" }] : [];
    });
    mockChatFn.mockResolvedValue(
      streamResponse(
        [
          'data: {"type":"text-delta","id":"assistant-late","delta":"Hello"}',
          'data: {"type":"finish","finishReason":"stop"}',
        ],
        ""
      )
    );

    await createRoot(async dispose => {
      const chat = useChat({
        sessionId: () => null,
        workspace: () => "/repo",
        client: mockClient,
      });

      await chat.sendMessage("hello");

      const userMessageCall = mockMessageUpsert.mock.calls.find(
        call => call[0]?.role === "user" && call[0]?.sessionID === lateSessionId
      );
      expect(userMessageCall).toBeTruthy();
      expect(chat.sessionId()).toBe(lateSessionId);
      dispose();
    });
  });

  it("does not overwrite canonical user entities with optimistic metadata when they already exist", async () => {
    const { useChat } = await import("@/core/chat/hooks");
    const sessionId = "019c4da0-fc0b-713c-984e-b2aca339c9aa";
    let userMessageId = "";

    mockChatFn.mockImplementation(async (messages: Array<{ id: string; role: string }>) => {
      userMessageId = messages[0]?.id ?? "";
      const userTextPartId = `${userMessageId}-text`;
      messagesById.set(userMessageId, {
        id: userMessageId,
        role: "user",
        sessionID: sessionId,
      });
      partsById.set(userTextPartId, {
        id: userTextPartId,
        type: "text",
        messageID: userMessageId,
        text: "hello",
        sessionID: sessionId,
      });
      return streamResponse(['data: {"type":"finish","finishReason":"stop"}'], sessionId);
    });

    await createRoot(async dispose => {
      const chat = useChat({
        sessionId: () => sessionId,
        workspace: () => "/repo",
        client: mockClient,
      });

      await chat.sendMessage("hello");

      const userMessageOptimisticCall = mockMessageUpsert.mock.calls.find(call => {
        const message = call[0] as {
          id?: string;
          role?: string;
          metadata?: { optimistic?: boolean };
        };
        return (
          message.id === userMessageId &&
          message.role === "user" &&
          message.metadata?.optimistic === true
        );
      });
      const userPartOptimisticCall = mockPartUpsert.mock.calls.find(call => {
        const part = call[0] as {
          id?: string;
          messageID?: string;
          metadata?: { optimistic?: boolean };
        };
        return (
          part.id === `${userMessageId}-text` &&
          part.messageID === userMessageId &&
          part.metadata?.optimistic === true
        );
      });

      expect(userMessageOptimisticCall).toBeUndefined();
      expect(userPartOptimisticCall).toBeUndefined();
      dispose();
    });
  });

  it("cleans optimistic artifacts immediately when stop is called", async () => {
    const { useChat } = await import("@/core/chat/hooks");
    const sessionId = "019c4da0-fc0b-713c-984e-b2aca339c9ae";
    const optimisticMessageId = "019c4da0-fc0b-713c-984e-b2aca339c9af";
    const optimisticPartId = `${optimisticMessageId}-text`;
    const staleTimestamp = Date.now() - 50;

    mockGetBySession.mockReturnValue([
      {
        id: optimisticMessageId,
        role: "assistant",
        sessionID: sessionId,
        metadata: {
          optimistic: true,
          optimisticSource: "useChat",
          correlationKey: "msg:assistant:no-parent:1",
          timestamp: staleTimestamp,
        },
      },
    ]);
    mockGetByMessage.mockImplementation((messageId: string) =>
      messageId === optimisticMessageId
        ? [
            {
              id: optimisticPartId,
              type: "text",
              messageID: optimisticMessageId,
              text: "optimistic text",
              metadata: {
                optimistic: true,
                optimisticSource: "useChat",
                correlationKey: `part:${optimisticMessageId}:text:default`,
                timestamp: staleTimestamp,
              },
            } as MockTextPart,
          ]
        : []
    );
    mockPartGetById.mockReturnValue({
      id: optimisticPartId,
      messageID: optimisticMessageId,
    });

    await createRoot(async dispose => {
      const chat = useChat({
        sessionId: () => sessionId,
        workspace: () => "/repo",
        client: mockClient,
      });

      chat.stop();

      expect(mockPartRemove).toHaveBeenCalledWith(optimisticPartId, optimisticMessageId);
      expect(mockRemove).toHaveBeenCalledWith(optimisticMessageId);
      dispose();
    });
  });

  it("defers assistant part upserts when parent message lookup is not yet available", async () => {
    const { useChat } = await import("@/core/chat/hooks");
    const visibleMessageIds = new Set<string>();

    mockMessageUpsert.mockImplementation(message => {
      if (message?.role === "user" && typeof message.id === "string") {
        visibleMessageIds.add(message.id);
      }
    });
    mockGetById.mockImplementation((id: string) =>
      visibleMessageIds.has(id) ? { id, role: "user", sessionID: "session-1" } : undefined
    );
    mockPartUpsert.mockImplementation(part => {
      if (!mockGetById(part?.messageID)) {
        throw new Error(`Cannot add part ${part?.id}: message ${part?.messageID} not found`);
      }
    });
    mockChatFn.mockResolvedValue(
      streamResponse([
        'data: {"type":"data-thought","id":"reason-1","data":{"text":"Thinking","status":"thinking"}}',
        'data: {"type":"text-delta","id":"assistant-missing","delta":"Final answer"}',
        'data: {"type":"finish","finishReason":"stop"}',
      ])
    );

    await createRoot(async dispose => {
      const chat = useChat({
        sessionId: () => "session-1",
        workspace: () => "/repo",
        client: mockClient,
      });

      await expect(chat.sendMessage("hello")).resolves.toBeUndefined();
      expect(chat.streaming.status()).toBe("done");

      const assistantPartCalls = mockPartUpsert.mock.calls.filter(
        call => call[0]?.messageID === "assistant-missing"
      );
      expect(assistantPartCalls).toHaveLength(0);
      dispose();
    });
  });

  it("coalesces high-volume text deltas into a single text part upsert", async () => {
    const { useChat } = await import("@/core/chat/hooks");
    const deltaCount = 250;
    const deltas = Array.from({ length: deltaCount }, (_, i) => `chunk-${i}-`);
    const expectedText = deltas.join("");
    mockChatFn.mockResolvedValue(
      streamResponse([
        ...deltas.map(
          delta => `data: {"type":"text-delta","id":"assistant-fast","delta":"${delta}"}`
        ),
        'data: {"type":"finish","finishReason":"stop"}',
      ])
    );

    await createRoot(async dispose => {
      const chat = useChat({
        sessionId: () => "session-1",
        workspace: () => "/repo",
        client: mockClient,
      });

      await chat.sendMessage("hello");

      const textCalls = mockPartUpsert.mock.calls.filter(
        call => call[0]?.type === "text" && call[0]?.id === "assistant-fast-text"
      );
      expect(textCalls).toHaveLength(1);
      expect(textCalls[0]?.[0]?.text).toBe(expectedText);
      expect(chat.streaming.status()).toBe("done");
      dispose();
    });
  });
});
