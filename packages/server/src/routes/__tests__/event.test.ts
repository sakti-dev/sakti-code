/**
 * SSE event route tests
 * Tests for the new /event endpoint that uses the Bus system
 */

import { TextDecoder } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PermissionAsked, publish } from "../../bus";

const decoder = new TextDecoder();

async function readChunk(reader: {
  read: () => Promise<{ value?: Uint8Array }>;
  cancel: () => Promise<void>;
}): Promise<string> {
  const { value } = await reader.read();
  return value ? decoder.decode(value) : "";
}

async function readWithTimeout(
  reader: {
    read: () => Promise<{ value?: Uint8Array }>;
    cancel: () => Promise<void>;
  },
  timeoutMs: number
): Promise<string | null> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">(resolve => {
    timeoutId = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const result = await Promise.race([
    reader.read().then(r => ({ kind: "read" as const, value: r.value })),
    timeout,
  ]);

  if (result === "timeout") {
    if (timeoutId) clearTimeout(timeoutId);
    await reader.cancel();
    return null;
  }

  if (timeoutId) clearTimeout(timeoutId);
  return result.value ? decoder.decode(result.value) : "";
}

function parseSSEEvent(chunk: string): { type: string; properties: unknown } | null {
  const lines = chunk.split("\n");
  let data = "";
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      data = line.slice(6);
    }
  }
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

describe("event SSE stream", () => {
  beforeEach(async () => {
    const { setupTestDatabase } = await import("../../../db/test-setup");
    await setupTestDatabase();
    const { db, taskSessions } = await import("../../../db");
    await db.delete(taskSessions);
  });

  afterEach(async () => {
    const { db, taskSessions } = await import("../../../db");
    await db.delete(taskSessions);
    // Clear bus subscriptions
    const { clearAll } = await import("../../bus");
    clearAll();
  });

  it("sends server.connected event on connection", async () => {
    const eventRouter = (await import("../event")).default;
    const { createTaskSession } = await import("../../../db/task-sessions");
    const session = await createTaskSession("local");

    const response = await eventRouter.request(`http://localhost/event?directory=/tmp/events`, {
      headers: {
        "X-Task-Session-ID": session.taskSessionId,
      },
    });

    expect(response.status).toBe(200);

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing response body reader");

    const firstChunk = await readChunk(reader);
    await reader.cancel();

    expect(firstChunk).toContain("data: ");
    const event = parseSSEEvent(firstChunk);
    expect(event).not.toBeNull();
    expect(event?.type).toBe("server.connected");
  });

  it("streams bus events via SSE", async () => {
    const eventRouter = (await import("../event")).default;
    const { createTaskSession } = await import("../../../db/task-sessions");
    const session = await createTaskSession("local");

    const response = await eventRouter.request("http://localhost/event", {
      headers: {
        "X-Task-Session-ID": session.taskSessionId,
      },
    });

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing response body reader");

    // Consume connected event
    await readChunk(reader);

    // Small delay to ensure SSE stream has subscribed to bus events
    await new Promise(resolve => setTimeout(resolve, 100));

    // Publish a test event via bus
    await publish(PermissionAsked, {
      id: "perm-test-1",
      sessionID: session.taskSessionId,
      permission: "read",
      patterns: ["/tmp/file.txt"],
      always: [],
    });

    const eventChunk = await readWithTimeout(reader, 1000);
    await reader.cancel();

    expect(eventChunk).not.toBeNull();
    if (!eventChunk) throw new Error("Expected event chunk but got null");
    const event = parseSSEEvent(eventChunk);
    expect(event).not.toBeNull();
    expect(event?.type).toBe("permission.asked");
  });

  it.skip("sends server.heartbeat every 30 seconds", async () => {
    vi.useFakeTimers();
    const eventRouter = (await import("../event")).default;
    const { createTaskSession } = await import("../../../db/task-sessions");
    const session = await createTaskSession("local");

    const response = await eventRouter.request("http://localhost/event", {
      headers: {
        "X-Task-Session-ID": session.taskSessionId,
      },
    });

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing response body reader");

    // Consume connected event
    await readChunk(reader);

    // Fast-forward 30 seconds to trigger heartbeat
    vi.advanceTimersByTime(30000);

    const heartbeatChunk = await readWithTimeout(reader, 1000);
    await reader.cancel();

    expect(heartbeatChunk).not.toBeNull();
    if (!heartbeatChunk) throw new Error("Expected heartbeat chunk but got null");
    const event = parseSSEEvent(heartbeatChunk);
    expect(event).not.toBeNull();
    expect(event?.type).toBe("server.heartbeat");
    vi.useRealTimers();
  });
});
