/**
 * Tests for MessageAdapter conversions between chat and memory formats.
 */

import type { Message } from "@/chat";
import type { Message as DBMessage } from "@/testing/db";
import { describe, expect, it } from "vitest";

describe("MessageAdapter", () => {
  it("converts chat message to memory format", async () => {
    const { MessageAdapter } = await import("@/memory/message-adapter");

    const chatMessage = {
      info: {
        role: "user" as const,
        id: "msg-123",
        sessionID: "thread-456",
        time: { created: 1700000000000 },
      },
      parts: [
        {
          id: "part-1",
          type: "text" as const,
          messageID: "msg-123",
          sessionID: "thread-456",
          text: "Hello, world!",
          time: { start: 1700000000000, end: 1700000000100 },
        },
      ],
      createdAt: 1700000000000,
    };

    const result = MessageAdapter.toMemoryFormat(
      chatMessage as Message,
      "thread-456",
      "resource-789",
      0
    );

    expect(result.id).toBe("msg-123");
    expect(result.threadId).toBe("thread-456");
    expect(result.resourceId).toBe("resource-789");
    expect(result.role).toBe("user");
    expect(result.rawContent).toBe("Hello, world!");
    expect(result.searchText).toBe("Hello, world!");
    expect(result.injectionText).toBe("Hello, world!");
    expect(result.createdAt).toBe(1700000000000);
    expect(result.messageIndex).toBe(0);
  });

  it("extracts text from multiple parts in order", async () => {
    const { MessageAdapter } = await import("@/memory/message-adapter");

    const chatMessage = {
      info: {
        role: "assistant" as const,
        id: "msg-124",
      },
      parts: [
        {
          id: "part-1",
          type: "text" as const,
          messageID: "msg-124",
          sessionID: "thread-456",
          text: "First part.",
        },
        {
          id: "part-2",
          type: "text" as const,
          messageID: "msg-124",
          sessionID: "thread-456",
          text: "Second part.",
        },
      ],
      createdAt: 1700000000001,
    };

    const result = MessageAdapter.toMemoryFormat(
      chatMessage as Message,
      "thread-456",
      "resource-789",
      1
    );

    expect(result.rawContent).toBe("First part.\nSecond part.");
    expect(result.messageIndex).toBe(1);
  });

  it("handles messages without parts", async () => {
    const { MessageAdapter } = await import("@/memory/message-adapter");

    const chatMessage = {
      info: {
        role: "assistant" as const,
        id: "msg-125",
      },
      parts: [],
      createdAt: 1700000000002,
    };

    const result = MessageAdapter.toMemoryFormat(
      chatMessage as Message,
      "thread-456",
      "resource-789",
      2
    );

    expect(result.rawContent).toBe("");
    expect(result.messageIndex).toBe(2);
  });

  it("uses Date.now when createdAt is missing", async () => {
    const { MessageAdapter } = await import("@/memory/message-adapter");

    const chatMessage = {
      info: {
        role: "user" as const,
        id: "msg-126",
      },
      parts: [],
    };

    const before = Date.now();
    const result = MessageAdapter.toMemoryFormat(
      chatMessage as Message,
      "thread-456",
      "resource-789",
      3
    );
    const after = Date.now();

    expect(result.createdAt).toBeGreaterThanOrEqual(before);
    expect(result.createdAt).toBeLessThanOrEqual(after);
  });

  it("converts DB message to frontend message info", async () => {
    const { MessageAdapter } = await import("@/memory/message-adapter");

    const dbMessage = {
      id: "db-1",
      role: "assistant",
      thread_id: "thread-456",
      created_at: new Date(1700000000000),
    };

    const frontend = MessageAdapter.toFrontendFormat(dbMessage as unknown as DBMessage);
    expect(frontend.id).toBe("db-1");
    expect(frontend.role).toBe("assistant");
    if (frontend.role !== "assistant") {
      throw new Error("Expected assistant message info");
    }
    expect(frontend.sessionID).toBe("thread-456");
    expect(frontend.time?.created).toBe(1700000000000);
  });
});
