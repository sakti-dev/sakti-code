import {
  getMarkdownPerfSnapshot,
  recordMarkdownCommit,
  recordMarkdownDroppedFrames,
  recordMarkdownFinalizationStats,
  recordMarkdownLongTask,
  recordMarkdownStageMs,
  resetMarkdownPerfTelemetry,
} from "@/core/chat/services/markdown-perf-telemetry";
import { beforeEach, describe, expect, it } from "vitest";

describe("markdown-perf-telemetry", () => {
  beforeEach(() => {
    resetMarkdownPerfTelemetry();
  });

  it("tracks counters and stage timing stats", () => {
    recordMarkdownCommit();
    recordMarkdownCommit();
    recordMarkdownDroppedFrames(3);
    recordMarkdownLongTask();
    recordMarkdownFinalizationStats({ batches: 2, yields: 1, totalMs: 12, maxBatchMs: 7 });

    recordMarkdownStageMs("parse", 2);
    recordMarkdownStageMs("parse", 4);
    recordMarkdownStageMs("parse", 8);

    const snapshot = getMarkdownPerfSnapshot();
    expect(snapshot.counters.commits).toBe(2);
    expect(snapshot.counters.droppedFrames).toBe(3);
    expect(snapshot.counters.longTasks).toBe(1);
    expect(snapshot.counters.finalizationBatches).toBe(2);
    expect(snapshot.counters.finalizationYieldCount).toBe(1);
    expect(snapshot.counters.finalizationMaxBatchMs).toBe(7);
    expect(snapshot.stages.parse.count).toBe(3);
    expect(snapshot.stages.parse.avgMs).toBeCloseTo(14 / 3, 4);
    expect(snapshot.stages.parse.maxMs).toBe(8);
    expect(snapshot.stages.parse.p50Ms).toBeGreaterThanOrEqual(4);
  });

  it("resets all recorded values", () => {
    recordMarkdownCommit();
    recordMarkdownDroppedFrames(1);
    recordMarkdownLongTask();
    recordMarkdownFinalizationStats({ batches: 1, yields: 1, totalMs: 4, maxBatchMs: 4 });
    recordMarkdownStageMs("total", 5);

    resetMarkdownPerfTelemetry();
    const snapshot = getMarkdownPerfSnapshot();

    expect(snapshot.counters.commits).toBe(0);
    expect(snapshot.counters.droppedFrames).toBe(0);
    expect(snapshot.counters.longTasks).toBe(0);
    expect(snapshot.counters.finalizationBatches).toBe(0);
    expect(snapshot.stages.total.count).toBe(0);
    expect(snapshot.stages.total.avgMs).toBe(0);
  });
});
