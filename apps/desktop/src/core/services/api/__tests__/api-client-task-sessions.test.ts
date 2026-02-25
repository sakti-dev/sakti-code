import { SaktiCodeApiClient } from "@/core/services/api/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("SaktiCodeApiClient task sessions API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lists task sessions with workspace and kind filters", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ taskSessions: [{ taskSessionId: "ts-1" }] }),
    } as unknown as Response);

    const client = new SaktiCodeApiClient({
      baseUrl: "http://127.0.0.1:3000",
      token: "test-token",
    });

    const taskSessions = await client.listTaskSessions("ws-1", "intake");

    expect(taskSessions).toEqual([{ taskSessionId: "ts-1" }]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "http://127.0.0.1:3000/api/task-sessions?workspaceId=ws-1&kind=intake"
    );
    expect((init as RequestInit).method).toBe("GET");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: `Basic ${btoa("admin:test-token")}`,
    });
  });

  it("gets latest task session by workspace", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ taskSession: { taskSessionId: "ts-latest" } }),
    } as unknown as Response);

    const client = new SaktiCodeApiClient({
      baseUrl: "http://127.0.0.1:3000",
      token: "test-token",
    });

    const taskSession = await client.getLatestTaskSession("ws-1");

    expect(taskSession).toEqual({ taskSessionId: "ts-latest" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/task-sessions/latest?workspaceId=ws-1&kind=task",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("creates a task session with serialized payload", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ taskSession: { taskSessionId: "ts-created" } }),
    } as unknown as Response);

    const client = new SaktiCodeApiClient({
      baseUrl: "http://127.0.0.1:3000",
      token: "test-token",
    });

    const taskSession = await client.createTaskSession({
      resourceId: "resource-1",
      workspaceId: "ws-1",
      sessionKind: "task",
    });

    expect(taskSession).toEqual({ taskSessionId: "ts-created" });
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      resourceId: "resource-1",
      workspaceId: "ws-1",
      sessionKind: "task",
    });
  });

  it("updates a task session with patch payload", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ taskSession: { taskSessionId: "ts-1", status: "specifying" } }),
    } as unknown as Response);

    const client = new SaktiCodeApiClient({
      baseUrl: "http://127.0.0.1:3000",
      token: "test-token",
    });

    const taskSession = await client.updateTaskSession("ts-1", {
      status: "specifying",
      specType: "quick",
      title: "Refine spec",
    });

    expect(taskSession).toEqual({ taskSessionId: "ts-1", status: "specifying" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/task-sessions/ts-1",
      expect.objectContaining({ method: "PATCH" })
    );

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      status: "specifying",
      specType: "quick",
      title: "Refine spec",
    });
  });

  it("deletes a task session", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as unknown as Response);

    const client = new SaktiCodeApiClient({
      baseUrl: "http://127.0.0.1:3000",
      token: "test-token",
    });

    await client.deleteTaskSession("ts-1");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/task-sessions/ts-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
