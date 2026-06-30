import { blockRangeAt } from "@sakti-code/pi-natives";
import { computeRawHash } from "../../lib/hashline-utils/format";
import type { BlockResolver } from "../../lib/hashline-utils/types";

const resolutionCache = new Map<string, { start: number; end: number } | null>();
const RESOLUTION_CACHE_MAX = 512;

export const nativeBlockResolver: BlockResolver = ({ path, text, line }) => {
  const key = `${computeRawHash(text)}:${text.length}:${line}:${path}`;
  const cached = resolutionCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const range = blockRangeAt({ code: text, path, line });
  const result = range ? { start: range.startLine, end: range.endLine } : null;
  if (resolutionCache.size >= RESOLUTION_CACHE_MAX) {
    const oldest = resolutionCache.keys().next().value;
    if (oldest !== undefined) {
      resolutionCache.delete(oldest);
    }
  }
  resolutionCache.set(key, result);
  return result;
};
