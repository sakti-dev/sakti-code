import { mkdir } from "node:fs/promises";
import { createStorage } from "unstorage";
import fsLiteDriver from "unstorage/drivers/fs-lite";

export interface ProviderCredentialRecord {
  providerId: string;
  profileId: string;
  kind: "token" | "oauth";
  secret: string;
  updatedAt: string;
}

export interface ProviderCredentialLookup {
  providerId: string;
  profileId: string;
}

export interface ProviderCredentialStorage {
  get(input: ProviderCredentialLookup): Promise<ProviderCredentialRecord | null>;
  set(record: ProviderCredentialRecord): Promise<void>;
  remove(input: ProviderCredentialLookup): Promise<void>;
}

export interface ProviderCredentialStorageOptions {
  baseDir: string;
}

function keyFor(input: ProviderCredentialLookup): string {
  return `profiles/${input.profileId}/providers/${input.providerId}`;
}

export function createProviderCredentialStorage(
  options: ProviderCredentialStorageOptions
): ProviderCredentialStorage {
  const storage = createStorage({
    driver: fsLiteDriver({ base: options.baseDir }),
  });
  let ensuredBaseDir = false;

  async function ensureBaseDir() {
    if (ensuredBaseDir) return;
    await mkdir(options.baseDir, { recursive: true, mode: 0o700 });
    ensuredBaseDir = true;
  }

  return {
    async get(input) {
      await ensureBaseDir();
      const value = await storage.getItem<ProviderCredentialRecord>(keyFor(input));
      return value ?? null;
    },

    async set(record) {
      await ensureBaseDir();
      await storage.setItem(keyFor(record), record);
    },

    async remove(input) {
      await ensureBaseDir();
      await storage.removeItem(keyFor(input));
    },
  };
}
