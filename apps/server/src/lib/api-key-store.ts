import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Maps provider names to their standard environment variable names.
 * Mirrors pi-ai's env-api-keys.ts mapping so keys loaded into process.env
 * are found by getEnvApiKey().
 *
 * Only providers that use simple API key auth are included.
 * Providers requiring OAuth (e.g. github-copilot) or complex auth
 * (e.g. amazon-bedrock, google-vertex) are excluded.
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

/** Providers that users most commonly configure, in display order. */
export const COMMON_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "xai",
  "openrouter",
  "groq",
  "mistral",
] as const;

export interface ApiKeyInfo {
  envVar: string;
  hasKey: boolean;
  /** Last 4 characters of the key, or null if not set. */
  maskedKey: string | null;
  provider: string;
}

export interface ApiKeyStore {
  /** Delete a key for a provider. Returns true if it existed. */
  delete(provider: string): boolean;
  /** List all known providers with their key status. */
  list(): ApiKeyInfo[];
  /** Load all stored keys into process.env. Called on startup. */
  loadIntoEnv(): void;
  /** Set a key for a provider. Returns true if successful. */
  set(provider: string, key: string): boolean;
}

function getDefaultKeysPath(): string {
  const configDir = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(configDir, "sakti-code", "api-keys.json");
}

function readKeysFile(filePath: string): Record<string, string> {
  try {
    if (!existsSync(filePath)) {
      return {};
    }
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeKeysFile(filePath: string, keys: Record<string, string>): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(keys, null, 2), { mode: 0o600 });
  } catch {
    // Ignore write errors — keys stay in process.env for this session
  }
}

export function createApiKeyStore(
  keysPath: string = getDefaultKeysPath()
): ApiKeyStore {
  let keysCache: Record<string, string> | null = null;

  function getKeys(): Record<string, string> {
    if (keysCache === null) {
      keysCache = readKeysFile(keysPath);
    }
    return keysCache;
  }

  function persist(keys: Record<string, string>): void {
    keysCache = keys;
    writeKeysFile(keysPath, keys);
  }

  return {
    list() {
      const keys = getKeys();
      const result: ApiKeyInfo[] = [];
      for (const [provider, envVar] of Object.entries(PROVIDER_ENV_MAP)) {
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
      const keys = { ...getKeys(), [provider]: trimmed };
      persist(keys);
      process.env[envVar] = trimmed;
      return true;
    },

    delete(provider) {
      const envVar = PROVIDER_ENV_MAP[provider];
      if (!envVar) {
        return false;
      }
      const keys = getKeys();
      if (!(provider in keys)) {
        return false;
      }
      const next = { ...keys };
      delete next[provider];
      persist(next);
      delete process.env[envVar];
      return true;
    },

    loadIntoEnv() {
      const keys = getKeys();
      for (const [provider, key] of Object.entries(keys)) {
        const envVar = PROVIDER_ENV_MAP[provider];
        if (envVar && key) {
          process.env[envVar] = key;
        }
      }
    },
  };
}
