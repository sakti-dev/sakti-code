import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProviderCredentialStorage, type ProviderCredentialRecord } from "../storage";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map(path => rm(path, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("provider credential storage", () => {
  it("stores and retrieves credential by profile and provider", async () => {
    const base = await mkdtemp(join(tmpdir(), "sakti-code-provider-storage-"));
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
    const base = await mkdtemp(join(tmpdir(), "sakti-code-provider-storage-"));
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
    const base = await mkdtemp(join(tmpdir(), "sakti-code-provider-storage-"));
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
});
