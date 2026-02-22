/**
 * Response caching middleware
 *
 * Caches GET request responses in memory using LRU eviction policy.
 * Reduces redundant processing for frequently accessed endpoints.
 *
 * Cache key includes URL and query parameters.
 * Only caches successful JSON responses (status 2xx).
 * Cached responses include TTL-based expiration.
 */

import { createLogger } from "@sakti-code/shared/logger";
import type { Context, Next } from "hono";
import type { Env } from "../index";

const logger = createLogger("server:cache");

/**
 * Cache entry structure
 */
interface CacheEntry {
  body: string; // Store response body as text
  status: number;
  headers: Record<string, string>;
  expiresAt: number;
}

/**
 * LRU Cache implementation
 */
class LRUCache {
  private cache: Map<string, CacheEntry>;
  private accessOrder: string[];
  private readonly maxSize: number;

  constructor(maxSize: number = 100) {
    this.cache = new Map();
    this.accessOrder = [];
    this.maxSize = maxSize;
  }

  private generateKey(method: string, path: string, search: string): string {
    return `${method}:${path}${search}`;
  }

  get(method: string, path: string, search: string): CacheEntry | null {
    const key = this.generateKey(method, path, search);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.accessOrder = this.accessOrder.filter(k => k !== key);
      return null;
    }

    // Update access order (move to end = most recently used)
    this.accessOrder = this.accessOrder.filter(k => k !== key);
    this.accessOrder.push(key);

    logger.debug("Cache hit", {
      module: "cache",
      key,
    });

    return entry;
  }

  set(
    method: string,
    path: string,
    search: string,
    body: string,
    status: number,
    headers: Record<string, string>,
    ttl: number
  ): void {
    const key = this.generateKey(method, path, search);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldestKey = this.accessOrder[0];
      this.cache.delete(oldestKey);
      this.accessOrder.shift();
    }

    this.cache.set(key, { body, status, headers, expiresAt: Date.now() + ttl });
    this.accessOrder = this.accessOrder.filter(k => k !== key);
    this.accessOrder.push(key);

    logger.debug("Cache set", {
      module: "cache",
      key,
      ttl,
    });
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  getStats(): { size: number; maxSize: number; keys: string[] } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      keys: this.accessOrder,
    };
  }
}

const globalCache = new LRUCache(100);

export interface CacheOptions {
  maxSize?: number;
  ttl?: number;
  successOnly?: boolean;
  excludePaths?: string[];
}

export function createCacheMiddleware(options: CacheOptions = {}) {
  const { maxSize = 100, ttl = 5 * 60 * 1000, successOnly = true, excludePaths = [] } = options;

  const cache = maxSize !== 100 ? new LRUCache(maxSize) : globalCache;

  return async (c: Context<Env>, next: Next): Promise<Response | void> => {
    // Only cache GET requests
    if (c.req.method !== "GET") {
      await next();
      c.header("X-Cache", "BYPASS");
      return;
    }

    // Check excluded paths
    if (excludePaths.some(path => c.req.path.startsWith(path))) {
      await next();
      c.header("X-Cache", "BYPASS");
      return;
    }

    // Check cache
    const cached = cache.get(c.req.method, c.req.path, c.req.url.split("?")[1] || "");
    if (cached) {
      logger.debug("Serving from cache", {
        module: "cache",
        path: c.req.path,
        requestId: c.get("requestId"),
      });

      // Return cached response
      c.header("X-Cache", "HIT");
      // Parse the cached body back to an object
      const bodyData = JSON.parse(cached.body);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return c.json(bodyData, cached.status as any, cached.headers);
    }

    // Execute request
    await next();

    // Only cache JSON responses
    const contentType = c.res.headers.get("content-type");
    const isJson = contentType?.includes("application/json");

    if (!isJson) {
      c.header("X-Cache", "BYPASS");
      return;
    }

    // Cache responses based on successOnly setting
    const isSuccessful = c.res.status >= 200 && c.res.status < 300;
    const shouldCache = successOnly ? isSuccessful : true;

    // Clone the response to read the body without consuming the original
    const clonedResponse = c.res.clone();
    const bodyText = await clonedResponse.text();

    if (shouldCache) {
      // Collect headers to cache (exclude some headers)
      const headers: Record<string, string> = {};
      for (const [key, value] of c.res.headers.entries()) {
        if (
          key !== "transfer-encoding" &&
          key !== "connection" &&
          key !== "keep-alive" &&
          key !== "content-length" &&
          key !== "x-cache"
        ) {
          headers[key] = value;
        }
      }

      cache.set(
        c.req.method,
        c.req.path,
        c.req.url.split("?")[1] || "",
        bodyText,
        c.res.status,
        headers,
        ttl
      );

      c.header("X-Cache", "MISS");
      return;
    }

    c.header("X-Cache", "BYPASS");
  };
}

export const cacheMiddleware = createCacheMiddleware();

export function clearCache(): void {
  globalCache.clear();
}

export function getCacheStats(): ReturnType<typeof globalCache.getStats> {
  return globalCache.getStats();
}
