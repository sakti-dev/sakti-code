import { describe, expect, it, vi } from "vitest";

import type { TaskSessionRunRecord } from "../../../db/task-session-runs";

function makeRun(overrides?: Partial<TaskSessionRunRecord>): TaskSessionRunRecord {
  const now = new Date();
  return {
    runId: "run-1",
    taskSessionId: "ts-1",
    runtimeMode: "build",
    state: "running",
    clientRequestKey: null,
    input: { message: "hello", workspace: "/tmp/ws" },
    metadata: null,
    createdAt: now,
    updatedAt: now,
    queuedAt: now,
    startedAt: now,
    finishedAt: null,
    attempt: 0,
    maxAttempts: 3,
    leaseOwner: "worker",
    leaseExpiresAt: now,
    lastHeartbeatAt: now,
    cancelRequestedAt: null,
    canceledAt: null,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

describe("createChatTaskRunExecutor", () => {
  it("calls /api/chat and returns completed on 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true }),
    });

    const { createChatTaskRunExecutor } = await import("../task-run-worker");
    const executor = createChatTaskRunExecutor({
      baseUrl: "http://127.0.0.1:3000",
      token: "tkn",
      fetchImpl,
      resolveWorkspace: async () => "/tmp/ws",
    });

    const result = await executor(makeRun());

    expect(result.status).toBe("completed");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:3000/api/chat?directory=%2Ftmp%2Fws"
    );
  });

  it("returns failed when message is missing", async () => {
    const { createChatTaskRunExecutor } = await import("../task-run-worker");
    const executor = createChatTaskRunExecutor({
      baseUrl: "http://127.0.0.1:3000",
      token: "tkn",
      fetchImpl: vi.fn(),
      resolveWorkspace: async () => "/tmp/ws",
    });

    const result = await executor(makeRun({ input: { workspace: "/tmp/ws" } }));

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.errorCode).toBe("missing_input_message");
    }
  });

  it("returns failed on non-ok response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "boom",
      json: async () => ({ error: "boom" }),
    });

    const { createChatTaskRunExecutor } = await import("../task-run-worker");
    const executor = createChatTaskRunExecutor({
      baseUrl: "http://127.0.0.1:3000",
      token: "tkn",
      fetchImpl,
      resolveWorkspace: async () => "/tmp/ws",
    });

    const result = await executor(makeRun());

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.errorCode).toBe("chat_http_500");
    }
  });
});
