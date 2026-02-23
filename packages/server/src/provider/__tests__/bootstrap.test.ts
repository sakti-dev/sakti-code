import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureCredentialProfileBootstrap } from "../bootstrap";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map(path => rm(path, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("provider credential profile bootstrap", () => {
  it("creates default profile seed metadata idempotently", async () => {
    const base = await mkdtemp(join(tmpdir(), "sakti-code-provider-bootstrap-"));
    tempDirs.push(base);

    await ensureCredentialProfileBootstrap(base, "default");
    await ensureCredentialProfileBootstrap(base, "default");

    const seedPath = join(base, "profiles", "default", "bootstrap.json");
    const content = await readFile(seedPath, "utf8");
    const parsed = JSON.parse(content) as {
      schemaVersion: number;
      profileId: string;
      seededAt: string;
    };

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.profileId).toBe("default");
    expect(typeof parsed.seededAt).toBe("string");
  });
});
