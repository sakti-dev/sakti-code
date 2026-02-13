export type MarkdownPerfStage = "parse" | "sanitize" | "morph" | "copyButtons" | "total";

interface StageSeries {
  samples: number[];
  sum: number;
  max: number;
}

interface MarkdownCounters {
  commits: number;
  liteCommits: number;
  fullCommits: number;
  droppedFrames: number;
  longTasks: number;
  rafSkippedApplies: number;
  forcedFlushes: number;
  finalizationBatches: number;
  finalizationYieldCount: number;
  finalizationTotalMs: number;
  finalizationMaxBatchMs: number;
}

export interface MarkdownStageStats {
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface MarkdownPerfSnapshot {
  counters: MarkdownCounters;
  stages: Record<MarkdownPerfStage, MarkdownStageStats>;
  updatedAt: number;
}

const SAMPLE_LIMIT = 500;

function createSeries(): StageSeries {
  return {
    samples: [],
    sum: 0,
    max: 0,
  };
}

const stageData: Record<MarkdownPerfStage, StageSeries> = {
  parse: createSeries(),
  sanitize: createSeries(),
  morph: createSeries(),
  copyButtons: createSeries(),
  total: createSeries(),
};

const counters: MarkdownCounters = {
  commits: 0,
  liteCommits: 0,
  fullCommits: 0,
  droppedFrames: 0,
  longTasks: 0,
  rafSkippedApplies: 0,
  forcedFlushes: 0,
  finalizationBatches: 0,
  finalizationYieldCount: 0,
  finalizationTotalMs: 0,
  finalizationMaxBatchMs: 0,
};

let updatedAt = Date.now();

function recordSample(series: StageSeries, value: number): void {
  const normalized = Math.max(0, value);
  series.samples.push(normalized);
  series.sum += normalized;
  if (normalized > series.max) {
    series.max = normalized;
  }

  if (series.samples.length > SAMPLE_LIMIT) {
    const dropped = series.samples.shift() ?? 0;
    series.sum -= dropped;
    if (dropped >= series.max) {
      series.max = Math.max(0, ...series.samples);
    }
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index] ?? 0;
}

function buildStageStats(series: StageSeries): MarkdownStageStats {
  const count = series.samples.length;
  return {
    count,
    avgMs: count > 0 ? series.sum / count : 0,
    p50Ms: percentile(series.samples, 50),
    p95Ms: percentile(series.samples, 95),
    maxMs: series.max,
  };
}

export function recordMarkdownStageMs(stage: MarkdownPerfStage, ms: number): void {
  recordSample(stageData[stage], ms);
  updatedAt = Date.now();
}

export function recordMarkdownCommit(): void {
  counters.commits += 1;
  updatedAt = Date.now();
}

export function recordMarkdownLiteCommit(): void {
  counters.liteCommits += 1;
  updatedAt = Date.now();
}

export function recordMarkdownFullCommit(): void {
  counters.fullCommits += 1;
  updatedAt = Date.now();
}

export function recordMarkdownDroppedFrames(count: number): void {
  counters.droppedFrames += Math.max(0, count);
  updatedAt = Date.now();
}

export function recordMarkdownLongTask(): void {
  counters.longTasks += 1;
  updatedAt = Date.now();
}

export function recordMarkdownRafSkippedApply(): void {
  counters.rafSkippedApplies += 1;
  updatedAt = Date.now();
}

export function recordMarkdownForcedFlush(): void {
  counters.forcedFlushes += 1;
  updatedAt = Date.now();
}

export function recordMarkdownFinalizationStats(stats: {
  batches: number;
  yields: number;
  totalMs: number;
  maxBatchMs: number;
}): void {
  counters.finalizationBatches += Math.max(0, stats.batches);
  counters.finalizationYieldCount += Math.max(0, stats.yields);
  counters.finalizationTotalMs += Math.max(0, stats.totalMs);
  counters.finalizationMaxBatchMs = Math.max(counters.finalizationMaxBatchMs, stats.maxBatchMs);
  updatedAt = Date.now();
}

export function getMarkdownPerfSnapshot(): MarkdownPerfSnapshot {
  return {
    counters: { ...counters },
    stages: {
      parse: buildStageStats(stageData.parse),
      sanitize: buildStageStats(stageData.sanitize),
      morph: buildStageStats(stageData.morph),
      copyButtons: buildStageStats(stageData.copyButtons),
      total: buildStageStats(stageData.total),
    },
    updatedAt,
  };
}

export function resetMarkdownPerfTelemetry(): void {
  for (const series of Object.values(stageData)) {
    series.samples = [];
    series.sum = 0;
    series.max = 0;
  }

  counters.commits = 0;
  counters.liteCommits = 0;
  counters.fullCommits = 0;
  counters.droppedFrames = 0;
  counters.longTasks = 0;
  counters.rafSkippedApplies = 0;
  counters.forcedFlushes = 0;
  counters.finalizationBatches = 0;
  counters.finalizationYieldCount = 0;
  counters.finalizationTotalMs = 0;
  counters.finalizationMaxBatchMs = 0;
  updatedAt = Date.now();
}
