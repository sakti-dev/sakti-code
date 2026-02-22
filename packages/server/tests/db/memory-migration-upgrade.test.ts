/**
 * Migration upgrade tests for memory schema.
 *
 * Verifies upgrading a legacy DB (without FTS) applies FTS migration,
 * backfills existing rows, and keeps triggers working.
 */

import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createLegacyMigrationsFolder(tempRoot: string): Promise<string> {
  const legacy = path.join(tempRoot, "legacy-migrations");
  const meta = path.join(legacy, "meta");
  await mkdir(meta, { recursive: true });

  const source = path.resolve(__dirname, "../../drizzle");
  const files = [
    "0000_exotic_tattoo.sql",
    "0001_bent_leper_queen.sql",
    "0002_gigantic_warlock.sql",
  ];
  for (const file of files) {
    const content = await readFile(path.join(source, file), "utf-8");
    await writeFile(path.join(legacy, file), content, "utf-8");
  }

  const legacyJournal = {
    version: "7",
    dialect: "sqlite",
    entries: [
      { idx: 0, version: "6", when: 1771228726497, tag: "0000_exotic_tattoo", breakpoints: true },
      {
        idx: 1,
        version: "6",
        when: 1771231851268,
        tag: "0001_bent_leper_queen",
        breakpoints: true,
      },
      {
        idx: 2,
        version: "6",
        when: 1771232101634,
        tag: "0002_gigantic_warlock",
        breakpoints: true,
      },
    ],
  };

  await writeFile(
    path.join(meta, "_journal.json"),
    JSON.stringify(legacyJournal, null, 2),
    "utf-8"
  );
  return legacy;
}

describe("memory migration upgrade", () => {
  const cleanupDirs: string[] = [];

  afterAll(async () => {
    for (const dir of cleanupDirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("upgrades legacy DB to add messages_fts, backfill rows, and maintain triggers", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "sakti-code-migrate-"));
    cleanupDirs.push(tempRoot);

    const dbFile = path.join(tempRoot, "upgrade.db");
    const dbUrl = `file:${dbFile}`;
    const client = createClient({ url: dbUrl });
    const db = drizzle(client);

    const legacyFolder = await createLegacyMigrationsFolder(tempRoot);
    await migrate(db, { migrationsFolder: legacyFolder });

    const now = Date.now();
    await db.run(sql`
      INSERT INTO threads (id, resource_id, title, created_at, updated_at)
      VALUES ('legacy-thread', 'legacy-resource', 'Legacy Thread', ${now}, ${now})
    `);
    await db.run(sql`
      INSERT INTO messages (id, thread_id, resource_id, role, raw_content, search_text, injection_text, created_at, message_index)
      VALUES ('legacy-msg', 'legacy-thread', 'legacy-resource', 'assistant', 'raw', 'legacyupgradealpha', 'inj', ${now}, 0)
    `);

    const hasFtsBefore = await db.all(sql`
      SELECT name FROM sqlite_master WHERE name = 'messages_fts'
    `);
    expect(hasFtsBefore.length).toBe(0);

    const fullMigrations = path.resolve(__dirname, "../../drizzle");
    await migrate(db, { migrationsFolder: fullMigrations });

    const hasFtsAfter = await db.all(sql`
      SELECT name FROM sqlite_master WHERE name = 'messages_fts'
    `);
    expect(hasFtsAfter.length).toBe(1);

    const backfilled = await db.all(sql`
      SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'legacyupgradealpha'
    `);
    expect(backfilled.length).toBe(1);

    await db.run(sql`
      UPDATE messages SET search_text = 'legacyupgradebeta' WHERE id = 'legacy-msg'
    `);
    const oldAfterUpdate = await db.all(sql`
      SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'legacyupgradealpha'
    `);
    const newAfterUpdate = await db.all(sql`
      SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'legacyupgradebeta'
    `);
    expect(oldAfterUpdate.length).toBe(0);
    expect(newAfterUpdate.length).toBe(1);

    await db.run(sql`DELETE FROM messages WHERE id = 'legacy-msg'`);
    const afterDelete = await db.all(sql`
      SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'legacyupgradebeta'
    `);
    expect(afterDelete.length).toBe(0);

    client.close();
  });
});
