export type StreamDeltaResult =
  | { type: "append"; chunk: string }
  | { type: "reset"; snapshot: string };

export function computeStreamDelta(prev: string, next: string): StreamDeltaResult {
  if (next.startsWith(prev)) {
    return { type: "append", chunk: next.slice(prev.length) };
  }
  return { type: "reset", snapshot: next };
}
