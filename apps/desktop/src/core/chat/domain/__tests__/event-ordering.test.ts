import {
  createMessageUpdatedEvent,
  createOutOfOrderEventSequence,
  createPartUpdatedEvent,
  createSessionCreatedEvent,
  createSessionStatusEvent,
} from "@/fixtures/data-integrity";
import { EventOrderingBuffer } from "@sakti-code/shared/event-ordering";
import { describe, expect, it } from "vitest";

describe("EventOrderingBuffer", () => {
  it("processes in-order events immediately", async () => {
    const sessionId = "session-1";
    const buffer = new EventOrderingBuffer({ timeoutMs: 100 });

    const event1 = createSessionCreatedEvent(sessionId, 1);
    const event2 = createMessageUpdatedEvent("msg-1", sessionId, 2);
    const event3 = createPartUpdatedEvent("part-1", "msg-1", sessionId, 3);

    await expect(buffer.addEvent(event1)).resolves.toEqual([event1]);
    await expect(buffer.addEvent(event2)).resolves.toEqual([event2]);
    await expect(buffer.addEvent(event3)).resolves.toEqual([event3]);
    expect(buffer.getLastProcessed(sessionId)).toBe(3);
  });

  it("queues out-of-order events and releases when gap is filled", async () => {
    const sessionId = "session-2";
    const buffer = new EventOrderingBuffer({ timeoutMs: 100 });
    const [part, message, session, status] = createOutOfOrderEventSequence(sessionId, "m1", "p1");

    await expect(buffer.addEvent(part)).resolves.toEqual([part]);
    await expect(buffer.addEvent(message)).resolves.toEqual([]);
    await expect(buffer.addEvent(session)).resolves.toEqual([]);
    await expect(buffer.addEvent(status)).resolves.toEqual([status]);
    expect(buffer.getQueueSize(sessionId)).toBe(0);
  });

  it("isolates ordering state per session", async () => {
    const sessionA = "session-a";
    const sessionB = "session-b";
    const buffer = new EventOrderingBuffer({ timeoutMs: 100 });

    const a2 = createMessageUpdatedEvent("msg-a2", sessionA, 2);
    const b1 = createSessionCreatedEvent(sessionB, 1);
    const a1 = createSessionCreatedEvent(sessionA, 1);

    await expect(buffer.addEvent(a2)).resolves.toEqual([a2]);
    await expect(buffer.addEvent(b1)).resolves.toEqual([b1]);
    await expect(buffer.addEvent(a1)).resolves.toEqual([]);
    expect(buffer.getLastProcessed(sessionA)).toBe(2);
    expect(buffer.getLastProcessed(sessionB)).toBe(1);
  });

  it("ignores duplicate or stale sequence values", async () => {
    const sessionId = "session-dup";
    const buffer = new EventOrderingBuffer({ timeoutMs: 100 });

    const event1 = createSessionCreatedEvent(sessionId, 1);
    const event2a = createMessageUpdatedEvent("msg-1", sessionId, 2);
    const event2b = createMessageUpdatedEvent("msg-2", sessionId, 2);
    const event1Again = createSessionStatusEvent(sessionId, { type: "busy" }, 1);

    await expect(buffer.addEvent(event1)).resolves.toEqual([event1]);
    await expect(buffer.addEvent(event2a)).resolves.toEqual([event2a]);
    await expect(buffer.addEvent(event2b)).resolves.toEqual([]);
    await expect(buffer.addEvent(event1Again)).resolves.toEqual([]);
  });

  it("processes events without session metadata immediately", async () => {
    const buffer = new EventOrderingBuffer({ timeoutMs: 100 });
    const event = {
      type: "server.connected",
      properties: {},
      eventId: "019c4da0-fc0b-713c-984e-b2aca339c9cc",
      sequence: 1,
      timestamp: Date.now(),
    };

    await expect(buffer.addEvent(event)).resolves.toEqual([event]);
  });

  it("processes first seen event even when sequence does not start at 1", async () => {
    const sessionId = "session-offset";
    const buffer = new EventOrderingBuffer({ timeoutMs: 100 });
    const first = createSessionCreatedEvent(sessionId, 42);
    const next = createMessageUpdatedEvent("msg-43", sessionId, 43);

    await expect(buffer.addEvent(first)).resolves.toEqual([first]);
    await expect(buffer.addEvent(next)).resolves.toEqual([next]);
    expect(buffer.getLastProcessed(sessionId)).toBe(43);
  });

  it("can clear per-session and global state", async () => {
    const sessionId = "session-clear";
    const buffer = new EventOrderingBuffer({ timeoutMs: 100 });

    await buffer.addEvent(createSessionCreatedEvent(sessionId, 1));
    await buffer.addEvent(createMessageUpdatedEvent("msg-2", sessionId, 2));
    expect(buffer.getLastProcessed(sessionId)).toBe(2);

    buffer.clearSession(sessionId);
    expect(buffer.getLastProcessed(sessionId)).toBe(0);
    expect(buffer.getQueueSize(sessionId)).toBe(0);

    await buffer.addEvent(createSessionCreatedEvent(sessionId, 1));
    buffer.clear();
    expect(buffer.getLastProcessed(sessionId)).toBe(0);
    expect(buffer.getQueueSize(sessionId)).toBe(0);
  });
});
