import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createProviderCredentialStorage,
  type ProviderCredentialRecord,
} from "../../src/provider/storage";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map(path => rm(path, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("provider credential storage", () => {
  async function readFilesRecursive(base: string): Promise<string[]> {
    const entries = await readdir(base, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = join(base, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await readFilesRecursive(full)));
        continue;
      }
      files.push(full);
    }
    return files;
  }

  it("stores and retrieves credential by profile and provider", async () => {
    const base = await mkdtemp(join(tmpdir(), "ekacode-provider-storage-"));
    tempDirs.push(base);

    const storage = createProviderCredentialStorage({ baseDir: base });
    const record: ProviderCredentialRecord = {
      providerId: "zai",
      profileId: "default",
      kind: "token",
      secret: "redacted-token",
      updatedAt: "2026-02-14T11:00:00.000Z",
    };

    await storage.set(record);

    const loaded = await storage.get({ providerId: "zai", profileId: "default" });

    expect(loaded).toEqual(record);
  });

  it("isolates credentials by provider", async () => {
    const base = await mkdtemp(join(tmpdir(), "ekacode-provider-storage-"));
    tempDirs.push(base);

    const storage = createProviderCredentialStorage({ baseDir: base });

    await storage.set({
      providerId: "zai",
      profileId: "default",
      kind: "token",
      secret: "zai-token",
      updatedAt: "2026-02-14T11:00:00.000Z",
    });

    const missing = await storage.get({ providerId: "openai", profileId: "default" });

    expect(missing).toBeNull();
  });

  it("deletes credentials", async () => {
    const base = await mkdtemp(join(tmpdir(), "ekacode-provider-storage-"));
    tempDirs.push(base);

    const storage = createProviderCredentialStorage({ baseDir: base });

    await storage.set({
      providerId: "zai",
      profileId: "default",
      kind: "token",
      secret: "zai-token",
      updatedAt: "2026-02-14T11:00:00.000Z",
    });

    await storage.remove({ providerId: "zai", profileId: "default" });

    const missing = await storage.get({ providerId: "zai", profileId: "default" });

    expect(missing).toBeNull();
  });

  it("encrypts persisted credential payload so plaintext secret is not on disk", async () => {
    const base = await mkdtemp(join(tmpdir(), "ekacode-provider-storage-"));
    tempDirs.push(base);

    const storage = createProviderCredentialStorage({ baseDir: base });
    const secret = "super-sensitive-token-123";

    await storage.set({
      providerId: "openai",
      profileId: "default",
      kind: "token",
      secret,
      updatedAt: "2026-02-14T11:00:00.000Z",
    });

    const files = await readFilesRecursive(base);
    const payloads = await Promise.all(files.map(file => readFile(file, "utf8").catch(() => "")));

    const joined = payloads.join("\n");
    expect(joined).not.toContain(secret);
  });
});
