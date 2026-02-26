import { SaktiCodeApiClient } from "@/core/services/api/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("SaktiCodeApiClient task runs API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a task run", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ run: { runId: "run-1", state: "queued" } }),
    } as unknown as Response);

    const client = new SaktiCodeApiClient({
      baseUrl: "http://127.0.0.1:3000",
      token: "test-token",
    });

    const run = await client.createTaskRun("ts-1", {
      runtimeMode: "build",
      input: { message: "hello" },
      clientRequestKey: "k1",
    });

    expect(run).toEqual({ runId: "run-1", state: "queued" });
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://127.0.0.1:3000/api/task-sessions/ts-1/runs");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("lists task runs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ runs: [{ runId: "run-1" }] }),
    } as unknown as Response);

    const client = new SaktiCodeApiClient({
      baseUrl: "http://127.0.0.1:3000",
      token: "test-token",
    });

    const runs = await client.listTaskRuns("ts-1");
    expect(runs).toEqual([{ runId: "run-1" }]);
  });

  it("gets and cancels a task run", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ run: { runId: "run-1", state: "running" } }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ run: { runId: "run-1", state: "cancel_requested" } }),
      } as unknown as Response);

    const client = new SaktiCodeApiClient({
      baseUrl: "http://127.0.0.1:3000",
      token: "test-token",
    });

    const run = await client.getTaskRun("run-1");
    expect(run).toEqual({ runId: "run-1", state: "running" });

    const canceled = await client.cancelTaskRun("run-1");
    expect(canceled).toEqual({ runId: "run-1", state: "cancel_requested" });

    expect(String(fetchSpy.mock.calls[1]?.[0])).toBe("http://127.0.0.1:3000/api/runs/run-1/cancel");
  });

  it("lists task run events with cursor params", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        runId: "run-1",
        events: [{ eventSeq: 2, eventType: "run.completed" }],
        lastEventSeq: 2,
        hasMore: false,
      }),
    } as unknown as Response);

    const client = new SaktiCodeApiClient({
      baseUrl: "http://127.0.0.1:3000",
      token: "test-token",
    });

    const result = await client.listTaskRunEvents("run-1", { afterEventSeq: 1, limit: 50 });
    expect(result.lastEventSeq).toBe(2);

    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:3000/api/runs/run-1/events?afterEventSeq=1&limit=50"
    );
  });
});
