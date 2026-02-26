import type {
  SaktiCodeApiClient,
  TaskRunEventInfo,
  TaskRunState,
} from "@/core/services/api/api-client";

export interface MonitorTaskRunOptions {
  client: SaktiCodeApiClient;
  runId: string;
  signal?: AbortSignal;
  pollMs?: number;
  pageLimit?: number;
  onEvent?: (event: TaskRunEventInfo) => void;
}

export interface MonitorTaskRunResult {
  terminalState: Extract<TaskRunState, "completed" | "failed" | "canceled" | "dead">;
  lastEventSeq: number;
  errorMessage?: string;
}

const TERMINAL_STATES = new Set<TaskRunState>(["completed", "failed", "canceled", "dead"]);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRunStateFromEvent(
  event: TaskRunEventInfo
): Extract<TaskRunState, "completed" | "failed" | "canceled" | "dead"> | null {
  if (event.eventType === "run.completed") return "completed";
  if (event.eventType === "run.failed") return "failed";
  if (event.eventType === "run.canceled") return "canceled";

  if (event.eventType === "task-run.updated") {
    const payloadState = event.payload?.state;
    if (
      payloadState === "completed" ||
      payloadState === "failed" ||
      payloadState === "canceled" ||
      payloadState === "dead"
    ) {
      return payloadState;
    }
  }

  return null;
}

function parseErrorMessage(event: TaskRunEventInfo): string | undefined {
  const payloadError = event.payload?.errorMessage;
  if (typeof payloadError === "string" && payloadError.length > 0) {
    return payloadError;
  }
  return undefined;
}

export async function monitorTaskRun(
  options: MonitorTaskRunOptions
): Promise<MonitorTaskRunResult> {
  const pollMs = options.pollMs ?? 700;
  const pageLimit = options.pageLimit ?? 100;
  let lastEventSeq = 0;

  while (!options.signal?.aborted) {
    const page = await options.client.listTaskRunEvents(options.runId, {
      afterEventSeq: lastEventSeq,
      limit: pageLimit,
    });

    let terminal: Extract<TaskRunState, "completed" | "failed" | "canceled" | "dead"> | null = null;
    let errorMessage: string | undefined;
    for (const event of page.events) {
      if (event.eventSeq <= lastEventSeq) {
        continue;
      }
      lastEventSeq = event.eventSeq;
      options.onEvent?.(event);

      terminal = parseRunStateFromEvent(event) ?? terminal;
      errorMessage = parseErrorMessage(event) ?? errorMessage;
    }

    if (terminal) {
      return { terminalState: terminal, lastEventSeq, errorMessage };
    }

    if (page.hasMore) {
      continue;
    }

    const latest = await options.client.getTaskRun(options.runId);
    if (!latest) {
      throw new Error(`Background run not found: ${options.runId}`);
    }

    if (TERMINAL_STATES.has(latest.state)) {
      return {
        terminalState: latest.state as Extract<
          TaskRunState,
          "completed" | "failed" | "canceled" | "dead"
        >,
        lastEventSeq,
      };
    }

    await sleep(pollMs);
  }

  return { terminalState: "canceled", lastEventSeq };
}
