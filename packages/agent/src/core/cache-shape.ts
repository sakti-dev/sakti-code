import { createHash } from "node:crypto";
import type { StreamRequest, Usage } from "@sakti-code/llm";

/**
 * # Cache-shape diagnostics (§10)
 *
 * Hash-based prefix comparison for runtime cache-stability observability.
 * Mirrors Reasonix's `cache_shape.go` PrefixShape/CompareShape pattern but
 * uses our {@link StreamRequest} shape and provider `usage.cacheRead`/`cacheWrite`
 * for real hit/miss tokens (no mock endpoint needed).
 *
 * Unlike the Phase 1 `measureCacheHit` test helpers (full byte-comparison),
 * this is cheap enough to run every turn: two short SHA-8 hashes + a field
 * comparison.
 */

/** Short stable hash for diagnostics display (first 8 hex chars of SHA-256). */
function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

/** Snapshot of the cache-relevant prefix of a request. */
export interface PrefixShape {
  /** Combined hash of {system, tools} — changes iff either changes. */
  prefixHash: string;
  /** Hash of the system prompt. */
  systemHash: string;
  /** Hash of the tools JSON (sorted keys for determinism). */
  toolsHash: string;
}

/** Per-turn diagnostics explaining why a cache hit or miss happened. */
export interface CacheDiagnostics {
  /** Provider-reported cache hit tokens (from usage.cacheRead). */
  cacheHitTokens: number;
  /** Provider-reported cache miss tokens (from usage.cacheWrite). */
  cacheMissTokens: number;
  /** True when system or tools changed since the previous turn. */
  changed: boolean;
  /** Which component(s) changed: "system" | "tools". */
  changeReasons: string[];
  /** Hit rate percentage from provider usage (0–100). 0 when no cache data. */
  hitRate: number;
  /** Current prefix hash (for display). */
  prefixHash: string;
  /** Current system hash (for display). */
  systemHash: string;
  /** Current tools hash (for display). */
  toolsHash: string;
}

/** Capture a {@link StreamRequest}'s prefix shape. */
export function captureShape(req: StreamRequest): PrefixShape {
  const system = req.system ?? "";
  const toolsSorted = req.tools
    ? JSON.stringify(req.tools, Object.keys(req.tools).sort())
    : "{}";
  const prefix = JSON.stringify({ system, tools: toolsSorted });
  return {
    systemHash: shortHash(system),
    toolsHash: shortHash(toolsSorted),
    prefixHash: shortHash(prefix),
  };
}

/**
 * Compare two consecutive turns' shapes and explain a cache miss.
 * `prev === undefined` (first turn) → unchanged baseline (nothing to compare).
 */
export function compareShape(
  prev: PrefixShape | undefined,
  cur: PrefixShape,
  usage: Usage | undefined
): CacheDiagnostics {
  const reasons: string[] = [];
  if (prev !== undefined) {
    if (prev.systemHash !== cur.systemHash) {
      reasons.push("system");
    }
    if (prev.toolsHash !== cur.toolsHash) {
      reasons.push("tools");
    }
  }
  const cacheHitTokens = usage?.cacheRead ?? 0;
  const cacheMissTokens = usage?.cacheWrite ?? 0;
  const total = cacheHitTokens + cacheMissTokens;
  const hitRate = total === 0 ? 0 : Math.floor((cacheHitTokens * 100) / total);
  return {
    prefixHash: cur.prefixHash,
    changed: reasons.length > 0,
    changeReasons: reasons,
    systemHash: cur.systemHash,
    toolsHash: cur.toolsHash,
    cacheHitTokens,
    cacheMissTokens,
    hitRate,
  };
}
