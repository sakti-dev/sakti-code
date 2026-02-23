import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

async function createMigrationDir(baseDir: string, opts?: { withSql?: boolean }): Promise<string> {
  const dir = path.join(baseDir, "migrations");
  await mkdir(path.join(dir, "meta"), { recursive: true });
  await writeFile(
    path.join(dir, "meta", "_journal.json"),
    JSON.stringify(
      {
        version: "7",
        dialect: "sqlite",
        entries: [
          {
            idx: 0,
            version: "6",
            when: 1771228726497,
            tag: "0000_test_seed",
            breakpoints: true,
          },
        ],
      },
      null,
      2
    ),
    "utf-8"
  );

  if (opts?.withSql !== false) {
    await writeFile(path.join(dir, "0000_test_seed.sql"), "SELECT 1;", "utf-8");
  }

  return dir;
}

describe("db/migrate", () => {
  const oldEnv = process.env.SAKTI_CODE_MIGRATIONS_DIR;
  const cleanupDirs: string[] = [];

  beforeEach(() => {
    delete process.env.SAKTI_CODE_MIGRATIONS_DIR;
  });

  afterAll(async () => {
    process.env.SAKTI_CODE_MIGRATIONS_DIR = oldEnv;
    await Promise.all(cleanupDirs.map(dir => rm(dir, { recursive: true, force: true })));
  });

  it("prefers SAKTI_CODE_MIGRATIONS_DIR when valid", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "sakti-code-migrate-test-"));
    cleanupDirs.push(tempRoot);
    const migrationsDir = await createMigrationDir(tempRoot);
    process.env.SAKTI_CODE_MIGRATIONS_DIR = migrationsDir;

    const { resolveMigrationsFolder } = await import("../../db/migrate");
    const resolved = resolveMigrationsFolder();

    expect(resolved.path).toBe(migrationsDir);
    expect(resolved.source).toBe("env");
    expect(resolved.attemptedPaths[0]).toBe(migrationsDir);
  });

  it("throws clear error when env override is missing journal", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "sakti-code-migrate-test-"));
    cleanupDirs.push(tempRoot);
    const invalidDir = path.join(tempRoot, "invalid-migrations");
    await mkdir(invalidDir, { recursive: true });
    process.env.SAKTI_CODE_MIGRATIONS_DIR = invalidDir;

    const { resolveMigrationsFolder } = await import("../../db/migrate");
    expect(() => resolveMigrationsFolder()).toThrowError(/meta\/_journal\.json/);
  });

  it("throws clear error when journal references missing SQL file", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "sakti-code-migrate-test-"));
    cleanupDirs.push(tempRoot);
    const migrationsDir = await createMigrationDir(tempRoot, { withSql: false });

    const { validateMigrationsFolder } = await import("../../db/migrate");
    expect(() => validateMigrationsFolder(migrationsDir)).toThrowError(/0000_test_seed\.sql/);
  });
});
