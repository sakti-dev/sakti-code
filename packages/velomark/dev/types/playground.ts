export interface PlaygroundPreset {
  description: string;
  id: "incremark-solid-example";
  label: string;
  markdown: string;
}

export type PlaygroundStreamMode = "append" | "rewrite-tail";

export interface PlaygroundStreamControls {
  chunkSize: number;
  intervalMs: number;
  mode: PlaygroundStreamMode;
}

export interface PlaygroundBenchmarkResult {
  appendedBlockCount: number;
  averageUpdateMs: number;
  maxUpdateMs: number;
  mode: PlaygroundStreamMode;
  replacedBlockCount: number;
  reusedBlockCount: number;
  updates: number;
}

export interface PlaygroundBenchmarkState {
  completedRuns: number;
  isRunning: boolean;
  results: PlaygroundBenchmarkResult[];
  totalRuns: number;
}
