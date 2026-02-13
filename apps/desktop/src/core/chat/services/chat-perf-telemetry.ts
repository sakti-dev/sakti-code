export type ChatPerfCounterName =
  | "sseEvents"
  | "streamDataParts"
  | "streamTextDeltas"
  | "turnProjections"
  | "turnProjectionMs"
  | "partUpserts"
  | "coalescedFlushes"
  | "coalescedUpdates"
  | "skippedOptimisticUpdates"
  | "retryAttempts"
  | "retryRecovered"
  | "retryExhausted";

export interface ChatPerfSnapshot {
  counters: Record<ChatPerfCounterName, number>;
  updatedAt: number;
}

const DEV = import.meta.env.DEV;

const COUNTER_NAMES: ChatPerfCounterName[] = [
  "sseEvents",
  "streamDataParts",
  "streamTextDeltas",
  "turnProjections",
  "turnProjectionMs",
  "partUpserts",
  "coalescedFlushes",
  "coalescedUpdates",
  "skippedOptimisticUpdates",
  "retryAttempts",
  "retryRecovered",
  "retryExhausted",
];

const counters: Record<ChatPerfCounterName, number> = {
  sseEvents: 0,
  streamDataParts: 0,
  streamTextDeltas: 0,
  turnProjections: 0,
  turnProjectionMs: 0,
  partUpserts: 0,
  coalescedFlushes: 0,
  coalescedUpdates: 0,
  skippedOptimisticUpdates: 0,
  retryAttempts: 0,
  retryRecovered: 0,
  retryExhausted: 0,
};

let updatedAt = Date.now();

export function recordChatPerfCounter(name: ChatPerfCounterName, delta = 1): void {
  if (!DEV) return;
  counters[name] += delta;
  updatedAt = Date.now();
}

export function getChatPerfSnapshot(): ChatPerfSnapshot {
  const copy: Record<ChatPerfCounterName, number> = {
    sseEvents: 0,
    streamDataParts: 0,
    streamTextDeltas: 0,
    turnProjections: 0,
    turnProjectionMs: 0,
    partUpserts: 0,
    coalescedFlushes: 0,
    coalescedUpdates: 0,
    skippedOptimisticUpdates: 0,
    retryAttempts: 0,
    retryRecovered: 0,
    retryExhausted: 0,
  };

  for (const name of COUNTER_NAMES) {
    copy[name] = counters[name];
  }

  return {
    counters: copy,
    updatedAt,
  };
}

export function resetChatPerfTelemetry(): void {
  for (const name of COUNTER_NAMES) {
    counters[name] = 0;
  }
  updatedAt = Date.now();
}
