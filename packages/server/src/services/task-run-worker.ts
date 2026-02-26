import { createLogger } from "@sakti-code/shared/logger";

import { appendTaskRunEvent } from "../../db/task-run-events";
import {
  claimNextTaskSessionRun,
  getTaskSessionRunById,
  heartbeatTaskSessionRun,
  markTaskSessionRunCanceled,
  markTaskSessionRunCompleted,
  markTaskSessionRunFailed,
  type TaskSessionRunRecord,
} from "../../db/task-session-runs";
import { getTaskSession } from "../../db/task-sessions";
import { getWorkspaceById } from "../../db/workspaces";
import { recoverExpiredTaskRuns } from "./task-run-recovery";

const logger = createLogger("server:task-run-worker");

type TaskRunExecutorResult =
  | { status: "completed" }
  | { status: "canceled" }
  | { status: "failed"; errorCode?: string; errorMessage?: string };

export type TaskRunExecutor = (run: TaskSessionRunRecord) => Promise<TaskRunExecutorResult>;

export interface TaskRunWorkerOptions {
  workerId: string;
  executor: TaskRunExecutor;
  leaseMs?: number;
  heartbeatMs?: number;
  pollMs?: number;
}

interface CreateChatTaskRunExecutorOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  resolveWorkspace?: (run: TaskSessionRunRecord) => Promise<string>;
}

function readString(input: Record<string, unknown> | null, keys: string[]): string | null {
  if (!input) {
    return null;
  }
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

export function createChatTaskRunExecutor(
  options: CreateChatTaskRunExecutorOptions
): TaskRunExecutor {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolveWorkspace =
    options.resolveWorkspace ??
    (async (run: TaskSessionRunRecord): Promise<string> => {
      const fromInput = readString(run.input, ["directory", "workspace"]);
      if (fromInput) {
        return fromInput;
      }

      const session = await getTaskSession(run.taskSessionId);
      if (session?.workspaceId) {
        const workspace = await getWorkspaceById(session.workspaceId);
        if (workspace?.path) {
          return workspace.path;
        }
      }

      return process.cwd();
    });

  return async (run: TaskSessionRunRecord): Promise<TaskRunExecutorResult> => {
    const message = readString(run.input, ["message", "prompt", "input"]);
    if (!message) {
      return {
        status: "failed",
        errorCode: "missing_input_message",
        errorMessage: "Task run input must include a message field",
      };
    }

    const workspace = await resolveWorkspace(run);
    const body = {
      message,
      stream: false,
      runtimeMode: run.runtimeMode,
      providerId: readString(run.input, ["providerId"]),
      modelId: readString(run.input, ["modelId"]),
      messageId: readString(run.input, ["messageId"]),
      retryOfAssistantMessageId: readString(run.input, ["retryOfAssistantMessageId"]),
    };

    const response = await fetchImpl(
      `${options.baseUrl}/api/chat?directory=${encodeURIComponent(workspace)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`admin:${options.token}`).toString("base64")}`,
          "X-Task-Session-ID": run.taskSessionId,
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      let errorText = response.statusText;
      try {
        const data = (await response.json()) as { error?: string };
        if (typeof data.error === "string" && data.error.length > 0) {
          errorText = data.error;
        }
      } catch {
        // ignore parsing errors and use status text fallback
      }

      return {
        status: "failed",
        errorCode: `chat_http_${response.status}`,
        errorMessage: errorText,
      };
    }

    return { status: "completed" };
  };
}

export class TaskRunWorker {
  private readonly workerId: string;
  private readonly executor: TaskRunExecutor;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly pollMs: number;
  private loopTimer: NodeJS.Timeout | null = null;
  private stopped = true;
  private runningTick = false;

  public constructor(options: TaskRunWorkerOptions) {
    this.workerId = options.workerId;
    this.executor = options.executor;
    this.leaseMs = options.leaseMs ?? 30_000;
    this.heartbeatMs = options.heartbeatMs ?? 5_000;
    this.pollMs = options.pollMs ?? 750;
  }

  public start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.schedule();
  }

  public stop(): void {
    this.stopped = true;
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
  }

  public async processOnce(): Promise<boolean> {
    if (this.runningTick) {
      return false;
    }

    this.runningTick = true;
    try {
      await recoverExpiredTaskRuns(new Date());
      const claimed = await claimNextTaskSessionRun({
        workerId: this.workerId,
        leaseMs: this.leaseMs,
      });
      if (!claimed) {
        return false;
      }

      await appendTaskRunEvent({
        runId: claimed.runId,
        taskSessionId: claimed.taskSessionId,
        eventType: "task-run.updated",
        payload: { state: "running", workerId: this.workerId },
        dedupeKey: `running:${claimed.runId}:${claimed.attempt}`,
      });

      const heartbeat = setInterval(() => {
        void heartbeatTaskSessionRun({
          runId: claimed.runId,
          workerId: this.workerId,
          leaseMs: this.leaseMs,
        });
      }, this.heartbeatMs);

      try {
        const result = await this.executor(claimed);
        const latest = await getTaskSessionRunById(claimed.runId);
        if (latest?.state === "cancel_requested" || result.status === "canceled") {
          await markTaskSessionRunCanceled({ runId: claimed.runId, workerId: this.workerId });
          await appendTaskRunEvent({
            runId: claimed.runId,
            taskSessionId: claimed.taskSessionId,
            eventType: "run.canceled",
            payload: { workerId: this.workerId },
          });
          return true;
        }

        if (result.status === "failed") {
          await markTaskSessionRunFailed({
            runId: claimed.runId,
            workerId: this.workerId,
            errorCode: result.errorCode,
            errorMessage: result.errorMessage,
          });
          await appendTaskRunEvent({
            runId: claimed.runId,
            taskSessionId: claimed.taskSessionId,
            eventType: "run.failed",
            payload: {
              workerId: this.workerId,
              errorCode: result.errorCode ?? null,
              errorMessage: result.errorMessage ?? null,
            },
          });
          return true;
        }

        await markTaskSessionRunCompleted({ runId: claimed.runId, workerId: this.workerId });
        await appendTaskRunEvent({
          runId: claimed.runId,
          taskSessionId: claimed.taskSessionId,
          eventType: "run.completed",
          payload: { workerId: this.workerId },
        });

        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await markTaskSessionRunFailed({
          runId: claimed.runId,
          workerId: this.workerId,
          errorCode: "worker_executor_error",
          errorMessage: message,
        });
        await appendTaskRunEvent({
          runId: claimed.runId,
          taskSessionId: claimed.taskSessionId,
          eventType: "run.failed",
          payload: {
            workerId: this.workerId,
            errorCode: "worker_executor_error",
            errorMessage: message,
          },
        });
        return true;
      } finally {
        clearInterval(heartbeat);
      }
    } finally {
      this.runningTick = false;
    }
  }

  private schedule(): void {
    if (this.stopped) {
      return;
    }

    this.loopTimer = setTimeout(async () => {
      try {
        await this.processOnce();
      } catch (error) {
        logger.error("TaskRunWorker tick failed", error as Error, {
          workerId: this.workerId,
        });
      } finally {
        this.schedule();
      }
    }, this.pollMs);
  }
}
