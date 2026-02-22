/**
 * Persisted Cache Utilities
 *
 * Provides versioned localStorage caching for global, workspace, and session data.
 * Includes quota handling, LRU eviction, and migration support.
 *
 * Based on opencode packages/app/src/utils/persist.ts
 */

/**
 * Simple FNV-1a hash for checksum generation
 */
export function checksum(content: string): string | undefined {
  if (!content) return undefined;
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Cache limits for localStorage
 */
const CACHE_MAX_ENTRIES = 500;
const CACHE_MAX_BYTES = 8 * 1024 * 1024; // 8MB

type CacheEntry = { value: string; bytes: number };
const cache = new Map<string, CacheEntry>();
const cacheTotal = { bytes: 0 };

function cacheDelete(key: string) {
  const entry = cache.get(key);
  if (!entry) return;
  cacheTotal.bytes -= entry.bytes;
  cache.delete(key);
}

function cachePrune() {
  while (cache.size > CACHE_MAX_ENTRIES || cacheTotal.bytes > CACHE_MAX_BYTES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) return;
    cacheDelete(oldest);
  }
}

function cacheSet(key: string, value: string) {
  const bytes = value.length * 2; // UTF-16
  if (bytes > CACHE_MAX_BYTES) {
    cacheDelete(key);
    return;
  }

  const entry = cache.get(key);
  if (entry) cacheTotal.bytes -= entry.bytes;
  cache.delete(key);
  cache.set(key, { value, bytes });
  cacheTotal.bytes += bytes;
  cachePrune();
}

function cacheGet(key: string): string | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  // Move to end (LRU)
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

/**
 * Detect if error is a quota exceeded error
 */
function isQuotaError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return (
      error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error.name === "QUOTA_EXCEEDED_ERR" ||
      error.code === 22 ||
      error.code === 1014
    );
  }

  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
  if (name && /quota/i.test(name)) return true;

  const code = (error as { code?: number }).code;
  if (code === 22 || code === 1014) return true;

  const message = (error as { message?: string }).message;
  if (typeof message === "string" && /quota/i.test(message)) return true;

  return false;
}

/**
 * Persist target configuration
 */
export type PersistTarget = {
  key: string;
  legacy?: string[];
  migrate?: (value: unknown) => unknown;
};

/**
 * Persist namespace for cache key generation
 */
export const Persist = {
  /**
   * Global cache key (app-wide settings)
   */
  global(key: string): PersistTarget {
    return { key: `sakti-code.global.${key}` };
  },

  /**
   * Workspace cache key (per-directory)
   */
  workspace(directory: string, key: string): PersistTarget {
    const head = directory.slice(0, 12) || "workspace";
    const sum = checksum(directory) ?? "0";
    return { key: `sakti-code.workspace.${head}.${sum}.${key}` };
  },

  /**
   * Session cache key (per-session within workspace)
   */
  session(directory: string, sessionId: string, key: string): PersistTarget {
    const head = directory.slice(0, 12) || "workspace";
    const sum = checksum(directory) ?? "0";
    return { key: `sakti-code.session.${head}.${sum}.${sessionId}.${key}` };
  },

  /**
   * Auto-detect scope based on parameters
   */
  scoped(directory: string, sessionId: string | undefined, key: string): PersistTarget {
    if (sessionId) return Persist.session(directory, sessionId, key);
    return Persist.workspace(directory, key);
  },
};

/**
 * Read from localStorage with cache fallback
 */
export function persistRead(target: PersistTarget): unknown {
  const cached = cacheGet(target.key);
  if (cached !== undefined) {
    try {
      return JSON.parse(cached);
    } catch {
      return undefined;
    }
  }

  try {
    const raw = localStorage.getItem(target.key);
    if (raw === null) return undefined;
    cacheSet(target.key, raw);
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Write to localStorage with quota handling
 */
export function persistWrite(target: PersistTarget, value: unknown): boolean {
  const serialized = JSON.stringify(value);

  // Try cache first
  try {
    localStorage.setItem(target.key, serialized);
    cacheSet(target.key, serialized);
    return true;
  } catch (error) {
    if (!isQuotaError(error)) throw error;
  }

  // Try removing old key and setting again
  try {
    localStorage.removeItem(target.key);
    cacheDelete(target.key);
    localStorage.setItem(target.key, serialized);
    cacheSet(target.key, serialized);
    return true;
  } catch (error) {
    if (!isQuotaError(error)) throw error;
  }

  // Try evicting other sakti-code keys
  const keysToEvict: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith("sakti-code.") && key !== target.key) {
      keysToEvict.push(key);
    }
  }

  // Sort by size (largest first)
  keysToEvict.sort((a, b) => {
    const sizeA = localStorage.getItem(a)?.length ?? 0;
    const sizeB = localStorage.getItem(b)?.length ?? 0;
    return sizeB - sizeA;
  });

  for (const key of keysToEvict) {
    localStorage.removeItem(key);
    cacheDelete(key);
    try {
      localStorage.setItem(target.key, serialized);
      cacheSet(target.key, serialized);
      return true;
    } catch (error) {
      if (!isQuotaError(error)) throw error;
    }
  }

  // Still can't fit - cache in memory only
  cacheSet(target.key, serialized);
  return false;
}

/**
 * Remove persisted value
 */
export function persistRemove(target: PersistTarget): void {
  localStorage.removeItem(target.key);
  cacheDelete(target.key);

  // Also remove legacy keys
  if (target.legacy) {
    for (const legacyKey of target.legacy) {
      localStorage.removeItem(legacyKey);
      cacheDelete(legacyKey);
    }
  }
}

/**
 * Merge defaults with stored value (handles migrations)
 */
function merge<T>(defaults: T, value: unknown): T {
  if (value === undefined) return defaults;
  if (value === null) return value as T;

  if (Array.isArray(defaults)) {
    if (Array.isArray(value)) return value as T;
    return defaults;
  }

  if (typeof defaults === "object" && defaults !== null && !Array.isArray(defaults)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return defaults;
    }

    const result = { ...defaults };
    for (const key of Object.keys(value)) {
      if (key in defaults) {
        (result as Record<string, unknown>)[key] = merge(
          (defaults as Record<string, unknown>)[key],
          (value as Record<string, unknown>)[key]
        );
      } else {
        (result as Record<string, unknown>)[key] = (value as Record<string, unknown>)[key];
      }
    }
    return result as T;
  }

  return value as T;
}

/**
 * Persist a store with defaults and migration support
 *
 * @param target - Persist target configuration
 * @param defaults - Default values
 * @returns [read, write, remove] functions
 */
export function persisted<T>(target: PersistTarget, defaults: T) {
  const read = (): T => {
    const raw = persistRead(target);
    if (raw === undefined) return defaults;

    const migrated = target.migrate ? target.migrate(raw) : raw;
    return merge(defaults, migrated);
  };

  const write = (value: T): boolean => {
    return persistWrite(target, value);
  };

  const remove = (): void => {
    persistRemove(target);
  };

  return { read, write, remove };
}
