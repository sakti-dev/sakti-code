import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { PROVIDERS } from "@sakti-code/llm";
import lockfile from "proper-lockfile";

/**
 * Auth credential store. `auth.json` is the single source of truth — keys
 * persist here and are read back directly via `getApiKey()`. The store never
 * writes to or reads from `process.env`.
 */

/** Known provider ids from the catalog. Static per process. */
const KNOWN_PROVIDERS: readonly string[] = PROVIDERS;

export interface AuthEntry {
  hasKey: boolean;
  /** Last 4 characters of the key prefixed by `...`, or null if not set. */
  maskedKey: string | null;
  provider: string;
}

export interface AuthStore {
  /** Delete a key for a provider. Returns true if it existed. */
  delete(provider: string): boolean;
  /** Get the stored key for a provider, or undefined if none is stored. */
  getApiKey(provider: string): string | undefined;
  /** List all known providers with their key status (masked). */
  list(): AuthEntry[];
  /** Set a key for a provider. Returns true if successful. */
  set(provider: string, key: string): boolean;
}

const AUTH_FILE_WRITE_OPTIONS = { encoding: "utf-8" as const, mode: 0o600 };

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function ensureFileExists(filePath: string): void {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, "{}", AUTH_FILE_WRITE_OPTIONS);
    chmodSync(filePath, 0o600);
  }
}

function acquireLockSyncWithRetry(path: string): () => void {
  const maxAttempts = 10;
  const delayMs = 20;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return lockfile.lockSync(path, { realpath: false });
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : undefined;
      if (code !== "ELOCKED" || attempt === maxAttempts) {
        throw error;
      }
      lastError = error;
      const start = Date.now();
      while (Date.now() - start < delayMs) {
        // Synchronous sleep to keep callers sync
      }
    }
  }

  throw (lastError as Error) ?? new Error("Failed to acquire auth lock");
}

function readRaw(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, "utf-8");
  return JSON.parse(content) as Record<string, string>;
}

function writeRaw(filePath: string, data: Record<string, string>): void {
  writeFileSync(
    filePath,
    JSON.stringify(data, null, 2),
    AUTH_FILE_WRITE_OPTIONS
  );
  chmodSync(filePath, 0o600);
}

export function createAuthStore(authPath: string): AuthStore {
  function withLock<T>(
    fn: (current: Record<string, string>) => {
      result: T;
      next?: Record<string, string>;
    }
  ): T {
    ensureParentDir(authPath);
    ensureFileExists(authPath);

    const release = acquireLockSyncWithRetry(authPath);
    try {
      const current = readRaw(authPath);
      const { result, next } = fn(current);
      if (next !== undefined) {
        writeRaw(authPath, next);
      }
      return result;
    } finally {
      release();
    }
  }

  return {
    getApiKey(provider) {
      return withLock((current) => ({ result: current[provider] }));
    },

    list() {
      ensureParentDir(authPath);
      ensureFileExists(authPath);
      const keys = existsSync(authPath) ? readRaw(authPath) : {};

      const result: AuthEntry[] = [];
      for (const provider of KNOWN_PROVIDERS) {
        const key = keys[provider];
        result.push({
          provider,
          hasKey: !!key,
          maskedKey: key ? `...${key.slice(-4)}` : null,
        });
      }
      return result;
    },

    set(provider, key) {
      if (!KNOWN_PROVIDERS.includes(provider)) {
        return false;
      }
      const trimmed = key.trim();
      if (!trimmed) {
        return false;
      }
      return withLock((current) => {
        const next = { ...current, [provider]: trimmed };
        return { result: true, next };
      });
    },

    delete(provider) {
      if (!KNOWN_PROVIDERS.includes(provider)) {
        return false;
      }
      return withLock((current) => {
        if (!(provider in current)) {
          return { result: false };
        }
        const next = { ...current };
        delete next[provider];
        return { result: true, next };
      });
    },
  };
}
