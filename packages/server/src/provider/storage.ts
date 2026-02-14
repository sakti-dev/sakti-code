import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
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
  encryptionKey?: string;
}

function keyFor(input: ProviderCredentialLookup): string {
  return `profiles/${input.profileId}/providers/${input.providerId}`;
}

interface EncryptedSecret {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  ciphertext: string;
  tag: string;
}

interface EncryptedProviderCredentialRecord {
  providerId: string;
  profileId: string;
  kind: "token" | "oauth";
  secret: EncryptedSecret;
  updatedAt: string;
}

function parseEncryptionKey(raw?: string): Buffer | null {
  if (!raw || raw.trim().length === 0) return null;
  const trimmed = raw.trim();
  try {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // Fall through to utf8 handling
  }

  const utf8 = Buffer.from(trimmed, "utf8");
  if (utf8.length === 32) return utf8;
  throw new Error(
    "Invalid EKACODE_CREDENTIAL_KEY: expected 32-byte key as base64 or raw 32-char string"
  );
}

function isEncryptedRecord(record: unknown): record is EncryptedProviderCredentialRecord {
  if (!record || typeof record !== "object") return false;
  const candidate = record as Partial<EncryptedProviderCredentialRecord>;
  const secret = candidate.secret as Partial<EncryptedSecret> | undefined;
  return (
    typeof candidate.providerId === "string" &&
    typeof candidate.profileId === "string" &&
    (candidate.kind === "token" || candidate.kind === "oauth") &&
    typeof candidate.updatedAt === "string" &&
    !!secret &&
    secret.version === 1 &&
    secret.algorithm === "aes-256-gcm" &&
    typeof secret.iv === "string" &&
    typeof secret.ciphertext === "string" &&
    typeof secret.tag === "string"
  );
}

function encryptSecret(secret: string, key: Buffer): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    ciphertext: encrypted.toString("base64"),
    tag: tag.toString("base64"),
  };
}

function decryptSecret(secret: EncryptedSecret, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function createProviderCredentialStorage(
  options: ProviderCredentialStorageOptions
): ProviderCredentialStorage {
  const encryptionKey = parseEncryptionKey(
    options.encryptionKey ?? process.env.EKACODE_CREDENTIAL_KEY
  );
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
      const value = await storage.getItem<
        ProviderCredentialRecord | EncryptedProviderCredentialRecord
      >(keyFor(input));
      if (!value) return null;

      if (isEncryptedRecord(value)) {
        if (!encryptionKey) {
          throw new Error(
            `Encrypted provider credential exists for ${input.providerId} but EKACODE_CREDENTIAL_KEY is not configured`
          );
        }

        return {
          providerId: value.providerId,
          profileId: value.profileId,
          kind: value.kind,
          secret: decryptSecret(value.secret, encryptionKey),
          updatedAt: value.updatedAt,
        };
      }

      return value;
    },

    async set(record) {
      await ensureBaseDir();
      if (!encryptionKey) {
        await storage.setItem(keyFor(record), record);
        return;
      }

      const encryptedRecord: EncryptedProviderCredentialRecord = {
        ...record,
        secret: encryptSecret(record.secret, encryptionKey),
      };

      await storage.setItem(keyFor(record), encryptedRecord);
    },

    async remove(input) {
      await ensureBaseDir();
      await storage.removeItem(keyFor(input));
    },
  };
}
