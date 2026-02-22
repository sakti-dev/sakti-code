/**
 * Rate limiting middleware
 *
 * In-memory rate limiter that tracks requests per IP address.
 * Prevents abuse by limiting request frequency.
 *
 * Uses sliding window algorithm for accurate rate limiting.
 * Automatically cleans up expired entries to prevent memory leaks.
 */

import { createLogger } from "@sakti-code/shared/logger";
import type { Context, Next } from "hono";
import type { Env } from "../index";

const logger = createLogger("server:rate-limit");

/**
 * Request record for tracking rate limit
 */
interface RequestRecord {
  count: number;
  windowStart: number;
}

/**
 * Rate limiter state per client
 */
interface RateLimitState {
  identifier: string;
  records: RequestRecord[];
  blockedUntil: number;
}

/**
 * Rate limiter using sliding window algorithm
 */
class SlidingWindowRateLimiter {
  private clients: Map<string, RateLimitState>;
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly cleanupIntervalMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null;

  constructor(windowMs: number = 60000, maxRequests: number = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.clients = new Map();
    this.cleanupIntervalMs = windowMs * 2;
    this.cleanupTimer = null;

    // Start cleanup interval
    this.startCleanup();
  }

  /**
   * Extract client identifier from request
   */
  private getIdentifier(c: Context<Env>): string {
    // Prefer X-Forwarded-For header (reverse proxy)
    const forwardedFor = c.req.header("X-Forwarded-For");
    if (forwardedFor) {
      return forwardedFor.split(",")[0].trim();
    }

    // Fall back to CF-Connecting-IP (Cloudflare)
    const cfIp = c.req.header("CF-Connecting-IP");
    if (cfIp) {
      return cfIp;
    }

    // Use request path/IP combination as fallback
    return c.req.path + ":" + (c.req.header("X-Real-IP") || "unknown");
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    const cutoffTime = now - this.windowMs;
    const removedCount = this.clients.size;

    for (const [key, state] of this.clients.entries()) {
      // Remove expired records
      state.records = state.records.filter(r => r.windowStart > cutoffTime);

      // Remove blocked status if expired
      if (state.blockedUntil && now > state.blockedUntil) {
        state.blockedUntil = 0;
      }

      // Remove client state if no records and not blocked
      if (state.records.length === 0 && !state.blockedUntil) {
        this.clients.delete(key);
      }
    }

    const activeCount = this.clients.size;
    if (removedCount > activeCount) {
      logger.debug("Rate limiter cleanup", {
        module: "rate-limit",
        removed: removedCount - activeCount,
        active: activeCount,
      });
    }
  }

  /**
   * Start periodic cleanup
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupIntervalMs);

    // Don't block process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Stop cleanup interval
   */
  public stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Check if request is allowed
   */
  public check(c: Context<Env>): { allowed: boolean; remaining: number; resetTime: number } {
    const identifier = this.getIdentifier(c);
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Get or create client state
    let state = this.clients.get(identifier);
    if (!state) {
      state = {
        identifier,
        records: [],
        blockedUntil: 0,
      };
      this.clients.set(identifier, state);
    }

    // Check if client is currently blocked
    if (state.blockedUntil && now < state.blockedUntil) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: state.blockedUntil,
      };
    }

    // Remove expired records from current window
    state.records = state.records.filter(r => r.windowStart > windowStart);

    // Check if under limit
    if (state.records.length < this.maxRequests) {
      // Add current request
      state.records.push({
        count: 1,
        windowStart: now,
      });

      return {
        allowed: true,
        remaining: this.maxRequests - state.records.length,
        resetTime: now + this.windowMs,
      };
    }

    // Rate limit exceeded - block until window expires
    const oldestRecord = state.records[0];
    state.blockedUntil = oldestRecord.windowStart + this.windowMs;

    logger.warn("Rate limit exceeded", {
      module: "rate-limit",
      identifier,
      requestCount: state.records.length,
      limit: this.maxRequests,
      requestId: c.get("requestId"),
      path: c.req.path,
    });

    return {
      allowed: false,
      remaining: 0,
      resetTime: state.blockedUntil,
    };
  }

  /**
   * Reset rate limit for a specific client
   */
  public reset(identifier: string): void {
    this.clients.delete(identifier);
  }

  /**
   * Reset all rate limits
   */
  public resetAll(): void {
    this.clients.clear();
  }

  /**
   * Get statistics
   */
  public getStats(): {
    totalClients: number;
    windowMs: number;
    maxRequests: number;
    clients: Array<{ identifier: string; recordCount: number; blocked: boolean }>;
  } {
    return {
      totalClients: this.clients.size,
      windowMs: this.windowMs,
      maxRequests: this.maxRequests,
      clients: Array.from(this.clients.entries()).map(([id, state]) => ({
        identifier: id,
        recordCount: state.records.length,
        blocked: Boolean(state.blockedUntil && state.blockedUntil > Date.now()),
      })),
    };
  }
}

