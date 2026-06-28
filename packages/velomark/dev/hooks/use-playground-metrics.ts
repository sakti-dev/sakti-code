import { createSignal, onCleanup } from "solid-js";
import {
  buildRenderDocument,
  collectRenderMetrics,
} from "../../src/model/render-document";
import type {
  PlaygroundBenchmarkResult,
  PlaygroundBenchmarkState,
  PlaygroundStreamMode,
} from "../types/playground";
import { createStreamSimulator } from "./use-stream-simulator";

const BENCHMARK_MODES: PlaygroundStreamMode[] = ["append", "rewrite-tail"];
const BENCHMARK_STEP_DELAY_MS = 1;

export interface UsePlaygroundMetricsOptions {
  chunkSize: () => number;
  markdown: () => string;
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

function measureMode(
  markdown: string,
  chunkSize: number,
  mode: PlaygroundStreamMode
): PlaygroundBenchmarkResult {
  const simulator = createStreamSimulator({
    chunkSize,
    content: markdown,
    mode,
  });
  const durations: number[] = [];
  let previousDocument = buildRenderDocument(undefined, "");
  let aggregate = {
    appendedBlockCount: 0,
    replacedBlockCount: 0,
    reusedBlockCount: 0,
  };

  for (const snapshot of simulator.snapshots) {
    const start = performance.now();
    const nextDocument = buildRenderDocument(previousDocument, snapshot);
    const duration = performance.now() - start;
    const metrics = collectRenderMetrics(
      previousDocument.blocks,
      nextDocument.blocks
    );

    durations.push(duration);
    aggregate = {
      appendedBlockCount:
        aggregate.appendedBlockCount + metrics.appendedBlockCount,
      replacedBlockCount:
        aggregate.replacedBlockCount + metrics.replacedBlockCount,
      reusedBlockCount: aggregate.reusedBlockCount + metrics.reusedBlockCount,
    };
    previousDocument = nextDocument;
  }

  const totalDuration = durations.reduce((sum, value) => sum + value, 0);
  const maxUpdateMs = durations.reduce((max, value) => Math.max(max, value), 0);

  return {
    ...aggregate,
    averageUpdateMs:
      durations.length > 0
        ? roundToTwoDecimals(totalDuration / durations.length)
        : 0,
    maxUpdateMs: roundToTwoDecimals(maxUpdateMs),
    mode,
    updates: durations.length,
  };
}

export function usePlaygroundMetrics(options: UsePlaygroundMetricsOptions) {
  const [state, setState] = createSignal<PlaygroundBenchmarkState>({
    completedRuns: 0,
    isRunning: false,
    results: [],
    totalRuns: BENCHMARK_MODES.length,
  });
  let activeTimer: ReturnType<typeof setTimeout> | undefined;

  const clearBenchmarkTimer = () => {
    if (activeTimer !== undefined) {
      clearTimeout(activeTimer);
      activeTimer = undefined;
    }
  };

  const runBenchmark = () => {
    clearBenchmarkTimer();
    setState({
      completedRuns: 0,
      isRunning: true,
      results: [],
      totalRuns: BENCHMARK_MODES.length,
    });

    const runNext = (index: number, collected: PlaygroundBenchmarkResult[]) => {
      const mode = BENCHMARK_MODES[index];
      if (!mode) {
        setState({
          completedRuns: collected.length,
          isRunning: false,
          results: collected,
          totalRuns: BENCHMARK_MODES.length,
        });
        return;
      }

      const result = measureMode(options.markdown(), options.chunkSize(), mode);
      const nextResults = [...collected, result];
      setState({
        completedRuns: nextResults.length,
        isRunning: index < BENCHMARK_MODES.length - 1,
        results: nextResults,
        totalRuns: BENCHMARK_MODES.length,
      });

      if (index >= BENCHMARK_MODES.length - 1) {
        setState((previous) => ({
          ...previous,
          isRunning: false,
        }));
        return;
      }

      activeTimer = setTimeout(() => {
        runNext(index + 1, nextResults);
      }, BENCHMARK_STEP_DELAY_MS);
    };

    activeTimer = setTimeout(() => {
      runNext(0, []);
    }, BENCHMARK_STEP_DELAY_MS);
  };

  onCleanup(() => {
    clearBenchmarkTimer();
  });

  return {
    benchmarkState: state,
    runBenchmark,
  };
}
