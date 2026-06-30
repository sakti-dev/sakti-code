import type { StreamRequest } from "@sakti-code/llm";

/**
 * # Cache-stability measurement helpers
 *
 * Mirrors Reasonix's `cachehit_e2e_test.go` byte-compare pattern: consecutive
 * provider requests share a byte-identical prefix (system + tools + leading
 * messages); the provider derives `prompt_cache_hit_tokens` from that prefix.
 * These helpers let tests measure prefix stability and hit rate without a mock
 * HTTP endpoint — the {@link StreamRequest} captured at the `streamFn` seam is
 * the byte-comparable fingerprint.
 *
 * @see docs/plans/2026-06-28-reasonix-cache-followups.md (§11)
 */

/** A captured stream request — the byte-comparable fingerprint. */
export interface StreamRequestCapture {
  messages: unknown[];
  system: string;
  toolsJson: string;
  toolsKeys: string[];
}

/** Canonicalize a message to a stable string for byte comparison. */
export function canonicalizeMessage(msg: unknown): string {
  return JSON.stringify(msg);
}

/**
 * Count the number of byte-identical leading items between two arrays,
 * using `canonicalize` to produce the comparison key.
 */
export function commonPrefixLength<T>(a: T[], b: T[], canonicalize: (item: T) => string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n) {
    if (canonicalize(a[i]!) !== canonicalize(b[i]!)) {
      break;
    }
    i++;
  }
  return i;
}

/** Result of comparing two consecutive requests for cache stability. */
export interface CacheHitMeasurement {
  /** Which component broke the prefix, if any. */
  breakReason: "system" | "tools" | "messages" | undefined;
  /** Characters in the byte-identical prefix (system + tools + shared leading messages). */
  hitChars: number;
  /** Estimated hit rate as a percentage (0–100). 0 when current request is empty. */
  hitRate: number;
  /** True when system + tools are identical AND the prior message list is a byte-identical prefix of the current one. */
  prefixStable: boolean;
  /** Total characters in the current request. */
  totalChars: number;
}

/**
 * Measure the cache stability between two consecutive stream requests.
 * Mirrors Reasonix's `commonPrefixMsgs` + `charsOf` logic, but operates on our
 * `StreamRequest` shape instead of raw DeepSeek JSON.
 *
 * `prefixStable === true` means the entire prior request is a byte-identical
 * prefix of the current one — the only new bytes are the fresh turn's tail.
 */
export function measureCacheHit(
  prev: StreamRequestCapture,
  cur: StreamRequestCapture,
): CacheHitMeasurement {
  let prefixStable = true;
  let breakReason: CacheHitMeasurement["breakReason"];

  if (prev.system !== cur.system) {
    prefixStable = false;
    breakReason = "system";
  } else if (
    prev.toolsJson !== cur.toolsJson ||
    JSON.stringify(prev.toolsKeys) !== JSON.stringify(cur.toolsKeys)
  ) {
    prefixStable = false;
    breakReason = "tools";
  }

  const prefixMsgCount = commonPrefixLength(prev.messages, cur.messages, canonicalizeMessage);

  if (prefixMsgCount < prev.messages.length) {
    prefixStable = false;
    breakReason ??= "messages";
  }

  let hitChars = prev.system.length + prev.toolsJson.length;
  for (let i = 0; i < prefixMsgCount; i++) {
    hitChars += canonicalizeMessage(prev.messages[i]).length;
  }

  const totalChars =
    cur.system.length +
    cur.toolsJson.length +
    cur.messages.reduce<number>((sum, m) => sum + canonicalizeMessage(m).length, 0);

  const hitRate = totalChars === 0 ? 0 : Math.floor((hitChars * 100) / totalChars);

  return { prefixStable, breakReason, hitChars, totalChars, hitRate };
}

/**
 * Capture a {@link StreamRequest} into the byte-comparable shape. Used by tests
 * that record consecutive requests from the agent loop via the `streamFn` seam.
 */
export function captureRequest(req: StreamRequest): StreamRequestCapture {
  return {
    system: req.system ?? "",
    messages: req.messages,
    toolsKeys: req.tools ? Object.keys(req.tools) : [],
    toolsJson: req.tools ? JSON.stringify(req.tools) : "{}",
  };
}
