import { app, safeStorage } from "electron";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const KEY_FILENAME = "provider-credential-key.bin";

export async function getOrCreateCredentialEncryptionKey(): Promise<string> {
  const userData = app.getPath("userData");
  const keyPath = join(userData, KEY_FILENAME);

  await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });

  const generate = () => randomBytes(32).toString("base64");

  try {
    const existing = await readFile(keyPath);
    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(existing).trim();
      if (decrypted.length > 0) {
        return decrypted;
      }
    } else {
      const plaintext = existing.toString("utf8").trim();
      if (plaintext.length > 0) {
        return plaintext;
      }
    }
  } catch {
    // Continue to key generation
  }

  const key = generate();
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(key);
    await writeFile(keyPath, encrypted, { mode: 0o600 });
    return key;
  }

  // Fallback for environments where platform encryption is unavailable.
  await writeFile(keyPath, key, { mode: 0o600 });
  return key;
}
