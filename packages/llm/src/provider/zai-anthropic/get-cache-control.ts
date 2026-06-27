import type { SharedV4Warning } from "@ai-sdk/provider";
import type { ZaiCacheControl } from "./zai-api.ts";

/**
 * # CacheControlValidator — Anthropic prompt-cache breakpoint limiter
 *
 * Anthropic allows at most **4** `cache_control` breakpoints per request. The
 * generator runs this validator while building `system` + `tools` blocks and
 * silently drops overflow, recording one warning per dropped breakpoint.
 *
 * Ported from `@ai-sdk/anthropic/get-cache-control.ts`, simplified to the
 * shape we need: instead of looking up `cache_control` from provider metadata,
 * we call `addBreakpoint()` directly when stamping a block (the `getArgs`
 * builder decides where — last stable system block + last tool).
 *
 * Z.ai-specific: the default `ttl` is `"5m"` (matches Anthropic's default and
 * GLM's free cache writes).
 */

const MAX_CACHE_BREAKPOINTS = 4;

export class CacheControlValidator {
  private breakpointCount = 0;
  private readonly warnings: SharedV4Warning[] = [];

  /**
   * Reserve a breakpoint. Returns the `{type:"ephemeral"}` marker to stamp on
   * the block, or `undefined` once the 4-breakpoint budget is exhausted.
   */
  addBreakpoint(ttl?: "5m" | "1h"): ZaiCacheControl | undefined {
    this.breakpointCount++;
    if (this.breakpointCount > MAX_CACHE_BREAKPOINTS) {
      this.warnings.push({
        type: "unsupported",
        feature: "cacheControl breakpoint limit",
        details: `Maximum ${MAX_CACHE_BREAKPOINTS} cache breakpoints exceeded (found ${this.breakpointCount}). This breakpoint will be ignored.`,
      });
      return;
    }
    return {
      type: "ephemeral",
      ...(ttl === undefined ? {} : { ttl }),
    };
  }

  getWarnings(): SharedV4Warning[] {
    return this.warnings;
  }
}
