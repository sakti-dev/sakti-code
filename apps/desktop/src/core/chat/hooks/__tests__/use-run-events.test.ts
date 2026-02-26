import type {
  SaktiCodeApiClient,
  TaskRunEventInfo,
  TaskRunInfo,
} from "@/core/services/api/api-client";
import { describe, expect, it, vi } from "vitest";

import { monitorTaskRun } from "../use-run-events";

function runInfo(state: TaskRunInfo["state"]): TaskRunInfo {
  return {
    runId: "run-1",
    taskSessionId: "session-1",
    runtimeMode: "build",
    state,
    clientRequestKey: "k1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    queuedAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    cancelRequestedAt: null,
  };
}

function makeClient(overrides?: Partial<SaktiCodeApiClient>): SaktiCodeApiClient {
  return {
    listTaskRunEvents: vi.fn(),
    getTaskRun: vi.fn(),
    ...overrides,
  } as unknown as SaktiCodeApiClient;
}

describe("monitorTaskRun", () => {
  it("returns completed when completion event arrives", async () => {
    const events: TaskRunEventInfo[] = [
      {
        eventId: "e1",
        eventSeq: 1,
        eventType: "task-run.updated",
        payload: { state: "running" },
        createdAt: new Date().toISOString(),
      },
      {
        eventId: "e2",
        eventSeq: 2,
        eventType: "run.completed",
        payload: {},
        createdAt: new Date().toISOString(),
      },
    ];

    const onEvent = vi.fn();
    const client = makeClient({
      listTaskRunEvents: vi.fn().mockResolvedValue({
        runId: "run-1",
        events,
        lastEventSeq: 2,
        hasMore: false,
      }),
      getTaskRun: vi.fn().mockResolvedValue(runInfo("running")),
    });

    const result = await monitorTaskRun({ client, runId: "run-1", onEvent });
    expect(result.terminalState).toBe("completed");
    expect(result.lastEventSeq).toBe(2);
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it("falls back to run snapshot when no events are available", async () => {
    const client = makeClient({
      listTaskRunEvents: vi.fn().mockResolvedValue({
        runId: "run-1",
        events: [],
        lastEventSeq: 0,
        hasMore: false,
      }),
      getTaskRun: vi.fn().mockResolvedValue(runInfo("completed")),
    });

    const result = await monitorTaskRun({ client, runId: "run-1" });
    expect(result.terminalState).toBe("completed");
    expect(result.lastEventSeq).toBe(0);
  });

  it("returns failed with error message from failed event payload", async () => {
    const client = makeClient({
      listTaskRunEvents: vi.fn().mockResolvedValue({
        runId: "run-1",
        events: [
          {
            eventId: "e3",
            eventSeq: 3,
            eventType: "run.failed",
            payload: { errorMessage: "executor crash" },
            createdAt: new Date().toISOString(),
          },
        ],
        lastEventSeq: 3,
        hasMore: false,
      }),
      getTaskRun: vi.fn().mockResolvedValue(runInfo("running")),
    });

    const result = await monitorTaskRun({ client, runId: "run-1" });
    expect(result.terminalState).toBe("failed");
    expect(result.errorMessage).toBe("executor crash");
  });
});
