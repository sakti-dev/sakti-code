import { describe, expect, it } from "vitest";
import { publish, subscribe, TaskSessionUpdated, TaskUpdated } from "..";

describe("TaskUpdated Event", () => {
  it("should publish and receive task updated event", async () => {
    const received: unknown[] = [];

    const unsubscribe = subscribe(TaskUpdated, event => {
      received.push(event.properties);
    });

    await publish(TaskUpdated, {
      sessionId: "session-123",
      tasks: [{ id: "task-1", title: "Test task", status: "open", priority: 2 }],
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      sessionId: "session-123",
      tasks: [{ id: "task-1", title: "Test task", status: "open", priority: 2 }],
    });

    unsubscribe();
  });
});

describe("TaskSessionUpdated Event", () => {
  it("should publish and receive task-session updated event", async () => {
    const received: unknown[] = [];

    const unsubscribe = subscribe(TaskSessionUpdated, event => {
      received.push(event.properties);
    });

    await publish(TaskSessionUpdated, {
      taskSessionId: "019c4da0-fc0b-713c-984e-b2aca339c97b",
      workspaceId: "ws-1",
      status: "specifying",
      specType: "quick",
      sessionKind: "task",
      title: "Implement auth flow",
      lastActivityAt: new Date().toISOString(),
      mutation: "updated",
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(
      expect.objectContaining({
        taskSessionId: "019c4da0-fc0b-713c-984e-b2aca339c97b",
        mutation: "updated",
      })
    );

    unsubscribe();
  });
});
