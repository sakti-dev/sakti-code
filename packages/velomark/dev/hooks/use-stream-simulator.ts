import type { PlaygroundStreamMode } from "../types/playground";

export interface StreamSimulatorOptions {
  chunkSize: number;
  content: string;
  mode: PlaygroundStreamMode;
}

function splitChunks(content: string, chunkSize: number): string[] {
  const normalizedChunkSize = Math.max(1, Math.floor(chunkSize));
  const chunks: string[] = [];

  for (let index = 0; index < content.length; index += normalizedChunkSize) {
    chunks.push(content.slice(index, index + normalizedChunkSize));
  }

  return chunks;
}

function buildSnapshots(
  chunks: string[],
  mode: PlaygroundStreamMode
): string[] {
  const snapshots: string[] = [];
  let current = "";

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index] ?? "";

    if (mode === "append" || index < 2) {
      current += chunk;
      snapshots.push(current);
      continue;
    }

    const keepLength = Math.max(0, current.length - chunk.length);
    current = `${current.slice(0, keepLength)}${chunk}`;
    snapshots.push(current);
  }

  return snapshots;
}

export function createStreamSimulator(options: StreamSimulatorOptions) {
  const chunks = splitChunks(options.content, options.chunkSize);
  const snapshots = buildSnapshots(chunks, options.mode);

  return {
    chunks,
    snapshots,
    collect(): Promise<string[]> {
      return Promise.resolve(snapshots);
    },
  };
}
