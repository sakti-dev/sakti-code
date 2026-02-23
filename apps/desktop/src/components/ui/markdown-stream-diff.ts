export type StreamDeltaResult =
  | { type: "append"; chunk: string }
  | { type: "reset"; snapshot: string };

export function computeStreamDelta(prev: string, next: string): StreamDeltaResult {
  const safePrev = prev ?? "";
  const safeNext = next ?? "";
  if (safeNext.startsWith(safePrev)) {
    return { type: "append", chunk: safeNext.slice(safePrev.length) };
  }
  return { type: "reset", snapshot: safeNext };
}
