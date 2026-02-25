import { beforeEach, describe, expect, it, vi } from "vitest";

const { publishMock } = vi.hoisted(() => ({
  publishMock: vi.fn(async () => undefined),
}));

vi.mock("../../bus", () => ({
  publish: publishMock,
  MessagePartUpdated: { type: "message.part.updated" },
  MessageUpdated: { type: "message.updated" },
  SessionStatus: { type: "session.status" },
}));

describe("chat route publish ordering", () => {
  beforeEach(() => {
    publishMock.mockClear();
  });

  it("publishes message completion before idle status on finish events", async () => {
    const { createPartPublishState, publishPartEvent } = await import("../chat");
    const sessionId = "019c0000-0000-7000-8000-000000000211";
    const messageId = "019c0000-0000-7000-8000-000000000212";
    const assistantInfo = {
      role: "assistant",
      id: messageId,
      sessionID: sessionId,
      parentID: "019c0000-0000-7000-8000-000000000213",
      time: { created: Date.now() },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    };

    await publishPartEvent(sessionId, messageId, createPartPublishState(), assistantInfo as never, {
      type: "finish",
      finishReason: "stop",
    });

    expect(publishMock).toHaveBeenCalledTimes(2);
    expect((publishMock.mock.calls[0] as unknown[])[0]).toMatchObject({ type: "message.updated" });
    expect((publishMock.mock.calls[0] as unknown[])[1]).toMatchObject({
      info: { id: messageId, finish: "stop" },
    });
    expect((publishMock.mock.calls[1] as unknown[])[0]).toMatchObject({ type: "session.status" });
    expect((publishMock.mock.calls[1] as unknown[])[1]).toMatchObject({
      sessionID: sessionId,
      status: { type: "idle" },
    });
  });
});