/**
 * Global rate limiter instance (100 requests per minute)
 */
const globalRateLimiter = new SlidingWindowRateLimiter(60000, 100);

/**
 * Rate limit middleware options
 */
export interface RateLimitOptions {
  /** Window duration in milliseconds (default: 60000 = 1 minute) */
  windowMs?: number;
  /** Maximum requests per window (default: 100) */
  maxRequests?: number;
  /** Paths to exclude from rate limiting (default: []) */
  skipSuccessfulRequests?: boolean;
  /** Skip successful requests from counting (default: false) */
  excludePaths?: string[];
}

/**
 * Create rate limit middleware with custom options
 *
 * @param options - Rate limit configuration options
 * @returns Hono middleware function with reset method attached
 */
export function createRateLimitMiddleware(options: RateLimitOptions = {}) {
  const { windowMs = 60000, maxRequests = 100, excludePaths = [] } = options;

  const rateLimiter =
    windowMs !== 60000 || maxRequests !== 100
      ? new SlidingWindowRateLimiter(windowMs, maxRequests)
      : globalRateLimiter;

  const middleware = async (c: Context<Env>, next: Next): Promise<Response | void> => {
    // Check excluded paths
    if (excludePaths.some(path => c.req.path.startsWith(path))) {
      return next();
    }

    // Check rate limit
    const result = rateLimiter.check(c);

    // Set rate limit headers
    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header("X-RateLimit-Remaining", String(result.remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(result.resetTime / 1000)));

    if (!result.allowed) {
      // Calculate retry-after seconds
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);

      logger.warn("Rate limit exceeded - returning 429", {
        module: "rate-limit",
        requestId: c.get("requestId"),
        path: c.req.path,
        retryAfter,
      });

      return c.json(
        {
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests. Please try again later.",
            requestId: c.get("requestId"),
            retryAfter,
          },
        },
        429
      );
    }

    await next();
  };

  // Attach reset method to middleware function for testing
  (middleware as { reset?: (identifier?: string) => void }).reset = (identifier?: string) => {
    if (identifier) {
      rateLimiter.reset(identifier);
    } else {
      rateLimiter.resetAll();
    }
  };

  return middleware as typeof middleware & { reset: (identifier?: string) => void };
}

/**
 * Default rate limit middleware
 *
 * Limits to 100 requests per minute per IP.
 */
export const rateLimitMiddleware = createRateLimitMiddleware();

/**
 * Reset rate limits for testing
 *
 * @param identifier - Optional client identifier to reset. If omitted, resets all.
 */
export function resetRateLimit(identifier?: string): void {
  if (identifier) {
    globalRateLimiter.reset(identifier);
  } else {
    globalRateLimiter.resetAll();
  }
}

/**
 * Get rate limit statistics
 *
 * Returns current rate limit state for all tracked clients.
 */
export function getRateLimitStats(): ReturnType<typeof globalRateLimiter.getStats> {
  return globalRateLimiter.getStats();
}

/**
 * Clean up rate limiter resources
 *
 * Call this when shutting down the server to clear timers.
 */
export function cleanupRateLimiter(): void {
  globalRateLimiter.stop();
}
