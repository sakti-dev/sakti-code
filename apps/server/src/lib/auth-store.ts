import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";

/**
 * Maps provider names to their standard environment variable names.
 * Mirrors pi-ai's env-api-keys.ts mapping so keys loaded into process.env
 * are found by getEnvApiKey().
 */
const PROVIDER_ENV_MAP: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  google: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  huggingface: "HF_TOKEN",
  mistral: "MISTRAL_API_KEY",
  openai: "OPENAI_API_KEY",
  opencode: "OPENCODE_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  together: "TOGETHER_API_KEY",
  xai: "XAI_API_KEY",
  zai: "ZAI_API_KEY",
};

/** Known provider ids in a stable display order. */
export const KNOWN_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "xai",
  "openrouter",
  "groq",
  "mistral",
] as const;

export const PROVIDER_ENV_VARS = PROVIDER_ENV_MAP;

export interface AuthEntry {
  envVar: string;
  hasKey: boolean;
  /** Last 4 characters of the key prefixed by `...`, or null if not set. */
  maskedKey: string | null;
  provider: string;
}

export interface AuthStore {
  /** Delete a key for a provider. Returns true if it existed. */
  delete(provider: string): boolean;
  /** List all known providers with their key status (masked). */
  list(): AuthEntry[];
  /** Load all stored keys into process.env. Called on startup. */
  loadIntoEnv(): void;
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
    list() {
      ensureParentDir(authPath);
      ensureFileExists(authPath);
      const keys = existsSync(authPath) ? readRaw(authPath) : {};

      const result: AuthEntry[] = [];
      for (const provider of KNOWN_PROVIDERS) {
        const envVar = PROVIDER_ENV_MAP[provider];
        if (!envVar) {
          continue;
        }
        const key = keys[provider];
        result.push({
          provider,
          envVar,
          hasKey: !!key,
          maskedKey: key ? `...${key.slice(-4)}` : null,
        });
      }
      return result;
    },

    set(provider, key) {
      const envVar = PROVIDER_ENV_MAP[provider];
      if (!envVar) {
        return false;
      }
      const trimmed = key.trim();
      if (!trimmed) {
        return false;
      }
      const ok = withLock((current) => {
        const next = { ...current, [provider]: trimmed };
        return { result: true, next };
      });
      if (ok) {
        process.env[envVar] = trimmed;
      }
      return ok;
    },

    delete(provider) {
      const envVar = PROVIDER_ENV_MAP[provider];
      if (!envVar) {
        return false;
      }
      const ok = withLock((current) => {
        if (!(provider in current)) {
          return { result: false };
        }
        const next = { ...current };
        delete next[provider];
        return { result: true, next };
      });
      if (ok) {
        delete process.env[envVar];
      }
      return ok;
    },

    loadIntoEnv() {
      ensureParentDir(authPath);
      ensureFileExists(authPath);
      const keys = readRaw(authPath);
      for (const [provider, key] of Object.entries(keys)) {
        const envVar = PROVIDER_ENV_MAP[provider];
        if (envVar && key) {
          process.env[envVar] = key;
        }
      }
    },
  };
}
